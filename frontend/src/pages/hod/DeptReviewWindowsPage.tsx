import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, CalendarClock } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import { useAuthStore } from '../../store/authStore';
import { deptReviewWindowApi, type DeptReviewWindow, type DeanBound, type ActivityRow } from '../../api/deptReviewWindows';
import type { Quarter } from '../../api/reviewWindows';

const STATUS_STYLE: Record<string, string> = {
  'no-submission': 'bg-red-100 text-red-800',
  stale: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  submitted: 'bg-primary-100 text-primary-800',
};
const STATUS_LABEL: Record<string, string> = {
  'no-submission': 'Not started', stale: 'Inactive', active: 'Active', submitted: 'Submitted',
};
const statusStyle = (s: string) => STATUS_STYLE[s] ?? 'bg-surface-muted text-ink-secondary';
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, ' ');

const QUARTERS: { q: Quarter; label: string }[] = [
  { q: 'Q1', label: 'Q1 · Jul–Sep' },
  { q: 'Q2', label: 'Q2 · Oct–Dec' },
  { q: 'Q3', label: 'Q3 · Jan–Mar' },
  { q: 'Q4', label: 'Q4 · Apr–Jun' },
];

type Row = { startDate: string; endDate: string; saved: DeptReviewWindow | null };
const blank = (): Row => ({ startDate: '', endDate: '', saved: null });
const toDay = (iso: string) => (iso ? iso.slice(0, 10) : '');

