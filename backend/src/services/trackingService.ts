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
  // The HoD's provisional draft review carries the during-year overall remark
  // the quarterly mail surfaces (buildQuarterlyPayload). Null until the HoD notes
  // one; loading it is additive and harmless for the other TRACKING_INCLUDE uses.
  draftReview: true,
  proofVerifications: { select: { status: true } },
  finalReviews: { select: { decision: true } },
  user: { select: { id: true, name: true, employeeCode: true, designation: true, dateOfJoining: true, departmentId: true, department: { select: { name: true, code: true } } } },
} as const;

export interface TrackingContext {
  cadreTargets: any[];
  // Manual per-faculty decisions for the AY, keyed by userId. Both the tier and
  // the eligibility call are made by the admin/dean by hand — nothing here is
  // auto-computed. Absent from the map = not yet decided.
  manualTiers: Map<string, Tier>;
  manualEligible: Map<string, boolean>;
  manualTierReason: Map<string, string | null>;
  hasTargets: boolean;
}

export async function loadTrackingContext(academicYearId: string): Promise<TrackingContext> {
  const [cadreTargets, facultyTiers] = await Promise.all([
    prisma.cadreTarget.findMany({ where: { academicYearId } }),
    prisma.facultyTier.findMany({ where: { academicYearId } }),
  ]);

  const manualTiers = new Map<string, Tier>();
  const manualEligible = new Map<string, boolean>();
  const manualTierReason = new Map<string, string | null>();
  for (const ft of facultyTiers) {
    manualTierReason.set(ft.userId, ft.tierReason);
    if (ft.tier) manualTiers.set(ft.userId, ft.tier);
    if (ft.eligible != null) manualEligible.set(ft.userId, ft.eligible);
  }

  return {
    cadreTargets,
    manualTiers,
    manualEligible,
    manualTierReason,
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
  // Reviewed total: prefer the final AppraisalReview; otherwise fall back to the
  // HoD's quarterly DraftReview, so the reviewed score shows from Q1 before the
  // annual review exists. The /550 grand total stays masked below for readers
  // who may not see Category 6 — they get the /500 total.
  const _fr = sub.review, _dr = sub.draftReview;
  const _sum5 = (r: any) => (r.cat1Score ?? 0) + (r.cat2Score ?? 0) + (r.cat3Score ?? 0) + (r.cat4Score ?? 0) + (r.cat5Score ?? 0);
  const _sum6 = (r: any) => (r.cat6Punctuality ?? 0) + (r.cat6Professionalism ?? 0) + (r.cat6Willingness ?? 0) + (r.cat6Cordiality ?? 0) + (r.cat6Classroom ?? 0);
  const _drMarks = _dr && [_dr.cat1Score, _dr.cat2Score, _dr.cat3Score, _dr.cat4Score, _dr.cat5Score].some((v: any) => v != null);
  let _reviewTotal500: number | null = null, _reviewGrand550: number | null = null;
  if (_fr && _fr.grandTotal != null) { _reviewTotal500 = _fr.totalScore ?? null; _reviewGrand550 = _fr.grandTotal; }
  else if (_drMarks) { const t = _sum5(_dr); _reviewTotal500 = t; _reviewGrand550 = t + _sum6(_dr); }
  const actuals = computeActuals(sub, _reviewGrand550);
  const target = cadre ? pickCadreTarget(ctx.cadreTargets, cadre, expYears) : null;
  // Eligibility is always decided on the full grand total, so the verdict does
  // not change with who is looking. Only the number shown is masked: a reader
  // who may not see Cat 6 for THIS faculty (the dean, a special scrutinizer, or
  // an owner reading back their own row) gets the reviewed /500 instead of the
  // /550. `utils/reviewVisibility` is the rule, passed in per row.
  const eligibility = checkEligibility(actuals, target);
  const maskCoreValues = !canSeeAssessment(u.id, u.departmentId ?? null);
  const shownActuals = maskCoreValues && actuals.totalScoreSource === 'HOD'
    ? { ...actuals, totalScore: _reviewTotal500 ?? 0 }
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
    academicVerified: Array.isArray(sub.proofVerifications) && sub.proofVerifications.length > 0 && sub.proofVerifications.every((p: any) => p.status === 'VERIFIED'),
    deanVerified: Array.isArray(sub.finalReviews) && sub.finalReviews.some((f: any) => f.decision === 'APPROVED'),
    tierReason: ctx.manualTierReason.get(u.id) ?? null,
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
