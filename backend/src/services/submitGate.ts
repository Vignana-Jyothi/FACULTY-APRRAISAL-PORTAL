import prisma from '../utils/prismaClient';
import { calendarQuarterEnd } from './quarterReview';

/**
 * When a faculty may submit the year's appraisal.
 *
 * The draft carries across Q1-Q4; there is no quarterly submission. Submitting
 * opens the day after Q4's fixed calendar end (30 Jun), the day after the whole
 * year is over (2026-10-15 model — no review windows).
 *
 * `submissionOpen` on the year is a separate, older gate and still applies —
 * this only answers "from when".
 *
 * Returns null only when the academic year does not exist.
 */
export async function submitOpensAt(academicYearId: string): Promise<Date | null> {
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId }, select: { startDate: true } });
  if (!year) return null;
  return dayAfterInIndia(calendarQuarterEnd('Q4', year.startDate));
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
