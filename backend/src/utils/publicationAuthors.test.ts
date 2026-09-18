import { describe, it, expect } from 'vitest';
import { normalizePublicationAuthors } from './publicationAuthors';

describe('normalizePublicationAuthors (2.1 author lists on save)', () => {
  it('trims the list, drops blank names and keeps the joined text in step', () => {
    const c: any = {
      cat2Journals: [{ title: 'P', authorList: [' A ', '', 'B', '  ', 'C'], claimedBySelf: 'true', allAuthorsFromCampus: 'true' }],
    };
    expect(normalizePublicationAuthors(c)).toBeNull();
    expect(c.cat2Journals[0]).toMatchObject({
      authorList: ['A', 'B', 'C'], claimedBySelf: true, allAuthorsFromCampus: true, authors: 'A, B, C',
    });
  });

  it('refuses an all-VNRVJIET paper claimed by another co-author', () => {
    const c: any = {
      cat2Conferences: [{ title: 'Edge AI', authorList: ['A', 'B'], claimedBySelf: false, allAuthorsFromCampus: true }],
    };
    expect(normalizePublicationAuthors(c)).toMatch(/^"Edge AI" is claimed by another co-author\./);
  });

  it('lets a draft in progress save (unanswered, or no claim yet)', () => {
    const c: any = {
      cat2ConfBookChapters: [
        { title: 'X', authorList: ['A'], claimedBySelf: null, allAuthorsFromCampus: null },
        { title: 'Y', authorList: ['A', 'B'], claimedBySelf: null, allAuthorsFromCampus: true },
      ],
    };
    expect(normalizePublicationAuthors(c)).toBeNull();
  });

  it('clears the claim when some co-authors are from other institutions', () => {
    const c: any = {
      cat2Journals: [{ title: 'X', authorList: ['A', 'B'], claimedBySelf: false, allAuthorsFromCampus: false }],
    };
    expect(normalizePublicationAuthors(c)).toBeNull();
    expect(c.cat2Journals[0].claimedBySelf).toBeNull();
  });

  it('leaves a row without a list (an older client) untouched', () => {
    const c: any = { cat2Journals: [{ title: 'X', authors: 'A, B' }] };
    expect(normalizePublicationAuthors(c)).toBeNull();
    expect(c.cat2Journals[0]).toEqual({ title: 'X', authors: 'A, B' });
  });

  it('ignores categories it does not own', () => {
    const c: any = { cat2BookChapters: [{ title: 'X', authorList: ['A', 'B'], claimedBySelf: false, allAuthorsFromCampus: true }] };
    expect(normalizePublicationAuthors(c)).toBeNull();
    expect(normalizePublicationAuthors(undefined)).toBeNull();
  });
});
