import { Request, Response } from 'express';
import { z } from 'zod';
import { RoleType, SubmissionStatus } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { DEPT_REVIEW, INSTITUTE_READ, SEES_ALL, deptIdsFor, hasAnyRole } from '../utils/roles';
import { canSeeReviewerAssessment, stripReviewerAssessment } from '../utils/reviewVisibility';
import { enumerateProofs, PROOF_INCLUDE } from '../services/proofService';
import { CATEGORY_MAX } from './reviewController';

/**
 * The HoD's provisional marks on a DRAFT appraisal (owner decision 2026-09-19).
 *
 * The draft carries across the year and cannot be submitted until the Q4 review
 * window ends. Meanwhile the HoD of the faculty's department may note Cat 1-5
 * overrides, Cat 6 and a comment here. They pre-fill the one real HoD review
 * after submission, where they become final — nothing is copied automatically.
 *
 * Never shown to the owner: it is provisional. Cat 6 follows the same gate as
 * the real review (utils/reviewVisibility), so the dean reads it without Cat 6.
 */

const num = z.number().finite().nullable().optional();
const draftReviewSchema = z.object({
  cat1Score: num,
  cat2Score: num,
  cat3Score: num,
  cat4Score: num,
  cat5Score: num,
  cat6Punctuality: num,
  cat6Professionalism: num,
  cat6Willingness: num,
  cat6Cordiality: num,
  cat6Classroom: num,
  overallComment: z.string().max(5000).nullable().optional(),
});

const clamp = (v: number | null | undefined, max: number) =>
  v == null ? null : Math.min(Math.max(v, 0), max);

/** HoD of the owner's department — and not the owner. */
function isOwnersHod(user: NonNullable<Request['user']>, ownerId: string, ownerDept: string | null): boolean {
  if (user.id === ownerId) return false;
  return user.roles.some((r) => r.role === RoleType.HOD && r.departmentId != null && r.departmentId === ownerDept);
}

async function loadSubmission(id: string) {
  return prisma.appraisalSubmission.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, user: { select: { departmentId: true } }, draftReview: true },
  });
}

// GET /appraisals/:id/draft-review — the HoD/incharge of the owner's
// department and the principal read it whole; the dean without Cat 6; the owner
// and everyone else get 403. Readable whatever the status, so the final review
// can seed from it after submission. `null` when none was written.
export async function getDraftReview(req: Request, res: Response) {
  const sub = await loadSubmission(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  const user = req.user!;
  const ownerDept = sub.user.departmentId ?? null;

  if (user.id === sub.userId) return res.status(403).json({ error: 'Forbidden' });
  if (canSeeReviewerAssessment(user, sub.userId, ownerDept)) {
    return res.json(sub.draftReview ?? null);
  }
  if (hasAnyRole(user, INSTITUTE_READ)) {
    return res.json(sub.draftReview ? stripReviewerAssessment(sub.draftReview) : null);
  }
  return res.status(403).json({ error: 'Forbidden' });
}

// PUT /appraisals/:id/draft-review — the HoD of the owner's department only,
// only while the appraisal is a DRAFT, never on their own.
export async function putDraftReview(req: Request, res: Response) {
  const sub = await loadSubmission(req.params.id);
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (!isOwnersHod(req.user!, sub.userId, sub.user.departmentId ?? null)) {
    return res.status(403).json({ error: "Only the HoD of the faculty's department can write a draft review" });
  }
  if (sub.status !== SubmissionStatus.DRAFT) {
    return res.status(400).json({
      error: `A draft review can only be written while the appraisal is a draft — this one is ${sub.status}. Use the review page.`,
    });
  }

  const parsed = draftReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid draft review', details: parsed.error.issues });
  const d = parsed.data;

  const data = {
    cat1Score: clamp(d.cat1Score, CATEGORY_MAX.cat1),
    cat2Score: clamp(d.cat2Score, CATEGORY_MAX.cat2),
    cat3Score: clamp(d.cat3Score, CATEGORY_MAX.cat3),
    cat4Score: clamp(d.cat4Score, CATEGORY_MAX.cat4),
    cat5Score: clamp(d.cat5Score, CATEGORY_MAX.cat5),
    cat6Punctuality: clamp(d.cat6Punctuality, 10),
    cat6Professionalism: clamp(d.cat6Professionalism, 10),
    cat6Willingness: clamp(d.cat6Willingness, 10),
    cat6Cordiality: clamp(d.cat6Cordiality, 10),
    cat6Classroom: clamp(d.cat6Classroom, 10),
    overallComment: d.overallComment?.trim() ? d.overallComment.trim() : null,
    reviewerId: req.user!.id,
  };

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.draftReview.upsert({
      where: { submissionId: sub.id },
      create: { submissionId: sub.id, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'DRAFT_REVIEW_SAVED',
        entityType: 'AppraisalSubmission',
        entityId: sub.id,
      },
    });
    return row;
  });

  return res.json(saved);
}

// GET /reviews/drafts — drafts in progress the caller may check proofs on: the
// HoD/incharge's own department(s), institute-wide for the principal. Their
// own draft is left out. Proof counts are derived like /proofs/overview —
// without syncing (that writes, once per draft) — so an unreconciled proof
// simply counts as pending, which is what it is.
export async function listDrafts(req: Request, res: Response) {
  const user = req.user!;
  const seesAll = hasAnyRole(user, SEES_ALL);
  const deptIds = deptIdsFor(user, DEPT_REVIEW);

  const drafts = await prisma.appraisalSubmission.findMany({
    where: {
      status: SubmissionStatus.DRAFT,
      userId: { not: user.id },
      ...(seesAll ? {} : { user: { departmentId: { in: deptIds } } }),
    },
    include: {
      ...PROOF_INCLUDE,
      user: { select: { id: true, name: true, employeeCode: true, department: { select: { name: true, code: true } } } },
      academicYear: { select: { id: true, label: true } },
      draftReview: { select: { updatedAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const verifications = await prisma.proofVerification.findMany({
    where: { submissionId: { in: drafts.map((d) => d.id) } },
    select: { submissionId: true, url: true, status: true },
  });
  const statusByKey = new Map(verifications.map((v) => [`${v.submissionId}::${v.url}`, v.status]));

  const rows = drafts.map((sub) => {
    const items = enumerateProofs(sub);
    let verified = 0, rejected = 0, pending = 0;
    for (const it of items) {
      const st = statusByKey.get(`${sub.id}::${it.url}`);
      if (st === 'VERIFIED') verified++;
      else if (st === 'REJECTED') rejected++;
      else pending++;
    }
    return {
      submissionId: sub.id,
      submissionNumber: sub.submissionNumber,
      updatedAt: sub.updatedAt,
      academicYear: sub.academicYear,
      faculty: sub.user,
      draftReviewedAt: sub.draftReview?.updatedAt ?? null,
      counts: { total: items.length, verified, rejected, pending },
    };
  });

  return res.json(rows);
}
