import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import Card from './Card';
import FacultyUploadsButton from './FacultyUploadsButton';
import { reportApi, type CriteriaReport, type CriteriaRow } from '../api/reports';
import { useAuthStore } from '../store/authStore';

type Crit = { group: string; key: string; label: string; max?: number; get: (r: CriteriaRow) => number | null };

// Category totals + every subsection from the scoringEngine breakdown.
const CATALOG: Crit[] = [
  { group: 'Totals', key: 'grand', label: 'Grand Total (reviewed)', max: 550, get: (r) => r.grandTotal },
  { group: 'Totals', key: 'self', label: 'Self Total', max: 500, get: (r) => r.breakdown.selfTotal },
  { group: 'Totals', key: 'c1t', label: 'Cat 1 — Teaching (total)', max: 150, get: (r) => r.breakdown.cat1.total },
  { group: 'Totals', key: 'c2t', label: 'Cat 2 — Research (total)', max: 150, get: (r) => r.breakdown.cat2.total },
  { group: 'Totals', key: 'c3t', label: 'Cat 3 — Development (total)', max: 100, get: (r) => r.breakdown.cat3.total },
  { group: 'Totals', key: 'c4t', label: 'Cat 4 — Governance (total)', max: 50, get: (r) => r.breakdown.cat4.total },
  { group: 'Totals', key: 'c5t', label: 'Cat 5 — Supplementary (total)', max: 50, get: (r) => r.breakdown.cat5.total },

  { group: 'Cat 1 — Teaching', key: 'c1_lectures', label: 'Lectures', get: (r) => r.breakdown.cat1.lectures },
  { group: 'Cat 1 — Teaching', key: 'c1_attn', label: 'Attendance / Feedback / Results', get: (r) => r.breakdown.cat1.attendanceFeedback },
  { group: 'Cat 1 — Teaching', key: 'c1_proj', label: 'Projects', get: (r) => r.breakdown.cat1.projects },
  { group: 'Cat 1 — Teaching', key: 'c1_econ', label: 'e-Content', get: (r) => r.breakdown.cat1.eContent },
  { group: 'Cat 1 — Teaching', key: 'c1_ict', label: 'ICT', get: (r) => r.breakdown.cat1.ict },

  { group: 'Cat 2 — Research', key: 'c2_pub', label: 'Publications', get: (r) => r.breakdown.cat2.publications },
  { group: 'Cat 2 — Research', key: 'c2_cit', label: 'Citations', get: (r) => r.breakdown.cat2.citations },
  { group: 'Cat 2 — Research', key: 'c2_books', label: 'Books', get: (r) => r.breakdown.cat2.books },
  { group: 'Cat 2 — Research', key: 'c2_pat', label: 'Patents', get: (r) => r.breakdown.cat2.patents },
  { group: 'Cat 2 — Research', key: 'c2_spon', label: 'Sponsored Projects', get: (r) => r.breakdown.cat2.sponsoredProjects },
  { group: 'Cat 2 — Research', key: 'c2_cons', label: 'Consultancy', get: (r) => r.breakdown.cat2.consultancy },
  { group: 'Cat 2 — Research', key: 'c2_guid', label: 'Guidance', get: (r) => r.breakdown.cat2.guidance },
  { group: 'Cat 2 — Research', key: 'c2_rg', label: 'Research Groups', get: (r) => r.breakdown.cat2.researchGroups },
  { group: 'Cat 2 — Research', key: 'c2_link', label: '2.9 Institute & Industry Linkages', get: (r) => r.breakdown.cat2.linkages },
  { group: 'Cat 2 — Research', key: 'c2_start', label: '2.10 Innovation / Start-ups', get: (r) => r.breakdown.cat2.startups },

  { group: 'Cat 3 — Development', key: 'c3_aq', label: 'Advanced Qualification', get: (r) => r.breakdown.cat3.advQual },
  { group: 'Cat 3 — Development', key: 'c3_org', label: 'Organised Programs', get: (r) => r.breakdown.cat3.organisedPrograms },
  { group: 'Cat 3 — Development', key: 'c3_rp', label: 'Resource Person', get: (r) => r.breakdown.cat3.resourcePerson },
  { group: 'Cat 3 — Development', key: 'c3_ed', label: 'Editorial', get: (r) => r.breakdown.cat3.editorial },
  { group: 'Cat 3 — Development', key: 'c3_tr', label: 'Training', get: (r) => r.breakdown.cat3.training },
  { group: 'Cat 3 — Development', key: 'c3_travel', label: 'International Travel', get: (r) => r.breakdown.cat3.intlTravel },

  { group: 'Cat 4 — Governance', key: 'c4_admin', label: 'Admin Responsibilities', get: (r) => r.breakdown.cat4.adminResp },
  { group: 'Cat 4 — Governance', key: 'c4_stud', label: 'Student Activities', get: (r) => r.breakdown.cat4.studentActivities },

  { group: 'Cat 5 — Supplementary', key: 'c5_mem', label: 'Memberships', get: (r) => r.breakdown.cat5.memberships },
  { group: 'Cat 5 — Supplementary', key: 'c5_aw', label: 'Awards', get: (r) => r.breakdown.cat5.awards },
  { group: 'Cat 5 — Supplementary', key: 'c5_diff', label: 'Differentiators', get: (r) => r.breakdown.cat5.differentiators },
  { group: 'Cat 5 — Supplementary', key: 'c5_int', label: 'Internships', get: (r) => r.breakdown.cat5.internships },
];

