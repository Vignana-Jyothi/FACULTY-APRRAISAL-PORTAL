// Pure, framework-agnostic port of the backend scoring engine
// (backend/src/services/scoringEngine.ts). Computes the same ScoreBreakdown
// from in-memory react-hook-form values so the UI can show live per-subsection
// scores without a server round-trip.
//
// IMPORTANT: this module must stay in lockstep with the backend engine.
// The backend is the source of truth — if the two ever disagree, fix THIS
// file to match the backend, never the other way around. See
// scoring.test.ts (frontend) and scoringEngine.parity.test.ts (backend),
// which both assert against the same shared fixture
// (docs/superpowers/plans/scoring-fixture.json).
//
// This module does NOT import @prisma/client and must tolerate partial /
// missing form state (arrays default to [], objects to a safe default) — the
// live form may not yet have every relation populated (e.g. cat2ConfBookChapters
// and the cat3AdvQual.postDoc/pgDegree/pgDiploma flags are wired into the form
// UI in a later task). Never throw on partial input.

export type PublicationIndex = 'ESCI' | 'WOS' | 'SCOPUS' | 'ICI' | 'NONE';
export type Scope = 'INTERNATIONAL' | 'NATIONAL';
export type PatentStatus = 'FILED' | 'PUBLISHED' | 'GRANTED';
export type ProjectStatus = 'APPLIED' | 'ONGOING' | 'COMPLETED';
export type CourseLevel = 'BTECH' | 'MTECH';
export type ProjectType = 'MINI' | 'MAJOR';
export type MembershipStatus = 'national_member' | 'international_member' | 'national_executive' | 'life_member';
export type DifferentiatorRole = 'participating' | 'leading' | 'initiating';
// Award level is free-text on the backend model (String, not an enum) — only
// 'state' is special-cased by the scoring rule. Keep it as `string` to match.
export type AwardLevel = string;

export interface Cat1CourseInput {
  periodPlanned?: number;
  periodsConducted?: number;
  novelPedagogyUsed?: boolean;
  novelPedagogyMethod?: string | null;
}

export interface Cat1CourseResultInput {
  classSize?: number;
  avgAttendancePct?: number;
  feedbackReceived?: number;
  passPercentage?: number;
}

export interface Cat1EContentInput {
  evidenceFile?: string | null;
}

export interface Cat1ICTInput {
  evidenceFile?: string | null;
}

export interface Cat1ProjectInput {
  course?: CourseLevel;
  projectType?: ProjectType;
  count?: number;
}

export interface Cat2JournalInput {
  indexed?: PublicationIndex;
}

export interface Cat2ConferenceInput {
  indexed?: PublicationIndex;
}

export interface Cat2ConfBookChapterInput {
  indexed?: PublicationIndex;
}

export interface Cat2BookChapterInput {
  title?: string | null;
  scope?: Scope;
  isEdited?: boolean;
}

export interface Cat2BookInput {
  title?: string | null;
  scope?: Scope;
  isEdited?: boolean;
}

export interface Cat2CitationsInput {
  totalCitations?: number;
}

export interface Cat2PatentInput {
  status?: PatentStatus;
}

export interface Cat2ProjectInput {
  status?: ProjectStatus;
}

export interface Cat2ConsultancyInput {
  name?: string | null;
  amountLakhs?: number;
}

export interface Cat2GuidanceInput {
  isGuide?: boolean;
}

export interface Cat3AdvQualInput {
  registeredForPhD?: boolean;
  clearedPrePhD?: boolean;
  thesisSubmitted?: boolean;
  awarded?: boolean;
  postDoc?: boolean;
  pgDegree?: boolean;
  pgDiploma?: boolean;
}

export interface Cat3TrainingInput {
  durationDays?: number;
}

export interface Cat5MembershipInput {
  status?: MembershipStatus | string;
}

export interface Cat5AwardInput {
  level?: AwardLevel;
}

export interface Cat5DifferentiatorInput {
  role?: DifferentiatorRole | string;
}

