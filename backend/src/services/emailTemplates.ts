import type { EmailTemplateKey } from './emailService';

// FRONTEND_URL may be a comma-separated CORS allowlist (e.g. multiple dev
// ports); email links need a single base, so use the first origin.
const FRONTEND_URL = (process.env.FRONTEND_URL ?? 'http://localhost:5173').split(',')[0].trim();

// Subject lines (function for dynamic substitution)
export const TEMPLATE_SUBJECTS: Record<EmailTemplateKey, (p: any) => string> = {
  submission_received: (p) => `Faculty Appraisal ${p.year} — Submission received`,
  submission_approved: (p) => `Faculty Appraisal ${p.year} — Approved`,
  submission_rejected: (p) => `Faculty Appraisal ${p.year} — Rejected`,
  submission_unlocked: (p) => `Faculty Appraisal ${p.year} — Unlocked for edits`,
  draft_reminder: (p) => `Reminder — Complete your ${p.year} appraisal`,
  reviewer_daily_digest: (p) => `Pending Reviews — ${p.pendingCount} appraisal(s)`,
  password_otp: (_p) => `VNRVJIET Faculty Portal — Password Change OTP`,
  // On a draft (checked during the year) nothing is held — just replace the proof.
  proof_rejected: (p) => p.draft
    ? `Action needed — Proof rejected on your ${p.year} appraisal draft`
    : `Action needed — Proof rejected, appraisal ${p.year} on hold`,
  proof_rejected_hod: (p) => `Red List — ${p.facultyName}'s ${p.year} appraisal held`,
  hold_cleared: (p) => `Hold cleared — Appraisal ${p.year} back under review`,
  quarterly_feedback: (p) => `${p.quarter} feedback — Appraisal ${p.year} (provisional)`,
  feedback_issued: (p) => `Your ${p.year} appraisal feedback is ready`,
};

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
        <!-- Header -->
        <tr><td style="background:#ffffff;padding:16px 20px;text-align:center;border-bottom:1px solid #e2e8f0">
          <img src="${FRONTEND_URL}/vnrvjiet-logo.png" alt="VNRVJIET — Vallurupalli Nageswara Rao Vignana Jyothi Institute of Engineering &amp; Technology" width="280" style="max-width:80%;height:auto;display:inline-block" />
        </td></tr>
        <tr><td style="background:#1e3a5f;padding:8px 20px;text-align:center">
          <div style="color:#ffffff;font-size:11px;letter-spacing:0.5px">Faculty Appraisal Portal</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:24px">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#0f1d31;padding:14px;text-align:center;color:#94a3b8;font-size:11px">
          &copy; ${new Date().getFullYear()} VNRVJIET — Faculty Appraisal System<br />
          <a href="${FRONTEND_URL}" style="color:#e9a93a;text-decoration:none">Open Portal</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function scoreTable(p: any): string {
  if (!p.cat1 && !p.cat2 && !p.cat3 && !p.cat4 && !p.cat5) return '';

  // Faculty-facing, so this table is capped at 500 and never mentions
  // Category 6. Core values are the reviewer's assessment of the faculty, not
  // something they report or are shown — only their own department's HoD /
  // incharge and the principal see that half of the review, and the /550 grand
  // total exists only for them (utils/reviewVisibility). The dean does not.
  const reviewed = p.reviewedTotal != null;
  const header = reviewed ? 'Reviewed Score' : 'Score';

  const totals = reviewed
    ? `
    <tr><td>Self-assessed total</td><td align="right">${p.selfTotal ?? '-'} / 500</td></tr>
    <tr style="background:#1e3a5f;color:#fff;font-weight:bold"><td>Reviewed total</td><td align="right">${p.reviewedTotal} / 500</td></tr>`
    : `
    <tr style="background:#1e3a5f;color:#fff;font-weight:bold"><td>Self Total</td><td align="right">${p.selfTotal ?? '-'} / 500</td></tr>`;

  return `
  <table cellpadding="6" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;margin:12px 0;font-size:13px">
    <tr style="background:#f1f5f9"><th align="left" style="padding:8px">Category</th><th align="right" style="padding:8px">${header}</th></tr>
    <tr><td>Cat 1 — Teaching</td><td align="right">${p.cat1 ?? '-'} / 150</td></tr>
    <tr><td>Cat 2 — Research</td><td align="right">${p.cat2 ?? '-'} / 150</td></tr>
    <tr><td>Cat 3 — Development</td><td align="right">${p.cat3 ?? '-'} / 100</td></tr>
    <tr><td>Cat 4 — Governance</td><td align="right">${p.cat4 ?? '-'} / 50</td></tr>
    <tr><td>Cat 5 — Supplementary</td><td align="right">${p.cat5 ?? '-'} / 50</td></tr>${totals}
  </table>`;
}

