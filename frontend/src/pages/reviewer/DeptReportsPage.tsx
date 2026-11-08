import { useEffect, useMemo, useState } from 'react';
import { reportApi } from '../../api/reports';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { Users, CheckCircle2, Clock, TrendingUp, Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import CriteriaCompare from '../../components/CriteriaCompare';
import ConsolidatedFacultyTable from '../../components/ConsolidatedFacultyTable';
import { trackingApi, type TrackingRow } from '../../api/tracking';
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
  const [exporting, setExporting] = useState(false);
  const [exportingForm, setExportingForm] = useState(false);
  const [quarter, setQuarter] = useState('Q1');
  const [exportingQuarter, setExportingQuarter] = useState(false);
  const [exportingIqac, setExportingIqac] = useState(false);

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
    if (seesAllDepts) userApi.listDepartments().then(setDepartments).catch(() => {});
  }, [seesAllDepts]);

  useEffect(() => {
    reportApi.getDeptReport({
      ...(yearFilter ? { year: yearFilter } : {}),
      ...(seesAllDepts && deptFilter ? { dept: deptFilter } : {}),
    })
      .then(setReviews)
      .catch(() => toast.error('Failed to load department report'));
  }, [yearFilter, deptFilter, seesAllDepts]);

  const canAllocateTier = useAuthStore((s) => s.canAllocateTier);
  const yearId = years.find((y) => y.label === yearFilter)?.id as string | undefined;
  const [trackRows, setTrackRows] = useState<TrackingRow[]>([]);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackTick, setTrackTick] = useState(0);

  useEffect(() => {
    if (!yearId) { setTrackRows([]); return; }
    setTrackLoading(true);
    trackingApi.get(yearId)
      .then((d) => setTrackRows(d.rows))
      .catch(() => toast.error('Failed to load consolidated report'))
      .finally(() => setTrackLoading(false));
  }, [yearId, trackTick]);

  const handleSetTier = async (userId: string, tier: string | null, reason?: string | null) => {
    if (!yearId) return;
    try {
      await trackingApi.setTier(userId, yearId, tier as any, reason);
      setTrackTick((n) => n + 1);
    } catch {
      toast.error('Failed to set tier');
    }
  };

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

  // The institute's consolidated appraisal form, one row per faculty, for a
  // single department. The dean/principal must pick a department first; a HoD
  // always gets their own (Tier/Eligibility columns are hidden for them).
  const exportAppraisalForm = async () => {
    if (seesAllDepts && !deptFilter) { toast.error('Pick a department first'); return; }
    setExportingForm(true);
    try {
      const academicYearId = years.find((y) => y.label === yearFilter)?.id;
      const blob = await reportApi.appraisalExcel({ dept: deptParam, academicYearId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `appraisal-form-${deptCode ? `${deptCode}-` : ''}${yearFilter || 'current'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExportingForm(false);
    }
  };

  // Quarterly review summary PDF for the chosen quarter — each faculty's
  // snapshot plus the HoD's issued quarterly feedback.
  const exportQuarterly = async () => {
    if (seesAllDepts && !deptFilter) { toast.error('Pick a department first'); return; }
    setExportingQuarter(true);
    try {
      const academicYearId = years.find((y) => y.label === yearFilter)?.id;
      const blob = await reportApi.quarterlySummaryPdf({ period: quarter, dept: deptParam, academicYearId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quarterly-${quarter}-${deptCode ? `${deptCode}-` : ''}${yearFilter || 'current'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExportingQuarter(false);
    }
  };

  // Quarterly summary (Excel) — Emp ID, Name, Targets Achieved, HoD Review.
  const exportIqac = async () => {
    if (seesAllDepts && !deptFilter) { toast.error('Pick a department first'); return; }
    setExportingIqac(true);
    try {
      const academicYearId = years.find((y) => y.label === yearFilter)?.id;
      const blob = await reportApi.iqacExcel({ period: quarter, dept: deptParam, academicYearId });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quarterly-summary-${quarter}-${deptCode ? `${deptCode}-` : ''}${yearFilter || 'current'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExportingIqac(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Department Reports"
        help="Your department’s statistics. Pick a criterion to rank your faculty and export the table as CSV."
        subtitle={seesAllDepts ? 'Reviewed appraisals — all departments, or pick one' : 'Reviewed appraisals in your department'}
        breadcrumbs={[{ label: 'Home' }, { label: 'Department Reports' }]}
      />

      {/* Report downloads + filters. A full-width toolbar that wraps, so no
          button is pushed off-screen as the report list grows (it did when this
          sat in the header's non-wrapping actions slot). */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
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
              <Download size={14} /> {exporting ? 'Exporting...' : 'Scores (Criteria-wise)'}
            </button>
            <button
              onClick={exportAppraisalForm}
              disabled={exportingForm}
              className="flex items-center gap-2 border border-primary-600 text-primary-700 px-3 py-2 rounded text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
              title="Consolidated appraisal (one row per faculty) in the institute's output format"
            >
              <Download size={14} /> {exportingForm ? 'Exporting...' : 'Consolidated (Excel)'}
            </button>
            <select
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              aria-label="Quarter"
              className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
              <option value="ANNUAL">Annual</option>
            </select>
            <button
              onClick={exportQuarterly}
              disabled={exportingQuarter}
              className="flex items-center gap-2 border border-primary-600 text-primary-700 px-3 py-2 rounded text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
              title="Quarterly review summary (snapshot + issued HoD feedback) for all faculty, as a PDF"
            >
              <Download size={14} /> {exportingQuarter ? 'Exporting...' : 'Quarterly Summary (PDF)'}
            </button>
            <button
              onClick={exportIqac}
              disabled={exportingIqac}
              className="flex items-center gap-2 border border-primary-600 text-primary-700 px-3 py-2 rounded text-sm font-medium hover:bg-primary-50 disabled:opacity-50"
              title="Quarterly summary (Emp ID, Name, Targets Achieved, HoD Review) for the selected quarter, as Excel"
            >
              <Download size={14} /> {exportingIqac ? 'Exporting...' : 'Quarterly Summary (Excel)'}
            </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatTile icon={<Users size={18} />} label="Reviewed" value={stats.total} color="primary" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Approved" value={stats.approved} hint={`${stats.total ? ((stats.approved / stats.total) * 100).toFixed(0) : 0}%`} color="success" />
        <StatTile icon={<Clock size={18} />} label="Pending Decision" value={stats.pending} color="warning" />
        <StatTile
          icon={<TrendingUp size={18} />}
          label={showGrand ? 'Avg Grand Total' : 'Avg Reviewed Total'}
          value={stats.avgScore.toFixed(2)}
          hint={showGrand ? '/ 550' : '/ 500'}
          color="accent"
        />
      </div>

      <h2 className="text-sm font-semibold text-ink-primary mb-2">Consolidated Faculty Report</h2>
      <div className="mb-5">
        {!yearId ? (
          <Card className="text-center py-8"><p className="text-ink-muted text-sm">Select an academic year to view the consolidated report.</p></Card>
        ) : trackLoading ? (
          <div className="text-sm text-ink-muted">Loading...</div>
        ) : (
          <ConsolidatedFacultyTable rows={trackRows} canAllocate={canAllocateTier()} onSetTier={handleSetTier} />
        )}
      </div>

      <CriteriaCompare academicYearId={years.find((y) => y.label === yearFilter)?.id} dept={deptParam} />
    </div>
  );
}
