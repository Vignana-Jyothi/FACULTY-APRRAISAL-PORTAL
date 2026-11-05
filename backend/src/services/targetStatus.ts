// Quarterly "target status" for the faculty email: each measurable target with
// what is required, where the faculty stands now, what is left, and a
// one-paragraph summary. Pure function — no I/O.
//
// Faculty-facing. It shows the targets but none of the machinery behind them:
// the output carries labels, numbers and a status only — no cadre, no tier, no
// eligibility verdict. The total-score row uses the faculty's OWN total out of
// 500. The tracking engine measures that target against the reviewer's /550
// grand total once a review exists, and that figure is withheld from faculty.

import type { CountedItems } from './trackingEngine';
import { INDEX_LABEL } from './scoringEngine';

export interface TargetRequirement {
  key: string;
  label: string;
  target: string; // ">= N" for measurable targets
  actual: string;
}

export interface TargetRow {
  label: string;
  required: number;
  current: number;
  achieved: boolean;
  left: number;
  status: string;
}

export interface TargetStatus {
  rows: TargetRow[];
  achieved: number;
  total: number;
  achievedText: string;
  leftText: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function targetStatus(requirements: TargetRequirement[] | null | undefined, facultyTotal: number): TargetStatus {
  const rows: TargetRow[] = [];
  for (const r of requirements ?? []) {
    // Only ">= N" targets are measurable; e.g. the quartile row is a manual check.
    // The target may carry a suffix (">= 2, incl. 1 journal"), so match the
    // leading number rather than anchoring to end-of-string.
    const m = /^>=\s*(\d+(?:\.\d+)?)/.exec(String(r.target ?? '').trim());
    if (!m) continue;
    const required = Number(m[1]);
    // A 0 requirement is not a target for this cadre — drop the row entirely
    // rather than showing a meaningless "0 / 0 achieved" card.
    if (required <= 0) continue;

    // actual may also carry a suffix ("2 (1 journals)") — take its leading number.
    const lead = /(\d+(?:\.\d+)?)/.exec(String(r.actual ?? '').trim());
    const raw = r.key === 'totalScore' ? Number(facultyTotal) : lead ? Number(lead[1]) : NaN;
    // Blank or non-numeric counts as 0 — never as progress.
    const current = Number.isFinite(raw) && raw > 0 ? round(raw) : 0;
    const achieved = current >= required;
    const left = achieved ? 0 : round(required - current);

    rows.push({
      label: r.key === 'totalScore' ? 'Total score (out of 500)' : r.label,
      required,
      current,
      achieved,
      left,
      status: achieved ? 'Achieved' : `${left} to go`,
    });
  }

  const done = rows.filter((r) => r.achieved);
  const open = rows.filter((r) => !r.achieved);
  const n = rows.length;

  const achievedText = !n ? ''
    : !done.length ? `No targets achieved yet (0 of ${n}).`
    : done.length === n ? `All ${n} targets achieved: ${done.map((r) => r.label).join(', ')}.`
    : `Achieved ${done.length} of ${n}: ${done.map((r) => r.label).join(', ')}.`;

  const leftText = !n ? ''
    : !open.length ? 'Nothing left to achieve — sustain this through the rest of the year.'
    : `Still to achieve: ${open.map((r) => `${r.label} (${r.left} to go)`).join(', ')}.`;

  return { rows, achieved: done.length, total: n, achievedText, leftText };
}

// ─── What counts so far ──────────────────────────────────────────────
// One short line per item behind the count targets, so "Indexed: 2" names the
// two papers (venue, index, quartile, impact factor, date). Built from
// trackingEngine.countedItems — the same rows the counts come from. Plain
// text: the email template escapes it, since titles are typed by faculty.

export interface TargetEvidence {
  indexed: string[];
  ppc: string[];
}

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const cap = (v: unknown) => { const s = clean(v).toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : ''; };
const monthYear = (d: unknown) => {
  if (!d) return '';
  const t = new Date(d as any);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};
const positive = (n: unknown) => { const x = Number(n); return Number.isFinite(x) && x > 0 ? x : 0; };
const line = (kind: string, title: unknown, ...details: unknown[]) => {
  const bits = details.map(clean).filter(Boolean);
  return `${kind} — "${clean(title) || 'Untitled'}"${bits.length ? ' · ' + bits.join(' · ') : ''}`;
};

export function targetEvidence(c: CountedItems): TargetEvidence {
  const indexed = [
    ...c.indexedJournals.map((j: any) => line('Journal', j.title, j.journalName, INDEX_LABEL[j.indexed] ?? j.indexed, j.quartile,
      positive(j.impactFactor) ? `IF ${positive(j.impactFactor)}` : '', monthYear(j.dateOfPub))),
    ...c.indexedConferences.map((x: any) => line('Conference', x.title, x.conferenceName, INDEX_LABEL[x.indexed] ?? x.indexed, x.quartile,
      positive(x.impactFactor) ? `IF ${positive(x.impactFactor)}` : '', monthYear(x.dateOfPub))),
    ...c.indexedConfBookChapters.map((x: any) => line('Book chapter', x.title, x.conferenceName, INDEX_LABEL[x.indexed] ?? x.indexed, x.quartile,
      positive(x.impactFactor) ? `IF ${positive(x.impactFactor)}` : '', monthYear(x.dateOfPub))),
  ];
  const ppc = [
    ...c.patents.map((p: any) => line('Patent', p.title, cap(p.status), p.country, monthYear(p.dateOfGrant ?? p.dateOfPub))),
    ...c.projects.map((p: any) => line('Project', p.title, p.fundingAgency,
      positive(p.amountLakhs) ? `₹${positive(p.amountLakhs)} lakh` : '', cap(p.status))),
    ...c.consultancy.map((x: any) => line('Consultancy', x.name, x.agency,
      positive(x.amountLakhs) ? `₹${positive(x.amountLakhs)} lakh` : '')),
  ];
  return { indexed, ppc };
}
