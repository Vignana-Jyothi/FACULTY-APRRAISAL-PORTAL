import cron from 'node-cron';
import prisma from '../utils/prismaClient';
import { enqueueEmail } from '../services/emailService';

/**
 * Daily 9 AM: draft reminders (at most weekly per faculty) + reviewer digest (daily).
 * Cron: "0 9 * * *" (Asia/Kolkata default since server local)
 */

// The draft now stays open all year (it can only be submitted once the Q4
// review is over), so a daily nudge would mail every faculty almost every day.
// Owner decision 2026-09-19: at most one reminder a week, and only after a full
// week without edits.
const DRAFT_REMINDER_MIN_DAYS_SINCE_EDIT = 7;

/**
 * ISO-8601 week of a date, as "2026-W38". Used as the draft reminder's dedupe
 * key, so the daily job sends a faculty at most one reminder per calendar week
 * however many days it runs.
 */
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function sendDraftReminders() {
  console.log('[cron] Running draft reminders');
  const openYears = await prisma.academicYear.findMany({ where: { submissionOpen: true } });
  if (openYears.length === 0) return;

  for (const year of openYears) {
    const drafts = await prisma.appraisalSubmission.findMany({
      where: {
        academicYearId: year.id,
        status: 'DRAFT',
      },
      include: { user: true },
    });

    for (const sub of drafts) {
      // Skip if user has no email or opted out
      if (!sub.user.email || !sub.user.emailOptIn) continue;

      // Skip if edited within last N days
      const lastEdit = sub.updatedAt;
      const daysSinceEdit = Math.floor((Date.now() - new Date(lastEdit).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceEdit < DRAFT_REMINDER_MIN_DAYS_SINCE_EDIT) continue;

      const week = isoWeek(new Date());
      const daysLeft = Math.ceil((new Date(year.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      await enqueueEmail({
        toUserId: sub.userId,
        template: 'draft_reminder',
        payload: {
          name: sub.user.name,
          year: year.label,
          windowCloses: new Date(year.endDate).toLocaleDateString(),
          daysLeft: Math.max(0, daysLeft),
        },
        // At most one per submission per calendar week (see isoWeek).
        dedupeKey: `draft_reminder:${sub.id}:${week}`,
        honorOptIn: true,
      });
    }
  }
}

async function sendReviewerDigest() {
  console.log('[cron] Running reviewer digest');
  // Find all users with HOD/REVIEWER role
  const reviewers = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: { some: { role: { in: ['HOD', 'REVIEWER'] } } },
    },
    include: { userRoles: true },
  });

  for (const reviewer of reviewers) {
    if (!reviewer.email) continue;
    const deptIds = reviewer.userRoles
      .filter((r) => r.role === 'HOD' || r.role === 'REVIEWER')
      .map((r) => r.departmentId)
      .filter(Boolean) as string[];
    if (deptIds.length === 0) continue;

    const pending = await prisma.appraisalSubmission.findMany({
      where: {
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
        user: { departmentId: { in: deptIds } },
      },
      include: {
        user: { select: { name: true } },
        academicYear: { select: { label: true } },
      },
      orderBy: { submittedAt: 'asc' },
      take: 20,
    });

    if (pending.length === 0) continue;

    const items = pending.map((p) => ({
      name: p.user.name,
      year: p.academicYear.label,
      daysWaiting: p.submittedAt ? Math.floor((Date.now() - new Date(p.submittedAt).getTime()) / (1000 * 60 * 60 * 24)) : 0,
    }));

    const today = new Date().toISOString().slice(0, 10);
    await enqueueEmail({
      toUserId: reviewer.id,
      template: 'reviewer_daily_digest',
      payload: {
        name: reviewer.name,
        pendingCount: pending.length,
        items,
      },
      dedupeKey: `reviewer_digest:${reviewer.id}:${today}`,
      honorOptIn: true,
    });
  }
}

export function startReminderCrons() {
  // Daily at 9:00 AM server time
  cron.schedule('0 9 * * *', async () => {
    try { await sendDraftReminders(); } catch (e) { console.error('[cron] draft reminders error:', e); }
    try { await sendReviewerDigest(); } catch (e) { console.error('[cron] reviewer digest error:', e); }
  });
  console.log('[cron] Reminder crons scheduled (daily 09:00)');
}

// Manual trigger (for admin "Send now" button)
export async function triggerDraftReminders() { return sendDraftReminders(); }
export async function triggerReviewerDigest() { return sendReviewerDigest(); }
