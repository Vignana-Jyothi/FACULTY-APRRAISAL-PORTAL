import { useEffect, useState } from 'react';
import { X, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { finalReviewApi, type ScrutinizerPoolRow } from '../api/appraisals';

// The dean assigns from the standing scrutinizer pool — cross-department, and
// never the HoD layer below or the maintenance admin. The pool endpoint does
// that filtering server-side, so there is no role filter here.

interface Props {
  open: boolean;
  submission: any | null;
  onClose: () => void;
  onAssigned: () => void;
}

export default function AssignReviewerModal({ open, submission, onClose, onAssigned }: Props) {
  const [reviewers, setReviewers] = useState<ScrutinizerPoolRow[]>([]);
  // Any number of final reviewers (the layer above the HoD), from any department.
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      finalReviewApi.pool()
        .then(setReviewers)
        .catch(() => toast.error('Failed to load reviewers'));
      setSelected([]);
      setSearch('');
    }
  }, [open]);

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  if (!open || !submission) return null;

  const filtered = reviewers.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.name ?? '').toLowerCase().includes(q) ||
      (r.employeeCode ?? '').toLowerCase().includes(q) ||
      (r.department?.code ?? '').toLowerCase().includes(q)
    );
  });

  const assign = async () => {
    if (selected.length === 0) {
      toast.error('Select at least one reviewer');
      return;
    }
    setBusy(true);
    try {
      await finalReviewApi.assign(submission.id, selected);
      toast.success('Final reviewers assigned — one approval finalises');
      onAssigned();
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-md max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-primary-700 text-white rounded-t-md">
          <h2 className="font-bold font-serif flex items-center gap-2">
            <UserCheck size={18} /> Assign Final Reviewers
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5">
          <div className="mb-4 pb-3 border-b border-surface-border">
            <div className="text-xs text-ink-muted">Submission</div>
            <div className="text-sm font-medium text-ink-primary">
              {submission.user?.name} ({submission.user?.employeeCode}) — #{submission.submissionNumber}
            </div>
            <div className="text-xs text-ink-muted">
              {submission.user?.department?.name ?? '—'} · {submission.academicYear?.label ?? '—'}
            </div>
          </div>

          <p className="text-xs text-ink-muted mb-3">
            Pick the reviewers for the final annual review (above the HoD). Reviewers may come from any
            department, and <strong>one</strong> approval is enough to finalise; a rejection sends the appraisal
            back on hold. <span className="text-ink-secondary">{selected.length} selected</span>
          </p>

          <div className="mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reviewer by name / code / dept..."
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="border border-surface-border rounded max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-ink-muted py-6">No reviewers found.</div>
            ) : (
              filtered.map((r) => {
                const roles = (r.roles ?? []).join(', ');
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-3 px-3 py-2 border-b border-surface-border last:border-b-0 cursor-pointer hover:bg-surface-muted ${
                      selected.includes(r.id) ? 'bg-primary-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={() => toggle(r.id)}
                      className="accent-primary-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink-primary truncate">
                        {r.name} <span className="text-xs text-ink-muted font-mono">({r.employeeCode})</span>
                      </div>
                      <div className="text-[10px] text-ink-muted">
                        {r.department?.code ?? '—'} · {roles}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
            <button
              onClick={assign}
              disabled={busy || selected.length === 0}
              className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? 'Assigning...' : 'Assign Final Reviewers'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
