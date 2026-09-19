import { Request, Response } from 'express';
import { FinalDecision, SubmissionStatus } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { loadTrackingContext } from '../services/trackingService';
import { seesReviewerAssessmentEverywhere } from '../utils/reviewVisibility';

const round1 = (n: number | null | undefined) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);

// GET /oversight/summary?academicYearId=   (CONFIG: dean + principal)
//
// One institute-wide status board for the two roles that oversee the cycle:
// where submissions stand, which scrutinizer sign-offs are outstanding, how far
// tier/eligibility allocation has got, and how many faculty are red-listed.
//
// The average score is the one figure that differs by reader. Category 6 and
// the /550 grand total are the reviewer's assessment of the person, and only
// the principal sees them institute-wide; the dean gets the reviewed /500. The
// decision is `seesReviewerAssessmentEverywhere`, never a role check here, and
// the dean's payload carries no /550 figure at all — not even a null.
export async function getOversightSummary(req: Request, res: Response) {
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const year = academicYearId
    ? await prisma.academicYear.findUnique({ where: { id: academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const showGrand = seesReviewerAssessmentEverywhere(req.user!);

  const [statusGroups, pendingFinal, submitters, ctx, redListed, avg] = await Promise.all([
    prisma.appraisalSubmission.groupBy({
      by: ['status'],
      where: { academicYearId: year.id },
      _count: { _all: true },
    }),
    prisma.finalReview.findMany({
      where: {
        decision: FinalDecision.PENDING,
        submission: { academicYearId: year.id, status: SubmissionStatus.FINAL_REVIEW },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        reviewer: { select: { id: true, name: true, employeeCode: true } },
        submission: {
          select: {
            id: true,
            submissionNumber: true,
            status: true,
            submittedAt: true,
            user: {
              select: {
                id: true, name: true, employeeCode: true,
                department: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
    }),
    // Everyone with a submission this year: the population tier and
    // eligibility are allocated over (the same set /tracking lists).
    prisma.appraisalSubmission.findMany({
      where: { academicYearId: year.id },
      distinct: ['userId'],
      select: { userId: true },
    }),
    loadTrackingContext(year.id),
    prisma.appraisalSubmission.count({ where: { academicYearId: year.id, redListed: true } }),
    prisma.appraisalReview.aggregate({
      where: {
        submission: { academicYearId: year.id },
        ...(showGrand ? { grandTotal: { not: null } } : { totalScore: { not: null } }),
      },
      _avg: showGrand ? { grandTotal: true } : { totalScore: true },
      _count: { _all: true },
    }),
  ]);

  const byStatus = Object.fromEntries(Object.values(SubmissionStatus).map((s) => [s, 0])) as Record<SubmissionStatus, number>;
  for (const g of statusGroups) byStatus[g.status] = g._count._all;
  const totalSubmissions = statusGroups.reduce((n, g) => n + g._count._all, 0);

  const userIds = submitters.map((s) => s.userId);
  const tierDecided = userIds.filter((id) => ctx.manualTiers.has(id)).length;
  const eligibilityDecided = userIds.filter((id) => ctx.manualEligible.has(id)).length;
  const eligible = userIds.filter((id) => ctx.manualEligible.get(id) === true).length;

  const avgValue = showGrand
    ? (avg._avg as { grandTotal?: number | null }).grandTotal
    : (avg._avg as { totalScore?: number | null }).totalScore;

  return res.json({
    year: { id: year.id, label: year.label, submissionOpen: year.submissionOpen },
    submissions: { total: totalSubmissions, byStatus },
    finalReviews: {
      pendingCount: pendingFinal.length,
      pendingSubmissions: new Set(pendingFinal.map((f) => f.submission.id)).size,
      pending: pendingFinal.map((f) => ({
        id: f.id,
        assignedAt: f.createdAt,
        submission: {
          id: f.submission.id,
          submissionNumber: f.submission.submissionNumber,
          status: f.submission.status,
          submittedAt: f.submission.submittedAt,
        },
        faculty: {
          id: f.submission.user.id,
          name: f.submission.user.name,
          employeeCode: f.submission.user.employeeCode,
          department: f.submission.user.department,
        },
        scrutinizer: f.reviewer,
      })),
    },
    allocation: {
      faculty: userIds.length,
      tier: { decided: tierDecided, undecided: userIds.length - tierDecided },
      eligibility: { decided: eligibilityDecided, undecided: userIds.length - eligibilityDecided, eligible },
    },
    redListed,
    averageScore: {
      outOf: showGrand ? 550 : 500,
      value: round1(avgValue),
      reviewed: avg._count._all,
    },
  });
}
