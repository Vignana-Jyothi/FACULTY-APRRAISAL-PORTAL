/**
 * 2.1 author lists, applied on save (owner decisions 2026-09-15).
 *
 * The form sends each paper's authors as an ordered list, whether they are all
 * from VNRVJIET (`allAuthorsFromCampus`) and, for such a paper, whether the
 * appraisal's owner claims it (`claimedBySelf`). The owner is always the
 * faculty filing, so nothing points into the list. This trims the list, drops
 * blank names, and keeps the legacy `authors` text in step — the PDF and older
 * readers still use it.
 *
 * The claim is identification only (owner decision revised 2026-10-08): a row
 * claimed by another co-author saves and scores the same, and a co-author may
 * enter the same paper in their own appraisal. This no longer refuses any row;
 * it just normalises the fields. An unanswered campus question is a draft in
 * progress and saves; the engine scores it 0 until answered.
 */

const PUBLICATION_KEYS = ['cat2Journals', 'cat2Conferences', 'cat2ConfBookChapters'] as const;

const toTriState = (v: unknown): boolean | null => {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
};

/** Normalise the 2.1 rows in place. Returns an error message to send back, or null. */
export function normalizePublicationAuthors(categories: any): string | null {
  if (!categories || typeof categories !== 'object') return null;
  for (const key of PUBLICATION_KEYS) {
    const rows = categories[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;

      if ('allAuthorsFromCampus' in row) row.allAuthorsFromCampus = toTriState(row.allAuthorsFromCampus);
      if ('claimedBySelf' in row) row.claimedBySelf = toTriState(row.claimedBySelf);

      if (Array.isArray(row.authorList)) {
        row.authorList = row.authorList.map((a: unknown) => String(a ?? '').trim()).filter(Boolean);
        if (row.authorList.length) row.authors = row.authorList.join(', ');
      }

      // Only an all-VNRVJIET paper has a claim to make.
      if (row.allAuthorsFromCampus !== true && 'claimedBySelf' in row) row.claimedBySelf = null;
      // The claim no longer gates saving — a co-author may enter the paper too.
    }
  }
  return null;
}