// Quarterly per-category remarks (see categoryRemarks.ts). Categories 1-5 only.
function categoryRemarksBlock(cats: any): string {
  if (!Array.isArray(cats) || !cats.length) return '';
  const rows = cats.map((c: any, i: number) => {
    const colour = c.good ? '#065f46' : '#991b1b';
    return `<tr style="border-top:1px solid #e2e8f0">
      <td style="padding:8px;vertical-align:top;white-space:nowrap">Cat ${i + 1} — ${c.label}</td>
      <td style="padding:8px;vertical-align:top;white-space:nowrap" align="right">${c.score} / ${c.max}</td>
      <td style="padding:8px;vertical-align:top;color:${colour}">${c.remark}</td>
    </tr>`;
  }).join('');
  return `
  <div style="margin-top:16px"><strong>Category-wise progress</strong>
    <span style="color:#64748b;font-size:12px">— your self-assessed score so far; half of each category's maximum is a good score</span></div>
  <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;margin:8px 0 12px;font-size:13px">
    <tr style="background:#f1f5f9"><th align="left" style="padding:8px">Category</th><th align="right" style="padding:8px">Score</th><th align="left" style="padding:8px">Remark</th></tr>
    ${rows}
  </table>`;
}

// Quarterly target status (see targetStatus.ts): required vs current per
// target, then what is achieved and what is left. No cadre / tier / eligibility.
const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The items behind the count targets (targetStatus.targetEvidence). Titles are
// faculty-typed, so every line is escaped.
function evidenceBlock(e: any): string {
  const groups: Array<[string, string[]]> = [
    ['Indexed publications (WOS / Scopus)', Array.isArray(e?.indexed) ? e.indexed : []],
    ['Patents / projects / consultancy', Array.isArray(e?.ppc) ? e.ppc : []],
  ];
  const shown = groups.filter(([, items]) => items.length);
  if (!shown.length) return '';
  return `<div style="margin:8px 0;font-size:12px;line-height:1.6;color:#334155">
    <strong style="font-size:13px;color:#0f172a">What counts so far</strong>
    ${shown.map(([heading, items]) => `<div style="margin-top:6px"><em>${heading} (${items.length})</em><br />${items.map((x) => `• ${esc(x)}`).join('<br />')}</div>`).join('')}
  </div>`;
}

function targetStatusBlock(t: any, year: string, evidence?: any): string {
  const rows = Array.isArray(t?.rows) ? t.rows : [];
  const heading = `<div style="margin-top:16px"><strong>Your targets for ${year}</strong></div>`;
  if (!rows.length) {
    return `${heading}<p style="color:#64748b;font-size:13px;margin:6px 0 12px">Your targets for this year have not been set yet.</p>`;
  }
  const body = rows.map((r: any) => `<tr style="border-top:1px solid #e2e8f0">
      <td style="padding:8px">${r.label}</td>
      <td style="padding:8px" align="right">${r.required}</td>
      <td style="padding:8px" align="right">${r.current}</td>
      <td style="padding:8px;white-space:nowrap;color:${r.achieved ? '#065f46' : '#991b1b'}">${r.status}</td>
    </tr>`).join('');
  return `${heading}
  <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;margin:8px 0;font-size:13px">
    <tr style="background:#f1f5f9"><th align="left" style="padding:8px">Target</th><th align="right" style="padding:8px">Required</th><th align="right" style="padding:8px">Current</th><th align="left" style="padding:8px">Status</th></tr>
    ${body}
  </table>
  ${evidenceBlock(evidence)}
  <div style="margin:8px 0 12px;font-size:13px;line-height:1.6;background:#f8fafc;border-left:3px solid #1e3a5f;padding:8px 12px">
    <strong>Summary</strong><br />
    <span style="color:#065f46">${t.achievedText}</span><br />
    <span style="color:#991b1b">${t.leftText}</span>
  </div>`;
}

