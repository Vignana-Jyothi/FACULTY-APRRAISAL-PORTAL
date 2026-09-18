import { Request, Response } from 'express';
import { z } from 'zod';
import { SubmissionStatus } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { computeScore } from '../services/scoringEngine';
import { enqueueEmail } from '../services/emailService';
import {
  serializeSubmissionForFaculty,
  serializeSubmissionForReviewer,
  serializeSubmissionStripped,
} from '../utils/serializers';
import { canViewUserResource } from '../utils/access';
import { isOwnerView, stripReviewerAssessment, canSeeReviewerAssessment } from '../utils/reviewVisibility';
import { DEPT_REVIEW, INSTITUTE_READ, SCRUTINY_POOL, deptIdsFor, hasAnyRole } from '../utils/roles';
import { dropBlankRows } from '../utils/blankRows';
import { normalizePublicationAuthors } from '../utils/publicationAuthors';

const FULL_INCLUDE = {
  cat1Courses: true,
  cat1CourseResults: true,
  cat1Projects: true,
  cat1EContent: true,
  cat1ICT: true,
  cat2Journals: true,
  cat2Conferences: true,
  cat2ConfBookChapters: true,
  cat2BookChapters: true,
  cat2Books: true,
  cat2Citations: true,
  cat2Patents: true,
  cat2Projects: true,
  cat2Consultancy: true,
  cat2Guidance: true,
  cat2ResearchGroups: true,
  cat2Linkages: true,
  cat2Startups: true,
  cat2IndustryLinkages: true,
  cat3AdvQual: true,
  cat3Organised: true,
  cat3ConferencesAttended: true,
  cat3ResourcePerson: true,
  cat3Editorial: true,
  cat3Training: true,
  cat3IntlTravel: true,
  cat4AdminResp: true,
  cat4StudentAct: true,
  cat5Memberships: true,
  cat5Awards: true,
  cat5Differentiators: true,
  cat5Internships: true,
  review: true,
  user: { select: { id: true, name: true, employeeCode: true, departmentId: true } },
  academicYear: { select: { id: true, label: true } },
};

