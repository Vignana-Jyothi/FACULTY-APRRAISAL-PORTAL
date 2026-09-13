import { Request, Response } from 'express';
import { z } from 'zod';
import { RoleType, SubmissionStatus, FinalDecision } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { enqueueEmail } from '../services/emailService';
import { finalApprovedKey } from '../services/emailKeys';
import { computeScore } from '../services/scoringEngine';
import { FULL_INCLUDE } from './reviewController';
import { canViewUserResource } from '../utils/access';

// The review layer ABOVE the HoD. The admin/dean assigns any number of final
// reviewers to an annual appraisal, drawn from ANY department. After the HoD
// approves, ONE approval from any assigned reviewer finalises it; a REJECT sends
// it back (HOLD). A second opinion is allowed but never required.

function isAdmin(req: Request) {
  return req.user!.roles.some((r) => r.role === RoleType.ADMIN);
}

// POST /admin/appraisals/:id/final-reviewers  { reviewerIds: [...] }
// Any number of reviewers (at least one), from any department.
export async function assignFinalReviewers(req: Request, res: Response) {
  const parsed = z.object({
    reviewerIds: z.array(z.string().min(1)).min(1),
  }).parse(req.body);
  // Duplicates in the payload are harmless — collapse them.
  const reviewerIds = [...new Set(parsed.reviewerIds)];

  const sub = await prisma.appraisalSubmission.findUnique({ where: { id: req.params.id } });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  if (reviewerIds.includes(sub.userId)) {
    return res.status(400).json({ error: 'A faculty cannot be a reviewer of their own appraisal' });
  }
  const users = await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true } });
  if (users.length !== reviewerIds.length) return res.status(400).json({ error: 'One or more reviewers not found' });

  const rows = await prisma.$transaction(async (tx) => {
    await tx.finalReview.deleteMany({ where: { submissionId: sub.id } });
    const created = [];
    for (const reviewerId of reviewerIds) {
      created.push(await tx.finalReview.create({
        data: { submissionId: sub.id, reviewerId, assignedById: req.user!.id },
      }));
    }
    // If the HoD had already finalised (APPROVED) before assignment, hand it off
    // to the final-review layer now.
    if (sub.status === SubmissionStatus.APPROVED) {
      await tx.appraisalSubmission.update({ where: { id: sub.id }, data: { status: SubmissionStatus.FINAL_REVIEW } });
    }
    return created;
  });

  return res.status(201).json({ message: 'Final reviewers assigned', reviewers: rows });
}

