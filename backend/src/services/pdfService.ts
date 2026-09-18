import puppeteer, { Browser } from 'puppeteer';
import { VNRVJIET_LOGO_DATA_URI } from './logoAsset';
import {
  lectureRowScore, projectRowScore, eContentRowScore, ictRowScore,
  publicationScore, INDEX_LABEL, authorCount, citationScore, bookRowScore, patentRowScore,
  sponsoredProjectRowScore, consultancyRowScore, guidanceRowScore, outcomeRowScore, advQualScore,
  trainingRowScore, membershipRowScore, awardRowScore, differentiatorRowScore, PER_ENTRY,
} from './scoringEngine';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launching = puppeteer.launch({
      headless: true,
      // In Docker we install system Chromium and point here; locally this is
      // unset and puppeteer uses its bundled browser.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    }).then((browser) => {
      // Forget a browser we lose, so the next render launches a fresh one.
      browser.on('disconnected', () => { if (browserPromise === launching) browserPromise = null; });
      return browser;
    });
    launching.catch(() => { if (browserPromise === launching) browserPromise = null; });
    browserPromise = launching;
  }
  return browserPromise;
}

// Chromium can outlive the server's link to it (seen 2026-09-11 after the
// machine slept: the process still answered, yet every render from the
// long-lived handle failed until a restart). On failure, drop the handle and
// retry once on a fresh browser.
export async function renderHtmlToPdf(html: string, opts?: { landscape?: boolean }): Promise<Buffer> {
  try {
    return await renderOnce(html, opts);
  } catch (err) {
    console.error('PDF render failed; retrying on a fresh browser:', err);
    const stale = browserPromise;
    browserPromise = null;
    stale?.then((b) => b.close()).catch(() => {});
    return renderOnce(html, opts);
  }
}

async function renderOnce(html: string, opts?: { landscape?: boolean }): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: opts?.landscape ?? false,
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