// The form's live values object. Every relation is optional/possibly-missing —
// the form may not have loaded/wired every section yet.
export interface ScoreFormValues {
  cat1Courses?: Cat1CourseInput[];
  cat1CourseResults?: Cat1CourseResultInput[];
  cat1Projects?: Cat1ProjectInput[];
  cat1EContent?: Cat1EContentInput[];
  cat1ICT?: Cat1ICTInput[];

  cat2Journals?: Cat2JournalInput[];
  cat2Conferences?: Cat2ConferenceInput[];
  cat2ConfBookChapters?: Cat2ConfBookChapterInput[];
  cat2BookChapters?: Cat2BookChapterInput[];
  cat2Books?: Cat2BookInput[];
  cat2Citations?: Cat2CitationsInput | null;
  cat2Patents?: Cat2PatentInput[];
  cat2Projects?: Cat2ProjectInput[];
  cat2Consultancy?: Cat2ConsultancyInput[];
  cat2Guidance?: Cat2GuidanceInput[];
  cat2ResearchGroups?: unknown[];
  cat2Linkages?: unknown[];
  cat2Startups?: unknown[];
  cat2IndustryLinkages?: unknown[];

  cat3AdvQual?: Cat3AdvQualInput | null;
  cat3Organised?: unknown[];
  // Local addition, not in the PDF — scored 10 each, max 20 (owner decision).
  cat3ConferencesAttended?: unknown[];
  cat3ResourcePerson?: unknown[];
  cat3Editorial?: unknown[];
  cat3Training?: Cat3TrainingInput[];
  cat3IntlTravel?: unknown[];

  cat4AdminResp?: unknown[];
  cat4StudentAct?: unknown[];

  cat5Memberships?: Cat5MembershipInput[];
  cat5Awards?: Cat5AwardInput[];
  cat5Differentiators?: Cat5DifferentiatorInput[];
  cat5Internships?: unknown[];
}

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

// --- defensive helpers -------------------------------------------------
// Arrays and objects on the live form may be missing/undefined mid-edit —
// never throw, just treat as empty/absent.

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// Coerce to a finite number, defaulting missing/blank/NaN values to 0
// (react-hook-form number inputs left blank surface as NaN/undefined).
function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 2.1 per-row score. Mirror of the backend's publicationRowScore: a journal
 * paper earns 15 only in an SCI/SCIE/WoS or Scopus journal (ESCI and ICI
 * journals 0 — owner decision 2026-09-11); a conference paper or conference
 * book chapter earns 10 for any index.
 */
export type PublicationKind = 'journal' | 'conference' | 'chapter';
export function publicationRowScore(kind: PublicationKind, indexed?: PublicationIndex | string | null): number {
  const ix = indexed ?? 'NONE';
  if (kind === 'journal') return ix === 'WOS' || ix === 'SCOPUS' ? 15 : 0;
  return ix === 'WOS' || ix === 'SCOPUS' || ix === 'ESCI' || ix === 'ICI' ? 10 : 0;
}

/** Display labels for stored index values. SCI / SCIE journals are recorded as WOS. */
export const INDEX_LABEL: Record<string, string> = {
  WOS: 'SCI / SCIE / WoS', SCOPUS: 'Scopus', ESCI: 'ESCI', ICI: 'ICI', NONE: 'Not indexed',
};

/** Number of names in an author list ("A, B and C" -> 3). Display only. */
export function countAuthors(list?: string | null): number {
  return String(list ?? '').split(/[,;&]|\band\b/i).map((s) => s.trim()).filter(Boolean).length;
}

/**
 * 2.3 per-row working. Mirror of the backend's bookRowScore: international
 * publisher author 10 / editor 5, national author 5 / editor 3; an untitled
 * row, or one with no publisher level chosen, scores 0 (owner decision
 * 2026-09-11 — it used to default to International).
 */
