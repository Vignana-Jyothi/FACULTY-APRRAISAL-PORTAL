import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, Clock, ClipboardCheck } from 'lucide-react';
import Card from './Card';
import { useAuthStore } from '../store/authStore';
import { verificationApi } from '../api/verification';

// The no-proof sections: cleared by a per-row HoD yes/no instead of a proof.
// `key` is the submission's relation name; the server maps it to its model.
const APPROVAL_SECTIONS: { key: string; label: string; title: (r: any) => string }[] = [
  { key: 'cat4AdminResp', label: '4.1 Administrative Responsibilities', title: (r) => r.responsibility },
  { key: 'cat4StudentAct', label: '4.2 Student Activities', title: (r) => r.activityName },
  { key: 'cat5Memberships', label: '5.1 Professional Memberships', title: (r) => r.association },
  { key: 'cat5Differentiators', label: '5.3 Differentiators', title: (r) => r.name },
  { key: 'cat5Internships', label: '5.4 Internships', title: (r) => r.industryOrInst || r.internshipDetails },
];

// Mirrors the server's PROOF_CHECK_STATUSES — these are decided on the draft and
// through the review, up to the appraisal's decision.
const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'HOLD', 'FINAL_REVIEW'];

function statusOf(approved: boolean | null | undefined) {
  if (approved === true) return { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle };
  if (approved === false) return { label: 'Not approved', cls: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle };
  return { label: 'Pending', cls: 'bg-surface-muted text-ink-muted border-surface-border', Icon: Clock };
}

export default function ItemApprovalPanel({
  submission,
  onChanged,
  readOnly,
}: {
  submission: any;
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const { hasRole } = useAuthStore();
  const canEdit = !readOnly && (hasRole('HOD') || hasRole('REVIEWER'));
  const inReview = REVIEW_STATUSES.includes(submission?.status);
  const canAct = canEdit && inReview;

  const sections = APPROVAL_SECTIONS
    .map((s) => ({ ...s, rows: (submission?.[s.key] ?? []) as any[] }))
    .filter((s) => s.rows.length > 0);

  const total = sections.reduce((n, s) => n + s.rows.length, 0);
  const approved = sections.reduce((n, s) => n + s.rows.filter((r) => r.hodApproved === true).length, 0);

  const act = async (key: string, rowId: string, value: boolean | null) => {
    setBusy(rowId);
    try {
      await verificationApi.setItemApproval(submission.id, key, rowId, value);
      onChanged?.();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (total === 0) return null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-accent-500/30">
        <h2 className="text-sm font-semibold text-ink-primary font-serif flex items-center gap-2">
          <ClipboardCheck size={15} className="text-primary-600" /> HoD Approvals
        </h2>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded border ${
            approved === total ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          {approved}/{total} approved
        </span>
      </div>

      <p className="mb-3 text-xs text-ink-muted">
        These sections carry no proof — the HoD or incharge approves each entry directly.
      </p>

      <div className="space-y-4">
        {sections.map((s) => (
          <div key={s.key}>
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">{s.label}</div>
            <div className="space-y-1.5">
              {s.rows.map((r) => {
                const st = statusOf(r.hodApproved);
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded border border-surface-border px-3 py-2 text-xs flex-wrap">
                    <span className="font-medium text-ink-primary truncate max-w-[220px]" title={s.title(r) || '(untitled)'}>
                      {s.title(r) || '(untitled)'}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${st.cls}`}>
                      <st.Icon size={11} /> {st.label}
                    </span>
                    <div className="flex-1" />
                    {canAct && (
                      <>
                        <button
                          onClick={() => act(s.key, r.id, true)}
                          disabled={busy === r.id || r.hodApproved === true}
                          className="inline-flex items-center gap-1 rounded border border-emerald-300 text-emerald-700 px-2 py-1 hover:bg-emerald-50 disabled:opacity-40"
                        >
                          <CheckCircle size={12} /> Yes
                        </button>
                        <button
                          onClick={() => act(s.key, r.id, false)}
                          disabled={busy === r.id || r.hodApproved === false}
                          className="inline-flex items-center gap-1 rounded border border-red-300 text-red-700 px-2 py-1 hover:bg-red-50 disabled:opacity-40"
                        >
                          <XCircle size={12} /> No
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
