import { describe, it, expect } from 'vitest';
import { computeScore } from './scoringEngine';

// Build empty submission — all arrays empty, nullable relations null.
// Tests override specific category arrays.
function emptySubmission(overrides: Record<string, any> = {}): any {
  return {
    cat1Courses: [],
    cat1CourseResults: [],
    cat1Projects: [],
    cat1EContent: [],
    cat1ICT: [],
    cat2Journals: [],
    cat2Conferences: [],
    cat2ConfBookChapters: [],
    cat2BookChapters: [],
    cat2Books: [],
    cat2Citations: null,
    cat2Patents: [],
    cat2Projects: [],
    cat2Consultancy: [],
    cat2Guidance: [],
    cat2ResearchGroups: [],
    cat2Linkages: [],
    cat2Startups: [],
    cat2IndustryLinkages: [],
    cat3AdvQual: null,
    cat3Organised: [],
    cat3ConferencesAttended: [],
    cat3ResourcePerson: [],
    cat3Editorial: [],
    cat3Training: [],
    cat3IntlTravel: [],
    cat4AdminResp: [],
    cat4StudentAct: [],
    cat5Memberships: [],
    cat5Awards: [],
    cat5Differentiators: [],
    cat5Internships: [],
    ...overrides,
  };
}

describe('computeScore — empty submission', () => {
  it('returns all zeros', () => {
    const s = computeScore(emptySubmission());
    expect(s.cat1.total).toBe(0);
    expect(s.cat2.total).toBe(0);
    expect(s.cat3.total).toBe(0);
    expect(s.cat4.total).toBe(0);
    expect(s.cat5.total).toBe(0);
    expect(s.selfTotal).toBe(0);
  });
});

describe('Category 1 — Teaching', () => {
  it('lectures: >=96% periods conducted → 10 base, +5 novelty', () => {
    const s = computeScore(emptySubmission({
      cat1Courses: [{
        periodsConducted: 96, periodPlanned: 100, novelPedagogyUsed: true,
      }],
    }));
    expect(s.cat1.lectures).toBe(15); // 10 + 5
  });

  it('lectures: tiered base — 90% → 8, 80% → 6, below → 4', () => {
    const mk = (pct: number) => computeScore(emptySubmission({
      cat1Courses: [{ periodsConducted: pct, periodPlanned: 100, novelPedagogyUsed: false }],
    })).cat1.lectures;
    expect(mk(90)).toBe(8);
    expect(mk(80)).toBe(6);
    expect(mk(50)).toBe(4);
  });

  it('lectures capped at 40', () => {
    const courses = Array.from({ length: 10 }, () => ({
      periodsConducted: 100, periodPlanned: 100, novelPedagogyUsed: true,
    }));
    expect(computeScore(emptySubmission({ cat1Courses: courses })).cat1.lectures).toBe(40);
  });

  it('1.2 uses the PDF formulas: A=(a/100)*5, B as given, C=(P/100)*10, capped 20/course', () => {
    const s = computeScore(emptySubmission({
      cat1CourseResults: [
        { courseName: 'DS', classSize: 50, avgAttendancePct: 80, feedbackReceived: 4, passPercentage: 90 },
      ],
    }));
    // A = 4, B = 4, C = 9
    expect(s.cat1.attendanceFeedback).toBe(17);
  });

  it('1.2 clamps a course to 20 and the section to 80', () => {
    const row = { courseName: 'X', classSize: 10, avgAttendancePct: 100, feedbackReceived: 5, passPercentage: 100 };
    const one = computeScore(emptySubmission({ cat1CourseResults: [row] }));
    expect(one.cat1.attendanceFeedback).toBe(20); // 5 + 5 + 10
    const many = computeScore(emptySubmission({ cat1CourseResults: Array(5).fill(row) }));
    expect(many.cat1.attendanceFeedback).toBe(80); // 100 capped at 80
  });

  it('projects: BTECH MINI = 2/count, MTECH MAJOR = 5/count', () => {
    const s = computeScore(emptySubmission({
      cat1Projects: [
        { course: 'BTECH', projectType: 'MINI', count: 3 },  // 6
        { course: 'MTECH', projectType: 'MAJOR', count: 2 }, // 10
      ],
    }));
    expect(s.cat1.projects).toBe(16);
  });

  it('eContent and ICT: +2 per row WITH an evidence link, each capped 5', () => {
    const link = { evidenceFile: 'https://drive.google.com/file/d/x/view' };
    const s = computeScore(emptySubmission({
      cat1EContent: [link, link, link, {}],  // 6 → cap 5; the linkless row adds nothing
      cat1ICT: [link, link, link, {}],       // 6 → cap 5; the linkless row adds nothing
    }));
    expect(s.cat1.eContent).toBe(5);
    expect(s.cat1.ict).toBe(5);
  });
});

