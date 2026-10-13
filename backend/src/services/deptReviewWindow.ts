import { Quarter } from '@prisma/client';
import prisma from '../utils/prismaClient';

// Date helpers for the per-department review window (2026-10-08). Window dates
// are stored as a calendar date at midnight UTC (05:30 IST that day), the same
// convention ReviewWindow and the submit gate use. "The window" means the whole
// span of calendar days from startDate through endDate inclusive, in IST.

const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30, no DST

// 00:00 IST on the calendar day of `d`.
function istStartOfDay(d: Date): Date {
  const wall = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - IST_OFFSET_MS);
}

// 00:00 IST on the day AFTER the calendar day of `d` (exclusive upper bound /
// the day the follow-up mail fires).
export function dayAfterInIndia(d: Date): Date {
  const wall = new Date(d.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1) - IST_OFFSET_MS);
}

// True while `at` is within [startDate 00:00 IST, endDate+1 00:00 IST).
export function windowCoversDay(startDate: Date, endDate: Date, at: Date): boolean {
  return at >= istStartOfDay(startDate) && at < dayAfterInIndia(endDate);
}

// Whole IST calendar days from `a` to `b` (b - a). Negative if b is before a.
export function istDaysBetween(a: Date, b: Date): number {
  return Math.round((istStartOfDay(b).getTime() - istStartOfDay(a).getTime()) / (24 * 60 * 60 * 1000));
}

// Do `at` and `other` fall on the same IST calendar day?
export function sameIndiaDay(a: Date, b: Date): boolean {
  const wa = new Date(a.getTime() + IST_OFFSET_MS);
  const wb = new Date(b.getTime() + IST_OFFSET_MS);
  return wa.getUTCFullYear() === wb.getUTCFullYear()
    && wa.getUTCMonth() === wb.getUTCMonth()
    && wa.getUTCDate() === wb.getUTCDate();
}

// Quarter review order, and the quarter a department may be reviewed for now:
// the earliest quarter whose fill window has ended and whose feedback has not
// been issued yet. Used to gate the HoD's "issue feedback" to one quarter at a
// time, in order.
export const QUARTER_ORDER: Quarter[] = [Quarter.Q1, Quarter.Q2, Quarter.Q3, Quarter.Q4];

// Whether the department uses fill windows this year — if not, the quarterly
// review cadence is not enforced (legacy: the HoD may issue any period freely).
export async function deptHasWindows(
  departmentId: string | null | undefined,
  academicYearId: string,
): Promise<boolean> {
  if (!departmentId) return false;
  return (await prisma.deptReviewWindow.count({ where: { enabled: true, departmentId, academicYearId } })) > 0;
}

export async function endedQuartersFor(
  departmentId: string | null | undefined,
  academicYearId: string,
  at: Date = new Date(),
): Promise<Set<Quarter>> {
  const ended = new Set<Quarter>();
  if (!departmentId) return ended;
  const windows = await prisma.deptReviewWindow.findMany({
    where: { enabled: true, departmentId, academicYearId },
    select: { quarter: true, endDate: true },
  });
  for (const w of windows) if (at >= dayAfterInIndia(new Date(w.endDate))) ended.add(w.quarter);
  return ended;
}

/**
 * Lock-after-window (2026-10-14 model). Faculty FILL during the HoD's window;
 * once it ends the quarter is closed for the HoD to review, so the draft is
 * read-only until the HoD opens the next quarter's window. Returns the latest
 * (operative) window when filling is locked, or null when editing is allowed
 * (we are on/ before its end day, or no window has been configured yet).
 */
export async function fillLockAfterWindow(
  departmentId: string | null | undefined,
  academicYearId: string,
  at: Date = new Date(),
): Promise<{ quarter: Quarter; endDate: Date } | null> {
  if (!departmentId) return null;
  const windows = await prisma.deptReviewWindow.findMany({
    where: { departmentId, academicYearId, enabled: true },
    select: { quarter: true, endDate: true },
  });
  if (!windows.length) return null; // no window configured -> editable (opt-in)
  // The operative window is the one set latest (largest end date). Editing is
  // allowed through its end day; locked from the day after.
  const latest = windows.reduce((a, b) => (new Date(b.endDate) > new Date(a.endDate) ? b : a));
  const lockedFrom = dayAfterInIndia(new Date(latest.endDate));
  return at >= lockedFrom ? { quarter: latest.quarter, endDate: latest.endDate } : null;
}

/**
 * The department's review window that is active right now, if any (legacy
 * during-window check, retained for reference).
 */
export async function activeDeptWindow(
  departmentId: string | null | undefined,
  academicYearId: string,
  at: Date = new Date(),
): Promise<{ quarter: Quarter; startDate: Date; endDate: Date } | null> {
  if (!departmentId) return null;
  const windows = await prisma.deptReviewWindow.findMany({
    where: { departmentId, academicYearId, enabled: true },
    select: { quarter: true, startDate: true, endDate: true },
  });
  return windows.find((w) => windowCoversDay(w.startDate, w.endDate, at)) ?? null;
}
