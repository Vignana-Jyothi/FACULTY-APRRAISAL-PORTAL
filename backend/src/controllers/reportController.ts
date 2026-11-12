import { Request, Response } from 'express';
import { RoleType, SubmissionStatus, FeedbackPeriod, Cadre } from '@prisma/client';
import { deriveCadre, computeExperienceYears, CADRE_LABEL } from '../services/cadreEngine';

// Seniormost first for the IQAC sheet ordering.
const CADRE_RANK: Record<Cadre, number> = {
  PROFESSOR: 4, ASSOCIATE_PROFESSOR: 3, SR_ASSISTANT_PROFESSOR: 2, ASSISTANT_PROFESSOR: 1,
};
// Faculty ordering for every roster export: by cadre (seniormost first), then
// most-experienced (earliest dateOfJoining) first, then name.
const cadreRankOf = (u: any) => { const c = deriveCadre(u?.designation); return c ? CADRE_RANK[c] : 0; };
const byCadreThenExp = (ua: any, ub: any) =>
  cadreRankOf(ub) - cadreRankOf(ua)
  || computeExperienceYears(ub?.dateOfJoining) - computeExperienceYears(ua?.dateOfJoining)
  || (ua?.name ?? '').localeCompare(ub?.name ?? '');
import prisma from '../utils/prismaClient';
import * as XLSX from 'xlsx';
import { renderHtmlToPdf, renderQuarterlyDeptSummaryHtml } from '../services/pdfService';
import { computeScore } from '../services/scoringEngine';
import { TRACKING_INCLUDE } from '../services/trackingService';
import { AuthUser } from '../middleware/auth';
import { csvSafe } from '../utils/csvSafe';
import { CONFIG, deptIdsFor, hasAnyRole } from '../utils/roles';
import {
  canSeeReviewerAssessment,
  seesReviewerAssessmentEverywhere,
  stripReviewerAssessment,
} from '../utils/reviewVisibility';

// Proof section labels — mirror proofService PROOF_SOURCES exactly. A research
// row counts in analytics only when its proof is verified at least at
// department level: a ProofVerification for that submission/section/item exists
// with status VERIFIED. The item key matches proofService's enumerateProofs,
// which uses the row title or '(untitled)'.
const ANALYTICS_PROOF_SECTION = {
  journals: '2.1-A Journals',
  conferences: '2.1-B Conferences',
  confBookChapters: '2.1-C Conference Book Chapters',
  bookChapters: '2.3 Book Chapters',
  books: '2.3 Books',
  patents: '2.4 Patents / IPR',
  projects: '2.5 Sponsored Projects',
} as const;

function verifiedKeySet(pvs: Array<{ section: string; item: string; status: string }>): Set<string> {
  const s = new Set<string>();
  for (const p of pvs) if (p.status === 'VERIFIED') s.add(`${p.section}|${p.item}`);
  return s;
}
const analyticsVKey = (section: string, title: string | null | undefined) =>
  `${section}|${(title || '(untitled)').toString()}`;

// Dept scoping for report reads. The dean and the principal see every
// department (or an optional single-dept filter); a department caller is
// hard-scoped to their own dept(s), so a foreign ?dept can't leak another
// department's data — and the default no longer spills all departments when the
// caller supplies no filter. The admin is no longer here: reports are appraisal
// content and a maintenance account holds none.
//
// THE RULE (one, for every report route): the department scope is the HoD —
// HoD only. It has to match the `DEPT_CONTENT_READ` route guard on
// /reports/department, /reports/criteria and /reports/export, which admits the
// incharge: scoping on [HOD] alone let a REVIEWER past the guard and then
// handed them an empty report instead of either data or a 403.
// getCriteriaReport applies the same set.
function reportUserWhere(user: AuthUser, deptFilter?: string) {
  if (hasAnyRole(user, CONFIG)) return deptFilter ? { departmentId: deptFilter } : {};
  return { departmentId: { in: deptIdsFor(user, [RoleType.HOD]) } };
}

export async function getDeptReport(req: Request, res: Response) {
  const { year, dept } = req.query;

  const academicYear = year
    ? await prisma.academicYear.findUnique({ where: { label: year as string } })
    : null;

  const yearFilter = academicYear?.id;
  const userWhere = reportUserWhere(req.user!, typeof dept === 'string' ? dept : undefined);

  const reviews = await prisma.appraisalReview.findMany({
    where: {
      submission: {
        ...(yearFilter ? { academicYearId: yearFilter } : {}),
        user: userWhere,
      },
    },
    include: {
      submission: {
        include: {
          user: { select: { id: true, name: true, employeeCode: true, designation: true, departmentId: true, department: true } },
          academicYear: { select: { label: true } },
        },
      },
    },
  });

  // A review row IS the reviewer's assessment — Cat 6 and grandTotal are
  // columns on it. The dean reads this report institute-wide and must not get
  // them; the HoD of that faculty's department, and the principal, may.
  const rows = reviews.map((r) =>
    canSeeReviewerAssessment(req.user!, r.submission.userId, r.submission.user.departmentId)
      ? r
      : stripReviewerAssessment(r as any),
  );

  return res.json(rows);
}

export async function getInstituteReport(req: Request, res: Response) {
  const { year } = req.query;
  const academicYear = year
    ? await prisma.academicYear.findUnique({ where: { label: year as string } })
    : null;

  const stats = await prisma.appraisalSubmission.groupBy({
    by: ['status'],
    where: academicYear ? { academicYearId: academicYear.id } : {},
    _count: { id: true },
  });

  // /550 for the principal, /500 for the dean. The select is chosen per caller
  // rather than stripped afterwards so the dean's grand totals never leave the
  // database. This report is institute-wide and aggregated, so there is no one
  // row owner to key on: ask the one gate (utils/reviewVisibility) whether this
  // caller may see the assessment of ANY faculty in ANY department, which only
  // the principal can. Routed through the helper rather than re-testing for
  // PRINCIPAL here, so the Cat 6 rule lives in one place.
  const seesAssessment = seesReviewerAssessmentEverywhere(req.user!);
  const deptStats = await prisma.appraisalSubmission.findMany({
    where: academicYear ? { academicYearId: academicYear.id } : {},
    include: {
      user: { include: { department: true } },
      review: { select: { totalScore: true, grandTotal: seesAssessment } },
    },
  });

  return res.json({ statusBreakdown: stats, submissions: deptStats });
}

