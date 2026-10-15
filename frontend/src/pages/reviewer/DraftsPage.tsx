import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Search } from 'lucide-react';
import { reviewApi, type DraftInProgressRow } from '../../api/appraisals';
import { deptReviewWindowApi, type ActivityRow } from '../../api/deptReviewWindows';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

// Drafts in Review: every faculty in the HoD's department, whether or not they
// have started this year, with their last-activity date, review status and a
// manual reminder. The HoD reviews each quarter after its calendar end.
type Row = ActivityRow & { draft?: DraftInProgressRow };

export default function DraftsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'to-verify' | 'done' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [drafts, activity] = await Promise.all([reviewApi.listDrafts(), deptReviewWindowApi.activity()]);
    const byUser = new Map(drafts.map((d) => [d.faculty.id, d]));
    setRows(activity.rows.map((a) => ({ ...a, draft: byUser.get(a.userId) })));
  };

  useEffect(() => {
    load().catch(() => toast.error('Failed to load faculty')).finally(() => setLoading(false));
  }, []);

  const q = query.trim().toLowerCase();
  const matchStatus = (r: Row) => {
    const d = r.draft;
    switch (statusFilter) {
      case 'to-verify': return !!d?.needsReview;
      case 'done': return !!d && !d.needsReview;
      case 'Q1': case 'Q2': case 'Q3': case 'Q4': return d?.currentReviewQuarter === statusFilter;
      default: return true;
    }
  };
  const shown = rows.filter((r) =>
    matchStatus(r) && (!q || r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q))
  );

  const remind = async (userId: string) => {
    setBusy('remind:' + userId);
    try {
      const r = await deptReviewWindowApi.remind(userId);
      r.queued ? toast.success(r.message) : toast(r.message);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Could not send reminder');
    } finally { setBusy(null); }
  };

  const toggleLock = async (d: DraftInProgressRow) => {
    setBusy('lock:' + d.submissionId);
    try {
      await reviewApi.setEditLock(d.submissionId, !d.editUnlocked);
      await load();
      toast.success(d.editUnlocked ? 'Re-locked' : 'Unlocked for editing');
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Could not change the lock');
    } finally { setBusy(null); }
  };

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Drafts in Review"
        help="Every faculty in your department. See whether they have started this year and their last activity, verify each quarter after it ends, and remind anyone who has gone quiet."
        subtitle={`${rows.length} faculty in your department`}
        breadcrumbs={[{ label: 'Drafts in Review' }]}
      />

      {rows.length === 0 ? (
        <Card className="text-center py-8">
          <FileText className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No faculty in your department.</p>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1 min-w-[180px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search faculty name or code"
                className="input w-full pl-9"
              />
            </div>
            <select className="input max-w-[200px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">All statuses</option>
              <option value="to-verify">To verify (any quarter)</option>
              <option value="done">Up to date (nothing due)</option>
              <option value="Q1">Q1 to verify</option>
              <option value="Q2">Q2 to verify</option>
              <option value="Q3">Q3 to verify</option>
              <option value="Q4">Q4 to verify</option>
            </select>
          </div>
          {shown.length === 0 ? (
            <Card className="text-center py-6"><p className="text-ink-muted text-sm">No faculty match the current filter.</p></Card>
          ) : (
            <Card padding="none">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-primary-700 text-white text-xs">
                    <th className="text-left px-5 py-2.5 font-medium">Faculty</th>
                    <th className="text-left px-5 py-2.5 font-medium">Started</th>
                    <th className="text-left px-5 py-2.5 font-medium">Last activity</th>
                    <th className="text-left px-5 py-2.5 font-medium">Proofs</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {shown.map((r, i) => {
                    const d = r.draft;
                    return (
                      <tr key={r.userId} className={`${i % 2 === 1 ? 'bg-surface-muted/50' : ''} ${d && !d.needsReview ? 'opacity-70' : ''}`}>
                        <td className="px-5 py-3 font-medium text-ink-primary">
                          <div>{r.name} <span className="text-ink-muted font-normal">({r.employeeCode})</span></div>
                          {d && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {d.issuedQuarters.map((qq) => (
                                <span key={qq} className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">{qq} verified</span>
                              ))}
                              {d.currentReviewQuarter && (
                                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">{d.currentReviewQuarter} to verify</span>
                              )}
                              {d.locked && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">Locked</span>}
                              {d.editUnlocked && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Unlocked</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {r.hasSubmission
                            ? <span className="text-emerald-700 text-xs font-medium">Started</span>
                            : <span className="text-ink-subtle text-xs">Not started</span>}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {r.lastEditedAt ? new Date(r.lastEditedAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-5 py-3 text-xs">
                          {!d || d.counts.total === 0 ? (
                            <span className="text-ink-subtle">none yet</span>
                          ) : (
                            <span className="flex gap-2">
                              <span className="text-amber-700">{d.counts.pending} pending</span>
                              <span className="text-emerald-700">{d.counts.verified} verified</span>
                              {d.counts.rejected > 0 && <span className="text-red-700">{d.counts.rejected} rejected</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => remind(r.userId)}
                              disabled={busy === 'remind:' + r.userId || r.optedOut}
                              title={r.optedOut ? 'Faculty opted out of emails' : ''}
                              className="text-xs border border-surface-border rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40"
                            >
                              Remind
                            </button>
                            {d && (d.locked || d.editUnlocked) && (
                              <button
                                onClick={() => toggleLock(d)}
                                disabled={busy === 'lock:' + d.submissionId}
                                className="text-xs border border-surface-border rounded px-2 py-1 hover:bg-surface-muted"
                              >
                                {d.editUnlocked ? 'Re-lock' : 'Unlock'}
                              </button>
                            )}
                            {d && (
                              <Link to={`/drafts/${d.submissionId}`} className="text-sm bg-primary-600 text-white px-3 py-1 rounded hover:bg-primary-700 inline-block">
                                Open
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
