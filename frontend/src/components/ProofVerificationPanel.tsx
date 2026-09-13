import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, Eye, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import Card from './Card';
import { useAuthStore } from '../store/authStore';
import { uploadApi } from '../api/uploads';
import { verificationApi, type ProofListResponse, type ProofRow } from '../api/verification';

// Mirrors the server's PROOF_REVIEW_STATUSES (verificationController).
const PROOF_REVIEW_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'HOLD', 'FINAL_REVIEW'];

const STATUS_STYLE: Record<ProofRow['status'], string> = {
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  PENDING: 'bg-surface-muted text-ink-muted border-surface-border',
};

// Open a proof: external links (Google Drive etc.) directly; internal uploaded
// files via the authenticated route.
async function openProof(url: string) {
  if (url.includes('/uploads/')) {
    try {
      const objectUrl = await uploadApi.viewProof(url);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      toast.error('Could not open file');
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function ProofVerificationPanel({
  submissionId,
  onChanged,
  readOnly,
}: {
  submissionId: string;
  onChanged?: (allVerified: boolean) => void;
  readOnly?: boolean;
}) {
  const [data, setData] = useState<ProofListResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { hasRole } = useAuthStore();
  // Admin (dean), HoD or incharge (REVIEWER) may change approve/reject.
  const canEdit = !readOnly && (hasRole('ADMIN') || hasRole('HOD') || hasRole('REVIEWER'));

  const load = useCallback(() => {
    verificationApi
      .listProofs(submissionId)
      .then((d) => {
        setData(d);
        onChanged?.(d.summary.allVerified);
      })
      .catch(() => toast.error('Failed to load proofs'));
  }, [submissionId, onChanged]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (p: ProofRow, status: 'VERIFIED' | 'REJECTED') => {
    let comment: string | undefined;
    if (status === 'REJECTED') {
      const c = window.prompt('Reason for rejecting this proof (optional):') ?? '';
      comment = c.trim() || undefined;
    }
    setBusy(p.url);
    try {
      await verificationApi.verifyProof(submissionId, p.url, status, comment);
      toast.success(`Proof ${status.toLowerCase()}`);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;

  const { proofs, summary, submission } = data;
  const sections = Array.from(new Set(proofs.map((p) => p.section)));
  // Same window the server enforces (PROOF_REVIEW_STATUSES): after submission,
  // before the decision. A draft is still the faculty's to change.
  const inReview = PROOF_REVIEW_STATUSES.includes(submission.status);
  const canAct = canEdit && inReview;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-accent-500/30">
        <h2 className="text-sm font-semibold text-ink-primary font-serif flex items-center gap-2">
          <ShieldCheck size={15} className="text-primary-600" /> Proof Verification
        </h2>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded border ${
            summary.allVerified ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          {summary.verified}/{summary.total} verified
        </span>
      </div>

      {submission.redListed && (
        <div className="mb-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">On hold / red-listed.</span> {submission.holdReason}
          </div>
        </div>
      )}

      {canAct && !summary.allVerified && summary.total > 0 && (
        <p className="mb-3 text-xs text-amber-700">Approval is blocked until every proof is verified.</p>
      )}
      {canEdit && !inReview && summary.total > 0 && (
        <p className="mb-3 text-xs text-ink-muted">
          Proofs can be verified or rejected once the appraisal is submitted, and until it is decided (now {submission.status}).
        </p>
      )}

      {proofs.length === 0 ? (
        <div className="text-xs text-ink-muted">No proofs attached to this submission.</div>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section}>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">{section}</div>
              <div className="space-y-1.5">
                {proofs
                  .filter((p) => p.section === section)
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded border border-surface-border px-3 py-2 text-xs flex-wrap">
                      <span className="font-medium text-ink-primary truncate max-w-[180px]" title={p.item}>
                        {p.item}
                      </span>
                      <span className="text-ink-muted">· {p.field}</span>
                      <button onClick={() => openProof(p.url)} className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                        <Eye size={12} /> View
                      </button>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${STATUS_STYLE[p.status]}`}>
                        {p.status === 'VERIFIED' ? <CheckCircle size={11} /> : p.status === 'REJECTED' ? <XCircle size={11} /> : <Clock size={11} />}
                        {p.status}
                      </span>
                      <div className="flex-1" />
                      {canAct && (
                        <>
                          <button
                            onClick={() => act(p, 'VERIFIED')}
                            disabled={busy === p.url || p.status === 'VERIFIED'}
                            className="inline-flex items-center gap-1 rounded border border-emerald-300 text-emerald-700 px-2 py-1 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            <CheckCircle size={12} /> Verify
                          </button>
                          <button
                            onClick={() => act(p, 'REJECTED')}
                            disabled={busy === p.url || p.status === 'REJECTED'}
                            className="inline-flex items-center gap-1 rounded border border-red-300 text-red-700 px-2 py-1 hover:bg-red-50 disabled:opacity-40"
                          >
                            <XCircle size={12} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
