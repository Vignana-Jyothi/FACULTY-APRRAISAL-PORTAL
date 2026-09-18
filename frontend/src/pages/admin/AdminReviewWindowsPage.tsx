import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import { reviewWindowApi, type ReviewWindow, type Quarter } from '../../api/reviewWindows';

const QUARTERS: { q: Quarter; label: string }[] = [
  { q: 'Q1', label: 'Q1 · Jul–Sep' },
  { q: 'Q2', label: 'Q2 · Oct–Dec' },
  { q: 'Q3', label: 'Q3 · Jan–Mar' },
  { q: 'Q4', label: 'Q4 · Apr–Jun' },
];

type Row = { id?: string; startDate: string; endDate: string; enabled: boolean; lastRunAt: string | null };
const blank = (): Row => ({ startDate: '', endDate: '', enabled: true, lastRunAt: null });
const toDay = (iso: string) => (iso ? iso.slice(0, 10) : '');

export default function AdminReviewWindowsPage() {
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState<Record<Quarter, Row>>({ Q1: blank(), Q2: blank(), Q3: blank(), Q4: blank() });
  const [busy, setBusy] = useState<Quarter | null>(null);

  useEffect(() => {
    userApi
      .listAdminAcademicYears()
      .then((ys: any[]) => {
        setYears(ys);
        if (ys.length) setYearId((prev) => prev || ys[0].id);
      })
      .catch(() => toast.error('Failed to load academic years'));
  }, []);

  const load = (ayId: string) => {
    if (!ayId) return;
    reviewWindowApi
      .list(ayId)
      .then((ws: ReviewWindow[]) => {
        const next: Record<Quarter, Row> = { Q1: blank(), Q2: blank(), Q3: blank(), Q4: blank() };
        for (const w of ws) next[w.quarter] = { id: w.id, startDate: toDay(w.startDate), endDate: toDay(w.endDate), enabled: w.enabled, lastRunAt: w.lastRunAt };
        setRows(next);
      })
      .catch(() => toast.error('Failed to load review windows'));
  };

  useEffect(() => { load(yearId); }, [yearId]);

  const setRow = (q: Quarter, patch: Partial<Row>) => setRows((r) => ({ ...r, [q]: { ...r[q], ...patch } }));

  const save = async (q: Quarter) => {
    const row = rows[q];
    if (!row.startDate || !row.endDate) return toast.error('Set both start and end dates');
    if (row.endDate < row.startDate) return toast.error('End date must be on or after the start date');
    setBusy(q);
    try {
      await reviewWindowApi.upsert({ academicYearId: yearId, quarter: q, startDate: row.startDate, endDate: row.endDate, enabled: row.enabled });
      toast.success(`${q} window saved`);
      load(yearId);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const inputCls = 'border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div>
      <PageHeader
        title="Review Windows"
        breadcrumbs={[{ label: 'Dean', to: '/dean/appraisals' }, { label: 'Review Windows' }]}
      />

      <p className="text-sm text-ink-muted mb-4 max-w-3xl">
        Set the quarterly review window per academic year. The quarterly automation — the criteria snapshot and the
        auto-feedback sent to every faculty — fires on each window's <span className="font-medium">end date</span>.
        Changing a window takes effect without a restart.
      </p>

      <div className="mb-4 max-w-xs">
        <label className="block text-xs font-medium text-ink-secondary mb-1">Academic Year</label>
        <select value={yearId} onChange={(e) => setYearId(e.target.value)} className={`${inputCls} w-full`}>
          {years.map((y) => (
            <option key={y.id} value={y.id}>{y.label}</option>
          ))}
        </select>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
              <th className="py-2 pr-3 font-semibold">Quarter</th>
              <th className="py-2 px-3 font-semibold">Start</th>
              <th className="py-2 px-3 font-semibold">End (fires)</th>
              <th className="py-2 px-3 font-semibold text-center">Enabled</th>
              <th className="py-2 px-3 font-semibold">Last fired</th>
              <th className="py-2 pl-3 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {QUARTERS.map(({ q, label }) => {
              const row = rows[q];
              return (
                <tr key={q} className="border-b border-surface-border/60 last:border-0">
                  <td className="py-2 pr-3 font-medium text-ink-primary whitespace-nowrap">{label}</td>
                  <td className="py-2 px-3">
                    <input type="date" value={row.startDate} onChange={(e) => setRow(q, { startDate: e.target.value })} className={inputCls} />
                  </td>
                  <td className="py-2 px-3">
                    <input type="date" value={row.endDate} onChange={(e) => setRow(q, { endDate: e.target.value })} className={inputCls} />
                  </td>
                  <td className="py-2 px-3 text-center">
                    <input type="checkbox" checked={row.enabled} onChange={(e) => setRow(q, { enabled: e.target.checked })} className="h-4 w-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" aria-label={`Enable ${q}`} />
                  </td>
                  <td className="py-2 px-3 text-ink-muted text-xs">{row.lastRunAt ? new Date(row.lastRunAt).toLocaleDateString() : '—'}</td>
                  <td className="py-2 pl-3 text-right">
                    <button onClick={() => save(q)} disabled={busy === q} className="inline-flex items-center gap-1.5 bg-primary-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-primary-700 disabled:opacity-50">
                      <Save size={14} /> {busy === q ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
