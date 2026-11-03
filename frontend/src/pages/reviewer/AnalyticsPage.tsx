import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { BookOpen, FileText, Award, Briefcase, Users } from 'lucide-react';
import { reportApi, type AnalyticsData } from '../../api/reports';
import { userApi } from '../../api/users';
import { useAuthStore, INSTITUTE_READ_ROLES } from '../../store/authStore';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';

// Qualitative palette (brand-leaning, readable in light and dark).
const COLORS = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#db2777'];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
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

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
    if (seesAllDepts) userApi.listDepartments().then(setDepartments).catch(() => {});
  }, [seesAllDepts]);

  useEffect(() => {
    setLoading(true);
    reportApi.analytics({
      ...(yearSel === '' ? {} : { academicYearId: yearSel }),
      ...(seesAllDepts && deptSel ? { dept: deptSel } : {}),
    })
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

            {/* Journal / conference index breakdown */}
            <ChartCard title="Papers by indexing">
              {indexData.length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No indexed papers yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={indexData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                    <XAxis dataKey="index" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Papers" radius={[3, 3, 0, 0]}>
                      {indexData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* Top faculty by publications */}
            <ChartCard title="Top faculty by publications">
              {data!.topFaculty.filter((f) => f.publications > 0).length === 0 ? (
                <p className="text-sm text-ink-muted py-10 text-center">No published papers yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data!.topFaculty.filter((f) => f.publications > 0)} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border, #e5e7eb)" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="publications" name="Publications" fill={COLORS[0]} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
