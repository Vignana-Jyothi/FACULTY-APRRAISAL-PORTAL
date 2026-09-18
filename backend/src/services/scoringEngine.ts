/**
 * FPAS scoring engine — THE source of truth for every score in this system.
 *
 * Scores are computed server-side only. The official form
 * ("FACULTY ANNUAL PERFORMANCE SELF APPRAISAL", AY 2025-2026) is the
 * specification; where this file and the PDF disagree, the PDF wins.
 *
 * FOUR FILES MOVE TOGETHER. Changing a rule here without the other three
 * fails the parity suites on both sides:
 *
 *   1. backend/src/services/scoringEngine.ts          <- you are here (authoritative)
 *   2. frontend/src/utils/scoring.ts                  <- pure port, for live form badges
 *   3. docs/superpowers/plans/scoring-expected.json   <- hand-verified expected breakdown
 *   4. docs/superpowers/plans/scoring-fixture.json    <- shared input fixture (only if new fields are needed)
 *
 * Asserted by scoringEngine.parity.test.ts (here) and scoring.test.ts
 * (frontend), which both load the same fixture and expect the same object.
 *
 * Never re-implement a formula in a screen or an export. If a view needs to
 * show the working, export a helper from the port (see courseResultScore)
 * and call it, so there is only ever one copy of the arithmetic.
 */
import {
  AppraisalSubmission,
  Cat1Course,
  Cat1CourseResults,
  Cat1Project,
  Cat1EContent,
  Cat1ICT,
  Cat2Journal,
  Cat2Conference,
  Cat2ConfBookChapter,
  Cat2BookChapter,
  Cat2Book,
  Cat2Citations,
  Cat2Patent,
  Cat2Project,
  Cat2Consultancy,
  Cat2Guidance,
  Cat2ResearchGroup,
  Cat2Linkage,
  Cat2Startup,
  Cat2IndustryLinkage,
  Cat3AdvQual,
  Cat3OrganisedProgram,
  Cat3ConferenceAttended,
  Cat3ResourcePerson,
  Cat3Editorial,
  Cat3Training,
  Cat3IntlTravel,
  Cat4AdminResp,
  Cat4StudentActivity,
  Cat5Membership,
  Cat5Award,
  Cat5Differentiator,
  Cat5Internship,
  CourseLevel,
  ProjectType,
  PublicationIndex,
  PatentStatus,
  ProjectStatus,
  Scope,
} from '@prisma/client';

export interface ScoreBreakdown {
  cat1: {
    lectures: number;
    attendanceFeedback: number;
    projects: number;
    eContent: number;
    ict: number;
    total: number;
  };
  cat2: {
    publications: number;
    citations: number;
    books: number;
    patents: number;
    sponsoredProjects: number;
    consultancy: number;
    guidance: number;
    researchGroups: number;
    linkages: number;
    startups: number;
    total: number;
  };
  cat3: {
    advQual: number;
    organisedPrograms: number;
    conferencesAttended: number;
    resourcePerson: number;
    editorial: number;
    training: number;
    intlTravel: number;
    total: number;
  };
  cat4: {
    adminResp: number;
    studentActivities: number;
    total: number;
  };
  cat5: {
    memberships: number;
    awards: number;
    differentiators: number;
    internships: number;
    total: number;
  };
  selfTotal: number;
}

