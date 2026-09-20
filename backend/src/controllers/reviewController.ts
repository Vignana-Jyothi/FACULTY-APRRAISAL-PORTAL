import { Request, Response } from 'express';
import { z } from 'zod';
import { RoleType, SubmissionStatus, ReviewerRole } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { isOwnerView, stripReviewerAssessment, canSeeReviewerAssessment } from '../utils/reviewVisibility';
import { DEPT_REVIEW, deptIdsFor } from '../utils/roles';
import { computeScore } from '../services/scoringEngine';
import { enqueueEmail } from '../services/emailService';
import { unlockedKey } from '../services/emailKeys';
import { canViewUserResource } from '../utils/access';
import { syncProofVerifications, PROOF_SOURCES } from '../services/proofService';

// Category maxima, mirrored from the scoring engine's category caps.
export const CATEGORY_MAX = { cat1: 150, cat2: 150, cat3: 100, cat4: 50, cat5: 50 } as const;

const reviewSchema = z.object({
  // The reviewer may override any category 1-5 mark. Omitted = accept the
  // server-computed value for that category.
  cat1Score: z.number().min(0).max(CATEGORY_MAX.cat1).optional(),
  cat2Score: z.number().min(0).max(CATEGORY_MAX.cat2).optional(),
  cat3Score: z.number().min(0).max(CATEGORY_MAX.cat3).optional(),
  cat4Score: z.number().min(0).max(CATEGORY_MAX.cat4).optional(),
  cat5Score: z.number().min(0).max(CATEGORY_MAX.cat5).optional(),
  cat6Punctuality: z.number().min(0).max(10).optional(),
  cat6Professionalism: z.number().min(0).max(10).optional(),
  cat6Willingness: z.number().min(0).max(10).optional(),
  cat6Cordiality: z.number().min(0).max(10).optional(),
  cat6Classroom: z.number().min(0).max(10).optional(),
  teachingComment: z.string().optional(),
  researchComment: z.string().optional(),
  developmentComment: z.string().optional(),
  governanceComment: z.string().optional(),
  supplementaryComment: z.string().optional(),
  overallComment: z.string().optional(),
  status: z.enum(['APPROVED', 'REJECTED']),
});

export const FULL_INCLUDE = {
  cat1Courses: true, cat1CourseResults: true, cat1Projects: true, cat1EContent: true, cat1ICT: true,
  cat2Journals: true, cat2Conferences: true, cat2ConfBookChapters: true, cat2BookChapters: true, cat2Books: true,
  cat2Citations: true, cat2Patents: true, cat2Projects: true, cat2Consultancy: true,
  cat2Guidance: true, cat2ResearchGroups: true, cat2Linkages: true, cat2Startups: true,
  cat2IndustryLinkages: true,
  cat3AdvQual: true, cat3Organised: true, cat3ConferencesAttended: true, cat3ResourcePerson: true, cat3Editorial: true,
  cat3Training: true, cat3IntlTravel: true, cat4AdminResp: true, cat4StudentAct: true,
  cat5Memberships: true, cat5Awards: true, cat5Differentiators: true, cat5Internships: true,
  user: { select: { id: true, departmentId: true } },
};

export async function listPendingReviews(req: Request, res: Response) {
  const user = req.user!;
  const deptIds = deptIdsFor(user, DEPT_REVIEW);

  const subs = await prisma.appraisalSubmission.findMany({
    where: {
      status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
      userId: { not: user.id },
      user: { departmentId: { in: deptIds } },
    },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, departmentId: true, department: true } },
      academicYear: { select: { id: true, label: true } },
      review: true,
    },
    orderBy: { submittedAt: 'asc' },
  });

  return res.json(subs);
}

