import cron from 'node-cron';
import { Quarter } from '@prisma/client';
import prisma from '../utils/prismaClient';
import { enqueueEmail } from '../services/emailService';
import { renderTemplate, TEMPLATE_SUBJECTS } from '../services/emailTemplates';
import { TRACKING_INCLUDE, loadTrackingContext, computeRow, latestPerFaculty, type TrackingRow } from '../services/trackingService';
import { computeScore } from '../services/scoringEngine';
import { categoryRemarks } from '../services/categoryRemarks';
import { targetStatus, targetEvidence } from '../services/targetStatus';
import { countedItems } from '../services/trackingEngine';
import { voidExpiredProofs } from './proofDeadline';

/**
 * Quarterly criteria-tracking scheduler. On the last day of each fixed calendar
 * quarter (30 Sep / 31 Dec / 31 Mar / 30 Jun, 09:00 server time), snapshots
 * every faculty's cadre/tier/eligibility standing for the open AY and emails
 * them their quarterly feedback. Quarterly results are provisional; the annual
 * submission is the final one.
 */

// Fixed calendar quarters aligned to the assessment period (01-Jul -> 30-Jun).
export function currentQuarter(date: Date = new Date()): Quarter {
  const m = date.getMonth(); // 0=Jan
  if (m >= 6 && m <= 8) return Quarter.Q1; // Jul-Sep
  if (m >= 9 && m <= 11) return Quarter.Q2; // Oct-Dec
  if (m >= 0 && m <= 2) return Quarter.Q3; // Jan-Mar
  return Quarter.Q4; // Apr-Jun
}

/**
 * The quarterly_feedback email payload for one faculty. Exported so a
 * single-faculty test send renders exactly what the job sends. `sub` must be
 * loaded with TRACKING_INCLUDE (it carries every category table).
 */
export function buildQuarterlyPayload(sub: any, row: TrackingRow, yearLabel: string, quarter: Quarter) {
  const score = computeScore(sub);
  // The payload is stored on the EmailNotification row and re-rendered on a
  // retry, so it carries only what the faculty may see. No cadre, tier or
  // eligibility, and not the tracking engine's requirement rows: their total
  // "actual" is the reviewer's /550 grand total once a review exists.
  return {
    name: row.faculty.name,
    year: yearLabel,
    quarter,
    // Cat 1-5 self-assessed score vs half of each category's maximum.
    categories: categoryRemarks(score),
    // Each target: required, current, what is left, plus a summary. Measured
    // against the faculty's own /500 total, never the reviewer's /550.
    targets: targetStatus(row.eligibility.requirements, score.selfTotal),
    // The papers / patents / projects behind those counts, one line each.
    evidence: targetEvidence(countedItems(sub)),
  };
}

export const quarterlyDedupeKey = (userId: string, academicYearId: string, quarter: Quarter) =>
  `quarterly_feedback:${userId}:${academicYearId}:${quarter}`;

interface YearItem { sub: any; row: TrackingRow }

// Every faculty's latest submission in the AY, with its computed tracking row.
async function loadYearItems(academicYearId: string) {
  const year = await prisma.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) return null;
  const ctx = await loadTrackingContext(academicYearId);
  const submissions = await prisma.appraisalSubmission.findMany({
    where: { academicYearId },
    include: TRACKING_INCLUDE,
    orderBy: { submissionNumber: 'desc' },
  });
  const items: YearItem[] = latestPerFaculty(submissions).map((sub) => ({
    sub,
    row: computeRow(sub, ctx, year.startDate),
  }));
  return { year, items };
}

/**
 * The one recipient selection for the quarterly mail: of these items, the ones
 * `enqueueEmail` would actually queue — the user has an address, has not opted
 * out, and has not already been sent this quarter's feedback (dedupe key). The
 * job, the dean's preview and a release all go through here.
 */
async function selectMailable(items: YearItem[], academicYearId: string, quarter: Quarter): Promise<YearItem[]> {
  if (!items.length) return [];
  const userIds = items.map((i) => i.row.faculty.id);
  const [users, sent] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, emailOptIn: true } }),
    prisma.emailNotification.findMany({
      where: { dedupeKey: { in: userIds.map((id) => quarterlyDedupeKey(id, academicYearId, quarter)) } },
      select: { dedupeKey: true },
    }),
  ]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const sentKeys = new Set(sent.map((r) => r.dedupeKey));
  return items.filter((i) => {
    const u = byId.get(i.row.faculty.id);
    return !!u?.email && u.emailOptIn && !sentKeys.has(quarterlyDedupeKey(u.id, academicYearId, quarter));
  });
}

