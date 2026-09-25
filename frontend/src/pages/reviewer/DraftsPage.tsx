import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText } from 'lucide-react';
import { reviewApi, type DraftInProgressRow } from '../../api/appraisals';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { useAuthStore } from '../../store/authStore';

// Drafts in progress (owner decision 2026-09-19). A faculty's draft carries
// across the whole year and is submitted only after the Q4 review window, so
// the department checks proofs on it along the way, and the HoD notes a
// provisional draft review. The server scopes the list to the caller's own
// department and leaves out their own draft.
export default function DraftsPage() {
  const [rows, setRows] = useState<DraftInProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isHod = useAuthStore((s) => s.hasRole('HOD'));

  useEffect(() => {
    reviewApi.listDrafts()
      .then(setRows)
      .catch(() => toast.error('Failed to load drafts'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Drafts in progress"
        help="Faculty drafts not yet submitted. Open one to verify proofs and leave a draft review during the year."
        help="Faculty drafts not yet submitted. Open one to verify proofs and leave a draft review during the year."
        subtitle={`${rows.length} draft(s) in your department — check proofs during the year${isHod ? ' and note a draft review' : ''}`}
        breadcrumbs={[{ label: 'Review Queue', to: '/reviews' }, { label: 'Drafts in progress' }]}
      />

      {rows.length === 0 ? (
        <Card className="text-center py-8">
          <FileText className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No drafts in progress.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-5 py-2.5 font-medium">Faculty</th>
                <th className="text-left px-5 py-2.5 font-medium">Year</th>
                <th className="text-left px-5 py-2.5 font-medium">Last update</th>
                <th className="text-left px-5 py-2.5 font-medium">Proofs</th>
                <th className="text-left px-5 py-2.5 font-medium">Draft review</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((r, i) => (
                <tr key={r.submissionId} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-5 py-3 font-medium text-ink-primary">
                    {r.faculty.name} <span className="text-ink-muted font-normal">({r.faculty.employeeCode})</span>
                  </td>
                  <td className="px-5 py-3 text-ink-secondary">{r.academicYear.label}</td>
                  <td className="px-5 py-3 text-ink-muted">{new Date(r.updatedAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-xs">
                    {r.counts.total === 0 ? (
                      <span className="text-ink-subtle">none yet</span>
                    ) : (
                      <span className="flex gap-2">
                        <span className="text-amber-700">{r.counts.pending} pending</span>
                        <span className="text-emerald-700">{r.counts.verified} verified</span>
                        {r.counts.rejected > 0 && <span className="text-red-700">{r.counts.rejected} rejected</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink-muted">
                    {r.draftReviewedAt ? `saved ${new Date(r.draftReviewedAt).toLocaleDateString()}` : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      to={`/drafts/${r.submissionId}`}
                      className="text-sm bg-primary-600 text-white px-3 py-1 rounded hover:bg-primary-700 inline-block"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
