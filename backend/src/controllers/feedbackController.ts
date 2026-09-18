import { Request, Response } from 'express';
import { z } from 'zod';
import { RoleType } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { canViewUserResource } from '../utils/access';
import { SEES_ALL, hasAnyRole } from '../utils/roles';
import { enqueueEmail } from '../services/emailService';
import { feedbackIssuedKey } from '../services/emailKeys';
import { TRACKING_INCLUDE, loadTrackingContext } from '../services/trackingService';
import { computeScore } from '../services/scoringEngine';
import { computeActuals } from '../services/trackingEngine';
import { deriveCadre, computeExperienceYears, pickCadreTarget, checkEligibility, CADRE_LABEL } from '../services/cadreEngine';
import { generateNarrative } from '../services/feedbackNarrative';

// Author of feedback: the HoD of the faculty's own department, or the principal
// institute-wide — never the owner. The admin lost this with the rest of the
// appraisal content in the 2026-09-18 role rework.
function canAuthor(user: NonNullable<Request['user']>, ownerId: string, ownerDept: string | null): boolean {
  if (user.id === ownerId) return false;
  if (hasAnyRole(user, SEES_ALL)) return true;
  return user.roles.some((r) => r.role === RoleType.HOD && r.departmentId != null && r.departmentId === ownerDept);
}

// Auto-filled snapshot for feedback: SELF-appraisal marks + cadre "ideal
// targets" (eligibility). No tier, no reviewed/Cat6/grand — feedback shows the
// faculty's own self-appraisal against the ideal targets.
async function buildSnapshot(submissionId: string) {
  const sub = await prisma.appraisalSubmission.findUnique({ where: { id: submissionId }, include: TRACKING_INCLUDE });
  if (!sub) return null;
  const year = await prisma.academicYear.findUnique({ where: { id: sub.academicYearId } });
  if (!year) return null;

  const u = (sub as any).user;
  const ctx = await loadTrackingContext(sub.academicYearId);
  const score = computeScore(sub as any); // self-appraisal breakdown
  const actuals = computeActuals(sub as any, null); // force self total (not reviewed)
  const expYears = computeExperienceYears(u.dateOfJoining, year.startDate);
  const cadre = deriveCadre(u.designation);
  const target = cadre ? pickCadreTarget(ctx.cadreTargets, cadre, expYears) : null;
  const eligibility = checkEligibility(actuals, target);

  return {
    year: year.label,
    faculty: { id: u.id, name: u.name, employeeCode: u.employeeCode, designation: u.designation },
    department: u.department,
    cadre,
    cadreLabel: cadre ? CADRE_LABEL[cadre] : null,
    expYears: Math.round(expYears * 10) / 10,
    eligible: eligibility.eligible,
    requirements: eligibility.requirements, // the ideal targets
    scores: {
      cat1: score.cat1.total,
      cat2: score.cat2.total,
      cat3: score.cat3.total,
      cat4: score.cat4.total,
      cat5: score.cat5.total,
      total: score.selfTotal,
    },
  };
}

