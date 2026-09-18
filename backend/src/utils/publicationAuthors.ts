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
 * It also enforces the one rule the scoring engine cannot: an all-VNRVJIET
 * paper belongs to the author who claims it, so a row claimed by another
 * co-author is refused rather than saved at 0. Everything else (an unanswered
 * campus question, a claim not yet chosen) is a draft in progress and saves;
 * the engine scores it 0 until complete.
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

      if (row.allAuthorsFromCampus === true && row.claimedBySelf === false) {
        const title = String(row.title ?? '').trim() || 'A 2.1 paper';
        return `"${title}" is claimed by another co-author. All its authors are from VNRVJIET, `
          + 'so only the claiming author can enter it — remove it from your appraisal.';
      }
    }
  }
  return null;
}
