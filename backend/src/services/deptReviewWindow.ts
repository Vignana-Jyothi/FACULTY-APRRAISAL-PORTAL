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

// Do `at` and `other` fall on the same IST calendar day?
export function sameIndiaDay(a: Date, b: Date): boolean {
  const wa = new Date(a.getTime() + IST_OFFSET_MS);
  const wb = new Date(b.getTime() + IST_OFFSET_MS);
  return wa.getUTCFullYear() === wb.getUTCFullYear()
    && wa.getUTCMonth() === wb.getUTCMonth()
    && wa.getUTCDate() === wb.getUTCDate();
}

/**
 * The department's review window that is active (frozen) right now, if any.
 * While one is active the department's drafts are read-only; it auto-clears
 * once the window ends.
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
