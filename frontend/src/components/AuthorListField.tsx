import { Plus, X } from 'lucide-react';

// 2.1 authorship controls (owner decisions 2026-09-15): the paper's authors as
// an ordered list, and whether every author is from VNRVJIET. An all-VNRVJIET
// paper counts for one author only, so the faculty says whether they (the
// appraisal's owner) or another co-author claims it; a paper claimed by
// someone else cannot be saved. Scoring lives in utils/scoring
// (publicationClaim) — nothing here decides marks.

type ListProps = {
  authors: string[];
  onChange: (authors: string[]) => void;
  readOnly?: boolean;
  inputCls: string;
};

export function AuthorListField({ authors, onChange, readOnly, inputCls }: ListProps) {
  const list = authors.length ? authors : [''];
  const setName = (i: number, v: string) => onChange(list.map((a, j) => (j === i ? v : a)));
  const remove = (i: number) => {
    const next = list.filter((_, j) => j !== i);
    onChange(next.length ? next : ['']);
  };
  return (
    <div className="space-y-1.5">
      {list.map((a, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-right text-xs text-ink-muted">{i + 1}.</span>
          <input
            value={a}
            onChange={(e) => setName(i, e.target.value)}
            disabled={readOnly}
            className={inputCls}
            placeholder={`Author ${i + 1}, as printed`}
            aria-label={`Author ${i + 1}`}
          />
          {!readOnly && list.length > 1 && (
            <button type="button" onClick={() => remove(i)} aria-label={`Remove author ${i + 1}`} className="shrink-0 text-red-400 hover:text-red-600">
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={() => onChange([...list, ''])} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
          <Plus size={12} /> Add author
        </button>
      )}
    </div>
  );
}

type ClaimProps = {
  ownerName: string;
  allFromCampus: boolean | null;
  claimedBySelf: boolean | null;
  onChange: (allFromCampus: boolean | null, claimedBySelf: boolean | null) => void;
  readOnly?: boolean;
  name: string;
};

export function PublicationClaimFields({ ownerName, allFromCampus, claimedBySelf, onChange, readOnly, name }: ClaimProps) {
  return (
    <div className="rounded border border-surface-border bg-surface-muted/40 p-2.5">
      <div className="text-xs font-medium text-ink-secondary">Are all the authors from VNRVJIET?</div>
      <div className="mt-1 flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name={`${name}-campus`} checked={allFromCampus === true} onChange={() => onChange(true, claimedBySelf)} disabled={readOnly} />
          Yes, all from VNRVJIET
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name={`${name}-campus`} checked={allFromCampus === false} onChange={() => onChange(false, null)} disabled={readOnly} />
          No, some are from other institutions
        </label>
      </div>

      {allFromCampus === true && (
        <div className="mt-2">
          <div className="text-xs font-medium text-ink-secondary">Only one author may claim this paper. Who claims it?</div>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`${name}-claim`} checked={claimedBySelf === true} onChange={() => onChange(true, true)} disabled={readOnly} />
              Me ({ownerName || 'the faculty filing'})
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name={`${name}-claim`} checked={claimedBySelf === false} onChange={() => onChange(true, false)} disabled={readOnly} />
              Another co-author
            </label>
          </div>
          {claimedBySelf === false && (
            <p className="mt-1 text-xs font-medium text-red-600">
              Another co-author claims this paper, so only they can enter it. Remove it from your appraisal — it cannot be saved.
            </p>
          )}
          {claimedBySelf == null && <p className="mt-1 text-xs text-amber-700">Choose who claims it to score the paper.</p>}
        </div>
      )}
      {allFromCampus === false && (
        <p className="mt-2 text-xs text-ink-muted">Co-authors from other institutions — you can claim this paper for VNRVJIET.</p>
      )}
      {allFromCampus == null && (
        <p className="mt-2 text-xs text-amber-700">Answer this to score the paper.</p>
      )}
    </div>
  );
}