describe('Category 2 — Research', () => {
  it('2.1 journals: SCI/WoS/Scopus = 15; ESCI, ICI and non-indexed = 0 (strict PDF, 2026-09-11)', () => {
    const s = computeScore(emptySubmission({
      cat2Journals: [
        // Co-authors from other institutions: the claim is theirs to make, so
        // only the index rule decides (2.1 claim rule, 2026-09-15).
        { indexed: 'SCOPUS', allAuthorsFromCampus: false }, { indexed: 'WOS', allAuthorsFromCampus: false },
        { indexed: 'ESCI', allAuthorsFromCampus: false }, { indexed: 'ICI', allAuthorsFromCampus: false },
        { indexed: 'NONE', allAuthorsFromCampus: false },
      ],
    }));
    expect(s.cat2.publications).toBe(30); // 15+15+0+0+0 (ESCI/ICI were 10 each until 2026-09-11)
  });

  it('2.1 conferences and conference book chapters: indexed = 10, non-indexed = 0', () => {
    const s = computeScore(emptySubmission({
      cat2Conferences: [{ indexed: 'WOS', allAuthorsFromCampus: false }, { indexed: 'NONE', allAuthorsFromCampus: false }],
      cat2ConfBookChapters: [{ indexed: 'ESCI', allAuthorsFromCampus: false }, { indexed: 'NONE', allAuthorsFromCampus: false }],
    }));
    expect(s.cat2.publications).toBe(20); // 10+0+10+0
  });

  it('citations from totalCitations: >100→5, 51-100→3, 11-50→2, 3-10→1, else 0', () => {
    const mk = (totalCitations: number) => computeScore(emptySubmission({
      cat2Citations: { totalCitations },
    })).cat2.citations;
    expect(mk(101)).toBe(5);
    expect(mk(51)).toBe(3);
    expect(mk(100)).toBe(3);
    expect(mk(11)).toBe(2);
    expect(mk(50)).toBe(2);
    expect(mk(3)).toBe(1);
    expect(mk(10)).toBe(1);
    expect(mk(2)).toBe(0);
  });

  it('books/chapters: scope x role matrix — international author=10/editor=5, national author=5/editor=3', () => {
    expect(computeScore(emptySubmission({
      cat2Books: [{ title: 'A Book', scope: 'INTERNATIONAL', isEdited: false }],
    })).cat2.books).toBe(10);
    expect(computeScore(emptySubmission({
      cat2Books: [{ title: 'A Book', scope: 'INTERNATIONAL', isEdited: true }],
    })).cat2.books).toBe(5);
    expect(computeScore(emptySubmission({
      cat2Books: [{ title: 'A Book', scope: 'NATIONAL', isEdited: false }],
    })).cat2.books).toBe(5);
    expect(computeScore(emptySubmission({
      cat2Books: [{ title: 'A Book', scope: 'NATIONAL', isEdited: true }],
    })).cat2.books).toBe(3);
    // same matrix applies to book chapters
    expect(computeScore(emptySubmission({
      cat2BookChapters: [{ title: 'A Chapter', scope: 'NATIONAL', isEdited: false }],
    })).cat2.books).toBe(5);
  });

  it('books capped at 10', () => {
    const books = Array.from({ length: 3 }, () => ({ title: 'A Book', scope: 'INTERNATIONAL', isEdited: false })); // 30 → cap 10
    expect(computeScore(emptySubmission({ cat2Books: books })).cat2.books).toBe(10);
  });

  it('books: the 10-point cap POOLS across books + chapters (not per-table)', () => {
    const s = computeScore(emptySubmission({
      cat2Books: [{ title: 'A Book', scope: 'INTERNATIONAL', isEdited: false }],        // 10
      cat2BookChapters: [{ title: 'A Chapter', scope: 'INTERNATIONAL', isEdited: false }], // 10
    }));
    // 10 + 10 = 20 pooled, capped at 10 (NOT 20, and NOT 10 per table)
    expect(s.cat2.books).toBe(10);
  });

  it('2.4 patents: granted 10, published 5, filed 0', () => {
    const s = computeScore(emptySubmission({
      cat2Patents: [{ title: 'P1', status: 'GRANTED' }, { title: 'P2', status: 'PUBLISHED' }, { title: 'P3', status: 'FILED' }],
    }));
    expect(s.cat2.patents).toBe(15);
  });

  it('patents capped at 20', () => {
    const patents = Array.from({ length: 5 }, (_, i) => ({ title: `P${i}`, status: 'GRANTED' })); // 50 → cap 20
    expect(computeScore(emptySubmission({ cat2Patents: patents })).cat2.patents).toBe(20);
  });

  it('guidance: guide=5, co-guide=3, capped 5', () => {
    const s = computeScore(emptySubmission({
      cat2Guidance: [{ isGuide: true }, { isGuide: false }],
    }));
    expect(s.cat2.guidance).toBe(5); // 5 + 3 = 8, capped 5
  });

  it('2.9 institute + industry linkages share one cap of 10', () => {
    const s = computeScore(emptySubmission({
      cat2Linkages: [{ instituteName: 'IIT H', outcome: 'Joint paper' }],
      cat2IndustryLinkages: [{ industryName: 'TCS', outcome: 'Student projects' }, { industryName: 'Infosys', outcome: 'Shared lab' }],
    }));
    expect(s.cat2.linkages).toBe(10); // 3 x 5 = 15, capped at 10
    expect((s.cat2 as any).industryLinkages).toBeUndefined();
  });

  it('sponsored projects: ongoing=20 max (not additive), capped 20', () => {
    const s = computeScore(emptySubmission({
      cat2Projects: [{ title: 'Project A', status: 'ONGOING' }, { title: 'Project B', status: 'ONGOING' }], // 40 → cap 20
    }));
    expect(s.cat2.sponsoredProjects).toBe(20);
  });

  it('2.10 start-ups: 5 each, capped 5', () => {
    const s = computeScore(emptySubmission({
      cat2Startups: [{ groupName: 'E-Cell', outcome: 'Pitch day' }, { groupName: 'Hack club', outcome: 'Prototype' }],
    }));
    expect(s.cat2.startups).toBe(5);
  });

  it('2.6 consultancy: each band keeps its upper edge — 1L 2, 2L 4, 5L 6, 10L 8, above 10L 10', () => {
    const at = (amountLakhs: number) =>
      computeScore(emptySubmission({ cat2Consultancy: [{ name: 'Advisory', agency: 'ABC', amountLakhs }] })).cat2.consultancy;
    expect(at(1)).toBe(2);
    expect(at(2)).toBe(4);
    expect(at(5)).toBe(6);
    expect(at(10)).toBe(8);
    expect(at(10.5)).toBe(10);
  });
});