export async function submitReview(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: FULL_INCLUDE,
  });

  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (sub.userId === req.user!.id) return res.status(403).json({ error: 'Cannot review own submission' });
  // Reviewer/HoD may only review submissions in their own department.
  if (!canViewUserResource(req.user!, sub.userId, (sub.user as any)?.departmentId ?? null)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (sub.status === SubmissionStatus.APPROVED) return res.status(400).json({ error: 'Already approved' });

  const data = reviewSchema.parse(req.body);

  // W2 gate — cannot approve until every proof is verified. Proofs belonging to
  // a voided source are exempt: the correction deadline passed, those rows were
  // already stripped of their marks, and holding the whole appraisal hostage to
  // evidence that will never arrive is exactly what voiding exists to prevent.
  if (data.status === 'APPROVED') {
    const proofs = await syncProofVerifications(sub.id);
    const voidedSections = new Set(
      PROOF_SOURCES.filter((src) => sub.voidedSources.includes(src.key)).map((src) => src.section)
    );
    const unverified = proofs.filter((p) => p.status !== 'VERIFIED' && !voidedSections.has(p.section));
    if (unverified.length > 0) {
      return res.status(400).json({
        error: `Cannot approve — ${unverified.length} proof(s) not yet verified`,
        unverified: unverified.map((p) => ({ section: p.section, item: p.item, field: p.field, status: p.status })),
      });
    }
  }

  const isHod = req.user!.roles.some((r) => r.role === RoleType.HOD);
  const reviewerRole: ReviewerRole = isHod ? ReviewerRole.HOD : ReviewerRole.REVIEWER;

  // If the dean has assigned final reviewers, an APPROVE by the HoD does
  // NOT finalise — it hands off to the 2-reviewer layer above the HoD.
  const finalReviewerCount = data.status === 'APPROVED'
    ? await prisma.finalReview.count({ where: { submissionId: sub.id } })
    : 0;
  const effectiveStatus: SubmissionStatus = data.status === 'APPROVED' && finalReviewerCount > 0
    ? SubmissionStatus.FINAL_REVIEW
    : (data.status as SubmissionStatus);

  const computedScore = computeScore(sub as any);

  const cat6Total = (data.cat6Punctuality ?? 0) + (data.cat6Professionalism ?? 0) +
    (data.cat6Willingness ?? 0) + (data.cat6Cordiality ?? 0) + (data.cat6Classroom ?? 0);

  // The reviewer's marks for categories 1-5. Each defaults to what the engine
  // computed from the submitted evidence; the reviewer may mark a category down
  // (weak or unsupported evidence) or up. The faculty's own self score is not
  // stored here — it stays recomputable from the submission via computeScore,
  // so the two assessments are always separable downstream.
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const awarded = {
    cat1Score: clamp(data.cat1Score ?? computedScore.cat1.total, CATEGORY_MAX.cat1),
    cat2Score: clamp(data.cat2Score ?? computedScore.cat2.total, CATEGORY_MAX.cat2),
    cat3Score: clamp(data.cat3Score ?? computedScore.cat3.total, CATEGORY_MAX.cat3),
    cat4Score: clamp(data.cat4Score ?? computedScore.cat4.total, CATEGORY_MAX.cat4),
    cat5Score: clamp(data.cat5Score ?? computedScore.cat5.total, CATEGORY_MAX.cat5),
  };
  const totalScore = awarded.cat1Score + awarded.cat2Score + awarded.cat3Score +
    awarded.cat4Score + awarded.cat5Score;
  const grandTotal = totalScore + Math.min(cat6Total, 50);
  // Freeze the faculty's own total alongside the reviewed one. Both belong to
  // the same signed decision, so both are stored; leaving the self figure to be
  // recomputed on read means a later scoring change moves one and not the other.
  const selfTotalScore = computedScore.selfTotal;

  await prisma.$transaction(async (tx) => {
    await tx.appraisalReview.upsert({
      where: { submissionId: sub.id },
      create: {
        submissionId: sub.id,
        reviewerId: req.user!.id,
        reviewerRole,
        ...data,
        ...awarded,
        selfTotalScore,
        totalScore,
        grandTotal,
        status: data.status as SubmissionStatus,
      },
      update: {
        ...data,
        ...awarded,
        selfTotalScore,
        totalScore,
        grandTotal,
        status: data.status as SubmissionStatus,
        reviewedAt: new Date(),
      },
    });

    await tx.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: effectiveStatus },
    });

    // Entering the final-review layer: (re)set both assigned reviewers to pending.
    if (effectiveStatus === SubmissionStatus.FINAL_REVIEW) {
      await tx.finalReview.updateMany({
        where: { submissionId: sub.id },
        data: { decision: 'PENDING', comment: null, decidedAt: null },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: `REVIEW_${data.status}`,
        entityType: 'AppraisalSubmission',
        entityId: sub.id,
      },
    });
  });

  // Email faculty only on a FINAL decision. A HoD APPROVE that hands off to the
  // final-review layer (effectiveStatus FINAL_REVIEW) does not notify the faculty
  // yet — the 2 reviewers' verdict does.
  if (effectiveStatus === SubmissionStatus.APPROVED || effectiveStatus === SubmissionStatus.REJECTED) {
    try {
      const [reviewer, facultyUser, year] = await Promise.all([
        prisma.user.findUnique({ where: { id: req.user!.id } }),
        prisma.user.findUnique({ where: { id: sub.userId } }),
        prisma.academicYear.findUnique({ where: { id: sub.academicYearId } }),
      ]);
      await enqueueEmail({
        toUserId: sub.userId,
        template: data.status === 'APPROVED' ? 'submission_approved' : 'submission_rejected',
        payload: {
          name: facultyUser?.name ?? 'Faculty',
          year: year?.label ?? '',
          submissionNumber: sub.submissionNumber,
          submissionId: sub.id,
          reviewerName: reviewer?.name ?? 'Reviewer',
          reviewedAt: new Date().toLocaleString(),
          // The reviewer's awarded marks, not the self-computed ones — otherwise
          // the categories in the faculty's email would not add up to the grand
          // total whenever a category was overridden.
          cat1: awarded.cat1Score.toFixed(1),
          cat2: awarded.cat2Score.toFixed(1),
          cat3: awarded.cat3Score.toFixed(1),
          cat4: awarded.cat4Score.toFixed(1),
          cat5: awarded.cat5Score.toFixed(1),
          // Faculty see both totals out of 500 — what they claimed and what the
          // reviewer awarded. Category 6 and the /550 grand total are the
          // reviewer's own assessment and are deliberately not sent.
          selfTotal: selfTotalScore.toFixed(1),
          reviewedTotal: totalScore.toFixed(1),
          teachingComment: data.teachingComment ?? '',
          researchComment: data.researchComment ?? '',
          developmentComment: data.developmentComment ?? '',
          governanceComment: data.governanceComment ?? '',
          supplementaryComment: data.supplementaryComment ?? '',
          overallComment: data.overallComment ?? '',
        },
        // Keyed on the decision itself, not the clock. Re-approving a reopened
        // appraisal with the same outcome will not mail the faculty twice; a
        // corrected decision has a different grand total and does notify them,
        // which is the point of reopening. A `Date.now()` key made every send
        // unique and so disabled deduplication entirely.
        dedupeKey: `${data.status === 'APPROVED' ? 'approved' : 'rejected'}:${sub.id}:${grandTotal.toFixed(1)}`,
      });
    } catch (e) {
      console.error('[email] enqueue review decision failed:', e);
    }
  }

  return res.json({ message: `Submission ${effectiveStatus.toLowerCase().replace('_', ' ')}` });
}