// GET /reports/criteria?academicYearId=&dept=  (HoD -> own dept, Admin -> all/filter)
// Per-faculty full subsection breakdown (from scoringEngine) so the frontend can
// show every faculty's mark for any chosen subsection. Uses the reviewed
// submission when present, else the latest.
export async function getCriteriaReport(req: Request, res: Response) {
  const user = req.user!;
  const seesAllDepts = hasAnyRole(user, CONFIG);
  const deptIds = deptIdsFor(user, [RoleType.HOD]);

  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const deptFilter = typeof req.query.dept === 'string' ? req.query.dept : undefined;

  const year = academicYearId
    ? await prisma.academicYear.findUnique({ where: { id: academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  // Dept scope: HoD/reviewer limited to their dept(s); dean and principal see
  // all (or a filter). HoD — the same set reportUserWhere uses, and the
  // one the DEPT_CONTENT_READ route guard admits. See the note there.
  const deptWhere = seesAllDepts
    ? (deptFilter ? { departmentId: deptFilter } : {})
    : { departmentId: { in: deptIds } };

  const submissions = await prisma.appraisalSubmission.findMany({
    where: { academicYearId: year.id, user: deptWhere },
    include: TRACKING_INCLUDE,
    orderBy: { submissionNumber: 'desc' },
  });

  // Reviewed-preferred, else latest, per faculty (submissions are desc).
  const picked = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    const cur = picked.get(s.userId);
    if (!cur) picked.set(s.userId, s);
    else if (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED) picked.set(s.userId, s);
  }

  const rows = [...picked.values()]
    .map((sub) => {
      const u = (sub as any).user;
      return {
        submissionId: sub.id,
        faculty: { id: u.id, name: u.name, employeeCode: u.employeeCode, department: u.department },
        status: sub.status,
        // The /550 is the reviewer's assessment: principal and own-department
        // HoD only. The dean ranks faculty on the /500 breakdown below.
        grandTotal: canSeeReviewerAssessment(user, sub.userId, u.departmentId ?? null)
          ? ((sub as any).review?.grandTotal ?? null)
          : null,
        reviewedTotal: (sub as any).review?.totalScore ?? null,
        breakdown: computeScore(sub as any),
      };
    })
    .sort((a, b) => a.faculty.name.localeCompare(b.faculty.name));

  return res.json({ year: { id: year.id, label: year.label }, rows });
}

export async function exportReport(req: Request, res: Response) {
  const { format, year, dept } = req.query;

  const academicYear = year
    ? await prisma.academicYear.findUnique({ where: { label: year as string } })
    : null;

  // Criteria-wise scores: one row per faculty with each category's SELF and
  // REVIEWED subtotal side by side (self from the self-assessment via
  // computeScore, reviewed from the review row), then the two /500 totals and
  // the Cat 6 / grand total. Reviewed-preferred, else latest, per faculty.
  const submissions = await prisma.appraisalSubmission.findMany({
    where: {
      ...(academicYear ? { academicYearId: academicYear.id } : {}),
      user: reportUserWhere(req.user!, typeof dept === 'string' ? dept : undefined),
    },
    include: { ...TRACKING_INCLUDE, academicYear: { select: { label: true } } },
    orderBy: { submissionNumber: 'desc' },
  });

  const picked = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    const cur = picked.get(s.userId);
    if (!cur) picked.set(s.userId, s);
    else if (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED) picked.set(s.userId, s);
  }

  // Marks are shown to two decimals everywhere.
  const round1 = (n: number | null | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : '';

  const rows = [...picked.values()]
    .sort((a, b) => byCadreThenExp((a as any).user, (b as any).user))
    .map((sub) => {
      const u = (sub as any).user;
      const rev = (sub as any).review ?? null;
      const self = computeScore(sub as any);
      const cat6Visible = canSeeReviewerAssessment(req.user!, sub.userId, u.departmentId ?? null);
      const cat6 = rev
        ? ((rev.cat6Punctuality ?? 0) + (rev.cat6Professionalism ?? 0) + (rev.cat6Willingness ?? 0) + (rev.cat6Cordiality ?? 0) + (rev.cat6Classroom ?? 0))
        : null;
      return {
        'Name': csvSafe(u.name),
        'Employee Code': csvSafe(u.employeeCode),
        'Designation': csvSafe(u.designation ?? ''),
        'Department': csvSafe(u.department?.name ?? ''),
        'Academic Year': csvSafe((sub as any).academicYear?.label ?? (academicYear?.label ?? '')),
        // Each criterion: self subtotal, then the reviewer's subtotal.
        'C1 Self /150': round1(self.cat1.total),
        'C1 Reviewed /150': rev?.cat1Score ?? '',
        'C2 Self /150': round1(self.cat2.total),
        'C2 Reviewed /150': rev?.cat2Score ?? '',
        'C3 Self /100': round1(self.cat3.total),
        'C3 Reviewed /100': rev?.cat3Score ?? '',
        'C4 Self /50': round1(self.cat4.total),
        'C4 Reviewed /50': rev?.cat4Score ?? '',
        'C5 Self /50': round1(self.cat5.total),
        'C5 Reviewed /50': rev?.cat5Score ?? '',
        // Category subtotals roll up to the two /500 totals.
        'Self Total /500': round1(self.selfTotal),
        'Reviewed Total /500': rev?.totalScore ?? '',
        // Cat 6 and the /550 are the reviewer's assessment — own-dept HoD /
        // principal only; blank otherwise.
        'Core values (Cat 6) /50': cat6Visible ? (cat6 ?? '') : '',
        'Grand total /550': cat6Visible ? (rev?.grandTotal ?? '') : '',
        // The HoD's decision is not the appraisal's standing: an approval that
        // went on to final review is still waiting on a scrutinizer.
        'HoD decision': rev?.status ?? '—',
        'Appraisal status': sub.status,
      };
    });

  if (format === 'excel') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Appraisals');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=appraisals.xlsx');
    return res.send(buf);
  }

  return res.json(rows);
}

// ─── Department appraisal Excel (official CSE output format) ─────────────
//
// One row per faculty, for a single department and academic year, in the
// institute's consolidated output layout (24 base columns). The dean/principal
// pick a department and additionally get the Tier and Eligibility columns they
// own; a HoD exports only their own department with Tier/Eligibility hidden.
//
// The derivable columns are filled from the appraisal (publications, indexing,
// citations, patents, projects, consultancy, guidance, teaching feedback). The
// HoD's narrative verification columns (authorship sharing, shared ownership,
// final remarks, signature) are left blank for the HoD to complete by hand.

const APPRAISAL_HEADERS = [
  'Name of the Employee', 'Employee ID', 'Designation', 'Highest Qualification',
  'No of Theory Subjects handled (B.Tech. / M.Tech.)', 'Highest & Lowest Feed Back points',
  'Highest & Lowest Pass Percentage', 'No.of Publication (Journals)', 'position of author',
  'No.of Publication (Conferences)', 'position of author ', 'Scopus', 'WoS', 'SCI/SCIE',
  'Citations (Scopus/ WoS )', 'Books/Book chapters', 'Patents & Any Other IP (Applied / Granted)',
  'No. of Research Projects (Applied / Granted) & Amount Rs.',
  'Consultancy Projects (Applied / Granted) & Amount Rs.', 'Research guidance (Ph.D.)',
  'Authorship sharing information', 'Shared Authorship OwnerShip',
  'Final Remarks after verification', 'Signature of the faculty',
];

// Distinct author positions across a set of publication rows, in first-seen order.
const positions = (rows: Array<{ authorPosition?: string | null }>): string => {
  const seen: string[] = [];
  for (const r of rows) {
    const p = (r.authorPosition ?? '').trim();
    if (p && !seen.includes(p)) seen.push(p);
  }
  return seen.join(', ');
};

const countIndexed = (rows: Array<{ indexed?: string | null }>, ...want: string[]): number =>
  rows.filter((r) => r.indexed && want.includes(r.indexed)).length;

// "a Filed, b Published, c Granted" — only the non-zero parts.
const patentSummary = (rows: Array<{ status: string }>): string => {
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
  const label: Record<string, string> = { FILED: 'Filed', PUBLISHED: 'Published', GRANTED: 'Granted' };
  return ['FILED', 'PUBLISHED', 'GRANTED']
    .filter((s) => by[s]).map((s) => `${by[s]} ${label[s]}`).join(', ');
};

// "a Applied, b Ongoing, c Completed & Rs. X L" — non-zero parts + total amount.
const projectSummary = (rows: Array<{ status: string; amountLakhs: number }>): string => {
  if (rows.length === 0) return '';
  const by: Record<string, number> = {};
  let amt = 0;
  for (const r of rows) { by[r.status] = (by[r.status] ?? 0) + 1; amt += r.amountLakhs ?? 0; }
  const label: Record<string, string> = { APPLIED: 'Applied', ONGOING: 'Ongoing', COMPLETED: 'Completed' };
  const counts = ['APPLIED', 'ONGOING', 'COMPLETED'].filter((s) => by[s]).map((s) => `${by[s]} ${label[s]}`).join(', ');
  return amt ? `${counts} & Rs. ${amt} L` : counts;
};

const range = (vals: number[]): string => {
  const xs = vals.filter((v) => typeof v === 'number' && !Number.isNaN(v) && v > 0);
  if (xs.length === 0) return '';
  const hi = Math.max(...xs), lo = Math.min(...xs);
  return hi === lo ? `${hi}` : `${hi} & ${lo}`;
};