type FullSubmission = AppraisalSubmission & {
  cat1Courses: Cat1Course[];
  cat1CourseResults: Cat1CourseResults[];
  cat1Projects: Cat1Project[];
  cat1EContent: Cat1EContent[];
  cat1ICT: Cat1ICT[];
  cat2Journals: Cat2Journal[];
  cat2Conferences: Cat2Conference[];
  cat2ConfBookChapters: Cat2ConfBookChapter[];
  cat2BookChapters: Cat2BookChapter[];
  cat2Books: Cat2Book[];
  cat2Citations: Cat2Citations | null;
  cat2Patents: Cat2Patent[];
  cat2Projects: Cat2Project[];
  cat2Consultancy: Cat2Consultancy[];
  cat2Guidance: Cat2Guidance[];
  cat2ResearchGroups: Cat2ResearchGroup[];
  cat2Linkages: Cat2Linkage[];
  cat2Startups: Cat2Startup[];
  cat2IndustryLinkages: Cat2IndustryLinkage[];
  cat3AdvQual: Cat3AdvQual | null;
  cat3Organised: Cat3OrganisedProgram[];
  // Scored at 10 each, capped at 20 (see scoreCategory3) — kept by product
  // decision even though the PDF has no matching subsection. Do not delete.
  cat3ConferencesAttended: Cat3ConferenceAttended[];
  cat3ResourcePerson: Cat3ResourcePerson[];
  cat3Editorial: Cat3Editorial[];
  cat3Training: Cat3Training[];
  cat3IntlTravel: Cat3IntlTravel[];
  cat4AdminResp: Cat4AdminResp[];
  cat4StudentAct: Cat4StudentActivity[];
  cat5Memberships: Cat5Membership[];
  cat5Awards: Cat5Award[];
  cat5Differentiators: Cat5Differentiator[];
  cat5Internships: Cat5Internship[];
};

/**
 * 1.1 per-course working, exported so views that show it (the PDF export) use
 * the numbers the engine scores with. Mirrored by lectureRowScore in the
 * frontend port.
 *
 * PDF: 96-100% engagement 10, 90-95% 8, 80-89% 6, below 80% 4; +5 for a novel
 * pedagogical method. Owner decisions (2026-09-11):
 *  - The engagement % is rounded to a whole number before banding, because the
 *    PDF's bands are whole numbers (95.5% -> 96 -> 10).
 *  - No periods planned, or none conducted, means no engagement to score: the
 *    whole row is 0, novelty included. Guarding "planned" is not pedantry —
 *    `conducted / 0` is Infinity, which once cleared the 96% band — and a
 *    blank "conducted" used to collect the 4-mark floor.
 *  - A named method counts as novel pedagogy used, even if the box is unticked.
 */
export function lectureRowScore(c: {
  periodPlanned?: number | null;
  periodsConducted?: number | null;
  novelPedagogyUsed?: boolean | null;
  novelPedagogyMethod?: string | null;
}) {
  const planned = Number(c.periodPlanned);
  const conducted = Number(c.periodsConducted);
  if (!(planned > 0) || !(conducted > 0)) return { pct: null as number | null, engagement: 0, novelty: 0, total: 0 };
  const pct = Math.round((conducted / planned) * 100);
  const engagement = pct >= 96 ? 10 : pct >= 90 ? 8 : pct >= 80 ? 6 : 4;
  const used = !!c.novelPedagogyUsed || !!(c.novelPedagogyMethod ?? '').trim();
  const novelty = used ? 5 : 0;
  return { pct, engagement, novelty, total: engagement + novelty };
}

/**
 * 1.3 per-row working, exported for the PDF export. Mirrored by
 * projectRowScore in the frontend port.
 *
 * PDF: B.Tech mini 2 and major 5 per batch; M.Tech mini 3 and major 5 per
 * student. The count is a whole number: a negative or blank count scores 0 — a
 * negative row once subtracted from the rest of the section — and a fraction
 * is dropped, because the database stores an Int.
 */
const PROJECT_RATE: Record<string, number> = { 'BTECH:MINI': 2, 'BTECH:MAJOR': 5, 'MTECH:MINI': 3, 'MTECH:MAJOR': 5 };
export function projectRowScore(p: { course?: string | null; projectType?: string | null; count?: number | null }) {
  const rate = PROJECT_RATE[`${p.course}:${p.projectType}`] ?? 0;
  const raw = Number(p.count);
  const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return { rate, count, unit: p.course === 'MTECH' ? 'student' : 'batch', score: rate * count };
}

/**
 * Whether a proof field holds real evidence: an http(s) link with a real host
 * (Google Drive, YouTube, ...) or a file uploaded to the portal. Mirrored in
 * the frontend port.
 */
export function isEvidenceLink(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s) || /^\/uploads\/\S+$/.test(s);
}