// Queue the quarterly_feedback mail for each item. Same payload and dedupe key
// whether the job or a release sends it, so the two can never double-send.
async function enqueueQuarterly(items: YearItem[], academicYearId: string, yearLabel: string, quarter: Quarter) {
  let queued = 0;
  for (const { sub, row } of items) {
    try {
      const id = await enqueueEmail({
        toUserId: row.faculty.id,
        template: 'quarterly_feedback',
        payload: buildQuarterlyPayload(sub, row, yearLabel, quarter),
        dedupeKey: quarterlyDedupeKey(row.faculty.id, academicYearId, quarter),
        honorOptIn: true,
      });
      if (id) queued++;
    } catch (e) {
      console.error('[email] enqueue quarterly_feedback failed:', e);
    }
  }
  return queued;
}

/**
 * Snapshot every faculty's standing for the AY and quarter. `sendEmail` decides
 * whether the quarterly feedback mail is queued as well — an unarmed review
 * window snapshots but holds the mail.
 */
async function snapshotYear(
  academicYearId: string,
  quarter: Quarter,
  opts: { sendEmail: boolean } = { sendEmail: true },
): Promise<number> {
  const loaded = await loadYearItems(academicYearId);
  if (!loaded) return 0;
  const { year, items } = loaded;

  for (const { row } of items) {
    await prisma.trackingSnapshot.upsert({
      where: { userId_academicYearId_quarter: { userId: row.faculty.id, academicYearId, quarter } },
      create: {
        userId: row.faculty.id, academicYearId, quarter,
        cadre: row.cadre ?? null, expYears: row.expYears,
        actuals: row.actuals as any, eligible: row.eligibility.eligible, tier: row.tier ?? null,
      },
      update: {
        cadre: row.cadre ?? null, expYears: row.expYears,
        actuals: row.actuals as any, eligible: row.eligibility.eligible, tier: row.tier ?? null,
      },
    });
  }

  // Auto-feedback email (provisional quarterly standing) — sent directly to
  // the faculty, no HoD step. Category remarks + target status.
  if (opts.sendEmail) {
    await enqueueQuarterly(await selectMailable(items, academicYearId, quarter), academicYearId, year.label, quarter);
  }
  return items.length;
}

export interface WindowMailPreview {
  recipients: number;
  sample: { to: string; subject: string; html: string } | null;
}

/**
 * What a review window's mail would be: how many faculty it reaches, and one
 * of those emails rendered in full. Reads only — nothing is queued or sent.
 */
export async function previewWindowMail(academicYearId: string, quarter: Quarter): Promise<WindowMailPreview> {
  const loaded = await loadYearItems(academicYearId);
  if (!loaded) return { recipients: 0, sample: null };
  const mailable = await selectMailable(loaded.items, academicYearId, quarter);
  if (!mailable.length) return { recipients: 0, sample: null };
  const first = mailable[0];
  const payload = buildQuarterlyPayload(first.sub, first.row, loaded.year.label, quarter);
  const user = await prisma.user.findUnique({ where: { id: first.row.faculty.id }, select: { email: true } });
  return {
    recipients: mailable.length,
    sample: {
      to: user?.email ?? '',
      subject: TEMPLATE_SUBJECTS.quarterly_feedback(payload),
      html: renderTemplate('quarterly_feedback', payload),
    },
  };
}

/** Recipient count only — the selection `previewWindowMail` uses, without rendering. */
export async function countWindowRecipients(academicYearId: string, quarter: Quarter): Promise<number> {
  const loaded = await loadYearItems(academicYearId);
  if (!loaded) return 0;
  return (await selectMailable(loaded.items, academicYearId, quarter)).length;
}

/** Queue a held window's mail now. Dedupe keys make a repeat a no-op. */
export async function releaseWindowMail(academicYearId: string, quarter: Quarter): Promise<number> {
  const loaded = await loadYearItems(academicYearId);
  if (!loaded) return 0;
  const mailable = await selectMailable(loaded.items, academicYearId, quarter);
  return enqueueQuarterly(mailable, academicYearId, loaded.year.label, quarter);
}

// Run the snapshot for a given AY (or all open AYs) for the current quarter.
export async function runQuarterlySnapshot(academicYearId?: string, at: Date = new Date()) {
  const quarter = currentQuarter(at);
  const years = academicYearId
    ? [{ id: academicYearId }]
    : await prisma.academicYear.findMany({ where: { submissionOpen: true }, select: { id: true } });

  let total = 0;
  for (const y of years) total += await snapshotYear(y.id, quarter);
  console.log(`[cron] Quarterly snapshot (${quarter}) done — ${total} faculty`);
  return { quarter, faculty: total };
}

export interface SnapshotPreview {
  quarter: Quarter;
  faculty: number;
  recipients: number;
  optedOut: number;
  alreadySent: number;
  noEmail: number;
}

/**
 * Dry run for the dean's "Run snapshot now" button. Counts who WOULD be emailed
 * without writing a snapshot or queueing anything. The manual trigger is a mass
 * send to real faculty addresses, so the caller previews first and only sends
 * once the dean (or principal) explicitly confirms.
 */