export async function exportAppraisalExcel(req: Request, res: Response) {
  const user = req.user!;
  const seesAllDepts = hasAnyRole(user, CONFIG); // dean / principal
  const deptFilter = typeof req.query.dept === 'string' ? req.query.dept : undefined;

  // The sheet is per-department. The dean/principal must name which one; a HoD
  // is pinned to their own department and any ?dept is ignored.
  let departmentId: string | undefined;
  if (seesAllDepts) {
    if (!deptFilter) return res.status(400).json({ error: 'Select a department to export' });
    departmentId = deptFilter;
  } else {
    const own = deptIdsFor(user, [RoleType.HOD]);
    if (own.length === 0) return res.status(403).json({ error: 'No department to export' });
    departmentId = own[0];
  }

  const year = typeof req.query.academicYearId === 'string'
    ? await prisma.academicYear.findUnique({ where: { id: req.query.academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const submissions = await prisma.appraisalSubmission.findMany({
    where: { academicYearId: year.id, user: { departmentId } },
    include: TRACKING_INCLUDE,
    orderBy: { submissionNumber: 'desc' },
  });

  // Reviewed-preferred, else latest, per faculty (submissions are desc).
  const picked = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    const cur = picked.get(s.userId);
    if (!cur) picked.set(s.userId, s);
    else if (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED) picked.set(s.userId, s);
  }
  const chosen = [...picked.values()].sort((a, b) => byCadreThenExp((a as any).user, (b as any).user));

  // Highest qualification lives on the user, not in TRACKING_INCLUDE's select.
  const quals = new Map<string, string>();
  if (chosen.length) {
    const us = await prisma.user.findMany({
      where: { id: { in: chosen.map((s) => s.userId) } },
      select: { id: true, educationalQuals: true },
    });
    for (const u of us) quals.set(u.id, u.educationalQuals ?? '');
  }

  // Tier + eligibility are the dean's/principal's columns only.
  const includeTier = seesAllDepts;
  const tiers = new Map<string, { tier: string | null; eligible: boolean | null }>();
  if (includeTier && chosen.length) {
    const fts = await prisma.facultyTier.findMany({
      where: { academicYearId: year.id, userId: { in: chosen.map((s) => s.userId) } },
      select: { userId: true, tier: true, eligible: true },
    });
    for (const ft of fts) tiers.set(ft.userId, { tier: ft.tier ?? null, eligible: ft.eligible });
  }

  const headers = includeTier ? [...APPRAISAL_HEADERS, 'Tier', 'Eligibility'] : [...APPRAISAL_HEADERS];

  const rows = chosen.map((s) => {
    const a = s as any;
    const u = a.user;
    const j = a.cat2Journals ?? [], c = a.cat2Conferences ?? [], cbc = a.cat2ConfBookChapters ?? [];
    const pub = [...j, ...c, ...cbc];
    const results = a.cat1CourseResults ?? [];
    const booksChapters = (a.cat2Books ?? []).length + (a.cat2BookChapters ?? []).length + cbc.length;
    const row: Array<string | number> = [
      u.name ?? '',
      u.employeeCode ?? '',
      u.designation ?? '',
      quals.get(u.id) ?? '',
      (a.cat1Courses ?? []).length || '',
      range(results.map((r: any) => r.feedbackReceived)),
      range(results.map((r: any) => r.passPercentage)),
      j.length || '',
      positions(j),
      c.length || '',
      positions(c),
      countIndexed(pub, 'SCOPUS') || '',
      countIndexed(pub, 'WOS') || '',
      countIndexed(pub, 'ESCI') || '', // no SCI index in the enum; ESCI is the closest
      a.cat2Citations?.totalCitations || '',
      booksChapters || '',
      patentSummary(a.cat2Patents ?? []),
      projectSummary(a.cat2Projects ?? []),
      (a.cat2Consultancy ?? []).length
        ? `${a.cat2Consultancy.length} & Rs. ${(a.cat2Consultancy as any[]).reduce((t, x) => t + (x.amountLakhs ?? 0), 0)} L`
        : '',
      (a.cat2Guidance ?? []).filter((g: any) => g.isGuide).length || '',
      '', // Authorship sharing information — HoD narrative, filled by hand
      '', // Shared Authorship Ownership — HoD narrative
      '', // Final Remarks after verification — HoD narrative
      '', // Signature of the faculty
    ];
    if (includeTier) {
      const t = tiers.get(u.id);
      row.push(t?.tier ?? '');
      row.push(t?.eligible == null ? '' : t.eligible ? 'Eligible' : 'Not eligible');
    }
    return row;
  });

  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { code: true, name: true } });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (dept?.code ?? 'Appraisal').slice(0, 28));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `appraisal-${dept?.code ?? 'dept'}-${year.label}.xlsx`.replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${fname}`);
  return res.send(buf);
}

// ─── Department quarterly review summary (PDF) ───────────────────────────
//
// One PDF for a department and quarter: every faculty's snapshot plus the
// HoD's issued quarterly feedback. HoD exports their own department; the
// dean/principal pick any department. Same scope rule as the appraisal Excel.

const Q_PERIOD_LABEL: Record<FeedbackPeriod, string> = {
  Q1: 'Quarter 1 (Jul-Sep)', Q2: 'Quarter 2 (Oct-Dec)', Q3: 'Quarter 3 (Jan-Mar)',
  Q4: 'Quarter 4 (Apr-Jun)', ANNUAL: 'Annual (final)',
};

export async function exportQuarterlyDeptPdf(req: Request, res: Response) {
  const user = req.user!;
  const seesAllDepts = hasAnyRole(user, CONFIG); // dean / principal
  const deptFilter = typeof req.query.dept === 'string' ? req.query.dept : undefined;

  let departmentId: string | undefined;
  if (seesAllDepts) {
    if (!deptFilter) return res.status(400).json({ error: 'Select a department to export' });
    departmentId = deptFilter;
  } else {
    const own = deptIdsFor(user, [RoleType.HOD]);
    if (own.length === 0) return res.status(403).json({ error: 'No department to export' });
    departmentId = own[0];
  }

  const periodRaw = typeof req.query.period === 'string' ? req.query.period.toUpperCase() : 'Q1';
  const period = (Object.values(FeedbackPeriod) as string[]).includes(periodRaw)
    ? (periodRaw as FeedbackPeriod) : FeedbackPeriod.Q1;

  const year = typeof req.query.academicYearId === 'string'
    ? await prisma.academicYear.findUnique({ where: { id: req.query.academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const submissions = await prisma.appraisalSubmission.findMany({
    where: { academicYearId: year.id, user: { departmentId } },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, designation: true, dateOfJoining: true, department: { select: { name: true } } } },
      feedbacks: {
        where: { period, status: 'ISSUED' },
        include: { issuedBy: { select: { name: true } } },
      },
    },
    orderBy: { submissionNumber: 'desc' },
  });

  // Reviewed-preferred, else latest, per faculty.
  const picked = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    const cur = picked.get(s.userId);
    if (!cur) picked.set(s.userId, s);
    else if (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED) picked.set(s.userId, s);
  }

  const items = [...picked.values()]
    .map((s) => {
      const fb = (s as any).feedbacks?.[0] ?? null;
      return { user: (s as any).user, feedback: fb, snapshot: fb?.snapshot ?? null };
    })
    .sort((a, b) => byCadreThenExp(a.user, b.user));

  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { code: true, name: true } });
  const html = renderQuarterlyDeptSummaryHtml(items, {
    deptName: dept?.name ?? '—',
    periodLabel: Q_PERIOD_LABEL[period],
    yearLabel: year.label,
  });
  const buf = await renderHtmlToPdf(html);
  const fname = `quarterly-${period}-${dept?.code ?? 'dept'}-${year.label}.pdf`.replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${fname}`);
  return res.send(buf);
}