/**
 * 1.4 per-row working. PDF: "2 marks for e-content development with evidence"
 * (internally audited). Owner decision 2026-09-11: a row scores only when its
 * evidence is a real link — an empty box or made-up text earns nothing. HoD
 * proof verification still applies on top: a rejected link that is never
 * corrected voids the section (applyVoidedSources).
 */
export function eContentRowScore(e: { evidenceFile?: string | null }) {
  const evidence = isEvidenceLink(e.evidenceFile);
  return { evidence, score: evidence ? 2 : 0 };
}

/**
 * 1.5 per-row working. PDF: "LMS usage, online quizzes, digital assignments,
 * flipped classrooms with documentary evidence", max 5, no per-row figure.
 * Owner decisions 2026-09-11: 2 per documented course (3 reach the max), and
 * "documented" means an evidence link, exactly as in 1.4.
 */
export function ictRowScore(i: { evidenceFile?: string | null }) {
  const evidence = isEvidenceLink(i.evidenceFile);
  return { evidence, score: evidence ? 2 : 0 };
}

function scoreCategory1(s: FullSubmission) {
  // 1.1 Lectures (max 40) — per-course rules in lectureRowScore.
  let lectures = 0;
  for (const c of s.cat1Courses) lectures += lectureRowScore(c).total;
  lectures = Math.min(lectures, 40);

  // 1.2 Attendance / Feedback / Results (per course max 20, section max 80).
  // PDF: A = (avg attendance % / 100) * 5, B = feedback out of 5,
  //      C = (pass % / 100) * 10.
  let attendanceFeedback = 0;
  for (const c of s.cat1CourseResults) {
    const A = Math.min(Math.max(c.avgAttendancePct, 0) / 100 * 5, 5);
    const B = Math.min(Math.max(c.feedbackReceived, 0), 5);
    const C = Math.min(Math.max(c.passPercentage, 0) / 100 * 10, 10);
    attendanceFeedback += Math.min(A + B + C, 20);
  }
  attendanceFeedback = Math.min(attendanceFeedback, 80);

  // 1.3 Projects (max 20) — per-row rules in projectRowScore.
  let projects = 0;
  for (const p of s.cat1Projects) projects += projectRowScore(p).score;
  projects = Math.min(projects, 20);

  // 1.4 e-Content (max 5)
  let eContent = 0;
  for (const e of s.cat1EContent) eContent += eContentRowScore(e).score;
  eContent = Math.min(eContent, 5);

  // 1.5 ICT (max 5)
  let ict = 0;
  for (const i of s.cat1ICT) ict += ictRowScore(i).score;
  ict = Math.min(ict, 5);

  const total = Math.min(lectures + attendanceFeedback + projects + eContent + ict, 150);
  return { lectures, attendanceFeedback, projects, eContent, ict, total };
}

/**
 * 2.1 per-row score, exported for the views that show the working. Mirrored
 * by publicationRowScore in the frontend port.
 *
 * PDF: 15 for quality publications in SCI / WoS / Scopus journals; 10 for
 * indexed conference proceedings and indexed book chapters from conferences;
 * nothing else scores. Owner decision 2026-09-11 (strict PDF): an ESCI or ICI
 * journal scores 0 — it earned 10 from 2026-08-12. For conference papers and
 * conference book chapters the PDF says only "indexed", so any index (WoS,
 * Scopus, ESCI, ICI) earns the 10. SCI / SCIE journals are stored as WOS; the
 * form labels that choice "SCI / SCIE / WoS".
 */
export type PublicationKind = 'journal' | 'conference' | 'chapter';
export function publicationRowScore(kind: PublicationKind, indexed?: string | null): number {
  const ix = indexed ?? PublicationIndex.NONE;
  if (kind === 'journal') return ix === PublicationIndex.WOS || ix === PublicationIndex.SCOPUS ? 15 : 0;
  return ix === PublicationIndex.WOS || ix === PublicationIndex.SCOPUS ||
    ix === PublicationIndex.ESCI || ix === PublicationIndex.ICI ? 10 : 0;
}

/** Display labels for stored index values (mirrored in the frontend port). */
export const INDEX_LABEL: Record<string, string> = {
  WOS: 'SCI / SCIE / WoS', SCOPUS: 'Scopus', ESCI: 'ESCI', ICI: 'ICI', NONE: 'Not indexed',
};

