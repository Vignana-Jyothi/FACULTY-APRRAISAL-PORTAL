import { Request, Response } from 'express';
import { z } from 'zod';
import { RoleType, FeedbackPeriod } from '@prisma/client';
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
import { targetStatus } from '../services/targetStatus';

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

// Feedback is issued per period: the four quarters, then the final annual one.
export const PERIOD_LABEL: Record<FeedbackPeriod, string> = {
  Q1: 'Quarter 1 (Jul-Sep)',
  Q2: 'Quarter 2 (Oct-Dec)',
  Q3: 'Quarter 3 (Jan-Mar)',
  Q4: 'Quarter 4 (Apr-Jun)',
  ANNUAL: 'Annual (final)',
};
const PERIOD_ORDER: FeedbackPeriod[] = ['Q1', 'Q2', 'Q3', 'Q4', 'ANNUAL'];

// Read the period from a query/body value, defaulting to ANNUAL so a caller
// that predates the per-period feedback rework still targets the annual row.
function parsePeriod(v: unknown): FeedbackPeriod {
  return PERIOD_ORDER.includes(v as FeedbackPeriod) ? (v as FeedbackPeriod) : FeedbackPeriod.ANNUAL;
}

const whereFeedback = (submissionId: string, period: FeedbackPeriod) =>
  ({ submissionId_period: { submissionId, period } });

// GET /appraisals/:id/feedbacks — every period's feedback for the submission.
// The author (HoD/principal) sees all five rows (draft or issued) with their
// status; the owner sees only the ISSUED ones, narrative only. Drives the
// per-quarter tabs and the faculty's list of received feedback.
export async function listFeedbacks(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { departmentId: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!canViewUserResource(req.user!, sub.userId, sub.user.departmentId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const isOwner = req.user!.id === sub.userId;

  const rows = await prisma.feedback.findMany({
    where: { submissionId: sub.id, ...(isOwner ? { status: 'ISSUED' } : {}) },
    include: { issuedBy: { select: { name: true } } },
  });
  const byPeriod = new Map(rows.map((r) => [r.period, r]));

  const out = PERIOD_ORDER.map((period) => {
    const r = byPeriod.get(period);
    const base = { period, label: PERIOD_LABEL[period] };
    if (!r) return { ...base, status: 'NONE' as const };
    // Never ship the snapshot (cadre/eligibility internals) to the owner.
    const { snapshot: _snapshot, ...rest } = r as any;
    return { ...base, status: r.status, ...(isOwner ? rest : r), issuedByName: r.issuedBy?.name ?? null };
  }).filter((r) => (isOwner ? r.status === 'ISSUED' : true));

  return res.json({ periods: out, editable: canAuthor(req.user!, sub.userId, sub.user.departmentId) });
}

// GET /appraisals/:id/feedback?period=Q1
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
  const period = parsePeriod(req.query.period);
  const feedback = await prisma.feedback.findUnique({
    where: whereFeedback(sub.id, period),
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
  period: z.nativeEnum(FeedbackPeriod).optional(),
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

  const { period: periodIn, ...data } = saveSchema.parse(req.body);
  const period = parsePeriod(periodIn);
  const snapshot = await buildSnapshot(sub.id);

  const feedback = await prisma.feedback.upsert({
    where: whereFeedback(sub.id, period),
    create: { submissionId: sub.id, period, userId: sub.userId, academicYearId: sub.academicYearId, snapshot: snapshot as any, ...data },
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

  const { period: periodIn, ...data } = saveSchema.parse(req.body ?? {});
  const period = parsePeriod(periodIn);
  const snapshot = await buildSnapshot(sub.id);

  const feedback = await prisma.feedback.upsert({
    where: whereFeedback(sub.id, period),
    create: {
      submissionId: sub.id, period, userId: sub.userId, academicYearId: sub.academicYearId, snapshot: snapshot as any,
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
      payload: { name: faculty?.name ?? 'Faculty', year: sub.academicYear.label, submissionId: sub.id, period, periodLabel: PERIOD_LABEL[period] },
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

  const period = parsePeriod(req.query.period);
  const feedback = await prisma.feedback.findUnique({
    where: whereFeedback(sub.id, period),
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

// GET /appraisals/:id/target-status — the faculty-facing target progress for the
// dashboard bar: each measurable FAPA target with required vs current and how
// many are met. Deliberately faculty-safe (targetStatus): labels, numbers and a
// status only — no cadre, no tier, no eligibility verdict. Score targets are
// measured against the faculty's own /500, never the reviewer's /550.
export async function getTargetStatus(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    select: { id: true, userId: true, user: { select: { departmentId: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Submission not found' });
  if (!canViewUserResource(req.user!, sub.userId, sub.user?.departmentId ?? null)) {
    return res.status(403).json({ error: 'Not allowed' });
  }

  const snap = await buildSnapshot(sub.id);
  if (!snap) return res.status(404).json({ error: 'Submission not found' });

  // Only the faculty-safe target rows leave this endpoint — never the cadre,
  // the eligibility verdict or the reviewed totals buildSnapshot also holds.
  const status = targetStatus(snap.requirements, snap.scores.total);
  return res.json({ year: snap.year, ...status });
}
