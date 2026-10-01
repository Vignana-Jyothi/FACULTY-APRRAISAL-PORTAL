import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck, Users, Plus } from 'lucide-react';
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
  const [pick, setPick] = useState('');

  const load = () =>
    deptReviewerApi.list()
      .then(setRows)
      .catch(() => toast.error('Failed to load the department roster'))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const addReviewer = async () => {
    if (!pick) return;
    const m = rows.find((r) => r.id === pick);
    setBusy(pick);
    try {
      await deptReviewerApi.add(pick);
      toast.success(`${m?.name ?? 'Faculty'} is now a department reviewer`);
      setPick('');
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Change failed');
    } finally {
      setBusy(null);
    }
  };

  const removeReviewer = async (m: DeptRosterMember) => {
    setBusy(m.id);
    try {
      await deptReviewerApi.remove(m.id);
      toast.success(`${m.name} is no longer a reviewer`);
      await load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Change failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;

  const reviewers = rows.filter((r) => r.isReviewer);
  const candidates = rows.filter((r) => !r.isReviewer);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Department Reviewers"
        help="Appoint faculty in your department as reviewers (incharges). A reviewer verifies proofs and reviews submissions alongside you. Pick a faculty from the dropdown to add one. Only your own department is shown, and the change takes effect at their next sign-in."
        subtitle={`${reviewers.length} reviewer(s) in your department`}
        breadcrumbs={[{ label: 'Review Queue', to: '/reviews' }, { label: 'Department Reviewers' }]}
      />

      {/* Assign a reviewer — a dropdown of the faculty who aren't reviewers yet. */}
      <Card className="mb-4">
        <label className="block text-xs font-medium text-ink-secondary mb-1">Add a reviewer</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={candidates.length === 0}
            className="flex-1 min-w-[220px] border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-surface-muted disabled:text-ink-muted"
          >
            <option value="">
              {candidates.length === 0 ? 'All faculty are already reviewers' : 'Select faculty…'}
            </option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.employeeCode}){c.designation ? ` — ${c.designation}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addReviewer}
            disabled={!pick || busy === pick}
            className="inline-flex items-center gap-1.5 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            <Plus size={15} /> Add reviewer
          </button>
        </div>
      </Card>

      {/* Current reviewers only. */}
      {reviewers.length === 0 ? (
        <Card className="text-center py-8">
          <Users className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No reviewers yet. Add one from the dropdown above.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-5 py-2.5 font-medium">Reviewer</th>
                <th className="text-left px-5 py-2.5 font-medium">Designation</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {reviewers.map((m, i) => (
                <tr key={m.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink-primary">
                      <ShieldCheck size={13} className="text-emerald-600" />
                      {m.name} <span className="text-ink-muted font-normal">({m.employeeCode})</span>
                    </span>
                  </td>
                  <td className="px-5 py-3 text-ink-secondary">{m.designation ?? '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeReviewer(m)}
                      disabled={busy === m.id}
                      className="text-sm px-3 py-1 rounded border border-surface-border text-ink-secondary hover:bg-surface-muted disabled:opacity-50"
                    >
                      Remove
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
