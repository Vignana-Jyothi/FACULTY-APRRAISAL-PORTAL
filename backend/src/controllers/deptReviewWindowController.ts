import { Request, Response } from 'express';
import { Quarter, RoleType } from '@prisma/client';
import { z } from 'zod';
import prisma from '../utils/prismaClient';
import { CONFIG, SEES_ALL, deptIdsFor, hasAnyRole } from '../utils/roles';
import { enqueueEmail } from '../services/emailService';

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

// A draft is "stale" after this many days without an edit (matches the weekly
// draft-reminder threshold).
const STALE_DAYS = 7;

// GET /dept-review-windows/activity?academicYearId=...&departmentId=...
// The HoD's inactivity list: every faculty in the department with their latest
// draft's last-edit time and a status, so the HoD can see who has gone quiet
// and nudge them (Phase 2).
export async function getDeptActivity(req: Request, res: Response) {
  const academicYearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
  if (!academicYearId) return res.status(400).json({ error: 'academicYearId is required' });

  const allowed = allowedDeptIds(req);
  const filterDept = typeof req.query.departmentId === 'string' ? req.query.departmentId : undefined;
  if (allowed && filterDept && !allowed.includes(filterDept)) {
    return res.status(403).json({ error: 'Not your department' });
  }
  const deptIds = filterDept ? [filterDept] : allowed; // null => all departments

  const faculty = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(deptIds ? { departmentId: { in: deptIds } } : {}),
      userRoles: { some: { role: RoleType.FACULTY } },
    },
    select: {
      id: true, name: true, employeeCode: true, email: true, emailOptIn: true, departmentId: true,
      appraisals: {
        where: { academicYearId },
        orderBy: { submissionNumber: 'desc' },
        take: 1,
        select: { id: true, status: true, updatedAt: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  const now = Date.now();
  const rows = faculty.map((f) => {
    const sub = f.appraisals[0] ?? null;
    const daysSinceEdit = sub ? Math.floor((now - new Date(sub.updatedAt).getTime()) / 86400000) : null;
    const status = !sub ? 'no-submission'
      : sub.status !== 'DRAFT' ? sub.status.toLowerCase()
      : (daysSinceEdit ?? 0) >= STALE_DAYS ? 'stale'
      : 'active';
    return {
      userId: f.id, name: f.name, employeeCode: f.employeeCode, email: f.email,
      optedOut: !f.emailOptIn, hasSubmission: !!sub,
      lastEditedAt: sub?.updatedAt ?? null, daysSinceEdit, status,
    };
  });
  return res.json({ rows });
}

const remindSchema = z.object({ userId: z.string().min(1), academicYearId: z.string().min(1) });

// POST /dept-review-windows/remind  { userId, academicYearId }
// Manual nudge from the HoD to one faculty in their department (alongside the
// automatic weekly reminder). Deduped to at most one per faculty per day.
export async function remindDeptFaculty(req: Request, res: Response) {
  const { userId, academicYearId } = remindSchema.parse(req.body);
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, departmentId: true, email: true, emailOptIn: true },
  });
  if (!target) return res.status(404).json({ error: 'Faculty not found' });

  const allowed = allowedDeptIds(req);
  if (allowed && (!target.departmentId || !allowed.includes(target.departmentId))) {
    return res.status(403).json({ error: 'That faculty is not in your department' });
  }
  if (!target.email) return res.status(400).json({ error: 'That faculty has no email address on file' });

  if (!target.emailOptIn) {
    return res.json({ queued: false, message: 'Faculty has opted out of emails' });
  }

  // At most one manual reminder per faculty per day. enqueueEmail returns the
  // existing row's id on a dedupe hit, so check for the key ourselves first.
  const dayStamp = new Date().toISOString().slice(0, 10);
  const dedupeKey = `manual_draft_reminder:${userId}:${academicYearId}:${dayStamp}`;
  if (await prisma.emailNotification.findUnique({ where: { dedupeKey }, select: { id: true } })) {
    return res.json({ queued: false, message: 'Already reminded today' });
  }

  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { label: true } });
  await enqueueEmail({
    toUserId: userId,
    template: 'draft_reminder',
    payload: { name: target.name, year: year?.label ?? 'the current year' },
    dedupeKey,
    honorOptIn: true,
  });
  return res.json({ queued: true, message: 'Reminder sent' });
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