export async function getReview(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { review: true, user: { select: { departmentId: true } } },
  });

  if (!sub) return res.status(404).json({ error: 'Not found' });

  // Object-level authorization — owner, principal/dean, or HoD/Reviewer of the
  // owner's department.
  if (!canViewUserResource(req.user!, sub.userId, sub.user.departmentId)) {
    // A dean-assigned scrutinizer signs off on this submission, so they may
    // read its review too — stripped, like every other non-department reader.
    // Same rule as appraisalController.getAppraisal.
    const assigned = await prisma.finalReview.findUnique({
      where: { submissionId_reviewerId: { submissionId: sub.id, reviewerId: req.user!.id } },
    });
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }

  // Ownership, not role — see utils/reviewVisibility.
  if (isOwnerView(req.user!, sub.userId)) {
    if (!sub.review) return res.json(null);
    if (!([SubmissionStatus.APPROVED, SubmissionStatus.REJECTED] as SubmissionStatus[]).includes(sub.status)) {
      return res.json({ status: sub.review.status, comments: null });
    }
    // The reviewer's marks for categories 1-5 and the resulting total out of
    // 500 are the faculty's own score; Category 6 and the /550 grand total are
    // the reviewer's assessment of them and are withheld.
    return res.json(stripReviewerAssessment(sub.review));
  }

  // Cat 6 and the /550 grand total belong to the principal and to the faculty's
  // own department reviewers. Every other legitimate reader — the dean, an
  // assigned scrutinizer — gets the same review out of 500.
  if (!canSeeReviewerAssessment(req.user!, sub.userId, sub.user.departmentId)) {
    return res.json(stripReviewerAssessment(sub.review));
  }

  return res.json(sub.review);
}