/** Number of names in an author list ("A, B and C" -> 3). Display only. */
export function countAuthors(list?: string | null): number {
  return String(list ?? '').split(/[,;&]|\band\b/i).map((s) => s.trim()).filter(Boolean).length;
}

/** Author count for a 2.1 row: its author list when there is one, else the legacy text. */
export function authorCount(r: { authorList?: string[] | null; authors?: string | null } | null | undefined): number {
  const listed = (r?.authorList ?? []).filter((a) => String(a ?? '').trim()).length;
  return listed || countAuthors(r?.authors);
}

/**
 * 2.1 authorship claim, owner decisions 2026-09-15. When every author of a
 * paper is from VNRVJIET, only one of them may claim it: the form asks whether
 * the appraisal's owner or another co-author claims the paper, and the server
 * refuses to save a row claimed by someone else (utils/publicationAuthors).
 * The owner is always the faculty filing — there is no "which author is me"
 * question. A paper with co-authors from other institutions
 * is the faculty's to claim. The campus question must be answered — left
 * unanswered, the paper scores 0, as an unchosen 2.3 publisher level does.
 * Target counts (trackingEngine.countedItems) are deliberately unaffected.
 * Mirrored in the frontend port.
 */
export type PublicationClaimRow = {
  allAuthorsFromCampus?: boolean | null;
  claimedBySelf?: boolean | null;
};
export function publicationClaim(r: PublicationClaimRow | null | undefined): { ok: boolean; reason: string } {
  if (r?.allAuthorsFromCampus == null) return { ok: false, reason: 'Answer "are all authors from VNRVJIET?" to score this paper' };
  if (r.allAuthorsFromCampus === false) return { ok: true, reason: 'Co-authors from other institutions' };
  if (r.claimedBySelf == null) return { ok: false, reason: 'Choose who claims this paper' };
  if (r.claimedBySelf === false) return { ok: false, reason: 'Claimed by another co-author' };
  return { ok: true, reason: 'All authors from VNRVJIET, claimed by you' };
}

/** 2.1 per-row score with the authorship claim applied. Views call this for a row. */
export function publicationScore(
  kind: PublicationKind,
  r: (PublicationClaimRow & { indexed?: string | null }) | null | undefined,
): { score: number; reason: string } {
  const claim = publicationClaim(r);
  if (!claim.ok) return { score: 0, reason: claim.reason };
  return { score: publicationRowScore(kind, r?.indexed), reason: claim.reason };
}

/**
 * 2.2 score from cumulative Scopus / WoS citations. PDF: 3-10 -> 1, 11-50 -> 2,
 * 51-100 -> 3, >100 -> 5; fewer than 3, blank or negative -> 0. Exported for
 * the views that show the working; mirrored in the frontend port.
 */
export function citationScore(totalCitations?: number | null): number {
  const tc = Number(totalCitations);
  if (!Number.isFinite(tc)) return 0;
  return tc > 100 ? 5 : tc >= 51 ? 3 : tc >= 11 ? 2 : tc >= 3 ? 1 : 0;
}

/**
 * 2.3 per-row working, exported for the views that show it; mirrored in the
 * frontend port. PDF: international publisher author 10 / editor 5, national
 * author 5 / editor 3. An untitled row is a placeholder, not a book. Owner
 * decision 2026-09-11: a row with no publisher level chosen scores 0 — it
 * used to default to International, which paid 10 to a national book whose
 * owner forgot to change it.
 */
export function bookRowScore(r: { title?: string | null; scope?: string | null; isEdited?: boolean | string | null }) {
  if (!String(r.title ?? '').trim()) return { score: 0, reason: 'Enter the title to score this entry' };
  const scope = r.scope;
  if (scope !== Scope.INTERNATIONAL && scope !== Scope.NATIONAL) {
    return { score: 0, reason: 'Pick National or International to score this entry' };
  }
  const edited = r.isEdited === true || r.isEdited === 'true';
  const score = scope === Scope.INTERNATIONAL ? (edited ? 5 : 10) : (edited ? 3 : 5);
  return { score, reason: `${scope === Scope.INTERNATIONAL ? 'International' : 'National'} publisher, ${edited ? 'editor' : 'author'}` };
}

