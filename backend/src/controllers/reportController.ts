import { Request, Response } from 'express';
import { RoleType, SubmissionStatus, FeedbackPeriod, Cadre } from '@prisma/client';
import { deriveCadre, computeExperienceYears, CADRE_LABEL } from '../services/cadreEngine';

// Seniormost first for the IQAC sheet ordering.
const CADRE_RANK: Record<Cadre, number> = {
  PROFESSOR: 4, ASSOCIATE_PROFESSOR: 3, SR_ASSISTANT_PROFESSOR: 2, ASSISTANT_PROFESSOR: 1,
};
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
    .sort((a, b) => (((a as any).user.name ?? '') as string).localeCompare((b as any).user.name ?? ''))
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
  const chosen = [...picked.values()].sort((a, b) => (a as any).user.name.localeCompare((b as any).user.name));

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
      user: { select: { id: true, name: true, employeeCode: true, designation: true, department: { select: { name: true } } } },
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
    .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? ''));

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
  const rankOf = (u: any) => { const c = deriveCadre(u.designation); return c ? CADRE_RANK[c] : 0; };
  const expOf = (u: any) => computeExperienceYears(u.dateOfJoining);
  const rows = [...picked.values()]
    .sort((a, b) => {
      const ua = (a as any).user, ub = (b as any).user;
      return rankOf(ub) - rankOf(ua)
        || expOf(ub) - expOf(ua)
        || (ua.name ?? '').localeCompare(ub.name ?? '');
    })
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
  const rankOf = (u: any) => { const c = deriveCadre(u.designation); return c ? CADRE_RANK[c] : 0; };
  const expOf = (u: any) => computeExperienceYears(u.dateOfJoining);
  const people = [...picked.values()].sort((a, b) => {
    const ua = (a as any).user, ub = (b as any).user;
    return rankOf(ub) - rankOf(ua) || expOf(ub) - expOf(ua) || (ua.name ?? '').localeCompare(ub.name ?? '');
  });

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