// Rows queued before target status existed carry the old narrative. Render its
// strengths / areas to improve; Growth focus is no longer shown.
function legacyNarrative(p: any): string {
  if (!p.strengths && !p.improvements) {
    return '<p style="color:#64748b;font-size:13px">Keep up your work this quarter — detailed guidance will follow at the annual review.</p>';
  }
  return `<div style="margin:12px 0;font-size:13px;line-height:1.5">
    ${p.strengths ? `<p style="margin:0 0 6px"><strong style="color:#065f46">Strengths</strong><br />${esc(p.strengths).replace(/\n/g, '<br />')}</p>` : ''}
    ${p.improvements ? `<p style="margin:8px 0 6px"><strong style="color:#991b1b">Areas to improve</strong><br />${esc(p.improvements).replace(/\n/g, '<br />')}</p>` : ''}
  </div>`;
}

function commentsBlock(p: any): string {
  const items: Array<[string, string]> = [
    ['Teaching', p.teachingComment],
    ['Research', p.researchComment],
    ['Development', p.developmentComment],
    ['Governance', p.governanceComment],
    ['Supplementary', p.supplementaryComment],
    ['Overall', p.overallComment],
  ];
  const filled = items.filter(([, v]) => v && String(v).trim());
  if (!filled.length) return '';
  return `<div style="margin-top:12px"><strong>Reviewer Feedback</strong></div>
  <table cellpadding="4" cellspacing="0" style="width:100%;font-size:13px;margin-top:4px">
    ${filled.map(([k, v]) => `<tr><td style="padding:4px 0;color:#64748b;width:120px;vertical-align:top">${esc(k)}:</td><td style="padding:4px 0;color:#0f172a">${esc(v)}</td></tr>`).join('')}
  </table>`;
}