export default function DeptReviewWindowsPage() {
  const user = useAuthStore((s) => s.user);
  // The HoD's own department (the department-scoped HOD role carries it).
  const deptId = user?.roles.find((r) => r.role === 'HOD')?.departmentId ?? user?.departmentId ?? '';

  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState<Record<Quarter, Row>>({ Q1: blank(), Q2: blank(), Q3: blank(), Q4: blank() });
  const [bounds, setBounds] = useState<Partial<Record<Quarter, DeanBound>>>({});
  const [busy, setBusy] = useState<Quarter | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [reminding, setReminding] = useState<string | null>(null);

  useEffect(() => {
    userApi
      .listAcademicYears()
      .then((ys: any[]) => {
        setYears(ys);
        if (ys.length) setYearId((prev) => prev || (ys.find((y) => y.submissionOpen) ?? ys[0]).id);
      })
      .catch(() => toast.error('Failed to load academic years'));
  }, []);

  const load = (ayId: string) => {
    if (!ayId || !deptId) return;
    deptReviewWindowApi
      .list(ayId, deptId)
      .then(({ windows, deanBounds }) => {
        const next: Record<Quarter, Row> = { Q1: blank(), Q2: blank(), Q3: blank(), Q4: blank() };
        for (const w of windows) next[w.quarter] = { startDate: toDay(w.startDate), endDate: toDay(w.endDate), saved: w };
        setRows(next);
        setBounds(deanBounds);
      })
      .catch(() => toast.error('Failed to load review windows'));
    deptReviewWindowApi.activity(ayId, deptId).then(({ rows }) => setActivity(rows)).catch(() => setActivity([]));
  };

  useEffect(() => { load(yearId); }, [yearId, deptId]);

  const remind = async (userId: string) => {
    setReminding(userId);
    try {
      const r = await deptReviewWindowApi.remind(userId, yearId);
      r.queued ? toast.success(r.message) : toast(r.message);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Could not send reminder');
    } finally {
      setReminding(null);
    }
  };

  const setRow = (q: Quarter, patch: Partial<Row>) => setRows((r) => ({ ...r, [q]: { ...r[q], ...patch } }));

  const save = async (q: Quarter) => {
    const row = rows[q];
    const b = bounds[q];
    if (!b || !b.enabled) return toast.error(`The dean has not opened ${q} yet`);
    if (!row.startDate || !row.endDate) return toast.error('Set both start and end dates');
    if (row.endDate < row.startDate) return toast.error('End date must be on or after the start date');
    if (row.startDate < toDay(b.startDate) || row.endDate > toDay(b.endDate)) {
      return toast.error(`${q} must stay within the dean's dates (${toDay(b.startDate)} to ${toDay(b.endDate)})`);
    }
    setBusy(q);
    try {
      await deptReviewWindowApi.upsert({ academicYearId: yearId, departmentId: deptId, quarter: q, startDate: row.startDate, endDate: row.endDate });
      toast.success(`${q} review week saved`);
      load(yearId);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  if (!deptId) {
    return (
      <div>
        <PageHeader title="Review Week" />
        <Card><p className="text-sm text-ink-secondary">No department is assigned to your HoD role.</p></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Review Week" subtitle="Set your department's review week inside each quarter. Appraisals freeze during the week; feedback mails go out the day after it ends." />

      <Card className="mb-4">
        <label className="block text-sm font-medium text-ink-secondary mb-1">Academic year</label>
        <select className="input max-w-xs" value={yearId} onChange={(e) => setYearId(e.target.value)}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </select>
      </Card>

      <div className="space-y-3">
        {QUARTERS.map(({ q, label }) => {
          const row = rows[q];
          const b = bounds[q];
          const open = !!b && b.enabled;
          return (
            <Card key={q}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 font-medium text-ink"><CalendarClock size={16} /> {label}</div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {open ? `Dean's window: ${toDay(b!.startDate)} → ${toDay(b!.endDate)}` : 'The dean has not opened this quarter yet.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs text-ink-muted">Start</label>
                    <input type="date" className="input" disabled={!open} value={row.startDate}
                      min={open ? toDay(b!.startDate) : undefined} max={open ? toDay(b!.endDate) : undefined}
                      onChange={(e) => setRow(q, { startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted">End</label>
                    <input type="date" className="input" disabled={!open} value={row.endDate}
                      min={open ? (row.startDate || toDay(b!.startDate)) : undefined} max={open ? toDay(b!.endDate) : undefined}
                      onChange={(e) => setRow(q, { endDate: e.target.value })} />
                  </div>
                  <button className="btn-primary flex items-center gap-1.5" disabled={!open || busy === q} onClick={() => save(q)}>
                    <Save size={15} /> {busy === q ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              {row.saved?.lastMailAt && (
                <p className="mt-2 text-xs text-green-700">Feedback mailed on {new Date(row.saved.lastMailAt).toLocaleDateString()}.</p>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <h2 className="font-semibold text-ink mb-1">Faculty activity</h2>
        <p className="mb-3 text-xs text-ink-muted">Who in your department has gone quiet on their draft. Inactive = no edit in 7+ days. A weekly reminder is automatic; use “Remind” to nudge now.</p>
        {activity.length === 0 ? (
          <p className="text-sm text-ink-secondary">No faculty found for this department.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted border-b border-border">
                  <th className="py-2 pr-3">Faculty</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Last edit</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {activity.map((r) => {
                  const needsNudge = r.status === 'stale' || r.status === 'no-submission';
                  return (
                    <tr key={r.userId} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-ink">{r.name}</div>
                        <div className="text-xs text-ink-muted">{r.employeeCode}{r.optedOut ? ' · opted out of email' : ''}</div>
                      </td>
                      <td className="py-2 pr-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle(r.status)}`}>{statusLabel(r.status)}</span></td>
                      <td className="py-2 pr-3 text-ink-secondary">
                        {r.lastEditedAt ? `${new Date(r.lastEditedAt).toLocaleDateString()}${r.daysSinceEdit != null ? ` (${r.daysSinceEdit}d ago)` : ''}` : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {needsNudge && (
                          <button className="btn-secondary text-xs" disabled={reminding === r.userId} onClick={() => remind(r.userId)}>
                            {reminding === r.userId ? 'Sending…' : 'Remind'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
