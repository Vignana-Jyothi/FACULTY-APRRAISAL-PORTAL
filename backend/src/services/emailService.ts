import nodemailer, { Transporter } from 'nodemailer';
import prisma from '../utils/prismaClient';
import { renderTemplate, TEMPLATE_SUBJECTS } from './emailTemplates';
import { EmailStatus } from '@prisma/client';

const DISABLED = process.env.EMAIL_DISABLED === 'true';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

export type EmailTemplateKey =
  | 'submission_received'
  | 'submission_approved'
  | 'submission_rejected'
  | 'submission_unlocked'
  | 'draft_reminder'
  | 'reviewer_daily_digest'
  | 'password_otp'
  | 'proof_rejected'
  | 'proof_rejected_hod'
  | 'hold_cleared'
  | 'quarterly_feedback'
  | 'feedback_issued';

interface EnqueueOpts {
  toUserId: string;
  template: EmailTemplateKey;
  payload: Record<string, any>;
  // Idempotency — if set, prevents duplicate sends with same key
  dedupeKey?: string;
  // Whether to skip this send when the user has opted out (emailOptIn=false).
  // Defaults to FALSE: transactional/status mail (approvals, OTPs, holds) must
  // reach the faculty regardless of the opt-out. Only bulk/advisory sends (the
  // quarterly digest) pass honorOptIn:true so the opt-out is respected there.
  honorOptIn?: boolean;
}

/**
 * Queue an email send. Creates EmailNotification row (PENDING) — worker picks it up.
 * Returns the row id, or null if skipped (opted out, duplicate, no email address).
 */
export async function enqueueEmail(opts: EnqueueOpts): Promise<string | null> {
  const { toUserId, template, payload, dedupeKey, honorOptIn = false } = opts;

  const user = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!user || !user.email) {
    console.warn(`[email] Skip ${template} — user ${toUserId} has no email`);
    return null;
  }
  if (honorOptIn && !user.emailOptIn) {
    console.log(`[email] Skip ${template} — user ${toUserId} opted out`);
    return null;
  }

  // Dedupe check
  if (dedupeKey) {
    const existing = await prisma.emailNotification.findUnique({ where: { dedupeKey } });
    if (existing) {
      console.log(`[email] Skip ${template} — dedupe key ${dedupeKey} exists`);
      return existing.id;
    }
  }

  const subject = TEMPLATE_SUBJECTS[template](payload);

  const row = await prisma.emailNotification.create({
    data: {
      toUserId,
      toEmail: user.email,
      subject,
      template,
      payload,
      status: EmailStatus.PENDING,
      dedupeKey,
    },
  });

  return row.id;
}

// Secret payload keys that must not survive at rest once the mail is rendered.
const SECRET_PAYLOAD_KEYS = ['otp'];

// Return the payload with secret keys removed. Used after a send completes so a
// one-time code (password_otp) is not retained in EmailNotification.payload.
function redactPayload(_template: string, payload: unknown): any {
  if (!payload || typeof payload !== 'object') return payload as any;
  const out: Record<string, any> = { ...(payload as Record<string, any>) };
  for (const k of SECRET_PAYLOAD_KEYS) if (k in out) out[k] = '[redacted]';
  return out;
}

// Names reserved by RFC 2606 / 6761 never deliver. The test suites give their
// throwaway users such addresses, and the worker — which runs inside the dev
// backend and polls every 30s, faster than a suite tears down — used to hand
// their mail to SMTP. It now marks those rows failed without sending.
const RESERVED_TLDS = ['invalid', 'test', 'example', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net'];

export function isUndeliverableAddress(email: string | null | undefined): boolean {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return true;
  const tld = domain.split('.').pop() ?? '';
  return RESERVED_TLDS.includes(tld) || RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Actually send an email via SMTP. Called by worker.
 */
export async function sendEmail(notificationId: string): Promise<void> {
  const row = await prisma.emailNotification.findUnique({ where: { id: notificationId } });
  if (!row) throw new Error(`EmailNotification ${notificationId} not found`);
  if (row.status === EmailStatus.SENT) return;

  if (isUndeliverableAddress(row.toEmail)) {
    await prisma.emailNotification.update({
      where: { id: row.id },
      data: {
        status: EmailStatus.FAILED,
        attempts: 3,
        error: 'Reserved or undeliverable address — not sent',
        payload: redactPayload(row.template, row.payload),
      },
    });
    console.log(`[email] Skipped ${row.template} to ${row.toEmail} — reserved/undeliverable address`);
    return;
  }

  if (DISABLED) {
    console.log(`[email:DISABLED] would send ${row.template} to ${row.toEmail} — ${row.subject}`);
    await prisma.emailNotification.update({
      where: { id: row.id },
      data: { status: EmailStatus.SENT, sentAt: new Date(), payload: redactPayload(row.template, row.payload) },
    });
    return;
  }

  try {
    const html = renderTemplate(row.template as EmailTemplateKey, row.payload as Record<string, any>);
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to: row.toEmail,
      subject: row.subject,
      html,
    });
    await prisma.emailNotification.update({
      where: { id: row.id },
      // Drop secrets (the OTP) from the row once the mail is out, so the code
      // does not sit in the database or leak through the admin Emails list.
      data: { status: EmailStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, payload: redactPayload(row.template, row.payload) },
    });
    console.log(`[email] Sent ${row.template} to ${row.toEmail}`);
  } catch (e: any) {
    const attempts = row.attempts + 1;
    const failed = attempts >= 3;
    await prisma.emailNotification.update({
      where: { id: row.id },
      data: {
        status: failed ? EmailStatus.FAILED : EmailStatus.PENDING,
        attempts,
        error: String(e?.message ?? e),
        // Once we give up, drop the secret too — a FAILED OTP row must not keep
        // the cleartext code at rest.
        ...(failed ? { payload: redactPayload(row.template, row.payload) } : {}),
      },
    });
    console.error(`[email] Failed ${row.template} to ${row.toEmail} (attempt ${attempts}/3):`, e?.message);
    if (failed) throw e;
  }
}
