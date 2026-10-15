import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, CalendarClock } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import { useAuthStore } from '../../store/authStore';
import { deptReviewWindowApi, type DeptReviewWindow } from '../../api/deptReviewWindows';
import type { Quarter } from '../../api/reviewWindows';


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
  const [busy, setBusy] = useState<Quarter | null>(null);

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
      .then(({ windows }) => {
        const next: Record<Quarter, Row> = { Q1: blank(), Q2: blank(), Q3: blank(), Q4: blank() };
        for (const w of windows) next[w.quarter] = { startDate: toDay(w.startDate), endDate: toDay(w.endDate), saved: w };
        setRows(next);
      })
      .catch(() => toast.error('Failed to load reminder dates'));
  };

  useEffect(() => { load(yearId); }, [yearId, deptId]);

  const setRow = (q: Quarter, patch: Partial<Row>) => setRows((r) => ({ ...r, [q]: { ...r[q], ...patch } }));

  const save = async (q: Quarter) => {
    const row = rows[q];
    if (!row.startDate || !row.endDate) return toast.error('Set both start and end dates');
    if (row.endDate < row.startDate) return toast.error('End date must be on or after the start date');
    setBusy(q);
    try {
      await deptReviewWindowApi.upsert({ academicYearId: yearId, departmentId: deptId, quarter: q, startDate: row.startDate, endDate: row.endDate });
      toast.success(`${q} reminder dates saved`);
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
        <PageHeader title="Reminder Dates" />
        <Card><p className="text-sm text-ink-secondary">No department is assigned to your HoD role.</p></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Reminder Dates" subtitle="Set the dates each quarter to remind your faculty to fill their appraisals. These dates only schedule reminders — they do not lock the form. Faculty may edit all year; you review each quarter after it ends on the calendar." />

      <Card className="mb-4">
        <label className="block text-sm font-medium text-ink-secondary mb-1">Academic year</label>
        <select className="input max-w-xs" value={yearId} onChange={(e) => setYearId(e.target.value)}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </select>
      </Card>

      <div className="space-y-3">
        {QUARTERS.map(({ q, label }) => {
          const row = rows[q];
          return (
            <Card key={q}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 font-medium text-ink"><CalendarClock size={16} /> {label}</div>
                  <p className="mt-1 text-xs text-ink-muted">Reminder window — faculty are reminded to fill before it.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs text-ink-muted">Start</label>
                    <input type="date" className="input" value={row.startDate}
                      onChange={(e) => setRow(q, { startDate: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-muted">End</label>
                    <input type="date" className="input" value={row.endDate} min={row.startDate || undefined}
                      onChange={(e) => setRow(q, { endDate: e.target.value })} />
                  </div>
                  <button className="btn-primary flex items-center gap-1.5" disabled={busy === q} onClick={() => save(q)}>
                    <Save size={15} /> {busy === q ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-ink-muted">Faculty activity and reminders have moved to Drafts in Review.</p>
    </div>
  );
}