export function bookRowScore(r: { title?: string | null; scope?: string | null; isEdited?: boolean | string | null } | null | undefined) {
  if (!String(r?.title ?? '').trim()) return { score: 0, reason: 'Enter the title to score this entry' };
  const scope = r?.scope;
  if (scope !== 'INTERNATIONAL' && scope !== 'NATIONAL') return { score: 0, reason: 'Pick National or International to score this entry' };
  const edited = r?.isEdited === true || r?.isEdited === 'true';
  const score = scope === 'INTERNATIONAL' ? (edited ? 5 : 10) : (edited ? 3 : 5);
  return { score, reason: `${scope === 'INTERNATIONAL' ? 'International' : 'National'} publisher, ${edited ? 'editor' : 'author'}` };
}

/**
 * 2.4 per-row working. Mirror of the backend's patentRowScore: Granted 10,
 * Published 5, Filed 0, for any kind of IPR; an untitled row scores 0.
 */
export function patentRowScore(p: { title?: string | null; status?: string | null } | null | undefined) {
  if (!String(p?.title ?? '').trim()) return { score: 0, reason: 'Enter the title to score this entry' };
  if (p?.status === 'GRANTED') return { score: 10, reason: 'Granted' };
  if (p?.status === 'PUBLISHED') return { score: 5, reason: 'Published' };
  return { score: 0, reason: 'Filed — scores once published (5) or granted (10)' };
}

/**
 * 2.5 per-row working. Mirror of the backend's sponsoredProjectRowScore:
 * Ongoing 20, Applied 5 per project (summed, capped at 20 by the section);
 * Completed 0; untitled 0.
 */
export function sponsoredProjectRowScore(p: { title?: string | null; status?: string | null } | null | undefined) {
  if (!String(p?.title ?? '').trim()) return { score: 0, reason: 'Enter the title to score this project' };
  if (p?.status === 'ONGOING') return { score: 20, reason: 'Ongoing' };
  if (p?.status === 'APPLIED') return { score: 5, reason: 'Applied' };
  if (p?.status === 'COMPLETED') return { score: 0, reason: 'Completed — listed for the record, not scored' };
  return { score: 0, reason: 'Choose a status' };
}

/** 2.2 score from Scopus / WoS citations. Mirror of the backend's citationScore. */
export function citationScore(totalCitations?: number | null): number {
  const tc = Number(totalCitations);
  if (!Number.isFinite(tc)) return 0;
  return tc > 100 ? 5 : tc >= 51 ? 3 : tc >= 11 ? 2 : tc >= 3 ? 1 : 0;
}

const filled = (v: unknown) => String(v ?? '').trim() !== '';

/**
 * 2.6 per-row working. Mirror of the backend's consultancyRowScore: bands keep
 * their upper edge (owner decision 2026-09-13) — up to 1 lakh 2, up to 2 4, up
 * to 5 6, up to 10 8, above 10 10; no name or no amount scores 0.
 */
export function consultancyRowScore(c: { name?: string | null; amountLakhs?: number | null } | null | undefined) {
  if (!filled(c?.name)) return { score: 0, reason: 'Enter the project name to score this entry' };
  const a = Number(c?.amountLakhs);
  if (!Number.isFinite(a) || a <= 0) return { score: 0, reason: 'Enter the amount to score this entry' };
  if (a > 10) return { score: 10, reason: 'Above Rs. 10 lakh' };
  if (a > 5) return { score: 8, reason: 'Rs. 5-10 lakh' };
  if (a > 2) return { score: 6, reason: 'Rs. 2-5 lakh' };
  if (a > 1) return { score: 4, reason: 'Rs. 1-2 lakh' };
  return { score: 2, reason: 'Up to Rs. 1 lakh' };
}

/** 2.7 per-row working. Mirror of the backend's guidanceRowScore: guide 5, co-guide 3. */
export function guidanceRowScore(g: { isGuide?: boolean | null } | null | undefined) {
  return g?.isGuide ? { score: 5, reason: 'Guide' } : { score: 3, reason: 'Co-Guide' };
}

/**
 * 2.8 / 2.9 / 2.10 per-row working. Mirror of the backend's outcomeRowScore:
 * 5 per entry with a tangible outcome (owner decision 2026-09-13), else 0.
 */