/**
 * 2.4 per-row working, exported for the views that show it; mirrored in the
 * frontend port. PDF: Published 5, Granted 10 — for any kind of IPR (patent,
 * copyright, trademark, design; transfer of technology goes under Other).
 * Filed alone scores 0 (2026-08-12). An untitled row is a placeholder: the
 * blank-row filters already drop it before saving, and this guard keeps the
 * engine honest on its own, as bookRowScore does.
 */
export function patentRowScore(p: { title?: string | null; status?: string | null }) {
  if (!String(p.title ?? '').trim()) return { score: 0, reason: 'Enter the title to score this entry' };
  if (p.status === PatentStatus.GRANTED) return { score: 10, reason: 'Granted' };
  if (p.status === PatentStatus.PUBLISHED) return { score: 5, reason: 'Published' };
  return { score: 0, reason: 'Filed — scores once published (5) or granted (10)' };
}

/**
 * 2.5 per-row working, exported for the views that show it; mirrored in the
 * frontend port. PDF: Ongoing Projects 20, Applied Projects 5. Owner decisions
 * 2026-09-11: those marks are PER PROJECT and add up (capped at 20) — the
 * engine used to take only the best single project, so four applied projects
 * earned 5; a Completed project is listed but scores 0, as the PDF names only
 * Ongoing and Applied. An untitled row scores 0, as in 2.3 and 2.4.
 */
export function sponsoredProjectRowScore(p: { title?: string | null; status?: string | null }) {
  if (!String(p.title ?? '').trim()) return { score: 0, reason: 'Enter the title to score this project' };
  if (p.status === ProjectStatus.ONGOING) return { score: 20, reason: 'Ongoing' };
  if (p.status === ProjectStatus.APPLIED) return { score: 5, reason: 'Applied' };
  if (p.status === ProjectStatus.COMPLETED) return { score: 0, reason: 'Completed — listed for the record, not scored' };
  return { score: 0, reason: 'Choose a status' };
}

const filled = (v: unknown) => String(v ?? '').trim() !== '';

/**
 * 2.6 per-row working, exported for the views that show it; mirrored in the
 * frontend port. PDF: "upto 1.0 Lakh - 2, 1 to 2 Lakhs - 4, 2 to 5 Lakhs - 6,
 * 5 to 10 Lakhs - 8, above 10 Lakhs - 10". Owner decision 2026-09-13: each
 * band keeps its upper edge ("upto"), so exactly 1 / 2 / 5 / 10 lakh score
 * 2 / 4 / 6 / 8. 10 lakh already did (2026-08-12); 1, 2 and 5 lakh used to jump
 * a band. (The PDF's "5 for each project" line contradicts its own bands; the
 * bands have been the rule since 2026-08-12.) A row with no amount, or no
 * project name, is not a project — the blank-row filter keeps an agency-only
 * row, and it used to score.
 */
export function consultancyRowScore(c: { name?: string | null; amountLakhs?: number | null }) {
  if (!filled(c.name)) return { score: 0, reason: 'Enter the project name to score this entry' };
  const a = Number(c.amountLakhs);
  if (!Number.isFinite(a) || a <= 0) return { score: 0, reason: 'Enter the amount to score this entry' };
  if (a > 10) return { score: 10, reason: 'Above Rs. 10 lakh' };
  if (a > 5) return { score: 8, reason: 'Rs. 5-10 lakh' };
  if (a > 2) return { score: 6, reason: 'Rs. 2-5 lakh' };
  if (a > 1) return { score: 4, reason: 'Rs. 1-2 lakh' };
  return { score: 2, reason: 'Up to Rs. 1 lakh' };
}

/** 2.7 per-row working. PDF: Ph.D. guide 5 per candidate, co-guide 3 (section max 5). */
export function guidanceRowScore(g: { isGuide?: boolean | null }) {
  return g.isGuide ? { score: 5, reason: 'Guide' } : { score: 3, reason: 'Co-Guide' };
}

