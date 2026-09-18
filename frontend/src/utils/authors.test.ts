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

  it('blocks saving only an all-VNRVJIET paper claimed by another co-author', () => {
    const row = { title: 'Edge AI', authorList: ['A', 'B'], allAuthorsFromCampus: true };
    expect(publicationClaimConflict({ cat2Journals: [{ ...row, claimedBySelf: false }] })).toMatch(/^"Edge AI" is claimed by another co-author\./);
    expect(publicationClaimConflict({ cat2Journals: [{ ...row, claimedBySelf: true }] })).toBeNull();
    expect(publicationClaimConflict({ cat2Conferences: [{ ...row, claimedBySelf: null }] })).toBeNull();
    expect(publicationClaimConflict({ cat2ConfBookChapters: [{ ...row, allAuthorsFromCampus: false, claimedBySelf: false }] })).toBeNull();
  });
});
