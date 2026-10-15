import { FeedbackPeriod } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { dayAfterInIndia } from './deptReviewWindow';

// Quarterly review cadence driven by the FIXED calendar (2026-10-15 model).
// Quarters follow the Jul-Jun academic year: Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar,
// Q4 Apr-Jun. A quarter becomes reviewable the day after its calendar end; the
// HoD then reviews it and issues feedback, in order, one quarter at a time.

export const QUARTER_ORDER: FeedbackPeriod[] = ['Q1', 'Q2', 'Q3', 'Q4'] as FeedbackPeriod[];

const IST_OFFSET_MS = 330 * 60 * 1000;

// Last calendar day of a quarter for the given academic year (start = 1 Jul YYYY).
export function calendarQuarterEnd(quarter: FeedbackPeriod, ayStart: Date): Date {
  const y = new Date(ayStart.getTime() + IST_OFFSET_MS).getUTCFullYear();
  switch (quarter) {
    case 'Q1': return new Date(Date.UTC(y, 8, 30));      // 30 Sep YYYY
    case 'Q2': return new Date(Date.UTC(y, 11, 31));     // 31 Dec YYYY
    case 'Q3': return new Date(Date.UTC(y + 1, 2, 31));  // 31 Mar YYYY+1
    default:   return new Date(Date.UTC(y + 1, 5, 30));  // 30 Jun YYYY+1 (Q4)
  }
}

// Quarters whose calendar end has passed (reviewable).
export function endedCalendarQuarters(ayStart: Date, now: Date = new Date()): Set<string> {
  const ended = new Set<string>();
  for (const q of QUARTER_ORDER) {
    if (now >= dayAfterInIndia(calendarQuarterEnd(q, ayStart))) ended.add(q);
  }
  return ended;
}

// The quarter the HoD may review/issue now: earliest ended quarter not yet
// issued. null when none is due (next quarter has not ended yet).
export async function currentReviewQuarter(
  submissionId: string,
  ayStart: Date,
  now: Date = new Date(),
): Promise<FeedbackPeriod | null> {
  const ended = endedCalendarQuarters(ayStart, now);
  const issued = new Set(
    (await prisma.feedback.findMany({
      where: { submissionId, status: 'ISSUED', period: { in: QUARTER_ORDER } },
      select: { period: true },
    })).map((f) => f.period)
  );
  return QUARTER_ORDER.find((q) => ended.has(q) && !issued.has(q)) ?? null;
}