/**
 * 2.8 / 2.9 / 2.10 per-row working — 5 per entry. PDF 2.8 pays for a research
 * group "with tangible outcomes". Owner decision 2026-09-13: the same holds for
 * a 2.9 linkage and a 2.10 start-up activity, so an entry with a blank Outcome
 * scores 0 in all three. `name` is the row's own identifier (group, institute
 * or industry name).
 */
export function outcomeRowScore(name: unknown, outcome: unknown) {
  if (!filled(name)) return { score: 0, reason: 'Enter the name to score this entry' };
  if (!filled(outcome)) return { score: 0, reason: 'Add the tangible outcome to score this entry' };
  return { score: 5, reason: 'With outcome' };
}

/**
 * 3.1 — the highest applicable level, max 10. PDF: pursuing Post Doc 10; Ph.D.
 * thesis submitted 10, pre-Ph.D. completed 8, course work completed 5 (the form
 * calls that "Registered for Ph.D."); any other PG degree 10; PG diploma 10.
 */
export function advQualScore(q: {
  registeredForPhD?: boolean | null; clearedPrePhD?: boolean | null; thesisSubmitted?: boolean | null;
  awarded?: boolean | null; postDoc?: boolean | null; pgDegree?: boolean | null; pgDiploma?: boolean | null;
} | null | undefined) {
  if (!q) return { score: 0, reason: 'Not filled' };
  if (q.postDoc) return { score: 10, reason: 'Post-Doctoral' };
  if (q.awarded) return { score: 10, reason: 'Ph.D. awarded' };
  if (q.thesisSubmitted) return { score: 10, reason: 'Thesis submitted' };
  if (q.pgDegree) return { score: 10, reason: 'PG degree' };
  if (q.pgDiploma) return { score: 10, reason: 'PG diploma' };
  if (q.clearedPrePhD) return { score: 8, reason: 'Cleared pre-Ph.D.' };
  if (q.registeredForPhD) return { score: 5, reason: 'Registered for Ph.D.' };
  return { score: 0, reason: 'None' };
}

/**
 * Marks per entry in the subsections that pay a flat rate per row; each
 * section's cap still applies. Exported so the views print the same figures.
 */
export const PER_ENTRY = {
  organisedPrograms: 10, conferencesAttended: 10, resourcePerson: 10, editorial: 10, intlTravel: 5,
  adminResp: 10, studentActivities: 5, internships: 5,
} as const;

/** 3.5 per-row working. PDF: 10 for more than 5 days, 5 for a minimum of 5 days; shorter scores nothing. */
export function trainingRowScore(t: { durationDays?: number | null }) {
  const days = Number(t.durationDays);
  if (!Number.isFinite(days) || days <= 0) return { score: 0, reason: 'Enter the duration to score this entry' };
  if (days > 5) return { score: 10, reason: 'More than 5 days' };
  if (days >= 5) return { score: 5, reason: '5 days' };
  return { score: 0, reason: 'Under 5 days — not scored' };
}

/** 5.1 per-row working. PDF: national 5, international 10, national executive 10; life membership 10 (v2 owner decision). */
export function membershipRowScore(m: { status?: string | null }) {
  if (m.status === 'national_member') return { score: 5, reason: 'National member' };
  if (m.status === 'international_member') return { score: 10, reason: 'International member' };
  if (m.status === 'national_executive') return { score: 10, reason: 'National executive' };
  if (m.status === 'life_member') return { score: 10, reason: 'Life member' };
  return { score: 0, reason: 'Choose a status' };
}

/** 5.2 per-row working. PDF: international / national 10, state 5; an unset level scores nothing. */
export function awardRowScore(a: { level?: string | null }) {
  if (a.level === 'international') return { score: 10, reason: 'International' };
  if (a.level === 'national') return { score: 10, reason: 'National' };
  if (a.level === 'state') return { score: 5, reason: 'State' };
  return { score: 0, reason: 'Choose a level' };
}

/** 5.3 per-row working. PDF: participating 3, leading 7, initiating / shaping / executing 10. */
export function differentiatorRowScore(d: { role?: string | null }) {
  if (d.role === 'participating') return { score: 3, reason: 'Participating' };
  if (d.role === 'leading') return { score: 7, reason: 'Leading' };
  if (d.role === 'initiating') return { score: 10, reason: 'Initiating, shaping & executing' };
  return { score: 0, reason: 'Choose a role' };
}

