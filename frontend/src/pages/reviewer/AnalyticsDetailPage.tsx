import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Download } from 'lucide-react';
import { reportApi, type AnalyticsDetail, type AnalyticsDetailType, type AnalyticsDetailParams } from '../../api/reports';
import { userApi } from '../../api/users';
import { useAuthStore, INSTITUTE_READ_ROLES } from '../../store/authStore';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';

const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#db2777'];

type Col = { header: string; key: string };
type ChartDef = { key: string; title: string };
const CONFIG: Record<AnalyticsDetailType, { title: string; statuses: string[]; cols: Col[]; charts: ChartDef[] }> = {
  publications: {
    title: 'Publications',
    statuses: ['Published', 'Indexed'],
    cols: [
      { header: 'Faculty', key: 'faculty' }, { header: 'Dept', key: 'department' }, { header: 'Type', key: 'type' },
      { header: 'Title', key: 'title' }, { header: 'Journal / Conference', key: 'venue' }, { header: 'Date', key: 'date' },
      { header: 'Status', key: 'status' }, { header: 'Indexed', key: 'indexed' }, { header: 'Quartile', key: 'quartile' },
    ],
    charts: [
      { key: 'byType', title: 'By type' }, { key: 'byIndex', title: 'By indexing' },
      { key: 'byQuartile', title: 'By quartile' }, { key: 'byDepartment', title: 'By department' },
    ],
  },
  patents: {
    title: 'Patents',
    statuses: ['Filed', 'Published', 'Granted'],
    cols: [
      { header: 'Faculty', key: 'faculty' }, { header: 'Dept', key: 'department' }, { header: 'Title', key: 'title' },
      { header: 'IPR Type', key: 'iprType' }, { header: 'Status', key: 'status' }, { header: 'Country', key: 'country' }, { header: 'Date', key: 'date' },
    ],
    charts: [
      { key: 'byStage', title: 'By stage (IPR)' }, { key: 'byIprType', title: 'By IPR type' }, { key: 'byDepartment', title: 'By department' },
    ],
  },
  projects: {
    title: 'Projects',
    statuses: ['Applied', 'Ongoing', 'Completed'],
    cols: [
      { header: 'Faculty', key: 'faculty' }, { header: 'Dept', key: 'department' }, { header: 'Title', key: 'title' },
      { header: 'Funding Agency', key: 'fundingAgency' }, { header: 'Amount (Lakhs)', key: 'amountLakhs' }, { header: 'Role', key: 'role' },
      { header: 'Status', key: 'status' }, { header: 'Date', key: 'date' },
    ],
    charts: [
      { key: 'byStatus', title: 'By status' }, { key: 'byDepartment', title: 'By department' },
    ],
  },
};

function MiniBar({ data }: { data: { label: string; count: number }[] }) {
  if (!data || data.length === 0) return <p className="text-xs text-ink-muted py-8 text-center">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function AnalyticsDetailPage() {
  const { type: rawType } = useParams<{ type: string }>();
  const type = (['publications', 'patents', 'projects'].includes(rawType ?? '') ? rawType : 'publications') as AnalyticsDetailType;
  const cfg = CONFIG[type];
  const seesAllDepts = useAuthStore((s) => s.hasAnyRole(INSTITUTE_READ_ROLES));

  const [data, setData] = useState<AnalyticsDetail | null>(null);
  const [years, setYears] = useState<{ id: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [yearSel, setYearSel] = useState('');
  const [deptSel, setDeptSel] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const params = (): AnalyticsDetailParams => ({
    type,
    ...(from ? { from } : {}), ...(to ? { to } : {}), ...(status ? { status } : {}),
    ...(yearSel ? { academicYearId: yearSel } : {}),
    ...(seesAllDepts && deptSel ? { dept: deptSel } : {}),
  });

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
    if (seesAllDepts) userApi.listDepartments().then(setDepartments).catch(() => {});
  }, [seesAllDepts]);

  // Reset status when switching type (the options differ).
  useEffect(() => { setStatus(''); }, [type]);

  useEffect(() => {
    setLoading(true);
    reportApi.analyticsDetail(params())
      .then(setData)
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, from, to, status, yearSel, deptSel, seesAllDepts]);

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await reportApi.analyticsDetailExcel(params());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${type}${from || to ? `-${from || 'start'}_to_${to || 'end'}` : ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const items = data?.items ?? [];
  const funding = useMemo(() => (type === 'projects' ? (data?.charts?.totalFundingLakhs as number | undefined) : undefined), [data, type]);
  const inputCls = 'border border-surface-border rounded px-3 py-2 text-sm bg-surface-base';

  return (
    <div>
      <PageHeader
        title={`Analytics — ${cfg.title}`}
        subtitle={seesAllDepts ? 'Campus-wide, filter by date window and status' : 'Your department, filter by date window and status'}
        help="Pick a date window and a status. Only items whose relevant date (publication date for papers; filing / publication / grant date for patents; application / grant date for projects) falls inside the window are shown. Download gives exactly the filtered rows."
        breadcrumbs={[{ label: 'Home' }, { label: 'Analytics' }, { label: cfg.title }]}
        actions={
          <button
            onClick={download}
            disabled={downloading || loading}
            className="flex items-center gap-2 bg-primary-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            <Download size={14} /> {downloading ? 'Exporting…' : 'Download (Excel)'}
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <label className="text-xs text-ink-secondary">From date
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`block mt-1 ${inputCls}`} />
        </label>
        <label className="text-xs text-ink-secondary">To date
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`block mt-1 ${inputCls}`} />
        </label>
        <label className="text-xs text-ink-secondary">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`block mt-1 ${inputCls}`}>
            <option value="">All</option>
            {cfg.statuses.map((s) => <option key={s} value={s.toUpperCase()}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-secondary">Year
          <select value={yearSel} onChange={(e) => setYearSel(e.target.value)} className={`block mt-1 ${inputCls}`}>
            <option value="">Current year</option>
            <option value="all">All years</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          </select>
        </label>
        {seesAllDepts && (
          <label className="text-xs text-ink-secondary">Department
            <select value={deptSel} onChange={(e) => setDeptSel(e.target.value)} className={`block mt-1 ${inputCls}`}>
              <option value="">Whole campus</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
            </select>
          </label>
        )}
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); }} className="text-xs text-primary-700 hover:underline pb-2">Clear dates</button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-5">
            <StatTile icon={<Download size={18} />} label={`${cfg.title} found`} value={items.length} color="primary" />
            {funding !== undefined && <StatTile icon={<Download size={18} />} label="Total funding (Lakhs)" value={funding} color="success" />}
          </div>

          {/* Table */}
          <Card className="mb-5 overflow-x-auto">
            {items.length === 0 ? (
              <p className="text-sm text-ink-muted py-6 text-center">No {cfg.title.toLowerCase()} match these filters.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b border-surface-border">
                    {cfg.cols.map((c) => <th key={c.key} className="py-2 pr-3 font-medium whitespace-nowrap">{c.header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-b border-surface-border/60">
                      {cfg.cols.map((c) => <td key={c.key} className="py-2 pr-3 text-ink-secondary align-top">{String(it[c.key] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Charts below the table. "By department" is campus-only — a HoD sees
              a single department, so it carries no comparison for them. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {cfg.charts.filter((ch) => ch.key !== 'byDepartment' || (data?.scope === 'campus')).map((ch) => (
              <Card key={ch.key}>
                <h2 className="text-sm font-semibold text-ink-primary mb-3 font-serif">{ch.title}</h2>
                <MiniBar data={(data?.charts?.[ch.key] as { label: string; count: number }[]) ?? []} />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