export default function CriteriaCompare({ academicYearId }: { academicYearId?: string }) {
  const [data, setData] = useState<CriteriaReport | null>(null);
  const [loading, setLoading] = useState(true);
  // The grand total carries Category 6, so the server nulls it for anyone who
  // may not see core values — offering it as a criterion would rank everyone
  // blank. Drop it from the catalogue instead.
  const canSeeCoreValues = useAuthStore((s) => s.canSeeCoreValues);
  const showGrand = canSeeCoreValues();
  const catalog = useMemo(
    () => (showGrand ? CATALOG : CATALOG.filter((c) => c.key !== 'grand')),
    [showGrand],
  );
  const groups = useMemo(() => Array.from(new Set(catalog.map((c) => c.group))), [catalog]);
  const [key, setKey] = useState(showGrand ? 'grand' : 'self');

  useEffect(() => {
    setLoading(true);
    reportApi
      .getCriteria(academicYearId ? { academicYearId } : {})
      .then(setData)
      .catch(() => toast.error('Failed to load criteria report'))
      .finally(() => setLoading(false));
  }, [academicYearId]);

  const crit = catalog.find((c) => c.key === key) ?? catalog[0];

  const ranked = useMemo(() => {
    if (!data) return [];
    return data.rows
      .map((r) => ({ r, v: crit.get(r) }))
      .sort((a, b) => (typeof b.v === 'number' ? b.v : -1) - (typeof a.v === 'number' ? a.v : -1));
  }, [data, crit]);

  const exportCsv = () => {
    if (!data) return;
    const head = ['Rank', 'Faculty', 'Code', 'Department', crit.label];
    const lines = ranked.map(({ r, v }, i) => [
      i + 1,
      `"${r.faculty.name.replace(/"/g, '""')}"`,
      r.faculty.employeeCode,
      `"${(r.faculty.department?.name ?? '').replace(/"/g, '""')}"`,
      typeof v === 'number' ? v : '',
    ].join(','));
    const csv = [head.join(','), ...lines].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `criteria-${crit.key}-${data.year.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectCls = 'border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <Card padding="none" className="mt-5">
      <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-ink-primary">Compare by criterion</h2>
        <div className="flex items-center gap-2">
          <select value={key} onChange={(e) => setKey(e.target.value)} className={selectCls}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {catalog.filter((c) => c.group === g).map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            onClick={exportCsv}
            disabled={!data || data.rows.length === 0}
            className="flex items-center gap-2 border border-surface-border text-ink-secondary px-3 py-2 rounded text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
          >
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-6 text-sm text-ink-muted">Loading…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="px-5 py-6 text-sm text-ink-muted text-center">No submissions for this year.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-primary-700 text-white text-xs">
              <th className="text-left px-4 py-2.5 font-medium">#</th>
              <th className="text-left px-4 py-2.5 font-medium">Faculty</th>
              <th className="text-left px-4 py-2.5 font-medium">Code</th>
              <th className="text-left px-4 py-2.5 font-medium">Department</th>
              <th className="text-left px-4 py-2.5 font-medium">{crit.label}</th>
              <th className="text-left px-4 py-2.5 font-medium">Uploads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {ranked.map(({ r, v }, i) => (
              <tr key={r.faculty.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                <td className="px-4 py-2.5 text-ink-muted">{i + 1}</td>
                <td className="px-4 py-2.5 font-medium text-ink-primary">{r.faculty.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink-secondary">{r.faculty.employeeCode}</td>
                <td className="px-4 py-2.5 text-ink-secondary">{r.faculty.department?.name ?? '—'}</td>
                <td className="px-4 py-2.5 text-primary-700 font-semibold">
                  {typeof v === 'number' ? v.toFixed(1) : '—'}{crit.max ? <span className="text-ink-subtle font-normal"> / {crit.max}</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <FacultyUploadsButton submissionId={r.submissionId} facultyName={r.faculty.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