export function outcomeRowScore(name: unknown, outcome: unknown) {
  if (!filled(name)) return { score: 0, reason: 'Enter the name to score this entry' };
  if (!filled(outcome)) return { score: 0, reason: 'Add the tangible outcome to score this entry' };
  return { score: 5, reason: 'With outcome' };
}

/** 3.1 — highest applicable level. Mirror of the backend's advQualScore. */
export function advQualScore(q: Cat3AdvQualInput | null | undefined) {
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

/** Flat marks per entry (section caps still apply). Mirror of the backend's PER_ENTRY. */
export const PER_ENTRY = {
  organisedPrograms: 10, conferencesAttended: 10, resourcePerson: 10, editorial: 10, intlTravel: 5,
  adminResp: 10, studentActivities: 5, internships: 5,
} as const;

/** 3.5 per-row working. Mirror of the backend's trainingRowScore. */
export function trainingRowScore(t: { durationDays?: number | null } | null | undefined) {
  const days = Number(t?.durationDays);
  if (!Number.isFinite(days) || days <= 0) return { score: 0, reason: 'Enter the duration to score this entry' };
  if (days > 5) return { score: 10, reason: 'More than 5 days' };
  if (days >= 5) return { score: 5, reason: '5 days' };
  return { score: 0, reason: 'Under 5 days — not scored' };
}

/** 5.1 per-row working. Mirror of the backend's membershipRowScore. */
export function membershipRowScore(m: { status?: string | null } | null | undefined) {
  if (m?.status === 'national_member') return { score: 5, reason: 'National member' };
  if (m?.status === 'international_member') return { score: 10, reason: 'International member' };
  if (m?.status === 'national_executive') return { score: 10, reason: 'National executive' };
  if (m?.status === 'life_member') return { score: 10, reason: 'Life member' };
  return { score: 0, reason: 'Choose a status' };
}

/** 5.2 per-row working. Mirror of the backend's awardRowScore. */
export function awardRowScore(a: { level?: string | null } | null | undefined) {
  if (a?.level === 'international') return { score: 10, reason: 'International' };
  if (a?.level === 'national') return { score: 10, reason: 'National' };
  if (a?.level === 'state') return { score: 5, reason: 'State' };
  return { score: 0, reason: 'Choose a level' };
}

/** 5.3 per-row working. Mirror of the backend's differentiatorRowScore. */
export function differentiatorRowScore(d: { role?: string | null } | null | undefined) {
  if (d?.role === 'participating') return { score: 3, reason: 'Participating' };
  if (d?.role === 'leading') return { score: 7, reason: 'Leading' };
  if (d?.role === 'initiating') return { score: 10, reason: 'Initiating, shaping & executing' };
  return { score: 0, reason: 'Choose a role' };
}

function scoreCategory1(v: ScoreFormValues) {
  // 1.1 Lectures (max 40) — per-course rules in lectureRowScore.
  let lectures = 0;
  for (const c of arr<Cat1CourseInput>(v.cat1Courses)) lectures += lectureRowScore(c).total;
  lectures = Math.min(lectures, 40);

  // 1.2 Attendance / Feedback / Results (per course max 20, section max 80).
  // PDF: A = (avg attendance % / 100) * 5, B = feedback out of 5,
  //      C = (pass % / 100) * 10.
  let attendanceFeedback = 0;
  for (const c of arr<Cat1CourseResultInput>(v.cat1CourseResults)) {
    attendanceFeedback += courseResultScore(c).total;
  }
  attendanceFeedback = Math.min(attendanceFeedback, 80);

  // 1.3 Projects (max 20) — per-row rules in projectRowScore.
  let projects = 0;
  for (const p of arr<Cat1ProjectInput>(v.cat1Projects)) projects += projectRowScore(p).score;
  projects = Math.min(projects, 20);

  // 1.4 e-Content (max 5)
  let eContent = 0;
  for (const e of arr<Cat1EContentInput>(v.cat1EContent)) eContent += eContentRowScore(e).score;
  eContent = Math.min(eContent, 5);

  // 1.5 ICT (max 5)
  let ict = 0;
  for (const i of arr<Cat1ICTInput>(v.cat1ICT)) ict += ictRowScore(i).score;
  ict = Math.min(ict, 5);

  const total = Math.min(lectures + attendanceFeedback + projects + eContent + ict, 150);
  return { lectures, attendanceFeedback, projects, eContent, ict, total };
}

function scoreCategory2(v: ScoreFormValues) {
  // 2.1 Publications (max 60) — see backend scoringEngine.ts for the PDF rule.
  let publications = 0;
  for (const j of arr<Cat2JournalInput>(v.cat2Journals)) publications += publicationRowScore('journal', j?.indexed);
  for (const c of arr<Cat2ConferenceInput>(v.cat2Conferences)) publications += publicationRowScore('conference', c?.indexed);
  for (const x of arr<Cat2ConfBookChapterInput>(v.cat2ConfBookChapters)) publications += publicationRowScore('chapter', x?.indexed);
  publications = Math.min(publications, 60);

  // 2.2 Citations (max 5) — bands in citationScore.
  const citations = citationScore(v.cat2Citations?.totalCitations);

  // 2.3 Books & Chapters (max 10) — per-row rules in bookRowScore.
  let books = 0;
  for (const b of arr<Cat2BookInput>(v.cat2Books)) books += bookRowScore(b as any).score;
  for (const bc of arr<Cat2BookChapterInput>(v.cat2BookChapters)) books += bookRowScore(bc as any).score;
  books = Math.min(books, 10);

  // 2.4 Patents / IPR (max 20) — per-row rules in patentRowScore.
  let patents = 0;
  for (const p of arr<Cat2PatentInput>(v.cat2Patents)) patents += patentRowScore(p as any).score;
  patents = Math.min(patents, 20);

  // 2.5 Sponsored Projects (max 20) — per project, summed; rules in sponsoredProjectRowScore.
  let sponsoredProjects = 0;
  for (const p of arr<Cat2ProjectInput>(v.cat2Projects)) sponsoredProjects += sponsoredProjectRowScore(p as any).score;
  sponsoredProjects = Math.min(sponsoredProjects, 20);

  // 2.6 Consultancy (max 10) — per-row bands in consultancyRowScore.
  let consultancy = 0;
  for (const c of arr<Cat2ConsultancyInput>(v.cat2Consultancy)) consultancy += consultancyRowScore(c).score;
  consultancy = Math.min(consultancy, 10);

  // 2.7 Research Guidance (max 5) — Guide 5, Co-Guide 3 per candidate.
  let guidance = 0;
  for (const g of arr<Cat2GuidanceInput>(v.cat2Guidance)) guidance += guidanceRowScore(g).score;
  guidance = Math.min(guidance, 5);

  // 2.8 Research Groups (max 5) — 5 for a group with a tangible outcome.
  let researchGroups = 0;
  for (const r of arr<any>(v.cat2ResearchGroups)) researchGroups += outcomeRowScore(r?.groupName, r?.outcome).score;
  researchGroups = Math.min(researchGroups, 5);

  // 2.9 Institutes AND industry linkage — ONE subsection in the PDF, 5 per
  // linkage with an outcome, max 10 across both tables.
  let linkages = 0;
  for (const l of arr<any>(v.cat2Linkages)) linkages += outcomeRowScore(l?.instituteName, l?.outcome).score;
  for (const l of arr<any>(v.cat2IndustryLinkages)) linkages += outcomeRowScore(l?.industryName, l?.outcome).score;
  linkages = Math.min(linkages, 10);

  // 2.10 Innovation / start-ups (max 5), 5 per activity with an outcome.
  let startups = 0;
  for (const x of arr<any>(v.cat2Startups)) startups += outcomeRowScore(x?.groupName, x?.outcome).score;
  startups = Math.min(startups, 5);

  const total = Math.min(
    publications + citations + books + patents + sponsoredProjects +
    consultancy + guidance + researchGroups + linkages + startups,
    150
  );
  return { publications, citations, books, patents, sponsoredProjects, consultancy, guidance, researchGroups, linkages, startups, total };
}

function scoreCategory3(v: ScoreFormValues) {
  // 3.1 Status of Ph.D. / advanced qualification (max 10) — see advQualScore.
  const advQual = advQualScore(v.cat3AdvQual).score;

  // 3.2 Organised Programs (max 20, 10 each)
  const organisedPrograms = Math.min(arr(v.cat3Organised).length * PER_ENTRY.organisedPrograms, 20);

  // Conferences / Seminars / Workshops Attended — local, un-numbered (max 20, 10 each)
  const conferencesAttended = Math.min(arr(v.cat3ConferencesAttended).length * PER_ENTRY.conferencesAttended, 20);

  // 3.3 Resource Person (max 20, 10 each)
  const resourcePerson = Math.min(arr(v.cat3ResourcePerson).length * PER_ENTRY.resourcePerson, 20);

  // 3.4 Editorial (max 20, 10 each)
  const editorial = Math.min(arr(v.cat3Editorial).length * PER_ENTRY.editorial, 20);

  // 3.5 Training (max 25) — per-row rules in trainingRowScore.
  let training = 0;
  for (const t of arr<Cat3TrainingInput>(v.cat3Training)) training += trainingRowScore(t).score;
  training = Math.min(training, 25);

  // 3.6 International Travel (max 5, 5 each)
  const intlTravel = Math.min(arr(v.cat3IntlTravel).length * PER_ENTRY.intlTravel, 5);

  const total = Math.min(
    advQual + organisedPrograms + conferencesAttended + resourcePerson + editorial + training + intlTravel,
    100
  );
  return { advQual, organisedPrograms, conferencesAttended, resourcePerson, editorial, training, intlTravel, total };
}

function scoreCategory4(v: ScoreFormValues) {
  // 4.1 (max 40, 10 each); 4.2 (max 10, 5 each).
  const adminResp = Math.min(arr(v.cat4AdminResp).length * PER_ENTRY.adminResp, 40);
  const studentActivities = Math.min(arr(v.cat4StudentAct).length * PER_ENTRY.studentActivities, 10);
  const total = Math.min(adminResp + studentActivities, 50);
  return { adminResp, studentActivities, total };
}

function scoreCategory5(v: ScoreFormValues) {
  // 5.1 Memberships (max 15) — per-row rules in membershipRowScore.
  let memberships = 0;
  for (const m of arr<Cat5MembershipInput>(v.cat5Memberships)) memberships += membershipRowScore(m).score;
  memberships = Math.min(memberships, 15);

  // 5.2 Awards (max 10) — per-row rules in awardRowScore.
  let awards = 0;
  for (const a of arr<Cat5AwardInput>(v.cat5Awards)) awards += awardRowScore(a).score;
  awards = Math.min(awards, 10);

  // 5.3 Differentiators (max 20) — per-row rules in differentiatorRowScore.
  let differentiators = 0;
  for (const d of arr<Cat5DifferentiatorInput>(v.cat5Differentiators)) differentiators += differentiatorRowScore(d).score;
  differentiators = Math.min(differentiators, 20);

  // 5.4 Internships (max 5, 5 each)
  const internships = Math.min(arr(v.cat5Internships).length * PER_ENTRY.internships, 5);

  const total = Math.min(memberships + awards + differentiators + internships, 50);
  return { memberships, awards, differentiators, internships, total };
}

// Pure: computes the ScoreBreakdown from in-memory form values. Tolerates
// undefined/null/partial input — always returns a well-formed breakdown.
/**
 * 1.2 per-course A/B/C split, exported so screens that show the working (the
 * HoD review page) render the SAME numbers the engines score with instead of
 * re-implementing the formulas. Kept inside this module on purpose — it is
 * covered by the parity fixture through computeScore.
 */
/**
 * 1.1 per-course working (engagement %, engagement score, novelty, row total).
 * Mirror of the backend's lectureRowScore — same rules, see the comment there:
 * % rounded to a whole number before banding; no periods planned or conducted
 * scores 0 for the whole row; a named method counts as novel pedagogy used.
 */
export function lectureRowScore(c: Cat1CourseInput | null | undefined) {
  const planned = n(c?.periodPlanned);
  const conducted = n(c?.periodsConducted);
  if (!(planned > 0) || !(conducted > 0)) return { pct: null as number | null, engagement: 0, novelty: 0, total: 0 };
  const pct = Math.round((conducted / planned) * 100);
  const engagement = pct >= 96 ? 10 : pct >= 90 ? 8 : pct >= 80 ? 6 : 4;
  const used = !!c?.novelPedagogyUsed || !!(c?.novelPedagogyMethod ?? '').trim();
  const novelty = used ? 5 : 0;
  return { pct, engagement, novelty, total: engagement + novelty };
}

/**
 * 1.3 per-row working (rate, whole count, unit, score). Mirror of the
 * backend's projectRowScore: negative/blank counts score 0, fractions are
 * dropped (the database stores an Int).
 */
const PROJECT_RATE: Record<string, number> = { 'BTECH:MINI': 2, 'BTECH:MAJOR': 5, 'MTECH:MINI': 3, 'MTECH:MAJOR': 5 };
export function projectRowScore(p: Cat1ProjectInput | null | undefined) {
  const rate = PROJECT_RATE[`${p?.course}:${p?.projectType}`] ?? 0;
  const raw = n(p?.count);
  const count = raw > 0 ? Math.floor(raw) : 0;
  return { rate, count, unit: p?.course === 'MTECH' ? 'student' : 'batch', score: rate * count };
}

/** Mirror of the backend's isEvidenceLink: an http(s) link with a real host, or a portal upload. */
export function isEvidenceLink(v: unknown): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s) || /^\/uploads\/\S+$/.test(s);
}