describe('Category 3 — Faculty Development', () => {
  it('3.1 PhD status: awarded=10, thesisSubmitted=10, clearedPrePhD=8, registeredForPhD=5', () => {
    const mk = (q: any) => computeScore(emptySubmission({ cat3AdvQual: q })).cat3.advQual;
    expect(mk({ awarded: true })).toBe(10);
    expect(mk({ thesisSubmitted: true })).toBe(10);
    expect(mk({ clearedPrePhD: true })).toBe(8);
    expect(mk({ registeredForPhD: true })).toBe(5);
    expect(mk({})).toBe(0);
    // priority order: awarded > thesisSubmitted > clearedPrePhD > registeredForPhD
    expect(mk({ clearedPrePhD: true, registeredForPhD: true })).toBe(8);
    expect(mk({ awarded: true, thesisSubmitted: true, clearedPrePhD: true, registeredForPhD: true })).toBe(10);
  });

  it('3.1 new qual paths: postDoc=10, pgDegree=10, pgDiploma=10, highest-applicable wins, capped 10', () => {
    const mk = (q: any) => computeScore(emptySubmission({ cat3AdvQual: q })).cat3.advQual;
    expect(mk({ postDoc: true })).toBe(10);
    expect(mk({ pgDegree: true })).toBe(10);
    expect(mk({ pgDiploma: true })).toBe(10);
    // only pgDiploma true -> 10
    expect(mk({ pgDiploma: true, registeredForPhD: false })).toBe(10);
    // registeredForPhD (5) + pgDegree (10) -> highest applicable = 10
    expect(mk({ registeredForPhD: true, pgDegree: true })).toBe(10);
    // registeredForPhD alone still yields 5 (unaffected by the new flags)
    expect(mk({ registeredForPhD: true })).toBe(5);
    // all new + old flags together still cap at 10
    expect(mk({
      postDoc: true, pgDegree: true, pgDiploma: true,
      awarded: true, thesisSubmitted: true, clearedPrePhD: true, registeredForPhD: true,
    })).toBe(10);
  });

  it('3.3 resource person: 10 each, capped 20', () => {
    const s = computeScore(emptySubmission({ cat3ResourcePerson: [{}, {}, {}] }));
    expect(s.cat3.resourcePerson).toBe(20); // 3*10=30, cap 20
  });

  it('3.4 editorial: 10 each, capped 20', () => {
    const s = computeScore(emptySubmission({ cat3Editorial: [{}, {}, {}] }));
    expect(s.cat3.editorial).toBe(20); // 3*10=30, cap 20
  });

  it('3.3 conferences attended: 10 each, capped 20', () => {
    const s = computeScore(emptySubmission({ cat3ConferencesAttended: [{}, {}, {}] }));
    expect(s.cat3.conferencesAttended).toBe(20); // 3*10=30, cap 20
    expect(s.cat3.total).toBe(20);
  });

  it('3.5 training: >5 days scores 10, exactly 5 days scores 5, capped 25', () => {
    const s = computeScore(emptySubmission({
      cat3Training: [{ durationDays: 6 }, { durationDays: 5 }, { durationDays: 2 }],
    }));
    expect(s.cat3.training).toBe(15); // 10 (>5 days) + 5 (exactly 5) + 0 (2 days is below the PDF minimum)
  });
});

