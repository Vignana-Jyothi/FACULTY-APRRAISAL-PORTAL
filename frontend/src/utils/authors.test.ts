import { describe, it, expect } from 'vitest';
import { splitAuthors, withAuthorList, publicationClaimConflict } from './authors';

describe('2.1 author lists on the form', () => {
  it('splits legacy free-text authors on the same separators countAuthors counts', () => {
    expect(splitAuthors('A. Rao, B. Devi and C. Kumar; D & E')).toEqual(['A. Rao', 'B. Devi', 'C. Kumar', 'D', 'E']);
    expect(splitAuthors('')).toEqual([]);
    expect(splitAuthors(null)).toEqual([]);
  });

  it('seeds a list only for rows that have none', () => {
    const rows = withAuthorList([{ authors: 'A, B' }, { authors: 'x', authorList: ['Kept'] }]);
    expect(rows[0].authorList).toEqual(['A', 'B']);
    expect(rows[1].authorList).toEqual(['Kept']);
    expect(withAuthorList(undefined)).toEqual([]);
  });

  it('never blocks saving — the 2.1 claim is identification only (revised 2026-10-08)', () => {
    const row = { title: 'Edge AI', authorList: ['A', 'B'], allAuthorsFromCampus: true };
    expect(publicationClaimConflict({ cat2Journals: [{ ...row, claimedBySelf: false }] })).toBeNull();
    expect(publicationClaimConflict({ cat2Journals: [{ ...row, claimedBySelf: true }] })).toBeNull();
    expect(publicationClaimConflict({ cat2Conferences: [{ ...row, claimedBySelf: null }] })).toBeNull();
  });
});