/** 1.4 per-row working. Mirror of the backend's eContentRowScore: 2 only with an evidence link. */
export function eContentRowScore(e: Cat1EContentInput | null | undefined) {
  const evidence = isEvidenceLink(e?.evidenceFile);
  return { evidence, score: evidence ? 2 : 0 };
}

/** 1.5 per-row working. Mirror of the backend's ictRowScore: 2 only with an evidence link. */
export function ictRowScore(i: Cat1ICTInput | null | undefined) {
  const evidence = isEvidenceLink(i?.evidenceFile);
  return { evidence, score: evidence ? 2 : 0 };
}

export function courseResultScore(c: Cat1CourseResultInput | null | undefined) {
  const A = Math.min(Math.max(n(c?.avgAttendancePct), 0) / 100 * 5, 5);
  const B = Math.min(Math.max(n(c?.feedbackReceived), 0), 5);
  const C = Math.min(Math.max(n(c?.passPercentage), 0) / 100 * 10, 10);
  return { A, B, C, total: Math.min(A + B + C, 20) };
}

// Mirror of the backend's applyVoidedSources. A source whose proof was rejected
// and never corrected scores nothing; the rows stay on the form. Both engines
// read the same `voidedSources` field off the submission, which is what keeps
// them in parity — the frontend has no access to proof-verification data.
export function applyVoidedSources<T extends Record<string, any>>(values: T): T {
  const voided: string[] = (values as any)?.voidedSources ?? [];
  if (!voided.length) return values;

  const out: Record<string, any> = { ...values };
  for (const key of voided) {
    if (!(key in out)) continue;
    out[key] = Array.isArray(out[key]) ? [] : null;
  }
  return out as T;
}

export function computeScore(values: ScoreFormValues | null | undefined): ScoreBreakdown {
  values = applyVoidedSources((values ?? {}) as any);
  const v = values ?? {};
  const cat1 = scoreCategory1(v);
  const cat2 = scoreCategory2(v);
  const cat3 = scoreCategory3(v);
  const cat4 = scoreCategory4(v);
  const cat5 = scoreCategory5(v);
  const selfTotal = cat1.total + cat2.total + cat3.total + cat4.total + cat5.total;

  return { cat1, cat2, cat3, cat4, cat5, selfTotal };
}