// GET /appraisals/:id/final-reviews — the assignments + their decisions.
export async function getFinalReviews(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    select: { userId: true, user: { select: { departmentId: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  // Owner / admin / same-dept HoD or reviewer, or an assigned final reviewer.
  // Without this, any authenticated user could read who reviews whom and their
  // rejection comments for any submission id.
  if (!canViewUserResource(req.user!, sub.userId, sub.user.departmentId)) {
    const assigned = await prisma.finalReview.findUnique({
      where: { submissionId_reviewerId: { submissionId: req.params.id, reviewerId: req.user!.id } },
    });
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }

  const rows = await prisma.finalReview.findMany({
    where: { submissionId: req.params.id },
    include: { reviewer: { select: { id: true, name: true, employeeCode: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(rows);
}

// GET /final-reviews/pending — submissions assigned to the caller and awaiting
// their final-review decision.
export async function getPendingFinalReviews(req: Request, res: Response) {
  const rows = await prisma.finalReview.findMany({
    where: {
      reviewerId: req.user!.id,
      decision: FinalDecision.PENDING,
      submission: { status: SubmissionStatus.FINAL_REVIEW },
    },
    include: {
      submission: {
        select: {
          id: true, submissionNumber: true, status: true,
          user: { select: { name: true, employeeCode: true, department: { select: { name: true } } } },
          academicYear: { select: { label: true } },
          review: { select: { grandTotal: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(rows);
}

// POST /appraisals/:id/final-review  { decision: APPROVED|REJECTED, comment? }
export async function submitFinalReview(req: Request, res: Response) {
  const { decision, comment } = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().optional(),
  }).parse(req.body);

  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: { review: true, user: { select: { id: true, name: true } }, academicYear: { select: { label: true } } },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  // Only an assigned final reviewer (or admin) may act, and only in FINAL_REVIEW.
  const mine = await prisma.finalReview.findUnique({
    where: { submissionId_reviewerId: { submissionId: sub.id, reviewerId: req.user!.id } },
  });
  if (!mine && !isAdmin(req)) return res.status(403).json({ error: 'Not an assigned final reviewer' });
  if (!mine) return res.status(400).json({ error: 'Admins do not cast a final-review vote' });
  if (sub.status !== SubmissionStatus.FINAL_REVIEW) {
    return res.status(400).json({ error: 'Submission is not awaiting final review' });
  }
  if (decision === 'REJECTED' && !comment?.trim()) {
    return res.status(400).json({ error: 'A comment is required to reject' });
  }

  await prisma.finalReview.update({
    where: { id: mine.id },
    data: { decision: decision as FinalDecision, comment: comment ?? null, decidedAt: new Date() },
  });

  // One review is enough: a single approval from any assigned reviewer finalises
  // the appraisal, and a single rejection sends it back. Reviewers who have not
  // acted are simply left pending — their opinion is not required.
  const all = await prisma.finalReview.findMany({ where: { submissionId: sub.id } });
  const anyRejected = all.some((r) => r.decision === FinalDecision.REJECTED);
  const anyApproved = all.some((r) => r.decision === FinalDecision.APPROVED);

  let outcome: 'HOLD' | 'APPROVED' | 'PENDING' = 'PENDING';
  if (anyRejected) {
    const reason = all.find((r) => r.decision === FinalDecision.REJECTED)?.comment ?? 'Rejected in final review';
    await prisma.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: SubmissionStatus.HOLD, holdReason: reason, heldAt: new Date() },
    });
    outcome = 'HOLD';
  } else if (anyApproved) {
    await prisma.appraisalSubmission.update({ where: { id: sub.id }, data: { status: SubmissionStatus.APPROVED } });
    outcome = 'APPROVED';
    // Notify the faculty of final approval.
    try {
      const rv = sub.review;
      // Prefer the self total frozen at review time. Only fall back to
      // recomputing for rows written before that field existed.
      let selfTotal: number | null = rv?.selfTotalScore ?? null;
      if (selfTotal == null) {
        const full = await prisma.appraisalSubmission.findUnique({
          where: { id: sub.id },
          include: FULL_INCLUDE,
        });
        selfTotal = full ? computeScore(full as any).selfTotal : null;
      }
      await enqueueEmail({
        toUserId: sub.userId,
        template: 'submission_approved',
        payload: {
          name: sub.user.name, year: sub.academicYear.label, submissionNumber: sub.submissionNumber, submissionId: sub.id,
          reviewerName: 'Final Review Panel', reviewedAt: new Date().toLocaleString(),
          cat1: (rv?.cat1Score ?? 0).toFixed(1), cat2: (rv?.cat2Score ?? 0).toFixed(1), cat3: (rv?.cat3Score ?? 0).toFixed(1),
          cat4: (rv?.cat4Score ?? 0).toFixed(1), cat5: (rv?.cat5Score ?? 0).toFixed(1),
          // Out of 500 only — Cat 6 and the grand total are not the faculty's to see.
          selfTotal: selfTotal != null ? selfTotal.toFixed(1) : undefined,
          reviewedTotal: (rv?.totalScore ?? 0).toFixed(1),
          teachingComment: '', researchComment: '', developmentComment: '', governanceComment: '', supplementaryComment: '',
          overallComment: rv?.overallComment ?? '',
        },
        dedupeKey: finalApprovedKey(sub.id, rv?.reviewedAt),
      });
    } catch (e) {
      console.error('[email] enqueue final approval failed:', e);
    }
  }

  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: `FINAL_REVIEW_${decision}`, entityType: 'AppraisalSubmission', entityId: sub.id },
  });

  return res.json({ message: `Final review recorded — ${decision.toLowerCase()}`, outcome });
}