export async function previewQuarterlySnapshot(
  academicYearId?: string,
  at: Date = new Date()
): Promise<SnapshotPreview> {
  const quarter = currentQuarter(at);
  const years = academicYearId
    ? [{ id: academicYearId }]
    : await prisma.academicYear.findMany({ where: { submissionOpen: true }, select: { id: true } });

  let faculty = 0;
  let recipients = 0;
  let optedOut = 0;
  let alreadySent = 0;
  let noEmail = 0;

  for (const y of years) {
    const submissions = await prisma.appraisalSubmission.findMany({
      where: { academicYearId: y.id },
      select: { userId: true, submissionNumber: true },
      orderBy: { submissionNumber: 'desc' },
    });
    const latest = latestPerFaculty(submissions);
    faculty += latest.length;
    if (!latest.length) continue;

    const userIds = latest.map((s) => s.userId);
    const [users, sent] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, emailOptIn: true },
      }),
      prisma.emailNotification.findMany({
        where: { dedupeKey: { in: userIds.map((id) => quarterlyDedupeKey(id, y.id, quarter)) } },
        select: { dedupeKey: true },
      }),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const sentKeys = new Set(sent.map((r) => r.dedupeKey));

    for (const id of userIds) {
      const u = byId.get(id);
      if (!u || !u.email) { noEmail++; continue; }
      if (!u.emailOptIn) { optedOut++; continue; }
      if (sentKeys.has(quarterlyDedupeKey(id, y.id, quarter))) { alreadySent++; continue; }
      recipients++;
    }
  }

  return { quarter, faculty, recipients, optedOut, alreadySent, noEmail };
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// W8 — fire the quarterly automation for any enabled review window whose end
// date is `at`'s day and that hasn't already run today. Called by the daily cron.
export async function runDueReviewWindows(
  at: Date = new Date(),
  // Tests pass their own throwaway year. Unscoped, a test run fired every real
  // window ending that day — a snapshot and a mail to every opted-in faculty.
  // The daily job passes no scope.
  scope?: { academicYearIds?: string[] },
) {
  // Kill switch. This job mails every opted-in faculty the moment a window's end
  // date arrives, with nobody present to confirm it — unlike the dean's button,
  // which is a dry run until confirmed. Default is unchanged (it runs), but an
  // operator can stop it without deleting the windows they have configured.
  if ((process.env.QUARTERLY_AUTOSEND ?? 'true').toLowerCase() === 'false') {
    console.log('[cron] Review windows skipped — QUARTERLY_AUTOSEND=false');
    return { windows: 0, faculty: 0, skipped: true as const };
  }

  const windows = await prisma.reviewWindow.findMany({
    where: { enabled: true, ...(scope?.academicYearIds ? { academicYearId: { in: scope.academicYearIds } } : {}) },
  });
  const due = windows.filter(
    (w) => sameLocalDay(new Date(w.endDate), at) && (!w.lastRunAt || !sameLocalDay(new Date(w.lastRunAt), at))
  );
  let faculty = 0;
  if (due.length) {
    // Say what is about to go out before it goes out, so the log shows the
    // blast radius even when nobody was watching.
    console.warn(`[cron] ${due.length} review window(s) due — about to snapshot each (armed ones also email faculty)`);
  }
  let held = 0;
  for (const w of due) {
    // Mass-mail gate: the window only emails if the dean armed it after seeing
    // the preview. Unarmed, the snapshot is still taken but the mail is held
    // until the dean releases it.
    const armed = !!w.armedAt;
    faculty += await snapshotYear(w.academicYearId, w.quarter, { sendEmail: armed });
    if (armed) {
      await prisma.reviewWindow.update({ where: { id: w.id }, data: { lastRunAt: at } });
    } else {
      held++;
      console.warn(
        `[cron] Review window ${w.quarter} (AY ${w.academicYearId}, id ${w.id}) is NOT ARMED — ` +
          'snapshot taken, quarterly feedback email HELD. The dean must release it from Review Windows.'
      );
      await prisma.reviewWindow.update({ where: { id: w.id }, data: { lastRunAt: at, heldAt: at } });
    }
  }
  if (due.length) console.log(`[cron] Review windows fired: ${due.length} (${held} held), ${faculty} faculty`);
  return { windows: due.length, faculty, held };
}

export function startQuarterlySnapshotCron() {
  // Daily 09:00 — fire any enabled review window ending today. Dean-set
  // windows take effect without a restart (the checker reads them each run).
  cron.schedule('0 9 * * *', async () => {
    try { await runDueReviewWindows(); } catch (e) { console.error('[cron] Review window error:', e); }
    // Unblock appraisals stalled on a rejected proof nobody fixed.
    try { await voidExpiredProofs(); } catch (e) { console.error('[cron] Proof deadline error:', e); }
  });
  console.log('[cron] Review-window checker scheduled (daily 09:00)');
}

// Manual trigger (dean/principal "Run snapshot now").
export async function triggerQuarterlySnapshot(academicYearId?: string) {
  return runQuarterlySnapshot(academicYearId);
}