describe('Category 4 — Governance', () => {
  it('admin resp +10 capped 40, student act +5 capped 10', () => {
    const s = computeScore(emptySubmission({
      cat4AdminResp: [{}, {}, {}, {}, {}], // 50 → cap 40
      cat4StudentAct: [{}, {}, {}],        // 15 → cap 10
    }));
    expect(s.cat4.adminResp).toBe(40);
    expect(s.cat4.studentActivities).toBe(10);
    expect(s.cat4.total).toBe(50);
  });
});

describe('Category 5 — Supplementary', () => {
  it('memberships: international=10, national=5, capped 15', () => {
    const s = computeScore(emptySubmission({
      cat5Memberships: [{ status: 'international_member' }, { status: 'national_member' }],
    }));
    expect(s.cat5.memberships).toBe(15);
  });

  it('memberships: life_member=10 (same tier as international/national_executive)', () => {
    const s = computeScore(emptySubmission({
      cat5Memberships: [{ status: 'life_member' }],
    }));
    expect(s.cat5.memberships).toBe(10);
  });

  it('memberships: two life_member entries cap at 15 (10+10=20)', () => {
    const s = computeScore(emptySubmission({
      cat5Memberships: [{ status: 'life_member' }, { status: 'life_member' }],
    }));
    expect(s.cat5.memberships).toBe(15);
  });

  it('differentiators: initiating=10, leading=7, participating=3', () => {
    const s = computeScore(emptySubmission({
      cat5Differentiators: [{ role: 'initiating' }, { role: 'participating' }],
    }));
    expect(s.cat5.differentiators).toBe(13);
  });
});

