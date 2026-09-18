import { describe, it, expect } from 'vitest';
import { publicationClaim, publicationScore, authorCount, computeScore } from './scoringEngine';

// 2.1 authorship claim — owner decisions 2026-09-15. An all-VNRVJIET paper
// scores only for the author who claims it; a paper with co-authors from other
// institutions is the faculty's to claim; an unanswered campus question
// scores 0. Mirrored in frontend/src/utils/publicationClaim.test.ts.

const base: any = {
  cat1Courses: [], cat1CourseResults: [], cat1Projects: [], cat1EContent: [], cat1ICT: [],
  cat2Journals: [], cat2Conferences: [], cat2ConfBookChapters: [], cat2BookChapters: [],
  cat2Books: [], cat2Citations: null, cat2Patents: [], cat2Projects: [], cat2Consultancy: [],
  cat2Guidance: [], cat2ResearchGroups: [], cat2Linkages: [], cat2Startups: [],
  cat2IndustryLinkages: [], cat3AdvQual: null, cat3Organised: [], cat3ConferencesAttended: [],
  cat3ResourcePerson: [], cat3Editorial: [], cat3Training: [], cat3IntlTravel: [],
  cat4AdminResp: [], cat4StudentAct: [], cat5Memberships: [], cat5Awards: [],
  cat5Differentiators: [], cat5Internships: [],
};

describe('2.1 authorship claim', () => {
  it('scores nothing while the campus question is unanswered', () => {
    expect(publicationScore('journal', { indexed: 'WOS' }).score).toBe(0);
    expect(publicationClaim({ allAuthorsFromCampus: null }).reason).toMatch(/Answer "are all authors from VNRVJIET\?"/);
  });

  it('scores normally when some co-authors are from other institutions', () => {
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: false }).score).toBe(15);
    expect(publicationScore('conference', { indexed: 'SCOPUS', allAuthorsFromCampus: false }).score).toBe(10);
    expect(publicationScore('chapter', { indexed: 'ICI', allAuthorsFromCampus: false }).score).toBe(10);
  });

  it('scores an all-VNRVJIET paper only for the author who claims it', () => {
    const mine = { indexed: 'SCOPUS', allAuthorsFromCampus: true, claimedBySelf: true };
    expect(publicationScore('journal', mine).score).toBe(15);
    expect(publicationScore('journal', { ...mine, claimedBySelf: false })).toEqual({ score: 0, reason: 'Claimed by another co-author' });
  });

  it('needs the claim answered before an all-VNRVJIET paper scores', () => {
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: true }).reason).toBe('Choose who claims this paper');
    expect(publicationScore('journal', { indexed: 'WOS', allAuthorsFromCampus: true, claimedBySelf: null }).score).toBe(0);
  });

  it('still applies the index rule once the claim holds', () => {
    expect(publicationScore('journal', { indexed: 'ESCI', allAuthorsFromCampus: false }).score).toBe(0);
    expect(publicationScore('journal', { indexed: 'NONE', allAuthorsFromCampus: true, claimedBySelf: true }).score).toBe(0);
  });

  it('carries into the category total', () => {
    const s = computeScore({
      ...base,
      cat2Journals: [
        { indexed: 'WOS', allAuthorsFromCampus: false },
        { indexed: 'WOS' }, // unanswered
        { indexed: 'WOS', allAuthorsFromCampus: true, claimedBySelf: true },
      ],
    });
    expect(s.cat2.publications).toBe(30);
  });

  it('counts authors from the list, falling back to the legacy text', () => {
    expect(authorCount({ authorList: ['A', '  ', 'B'], authors: 'ignored' })).toBe(2);
    expect(authorCount({ authorList: [], authors: 'A, B and C' })).toBe(3);
    expect(authorCount(null)).toBe(0);
  });
});
