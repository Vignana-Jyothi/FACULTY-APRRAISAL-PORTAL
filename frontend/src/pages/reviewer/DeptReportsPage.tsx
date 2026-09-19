import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportApi } from '../../api/reports';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { Users, CheckCircle2, Clock, TrendingUp, Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import CriteriaCompare from '../../components/CriteriaCompare';
import FacultyUploadsButton from '../../components/FacultyUploadsButton';
import { useAuthStore, INSTITUTE_READ_ROLES } from '../../store/authStore';

// A HoD reads their own department only (the server holds them to it). The
// dean and principal read institute-wide and get a department picker, which is
// passed through as ?dept= to /reports/department, /criteria and /export.
export default function DeptReportsPage() {
  const seesAllDepts = useAuthStore((s) => s.hasAnyRole(INSTITUTE_READ_ROLES));
  // Cat 6 and the /550 are stripped server-side for the dean; label the
  // average and hide the Cat 6 columns rather than show zeros.
  const showGrand = useAuthStore((s) => s.canSeeCoreValues());
  const [reviews, setReviews] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([]);
  const [yearFilter, setYearFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
    if (seesAllDepts) userApi.listDepartments().then(setDepartments).catch(() => {});
  }, [seesAllDepts]);

  useEffect(() => {
    setLoading(true);
    reportApi.getDeptReport({
      ...(yearFilter ? { year: yearFilter } : {}),
      ...(seesAllDepts && deptFilter ? { dept: deptFilter } : {}),
    })
      .then(setReviews)
      .catch(() => toast.error('Failed to load department report'))
      .finally(() => setLoading(false));
  }, [yearFilter, deptFilter, seesAllDepts]);

  const deptParam = seesAllDepts && deptFilter ? deptFilter : undefined;
  const deptCode = departments.find((d) => d.id === deptFilter)?.code;

  const stats = useMemo(() => {
    const total = reviews.length;
    const approved = reviews.filter((r) => r.status === 'APPROVED').length;
    const rejected = reviews.filter((r) => r.status === 'REJECTED').length;
    const pending = total - approved - rejected;
    const totals = reviews.map((r) => (showGrand ? r.grandTotal : r.totalScore)).filter((v) => typeof v === 'number');
    const avgScore = totals.length ? (totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
    return { total, approved, rejected, pending, avgScore };
  }, [reviews, showGrand]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const blob = await reportApi.exportReport({ format: 'excel', year: yearFilter || undefined, dept: deptParam });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dept-appraisals-${deptCode ? `${deptCode}-` : ''}${yearFilter || 'all'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Department Reports"
        subtitle={seesAllDepts ? 'Reviewed appraisals — all departments, or pick one' : 'Reviewed appraisals in your department'}
        breadcrumbs={[{ label: 'Home' }, { label: 'Department Reports' }]}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {seesAllDepts && (
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                aria-label="Department"
                className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
              >
                <option value="">All Departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            )}
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              aria-label="Academic year"
              className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              <option value="">All Years</option>
              {years.map((y) => <option key={y.id} value={y.label}>{y.label}</option>)}
            </select>
            <button
              onClick={exportExcel}
              disabled={exporting}
              className="flex items-center gap-2 bg-primary-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              <Download size={14} /> {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatTile icon={<Users size={18} />} label="Reviewed" value={stats.total} color="primary" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Approved" value={stats.approved} hint={`${stats.total ? ((stats.approved / stats.total) * 100).toFixed(0) : 0}%`} color="success" />
        <StatTile icon={<Clock size={18} />} label="Pending Decision" value={stats.pending} color="warning" />
        <StatTile
          icon={<TrendingUp size={18} />}
          label={showGrand ? 'Avg Grand Total' : 'Avg Reviewed Total'}
          value={stats.avgScore.toFixed(1)}
          hint={showGrand ? '/ 550' : '/ 500'}
          color="accent"
        />
      </div>

      {loading ? (
        <div className="text-sm text-ink-muted">Loading...</div>
      ) : reviews.length === 0 ? (
        <Card className="text-center py-8">
          <p className="text-ink-muted text-sm">No reviewed appraisals yet.</p>
        </Card>
      ) : (
        <Card padding="none">
          <div className="px-5 py-3 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-ink-primary">Faculty-wise Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary-700 text-white text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">Faculty</th>
                  {seesAllDepts && <th className="text-left px-4 py-2.5 font-medium">Dept</th>}
                  <th className="text-left px-4 py-2.5 font-medium">Designation</th>
                  <th className="text-left px-3 py-2.5 font-medium">C1</th>
                  <th className="text-left px-3 py-2.5 font-medium">C2</th>
                  <th className="text-left px-3 py-2.5 font-medium">C3</th>
                  <th className="text-left px-3 py-2.5 font-medium">C4</th>
                  <th className="text-left px-3 py-2.5 font-medium">C5</th>
                  <th className="text-left px-3 py-2.5 font-medium">Total</th>
                  {showGrand && <th className="text-left px-3 py-2.5 font-medium">Score by HoD</th>}
                  {showGrand && <th className="text-left px-3 py-2.5 font-medium">Reviewed</th>}
                  <th className="text-left px-4 py-2.5 font-medium">Uploads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {reviews.map((r, i) => {
                  const cat6 = (r.cat6Punctuality ?? 0) + (r.cat6Professionalism ?? 0) + (r.cat6Willingness ?? 0) + (r.cat6Cordiality ?? 0) + (r.cat6Classroom ?? 0);
                  const fmt = (n: any) => (typeof n === 'number' ? n.toFixed(1) : '—');
                  return (
                    <tr key={r.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                      <td className="px-4 py-2.5">
                        <Link to={`/appraisal/${r.submissionId}`} className="font-medium text-primary-700 hover:underline">
                          {r.submission?.user?.name}
                        </Link>
                        <div className="font-mono text-[11px] text-ink-muted">{r.submission?.user?.employeeCode}</div>
                      </td>
                      {seesAllDepts && <td className="px-4 py-2.5 text-ink-secondary">{r.submission?.user?.department?.code ?? '—'}</td>}
                      <td className="px-4 py-2.5 text-ink-secondary">{r.submission?.user?.designation ?? '—'}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{fmt(r.cat1Score)}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{fmt(r.cat2Score)}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{fmt(r.cat3Score)}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{fmt(r.cat4Score)}</td>
                      <td className="px-3 py-2.5 text-ink-secondary">{fmt(r.cat5Score)}</td>
                      <td className="px-3 py-2.5 font-medium text-ink-primary">{fmt(r.totalScore)}</td>
                      {showGrand && <td className="px-3 py-2.5 text-ink-secondary">{cat6.toFixed(1)}</td>}
                      {showGrand && <td className="px-3 py-2.5 text-primary-700 font-semibold">{fmt(r.grandTotal)}</td>}
                      <td className="px-4 py-2.5">
                        <FacultyUploadsButton submissionId={r.submissionId} facultyName={r.submission?.user?.name ?? 'Faculty'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CriteriaCompare academicYearId={years.find((y) => y.label === yearFilter)?.id} dept={deptParam} />
    </div>
  );
}
