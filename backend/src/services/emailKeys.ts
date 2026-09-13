import { createHash } from 'crypto';

// Dedupe keys for event mail. enqueueEmail skips a send whose key already
// exists, so a key has to be the SAME for a repeat of one event (a double-click,
// a retried request) and DIFFERENT for the next genuine occurrence. The old
// `${Date.now()}` suffix was unique every time, which switched deduplication off
// entirely. Each key below is built from the state that marks one occurrence.

const iso = (d: Date | string | null | undefined, none: string) =>
  d ? new Date(d).toISOString() : none;

/**
 * A rejected proof file, to the faculty (or, with `recipientId`, to a HoD).
 * Replacing the proof changes its URL, so rejecting the corrected one mails again.
 */
export function proofRejectedKey(pvId: string, url: string, recipientId?: string): string {
  return recipientId
    ? `proof_rejected_hod:${pvId}:${recipientId}:${url}`
    : `proof_rejected:${pvId}:${url}`;
}

/** A cleared hold. Every hold stamps a fresh heldAt. */
export function holdClearedKey(submissionId: string, heldAt: Date | string | null | undefined): string {
  return `hold_cleared:${submissionId}:${iso(heldAt, 'not-held')}`;
}

/** An admin unlock. Resubmitting stamps a fresh submittedAt. */
export function unlockedKey(submissionId: string, submittedAt: Date | string | null | undefined): string {
  return `unlocked:${submissionId}:${iso(submittedAt, 'never-submitted')}`;
}

/** A final approval. A new HoD review after a reopen re-stamps reviewedAt. */
export function finalApprovedKey(submissionId: string, reviewedAt: Date | string | null | undefined): string {
  return `final_approved:${submissionId}:${iso(reviewedAt, 'no-review')}`;
}

/** Issued feedback. The same text re-issued mails once; edited text mails again. */
export function feedbackIssuedKey(feedbackId: string, texts: Array<string | null | undefined>): string {
  const digest = createHash('sha1').update(JSON.stringify(texts.map((t) => t ?? null))).digest('hex');
  return `feedback_issued:${feedbackId}:${digest}`;
}
