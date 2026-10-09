import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { MessageSquare, Save, Send, CheckCircle2, XCircle, Download } from 'lucide-react';
import Card from './Card';
import {
  feedbackApi, type FeedbackResponse, type FeedbackSnapshot,
  type FeedbackPeriod, type FeedbackListResponse, type FeedbackPeriodRow,
} from '../api/feedback';

// The five feedback periods, in order. Short labels for the tabs; the full
// label (with months) comes from each row for headings.
const PERIODS: { v: FeedbackPeriod; l: string }[] = [
  { v: 'Q1', l: 'Q1' }, { v: 'Q2', l: 'Q2' }, { v: 'Q3', l: 'Q3' }, { v: 'Q4', l: 'Q4' }, { v: 'ANNUAL', l: 'Annual' },
];

function SnapshotSummary({ s }: { s: FeedbackSnapshot }) {
  return (
    <div className="rounded border border-surface-border bg-surface-muted/40 p-3 text-xs space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span><span className="text-ink-muted">Cadre:</span> <span className="font-medium text-ink-primary">{s.cadreLabel ?? '—'}</span></span>
        <span className="inline-flex items-center gap-1">
          <span className="text-ink-muted">Meets ideal targets:</span>
          {s.eligible ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-red-500" />}
        </span>
      </div>
      {s.scores && (
        <div className="text-ink-secondary">
          <span className="text-ink-muted">Self-appraisal:</span> C1 {s.scores.cat1.toFixed(2)} · C2 {s.scores.cat2.toFixed(2)} · C3 {s.scores.cat3.toFixed(2)} · C4 {s.scores.cat4.toFixed(2)} · C5 {s.scores.cat5.toFixed(2)} ·
          <span className="font-semibold text-primary-700"> Total {s.scores.total.toFixed(2)} / 500</span>
        </div>
      )}
      {s.requirements?.length > 0 && (
        <div>
          <div className="text-ink-muted mb-1">Ideal targets</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {s.requirements.map((r) => (
              <span key={r.key} className="inline-flex items-center gap-1 text-ink-secondary">
                {r.met ? <CheckCircle2 size={11} className="text-emerald-600" /> : <XCircle size={11} className="text-red-500" />}
                {r.label} <span className="text-ink-muted">{r.target}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedbackSection({ submissionId }: { submissionId: string }) {
  const [list, setList] = useState<FeedbackListResponse | null>(null);
  const [period, setPeriod] = useState<FeedbackPeriod>('Q1');
  const [data, setData] = useState<FeedbackResponse | null>(null);
  const [form, setForm] = useState({ strengths: '', improvements: '', growthTargets: '' });
  const [busy, setBusy] = useState(false);

  // True when the editor was pre-filled from the auto-generated draft (no HoD
  // narrative saved yet) — drives the "auto-drafted" hint.
  const [autofilled, setAutofilled] = useState(false);

  // The per-period roster (status of each period). Sets the initial period.
  const loadList = () =>
    feedbackApi.list(submissionId).then((l) => {
      setList(l);
      // Editors start on the earliest unfinished quarter; faculty on the most
      // recent period they have been given.
      const issued = l.periods.filter((p) => p.status === 'ISSUED');
      if (l.editable) {
        const firstOpen = PERIODS.find((p) => !l.periods.some((r) => r.period === p.v && r.status !== 'NONE'));
        setPeriod(firstOpen?.v ?? 'ANNUAL');
      } else if (issued.length) {
        setPeriod(issued[issued.length - 1].period);
      }
    }).catch(() => toast.error('Failed to load feedback'));

  useEffect(() => { loadList(); }, [submissionId]);

  // The editor loads the selected period's detail (snapshot + suggestion).
  const load = () =>
    feedbackApi.get(submissionId, period).then((d) => {
      setData(d);
      const saved = d.feedback && (d.feedback.strengths || d.feedback.improvements || d.feedback.growthTargets);
      if (saved) {
        setForm({
          strengths: d.feedback!.strengths ?? '',
          improvements: d.feedback!.improvements ?? '',
          growthTargets: d.feedback!.growthTargets ?? '',
        });
        setAutofilled(false);
      } else if (d.suggested) {
        setForm({ ...d.suggested });
        setAutofilled(true);
      } else {
        setForm({ strengths: '', improvements: '', growthTargets: '' });
        setAutofilled(false);
      }
    }).catch(() => toast.error('Failed to load feedback'));

  const editable = !!list?.editable;
  useEffect(() => { if (editable) load(); }, [submissionId, period, editable]);

  if (!list) return null;

  // Faculty: the issued periods they may read. Editors: all five.
  const facultyRows = list.periods.filter((p) => p.status === 'ISSUED');
  const selectedRow: FeedbackPeriodRow | undefined = list.periods.find((p) => p.period === period);
  const statusOf = (p: FeedbackPeriod) => list.periods.find((r) => r.period === p)?.status ?? 'NONE';

  const feedback = editable ? data?.feedback ?? null : (selectedRow?.status === 'ISSUED' ? selectedRow : null);
  const snapshot = editable ? (data?.feedback?.snapshot ?? data?.autoSnapshot ?? null) : null;

  // Faculty with nothing issued at all.
  if (!editable && facultyRows.length === 0) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-ink-primary mb-1 font-serif flex items-center gap-2"><MessageSquare size={15} className="text-primary-600" /> Feedback</h2>
        <p className="text-xs text-ink-muted">No feedback has been issued yet.</p>
      </Card>
    );
  }

  // The PDF's contents are decided server-side from who is asking, so this is
  // the same call for a HoD and for the faculty.
  const downloadPdf = async () => {
    try {
      const blob = await feedbackApi.downloadPdf(submissionId, period);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback-${period}-${submissionId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF download failed');
    }
  };

  const save = async (issue: boolean) => {
    if (issue && !confirm(`Issue the ${selectedRow?.label ?? period} feedback to the faculty? They will be notified and can view it.`)) return;
    setBusy(true);
    try {
      if (issue) await feedbackApi.issue(submissionId, { ...form, period });
      else await feedbackApi.save(submissionId, { ...form, period });
      toast.success(issue ? 'Feedback issued' : 'Draft saved');
      await loadList();
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';

  const issuerName = editable ? (data?.feedback as any)?.issuedBy?.name : (selectedRow as any)?.issuedByName;
  const status = feedback?.status ?? 'NONE';
  // Which period tabs to show: all five for an editor, only issued ones for faculty.
  const tabs = editable ? PERIODS : PERIODS.filter((p) => statusOf(p.v) === 'ISSUED');

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-accent-500/30">
        <h2 className="text-sm font-semibold text-ink-primary font-serif flex items-center gap-2">
          <MessageSquare size={15} className="text-primary-600" /> {editable ? 'Feedback' : 'Your Feedback'}
        </h2>
        <div className="flex items-center gap-2">
          {status !== 'NONE' && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${status === 'ISSUED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {status}{status === 'ISSUED' && issuerName ? ` · ${issuerName}` : ''}
            </span>
          )}
          {status === 'ISSUED' && (
            <button
              onClick={downloadPdf}
              className="inline-flex items-center gap-1 text-xs border border-surface-border px-2 py-1 rounded hover:bg-surface-muted"
              title="Download this feedback as a PDF"
            >
              <Download size={13} /> PDF
            </button>
          )}
        </div>
      </div>

      {/* Period tabs — the four quarters then the final annual. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tabs.map((p) => {
          const st = statusOf(p.v);
          const active = p.v === period;
          return (
            <button
              key={p.v}
              type="button"
              onClick={() => setPeriod(p.v)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                active ? 'bg-primary-600 text-white border-primary-600'
                       : 'bg-surface-base text-ink-secondary border-surface-border hover:bg-surface-muted'
              }`}
            >
              {p.l}
              {st === 'ISSUED' && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-emerald-500'}`} />}
              {st === 'DRAFT' && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-amber-500'}`} />}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-ink-muted mb-3">{selectedRow?.label ?? period}</div>

      {/* Cadre / eligibility / target snapshot is for editors (HoD/admin) only —
          faculty must never see the tier/eligibility internals. */}
      {editable && status !== 'ISSUED' && snapshot && <div className="mb-3"><SnapshotSummary s={snapshot} /></div>}

      {editable && status === 'ISSUED' && (
        <p className="mb-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          This quarter's review has been issued and is locked — it can't be changed.
        </p>
      )}

      {editable && status !== 'ISSUED' ? (
        <div className="space-y-3">
          {autofilled && (
            <p className="text-xs text-primary-700 bg-primary-50 border border-primary-200 rounded px-3 py-2">
              Auto-drafted from this faculty's targets. Edit if needed, or issue as-is with one click.
            </p>
          )}
          {([['strengths', 'Strengths'], ['improvements', 'Areas to improve'], ['growthTargets', 'Growth targets (next cycle)']] as const).map(([k, label]) => (
            <div key={k}>
              <label className="block text-xs font-medium text-ink-secondary mb-1">{label}</label>
              <textarea rows={2} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={inputCls} />
            </div>
          ))}
          <div className="flex gap-2 justify-end">
            <button onClick={() => save(false)} disabled={busy} className="inline-flex items-center gap-2 text-sm border border-surface-border px-4 py-2 rounded hover:bg-surface-muted disabled:opacity-50">
              <Save size={15} /> Save draft
            </button>
            <button onClick={() => save(true)} disabled={busy} className="inline-flex items-center gap-2 text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50">
              <Send size={15} /> Issue to faculty
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {([['strengths', 'Strengths'], ['improvements', 'Areas to improve'], ['growthTargets', 'Growth targets']] as const).map(([k, label]) => (
            <div key={k}>
              <div className="text-xs font-medium text-ink-secondary mb-0.5">{label}</div>
              <div className="text-ink-primary whitespace-pre-wrap">{feedback?.[k] || <span className="text-ink-muted">—</span>}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
