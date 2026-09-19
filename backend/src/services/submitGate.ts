import { Quarter } from '@prisma/client';
import prisma from '../utils/prismaClient';

/**
 * When a faculty may submit the year's appraisal (owner decision 2026-09-19).
 *
 * The draft carries across Q1-Q4; there is no quarterly submission. Submitting
 * opens when the academic year's enabled Q4 review window ends. With no enabled
 * Q4 window configured, the academic year's own end date stands in.
 *
 * `submissionOpen` on the year is a separate, older gate and still applies —
 * this only answers "from when".
 *
 * Returns null only when the academic year does not exist.
 */
export async function submitOpensAt(academicYearId: string): Promise<Date | null> {
  const [q4, year] = await Promise.all([
    prisma.reviewWindow.findUnique({
      where: { academicYearId_quarter: { academicYearId, quarter: Quarter.Q4 } },
      select: { endDate: true, enabled: true },
    }),
    prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { endDate: true } }),
  ]);
  if (!year) return null;
  return dayAfterInIndia(q4?.enabled ? q4.endDate : year.endDate);
}

// Offset of Indian Standard Time from UTC, in milliseconds (+05:30, no DST).
const IST_OFFSET_MS = 330 * 60 * 1000;

/**
 * "Until the Q4 window ends" means the whole last day. Window and year end
 * dates are stored as a calendar date (midnight UTC), which is 05:30 IST on that
 * same day — opening then would let faculty submit during the last day of Q4.
 * So submission opens at 00:00 IST on the following day.
 */
export function dayAfterInIndia(end: Date): Date {
  const wall = new Date(end.getTime() + IST_OFFSET_MS); // the calendar date as seen in India
  const nextMidnightUtc = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1);
  return new Date(nextMidnightUtc - IST_OFFSET_MS);
}

/** How the opening date is shown in messages: 30 Jun 2027. */
export function formatOpensAt(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
