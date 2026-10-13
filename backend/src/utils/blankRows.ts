/**
 * Blank auto-row detection, shared by the save path and the backfill script.
 *
 * The appraisal form auto-adds a blank row per section, pre-filled with dropdown
 * defaults (e.g. nature="Video") and placeholders. Those must not persist — they
 * would inflate the scoring engine. A row is kept only if at least one of its
 * free-text identifier fields has real content (an alphanumeric char);
 * dropdown/enum/number fields are never the identifier.
 *
 * `updateAppraisal` applies this on every save. `scripts/clean-blank-rows.ts`
 * applies the same rule to drafts written before the filter existed, so both
 * must read the same table — hence this module.
 */

// Payload key -> the free-text fields that identify a real row.
export const ROW_CONTENT_FIELDS: Record<string, string[]> = {
  cat1Courses: ['courseName'],
  cat1EContent: ['contentName', 'courseName'],
  cat1ICT: ['courseName'],
  cat2Journals: ['title', 'journalName'],
  cat2Conferences: ['title', 'conferenceName'],
  cat2ConfBookChapters: ['title', 'conferenceName'],
  cat2Books: ['title'],
  cat2BookChapters: ['title'],
  cat2Patents: ['title'],
  cat2Projects: ['title', 'fundingAgency'],
  cat2Consultancy: ['name', 'agency'],
  cat2Guidance: ['studentName', 'thesisTitle'],
  cat2ResearchGroups: ['groupName'],
  cat2Linkages: ['instituteName'],
  cat2Startups: ['groupName'],
  cat2IndustryLinkages: ['industryName'],
  cat3Organised: ['title'],
  cat3ConferencesAttended: ['paperTitle', 'conferenceName'],
  cat3ResourcePerson: ['programName', 'topic'],
  cat3Editorial: ['orgOrJournal'],
  cat3Training: ['name'],
  cat3IntlTravel: ['purpose', 'placeOrUniv'],
  cat4AdminResp: ['responsibility'],
  cat4StudentAct: ['activityName'],
  cat5Memberships: ['association'],
  cat5Awards: ['awardType', 'organization'],
  cat5Differentiators: ['name'],
  cat5Internships: ['industryOrInst'],
};

// Payload key -> the Prisma delegate that stores it. Same key set as
// ROW_CONTENT_FIELDS; the script needs the model name, the controller does not.
export const ROW_MODELS: Record<string, string> = {
  cat1Courses: 'cat1Course',
  cat1EContent: 'cat1EContent',
  cat1ICT: 'cat1ICT',
  cat2Journals: 'cat2Journal',
  cat2Conferences: 'cat2Conference',
  cat2ConfBookChapters: 'cat2ConfBookChapter',
  cat2Books: 'cat2Book',
  cat2BookChapters: 'cat2BookChapter',
  cat2Patents: 'cat2Patent',
  cat2Projects: 'cat2Project',
  cat2Consultancy: 'cat2Consultancy',
  cat2Guidance: 'cat2Guidance',
  cat2ResearchGroups: 'cat2ResearchGroup',
  cat2Linkages: 'cat2Linkage',
  cat2Startups: 'cat2Startup',
  cat2IndustryLinkages: 'cat2IndustryLinkage',
  cat3Organised: 'cat3OrganisedProgram',
  cat3ConferencesAttended: 'cat3ConferenceAttended',
  cat3ResourcePerson: 'cat3ResourcePerson',
  cat3Editorial: 'cat3Editorial',
  cat3Training: 'cat3Training',
  cat3IntlTravel: 'cat3IntlTravel',
  cat4AdminResp: 'cat4AdminResp',
  cat4StudentAct: 'cat4StudentActivity',
  cat5Memberships: 'cat5Membership',
  cat5Awards: 'cat5Award',
  cat5Differentiators: 'cat5Differentiator',
  cat5Internships: 'cat5Internship',
};

export const rowHasContent = (row: any, fields: string[]): boolean =>
  fields.some((f) => typeof row?.[f] === 'string' && /[a-z0-9]/i.test(row[f]));

// A row that carries an uploaded proof / evidence file is a real row even
// before its identifier text is typed, so it must not be stripped — otherwise
// the faculty's upload would silently disappear (2026-10-13). The scoring
// engine still ignores it (it keys on the identifier fields, not the proof),
// so keeping it never inflates a score.
const PROOF_FIELDS = ['proofFile', 'evidenceFile', 'indexProofFile'];
export const rowHasProof = (row: any): boolean =>
  PROOF_FIELDS.some((f) => typeof row?.[f] === 'string' && row[f].trim().length > 0);

// Strip blank auto-rows from an incoming categories payload (in place).
export function dropBlankRows(categories: any) {
  if (!categories) return;
  for (const [key, fields] of Object.entries(ROW_CONTENT_FIELDS)) {
    if (Array.isArray(categories[key])) {
      categories[key] = categories[key].filter((r: any) => rowHasContent(r, fields) || rowHasProof(r));
    }
  }
  // Projects (1.3) have no free-text field — keep only rows with a positive
  // count, as the form's stripBlankRows does. A negative count reaching the
  // database used to subtract from the rest of the section.
  if (Array.isArray(categories.cat1Projects)) {
    categories.cat1Projects = categories.cat1Projects.filter((p: any) => Number(p?.count) > 0);
  }
}
