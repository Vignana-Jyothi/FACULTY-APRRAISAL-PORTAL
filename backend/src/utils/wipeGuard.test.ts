import { describe, it, expect } from 'vitest';
import { wouldWipeDraft } from './wipeGuard';

describe('wouldWipeDraft (save-race belt)', () => {
  const stored = { cat1Courses: [{ id: 'a' }], cat2Journals: [{ id: 'b' }], cat3Training: [] };

  it('refuses an all-empty save over a draft with rows in two or more categories', () => {
    expect(wouldWipeDraft({ cat1Courses: [], cat2Journals: [], cat3Training: [] }, stored)).toBe(true);
  });

  it('allows a save that still carries any row', () => {
    expect(wouldWipeDraft({ cat1Courses: [{ title: 'x' }], cat2Journals: [], cat3Training: [] }, stored)).toBe(false);
  });

  it('allows emptying the last populated category on purpose', () => {
    expect(wouldWipeDraft({ cat1Courses: [], cat3Training: [] }, { cat1Courses: [{ id: 'a' }] })).toBe(false);
  });

  it('allows an all-empty save over an empty draft', () => {
    expect(wouldWipeDraft({ cat1Courses: [], cat2Journals: [] }, { cat1Courses: [], cat2Journals: [] })).toBe(false);
  });

  it('ignores payloads with no row categories (leave data only, singletons only)', () => {
    expect(wouldWipeDraft(undefined, stored)).toBe(false);
    expect(wouldWipeDraft({ cat2Citations: { totalCitations: 0 } }, stored)).toBe(false);
  });
});
