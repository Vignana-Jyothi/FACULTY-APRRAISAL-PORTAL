import { describe, it, expect } from 'vitest';
import { publicationRowScore, INDEX_LABEL, countAuthors, computeScore } from './scoringEngine';

// 2.1 per-row rules (owner decisions 2026-09-11): journals 15 only for SCI/SCIE/
// WoS or Scopus — ESCI and ICI journals 0; conference papers and conference book
// chapters 10 for any index. The frontend port has the same table in
// frontend/src/utils/publicationRowScore.test.ts.
const CASES: Array<[kind: 'journal' | 'conference' | 'chapter', indexed: any, score: number]> = [
  ['journal', 'WOS', 15], ['journal', 'SCOPUS', 15],
  ['journal', 'ESCI', 0], ['journal', 'ICI', 0], ['journal', 'NONE', 0], ['journal', undefined, 0],
  ['conference', 'WOS', 10], ['conference', 'SCOPUS', 10], ['conference', 'ESCI', 10], ['conference', 'ICI', 10], ['conference', 'NONE', 0],
  ['chapter', 'SCOPUS', 10], ['chapter', 'ESCI', 10], ['chapter', 'NONE', 0], ['chapter', null, 0],
];

const base: any = {
  cat1Courses: [], cat1CourseResults: [], cat1Projects: [], cat1EContent: [], cat1ICT: [], cat2Journals: [], cat2Conferences: [],
  cat2ConfBookChapters: [], cat2BookChapters: [], cat2Books: [], cat2Citations: null, cat2Patents: [], cat2Projects: [],
  cat2Consultancy: [], cat2Guidance: [], cat2ResearchGroups: [], cat2Linkages: [], cat2Startups: [], cat2IndustryLinkages: [],
  cat3AdvQual: null, cat3Organised: [], cat3ConferencesAttended: [], cat3ResourcePerson: [], cat3Editorial: [], cat3Training: [],
  cat3IntlTravel: [], cat4AdminResp: [], cat4StudentAct: [], cat5Memberships: [], cat5Awards: [], cat5Differentiators: [],
  cat5Internships: [], voidedSources: [],
};

describe('2.1 publicationRowScore', () => {
  for (const [kind, indexed, score] of CASES) {
    it(`${kind} indexed ${indexed} -> ${score}`, () => expect(publicationRowScore(kind, indexed)).toBe(score));
  }

  it('A + B + C share one cap of 60', () => {
    // Co-authors from other institutions, so only the index rule decides
    // (the 2.1 claim rule has its own suite, publicationClaim.test.ts).
    const OUTSIDE = { allAuthorsFromCampus: false };
    const s = computeScore({
      ...base,
      cat2Journals: [{ indexed: 'WOS', ...OUTSIDE }, { indexed: 'SCOPUS', ...OUTSIDE }, { indexed: 'ESCI', ...OUTSIDE }],
      cat2Conferences: [{ indexed: 'SCOPUS', ...OUTSIDE }],
      cat2ConfBookChapters: [{ indexed: 'ICI', ...OUTSIDE }],
    });
    expect(s.cat2.publications).toBe(50); // 15 + 15 + 0 + 10 + 10
    expect(computeScore({ ...base, cat2Journals: Array.from({ length: 5 }, () => ({ indexed: 'WOS', ...OUTSIDE })) }).cat2.publications).toBe(60);
  });

  it('labels SCI / SCIE journals under the stored WOS value', () => {
    expect(INDEX_LABEL.WOS).toBe('SCI / SCIE / WoS');
    expect(INDEX_LABEL.NONE).toBe('Not indexed');
  });

  it('counts the names in an author list', () => {
    expect(countAuthors('A. Rao, B. Devi and C. Kumar')).toBe(3);
    expect(countAuthors('Rao; Devi & Kumar')).toBe(3);
    expect(countAuthors('')).toBe(0);
    expect(countAuthors(null)).toBe(0);
  });
});
