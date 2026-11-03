import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { BookOpen, FileText, Award, Briefcase, Users, Download } from 'lucide-react';
import { reportApi, type AnalyticsData } from '../../api/reports';
import { userApi } from '../../api/users';
import { useAuthStore, INSTITUTE_READ_ROLES } from '../../store/authStore';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';

// Qualitative palette (brand-leaning, readable in light and dark).
const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#db2777'];

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <h2 className="text-sm font-semibold text-ink-primary mb-3 font-serif">{title}</h2>
      {children}
    </Card>
  );
}

export default function AnalyticsPage() {
  const seesAllDepts = useAuthStore((s) => s.hasAnyRole(INSTITUTE_READ_ROLES));
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [years, setYears] = useState<{ id: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([]);
  const [yearSel, setYearSel] = useState(''); // '' = current open year, 'all' = every year, else an id
  const [deptSel, setDeptSel] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const params = () => ({
    ...(yearSel === '' ? {} : { academicYearId: yearSel }),
    ...(seesAllDepts && deptSel ? { dept: deptSel } : {}),
  });

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await reportApi.analyticsExcel(params());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${data?.year?.label ?? 'all-years'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
    if (seesAllDepts) userApi.listDepartments().then(setDepartments).catch(() => {});
  }, [seesAllDepts]);

  useEffect(() => {
    setLoading(true);
    reportApi.analytics(params())
      .then(setData)
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, [yearSel, deptSel, seesAllDepts]);

  const t = data?.totals;
  const showDeptChart = (data?.byDepartment.length ?? 0) > 1;
  const indexData = useMemo(() => data?.indexBreakdown ?? [], [data]);

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={seesAllDepts ? 'Research output across the campus' : 'Research output for your department'}
        help="Published research output — journals, conference papers, patents and projects. Publications count a paper once it is Published or Indexed. Pick an academic year, or All years for the cumulative picture."
        breadcrumbs={[{ label: 'Home' }, { label: 'Analytics' }]}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {seesAllDepts && (
              <select
                value={deptSel}
                onChange={(e) => setDeptSel(e.target.value)}
                aria-label="Department"
                className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
              >
                <option value="">Whole campus</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            )}
            <select
              value={yearSel}
              onChange={(e) => setYearSel(e.target.value)}
              aria-label="Academic year"
              className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              <option value="">Current year</option>
              <option value="all">All years</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
            <button
              onClick={download}
              disabled={downloading || loading}
              className="flex items-center gap-2 bg-primary-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              title="Download the analytics as an Excel workbook"
            >
              <Download size={14} /> {downloading ? 'Exporting…' : 'Download (Excel)'}
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : !t ? (
        <Card><p className="text-sm text-ink-secondary">No data.</p></Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <StatTile icon={<BookOpen size={18} />} label="Publications" value={t.publications} color="primary" />
            <StatTile icon={<FileText size={18} />} label="Journals" value={t.journals} color="accent" />
            <StatTile icon={<FileText size={18} />} label="Conference Papers" value={t.conferences} color="accent" />
            <StatTile icon={<Award size={18} />} label="Patents" value={t.patents} color="success" />
            <StatTile icon={<Briefcase size={18} />} label="Projects" value={t.projects} color="warning" />
            <StatTile icon={<Users size={18} />} label="Faculty" value={t.faculty} color="primary" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Department-wise (campus view with >1 dept) */}
            {showDeptChart && (
              <ChartCard title="Output by department">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data!.byDepartment} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                    <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="publications" name="Publications" fill={COLORS[0]} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="patents" name="Patents" fill={COLORS[1]} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="projects" name="Projects" fill={COLORS[2]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {/* Publication type mix */}
            <ChartCard title="Publications by type">
              {data!.publicationTypes.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No published papers yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={data!.publicationTypes} dataKey="count" nameKey="type" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                      {data!.publicationTypes.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Indexing split by type — journals vs conference papers */}
            <ChartCard title="Papers by indexing (journals vs conferences)">
              {indexData.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No indexed papers yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={indexData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                    <XAxis dataKey="index" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="journals" name="Journals" fill={COLORS[0]} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="conferences" name="Conference Papers" fill={COLORS[1]} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Published journals by quartile */}
            <ChartCard title="Journals by quartile">
              {data!.quartileBreakdown.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No published journals yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data!.quartileBreakdown} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                    <XAxis dataKey="quartile" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Journals" radius={[3, 3, 0, 0]}>
                      {data!.quartileBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Patents by IPR stage */}
            <ChartCard title="Patents by stage (IPR)">
              {data!.patentStatus.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No patents yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data!.patentStatus} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                    <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Patents" radius={[3, 3, 0, 0]}>
                      {data!.patentStatus.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Publications by faculty — every faculty, side by side */}
            <ChartCard title="Publications by faculty" className="lg:col-span-2">
              {data!.facultyList.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No faculty yet.</p>
              ) : (() => {
                // Vertical columns (names along the bottom). Bar width shrinks as
                // the roster grows, so 60–70 faculty stay readable, not huge.
                const n = data!.facultyList.length;
                const barSize = n <= 15 ? 28 : n <= 30 ? 16 : n <= 50 ? 9 : 6;
                return (
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={data!.facultyList} margin={{ top: 4, right: 8, left: -16, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                      {/* No per-bar names (they pile up at scale) — a plain axis;
                          hover a bar for the faculty's name and count. */}
                      <XAxis dataKey="name" tick={false} label={{ value: 'Faculty', position: 'insideBottom', offset: -2, fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="publications" name="Publications" fill={COLORS[0]} radius={[2, 2, 0, 0]} barSize={barSize} />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
