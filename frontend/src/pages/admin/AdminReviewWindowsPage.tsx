import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, ShieldCheck, ShieldOff, Send, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import { reviewWindowApi, type ReviewWindow, type ReviewWindowPreview, type Quarter } from '../../api/reviewWindows';

const QUARTERS: { q: Quarter; label: string }[] = [
  { q: 'Q1', label: 'Q1 · Jul–Sep' },
  { q: 'Q2', label: 'Q2 · Oct–Dec' },
  { q: 'Q3', label: 'Q3 · Jan–Mar' },
  { q: 'Q4', label: 'Q4 · Apr–Jun' },
];

type Row = { startDate: string; endDate: string; enabled: boolean; saved: ReviewWindow | null };
const blank = (): Row => ({ startDate: '', endDate: '', enabled: true, saved: null });
const toDay = (iso: string) => (iso ? iso.slice(0, 10) : '');
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The mail state of a saved window. A window that ran without being held
// (armed, or fired before the gate existed) sent its mail.
function mailState(w: ReviewWindow | null): { label: string; detail?: string; cls: string } {
  if (!w) return { label: 'Not saved', cls: 'bg-surface-muted text-ink-muted' };
  if (w.releasedAt) return { label: 'Released', detail: when(w.releasedAt), cls: 'bg-green-100 text-green-800' };
  if (w.heldAt) return { label: 'Held — mail not sent', detail: `Ran ${when(w.heldAt)} unarmed`, cls: 'bg-amber-100 text-amber-800' };
  if (w.lastRunAt) return { label: 'Sent', detail: when(w.lastRunAt), cls: 'bg-green-100 text-green-800' };
  if (w.armedAt) {
    return { label: 'Armed', detail: `by ${w.armedByName ?? 'unknown'}, ${when(w.armedAt)}`, cls: 'bg-primary-100 text-primary-800' };
  }
  return { label: 'Not armed', detail: 'Will snapshot but hold the mail', cls: 'bg-surface-muted text-ink-secondary' };
}

type Dialog = { mode: 'arm' | 'release'; window: ReviewWindow };

