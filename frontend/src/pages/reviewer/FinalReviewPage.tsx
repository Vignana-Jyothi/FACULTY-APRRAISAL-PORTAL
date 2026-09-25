import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Gavel, CheckCircle2, XCircle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { finalReviewApi, type FinalReviewRow } from '../../api/appraisals';

// The scrutinizer's queue — the review layer above the HoD. The dean assigns
// scrutinizers per submission from the standing pool; one approval from any of
// them finalises the appraisal, and a rejection (with a reason) sends it back
// on hold. Scrutinizers read /500 only.
export default function FinalReviewPage() {
  const [rows, setRows] = useState<FinalReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = () =>
    finalReviewApi.pending()
      .then(setRows)
      .catch(() => toast.error('Failed to load final reviews'))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const decide = async (submissionId: string, decision: 'APPROVED' | 'REJECTED') => {
    const comment = comments[submissionId]?.trim();
    if (decision === 'REJECTED' && !comment) {
      toast.error('Add a reason before rejecting');
      return;
    }
    setBusy(submissionId);
    try {
      const res = await finalReviewApi.decide(submissionId, decision, comment || undefined);
      toast.success(
        res.outcome === 'APPROVED' ? 'Appraisal finalised'
        : res.outcome === 'HOLD' ? 'Sent back on hold'
        : 'Recorded'
      );
      setLoading(true);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Final Review"
        subtitle="Annual appraisals assigned to you for final sign-off. One approval finalises."
        help="Cross-branch sign-off assigned by the dean. Any number of reviewers may sit above the HoD; one approval finalises the appraisal."
        help="Cross-branch sign-off assigned by the dean. Any number of reviewers may sit above the HoD; one approval finalises the appraisal."
        breadcrumbs={[{ label: 'Final Review' }]}
      />

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><div className="text-sm text-ink-muted py-6 text-center">Nothing awaiting your final review.</div></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const s = r.submission;
            return (
              <Card key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink-primary flex items-center gap-2">
                      <Gavel size={15} className="text-primary-600" />
                      {s?.user?.name} <span className="text-xs text-ink-muted font-mono">({s?.user?.employeeCode})</span>
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5">
                      {s?.user?.department?.name ?? '—'} · {s?.academicYear?.label ?? '—'} · Submission #{s?.submissionNumber}
                      {/* /500 only. Category 6 and the /550 grand total are the
                          department's assessment and are stripped for
                          scrutinizers exactly as they are for faculty — never
                          read `review.grandTotal` on this page. */}
                      {s?.review?.totalScore != null && <> · Reviewed total <strong>{s.review.totalScore}</strong>/500</>}
                    </div>
                  </div>
                  <Link
                    to={`/appraisal/${s?.id}`}
                    className="text-sm text-primary-600 hover:underline"
                  >View appraisal</Link>
                </div>

                <textarea
                  rows={2}
                  value={comments[s?.id] ?? ''}
                  onChange={(e) => setComments({ ...comments, [s?.id]: e.target.value })}
                  placeholder="Comment (required to reject)"
                  className="mt-3 w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
                />

                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => decide(s.id, 'REJECTED')}
                    disabled={busy === s?.id}
                    className="inline-flex items-center gap-2 text-sm border border-red-200 text-red-600 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-50"
                  ><XCircle size={15} /> Reject</button>
                  <button
                    onClick={() => decide(s.id, 'APPROVED')}
                    disabled={busy === s?.id}
                    className="inline-flex items-center gap-2 text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
                  ><CheckCircle2 size={15} /> Approve</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
