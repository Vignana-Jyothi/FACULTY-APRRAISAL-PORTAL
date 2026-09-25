import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { appraisalApi, adminApi } from '../../api/appraisals';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { FileText, Unlock, Search, UserCheck, RotateCcw } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatusBadge from '../../components/StatusBadge';
import AssignReviewerModal from '../../components/AssignReviewerModal';
import Pagination from '../../components/Pagination';
import { SkeletonTable } from '../../components/Skeleton';

const PAGE_SIZE = 50;

const STATUS_OPTIONS = ['', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FINAL_REVIEW', 'HOLD', 'APPROVED', 'REJECTED'];

export default function AdminAppraisalsPage() {
  const [appraisals, setAppraisals] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [assignTarget, setAssignTarget] = useState<any>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const load = () => {
    setLoading(true);
    const params: Record<string, string> = { limit: String(PAGE_SIZE), offset: String(offset) };
    if (yearFilter) params.year = yearFilter;
    if (statusFilter) params.status = statusFilter;
    appraisalApi.list(params)
      .then((r: any) => {
        if (Array.isArray(r)) { setAppraisals(r); setTotal(r.length); }
        else { setAppraisals(r.rows); setTotal(r.total); }
      })
      .catch(() => toast.error('Failed to load appraisals'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [yearFilter, statusFilter, offset]);

  useEffect(() => {
    // Reset to page 1 on filter change
    setOffset(0);
  }, [yearFilter, statusFilter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return appraisals;
    const q = search.toLowerCase();
    return appraisals.filter((a) =>
      (a.user?.name ?? '').toLowerCase().includes(q) ||
      (a.user?.employeeCode ?? '').toLowerCase().includes(q)
    );
  }, [appraisals, search]);

  const reopenReview = async (id: string) => {
    const reason = window.prompt(
      'Reopen this appraisal for the HoD to review again?\n\n' +
      'The faculty form stays locked and their data is untouched. Any final-review sign-offs are reset.\n\n' +
      'Reason (recorded in the audit log):'
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      toast.error('A reason is required');
      return;
    }
    try {
      await adminApi.reopenReview(id, reason.trim());
      toast.success('Reopened for review');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    }
  };

  const unlock = async (id: string) => {
    if (!confirm('Unlock this submission? Faculty will be able to edit again.')) return;
    try {
      await adminApi.unlock(id);
      toast.success('Unlocked');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    }
  };

  return (
    <div>
      <AssignReviewerModal
        open={!!assignTarget}
        submission={assignTarget}
        onClose={() => setAssignTarget(null)}
        onAssigned={load}
      />

      <PageHeader
        title="All Appraisals"
        help="Every faculty submission institute-wide. Filter by department or status, assign scrutinizers for the final review, send one back to the HoD, or unlock a locked form for faculty edits."
        help="Every faculty submission institute-wide. Filter by department or status, assign scrutinizers for the final review, send one back to the HoD, or unlock a locked form for faculty edits."
        subtitle={`${filtered.length} submission(s)`}
        breadcrumbs={[{ label: 'All Appraisals' }]}
      />

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">Academic Year</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              <option value="">All Years</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'All Statuses'}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-ink-secondary mb-1">Search Faculty</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or code..."
                className="w-full pl-9 border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <SkeletonTable rows={8} cols={8} />
      ) : filtered.length === 0 ? (
        <Card className="text-center py-8">
          <FileText className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No appraisals match filters.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-4 py-2.5 font-medium">Faculty</th>
                <th className="text-left px-4 py-2.5 font-medium">Code</th>
                <th className="text-left px-4 py-2.5 font-medium">Department</th>
                <th className="text-left px-4 py-2.5 font-medium">Year</th>
                <th className="text-left px-4 py-2.5 font-medium">Submission</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Submitted</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {filtered.map((a: any, i: number) => (
                <tr key={a.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-4 py-2.5 font-medium text-ink-primary">{a.user?.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-secondary">{a.user?.employeeCode}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{a.user?.department?.code ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">{a.academicYear?.label}</td>
                  <td className="px-4 py-2.5 text-ink-secondary">#{a.submissionNumber}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/appraisal/${a.id}`}
                        className="text-sm text-primary-600 hover:underline font-medium"
                      >
                        View
                      </Link>
                      {['SUBMITTED', 'UNDER_REVIEW', 'HOLD', 'APPROVED', 'FINAL_REVIEW'].includes(a.status) && (
                        <button
                          onClick={() => setAssignTarget(a)}
                          className="flex items-center gap-1 text-xs text-primary-600 border border-primary-200 bg-primary-50 px-2 py-0.5 rounded hover:bg-primary-100"
                          title="Assign scrutinizers for the final review"
                        >
                          <UserCheck size={11} /> {a.status === 'FINAL_REVIEW' ? 'Reassign' : 'Assign'}
                        </button>
                      )}
                      {(a.status === 'APPROVED' || a.status === 'REJECTED' || a.status === 'FINAL_REVIEW') && (
                        <button
                          onClick={() => reopenReview(a.id)}
                          className="flex items-center gap-1 text-xs text-accent-600 border border-accent-500/40 px-2 py-0.5 rounded hover:bg-surface-muted"
                          title="Send back to the HoD for re-review (faculty form stays locked)"
                        >
                          <RotateCcw size={11} /> Reopen
                        </button>
                      )}
                      {(a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW' || a.status === 'APPROVED' || a.status === 'REJECTED') && (
                        <button
                          onClick={() => unlock(a.id)}
                          className="flex items-center gap-1 text-xs text-ink-secondary border border-surface-border px-2 py-0.5 rounded hover:bg-surface-muted"
                          title="Unlock for faculty edits"
                        >
                          <Unlock size={11} /> Unlock
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
        </Card>
      )}
    </div>
  );
}