// ─── Quarterly summary sheet (Excel) ─────────────────────────────────────
//
// A compact per-faculty Excel (the "Quarterly Summary" download), for a chosen
// quarter: Employee ID, Employee Name, Targets Achieved (the ideal targets met, each
// with its current value), and the HoD's review (the issued quarterly
// feedback). Both the targets and the review come from the quarter's issued
// feedback snapshot; a faculty with no issued feedback is listed as pending.

export async function exportIqacQuarterlyExcel(req: Request, res: Response) {
  const user = req.user!;
  const seesAllDepts = hasAnyRole(user, CONFIG);
  const deptFilter = typeof req.query.dept === 'string' ? req.query.dept : undefined;

  let departmentId: string | undefined;
  if (seesAllDepts) {
    if (!deptFilter) return res.status(400).json({ error: 'Select a department to export' });
    departmentId = deptFilter;
  } else {
    const own = deptIdsFor(user, [RoleType.HOD]);
    if (own.length === 0) return res.status(403).json({ error: 'No department to export' });
    departmentId = own[0];
  }

  const periodRaw = typeof req.query.period === 'string' ? req.query.period.toUpperCase() : 'Q1';
  const period = (Object.values(FeedbackPeriod) as string[]).includes(periodRaw)
    ? (periodRaw as FeedbackPeriod) : FeedbackPeriod.Q1;

  const year = typeof req.query.academicYearId === 'string'
    ? await prisma.academicYear.findUnique({ where: { id: req.query.academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const submissions = await prisma.appraisalSubmission.findMany({
    where: { academicYearId: year.id, user: { departmentId } },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, designation: true, dateOfJoining: true } },
      review: { select: { overallComment: true } },
      draftReview: { select: { overallComment: true } },
      cat2Journals: { select: { title: true, status: true, authorPosition: true } },
      cat2Conferences: { select: { title: true, status: true, authorPosition: true } },
      cat2Patents: { select: { title: true, status: true } },
      cat2Projects: { select: { title: true, status: true } },
      cat1EContent: { select: { contentName: true, courseName: true } },
      cat2Consultancy: { select: { name: true, amountLakhs: true } },
    },
    orderBy: { submissionNumber: 'desc' },
  });

  const picked = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    const cur = picked.get(s.userId);
    if (!cur) picked.set(s.userId, s);
    else if (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED) picked.set(s.userId, s);
  }

  // Humanise an enum value (PUBLISHED -> Published) and tally rows by status.
  const titleCase = (v: string) => v ? v.charAt(0) + v.slice(1).toLowerCase() : 'Unspecified';
  const nonEmpty = (list: any[], key: string | string[]) =>
    (list ?? []).filter((r) => (Array.isArray(key) ? key : [key]).some((k) => String(r[k] ?? '').trim()));
  const byStatus = (list: any[]) => {
    const m = new Map<string, number>();
    for (const r of list) { const k = titleCase(r.status); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([k, v]) => `${v} ${k}`).join(', ');
  };

  // Order: by cadre, seniormost (Professor) first; within a cadre, most
  // experienced first; name as a final tiebreak.
  const rows = [...picked.values()]
    .sort((a, b) => byCadreThenExp((a as any).user, (b as any).user))
    .map((s) => {
      const a = s as any;
      const journals = nonEmpty(a.cat2Journals, 'title');
      const confs = nonEmpty(a.cat2Conferences, 'title');
      const patents = nonEmpty(a.cat2Patents, 'title');
      const projects = nonEmpty(a.cat2Projects, 'title');
      const econtent = nonEmpty(a.cat1EContent, ['contentName', 'courseName']);
      const consult = nonEmpty(a.cat2Consultancy, 'name');
      const consultTotal = consult.reduce((t: number, c: any) => t + (Number(c.amountLakhs) || 0), 0);

      // Author positions the faculty recorded on their publications (first
      // author, corresponding, etc.) — only journals and conferences carry one.
      // Appended only when at least one entry has a position filled.
      const posList = (list: any[]) => list.map((r) => String(r.authorPosition ?? '').trim()).filter(Boolean);
      const withPos = (list: any[]) => {
        const p = posList(list);
        return p.length ? ` — Author position: ${p.join('; ')}` : '';
      };

      // Current target status: counts (with status breakdown where it applies).
      const targets = [
        `Journals: ${journals.length}${journals.length ? ` (${byStatus(journals)})` : ''}${withPos(journals)}`,
        `Conferences: ${confs.length}${confs.length ? ` (${byStatus(confs)})` : ''}${withPos(confs)}`,
        `Patents: ${patents.length}${patents.length ? ` (${byStatus(patents)})` : ''}`,
        `Projects applied: ${projects.length}`,
        `E-contents: ${econtent.length}`,
        `Consultancy: ${consultTotal.toFixed(2)} Lakhs`,
      ].join('\n');

      // HoD remarks = the HoD's draft note (overall comment on the draft review),
      // falling back to the final review comment once the appraisal is reviewed.
      const review = a.draftReview?.overallComment ?? a.review?.overallComment ?? 'No draft note';
      const cadre = deriveCadre(a.user.designation);
      const cadreText = cadre ? CADRE_LABEL[cadre] : (a.user.designation ?? '—');
      return [a.user.employeeCode ?? '', a.user.name ?? '', cadreText, targets, review];
    });

  const headers = ['Employee ID', 'Employee Name', 'Cadre', 'Current Target Status', 'HoD Remarks'];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 22 }, { wch: 60 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { code: true } });
  XLSX.utils.book_append_sheet(wb, ws, `${dept?.code ?? 'Dept'}-${period}`.slice(0, 28));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `iqac-${period}-${dept?.code ?? 'dept'}-${year.label}.xlsx`.replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${fname}`);
  return res.send(buf);
}

// GET /reports/publications-excel — every publication a department filed, one row
// per publication, across all 2.1 types (journals, conferences, conference book
// chapters, book chapters, books). Columns union all the IQAC publication-report
// fields; a type leaves blank the columns it does not carry. HoD = own dept;
// dean/principal pick a dept. Not period-scoped — a publication belongs to the
// appraisal year, not a quarter.
export async function exportPublicationsExcel(req: Request, res: Response) {
  const user = req.user!;
  const seesAllDepts = hasAnyRole(user, CONFIG);
  const deptFilter = typeof req.query.dept === 'string' ? req.query.dept : undefined;

  let departmentId: string | undefined;
  if (seesAllDepts) {
    if (!deptFilter) return res.status(400).json({ error: 'Select a department to export' });
    departmentId = deptFilter;
  } else {
    const own = deptIdsFor(user, [RoleType.HOD]);
    if (own.length === 0) return res.status(403).json({ error: 'No department to export' });
    departmentId = own[0];
  }

  const year = typeof req.query.academicYearId === 'string'
    ? await prisma.academicYear.findUnique({ where: { id: req.query.academicYearId } })
    : await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' } });
  if (!year) return res.status(404).json({ error: 'Academic year not found' });

  const submissions = await prisma.appraisalSubmission.findMany({
    where: { academicYearId: year.id, user: { departmentId } },
    include: {
      user: { select: { id: true, name: true, employeeCode: true, designation: true, dateOfJoining: true } },
      cat2Journals: true,
      cat2Conferences: true,
      cat2ConfBookChapters: true,
      cat2BookChapters: true,
      cat2Books: true,
    },
    orderBy: { submissionNumber: 'desc' },
  });

  // One submission per faculty — prefer the approved one, else the newest.
  const picked = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    const cur = picked.get(s.userId);
    if (!cur) picked.set(s.userId, s);
    else if (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED) picked.set(s.userId, s);
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString('en-GB') : '');
  const monthOf = (d: any) => (d ? MONTHS[new Date(d).getMonth()] : '');
  const INDEX_LABEL: Record<string, string> = { SCOPUS: 'Scopus', WOS: 'Web of Science', ESCI: 'ESCI', ICI: 'ICI', NONE: '' };
  const idxLabel = (v: any) => INDEX_LABEL[v as string] ?? '';
  const scopeLabel = (v: any) => (v === 'NATIONAL' ? 'National' : v === 'INTERNATIONAL' ? 'International' : '');
  const ugcLabel = (v: any) => (v === true ? 'Yes' : v === false ? 'No' : '');
  const has = (v: any) => String(v ?? '').trim();

  // Sort faculty: by cadre seniority, then experience, then name (as IQAC).
  const people = [...picked.values()].sort((a, b) => byCadreThenExp((a as any).user, (b as any).user));

  const rows: any[][] = [];
  for (const s of people) {
    const u = (s as any).user;
    const name = u.name ?? '';
    const desig = u.designation ?? '';
    // Column order (per IQAC request 2026-10-30): Faculty, Designation, Type,
    // Circulation, Authors, Author Position, Quartile, Title, Venue, Volume,
    // Issue No, Page Nos, Date, Month, ISSN/ISBN, Impact Factor, Indexed, Publisher,
    // DOI, Paper Link, Venue Link, UGC Care. A type blanks what it does not carry.
    const push = (type: string, c: any[]) => rows.push([name, desig, type, ...c]);

    for (const j of (s as any).cat2Journals ?? []) {
      if (!has(j.title) && !has(j.journalName)) continue;
      push('Journal', [scopeLabel(j.scope), j.authors ?? '', j.authorPosition ?? '', j.quartile ?? '', j.title ?? '', j.journalName ?? '', j.volume ?? '', j.issueNo ?? '', j.pageNos ?? '', fmtDate(j.dateOfPub), monthOf(j.dateOfPub), j.issn ?? '', j.impactFactor ?? '', idxLabel(j.indexed), j.publisher ?? '', j.doi ?? '', j.paperLink ?? '', j.venueLink ?? '', ugcLabel(j.ugcCareListed)]);
    }
    for (const c of (s as any).cat2Conferences ?? []) {
      if (!has(c.title) && !has(c.conferenceName)) continue;
      push('Conference', [scopeLabel(c.scope), c.authors ?? '', c.authorPosition ?? '', c.quartile ?? '', c.title ?? '', c.conferenceName ?? '', c.volume ?? '', c.issueNo ?? '', c.pageNos ?? '', fmtDate(c.dateOfPub), monthOf(c.dateOfPub), c.issn ?? '', c.impactFactor ?? '', idxLabel(c.indexed), c.publisher ?? '', c.doi ?? '', c.paperLink ?? '', c.venueLink ?? '', ugcLabel(c.ugcCareListed)]);
    }
    for (const c of (s as any).cat2ConfBookChapters ?? []) {
      if (!has(c.title) && !has(c.conferenceName)) continue;
      push('Conf. Book Chapter', ['', c.authors ?? '', c.authorPosition ?? '', c.quartile ?? '', c.title ?? '', c.conferenceName ?? '', c.volume ?? '', c.issueNo ?? '', c.pageNos ?? '', fmtDate(c.dateOfPub), monthOf(c.dateOfPub), c.issn ?? '', c.impactFactor ?? '', idxLabel(c.indexed), '', c.doi ?? '', '', '', '']);
    }
    for (const b of (s as any).cat2BookChapters ?? []) {
      if (!has(b.title)) continue;
      push('Book Chapter', [scopeLabel(b.scope), b.authors ?? '', b.authorPosition ?? '', '', b.title ?? '', '', '', '', '', '', '', b.isbn ?? '', '', '', b.publisher ?? '', '', '', '', '']);
    }
    for (const b of (s as any).cat2Books ?? []) {
      if (!has(b.title)) continue;
      push('Book', [scopeLabel(b.scope), b.authors ?? '', '', '', b.title ?? '', '', '', '', '', '', '', b.isbn ?? '', '', '', b.publisher ?? '', '', '', '', '']);
    }
  }

  const headers = [
    'Faculty Name', 'Designation', 'Publication Type', 'Level of Circulation',
    'Authors (as appeared in the paper)', 'Author Position', 'Quartile', 'Title of the Article',
    'Name of the Journal / Conference', 'Volume', 'Issue No', 'Page Nos', 'Date of Publication',
    'Month of Publication', 'ISSN No. / ISBN No.', 'Impact Factor', 'Indexed In', 'Name of the Publisher',
    'DOI Link', 'Link of the Paper', 'Link of the Journal / Conference', 'UGC Care Listed',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 9 }, { wch: 40 },
    { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 11 },
    { wch: 16 }, { wch: 22 }, { wch: 24 }, { wch: 28 }, { wch: 28 }, { wch: 13 },
  ];
  const wb = XLSX.utils.book_new();
  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { code: true } });
  XLSX.utils.book_append_sheet(wb, ws, `${dept?.code ?? 'Dept'}-Publications`.slice(0, 28));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `publications-${dept?.code ?? 'dept'}-${year.label}.xlsx`.replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${fname}`);
  return res.send(buf);
}

