import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Eye } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { verificationApi, type RedListRow } from '../../api/verification';

export default function RedListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RedListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    verificationApi
      .redList()
      .then(setRows)
      .catch(() => toast.error('Failed to load red list'))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const clear = async (r: RedListRow) => {
    if (!confirm(`Clear hold for ${r.user.name}? They must have re-uploaded corrected proofs.`)) return;
    setBusy(r.id);
    try {
      await verificationApi.clearHold(r.id);
      toast.success('Hold cleared');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Red List"
        subtitle="Submissions held after a rejected proof — clear once the faculty re-uploads."
        help="Submissions held because a proof was rejected. They clear once the faculty re-uploads. An uncorrected proof voids that section after 14 days so review can proceed."
        help="Submissions held because a proof was rejected. They clear once the faculty re-uploads. An uncorrected proof voids that section after 14 days so review can proceed."
        breadcrumbs={[{ label: 'Red List' }]}
      />

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card>
          <div className="text-sm text-ink-muted py-4 text-center">No held submissions. All clear.</div>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-ink-primary flex items-center gap-2">
                    <AlertTriangle size={15} className="text-red-500" />
                    {r.user.name} <span className="text-ink-muted font-normal">{r.user.employeeCode}</span>
                  </div>
                  <div className="text-xs text-ink-muted mt-1">
                    {r.user.department?.name ?? '—'} · Submission #{r.submissionNumber} · {r.academicYear.label}
                    {r.heldAt && <> · held {new Date(r.heldAt).toLocaleString()}</>}
                  </div>
                  {r.holdReason && <div className="text-xs text-red-700 mt-1.5">{r.holdReason}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => navigate(`/reviews/${r.id}`)}
                    className="inline-flex items-center gap-1 text-sm border border-surface-border px-3 py-1.5 rounded hover:bg-surface-muted"
                  >
                    <Eye size={14} /> Open
                  </button>
                  <button
                    onClick={() => clear(r)}
                    disabled={busy === r.id}
                    className="inline-flex items-center gap-1 text-sm bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-700 disabled:opacity-50"
                  >
                    <CheckCircle2 size={14} /> Clear hold
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
