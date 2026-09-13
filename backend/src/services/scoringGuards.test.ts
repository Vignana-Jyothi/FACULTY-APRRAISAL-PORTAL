import { describe, it, expect } from 'vitest';
import { computeScore } from './scoringEngine';

// Regression guards for the "unfilled rows earn marks" class of bug found in
// the 2026-08-28 table-by-table review against the official FPAS PDF. Every
// case below paid out before the fix.

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
const score = (patch: Partial<typeof base>) => computeScore({ ...base, ...patch } as any);

describe('1.1 lectures — engagement needs a planned figure', () => {
  it('scores nothing when periods planned is missing (was 10 via Infinity)', () => {
    expect(score({ cat1Courses: [{ periodPlanned: 0, periodsConducted: 45, novelPedagogyUsed: false }] }).cat1.lectures).toBe(0);
  });

  it('scores nothing for a wholly blank row (was 4 via NaN)', () => {
    expect(score({ cat1Courses: [{ periodPlanned: 0, periodsConducted: 0, novelPedagogyUsed: false }] }).cat1.lectures).toBe(0);
  });

  it('cannot be farmed to the section cap with blank-planned rows', () => {
    const rows = Array.from({ length: 6 }, () => ({ periodPlanned: 0, periodsConducted: 50, novelPedagogyUsed: true }));
    expect(score({ cat1Courses: rows }).cat1.lectures).toBe(0);
  });

  it('still scores the PDF bands for real rows', () => {
    expect(score({ cat1Courses: [{ periodPlanned: 50, periodsConducted: 48, novelPedagogyUsed: false }] }).cat1.lectures).toBe(10);
    expect(score({ cat1Courses: [{ periodPlanned: 50, periodsConducted: 46, novelPedagogyUsed: false }] }).cat1.lectures).toBe(8);
    expect(score({ cat1Courses: [{ periodPlanned: 50, periodsConducted: 41, novelPedagogyUsed: false }] }).cat1.lectures).toBe(6);
    expect(score({ cat1Courses: [{ periodPlanned: 50, periodsConducted: 30, novelPedagogyUsed: false }] }).cat1.lectures).toBe(4);
    // Novel pedagogy adds 5 on top.
    expect(score({ cat1Courses: [{ periodPlanned: 50, periodsConducted: 48, novelPedagogyUsed: true }] }).cat1.lectures).toBe(15);
  });
});

describe('3.5 training — the PDF grants 5 only from a minimum of 5 days', () => {
  it('scores nothing below five days (was 5 for any duration)', () => {
    expect(score({ cat3Training: [{ durationDays: 3 }] }).cat3.training).toBe(0);
    expect(score({ cat3Training: [{ durationDays: 0 }] }).cat3.training).toBe(0);
  });

  it('scores 5 at exactly five days and 10 above', () => {
    expect(score({ cat3Training: [{ durationDays: 5 }] }).cat3.training).toBe(5);
    expect(score({ cat3Training: [{ durationDays: 6 }] }).cat3.training).toBe(10);
  });
});

describe('2.6 consultancy — a row with no amount is not a project', () => {
  it('scores nothing for a zero amount (was 2)', () => {
    expect(score({ cat2Consultancy: [{ name: 'Advisory', amountLakhs: 0 }] }).cat2.consultancy).toBe(0);
  });

  it('scores nothing without a project name — an agency-only row kept by the blank-row filter used to score', () => {
    expect(score({ cat2Consultancy: [{ agency: 'ABC Corp', amountLakhs: 6 }] }).cat2.consultancy).toBe(0);
  });

  it('keeps each band\'s upper edge (owner decision 2026-09-13)', () => {
    const at = (amountLakhs: number) => score({ cat2Consultancy: [{ name: 'Advisory', amountLakhs }] }).cat2.consultancy;
    expect(at(0.5)).toBe(2);
    expect(at(1)).toBe(2); // was 4
    expect(at(1.5)).toBe(4);
    expect(at(2)).toBe(4); // was 6
    expect(at(5)).toBe(6); // was 8
    expect(at(7)).toBe(8);
    expect(at(10)).toBe(8);
    expect(at(10.5)).toBe(10);
  });
});