function scoreCategory2(s: FullSubmission) {
  // 2.1 Publications — A journals + B conference proceedings + C conference
  // book chapters share one cap of 60. Per-row rules in publicationScore
  // (index rule + authorship claim).
  let publications = 0;
  for (const j of s.cat2Journals) publications += publicationScore('journal', j).score;
  for (const c of s.cat2Conferences) publications += publicationScore('conference', c).score;
  for (const x of s.cat2ConfBookChapters) publications += publicationScore('chapter', x).score;
  publications = Math.min(publications, 60);

  // 2.2 Citations (max 5) — bands in citationScore.
  const citations = citationScore(s.cat2Citations?.totalCitations);

  // 2.3 Books & Chapters (max 10) — per-row rules in bookRowScore.
  let books = 0;
  for (const b of s.cat2Books) books += bookRowScore(b).score;
  for (const bc of s.cat2BookChapters) books += bookRowScore(bc).score;
  books = Math.min(books, 10);

  // 2.4 Patents / IPR (max 20) — per-row rules in patentRowScore.
  let patents = 0;
  for (const p of s.cat2Patents) patents += patentRowScore(p).score;
  patents = Math.min(patents, 20);

  // 2.5 Sponsored Projects (max 20) — per project, summed; rules in sponsoredProjectRowScore.
  let sponsoredProjects = 0;
  for (const p of s.cat2Projects) sponsoredProjects += sponsoredProjectRowScore(p).score;
  sponsoredProjects = Math.min(sponsoredProjects, 20);

  // 2.6 Consultancy (max 10) — per-row bands in consultancyRowScore.
  let consultancy = 0;
  for (const c of s.cat2Consultancy) consultancy += consultancyRowScore(c).score;
  consultancy = Math.min(consultancy, 10);

  // 2.7 Research Guidance (max 5) — Guide 5, Co-Guide 3 per candidate.
  let guidance = 0;
  for (const g of s.cat2Guidance) guidance += guidanceRowScore(g).score;
  guidance = Math.min(guidance, 5);

  // 2.8 Research Groups (max 5) — 5 for a group with a tangible outcome.
  let researchGroups = 0;
  for (const r of s.cat2ResearchGroups) researchGroups += outcomeRowScore(r.groupName, r.outcome).score;
  researchGroups = Math.min(researchGroups, 5);

  // 2.9 Interaction/association with institutes AND industry linkage — ONE
  // subsection in the PDF, 5 per linkage with an outcome, max 10 across both tables.
  let linkages = 0;
  for (const l of s.cat2Linkages) linkages += outcomeRowScore(l.instituteName, l.outcome).score;
  for (const l of s.cat2IndustryLinkages) linkages += outcomeRowScore(l.industryName, l.outcome).score;
  linkages = Math.min(linkages, 10);

  // 2.10 Initiation/motivation/guidance towards innovation & start-ups (max 5),
  // 5 per activity with an outcome.
  let startups = 0;
  for (const x of s.cat2Startups) startups += outcomeRowScore(x.groupName, x.outcome).score;
  startups = Math.min(startups, 5);

  const total = Math.min(
    publications + citations + books + patents + sponsoredProjects +
    consultancy + guidance + researchGroups + linkages + startups,
    150
  );
  return { publications, citations, books, patents, sponsoredProjects, consultancy, guidance, researchGroups, linkages, startups, total };
}

