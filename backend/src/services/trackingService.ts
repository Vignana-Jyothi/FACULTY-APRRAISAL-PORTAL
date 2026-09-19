import { Tier } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { computeActuals } from './trackingEngine';
import { deriveCadre, computeExperienceYears, pickCadreTarget, checkEligibility, CADRE_LABEL } from './cadreEngine';

// Shared per-faculty tracking computation, used by the tracking view
// (trackingController) and the quarterly scheduler.

export const TRACKING_INCLUDE = {
  cat1Courses: true, cat1CourseResults: true, cat1Projects: true, cat1EContent: true, cat1ICT: true,
  cat2Journals: true, cat2Conferences: true, cat2ConfBookChapters: true, cat2BookChapters: true, cat2Books: true,
  cat2Citations: true, cat2Patents: true, cat2Projects: true, cat2Consultancy: true,
  cat2Guidance: true, cat2ResearchGroups: true, cat2Linkages: true, cat2Startups: true, cat2IndustryLinkages: true,
  cat3AdvQual: true, cat3Organised: true, cat3ConferencesAttended: true, cat3ResourcePerson: true, cat3Editorial: true,
  cat3Training: true, cat3IntlTravel: true, cat4AdminResp: true, cat4StudentAct: true,
  cat5Memberships: true, cat5Awards: true, cat5Differentiators: true, cat5Internships: true,
  review: true,
  user: { select: { id: true, name: true, employeeCode: true, designation: true, dateOfJoining: true, departmentId: true, department: { select: { name: true, code: true } } } },
} as const;

export interface TrackingContext {
  cadreTargets: any[];
  // Manual per-faculty decisions for the AY, keyed by userId. Both the tier and
  // the eligibility call are made by the admin/dean by hand — nothing here is
  // auto-computed. Absent from the map = not yet decided.
  manualTiers: Map<string, Tier>;
  manualEligible: Map<string, boolean>;
  hasTargets: boolean;
}

export async function loadTrackingContext(academicYearId: string): Promise<TrackingContext> {
  const [cadreTargets, facultyTiers] = await Promise.all([
    prisma.cadreTarget.findMany({ where: { academicYearId } }),
    prisma.facultyTier.findMany({ where: { academicYearId } }),
  ]);

  const manualTiers = new Map<string, Tier>();
  const manualEligible = new Map<string, boolean>();
  for (const ft of facultyTiers) {
    if (ft.tier) manualTiers.set(ft.userId, ft.tier);
    if (ft.eligible != null) manualEligible.set(ft.userId, ft.eligible);
  }

  return {
    cadreTargets,
    manualTiers,
    manualEligible,
    hasTargets: cadreTargets.length > 0,
  };
}

/**
 * Per-row decision: may the caller see the reviewer's assessment (Cat 6 and the
 * /550) of THIS row's owner? Decided per row, never once per request — a HoD is
 * entitled to the /550 of the faculty in their department but not to the one
 * recorded against themselves. Callers build this from
 * `utils/reviewVisibility.canSeeReviewerAssessment`, which is the one gate.
 * Omitted = nobody is looking (the cron), so nothing is masked.
 */
export type AssessmentVisibility = (ownerId: string, ownerDepartmentId: string | null) => boolean;

const SEES_EVERYTHING: AssessmentVisibility = () => true;