export default function AdminReviewWindowsPage() {
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [rows, setRows] = useState<Record<Quarter, Row>>({ Q1: blank(), Q2: blank(), Q3: blank(), Q4: blank() });
  const [busy, setBusy] = useState<Quarter | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

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
        for (const w of ws) next[w.quarter] = { startDate: toDay(w.startDate), endDate: toDay(w.endDate), enabled: w.enabled, saved: w };
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
    const datesChanged = !!row.saved && (toDay(row.saved.startDate) !== row.startDate || toDay(row.saved.endDate) !== row.endDate);
    setBusy(q);
    try {
      await reviewWindowApi.upsert({ academicYearId: yearId, quarter: q, startDate: row.startDate, endDate: row.endDate, enabled: row.enabled });
      toast.success(datesChanged && row.saved?.armedAt ? `${q} window saved — dates changed, so it is disarmed` : `${q} window saved`);
      load(yearId);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const disarm = async (q: Quarter, w: ReviewWindow) => {
    setBusy(q);
    try {
      await reviewWindowApi.disarm(w.id);
      toast.success(`${q} disarmed — it will hold its mail`);
      load(yearId);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Disarm failed');
    } finally {
      setBusy(null);
    }
  };

  const inputCls = 'border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';
  const smallBtn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50';

  return (
    <div>
      <PageHeader
        title="Review Windows"
        breadcrumbs={[{ label: 'Dean', to: '/dean/appraisals' }, { label: 'Review Windows' }]}
      />

      <p className="text-sm text-ink-muted mb-4 max-w-3xl">
        Set the quarterly review window per academic year. On each window's <span className="font-medium">end date</span>{' '}
        the criteria snapshot is taken. The quarterly feedback email goes to faculty{' '}
        <span className="font-medium">only if you have armed the window</span> after checking the preview. An unarmed
        window still takes its snapshot but holds the mail until you release it. Changing a window's dates disarms it.
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
              <th className="py-2 px-3 font-semibold">Email</th>
              <th className="py-2 pl-3 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {QUARTERS.map(({ q, label }) => {
              const row = rows[q];
              const w = row.saved;
              const state = mailState(w);
              const canArm = !!w && !w.lastRunAt;
              const canRelease = !!w && !!w.heldAt && !w.releasedAt;
              return (
                <tr key={q} className="border-b border-surface-border/60 last:border-0 align-top">
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
                  <td className="py-2 px-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${state.cls}`}>{state.label}</span>
                    {state.detail && <div className="text-xs text-ink-muted mt-1">{state.detail}</div>}
                  </td>
                  <td className="py-2 pl-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button onClick={() => save(q)} disabled={busy === q} className={`${smallBtn} bg-primary-600 text-white hover:bg-primary-700`}>
                        <Save size={14} /> {busy === q ? 'Saving…' : 'Save'}
                      </button>
                      {canArm && w && !w.armedAt && (
                        <button onClick={() => setDialog({ mode: 'arm', window: w })} disabled={busy === q} className={`${smallBtn} border border-primary-600 text-primary-700 hover:bg-primary-50`}>
                          <ShieldCheck size={14} /> Arm
                        </button>
                      )}
                      {canArm && w?.armedAt && (
                        <button onClick={() => disarm(q, w)} disabled={busy === q} className={`${smallBtn} border border-surface-border text-ink-secondary hover:bg-surface-muted`}>
                          <ShieldOff size={14} /> Disarm
                        </button>
                      )}
                      {canRelease && w && (
                        <button onClick={() => setDialog({ mode: 'release', window: w })} disabled={busy === q} className={`${smallBtn} bg-amber-600 text-white hover:bg-amber-700`}>
                          <Send size={14} /> Release held mail
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {dialog && (
        <MailGateDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load(yearId); }}
        />
      )}
    </div>
  );
}

// Arm: preview the recipients and one real rendered email, then confirm that
// exact count. Release: dry-run count, then confirm.
function MailGateDialog({ dialog, onClose, onDone }: { dialog: Dialog; onClose: () => void; onDone: () => void }) {
  const { mode, window: w } = dialog;
  const [count, setCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<ReviewWindowPreview | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const fetchCount = () => {
    setCount(null);
    setError('');
    const p = mode === 'arm'
      ? reviewWindowApi.preview(w.id).then((pv) => { setPreview(pv); setCount(pv.recipients); })
      : reviewWindowApi.release(w.id, false).then((r) => setCount(r.recipients ?? 0));
    p.catch((e: any) => setError(e.response?.data?.error ?? 'Could not load the preview'));
  };

  useEffect(fetchCount, [w.id, mode]);

  const confirm = async () => {
    if (count === null) return;
    setSending(true);
    try {
      if (mode === 'arm') {
        await reviewWindowApi.arm(w.id, count);
        toast.success(`${w.quarter} armed — ${count} faculty will be emailed on ${new Date(w.endDate).toLocaleDateString()}`);
      } else {
        const r = await reviewWindowApi.release(w.id, true);
        toast.success(r.message);
      }
      onDone();
    } catch (e: any) {
      // 409 on arm: the recipient list changed since the preview. Reload it so
      // the dean confirms the new number, not the old one.
      setError(e.response?.data?.error ?? (mode === 'arm' ? 'Arm failed' : 'Release failed'));
      if (mode === 'arm' && e.response?.status === 409) fetchCount();
    } finally {
      setSending(false);
    }
  };

  const title = mode === 'arm' ? `Arm ${w.quarter} review window` : `Release held ${w.quarter} mail`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-surface-card rounded-md max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-primary-700 text-white rounded-t-md">
          <h2 className="font-bold font-serif flex items-center gap-2">
            {mode === 'arm' ? <ShieldCheck size={18} /> : <Send size={18} />} {title}
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto">
          {count === null && !error && <p className="text-sm text-ink-muted">Counting recipients…</p>}

          {count !== null && (
            <p className="text-base text-ink-primary mb-3">
              This will email <span className="font-bold">{count}</span> faculty
              {mode === 'arm' ? <> on the window's end date ({new Date(w.endDate).toLocaleDateString()}).</> : <> now.</>}
            </p>
          )}
          {count === 0 && (
            <p className="text-sm text-ink-muted mb-3">Nobody would receive this mail right now (no opted-in faculty with a submission who has not already had it).</p>
          )}

          {mode === 'arm' && preview?.sample && (
            <div className="mb-3">
              <div className="text-xs text-ink-muted mb-1">
                Sample — to <span className="font-medium text-ink-secondary">{preview.sample.to}</span>
              </div>
              <div className="text-sm font-medium text-ink-primary mb-2">{preview.sample.subject}</div>
              {/* Rendered in an inert frame: no scripts, no same-origin access. */}
              <iframe
                title="Sample quarterly feedback email"
                sandbox=""
                srcDoc={preview.sample.html}
                className="w-full h-80 border border-surface-border rounded bg-white"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
            <button
              onClick={confirm}
              disabled={count === null || sending}
              className="text-sm text-white px-4 py-2 rounded bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
            >
              {sending ? 'Working…' : mode === 'arm' ? `Arm — email ${count ?? '…'} faculty` : `Send to ${count ?? '…'} faculty`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