// GET /appraisals/:id/feedback
export async function getFeedback(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { departmentId: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canViewUserResource(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const editable = canAuthor(req.user!, sub.userId, sub.user.departmentId);
  const isOwner = req.user!.id === sub.userId;
  const feedback = await prisma.feedback.findUnique({
    where: { submissionId: sub.id },
    include: { issuedBy: { select: { name: true } } },
  });

  // Faculty (owner) only sees an issued feedback — and only the narrative. The
  // snapshot carries cadre / eligibility / target internals, so strip it so
  // faculty never see (or can inspect) the tier/eligibility machinery.
  if (isOwner) {
    if (!feedback || feedback.status !== 'ISSUED') return res.json({ feedback: null, editable: false });
    const { snapshot: _snapshot, ...facultyFeedback } = feedback as any;
    return res.json({ feedback: facultyFeedback, editable: false });
  }

  // Editors (HoD/admin) also get a fresh auto snapshot to preview current
  // standing, plus an auto-generated narrative to pre-fill the editor — so the
  // HoD reviews a ready draft and edits or issues it with one click.
  const autoSnapshot = editable ? await buildSnapshot(sub.id) : null;
  const suggested = autoSnapshot ? generateNarrative(autoSnapshot) : null;
  return res.json({ feedback, autoSnapshot, suggested, editable });
}

const saveSchema = z.object({
  strengths: z.string().optional(),
  improvements: z.string().optional(),
  growthTargets: z.string().optional(),
});

// PUT /appraisals/:id/feedback — save narrative as DRAFT (HoD/admin).
export async function saveFeedback(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { departmentId: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canAuthor(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Only the HoD can author feedback' });
  }

  const data = saveSchema.parse(req.body);
  const snapshot = await buildSnapshot(sub.id);

  const feedback = await prisma.feedback.upsert({
    where: { submissionId: sub.id },
    create: { submissionId: sub.id, userId: sub.userId, academicYearId: sub.academicYearId, snapshot: snapshot as any, ...data },
    update: { ...data },
  });
  return res.json(feedback);
}

// POST /appraisals/:id/feedback/issue — release to faculty (HoD/admin).
export async function issueFeedback(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { departmentId: true } }, academicYear: { select: { label: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canAuthor(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Only the HoD can issue feedback' });
  }

  const data = saveSchema.parse(req.body ?? {});
  const snapshot = await buildSnapshot(sub.id);

  const feedback = await prisma.feedback.upsert({
    where: { submissionId: sub.id },
    create: {
      submissionId: sub.id, userId: sub.userId, academicYearId: sub.academicYearId, snapshot: snapshot as any,
      ...data, status: 'ISSUED', issuedById: req.user!.id, issuedAt: new Date(),
    },
    update: { ...data, snapshot: snapshot as any, status: 'ISSUED', issuedById: req.user!.id, issuedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: 'FEEDBACK_ISSUED', entityType: 'Feedback', entityId: feedback.id },
  });

  try {
    const faculty = await prisma.user.findUnique({ where: { id: sub.userId }, select: { name: true } });
    await enqueueEmail({
      toUserId: sub.userId,
      template: 'feedback_issued',
      payload: { name: faculty?.name ?? 'Faculty', year: sub.academicYear.label, submissionId: sub.id },
      dedupeKey: feedbackIssuedKey(feedback.id, [feedback.strengths, feedback.improvements, feedback.growthTargets]),
    });
  } catch (e) {
    console.error('[email] enqueue feedback_issued failed:', e);
  }

  return res.json(feedback);
}

// Whether this viewer's copy of the feedback carries the cadre / eligibility
// standing. Only an author does: the owner gets the narrative alone, and that
// holds when the owner happens to be a HoD or an incharge filing their own
// appraisal — the rule is ownership, not role.
export function snapshotForViewer(v: { isOwner: boolean; editable: boolean }): boolean {
  if (v.isOwner) return false;
  return v.editable;
}

// GET /appraisals/:id/feedback/pdf
// Same visibility split as getFeedback: the owner gets the narrative only, and
// only once it is ISSUED; a HoD/admin also gets the cadre + eligibility
// standing. The check is on ownership, not role — a HoD or incharge downloading
// their OWN feedback is the owner and sees the faculty view of it.
export async function downloadFeedbackPdf(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, designation: true, departmentId: true, department: true } },
      academicYear: { select: { label: true } },
    },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canViewUserResource(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const isOwner = req.user!.id === sub.userId;
  const editable = canAuthor(req.user!, sub.userId, sub.user.departmentId);

  const feedback = await prisma.feedback.findUnique({
    where: { submissionId: sub.id },
    include: { issuedBy: { select: { name: true } } },
  });
  if (!feedback) return res.status(404).json({ error: 'No feedback for this appraisal' });
  if (isOwner && feedback.status !== 'ISSUED') {
    return res.status(403).json({ error: 'Feedback has not been issued yet' });
  }

  const snapshot = snapshotForViewer({ isOwner, editable })
    ? ((feedback.snapshot as any) ?? (await buildSnapshot(sub.id)))
    : null;

  const { renderFeedbackHtml, renderHtmlToPdf } = await import('../services/pdfService');
  const html = renderFeedbackHtml(feedback, snapshot, {
    user: sub.user,
    yearLabel: sub.academicYear?.label ?? '—',
  });
  const pdf = await renderHtmlToPdf(html);

  const code = sub.user.employeeCode ?? sub.userId;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=feedback-${code}-${sub.academicYear?.label ?? ''}.pdf`);
  return res.send(pdf);
}