describe('Category 5 — Supplementary (2)', () => {
  it('5.1 membership: national=5, international/executive=10, capped 15', () => {
    const s = computeScore(emptySubmission({
      cat5Memberships: [
        { status: 'national_member' }, { status: 'international_member' }, { status: 'national_executive' },
      ],
    }));
    expect(s.cat5.memberships).toBe(15); // 5 + 10 + 10 = 25, cap 15
  });

  it('5.2 awards: state=5, national/international=10, capped 10', () => {
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: 'state' }] })).cat5.awards).toBe(5);
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: 'national' }] })).cat5.awards).toBe(10);
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: 'international' }] })).cat5.awards).toBe(10);
    const s = computeScore(emptySubmission({
      cat5Awards: [{ level: 'state' }, { level: 'state' }, { level: 'state' }], // 5*3=15, cap 10
    }));
    expect(s.cat5.awards).toBe(10);
  });

  it('5.2 awards: unrecognized/empty level scores nothing (PDF defines state / national / international only)', () => {
    // The PDF defines International/National (10) and State (5). Anything else
    // scores nothing — an unset level used to collect the maximum.
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: '' }] })).cat5.awards).toBe(0);
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: 'regional' }] })).cat5.awards).toBe(0);
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: 'state' }] })).cat5.awards).toBe(5);
    expect(computeScore(emptySubmission({ cat5Awards: [{ level: 'national' }] })).cat5.awards).toBe(10);
  });
});

describe('selfTotal', () => {
  it('sums cat1-5 totals', () => {
    const s = computeScore(emptySubmission({
      cat1Courses: [{ periodsConducted: 100, periodPlanned: 100, novelPedagogyUsed: false }], // lectures 10
      cat5Memberships: [{ status: 'national_member' }], // 5
    }));
    expect(s.selfTotal).toBe(s.cat1.total + s.cat2.total + s.cat3.total + s.cat4.total + s.cat5.total);
    expect(s.selfTotal).toBe(15);
  });

  it('never exceeds 500 (cat max sum)', () => {
    // Saturate all categories
    const huge = Array.from({ length: 50 }, () => ({}));
    const s = computeScore(emptySubmission({
      cat1Courses: Array.from({ length: 50 }, () => ({ periodsConducted: 100, periodPlanned: 100, novelPedagogyUsed: true })),
      cat1CourseResults: Array.from({ length: 50 }, () => ({ classSize: 10, avgAttendancePct: 100, feedbackReceived: 5, passPercentage: 100 })),
      cat1Projects: huge.map(() => ({ course: 'MTECH', projectType: 'MAJOR', count: 10 })),
      cat1EContent: huge, cat1ICT: huge,
      cat2Journals: huge.map(() => ({ indexed: 'ESCI' })),
      cat4AdminResp: huge, cat4StudentAct: huge,
      cat5Memberships: huge.map(() => ({ status: 'international_member' })),
    }));
    expect(s.cat1.total).toBeLessThanOrEqual(150);
    expect(s.cat2.total).toBeLessThanOrEqual(150);
    expect(s.cat4.total).toBeLessThanOrEqual(50);
    expect(s.cat5.total).toBeLessThanOrEqual(50);
    expect(s.selfTotal).toBeLessThanOrEqual(500);
  });
});

