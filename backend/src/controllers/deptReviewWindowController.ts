import { Request, Response } from 'express';
import { Quarter, RoleType } from '@prisma/client';
import { z } from 'zod';
import prisma from '../utils/prismaClient';
import { CONFIG, SEES_ALL, deptIdsFor, hasAnyRole } from '../utils/roles';

// Per-department review windows (W8, 2026-10-08). The dean defines each
// quarter's bounds + hard deadline on ReviewWindow; a department's HoD sets
// their own review week inside those bounds on DeptReviewWindow. During the
// dept window the department's drafts are frozen; the day after it ends the
// cron mails that department (see cron/quarterlySnapshot.runDueDeptReviewWindows).

const ALL = CONFIG.concat(SEES_ALL); // dean + principal may act on any department

// The departments this caller may set/see windows for: own HoD department(s),
// or every department for the dean / principal (null = all).
function allowedDeptIds(req: Request): string[] | null {
  if (hasAnyRole(req.user!, ALL)) return null; // all departments
  return deptIdsFor(req.user!, [RoleType.HOD]);
}

const upsertSchema = z.object({
  academicYearId: z.string().min(1),
  departmentId: z.string().min(1),
  quarter: z.nativeEnum(Quarter),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  enabled: z.boolean().optional(),
});

// GET /dept-review-windows?academicYearId=...&departmentId=...
// Returns the caller's department window set for the year (all four quarters it
// has), each paired with the dean's quarter bounds so the UI can constrain the
// date pickers. HoD -> own dept(s); dean/principal -> any (optional filter).
export async function listDeptReviewWindows(req: Request, res: Response) {
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  if (!academicYearId) return res.status(400).json({ error: 'academicYearId is required' });

  const allowed = allowedDeptIds(req);
  const filterDept = typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined;
  if (allowed && filterDept && !allowed.includes(filterDept)) {
    return res.status(403).json({ error: 'Not your department' });
  }
  const deptIds = filterDept ? [filterDept] : allowed; // null => all departments

  const [windows, deanWindows] = await Promise.all([
    prisma.deptReviewWindow.findMany({
      where: { academicYearId, ...(deptIds ? { departmentId: { in: deptIds } } : {}) },
      orderBy: [{ departmentId: 'asc' }, { quarter: 'asc' }],
    }),
    prisma.reviewWindow.findMany({ where: { academicYearId } }),
  ]);

  // The dean's bounds per quarter, so the client knows the allowed range.
  const bounds = Object.fromEntries(
    deanWindows.map((w) => [w.quarter, { startDate: w.startDate, endDate: w.endDate, enabled: w.enabled }])
  );
  return res.json({ windows, deanBounds: bounds });
}

// PUT /dept-review-windows  { academicYearId, departmentId, quarter, startDate, endDate, enabled? }
// A HoD sets their department's review week for a quarter; it must sit inside
// the dean's quarter window. Dean/principal may set it for any department.
export async function upsertDeptReviewWindow(req: Request, res: Response) {
  const { academicYearId, departmentId, quarter, startDate, endDate, enabled } = upsertSchema.parse(req.body);

  const allowed = allowedDeptIds(req);
  if (allowed && !allowed.includes(departmentId)) {
    return res.status(403).json({ error: 'You can only set your own department\'s review window' });
  }

  if (endDate < startDate) {
    return res.status(400).json({ error: 'End date must be on or after the start date' });
  }

  // Bounds: the dean must have defined this quarter, and the dept window must
  // fit inside it (start >= dean start, end <= dean deadline).
  const dean = await prisma.reviewWindow.findUnique({
    where: { academicYearId_quarter: { academicYearId, quarter } },
    select: { startDate: true, endDate: true, enabled: true },
  });
  if (!dean || !dean.enabled) {
    return res.status(400).json({ error: `The dean has not defined ${quarter}'s review window yet` });
  }
  if (startDate < dean.startDate || endDate > dean.endDate) {
    return res.status(400).json({
      error: `${quarter} window must fall within the dean's dates `
        + `(${dean.startDate.toISOString().slice(0, 10)} to ${dean.endDate.toISOString().slice(0, 10)})`,
    });
  }

  const row = await prisma.deptReviewWindow.upsert({
    where: { academicYearId_departmentId_quarter: { academicYearId, departmentId, quarter } },
    create: { academicYearId, departmentId, quarter, startDate, endDate, enabled: enabled ?? true, setById: req.user!.id },
    // Editing the dates re-opens the mail guard so a corrected window can fire again.
    update: { startDate, endDate, ...(enabled === undefined ? {} : { enabled }), setById: req.user!.id, lastMailAt: null },
  });
  return res.json(row);
}

// DELETE /dept-review-windows/:id  (HoD own dept, or dean/principal)
export async function deleteDeptReviewWindow(req: Request, res: Response) {
  const w = await prisma.deptReviewWindow.findUnique({ where: { id: req.params.id } });
  if (!w) return res.status(404).json({ error: 'Not found' });
  const allowed = allowedDeptIds(req);
  if (allowed && !allowed.includes(w.departmentId)) {
    return res.status(403).json({ error: 'Not your department' });
  }
  await prisma.deptReviewWindow.delete({ where: { id: w.id } });
  return res.json({ ok: true });
}