const TEMPLATES: Record<EmailTemplateKey, (p: any) => string> = {
  submission_received: (p) => layout('Submission Received', `
    <h2 style="margin:0 0 8px;color:#1e3a5f">Submission Received</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>Your Faculty Appraisal for <strong>${p.year}</strong> (Submission #${p.submissionNumber}) was received on <strong>${p.submittedAt}</strong>.</p>
    <p><strong>Status:</strong> <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">SUBMITTED</span></p>
    ${scoreTable(p)}
    <p style="color:#64748b;font-size:13px">Your HoD/Reviewer will review the submission. You'll receive an email when status changes.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">View Submission</a></p>
  `),

  submission_approved: (p) => layout('Appraisal Approved', `
    <h2 style="margin:0 0 8px;color:#059669">Appraisal Approved</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>Your Faculty Appraisal for <strong>${p.year}</strong> has been <strong style="color:#059669">APPROVED</strong> by ${p.reviewerName ?? 'the reviewer'} on ${p.reviewedAt}.</p>
    ${scoreTable(p)}
    ${commentsBlock(p)}
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">View Full Report</a></p>
  `),

  submission_rejected: (p) => layout('Appraisal Rejected', `
    <h2 style="margin:0 0 8px;color:#dc2626">Appraisal Rejected</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>Your Faculty Appraisal for <strong>${p.year}</strong> has been <strong style="color:#dc2626">REJECTED</strong> by ${p.reviewerName ?? 'the reviewer'} on ${p.reviewedAt}.</p>
    ${scoreTable(p)}
    ${commentsBlock(p)}
    <p style="color:#64748b;font-size:13px">Contact your HoD/Reviewer for next steps. If your appraisal is unlocked, you may resubmit.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">View Submission</a></p>
  `),

  submission_unlocked: (p) => layout('Submission Unlocked', `
    <h2 style="margin:0 0 8px;color:#1e3a5f">Submission Unlocked</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>Your Faculty Appraisal for <strong>${p.year}</strong> (Submission #${p.submissionNumber}) has been unlocked for editing. You can now edit and resubmit.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}/edit" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">Edit Submission</a></p>
  `),

  draft_reminder: (p) => layout('Complete Your Appraisal', `
    <h2 style="margin:0 0 8px;color:#d97706">Reminder — Submission Pending</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>Your Faculty Appraisal for <strong>${p.year}</strong> is currently in <strong>DRAFT</strong> status.</p>
    ${p.windowCloses ? `<p>Submission window closes on <strong>${p.windowCloses}</strong>${p.daysLeft != null ? ` (<strong>${p.daysLeft} day(s) remaining</strong>)` : ''}.</p>` : ''}
    <p>Your draft carries across the whole year — keep it up to date as you go. It can be submitted once the Q4 review window ends.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/dashboard" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">Continue Appraisal</a></p>
    <p style="margin-top:24px;color:#94a3b8;font-size:11px">You're receiving this reminder based on your email preferences. <a href="${FRONTEND_URL}/profile" style="color:#94a3b8">Manage preferences</a>.</p>
  `),

  password_otp: (p) => layout('Password OTP', `
    <h2 style="margin:0 0 8px;color:#1e3a5f">Password Change Request</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>You requested to change your password. Use the OTP below to confirm:</p>
    <div style="background:#f8fafc;border:2px solid #1e3a5f;border-radius:6px;padding:18px;text-align:center;margin:16px 0">
      <div style="color:#64748b;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Your OTP</div>
      <div style="color:#1e3a5f;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:monospace">${p.otp}</div>
    </div>
    <p style="color:#64748b;font-size:13px">This OTP expires in <strong>${p.expiresInMinutes ?? 10} minutes</strong>. Do not share it with anyone.</p>
    <p style="color:#dc2626;font-size:12px;margin-top:16px"><strong>If you did not request this</strong>, ignore this email and your password remains unchanged. Consider reviewing your account security.</p>
  `),

  reviewer_daily_digest: (p) => layout('Pending Reviews', `
    <h2 style="margin:0 0 8px;color:#1e3a5f">Daily Review Queue</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>You have <strong>${p.pendingCount}</strong> appraisal(s) pending review.</p>
    ${Array.isArray(p.items) && p.items.length ? `
      <table cellpadding="6" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;margin:12px 0;font-size:13px">
        <tr style="background:#1e3a5f;color:#fff"><th align="left" style="padding:8px">Faculty</th><th align="left" style="padding:8px">Year</th><th align="left" style="padding:8px">Days Waiting</th></tr>
        ${p.items.map((it: any, i: number) => `<tr ${i % 2 ? 'style="background:#f8fafc"' : ''}><td>${it.name}</td><td>${it.year}</td><td>${it.daysWaiting}</td></tr>`).join('')}
      </table>` : ''}
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/reviews" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">Open Review Queue</a></p>
  `),

  proof_rejected: (p) => layout('Proof Rejected — Action Needed', `
    <h2 style="margin:0 0 8px;color:#dc2626">Proof Rejected</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>A proof on your Faculty Appraisal for <strong>${p.year}</strong> (Submission #${p.submissionNumber}) was <strong style="color:#dc2626">rejected</strong>${p.draft ? '. Your draft is still open for editing.' : ', and your submission is now <strong>ON HOLD</strong>.'}</p>
    <table cellpadding="6" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;margin:12px 0;font-size:13px">
      <tr><td style="color:#64748b;width:120px">Section</td><td style="color:#0f172a">${esc(p.section)}</td></tr>
      <tr><td style="color:#64748b">Item</td><td style="color:#0f172a">${esc(p.item)}${p.field ? ` (${esc(p.field)})` : ''}</td></tr>
      ${p.comment ? `<tr><td style="color:#64748b;vertical-align:top">Reason</td><td style="color:#dc2626">${esc(p.comment)}</td></tr>` : ''}
    </table>
    <p style="color:#64748b;font-size:13px">${p.draft
      ? 'Please replace the proof in your draft (a file or a valid share link). The new proof goes back to your HoD for verification.'
      : 'Please re-upload the correct proof (a file or a valid share link). Your HoD will clear the hold once the corrected proof is verified.'}</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}/edit" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">Fix Proof</a></p>
  `),

  proof_rejected_hod: (p) => layout('Red List — Submission Held', `
    <h2 style="margin:0 0 8px;color:#dc2626">Submission Added to Red List</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p><strong>${esc(p.facultyName)}</strong> (${esc(p.employeeCode)}) has a rejected proof on their <strong>${p.year}</strong> appraisal (Submission #${p.submissionNumber}); the submission is now on hold.</p>
    <table cellpadding="6" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;margin:12px 0;font-size:13px">
      <tr><td style="color:#64748b;width:120px">Section</td><td style="color:#0f172a">${esc(p.section)}</td></tr>
      <tr><td style="color:#64748b">Item</td><td style="color:#0f172a">${esc(p.item)}${p.field ? ` (${esc(p.field)})` : ''}</td></tr>
      ${p.comment ? `<tr><td style="color:#64748b;vertical-align:top">Reason</td><td style="color:#dc2626">${esc(p.comment)}</td></tr>` : ''}
    </table>
    <p style="color:#64748b;font-size:13px">Clear the hold from the Red List once the faculty re-uploads and the proof is verified.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/red-list" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">Open Red List</a></p>
  `),

  hold_cleared: (p) => layout('Hold Cleared', `
    <h2 style="margin:0 0 8px;color:#059669">Hold Cleared</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>The hold on your Faculty Appraisal for <strong>${p.year}</strong> (Submission #${p.submissionNumber}) has been cleared. Your submission is back <strong>under review</strong>.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">View Submission</a></p>
  `),

  quarterly_feedback: (p) => layout('Quarterly Feedback', `
    <h2 style="margin:0 0 8px;color:#1e3a5f">${p.quarter} Progress — ${p.year}</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>Here is a short summary of your progress this quarter, with a few pointers for the months ahead.</p>
    ${categoryRemarksBlock(p.categories)}
    ${p.targets ? targetStatusBlock(p.targets, p.year, p.evidence) : legacyNarrative(p)}
    <p style="color:#64748b;font-size:13px">This is a provisional quarterly update to help you plan ahead.</p>
    <p style="margin-top:24px;color:#94a3b8;font-size:11px">Sent per your email preferences. <a href="${FRONTEND_URL}/profile" style="color:#94a3b8">Manage preferences</a>.</p>
  `),

  feedback_issued: (p) => layout('Appraisal Feedback', `
    <h2 style="margin:0 0 8px;color:#1e3a5f">Your Feedback is Ready</h2>
    <p>Dear <strong>${esc(p.name)}</strong>,</p>
    <p>The annual feedback for your <strong>${p.year}</strong> appraisal has been issued — including personalised growth guidance.</p>
    <p style="margin-top:16px"><a href="${FRONTEND_URL}/appraisal/${p.submissionId}" style="background:#1e3a5f;color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600">View Feedback</a></p>
  `),
};

export function renderTemplate(key: EmailTemplateKey, payload: Record<string, any>): string {
  const fn = TEMPLATES[key];
  if (!fn) throw new Error(`Unknown template: ${key}`);
  return fn(payload);
}