// Compute one faculty's tracking row from a submission (loaded with
// TRACKING_INCLUDE) and the AY context. `yearStart` is the experience reference.
export function computeRow(
  sub: any,
  ctx: TrackingContext,
  yearStart: Date,
  canSeeAssessment: AssessmentVisibility = SEES_EVERYTHING,
) {
  const u = sub.user;
  const expYears = computeExperienceYears(u.dateOfJoining, yearStart);
  const cadre = deriveCadre(u.designation);
  const actuals = computeActuals(sub, sub.review?.grandTotal ?? null);
  const target = cadre ? pickCadreTarget(ctx.cadreTargets, cadre, expYears) : null;
  // Eligibility is always decided on the full grand total, so the verdict does
  // not change with who is looking. Only the number shown is masked: a reader
  // who may not see Cat 6 for THIS faculty (the dean, a special scrutinizer, or
  // an owner reading back their own row) gets the reviewed /500 instead of the
  // /550. `utils/reviewVisibility` is the rule, passed in per row.
  const eligibility = checkEligibility(actuals, target);
  const maskCoreValues = !canSeeAssessment(u.id, u.departmentId ?? null);
  const shownActuals = maskCoreValues && actuals.totalScoreSource === 'HOD'
    ? { ...actuals, totalScore: sub.review?.totalScore ?? 0 }
    : actuals;

  return {
    submissionId: sub.id,
    status: sub.status,
    redListed: sub.redListed,
    faculty: { id: u.id, name: u.name, employeeCode: u.employeeCode, designation: u.designation },
    department: u.department,
    cadre,
    cadreLabel: cadre ? CADRE_LABEL[cadre] : null,
    expYears: Math.round(expYears * 10) / 10,
    actuals: shownActuals,
    // The scale the shown total is on: a self-assessed total and a reviewed
    // /500 are out of 500; the reviewed grand total with Category 6 is /550.
    scoreScale: (actuals.totalScoreSource === 'HOD' && !maskCoreValues ? 550 : 500) as 500 | 550,
    // Computed actuals-vs-cadre-targets detail. Kept as the reference the dean
    // reads when deciding, but it no longer decides eligibility itself.
    eligibility,
    // Manual decisions (admin/dean), null until decided.
    tier: ctx.manualTiers.get(u.id) ?? null,
    eligible: ctx.manualEligible.get(u.id) ?? null,
  };
}

// Latest submission per faculty (input assumed sorted by submissionNumber desc).
export function latestPerFaculty<T extends { userId: string }>(subs: T[]): T[] {
  const seen = new Map<string, T>();
  for (const s of subs) if (!seen.has(s.userId)) seen.set(s.userId, s);
  return [...seen.values()];
}

export type TrackingRow = ReturnType<typeof computeRow>;

// Resolve the AY + build the sorted per-faculty rows for a scope. Returns null
// if the year can't be resolved.
export async function buildTrackingRows(opts: {
  allDepartments: boolean;
  deptIds: string[];
  academicYearId?: string;
  canSeeAssessment?: AssessmentVisibility;
}) {
  const year = opts.academicYearId
    ? await prisma.academicYear.findUnique({ where: { id: opts.academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return null;

  const [ctx, submissions] = await Promise.all([
    loadTrackingContext(year.id),
    prisma.appraisalSubmission.findMany({
      where: { academicYearId: year.id, ...(opts.allDepartments ? {} : { user: { departmentId: { in: opts.deptIds } } }) },
      include: TRACKING_INCLUDE,
      orderBy: { submissionNumber: 'desc' },
    }),
  ]);

  const rows = latestPerFaculty(submissions)
    .map((sub) => computeRow(sub, ctx, year.startDate, opts.canSeeAssessment ?? SEES_EVERYTHING))
    .sort((a, b) => a.faculty.name.localeCompare(b.faculty.name));

  return { year, ctx, rows };
}

type TierKey = 'T1' | 'T2' | 'T3' | 'none';
const emptyTiers = (): Record<TierKey, number> => ({ T1: 0, T2: 0, T3: 0, none: 0 });

// Segregate rows by cadre + tier for the report summary.
export function summarize(rows: TrackingRow[]) {
  const byTier = emptyTiers();
  const byCadre: Record<string, { total: number; eligible: number; tiers: Record<TierKey, number> }> = {};
  let eligible = 0;

  for (const r of rows) {
    const t: TierKey = (r.tier as TierKey) ?? 'none';
    byTier[t]++;
    if (r.eligible === true) eligible++;
    const key = r.cadreLabel ?? 'Unassigned';
    byCadre[key] = byCadre[key] ?? { total: 0, eligible: 0, tiers: emptyTiers() };
    byCadre[key].total++;
    if (r.eligible === true) byCadre[key].eligible++;
    byCadre[key].tiers[t]++;
  }

  return { total: rows.length, eligible, byTier, byCadre };
}