const BASE_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Georgia, serif; color: #0f172a; font-size: 11pt; line-height: 1.5; margin: 0; }
  h1 { font-size: 18pt; color: #1e3a5f; margin: 0 0 4px; text-align: center; }
  h2 { font-size: 14pt; color: #1e3a5f; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e9a93a; }
  h3 { font-size: 12pt; color: #1e3a5f; margin: 12px 0 6px; }
  .institute { text-align: center; margin-bottom: 6px; }
  .institute .name { font-size: 14pt; font-weight: bold; color: #1e3a5f; }
  .institute .sub { font-size: 9pt; color: #64748b; }
  .accred { text-align: center; font-size: 9pt; color: #64748b; margin-bottom: 14px; }
  .accred span { background: #fdf6e4; color: #8a5f04; border: 1px solid #f5d680; padding: 1px 6px; border-radius: 3px; margin: 0 3px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 10pt; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #1e3a5f; color: #fff; font-weight: 600; font-size: 9.5pt; }
  tr:nth-child(even) td { background: #f8fafc; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; font-size: 10pt; margin-bottom: 12px; }
  .meta b { color: #334155; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
  .sig-box { border-top: 1px solid #0f172a; padding-top: 4px; text-align: center; font-size: 9pt; color: #334155; min-height: 60px; }
  .footer { font-size: 8pt; color: #94a3b8; text-align: center; margin-top: 24px; border-top: 1px solid #cbd5e1; padding-top: 6px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 9pt; font-weight: 600; }
  .badge-approved { background: #d1fae5; color: #065f46; }
  .badge-rejected { background: #fee2e2; color: #991b1b; }
  .badge-pending  { background: #fef3c7; color: #92400e; }
  .badge-default  { background: #e2e8f0; color: #475569; }
  .score-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 8px 0; }
  .score-cell { border: 1px solid #cbd5e1; padding: 6px; text-align: center; border-radius: 3px; background: #f8fafc; }
  .score-cell .num { font-size: 14pt; font-weight: bold; color: #1e3a5f; }
  .score-cell .lbl { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  .score-cell .max { font-size: 8pt; color: #94a3b8; }
  .grand { text-align: center; font-size: 14pt; color: #1e3a5f; font-weight: bold; margin: 8px 0; }
  .grand small { color: #94a3b8; font-weight: normal; }
  @page { size: A4; margin: 15mm; }
`;

function instituteHeader(): string {
  return `
    <div class="institute" style="text-align:center">
      <img src="${VNRVJIET_LOGO_DATA_URI}" alt="VNRVJIET — Vallurupalli Nageswara Rao Vignana Jyothi Institute of Engineering &amp; Technology" style="height:58px;width:auto;margin-bottom:4px" />
    </div>
    <div class="accred">
      <span>NAAC A++</span><span>NBA Accredited</span><span>Autonomous Institution</span>
    </div>
  `;
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    APPROVED: 'badge-approved', REJECTED: 'badge-rejected',
    DRAFT: 'badge-default', SUBMITTED: 'badge-pending', UNDER_REVIEW: 'badge-pending',
    ACTIVE: 'badge-approved', REVIEWED: 'badge-approved',
  };
  return `<span class="badge ${map[status] ?? 'badge-default'}">${status}</span>`;
}

// The official form asks for DD-MM-YYYY. Dates are stored as UTC midnight, so
// read the UTC parts — local time could roll the day back.
function fmtDate(d: any): string {
  if (!d) return '—';
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCDate())}-${pad(t.getUTCMonth() + 1)}-${t.getUTCFullYear()}`;
}

const FRONTEND = process.env.FRONTEND_URL?.split(',')[0]?.trim() ?? '';

// Trusted-HTML marker. listTable escapes every cell by default (faculty free
// text must not break out of its <td>); a cell wrapped in raw() is HTML the
// server built itself (proofCell, joined markup) and is passed through as-is.
class RawHtml { constructor(readonly html: string) {} }
function raw(html: string): RawHtml { return new RawHtml(html); }

// A proof is either a file uploaded to the portal (a path) or a pasted link
// (Google Drive etc.). Only paths get the portal prefix — prefixing a full URL
// produced "http://portalhttps://drive..." for every pasted link.
function proofCell(file: any): RawHtml {
  if (!file) return raw('—');
  const f = String(file).trim();
  if (/^https?:\/\//i.test(f)) return raw(`<a href="${esc(f)}">Link</a>`);
  const name = f.split('/').pop() ?? 'file';
  return raw(`<a href="${esc(`${FRONTEND}${f}`)}">Attached (${esc(name)})</a>`);
}

const scopeLabel = (s: unknown) => (s === 'INTERNATIONAL' ? 'International' : s === 'NATIONAL' ? 'National' : '—');

function listTable(title: string, headers: string[], rows: any[][]): string {
  if (!rows.length) return '';
  return `
    <h3>${title}</h3>
    <table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((r) => `<tr>${r.map((c) =>
          `<td>${c == null ? '—' : c instanceof RawHtml ? c.html : esc(c)}</td>`
        ).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

// ─── Appraisal PDF ───────────────────────────────────────────────────

export function renderAppraisalHtml(sub: any, score: any, review: any | null): string {
  const yearLabel = sub.academicYear?.label ?? '—';
  const user = sub.user ?? {};

  // Only render the reviewer's assessment when it was actually handed to us.
  // The faculty's copy has those fields removed (utils/reviewVisibility), and
  // treating absent marks as zeroes would print a Cat 6 block of 0.0s and a
  // "/ 550" line to the very person they are withheld from.
  const CAT6_KEYS = ['cat6Punctuality', 'cat6Professionalism', 'cat6Willingness', 'cat6Cordiality', 'cat6Classroom'];
  const hasCat6 = review != null && CAT6_KEYS.some((k) => review[k] != null);
  const cat6 = hasCat6
    ? CAT6_KEYS.reduce((sum, k) => sum + (review[k] ?? 0), 0)
    : null;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
<body>
  ${instituteHeader()}
  <h1>Faculty Appraisal Report</h1>
  <div style="text-align:center;font-size:10pt;color:#64748b;margin-bottom:14px">
    Academic Year ${yearLabel} · Submission #${sub.submissionNumber} · ${statusBadge(sub.status)}
  </div>

  <h2>Faculty Profile</h2>
  <div class="meta">
    <div><b>Name:</b> ${esc(user.name) || '—'}</div>
    <div><b>Employee Code:</b> ${esc(user.employeeCode) || '—'}</div>
    <div><b>Designation:</b> ${esc(user.designation) || '—'}</div>
    <div><b>Department:</b> ${esc(user.department?.name) || '—'}</div>
    <div><b>Email:</b> ${esc(user.email) || '—'}</div>
    <div><b>Phone:</b> ${esc(user.phone) || '—'}</div>
    <div><b>Date of Joining:</b> ${fmtDate(user.dateOfJoining)}</div>
    <div><b>Submitted:</b> ${fmtDate(sub.submittedAt)}</div>
  </div>

  <h2>Self-Appraisal Scores</h2>
  <div class="score-grid">
    <div class="score-cell"><div class="num">${score.cat1.total.toFixed(1)}</div><div class="lbl">Teaching</div><div class="max">/ 150</div></div>
    <div class="score-cell"><div class="num">${score.cat2.total.toFixed(1)}</div><div class="lbl">Research</div><div class="max">/ 150</div></div>
    <div class="score-cell"><div class="num">${score.cat3.total.toFixed(1)}</div><div class="lbl">Development</div><div class="max">/ 100</div></div>
    <div class="score-cell"><div class="num">${score.cat4.total.toFixed(1)}</div><div class="lbl">Governance</div><div class="max">/ 50</div></div>
    <div class="score-cell"><div class="num">${score.cat5.total.toFixed(1)}</div><div class="lbl">Supplementary</div><div class="max">/ 50</div></div>
  </div>
  <div class="grand">Self Total: ${score.selfTotal.toFixed(1)} <small>/ 500</small></div>

  ${review && cat6 != null ? `
    <h2>Reviewer Assessment</h2>
    <div class="score-grid" style="grid-template-columns: repeat(5, 1fr)">
      <div class="score-cell"><div class="num">${review.cat6Punctuality?.toFixed(1) ?? '0.0'}</div><div class="lbl">Punctuality</div><div class="max">/ 10</div></div>
      <div class="score-cell"><div class="num">${review.cat6Professionalism?.toFixed(1) ?? '0.0'}</div><div class="lbl">Profession.</div><div class="max">/ 10</div></div>
      <div class="score-cell"><div class="num">${review.cat6Willingness?.toFixed(1) ?? '0.0'}</div><div class="lbl">Willingness</div><div class="max">/ 10</div></div>
      <div class="score-cell"><div class="num">${review.cat6Cordiality?.toFixed(1) ?? '0.0'}</div><div class="lbl">Cordiality</div><div class="max">/ 10</div></div>
      <div class="score-cell"><div class="num">${review.cat6Classroom?.toFixed(1) ?? '0.0'}</div><div class="lbl">Classroom</div><div class="max">/ 10</div></div>
    </div>
    <div class="grand">Cat 6 Total: ${cat6.toFixed(1)} <small>/ 50</small></div>
    <div class="grand" style="font-size:16pt;background:#1e3a5f;color:#fff;padding:10px;border-radius:4px">
      GRAND TOTAL: ${review.grandTotal?.toFixed(1) ?? '—'} <small style="color:#cbd5e1">/ 550</small>
    </div>
  ` : ''}

  ${review && (review.teachingComment || review.overallComment) ? `
    <h2>Reviewer Comments</h2>
    <table>
      ${[
        ['Teaching', review.teachingComment],
        ['Research', review.researchComment],
        ['Development', review.developmentComment],
        ['Governance', review.governanceComment],
        ['Supplementary', review.supplementaryComment],
        ['Overall', review.overallComment],
      ].filter(([, v]) => v).map(([k, v]) => `<tr><td style="width:140px;font-weight:600;color:#334155">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
    </table>
  ` : ''}

  <h2>Cat 1 — Teaching &amp; Learning</h2>
  ${listTable('1.1 Courses Handled',
    ['Course', 'Level', 'Year/Sem', 'Novel Pedagogy Method', 'Novelty Score', 'Periods Planned', 'Conducted', 'Engagement %', 'Engagement Score', 'Total'],
    (sub.cat1Courses ?? []).map((c: any) => {
      // Same helper the engine scores with — never re-derive 1.1 here.
      const r = lectureRowScore(c);
      return [
        c.courseName, c.level, c.yearSem,
        r.novelty ? (c.novelPedagogyMethod || 'Yes') : '—', r.novelty,
        c.periodPlanned, c.periodsConducted,
        r.pct == null ? '—' : `${r.pct}%`, r.engagement, r.total,
      ];
    })
  )}
  ${listTable('1.2 Courses Taught — Attendance, Feedback, Results',
    ['Course', 'Class Size', 'Avg. Attendance %', 'Feedback', 'Pass %'],
    (sub.cat1CourseResults ?? []).map((c: any) => [c.courseName, c.classSize, c.avgAttendancePct, c.feedbackReceived, c.passPercentage])
  )}
  ${listTable('1.3 Academic Projects Guided',
    ['Course', 'Type of Project', 'Number of Projects Guided', 'Score'],
    (sub.cat1Projects ?? []).map((p: any) => {
      // Same helper the engine scores with — never re-derive 1.3 here.
      const r = projectRowScore(p);
      const units = r.unit === 'student' ? (r.count === 1 ? 'student' : 'students') : (r.count === 1 ? 'batch' : 'batches');
      return [p.course === 'MTECH' ? 'M.Tech' : 'B.Tech', p.projectType === 'MAJOR' ? 'Major Project' : 'Mini Project', `${r.count} ${units}`, r.score];
    })
  )}
  ${listTable('1.4 e-Content Development / Other Instructional Material',
    ['Course Name (B.Tech/M.Tech)', 'Name of the Content', 'Nature of the Content', 'Evidence', 'Score'],
    (sub.cat1EContent ?? []).map((e: any) => {
      // Same helper the engine scores with — never re-derive 1.4 here.
      const r = eContentRowScore(e);
      return [e.courseName, e.contentName, e.nature, r.evidence ? proofCell(e.evidenceFile) : 'No evidence link', r.score];
    })
  )}
  ${listTable('1.5 Use of ICT &amp; Digital Platforms',
    ['Course Name (B.Tech/M.Tech)', 'Platform / Tool Used', 'Nature of Use', 'Evidence', 'Score'],
    (sub.cat1ICT ?? []).map((i: any) => {
      // Same helper the engine scores with — never re-derive 1.5 here.
      const r = ictRowScore(i);
      return [i.courseName, i.platform, i.natureOfUse, r.evidence ? proofCell(i.evidenceFile) : 'No evidence link', r.score];
    })
  )}

  <h2>Cat 2 — Research &amp; Consultancy</h2>
  ${(() => {
    // 2.1 — one table per part, with the PDF's columns. Same helper the engine
    // scores with — never re-derive 2.1 here. Part C was missing from this
    // export entirely until 2026-09-11.
    const head = ['Title of the Publication', 'Journal / Proceedings', 'No. & List of Authors', 'Author Position',
      'Vol. / Issue / Pages', 'Date (DD-MM-YYYY)', 'ISSN & DOI', 'Impact Factor', 'Indexed & Quartile', 'Score', 'Proof'];
    // Where the authors are from, and who claims an all-VNRVJIET paper.
    const claimNote = (p: any) => p.allAuthorsFromCampus === true
      ? ` (all VNRVJIET; ${p.claimedBySelf === true ? `claimed by ${user.name ?? 'the faculty'}` : 'claim not chosen'})`
      : p.allAuthorsFromCampus === false ? ' (with other institutions)' : ' (campus question not answered)';
    const cols = (p: any) => [
      `${authorCount(p) || '—'}: ${p.authors ?? ''}${claimNote(p)}`, p.authorPosition,
      [p.volume, p.issueNo, p.pageNos].filter(Boolean).join(' / ') || '—',
      fmtDate(p.dateOfPub), [p.issn, p.doi].filter(Boolean).join(' / ') || '—',
      p.impactFactor || '—', [INDEX_LABEL[p.indexed] ?? p.indexed, p.quartile].filter(Boolean).join(', '),
    ];
    return [
      listTable('2.1-A Journal Publications', head, (sub.cat2Journals ?? []).map((p: any) => [
        p.title, p.journalName, ...cols(p), publicationScore('journal', p).score,
        raw([proofCell(p.proofFile).html, p.indexProofFile ? `Index: ${proofCell(p.indexProofFile).html}` : ''].filter(Boolean).join('<br/>')),
      ])),
      listTable('2.1-B Conference Proceedings', head, (sub.cat2Conferences ?? []).map((p: any) => [
        p.title, p.conferenceName, ...cols(p), publicationScore('conference', p).score, proofCell(p.proofFile),
      ])),
      listTable('2.1-C Book Chapters (from Conferences)', head, (sub.cat2ConfBookChapters ?? []).map((p: any) => [
        p.title, p.conferenceName, ...cols(p), publicationScore('chapter', p).score, proofCell(p.proofFile),
      ])),
    ].join('');
  })()}
  ${listTable('2.2 Citations of Research Publications / Books (Scopus / WoS only)',
    ['No. of Publications / Books till date', 'No. with Citations', 'Total No. of Citations', 'h-Index (Scopus)', 'h-Index (WoS)', 'Score'],
    sub.cat2Citations ? [[
      sub.cat2Citations.totalPubsTillDate, sub.cat2Citations.pubsWithCitations, sub.cat2Citations.totalCitations,
      sub.cat2Citations.hIndexScopus, sub.cat2Citations.hIndexWos, citationScore(sub.cat2Citations.totalCitations),
    ]] : []
  )}
  ${(() => {
    // 2.3 — the PDF's columns. Same helper the engine scores with — never
    // re-derive 2.3 here.
    const row = (b: any, kind: 'Book' | 'Chapter') => {
      const r = bookRowScore(b);
      const level = b.scope === 'INTERNATIONAL' ? 'International' : b.scope === 'NATIONAL' ? 'National' : 'Not chosen';
      return [
        b.title, kind, level, b.authors, b.publisher || '—', kind === 'Chapter' ? (b.chapterNo || '—') : '—',
        b.isbn || '—', b.isEdited ? 'Edited' : 'Published', r.score, proofCell(b.proofFile),
      ];
    };
    return listTable('2.3 Books and Academic Book Chapters Published / Edited',
      ['Title of Book / Chapter / Article', 'Book / Chapter', 'National / International', 'Authors', 'Publisher Details',
        'Chapter Details', 'ISBN No.', 'Published / Edited', 'Score', 'Proof'],
      [
        ...(sub.cat2Books ?? []).map((b: any) => row(b, 'Book')),
        ...(sub.cat2BookChapters ?? []).map((b: any) => row(b, 'Chapter')),
      ]);
  })()}
  ${listTable('2.4 Patents / Transfer of Technology / Trade Marks / Copyrights / Other IPR',
    ['Title of the Patent / Design / etc.', 'Type', 'Country', 'Name of the Inventor', 'Application / Patent Number',
      'Status', 'Date of Publication', 'Date of Grant', 'Valid Duration', 'Score', 'Proof'],
    // Same helper the engine scores with — never re-derive 2.4 here.
    (sub.cat2Patents ?? []).map((p: any) => [
      p.title, p.iprType === 'Other' ? (p.iprTypeOther || 'Other') : (p.iprType || '—'), p.country, p.inventors,
      p.appNumber || '—', p.status ? p.status[0] + p.status.slice(1).toLowerCase() : '—',
      fmtDate(p.dateOfPub), fmtDate(p.dateOfGrant), p.validDuration || '—', patentRowScore(p).score, proofCell(p.proofFile),
    ])
  )}
  ${listTable('2.5 Sponsored Research Projects',
    ['Title of the Project', 'Funding Agency', 'Amount (Rs. Lakhs)', 'PI / Co-investigator', 'Status',
      'Duration & Period / Date of Application', 'Score', 'Proof'],
    // Same helper the engine scores with — never re-derive 2.5 here.
    (sub.cat2Projects ?? []).map((p: any) => [
      p.title, p.fundingAgency, p.amountLakhs ?? '—', p.role === 'Co-PI' ? 'Co-investigator' : 'Principal Investigator',
      p.status ? p.status[0] + p.status.slice(1).toLowerCase() : '—',
      p.status === 'APPLIED' ? fmtDate(p.dateOfApplication) : (p.durationPeriod || '—'),
      sponsoredProjectRowScore(p).score, proofCell(p.proofFile),
    ])
  )}
  ${/* 2.6 onward: the PDF's numbering and columns, a Score column from the same
    helpers the engine scores with (never re-derive a rule here), and the proof.
    Each score is per entry; the category total above applies the section caps. */ ''}
  ${listTable('2.6 Consultancy Projects',
    ['Name of Consultancy Project', 'Consulting / Sponsoring Agency', 'Amount (Rs. Lakhs)', 'Band', 'Score', 'Proof'],
    (sub.cat2Consultancy ?? []).map((c: any) => {
      const r = consultancyRowScore(c);
      return [c.name, c.agency, c.amountLakhs ?? '—', r.reason, r.score, proofCell(c.proofFile)];
    })
  )}
  ${listTable('2.7 Research Guidance',
    ['Name of the Student', 'University', 'Title of the Thesis', 'Guide / Co-Guide', 'Score', 'Proof'],
    (sub.cat2Guidance ?? []).map((g: any) => {
      const r = guidanceRowScore(g);
      return [g.studentName, g.university, g.thesisTitle, r.reason, r.score, proofCell(g.proofFile)];
    })
  )}
  ${listTable('2.8 Research Interest Groups and Development of Research Facilities',
    ['Name of Interest Group', 'Size of the Group', 'Outcome', 'Score', 'Proof'],
    (sub.cat2ResearchGroups ?? []).map((g: any) => [
      g.groupName, g.size, g.outcome || 'No outcome given', outcomeRowScore(g.groupName, g.outcome).score, proofCell(g.proofFile),
    ])
  )}
  ${listTable('2.9 Interaction / Association with Institutes and Industry Linkage',
    ['Institute / Industry', 'Name', 'Associated Person', 'Outcome', 'Score', 'Proof'],
    [
      ...(sub.cat2Linkages ?? []).map((l: any) => [
        'Institute', l.instituteName, l.contactPerson, l.outcome || 'No outcome given',
        outcomeRowScore(l.instituteName, l.outcome).score, proofCell(l.proofFile),
      ]),
      ...(sub.cat2IndustryLinkages ?? []).map((l: any) => [
        'Industry', l.industryName, l.contactPerson, l.outcome || 'No outcome given',
        outcomeRowScore(l.industryName, l.outcome).score, proofCell(l.proofFile),
      ]),
    ]
  )}
  ${listTable('2.10 Initiation / Motivation / Guidance towards Innovation / Start-ups',
    ['Name of the Group', 'Activity', 'Outcome', 'Score', 'Proof'],
    (sub.cat2Startups ?? []).map((x: any) => [
      x.groupName, x.activity, x.outcome || 'No outcome given', outcomeRowScore(x.groupName, x.outcome).score, proofCell(x.proofFile),
    ])
  )}

  <h2>Cat 3 — Faculty Development</h2>
  ${sub.cat3AdvQual ? listTable('3.1 Working for Advanced Qualification (Status of Ph.D.)',
    ['Highest applicable', 'Score', 'Proof'],
    [[advQualScore(sub.cat3AdvQual).reason, advQualScore(sub.cat3AdvQual).score, proofCell(sub.cat3AdvQual.proofFile)]]
  ) : ''}
  ${listTable('3.2 Organizing Seminars / Conferences / Workshops / Training Programmes',
    ['Title of the Programme', 'Period', 'Sponsors', 'Status', 'National / International', 'Score', 'Proof'],
    (sub.cat3Organised ?? []).map((e: any) => [
      e.title, e.period, e.sponsor || '—', e.status, scopeLabel(e.scope), PER_ENTRY.organisedPrograms, proofCell(e.proofFile),
    ])
  )}
  ${listTable('Conferences / Seminars / Workshops Attended (local addition, not in the PDF)',
    ['Paper Title', 'Authors', 'Conference', 'Period', 'Score', 'Proof'],
    (sub.cat3ConferencesAttended ?? []).map((c: any) => [
      c.paperTitle, c.authors, c.conferenceName, c.period, PER_ENTRY.conferencesAttended, proofCell(c.proofFile),
    ])
  )}
  ${listTable('3.3 Resource Person in Conferences / FDPs / Workshops / Guest Lectures etc.',
    ['Type of the Program', 'Name of the Program', 'Lecture Topic', 'Duration', 'Venue', 'Organized By', 'Score', 'Proof'],
    (sub.cat3ResourcePerson ?? []).map((r: any) => [
      r.programType, r.programName, r.topic, r.duration, r.venue, r.organisedBy, PER_ENTRY.resourcePerson, proofCell(r.proofFile),
    ])
  )}
  ${listTable('3.4 Editorial Boards / Organising Committees / Reviewer Roles',
    ['Nature of Contribution', 'Organization / Journal / Conference', 'National / International', 'Date / Duration', 'Score', 'Proof'],
    (sub.cat3Editorial ?? []).map((e: any) => [
      e.natureOfContrib, e.orgOrJournal, scopeLabel(e.scope), e.dateDuration, PER_ENTRY.editorial, proofCell(e.proofFile),
    ])
  )}
  ${listTable('3.5 Training Programs Attended',
    ['Name of the Programme', 'Period', 'Duration (days)', 'Basis', 'Score', 'Proof'],
    (sub.cat3Training ?? []).map((t: any) => {
      const r = trainingRowScore(t);
      return [t.name, t.period, t.durationDays, r.reason, r.score, proofCell(t.proofFile)];
    })
  )}
  ${listTable('3.6 International Travel / Exposure',
    ['Purpose of Travel', 'Place of Visit / University', 'Outcome', 'Funding', 'Score', 'Proof'],
    (sub.cat3IntlTravel ?? []).map((t: any) => [
      t.purpose, t.placeOrUniv, t.outcome, t.fundingSource || '—', PER_ENTRY.intlTravel, proofCell(t.proofFile),
    ])
  )}

  <h2>Cat 4 — Governance &amp; Administration</h2>
  ${listTable('4.1 Contribution to Management of the Department and Institution',
    ['Academic / Administrative Responsibility', 'Institute / Department', 'Work Involved', 'Period', 'Score', 'Proof'],
    (sub.cat4AdminResp ?? []).map((a: any) => [
      a.responsibility, a.level, a.workInvolved, a.period, PER_ENTRY.adminResp, proofCell(a.proofFile),
    ])
  )}
  ${listTable('4.2 Student-related Co-curricular, Extra-curricular, Extension and Outreach Activities',
    ['Activity', 'Period', 'Score', 'Proof'],
    (sub.cat4StudentAct ?? []).map((s: any) => [s.activityName, s.period, PER_ENTRY.studentActivities, proofCell(s.proofFile)])
  )}

  <h2>Cat 5 — Supplementary Process</h2>
  ${listTable('5.1 Membership in Professional Bodies',
    ['Name of the Association / Organization', 'Status', 'Score', 'Proof'],
    (sub.cat5Memberships ?? []).map((m: any) => {
      const r = membershipRowScore(m);
      return [m.association, r.reason, r.score, proofCell(m.proofFile)];
    })
  )}
  ${listTable('5.2 Awards / Rewards, Honors and Recognitions',
    ['Type of Award', 'Organization', 'Level', 'Score', 'Proof'],
    (sub.cat5Awards ?? []).map((a: any) => {
      const r = awardRowScore(a);
      return [a.awardType, a.organization, r.reason, r.score, proofCell(a.proofFile)];
    })
  )}
  ${listTable('5.3 Participation / Leading the VNR VJIET Differentiators',
    ['Differentiator', 'Participation / Leading / Initiating', 'Score', 'Proof'],
    (sub.cat5Differentiators ?? []).map((d: any) => {
      const r = differentiatorRowScore(d);
      return [d.name, r.reason, r.score, proofCell(d.proofFile)];
    })
  )}
  ${listTable('5.4 Internships Arranged for Students in Industries / Institutes',
    ['Industry / Institute', 'Student Batch', 'Internship Details', 'Period', 'Score', 'Proof'],
    (sub.cat5Internships ?? []).map((i: any) => [
      i.industryOrInst, i.studentBatch, i.internshipDetails, i.period, PER_ENTRY.internships, proofCell(i.proofFile),
    ])
  )}

  <div class="sig-grid">
    <div class="sig-box">${sub.submittedAt ? `Signed ${fmtDate(sub.submittedAt)}` : ''}<br /><b>Signature of Faculty</b><br />${esc(user.name)}</div>
    <div class="sig-box">${review?.reviewedAt ? `Reviewed ${fmtDate(review.reviewedAt)}` : ''}<br /><b>Signature of Reviewer/HoD</b></div>
  </div>

  <div class="footer">
    Generated by VNRVJIET Faculty Appraisal Portal · ${new Date().toLocaleString()}
  </div>
</body></html>`;
}

// ─── Annual feedback PDF (W6.5) ──────────────────────────────────────

// The narrative is free text written by a HoD; it must not be able to close a
// tag and take over the document.
function esc(v: any): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const narrativeBlock = (label: string, text: any): string => `
  <h3>${label}</h3>
  <div style="white-space:pre-wrap;border-left:3px solid #e9a93a;padding:4px 10px;background:#fdf6e4;min-height:18px">${
    esc(text) || '<span style="color:#94a3b8">—</span>'
  }</div>
`;

/**
 * `snapshot` is the cadre / eligibility / self-score standing. Pass it only for
 * a HoD or admin: faculty see their narrative and nothing of the eligibility
 * machinery, exactly as GET /appraisals/:id/feedback strips it for the owner.
 */
export function renderFeedbackHtml(
  feedback: any,
  snapshot: any | null,
  meta: { user: any; yearLabel: string },
): string {
  const u = meta.user ?? {};
  const s = snapshot;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head>
<body>
  ${instituteHeader()}
  <h1>Annual Faculty Feedback</h1>
  <div style="text-align:center;font-size:10pt;color:#64748b;margin-bottom:14px">
    Academic Year ${esc(meta.yearLabel)} · ${statusBadge(feedback.status)}
  </div>

  <h2>Faculty</h2>
  <div class="meta">
    <div><b>Name:</b> ${esc(u.name) || '—'}</div>
    <div><b>Employee Code:</b> ${esc(u.employeeCode) || '—'}</div>
    <div><b>Designation:</b> ${esc(u.designation) || '—'}</div>
    <div><b>Department:</b> ${esc(u.department?.name) || '—'}</div>
  </div>

  ${s ? `
    <h2>Standing</h2>
    <div class="meta">
      <div><b>Cadre:</b> ${esc(s.cadreLabel) || '—'}</div>
      <div><b>Meets ideal targets:</b> ${s.eligible ? 'Yes' : 'No'}</div>
    </div>
    ${s.scores ? `
      <div class="score-grid">
        ${([['cat1', 'Cat 1'], ['cat2', 'Cat 2'], ['cat3', 'Cat 3'], ['cat4', 'Cat 4'], ['cat5', 'Cat 5']] as const)
          .map(([k, lbl]) => `
            <div class="score-cell">
              <div class="num">${(s.scores[k] ?? 0).toFixed(1)}</div>
              <div class="lbl">${lbl}</div>
            </div>`).join('')}
      </div>
      <div class="grand">Self-appraisal total: ${(s.scores.total ?? 0).toFixed(1)} <small>/ 500</small></div>
    ` : ''}
    ${s.requirements?.length ? `
      <h3>Ideal targets</h3>
      <table>
        <thead><tr><th>Criterion</th><th>Target</th><th>Actual</th><th>Met</th></tr></thead>
        <tbody>
          ${s.requirements.map((r: any) => `
            <tr>
              <td>${esc(r.label)}${r.gating ? ' <b>*</b>' : ''}</td>
              <td>${esc(r.target)}</td>
              <td>${esc(r.actual)}</td>
              <td>${r.met ? 'Yes' : 'No'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="font-size:8pt;color:#64748b">* mandatory criterion</div>
    ` : ''}
  ` : ''}

  <h2>Feedback</h2>
  ${narrativeBlock('Strengths', feedback.strengths)}
  ${narrativeBlock('Areas to improve', feedback.improvements)}
  ${narrativeBlock('Growth targets (next cycle)', feedback.growthTargets)}

  <div class="sig-grid">
    <div class="sig-box">
      ${feedback.issuedAt ? `Issued ${fmtDate(feedback.issuedAt)}<br />${esc(feedback.issuedBy?.name)}` : 'Not yet issued'}
      <br /><b>Head of Department</b>
    </div>
    <div class="sig-box"><br /><b>Signature of Faculty</b><br />${esc(u.name)}</div>
  </div>

  <div class="footer">
    Generated by VNRVJIET Faculty Appraisal Portal · ${new Date().toLocaleString()}
  </div>
</body></html>`;
}