// GET /reports/analytics?academicYearId=&dept= — aggregated research output for the
// analytics dashboard. HoD = own department; dean/principal = whole campus (or a
// single ?dept). academicYearId: an id, 'all' (every year), or omitted (open year).
// Publications count only PUBLISHED/INDEXED papers (a legacy row with no status but
// a real index still counts). Books / book chapters have no status, so they count
// as published. Patents and projects count every recorded row.
async function computeAnalytics(
  user: AuthUser, deptParam: string | undefined, yq: string | undefined,
): Promise<{ ok: false; status: number; error: string } | { ok: true; data: any }> {
  const userWhere = reportUserWhere(user, deptParam);
  const scope = hasAnyRole(user, CONFIG) ? 'campus' : 'department';

  let year: { id: string; label: string } | null = null;
  if (yq && yq !== 'all') {
    year = await prisma.academicYear.findUnique({ where: { id: yq }, select: { id: true, label: true } });
    if (!year) return { ok: false, status: 404, error: 'Academic year not found' };
  } else if (!yq) {
    year = await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' }, select: { id: true, label: true } });
  }

  const subs = await prisma.appraisalSubmission.findMany({
    where: { ...(year ? { academicYearId: year.id } : {}), user: userWhere },
    include: {
      user: { select: { id: true, name: true, departmentId: true, department: { select: { code: true, name: true } } } },
      cat2Journals: { select: { title: true, status: true, indexed: true, quartile: true } },
      cat2Conferences: { select: { title: true, status: true, indexed: true } },
      cat2ConfBookChapters: { select: { title: true, indexed: true } }, // no status field; published when indexed
      cat2BookChapters: { select: { id: true, title: true } },
      cat2Books: { select: { id: true, title: true } },
      cat2Patents: { select: { title: true, status: true } },
      cat2Projects: { select: { id: true, title: true } },
      proofVerifications: { select: { section: true, item: true, status: true } },
    },
    orderBy: { submissionNumber: 'desc' },
  });

  // One submission per faculty per year (prefer approved, else newest).
  const picked = new Map<string, (typeof subs)[number]>();
  for (const s of subs) {
    const key = `${s.userId}:${s.academicYearId}`;
    const cur = picked.get(key);
    if (!cur || (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED)) picked.set(key, s);
  }

  // A paper counts only once it is published (or a legacy row indexed with no status).
  const isPub = (r: { status: string | null; indexed: string }) =>
    r.status === 'PUBLISHED' || r.status === 'INDEXED' || (r.status == null && r.indexed !== 'NONE');
  const INDEX_LABEL: Record<string, string> = { SCOPUS: 'Scopus', WOS: 'Web of Science', ESCI: 'ESCI', ICI: 'ICI', NONE: 'Not indexed' };
  const PATENT_LABEL: Record<string, string> = { FILED: 'Filed', PUBLISHED: 'Published', GRANTED: 'Granted' };

  const totals = { faculty: 0, journals: 0, conferences: 0, bookChapters: 0, confBookChapters: 0, books: 0, publications: 0, patents: 0, projects: 0 };
  const indexMap = new Map<string, { journals: number; conferences: number }>();
  const patentCounts = new Map<string, number>();
  const quartileCounts = new Map<string, number>();
  const addIdx = (indexed: string, kind: 'journals' | 'conferences') => {
    const k = INDEX_LABEL[indexed] ?? 'Not indexed';
    const e = indexMap.get(k) ?? { journals: 0, conferences: 0 };
    e[kind] += 1;
    indexMap.set(k, e);
  };
  const deptMap = new Map<string, { code: string; name: string; faculty: number; publications: number; journals: number; conferences: number; patents: number; projects: number }>();
  const facultyMap = new Map<string, { name: string; department: string; publications: number; patents: number; projects: number }>();

  for (const s of picked.values()) {
    const u = (s as any).user;
    const deptCode = u.department?.code ?? '—';
    const deptName = u.department?.name ?? 'Unassigned';
    const vk = verifiedKeySet((s as any).proofVerifications ?? []);
    const journals = (s as any).cat2Journals.filter((r: any) => isPub(r) && vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.journals, r.title)));
    const confs = (s as any).cat2Conferences.filter((r: any) => isPub(r) && vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.conferences, r.title)));
    const confBooks = (s as any).cat2ConfBookChapters.filter((r: any) => isPub(r) && vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.confBookChapters, r.title)));
    const bookCh = (s as any).cat2BookChapters.filter((r: any) => vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.bookChapters, r.title))).length;
    const books = (s as any).cat2Books.filter((r: any) => vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.books, r.title))).length;
    const patentRows = (s as any).cat2Patents.filter((r: any) => vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.patents, r.title)));
    const patents = patentRows.length;
    const projects = (s as any).cat2Projects.filter((r: any) => vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.projects, r.title))).length;
    const pubs = journals.length + confs.length + confBooks.length + bookCh + books;

    totals.journals += journals.length;
    totals.conferences += confs.length;
    totals.confBookChapters += confBooks.length;
    totals.bookChapters += bookCh;
    totals.books += books;
    totals.publications += pubs;
    totals.patents += patents;
    totals.projects += projects;

    // Indexing split by type: Scopus/WoS journals vs conference papers.
    for (const r of journals) addIdx(r.indexed, 'journals');
    for (const r of [...confs, ...confBooks]) addIdx(r.indexed, 'conferences');
    for (const p of patentRows) {
      const k = PATENT_LABEL[p.status] ?? 'Other';
      patentCounts.set(k, (patentCounts.get(k) ?? 0) + 1);
    }
    for (const j of journals) {
      const q = ['Q1', 'Q2', 'Q3', 'Q4'].includes(j.quartile ?? '') ? j.quartile : 'Unrated';
      quartileCounts.set(q, (quartileCounts.get(q) ?? 0) + 1);
    }

    const d = deptMap.get(deptCode) ?? { code: deptCode, name: deptName, faculty: 0, publications: 0, journals: 0, conferences: 0, patents: 0, projects: 0 };
    d.faculty += 1;
    d.publications += pubs;
    d.journals += journals.length;
    d.conferences += confs.length;
    d.patents += patents;
    d.projects += projects;
    deptMap.set(deptCode, d);

    const f = facultyMap.get(u.id) ?? { name: u.name ?? '', department: deptCode, publications: 0, patents: 0, projects: 0 };
    f.publications += pubs;
    f.patents += patents;
    f.projects += projects;
    facultyMap.set(u.id, f);
  }
  totals.faculty = facultyMap.size;

  const byDepartment = [...deptMap.values()].sort((a, b) => b.publications - a.publications);
  const publicationTypes = [
    { type: 'Journals', count: totals.journals },
    { type: 'Conferences', count: totals.conferences },
    { type: 'Book Chapters', count: totals.bookChapters + totals.confBookChapters },
    { type: 'Books', count: totals.books },
  ].filter((t) => t.count > 0);
  const INDEX_ORDER = ['Scopus', 'Web of Science', 'SCI', 'SCIE', 'ESCI', 'ICI', 'Not indexed'];
  const indexBreakdown = [...indexMap.entries()].map(([index, v]) => ({ index, journals: v.journals, conferences: v.conferences }))
    .sort((a, b) => {
      const ia = INDEX_ORDER.indexOf(a.index), ib = INDEX_ORDER.indexOf(b.index);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  // Patents by IPR stage (Filed / Published / Granted), in lifecycle order.
  const PATENT_ORDER = ['Filed', 'Published', 'Granted', 'Other'];
  const patentStatus = [...patentCounts.entries()].map(([status, count]) => ({ status, count }))
    .sort((a, b) => PATENT_ORDER.indexOf(a.status) - PATENT_ORDER.indexOf(b.status));
  // Published journals by quartile (Q1–Q4, then Unrated).
  const Q_ORDER = ['Q1', 'Q2', 'Q3', 'Q4', 'Unrated'];
  const quartileBreakdown = [...quartileCounts.entries()].map(([quartile, count]) => ({ quartile, count }))
    .sort((a, b) => Q_ORDER.indexOf(a.quartile) - Q_ORDER.indexOf(b.quartile));
  // Every faculty, most publications first — the frontend compares them all.
  const facultyList = [...facultyMap.values()].filter((f) => f.publications > 0).sort((a, b) => b.publications - a.publications);

  return { ok: true, data: { scope, year, totals, byDepartment, publicationTypes, indexBreakdown, patentStatus, quartileBreakdown, facultyList } };
}

export async function getAnalytics(req: Request, res: Response) {
  const deptParam = typeof req.query.dept === 'string' ? req.query.dept : undefined;
  const yq = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const r = await computeAnalytics(req.user!, deptParam, yq);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return res.json(r.data);
}

// GET /reports/analytics-excel — the analytics numbers as a workbook (summary,
// by department, by faculty, by indexing, by type). Same scope as the dashboard.
export async function exportAnalyticsExcel(req: Request, res: Response) {
  const deptParam = typeof req.query.dept === 'string' ? req.query.dept : undefined;
  const yq = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  const r = await computeAnalytics(req.user!, deptParam, yq);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  const d = r.data;
  const t = d.totals;

  const wb = XLSX.utils.book_new();
  const addSheet = (name: string, rows: any[][], cols: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = cols.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 28));
  };

  addSheet('Summary', [
    ['Scope', d.scope === 'campus' ? 'Whole campus' : 'Department'],
    ['Academic year', d.year?.label ?? 'All years'],
    [],
    ['Metric', 'Count'],
    ['Faculty', t.faculty],
    ['Publications (published)', t.publications],
    ['Journals', t.journals],
    ['Conference papers', t.conferences],
    ['Book chapters', t.bookChapters + t.confBookChapters],
    ['Books', t.books],
    ['Patents', t.patents],
    ['Projects', t.projects],
  ], [26, 14]);

  addSheet('By Department', [
    ['Code', 'Department', 'Faculty', 'Publications', 'Journals', 'Conferences', 'Patents', 'Projects'],
    ...d.byDepartment.map((x: any) => [x.code, x.name, x.faculty, x.publications, x.journals, x.conferences, x.patents, x.projects]),
  ], [10, 30, 9, 13, 10, 12, 9, 9]);

  addSheet('By Faculty', [
    ['Faculty', 'Department', 'Publications', 'Patents', 'Projects'],
    ...d.facultyList.map((x: any) => [x.name, x.department, x.publications, x.patents, x.projects]),
  ], [26, 12, 13, 9, 9]);

  addSheet('By Indexing', [
    ['Indexing', 'Journals', 'Conference Papers', 'Total'],
    ...d.indexBreakdown.map((x: any) => [x.index, x.journals, x.conferences, x.journals + x.conferences]),
  ], [20, 11, 18, 9]);
  addSheet('By Type', [['Type', 'Count'], ...d.publicationTypes.map((x: any) => [x.type, x.count])], [20, 9]);
  addSheet('Patents by Stage', [['IPR stage', 'Count'], ...d.patentStatus.map((x: any) => [x.status, x.count])], [20, 9]);
  addSheet('Journals by Quartile', [['Quartile', 'Journals'], ...d.quartileBreakdown.map((x: any) => [x.quartile, x.count])], [20, 9]);

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const tag = d.scope === 'campus' ? 'campus' : (d.byDepartment[0]?.code ?? 'dept');
  const fname = `analytics-${tag}-${d.year?.label ?? 'all-years'}.xlsx`.replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${fname}`);
  return res.send(buf);
}

// ── Analytics drill-down: one research type (publications | patents | projects),
// filtered by a date window + status. Returns the matching items (for a table)
// and type-specific chart aggregates computed over just those items. The date a
// row is tested against is the milestone for its status (publication date, filing/
// publication/grant date for patents, application/grant date for projects).
type DetailType = 'publications' | 'patents' | 'projects';
async function computeAnalyticsDetail(
  user: AuthUser,
  p: { type: DetailType; from?: string; to?: string; status?: string; deptParam?: string; yq?: string },
): Promise<{ ok: false; status: number; error: string } | { ok: true; data: any }> {
  const userWhere = reportUserWhere(user, p.deptParam);
  const scope = hasAnyRole(user, CONFIG) ? 'campus' : 'department';

  let year: { id: string; label: string } | null = null;
  if (p.yq && p.yq !== 'all') {
    year = await prisma.academicYear.findUnique({ where: { id: p.yq }, select: { id: true, label: true } });
    if (!year) return { ok: false, status: 404, error: 'Academic year not found' };
  } else if (!p.yq) {
    year = await prisma.academicYear.findFirst({ where: { submissionOpen: true }, orderBy: { startDate: 'desc' }, select: { id: true, label: true } });
  }

  const fromD = p.from ? new Date(p.from) : null;
  const toD = p.to ? new Date(`${p.to}T23:59:59.999`) : null;
  const hasRange = !!(fromD || toD);
  const inRange = (d: any): boolean => {
    if (!d) return !hasRange; // a row with no milestone date only passes when no window is set
    const dt = new Date(d);
    if (fromD && dt < fromD) return false;
    if (toD && dt > toD) return false;
    return true;
  };
  const fmt = (d: any) => (d ? new Date(d).toLocaleDateString('en-GB') : '');
  const want = (p.status ?? '').toUpperCase();
  const statusOk = (s: string | null) => !want || want === 'ALL' || s === want;

  const include: any = { user: { select: { id: true, name: true, employeeCode: true, designation: true, department: { select: { code: true, name: true } } } } };
  if (p.type === 'publications') { include.cat2Journals = true; include.cat2Conferences = true; }
  else if (p.type === 'patents') include.cat2Patents = true;
  else include.cat2Projects = true;
  include.proofVerifications = { select: { section: true, item: true, status: true } };

  const subs = await prisma.appraisalSubmission.findMany({
    where: { ...(year ? { academicYearId: year.id } : {}), user: userWhere },
    include,
    orderBy: { submissionNumber: 'desc' },
  });
  const picked = new Map<string, (typeof subs)[number]>();
  for (const s of subs) {
    const key = `${s.userId}:${s.academicYearId}`;
    const cur = picked.get(key);
    if (!cur || (cur.status !== SubmissionStatus.APPROVED && s.status === SubmissionStatus.APPROVED)) picked.set(key, s);
  }

  const INDEX_LABEL: Record<string, string> = { SCOPUS: 'Scopus', WOS: 'Web of Science', ESCI: 'ESCI', ICI: 'ICI', NONE: 'Not indexed' };
  const titleCase = (v: string) => (v ? v.charAt(0) + v.slice(1).toLowerCase() : '');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthOf = (d: any) => (d ? MONTHS[new Date(d).getMonth()] : '');
  const scopeLabel = (v: any) => (v === 'NATIONAL' ? 'National' : v === 'INTERNATIONAL' ? 'International' : '');
  const ugcLabel = (v: any) => (v === true ? 'Yes' : v === false ? 'No' : '');
  const items: any[] = [];

  for (const s of picked.values()) {
    const u = (s as any).user;
    const dept = u.department?.code ?? '—';
    const base = { faculty: u.name ?? '', employeeCode: u.employeeCode ?? '', department: dept, designation: u.designation ?? '' };
    const vk = verifiedKeySet((s as any).proofVerifications ?? []);

    if (p.type === 'publications') {
      const rows = [
        ...(s as any).cat2Journals.map((r: any) => ({ kind: 'Journal', venue: r.journalName, ...r })),
        ...(s as any).cat2Conferences.map((r: any) => ({ kind: 'Conference', venue: r.conferenceName, ...r })),
      ];
      for (const r of rows) {
        // Only published papers are in scope; status filter is exact (Published vs Indexed).
        const published = r.status === 'PUBLISHED' || r.status === 'INDEXED' || (r.status == null && r.indexed !== 'NONE');
        if (!published) continue;
        const sec = r.kind === 'Conference' ? ANALYTICS_PROOF_SECTION.conferences : ANALYTICS_PROOF_SECTION.journals;
        if (!vk.has(analyticsVKey(sec, r.title))) continue;
        const effStatus = r.status ?? (r.indexed !== 'NONE' ? 'INDEXED' : 'PUBLISHED');
        if (!statusOk(effStatus)) continue;
        if (!inRange(r.dateOfPub)) continue;
        items.push({
          ...base, type: r.kind, title: r.title ?? '', venue: r.venue ?? '', circulation: scopeLabel(r.scope),
          authors: r.authors ?? '', authorPosition: r.authorPosition ?? '', quartile: r.quartile ?? '',
          volume: r.volume ?? '', issueNo: r.issueNo ?? '', pageNos: r.pageNos ?? '',
          date: fmt(r.dateOfPub), month: monthOf(r.dateOfPub), issn: r.issn ?? '', impactFactor: r.impactFactor ?? '',
          indexed: INDEX_LABEL[r.indexed] ?? '', publisher: r.publisher ?? '', doi: r.doi ?? '',
          paperLink: r.paperLink ?? '', venueLink: r.venueLink ?? '', ugcCareListed: ugcLabel(r.ugcCareListed),
          status: titleCase(effStatus), _date: r.dateOfPub,
        });
      }
    } else if (p.type === 'patents') {
      for (const r of (s as any).cat2Patents) {
        if (!vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.patents, r.title))) continue;
        const mil: Record<string, any> = { FILED: r.dateOfFiling, PUBLISHED: r.dateOfPub, GRANTED: r.dateOfGrant };
        if (hasRange) {
          // Monthly report: include by the milestone whose DATE lands in the
          // window, not the patent's current record status — a patent published
          // in the window may since have advanced to Granted. The Status filter
          // selects which milestone; "All" considers filing / publication /
          // grant and reports the latest one that lands in-window. The reported
          // status is that milestone event (so "published or granted in October"
          // reads true even for a now-Granted patent published that month).
          const order = (!want || want === 'ALL') ? ['GRANTED', 'PUBLISHED', 'FILED'] : [want];
          const hitKey = order.find((k) => mil[k] && inRange(mil[k]));
          if (!hitKey) continue;
          const d = mil[hitKey];
          items.push({
            ...base, title: r.title ?? '', iprType: r.iprType ?? 'Patent', patentType: r.patentType ?? '',
            status: titleCase(hitKey), country: r.country ?? '', inventors: r.inventors ?? '', appNumber: r.appNumber ?? '',
            applicantIsInstitute: r.applicantIsInstitute ? 'Yes' : 'No',
            dateOfFiling: fmt(r.dateOfFiling), dateOfPub: fmt(r.dateOfPub), dateOfGrant: fmt(r.dateOfGrant),
            date: fmt(d), _date: d,
          });
        } else {
          // No date window: current-status view (unchanged behaviour).
          if (!statusOk(r.status)) continue;
          const d = r.status === 'FILED' ? r.dateOfFiling : r.status === 'PUBLISHED' ? r.dateOfPub : r.status === 'GRANTED' ? r.dateOfGrant : (r.dateOfGrant ?? r.dateOfPub ?? r.dateOfFiling);
          items.push({
            ...base, title: r.title ?? '', iprType: r.iprType ?? 'Patent', patentType: r.patentType ?? '',
            status: titleCase(r.status), country: r.country ?? '', inventors: r.inventors ?? '', appNumber: r.appNumber ?? '',
            applicantIsInstitute: r.applicantIsInstitute ? 'Yes' : 'No',
            dateOfFiling: fmt(r.dateOfFiling), dateOfPub: fmt(r.dateOfPub), dateOfGrant: fmt(r.dateOfGrant),
            date: fmt(d), _date: d,
          });
        }
      }
    } else {
      for (const r of (s as any).cat2Projects) {
        if (!vk.has(analyticsVKey(ANALYTICS_PROOF_SECTION.projects, r.title))) continue;
        if (!statusOk(r.status)) continue;
        const d = r.status === 'APPLIED' ? r.dateOfApplication : (r.dateOfGrant ?? r.dateOfApplication);
        if (!inRange(d)) continue;
        items.push({
          ...base, title: r.title ?? '', investigators: r.investigators ?? '', piDepartments: r.piDepartments ?? '',
          collaborativeDepartments: r.collaborativeDepartments ?? '', fundingAgency: r.fundingAgency ?? '', amountLakhs: r.amountLakhs ?? 0,
          role: r.role ?? '', status: titleCase(r.status), durationPeriod: r.durationPeriod ?? '',
          dateOfApplication: fmt(r.dateOfApplication), dateOfGrant: fmt(r.dateOfGrant), date: fmt(d), _date: d,
        });
      }
    }
  }

  items.sort((a, b) => (new Date(b._date || 0).getTime()) - (new Date(a._date || 0).getTime()));

  // Type-specific chart aggregates over the filtered items.
  const tally = (key: (x: any) => string, filter?: (x: any) => boolean) => {
    const m = new Map<string, number>();
    for (const it of items) { if (filter && !filter(it)) continue; const k = key(it) || '—'; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  };
  let charts: any = {};
  if (p.type === 'publications') {
    charts = { byType: tally((x) => x.type), byIndex: tally((x) => x.indexed), byQuartile: tally((x) => x.quartile || 'Unrated', (x) => x.type === 'Journal'), byDepartment: tally((x) => x.department) };
  } else if (p.type === 'patents') {
    charts = { byStage: tally((x) => x.status), byIprType: tally((x) => x.iprType), byDepartment: tally((x) => x.department) };
  } else {
    const funding = items.reduce((t, x) => t + (Number(x.amountLakhs) || 0), 0);
    charts = { byStatus: tally((x) => x.status), byDepartment: tally((x) => x.department), totalFundingLakhs: Math.round(funding * 100) / 100 };
  }

  const clean = items.map(({ _date, ...rest }) => rest);
  return { ok: true, data: { type: p.type, scope, year, from: p.from ?? null, to: p.to ?? null, status: want || 'ALL', count: clean.length, items: clean, charts } };
}

function detailParams(req: Request): { type: DetailType; from?: string; to?: string; status?: string; deptParam?: string; yq?: string } {
  const t = String(req.query.type ?? 'publications').toLowerCase();
  const type: DetailType = t === 'patents' ? 'patents' : t === 'projects' ? 'projects' : 'publications';
  const str = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : undefined);
  return { type, from: str('from'), to: str('to'), status: str('status'), deptParam: str('dept'), yq: str('academicYearId') };
}

export async function getAnalyticsDetail(req: Request, res: Response) {
  const r = await computeAnalyticsDetail(req.user!, detailParams(req));
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return res.json(r.data);
}

// GET /reports/analytics-detail-excel — the same filtered items as a workbook.
export async function exportAnalyticsDetailExcel(req: Request, res: Response) {
  const params = detailParams(req);
  const r = await computeAnalyticsDetail(req.user!, params);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  const d = r.data;

  // Publications mirror the Reports → Publications export (the IQAC 22-column
  // layout); patents and projects carry their full field set. All date-filtered.
  const COLS: Record<DetailType, { header: string; key: string }[]> = {
    publications: [
      { header: 'Faculty Name', key: 'faculty' }, { header: 'Designation', key: 'designation' }, { header: 'Publication Type', key: 'type' },
      { header: 'Level of Circulation', key: 'circulation' }, { header: 'Authors (as appeared in the paper)', key: 'authors' },
      { header: 'Author Position', key: 'authorPosition' }, { header: 'Quartile', key: 'quartile' }, { header: 'Title of the Article', key: 'title' },
      { header: 'Name of the Journal / Conference', key: 'venue' }, { header: 'Volume', key: 'volume' }, { header: 'Issue No', key: 'issueNo' },
      { header: 'Page Nos', key: 'pageNos' }, { header: 'Date of Publication', key: 'date' }, { header: 'Month of Publication', key: 'month' },
      { header: 'ISSN No. / ISBN No.', key: 'issn' }, { header: 'Impact Factor', key: 'impactFactor' }, { header: 'Indexed In', key: 'indexed' },
      { header: 'Name of the Publisher', key: 'publisher' }, { header: 'DOI Link', key: 'doi' }, { header: 'Link of the Paper', key: 'paperLink' },
      { header: 'Link of the Journal / Conference', key: 'venueLink' }, { header: 'UGC Care Listed', key: 'ugcCareListed' },
    ],
    patents: [
      { header: 'Faculty Name', key: 'faculty' }, { header: 'Designation', key: 'designation' }, { header: 'Department', key: 'department' },
      { header: 'Title', key: 'title' }, { header: 'IPR Type', key: 'iprType' }, { header: 'Patent Type', key: 'patentType' },
      { header: 'Status', key: 'status' }, { header: 'Country', key: 'country' }, { header: 'Inventors', key: 'inventors' },
      { header: 'Application No', key: 'appNumber' }, { header: 'Institute as Applicant', key: 'applicantIsInstitute' },
      { header: 'Date of Filing', key: 'dateOfFiling' }, { header: 'Date of Publication', key: 'dateOfPub' }, { header: 'Date of Grant', key: 'dateOfGrant' },
    ],
    projects: [
      { header: 'Faculty Name', key: 'faculty' }, { header: 'Designation', key: 'designation' }, { header: 'Department', key: 'department' },
      { header: 'Title', key: 'title' },
      { header: 'Investigators', key: 'investigators' },
      { header: 'Dept. of PI', key: 'piDepartments' },
      { header: 'Collaborative Depts.', key: 'collaborativeDepartments' },
      { header: 'Funding Agency', key: 'fundingAgency' }, { header: 'Amount (Lakhs)', key: 'amountLakhs' },
      { header: 'Role', key: 'role' }, { header: 'Status', key: 'status' }, { header: 'Duration', key: 'durationPeriod' },
      { header: 'Date of Application', key: 'dateOfApplication' }, { header: 'Date of Grant / Sanction', key: 'dateOfGrant' },
    ],
  };
  const cols = COLS[params.type];
  const rows = [cols.map((c) => c.header), ...d.items.map((it: any) => cols.map((c) => it[c.key] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = cols.map((c) => ({ wch: c.key === 'title' ? 40 : c.key === 'venue' || c.key === 'fundingAgency' ? 26 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, params.type.slice(0, 28));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const range = d.from || d.to ? `-${d.from ?? 'start'}_to_${d.to ?? 'end'}` : '';
  const fname = `analytics-${params.type}${range}.xlsx`.replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${fname}`);
  return res.send(buf);
}