describe('2.8 / 2.9 / 2.10 — an entry scores only with a tangible outcome', () => {
  it('scores nothing for a blank outcome (was 5 each)', () => {
    const s = score({
      cat2ResearchGroups: [{ groupName: 'AI Group', outcome: '' }],
      cat2Linkages: [{ instituteName: 'IIT H', outcome: '   ' }],
      cat2IndustryLinkages: [{ industryName: 'TCS', outcome: null }],
      cat2Startups: [{ groupName: 'E-Cell' }],
    }).cat2;
    expect([s.researchGroups, s.linkages, s.startups]).toEqual([0, 0, 0]);
  });

  it('scores 5 per entry with an outcome, within each cap', () => {
    const s = score({
      cat2ResearchGroups: [{ groupName: 'AI Group', outcome: '2 papers' }, { groupName: 'IoT Group', outcome: 'Lab' }],
      cat2Linkages: [{ instituteName: 'IIT H', outcome: 'Joint paper' }],
      cat2IndustryLinkages: [{ industryName: 'TCS', outcome: '' }, { industryName: 'Infosys', outcome: 'Shared lab' }],
      cat2Startups: [{ groupName: 'E-Cell', outcome: '1 startup' }],
    }).cat2;
    expect(s.researchGroups).toBe(5); // 2 x 5, capped at 5
    expect(s.linkages).toBe(10); // two with an outcome; the blank one scores 0
    expect(s.startups).toBe(5);
  });
});

describe('5.2 awards — only the levels the PDF defines', () => {
  it('scores nothing for an unset or unknown level (was 10)', () => {
    expect(score({ cat5Awards: [{ level: '' }] }).cat5.awards).toBe(0);
    expect(score({ cat5Awards: [{ level: 'departmental' }] }).cat5.awards).toBe(0);
  });

  it('still scores state 5 and national/international 10', () => {
    expect(score({ cat5Awards: [{ level: 'state' }] }).cat5.awards).toBe(5);
    expect(score({ cat5Awards: [{ level: 'national' }] }).cat5.awards).toBe(10);
    expect(score({ cat5Awards: [{ level: 'international' }] }).cat5.awards).toBe(10);
  });
});

describe('2.3 books — an untitled row is a placeholder', () => {
  it('scores nothing without a title (was 5)', () => {
    expect(score({ cat2Books: [{ title: '', scope: 'INTERNATIONAL', isEdited: false }] }).cat2.books).toBe(0);
    expect(score({ cat2Books: [{ title: '   ', scope: 'INTERNATIONAL', isEdited: false }] }).cat2.books).toBe(0);
  });

  it('still scores the scope/role matrix for real entries', () => {
    expect(score({ cat2Books: [{ title: 'A', scope: 'INTERNATIONAL', isEdited: false }] }).cat2.books).toBe(10);
    expect(score({ cat2Books: [{ title: 'A', scope: 'NATIONAL', isEdited: true }] }).cat2.books).toBe(3);
  });
});

describe('2.2 citations — the bands the PDF actually specifies', () => {
  it('matches 3-10 -> 1, 11-50 -> 2, 51-100 -> 3, >100 -> 5', () => {
    const c = (totalCitations: number) => score({ cat2Citations: { totalCitations } }).cat2.citations;
    expect(c(2)).toBe(0);
    expect(c(3)).toBe(1);
    expect(c(10)).toBe(1);
    expect(c(11)).toBe(2);
    expect(c(50)).toBe(2);
    expect(c(51)).toBe(3);
    expect(c(100)).toBe(3);
    expect(c(101)).toBe(5);
  });
});

describe('an entirely empty appraisal scores zero', () => {
  it('has no floor anywhere', () => {
    const empty = score({});
    expect(empty.selfTotal).toBe(0);
    for (const cat of [empty.cat1, empty.cat2, empty.cat3, empty.cat4, empty.cat5]) {
      expect(cat.total).toBe(0);
    }
  });
});
