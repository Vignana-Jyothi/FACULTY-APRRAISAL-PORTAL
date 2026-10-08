// 2.1 author lists on the form (2026-09-15). Rows saved before the list
// existed only have the free-text `authors`, so the list is seeded from it on
// load; saving writes the list, and the server keeps `authors` in step.

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
 * The 2.1 claim is identification only (owner decision revised 2026-10-08): a
 * co-author may enter and score a paper even when another co-author is the
 * claiming author, so nothing here blocks saving any more. Kept as a no-op so
 * callers and the pre-save check stay in one place; always returns null.
 */
export function publicationClaimConflict(_values: any): string | null {
  return null;
}
