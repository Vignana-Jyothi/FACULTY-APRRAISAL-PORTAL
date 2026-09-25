import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { reviewApi } from '../../api/appraisals';
import toast from 'react-hot-toast';
import { FileText } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatusBadge from '../../components/StatusBadge';

export default function ReviewQueuePage() {
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    reviewApi.listPending()
      .then(setPending)
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Review Queue"
        help="Appraisals waiting for your review. Open one to score categories 1–5, verify proofs and record category 6."
        help="Appraisals waiting for your review. Open one to score categories 1–5, verify proofs and record category 6."
        subtitle={`${pending.length} submission(s) awaiting review`}
        breadcrumbs={[{ label: 'Home' }, { label: 'Review Queue' }]}
        actions={
          <Link to="/drafts" className="text-sm border border-surface-border px-3 py-1.5 rounded hover:bg-surface-muted">
            Drafts in progress →
          </Link>
        }
      />

      {pending.length === 0 ? (
        <Card className="text-center py-8">
          <FileText className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No pending reviews.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-5 py-2.5 font-medium">Faculty</th>
                <th className="text-left px-5 py-2.5 font-medium">Department</th>
                <th className="text-left px-5 py-2.5 font-medium">Submission</th>
                <th className="text-left px-5 py-2.5 font-medium">Submitted</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {pending.map((sub, i) => (
                <tr key={sub.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-5 py-3 font-medium text-ink-primary">
                    {sub.user.name} <span className="text-ink-muted font-normal">({sub.user.employeeCode})</span>
                  </td>
                  <td className="px-5 py-3 text-ink-secondary">{sub.user.department?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-secondary">#{sub.submissionNumber} — {sub.academicYear?.label}</td>
                  <td className="px-5 py-3 text-ink-muted">{sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-5 py-3"><StatusBadge status={sub.status} /></td>
                  <td className="px-5 py-3">
                    <Link
                      to={`/reviews/${sub.id}`}
                      className="text-sm bg-primary-600 text-white px-3 py-1 rounded hover:bg-primary-700 inline-block"
                    >
                      Review
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