// End-to-end form-alignment check using a real filled appraisal sample.
// Asserts each category total matches the official form's self-appraisal
// (Cat1 = 137: the form's own 1.3 total of 20 is mis-added; by rule = 17).
describe('sample appraisal — form alignment', () => {
  const sample = emptySubmission({
    // 1.1 — 6 courses, all >=90% engagement + novel pedagogy -> raw 86, caps 40
    cat1Courses: [
      { periodsConducted: 46, periodPlanned: 48, novelPedagogyUsed: true },
      { periodsConducted: 46, periodPlanned: 48, novelPedagogyUsed: true },
      { periodsConducted: 47, periodPlanned: 48, novelPedagogyUsed: true },
      { periodsConducted: 47, periodPlanned: 48, novelPedagogyUsed: true },
      { periodsConducted: 64, periodPlanned: 64, novelPedagogyUsed: true },
      { periodsConducted: 64, periodPlanned: 64, novelPedagogyUsed: true },
    ],
    // 1.2 — 6 courses, per-course ~18.6-19.5 -> caps 80
    cat1CourseResults: [
      { classSize: 70, avgAttendancePct: 95, feedbackReceived: 4.7, passPercentage: 92 },
      { classSize: 70, avgAttendancePct: 95, feedbackReceived: 4.7, passPercentage: 94 },
      { classSize: 70, avgAttendancePct: 96, feedbackReceived: 4.76, passPercentage: 93 },
      { classSize: 70, avgAttendancePct: 95, feedbackReceived: 4.6, passPercentage: 94 },
      { classSize: 70, avgAttendancePct: 100, feedbackReceived: 4.5, passPercentage: 97 },
      { classSize: 70, avgAttendancePct: 100, feedbackReceived: 4.5, passPercentage: 100 },
    ],
    // 1.3 — BTech Mini 1 (2), BTech Major 2 (10), MTech Major 1 (5) = 17
    cat1Projects: [
      { course: 'BTECH', projectType: 'MINI', count: 1 },
      { course: 'BTECH', projectType: 'MAJOR', count: 2 },
      { course: 'MTECH', projectType: 'MAJOR', count: 1 },
    ],
    // 2.1 — 4 indexed journal papers -> 60, caps 60
    cat2Journals: [
      { indexed: 'SCOPUS', allAuthorsFromCampus: false }, { indexed: 'SCOPUS', allAuthorsFromCampus: false },
      { indexed: 'SCOPUS', allAuthorsFromCampus: false }, { indexed: 'SCOPUS', allAuthorsFromCampus: false },
    ],
    // 2.2 — total citations 61 -> 3 (51-100 tier)
    cat2Citations: { totalCitations: 61 },
    // 2.3 — 1 published book chapter, international publisher, author -> 10.
    // Scope is explicit: since 2026-09-11 a row with no scope scores 0.
    cat2BookChapters: [{ title: 'Book chapter', scope: 'INTERNATIONAL', isEdited: false }],
    // 2.4 — 1 published patent -> 5 (published tier, not granted). Titled: since
    // 2026-09-11 an untitled row scores 0, as a blank-row placeholder would.
    cat2Patents: [{ title: 'Published patent', status: 'PUBLISHED' }],
    // 2.8 -> 5, 2.9 institute + industry linkages (2 + 3 = 5 x 5 = 25) -> capped 10.
    // Each entry is given a name and an outcome here: without an outcome an
    // entry scores nothing (owner decision 2026-09-13).
    cat2ResearchGroups: [{ groupName: 'AI Group', outcome: 'Papers' }],
    cat2Linkages: [{ instituteName: 'Inst A', outcome: 'MoU' }, { instituteName: 'Inst B', outcome: 'Joint project' }],
    cat2IndustryLinkages: [
      { industryName: 'Ind A', outcome: 'Internships' }, { industryName: 'Ind B', outcome: 'Lab' }, { industryName: 'Ind C', outcome: 'Talks' },
    ],
    // 3.2 -> 20, 3.3 conferences (2) -> 20, 3.3 resourcePerson (1) -> 10,
    // 3.4 editorial (1) -> 10, 3.5 (10+5+5+5)=25  → cat3 = 85
    cat3Organised: [{}, {}],
    cat3ConferencesAttended: [{}, {}],
    cat3ResourcePerson: [{}],
    cat3Editorial: [{}],
    cat3Training: [{ durationDays: 30 }, { durationDays: 1 }, { durationDays: 1 }, { durationDays: 1 }],
    // 4.1 -> 40, 4.2 -> 10
    cat4AdminResp: [{}, {}, {}, {}],
    cat4StudentAct: [{}, {}],
    // 5.1 (3 national=15), 5.3 (3+3+7+7=20), 5.4 (2 -> cap 5)
    cat5Memberships: [{ status: 'national_member' }, { status: 'national_member' }, { status: 'national_member' }],
    cat5Differentiators: [{ role: 'participating' }, { role: 'participating' }, { role: 'leading' }, { role: 'leading' }],
    cat5Internships: [{}, {}],
  });

  const s = computeScore(sample);

  it('Category 1 = 137 (40 + 80 + 17)', () => {
    expect(s.cat1.lectures).toBe(40);
    expect(s.cat1.attendanceFeedback).toBe(80);
    expect(s.cat1.projects).toBe(17);
    expect(s.cat1.total).toBe(137);
  });
  it('Category 2 = 93', () => { expect(s.cat2.total).toBe(93); });
  // Was 85 until the 2026-08-28 PDF review: this faculty logged three 1-day
  // programmes, which collected 5 marks each even though the form grants 5 only
  // from a minimum of 5 days. Only the 30-day programme scores now.
  it('Category 3 = 70', () => { expect(s.cat3.total).toBe(70); });
  it('Category 4 = 50', () => { expect(s.cat4.total).toBe(50); });
  it('Category 5 = 40', () => { expect(s.cat5.total).toBe(40); });
  it('self total = 390', () => { expect(s.selfTotal).toBe(390); });
});
