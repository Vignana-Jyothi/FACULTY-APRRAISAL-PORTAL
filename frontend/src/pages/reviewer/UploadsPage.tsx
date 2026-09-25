import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronRight, CheckCircle2, Clock, XCircle, AlertTriangle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import { verificationApi, type UploadsOverview } from '../../api/verification';

// Faculty-wise uploads. One row per faculty with their proof counts; clicking a
// row opens that faculty's uploads for verification.
export default function UploadsPage() {
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [data, setData] = useState<UploadsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'' | 'pending' | 'rejected' | 'done'>('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    userApi.listAcademicYears().then((ys: any[]) => {
      setYears(ys);
      const open = ys.find((y) => y.submissionOpen) ?? ys[0];
      if (open) setYearId(open.id);
    }).catch(() => toast.error('Failed to load academic years'));
  }, []);

  useEffect(() => {
    if (!yearId) return;
    setLoading(true);
    verificationApi.overview(yearId)
      .then(setData)
      .catch(() => toast.error('Failed to load uploads'))
      .finally(() => setLoading(false));
  }, [yearId]);

  const inputCls = 'border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';

  const rows = (data?.rows ?? []).filter((r) => {
    if (filter === 'pending' && r.counts.pending === 0) return false;
    if (filter === 'rejected' && r.counts.rejected === 0) return false;
    if (filter === 'done' && !(r.counts.total > 0 && r.counts.pending === 0 && r.counts.rejected === 0)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${r.faculty.name} ${r.faculty.employeeCode} ${r.faculty.department?.code ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totals = (data?.rows ?? []).reduce(
    (a, r) => ({
      uploads: a.uploads + r.counts.total,
      pending: a.pending + r.counts.pending,
      rejected: a.rejected + r.counts.rejected,
    }),
    { uploads: 0, pending: 0, rejected: 0 }
  );

  const th = 'py-2 px-2 font-semibold text-left';

  return (
    <div>
      <PageHeader
        title="Uploads"
        subtitle="Proof uploads by faculty. Open a faculty to verify their documents."
        help="Proof uploads by faculty. Open a faculty to verify their documents; rejecting a proof red-lists that submission until it is re-uploaded."
        help="Proof uploads by faculty. Open a faculty to verify their documents; rejecting a proof red-lists that submission until it is re-uploaded."
        breadcrumbs={[{ label: 'Uploads' }]}
      />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputCls}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search faculty / code / dept…"
          className={`${inputCls} min-w-[220px]`}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className={inputCls}>
          <option value="">All faculty</option>
          <option value="pending">Has pending</option>
          <option value="rejected">Has rejected</option>
          <option value="done">Fully verified</option>
        </select>
        <span className="text-xs text-ink-muted self-center">{rows.length} of {data?.rows.length ?? 0}</span>
      </div>

      {data && data.rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card><div className="text-xs text-ink-muted">Total uploads</div><div className="text-xl font-semibold text-ink-primary">{totals.uploads}</div></Card>
          <Card><div className="text-xs text-ink-muted">Pending verification</div><div className="text-xl font-semibold text-amber-600">{totals.pending}</div></Card>
          <Card><div className="text-xs text-ink-muted">Rejected</div><div className="text-xl font-semibold text-red-600">{totals.rejected}</div></Card>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><div className="text-sm text-ink-muted py-6 text-center">No faculty uploads found.</div></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
                <th className={th}>Faculty</th>
                <th className={th}>Department</th>
                <th className={th}>Uploads</th>
                <th className={th}>Verified</th>
                <th className={th}>Pending</th>
                <th className={th}>Rejected</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.submissionId}
                  onClick={() => navigate(`/uploads/${r.submissionId}`)}
                  className="border-b border-surface-border/60 hover:bg-surface-muted/40 cursor-pointer"
                >
                  <td className="py-2 px-2">
                    <div className="font-medium text-ink-primary flex items-center gap-2">
                      {r.faculty.name}
                      {r.redListed && <AlertTriangle size={13} className="text-red-500" />}
                    </div>
                    <div className="text-xs text-ink-muted">{r.faculty.employeeCode}</div>
                  </td>
                  <td className="py-2 px-2 text-ink-secondary">{r.faculty.department?.code ?? '—'}</td>
                  <td className="py-2 px-2 font-medium text-ink-primary">{r.counts.total}</td>
                  <td className="py-2 px-2">
                    <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} />{r.counts.verified}</span>
                  </td>
                  <td className="py-2 px-2">
                    {r.counts.pending > 0
                      ? <span className="inline-flex items-center gap-1 text-amber-600"><Clock size={13} />{r.counts.pending}</span>
                      : <span className="text-ink-muted">0</span>}
                  </td>
                  <td className="py-2 px-2">
                    {r.counts.rejected > 0
                      ? <span className="inline-flex items-center gap-1 text-red-600"><XCircle size={13} />{r.counts.rejected}</span>
                      : <span className="text-ink-muted">0</span>}
                  </td>
                  <td className="py-2 px-2 text-ink-muted"><ChevronRight size={15} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
