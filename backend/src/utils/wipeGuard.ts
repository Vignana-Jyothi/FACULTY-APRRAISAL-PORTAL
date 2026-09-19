/**
 * Server-side belt for the appraisal-form save race (2026-09-15).
 *
 * The form used to autosave its empty defaults when a step was clicked before
 * the draft had loaded, and `updateAppraisal` replaces every category it is
 * sent — so one early click wiped the whole draft. The form now waits for the
 * draft (AppraisalEditPage `loadedRef`); this is the second line of defence.
 *
 * A save is refused when every row category it carries is empty while the
 * stored draft has rows in two or more categories. A person can empty a single
 * category on purpose, and a real form save always carries the categories the
 * user did not touch — only a form that never loaded sends all of them empty.
 */
export function wouldWipeDraft(
  incoming: Record<string, unknown> | null | undefined,
  existing: Record<string, unknown>,
): boolean {
  if (!incoming || typeof incoming !== 'object') return false;
  const arrayKeys = Object.keys(incoming).filter((k) => Array.isArray(incoming[k]));
  if (arrayKeys.length === 0) return false;
  if (arrayKeys.some((k) => (incoming[k] as unknown[]).length > 0)) return false;
  const populated = arrayKeys.filter((k) => Array.isArray(existing[k]) && (existing[k] as unknown[]).length > 0);
  return populated.length >= 2;
}
