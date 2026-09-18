import { useEffect, useMemo, useState } from 'react';
import { reportApi } from '../../api/reports';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { Users, FileText, CheckCircle2, TrendingUp, Download, XCircle } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import StatusBadge from '../../components/StatusBadge';
import CriteriaCompare from '../../components/CriteriaCompare';

export default function AdminReportsPage() {
  const [data, setData] = useState<any>(null);
  const [years, setYears] = useState<any[]>([]);
  const [yearFilter, setYearFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
    load('');
  }, []);

  const load = (yearLabel: string) => {
    setLoading(true);
    reportApi.getInstituteReport(yearLabel ? { year: yearLabel } : {})
      .then(setData)
      .catch(() => toast.error('Failed to load report'))
      .finally(() => setLoading(false));
  };

  const onYearChange = (label: string) => {
    setYearFilter(label);
    load(label);
  };

  const stats = useMemo(() => {
    if (!data) return null;
    const subs = data.submissions ?? [];
    const total = subs.length;
    const approved = subs.filter((s: any) => s.status === 'APPROVED').length;
    const rejected = subs.filter((s: any) => s.status === 'REJECTED').length;
    const submitted = subs.filter((s: any) => s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW').length;
    const grandTotals = subs.map((s: any) => s.review?.grandTotal).filter((v: any) => typeof v === 'number');
    const avgScore = grandTotals.length ? (grandTotals.reduce((a: number, b: number) => a + b, 0) / grandTotals.length) : 0;

    // Department breakdown
    const byDept: Record<string, any> = {};
    for (const s of subs) {
      const deptName = s.user?.department?.name ?? 'Unknown';
      if (!byDept[deptName]) {
        byDept[deptName] = { name: deptName, total: 0, approved: 0, rejected: 0, scores: [] };
      }
      byDept[deptName].total++;
      if (s.status === 'APPROVED') byDept[deptName].approved++;
      if (s.status === 'REJECTED') byDept[deptName].rejected++;
      if (typeof s.review?.grandTotal === 'number') byDept[deptName].scores.push(s.review.grandTotal);
    }
    const deptArr = Object.values(byDept).map((d: any) => ({
      ...d,
      avgScore: d.scores.length ? d.scores.reduce((a: number, b: number) => a + b, 0) / d.scores.length : 0,
    }));

    // Newest first; a draft that was never submitted falls back to its last edit.
    const recent = [...subs]
      .sort((a: any, b: any) =>
        new Date(b.submittedAt ?? b.updatedAt ?? 0).getTime() -
        new Date(a.submittedAt ?? a.updatedAt ?? 0).getTime())
      .slice(0, 15);

    return { total, approved, rejected, submitted, avgScore, deptArr, recent };
  }, [data]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const blob = await reportApi.exportReport({ format: 'excel', year: yearFilter || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `appraisals-${yearFilter || 'all'}.xlsx`;
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
        title="Institute Reports"
        subtitle="Aggregate statistics across all departments"
        breadcrumbs={[{ label: 'Institute' }, { label: 'Reports' }]}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={yearFilter}
              onChange={(e) => onYearChange(e.target.value)}
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

      {loading ? (
        <div className="text-sm text-ink-muted">Loading report...</div>
      ) : !stats ? (
        <Card className="text-center py-8">
          <p className="text-ink-muted text-sm">No data available.</p>
        </Card>
      ) : (
        <>
          {/* Submission overview. This used to sit on the admin dashboard; the
              maintenance admin is off appraisal content entirely, so the
              institute-wide picture belongs to the principal, who lands here. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
            <StatTile icon={<FileText size={18} />} label="Total Submissions" value={stats.total} color="primary" />
            <StatTile icon={<CheckCircle2 size={18} />} label="Approved" value={stats.approved} hint={`${stats.total ? ((stats.approved / stats.total) * 100).toFixed(0) : 0}%`} color="success" />
            <StatTile icon={<Users size={18} />} label="Pending Review" value={stats.submitted} color="warning" />
            <StatTile icon={<XCircle size={18} />} label="Rejected" value={stats.rejected} color="danger" />
            <StatTile icon={<TrendingUp size={18} />} label="Avg Grand Total" value={stats.avgScore.toFixed(1)} hint="/ 550" color="accent" />
          </div>

          {/* Recent submissions */}
          <Card padding="none" className="mb-5">
            <div className="px-5 py-3 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-ink-primary">Recent Submissions</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary-700 text-white text-xs">
                  <th className="text-left px-5 py-2 font-medium">Faculty</th>
                  <th className="text-left px-5 py-2 font-medium">Department</th>
                  <th className="text-left px-5 py-2 font-medium">Submission</th>
                  <th className="text-left px-5 py-2 font-medium">Submitted</th>
                  <th className="text-left px-5 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {stats.recent.map((s: any, i: number) => (
                  <tr key={s.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                    <td className="px-5 py-2.5 font-medium text-ink-primary">{s.user?.name ?? '—'}</td>
                    <td className="px-5 py-2.5 text-ink-secondary">{s.user?.department?.code ?? '—'}</td>
                    <td className="px-5 py-2.5 text-ink-secondary">#{s.submissionNumber}</td>
                    <td className="px-5 py-2.5 text-ink-muted text-xs">
                      {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-2.5"><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stats.recent.length === 0 && (
              <div className="p-8 text-center text-ink-muted text-sm">No submissions yet.</div>
            )}
          </Card>

          {/* Department breakdown */}
          <Card padding="none">
            <div className="px-5 py-3 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-ink-primary">Department Breakdown</h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary-700 text-white text-xs">
                  <th className="text-left px-5 py-2.5 font-medium">Department</th>
                  <th className="text-left px-5 py-2.5 font-medium">Total</th>
                  <th className="text-left px-5 py-2.5 font-medium">Approved</th>
                  <th className="text-left px-5 py-2.5 font-medium">Rejected</th>
                  <th className="text-left px-5 py-2.5 font-medium">Approval %</th>
                  <th className="text-left px-5 py-2.5 font-medium">Avg Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {stats.deptArr.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-ink-muted text-sm">No submissions yet.</td></tr>
                ) : stats.deptArr.map((d: any, i: number) => (
                  <tr key={d.name} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                    <td className="px-5 py-2.5 font-medium text-ink-primary">{d.name}</td>
                    <td className="px-5 py-2.5 text-ink-secondary">{d.total}</td>
                    <td className="px-5 py-2.5 text-success-500 font-medium">{d.approved}</td>
                    <td className="px-5 py-2.5 text-danger-500 font-medium">{d.rejected}</td>
                    <td className="px-5 py-2.5 text-ink-secondary">{d.total ? ((d.approved / d.total) * 100).toFixed(0) : 0}%</td>
                    <td className="px-5 py-2.5 text-primary-700 font-semibold">{d.avgScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <CriteriaCompare academicYearId={years.find((y) => y.label === yearFilter)?.id} />
        </>
      )}
    </div>
  );
}
