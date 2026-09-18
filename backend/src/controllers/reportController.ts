import { Request, Response } from 'express';
import { RoleType, SubmissionStatus } from '@prisma/client';
import prisma from '../utils/prismaClient';
import * as XLSX from 'xlsx';
import { computeScore } from '../services/scoringEngine';
import { TRACKING_INCLUDE } from '../services/trackingService';
import { AuthUser } from '../middleware/auth';
import { CONFIG, deptIdsFor, hasAnyRole } from '../utils/roles';
import {
  canSeeReviewerAssessment,
  seesReviewerAssessmentEverywhere,
  stripReviewerAssessment,
} from '../utils/reviewVisibility';

// Neutralise spreadsheet formula injection. A cell whose text begins with
// = + - @ (or a leading tab/CR that Excel trims first) is run as a formula by
// Excel / LibreOffice — e.g. =HYPERLINK / =WEBSERVICE can exfiltrate data or
// chain a command. Faculty control name and designation, so prefix any such
// value with a single quote, which forces the cell to be read as text.
function csvSafe<T>(v: T): T | string {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return v;
}

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

  const reviews = await prisma.appraisalReview.findMany({
    where: {
      submission: {
        ...(academicYear ? { academicYearId: academicYear.id } : {}),
        user: reportUserWhere(req.user!, typeof dept === 'string' ? dept : undefined),
      },
    },
    include: {
      submission: {
        include: {
          user: { select: { name: true, employeeCode: true, designation: true, departmentId: true, department: true } },
          academicYear: { select: { label: true } },
        },
      },
    },
  });

  // Columns mirror the Faculty-wise Breakdown table. The two Cat 6 columns are
  // blank for a caller who may not see the reviewer's assessment of that
  // faculty — the dean exports institute-wide and gets the /500 only.
  const rows = reviews.map((r) => {
    const cat6Visible = canSeeReviewerAssessment(
      req.user!,
      r.submission.userId,
      r.submission.user.departmentId,
    );
    return {
      'Name': csvSafe(r.submission.user.name),
      'Employee Code': csvSafe(r.submission.user.employeeCode),
      'Designation': csvSafe(r.submission.user.designation ?? ''),
      'Department': csvSafe(r.submission.user.department?.name ?? ''),
      'Academic Year': csvSafe(r.submission.academicYear.label),
      'C1': r.cat1Score ?? '',
      'C2': r.cat2Score ?? '',
      'C3': r.cat3Score ?? '',
      'C4': r.cat4Score ?? '',
      'C5': r.cat5Score ?? '',
      'Total': r.totalScore ?? '',
      'Score by HoD': cat6Visible
        ? ((r.cat6Punctuality ?? 0) + (r.cat6Professionalism ?? 0) + (r.cat6Willingness ?? 0) + (r.cat6Cordiality ?? 0) + (r.cat6Classroom ?? 0))
        : '',
      'Reviewed': cat6Visible ? (r.grandTotal ?? '') : '',
      'Status': r.status,
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
