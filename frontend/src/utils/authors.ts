// 2.1 author lists on the form (2026-09-15). Rows saved before the list
// existed only have the free-text `authors`, so the list is seeded from it on
// load; saving writes the list, and the server keeps `authors` in step.

const PUBLICATION_KEYS = ['cat2Journals', 'cat2Conferences', 'cat2ConfBookChapters'] as const;

/** "A. Rao, B. Devi and C. Kumar" -> ["A. Rao", "B. Devi", "C. Kumar"] (the same separators countAuthors counts). */
export function splitAuthors(text?: string | null): string[] {
  return String(text ?? '').split(/[,;&]|\band\b/i).map((s) => s.trim()).filter(Boolean);
}

/** Give each 2.1 row an author list, seeded from its legacy text when it has none. */
export function withAuthorList<T extends { authorList?: string[] | null; authors?: string | null }>(
  rows: T[] | null | undefined,
): T[] {
  return (rows ?? []).map((r) => ({ ...r, authorList: r.authorList?.length ? r.authorList : splitAuthors(r.authors) }));
}

/**
 * The one case that blocks saving: a paper whose authors are all from VNRVJIET,
 * claimed by another co-author. Only the claiming author may enter it (owner
 * decision 2026-09-15). The server refuses the same row; checking here first
 * gives a clear message before the request is sent.
 */
export function publicationClaimConflict(values: any): string | null {
  for (const key of PUBLICATION_KEYS) {
    for (const r of values?.[key] ?? []) {
      if (r?.allAuthorsFromCampus === true && r.claimedBySelf === false) {
        const title = String(r.title ?? '').trim() || 'A 2.1 paper';
        return `"${title}" is claimed by another co-author. Only the claiming author can enter a paper whose authors are all from VNRVJIET — remove it to save.`;
      }
    }
  }
  return null;
}