function scoreCategory3(s: FullSubmission) {
  // 3.1 Status of Ph.D. / advanced qualification (max 10) — highest applicable, see advQualScore.
  const advQual = advQualScore(s.cat3AdvQual).score;

  // 3.2 Organised Programs (max 20, 10 each)
  const organisedPrograms = Math.min(s.cat3Organised.length * PER_ENTRY.organisedPrograms, 20);

  // Conferences / Seminars / Workshops Attended (max 20, 10 each) — local
  // addition, deliberately un-numbered: the PDF has no such subsection.
  const conferencesAttended = Math.min(s.cat3ConferencesAttended.length * PER_ENTRY.conferencesAttended, 20);

  // 3.3 Resource Person (max 20, 10 each)
  const resourcePerson = Math.min(s.cat3ResourcePerson.length * PER_ENTRY.resourcePerson, 20);

  // 3.4 Editorial (max 20, 10 each)
  const editorial = Math.min(s.cat3Editorial.length * PER_ENTRY.editorial, 20);

  // 3.5 Training (max 25) — per-row rules in trainingRowScore. Shorter
  // programmes carry no score; anything, a blank row included, once collected 5.
  let training = 0;
  for (const t of s.cat3Training) training += trainingRowScore(t).score;
  training = Math.min(training, 25);

  // 3.6 International Travel (max 5, 5 each)
  const intlTravel = Math.min(s.cat3IntlTravel.length * PER_ENTRY.intlTravel, 5);

  const total = Math.min(
    advQual + organisedPrograms + conferencesAttended + resourcePerson + editorial + training + intlTravel,
    100
  );
  return { advQual, organisedPrograms, conferencesAttended, resourcePerson, editorial, training, intlTravel, total };
}

function scoreCategory4(s: FullSubmission) {
  // 4.1 Administrative responsibilities (max 40, 10 each); 4.2 student activities (max 10, 5 each).
  const adminResp = Math.min(s.cat4AdminResp.length * PER_ENTRY.adminResp, 40);
  const studentActivities = Math.min(s.cat4StudentAct.length * PER_ENTRY.studentActivities, 10);
  const total = Math.min(adminResp + studentActivities, 50);
  return { adminResp, studentActivities, total };
}

function scoreCategory5(s: FullSubmission) {
  // 5.1 Memberships (max 15) — per-row rules in membershipRowScore.
  let memberships = 0;
  for (const m of s.cat5Memberships) memberships += membershipRowScore(m).score;
  memberships = Math.min(memberships, 15);

  // 5.2 Awards (max 10) — per-row rules in awardRowScore. Only the levels the
  // PDF defines score; an old `else 10` once paid anything unrecognised.
  let awards = 0;
  for (const a of s.cat5Awards) awards += awardRowScore(a).score;
  awards = Math.min(awards, 10);

  // 5.3 Differentiators (max 20) — per-row rules in differentiatorRowScore.
  let differentiators = 0;
  for (const d of s.cat5Differentiators) differentiators += differentiatorRowScore(d).score;
  differentiators = Math.min(differentiators, 20);

  // 5.4 Internships (max 5, 5 each)
  const internships = Math.min(s.cat5Internships.length * PER_ENTRY.internships, 5);

  const total = Math.min(memberships + awards + differentiators + internships, 50);
  return { memberships, awards, differentiators, internships, total };
}

/**
 * Drop the rows of any voided source before scoring.
 *
 * A source is voided when its proof was rejected and the faculty never replaced
 * it by the deadline — the entries stay on the form as a record of what was
 * claimed, but they earn nothing. Applied here, at the single entry point, so
 * every category scorer below stays unaware of proofs. The frontend mirror does
 * exactly the same thing from the same field, which is what keeps the two in
 * parity: the decision travels on the submission, not in a verification query.
 */
export function applyVoidedSources<T extends Record<string, any>>(submission: T): T {
  const voided: string[] = (submission as any).voidedSources ?? [];
  if (!voided.length) return submission;

  const out: Record<string, any> = { ...submission };
  for (const key of voided) {
    if (!(key in out)) continue;
    out[key] = Array.isArray(out[key]) ? [] : null;
  }
  return out as T;
}

export function computeScore(rawSubmission: FullSubmission): ScoreBreakdown {
  const submission = applyVoidedSources(rawSubmission);
  const cat1 = scoreCategory1(submission);
  const cat2 = scoreCategory2(submission);
  const cat3 = scoreCategory3(submission);
  const cat4 = scoreCategory4(submission);
  const cat5 = scoreCategory5(submission);
  const selfTotal = cat1.total + cat2.total + cat3.total + cat4.total + cat5.total;

  return { cat1, cat2, cat3, cat4, cat5, selfTotal };
}