// Convert empty strings to null for date fields, otherwise pass through.
// Date fields (LLD): dateOfPub, dateOfGrant, dateOfApplication, dateOfFiling
export const DATE_KEYS = new Set(['dateOfPub', 'dateOfGrant', 'dateOfApplication', 'dateOfFiling']);
// Proof/file keys where an empty string means "no file" and must store as null
// (indexProofFile is the 2nd proof on Cat2Journal, sibling to proofFile).
const NULLABLE_FILE_KEYS = new Set(['evidenceFile', 'proofFile', 'indexProofFile']);
export function cleanRow(row: any) {
  const out: any = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (DATE_KEYS.has(k)) {
      out[k] = v === '' || v == null ? null : new Date(v);
    } else if (typeof v === 'string' && v === '' && (k.endsWith('Id') || NULLABLE_FILE_KEYS.has(k))) {
      out[k] = null;
    } else if (k === 'scope' && v === '') {
      // 2.3: "no publisher level chosen" is null — '' is not a Scope value.
      out[k] = null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function serializeByRole(req: Request, sub: any) {
  const review = sub.review || null;
  // Ownership first: a HoD or incharge looking at their OWN appraisal is the
  // faculty here, whatever roles they hold elsewhere (utils/reviewVisibility).
  if (isOwnerView(req.user!, sub.userId)) return serializeSubmissionForFaculty(sub, review);
  // Cat 6 + /550 go to the principal and to the faculty's own department
  // reviewers. Dean, scrutinizers and admin get the same appraisal out of 500.
  if (canSeeReviewerAssessment(req.user!, sub.userId, sub.user?.departmentId ?? null)) {
    return serializeSubmissionForReviewer(sub, review);
  }
  return serializeSubmissionStripped(sub, review);
}

export async function listAppraisals(req: Request, res: Response) {
  const { year, status, dept, userId, limit, offset } = req.query;
  const user = req.user!;

  let whereClause: any = {};
  if (year) whereClause.academicYearId = year;
  if (status) {
    // Reject an unknown status instead of passing it to Prisma (which throws a
    // 500). Only the SubmissionStatus enum values are valid filters.
    if (!Object.values(SubmissionStatus).includes(status as SubmissionStatus)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    whereClause.status = status;
  }

  if (hasAnyRole(user, INSTITUTE_READ)) {
    // Principal and dean: institute-wide, with the optional filters.
    if (dept) whereClause.user = { departmentId: dept };
    if (userId) whereClause.userId = userId;
  } else if (hasAnyRole(user, SCRUTINY_POOL)) {
    // A scrutinizer's cross-department reach is per submission: only the ones
    // the dean assigned them to, plus their own.
    whereClause.OR = [
      { finalReviews: { some: { reviewerId: user.id } } },
      { userId: user.id },
    ];
  } else if (hasAnyRole(user, DEPT_REVIEW)) {
    whereClause.user = { departmentId: { in: deptIdsFor(user) } };
  } else {
    whereClause.userId = user.id;
  }

  // Pagination — when limit query present, return { rows, total }
  if (limit !== undefined) {
    const take = Math.min(Number(limit), 200);
    const skip = Number(offset ?? 0);
    const [subs, total] = await Promise.all([
      prisma.appraisalSubmission.findMany({
        where: whereClause,
        include: FULL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.appraisalSubmission.count({ where: whereClause }),
    ]);
    return res.json({
      rows: subs.map((s) => serializeByRole(req, s)),
      total,
      limit: take,
      offset: skip,
    });
  }

  const subs = await prisma.appraisalSubmission.findMany({
    where: whereClause,
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return res.json(subs.map((s) => serializeByRole(req, s)));
}

export async function createAppraisal(req: Request, res: Response) {
  const { academicYearId } = z.object({ academicYearId: z.string() }).parse(req.body);
  const userId = req.user!.id;

  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year || !year.submissionOpen) {
    return res.status(400).json({ error: 'Submission window is closed' });
  }

  // One appraisal per faculty per year. A faculty may only start a new one when
  // they have none active — the sole exception is a REJECTED submission, which
  // they correct and resubmit as a fresh draft.
  const active = await prisma.appraisalSubmission.findFirst({
    where: { userId, academicYearId, status: { not: SubmissionStatus.REJECTED } },
  });
  if (active) {
    return res.status(400).json({ error: 'You already have an appraisal for this year' });
  }

  const count = await prisma.appraisalSubmission.count({
    where: { userId, academicYearId },
  });

  if (count >= year.maxSubmissions) {
    return res.status(400).json({ error: `Maximum ${year.maxSubmissions} submissions per year reached` });
  }

  const sub = await prisma.$transaction(async (tx) => {
    const newSub = await tx.appraisalSubmission.create({
      data: { userId, academicYearId, submissionNumber: count + 1, status: SubmissionStatus.DRAFT },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'SUBMISSION_CREATED',
        entityType: 'AppraisalSubmission',
        entityId: newSub.id,
      },
    });

    return newSub;
  });

  return res.status(201).json(sub);
}

export async function getAppraisal(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: FULL_INCLUDE,
  });

  if (!sub) return res.status(404).json({ error: 'Not found' });

  if (!canViewUserResource(req.user!, sub.userId, (sub.user as any)?.departmentId ?? null)) {
    // A dean-assigned final reviewer may view the appraisal they must sign off,
    // even if they aren't the owner / an HoD / a dept reviewer.
    const assigned = await prisma.finalReview.findUnique({
      where: { submissionId_reviewerId: { submissionId: sub.id, reviewerId: req.user!.id } },
    });
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }

  return res.json(serializeByRole(req, sub));
}

export async function updateAppraisal(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
  });

  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (sub.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  if (sub.status !== SubmissionStatus.DRAFT) {
    return res.status(400).json({ error: 'Only DRAFT submissions can be edited' });
  }

  const { categories, leaveData } = req.body;
  dropBlankRows(categories); // discard blank auto-added form rows before persisting
  // 2.1 author lists: tidy them, and refuse a paper claimed by another co-author.
  const claimError = normalizePublicationAuthors(categories);
  if (claimError) return res.status(400).json({ error: claimError });

  await prisma.$transaction(async (tx) => {
    if (leaveData) {
      await tx.appraisalSubmission.update({
        where: { id: sub.id },
        data: leaveData,
      });
    }

    if (categories?.cat1Courses) {
      await tx.cat1Course.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat1Course.createMany({ data: categories.cat1Courses.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat1CourseResults) {
      await tx.cat1CourseResults.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat1CourseResults.createMany({ data: categories.cat1CourseResults.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat1Projects) {
      await tx.cat1Project.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat1Project.createMany({ data: categories.cat1Projects.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat1EContent) {
      await tx.cat1EContent.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat1EContent.createMany({ data: categories.cat1EContent.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat1ICT) {
      await tx.cat1ICT.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat1ICT.createMany({ data: categories.cat1ICT.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Journals) {
      await tx.cat2Journal.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Journal.createMany({ data: categories.cat2Journals.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Conferences) {
      await tx.cat2Conference.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Conference.createMany({ data: categories.cat2Conferences.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2ConfBookChapters) {
      await tx.cat2ConfBookChapter.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2ConfBookChapter.createMany({ data: categories.cat2ConfBookChapters.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2BookChapters) {
      await tx.cat2BookChapter.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2BookChapter.createMany({ data: categories.cat2BookChapters.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Books) {
      await tx.cat2Book.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Book.createMany({ data: categories.cat2Books.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Citations) {
      await tx.cat2Citations.upsert({
        where: { submissionId: sub.id },
        create: { ...categories.cat2Citations, submissionId: sub.id },
        update: categories.cat2Citations,
      });
    }
    if (categories?.cat2Patents) {
      await tx.cat2Patent.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Patent.createMany({ data: categories.cat2Patents.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Projects) {
      await tx.cat2Project.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Project.createMany({ data: categories.cat2Projects.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Consultancy) {
      await tx.cat2Consultancy.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Consultancy.createMany({ data: categories.cat2Consultancy.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Guidance) {
      await tx.cat2Guidance.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Guidance.createMany({ data: categories.cat2Guidance.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2ResearchGroups) {
      await tx.cat2ResearchGroup.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2ResearchGroup.createMany({ data: categories.cat2ResearchGroups.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Linkages) {
      await tx.cat2Linkage.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Linkage.createMany({ data: categories.cat2Linkages.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2Startups) {
      await tx.cat2Startup.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2Startup.createMany({ data: categories.cat2Startups.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat2IndustryLinkages) {
      await tx.cat2IndustryLinkage.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat2IndustryLinkage.createMany({ data: categories.cat2IndustryLinkages.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat3AdvQual) {
      await tx.cat3AdvQual.upsert({
        where: { submissionId: sub.id },
        create: { ...categories.cat3AdvQual, submissionId: sub.id },
        update: categories.cat3AdvQual,
      });
    }
    if (categories?.cat3Organised) {
      await tx.cat3OrganisedProgram.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat3OrganisedProgram.createMany({ data: categories.cat3Organised.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat3ConferencesAttended) {
      await tx.cat3ConferenceAttended.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat3ConferenceAttended.createMany({ data: categories.cat3ConferencesAttended.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat3ResourcePerson) {
      await tx.cat3ResourcePerson.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat3ResourcePerson.createMany({ data: categories.cat3ResourcePerson.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat3Editorial) {
      await tx.cat3Editorial.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat3Editorial.createMany({ data: categories.cat3Editorial.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat3Training) {
      await tx.cat3Training.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat3Training.createMany({ data: categories.cat3Training.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat3IntlTravel) {
      await tx.cat3IntlTravel.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat3IntlTravel.createMany({ data: categories.cat3IntlTravel.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat4AdminResp) {
      await tx.cat4AdminResp.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat4AdminResp.createMany({ data: categories.cat4AdminResp.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat4StudentAct) {
      await tx.cat4StudentActivity.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat4StudentActivity.createMany({ data: categories.cat4StudentAct.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat5Memberships) {
      await tx.cat5Membership.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat5Membership.createMany({ data: categories.cat5Memberships.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat5Awards) {
      await tx.cat5Award.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat5Award.createMany({ data: categories.cat5Awards.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat5Differentiators) {
      await tx.cat5Differentiator.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat5Differentiator.createMany({ data: categories.cat5Differentiators.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
    if (categories?.cat5Internships) {
      await tx.cat5Internship.deleteMany({ where: { submissionId: sub.id } });
      await tx.cat5Internship.createMany({ data: categories.cat5Internships.map((c: any) => ({ ...cleanRow(c), submissionId: sub.id })) });
    }
  });

  const updated = await prisma.appraisalSubmission.findUnique({ where: { id: sub.id }, include: FULL_INCLUDE });
  return res.json(updated);
}

export async function submitAppraisal(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: FULL_INCLUDE,
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (sub.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  if (sub.status !== SubmissionStatus.DRAFT) {
    return res.status(400).json({ error: 'Only DRAFT submissions can be submitted' });
  }

  const year = await prisma.academicYear.findUnique({ where: { id: sub.academicYearId } });
  if (!year?.submissionOpen) return res.status(400).json({ error: 'Submission window is closed' });

  const submittedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: SubmissionStatus.SUBMITTED, submittedAt },
    });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'SUBMISSION_SUBMITTED',
        entityType: 'AppraisalSubmission',
        entityId: sub.id,
      },
    });
  });

  // Fire-and-forget email
  try {
    const score = computeScore(sub as any);
    const user = await prisma.user.findUnique({ where: { id: sub.userId } });
    await enqueueEmail({
      toUserId: sub.userId,
      template: 'submission_received',
      payload: {
        name: user?.name ?? 'Faculty',
        year: year?.label ?? '',
        submissionNumber: sub.submissionNumber,
        submissionId: sub.id,
        submittedAt: submittedAt.toLocaleString(),
        cat1: score.cat1.total.toFixed(1),
        cat2: score.cat2.total.toFixed(1),
        cat3: score.cat3.total.toFixed(1),
        cat4: score.cat4.total.toFixed(1),
        cat5: score.cat5.total.toFixed(1),
        selfTotal: score.selfTotal.toFixed(1),
      },
      dedupeKey: `submission_received:${sub.id}`,
    });
  } catch (e) {
    console.error('[email] enqueue submission_received failed:', e);
  }

  return res.json({ message: 'Submitted successfully' });
}

export async function withdrawAppraisal(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({ where: { id: req.params.id } });
  if (!sub) return res.status(404).json({ error: 'Not found' });
  if (sub.userId !== req.user!.id) return res.status(403).json({ error: 'Forbidden' });
  if (sub.status !== SubmissionStatus.SUBMITTED) {
    return res.status(400).json({ error: 'Can only withdraw SUBMITTED submissions' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.appraisalSubmission.update({
      where: { id: sub.id },
      data: { status: SubmissionStatus.WITHDRAWN, withdrawnAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'SUBMISSION_WITHDRAWN',
        entityType: 'AppraisalSubmission',
        entityId: sub.id,
      },
    });
  });

  return res.json({ message: 'Withdrawn successfully' });
}

export async function getScore(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: FULL_INCLUDE,
  });

  if (!sub) return res.status(404).json({ error: 'Not found' });

  if (!canViewUserResource(req.user!, sub.userId, (sub.user as any)?.departmentId ?? null)) {
    // A dean-assigned scrutinizer must be able to score the submission in their
    // queue, so the same per-submission assignment that opens getAppraisal and
    // downloadAppraisalPdf opens this. Assignment only — an unassigned
    // scrutinizer still gets 403. The breakdown is Cat 1-5 / 500 and carries no
    // Cat 6 or grand total, so nothing further needs stripping here.
    const assigned = await prisma.finalReview.findUnique({
      where: { submissionId_reviewerId: { submissionId: sub.id, reviewerId: req.user!.id } },
    });
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }

  const score = computeScore(sub as any);
  return res.json(score);
}

export async function downloadAppraisalPdf(req: Request, res: Response) {
  const sub = await prisma.appraisalSubmission.findUnique({
    where: { id: req.params.id },
    include: {
      ...FULL_INCLUDE,
      user: { include: { department: true } },
      academicYear: true,
      review: true,
    },
  });
  if (!sub) return res.status(404).json({ error: 'Not found' });

  if (!canViewUserResource(req.user!, sub.userId, (sub.user as any)?.departmentId ?? null)) {
    // A dean-assigned scrutinizer signs off on this submission, so they may
    // download it too — stripped of Category 6 and the /550 like every other
    // reader outside the faculty's own department. Same rule as getAppraisal.
    const assigned = await prisma.finalReview.findUnique({
      where: { submissionId_reviewerId: { submissionId: sub.id, reviewerId: req.user!.id } },
    });
    if (!assigned) return res.status(403).json({ error: 'Forbidden' });
  }

  const score = computeScore(sub as any);

  // The faculty's own copy shows the reviewer's marks only once the appraisal
  // is decided, and never Category 6 or the /550 grand total — those are the
  // reviewer's assessment of them. Keyed on ownership, so a HoD or incharge
  // downloading their own appraisal gets the same document a faculty does.
  let review: any = sub.review;
  if (isOwnerView(req.user!, sub.userId)) {
    const decided = ([SubmissionStatus.APPROVED, SubmissionStatus.REJECTED] as SubmissionStatus[]).includes(sub.status);
    review = decided ? stripReviewerAssessment(review) : null;
  } else if (!canSeeReviewerAssessment(req.user!, sub.userId, (sub.user as any)?.departmentId ?? null)) {
    // Dean / scrutinizer / admin copy: the same document out of 500, with
    // Category 6 and the grand total left off (utils/reviewVisibility).
    review = stripReviewerAssessment(review);
  }

  const { renderAppraisalHtml, renderHtmlToPdf } = await import('../services/pdfService');
  const html = renderAppraisalHtml(sub, score, review);
  const pdf = await renderHtmlToPdf(html);

  const yearLabel = (sub.academicYear as any)?.label ?? 'appraisal';
  const code = (sub.user as any)?.employeeCode ?? sub.userId;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=appraisal-${code}-${yearLabel}.pdf`);
  return res.send(pdf);
}