/**
 * Reopen for re-review — the dean or the principal (the CONFIG role set; the
 * admin is a maintenance account and holds no appraisal content since the
 * 2026-09-18 role rework).
 *
 * An approval is final for the reviewer — submitReview refuses a second one
 * ("Already approved") so marks cannot be quietly rewritten after the fact.
 * That leaves no way to correct a genuine mistake, so the dean can send the
 * submission back to SUBMITTED for the HoD to review again.
 *
 * Distinct from adminUnlock, which sends it to DRAFT for the FACULTY to edit.
 * This one never returns the form to the faculty and does not touch their data.
 * The existing review row is kept so the next reviewer can see the prior marks;
 * submitReview upserts over it.
 */
export async function adminReopenReview(req: Request, res: Response) {
  const parsed = z.object({ reason: z.string().trim().min(3) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'A reason is required to reopen a decided appraisal' });
  }

  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { departmentId: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  const reopenable: SubmissionStatus[] = [
    SubmissionStatus.APPROVED,
    SubmissionStatus.REJECTED,
    SubmissionStatus.FINAL_REVIEW,
  ];
  if (!reopenable.includes(sub.status)) {
    return res.status(400).json({ error: `Cannot reopen a submission that is ${sub.status}` });
  }

  await prisma.$transaction(async (tx) => {
    await tx.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: SubmissionStatus.SUBMITTED },
    });

    // Any final-review sign-offs applied to the old decision no longer hold.
    await tx.finalReview.updateMany({
      where: { submissionId: sub.id },
      data: { decision: 'PENDING', comment: null, decidedAt: null },
    });

    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'REVIEW_REOPENED',
        entityType: 'AppraisalSubmission',
        entityId: sub.id,
        metadata: { from: sub.status, reason: parsed.data.reason } as any,
      },
    });
  });

  return res.json({ message: 'Reopened for review', status: SubmissionStatus.SUBMITTED });
}

export async function adminUnlock(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { user: true, academicYear: true },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  await prisma.$transaction(async (tx) => {
    await tx.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: SubmissionStatus.DRAFT },
    });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'SUBMISSION_FORCE_UNLOCKED',
        entityType: 'AppraisalSubmission',
        entityId: sub.id,
      },
    });
  });

  try {
    await enqueueEmail({
      toUserId: sub.userId,
      template: 'submission_unlocked',
      payload: {
        name: sub.user.name,
        year: sub.academicYear.label,
        submissionNumber: sub.submissionNumber,
        submissionId: sub.id,
      },
      dedupeKey: unlockedKey(sub.id, sub.submittedAt),
    });
  } catch (e) {
    console.error('[email] enqueue unlock failed:', e);
  }

  return res.json({ message: 'Submission unlocked' });
}

export async function adminAssignReviewer(req: Request, res: Response) {
  const { reviewerId } = z.object({ reviewerId: z.string() }).parse(req.body);
  const sub = await prisma.appraisalSubmission.findUnique({ where: { id: req.params.id } });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  await prisma.appraisalSubmission.update({
    where: { id: sub.id },
    data: { status: SubmissionStatus.UNDER_REVIEW },
  });

  return res.json({ message: 'Reviewer assigned', reviewerId });
}
