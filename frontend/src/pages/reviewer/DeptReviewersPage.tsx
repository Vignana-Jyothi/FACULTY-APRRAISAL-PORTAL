import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, Users } from 'lucide-react';
import { deptReviewerApi, type DeptRosterMember } from '../../api/deptReviewers';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

// A HoD appoints or stands down department reviewers (incharges) — faculty in
// their own department who then verify proofs and review submissions alongside
// the HoD. Scoped to the HoD's department by the server.
export default function DeptReviewersPage() {
  const [rows, setRows] = useState<DeptRosterMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    deptReviewerApi.list()
      .then(setRows)
      .catch(() => toast.error('Failed to load the department roster'))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const toggle = async (m: DeptRosterMember) => {
    setBusy(m.id);
    try {
      if (m.isReviewer) {
        await deptReviewerApi.remove(m.id);
        toast.success(`${m.name} is no longer a reviewer`);
      } else {
        await deptReviewerApi.add(m.id);
        toast.success(`${m.name} is now a department reviewer`);
      }
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Change failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;

  const reviewerCount = rows.filter((r) => r.isReviewer).length;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Department Reviewers"
        help="Appoint faculty in your department as reviewers (incharges). A reviewer verifies proofs and reviews submissions alongside you. Only your own department is shown, and the change takes effect at their next sign-in."
        subtitle={`${reviewerCount} reviewer(s) of ${rows.length} faculty in your department`}
        breadcrumbs={[{ label: 'Review Queue', to: '/reviews' }, { label: 'Department Reviewers' }]}
      />

      {rows.length === 0 ? (
        <Card className="text-center py-8">
          <Users className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No faculty in your department yet.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-5 py-2.5 font-medium">Faculty</th>
                <th className="text-left px-5 py-2.5 font-medium">Designation</th>
                <th className="text-left px-5 py-2.5 font-medium">Reviewer</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((m, i) => (
                <tr key={m.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-5 py-3 font-medium text-ink-primary">
                    {m.name} <span className="text-ink-muted font-normal">({m.employeeCode})</span>
                  </td>
                  <td className="px-5 py-3 text-ink-secondary">{m.designation ?? '—'}</td>
                  <td className="px-5 py-3">
                    {m.isReviewer ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <ShieldCheck size={12} /> Reviewer
                      </span>
                    ) : (
                      <span className="text-xs text-ink-subtle">Faculty</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggle(m)}
                      disabled={busy === m.id}
                      className={`text-sm px-3 py-1 rounded disabled:opacity-50 ${
                        m.isReviewer
                          ? 'border border-surface-border text-ink-secondary hover:bg-surface-muted'
                          : 'bg-primary-600 text-white hover:bg-primary-700'
                      }`}
                    >
                      {m.isReviewer ? 'Remove' : 'Make reviewer'}
                    </button>
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
