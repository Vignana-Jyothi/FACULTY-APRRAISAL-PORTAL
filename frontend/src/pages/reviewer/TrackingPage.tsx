import { useEffect, useState, Fragment } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, ChevronDown, ChevronRight, CalendarClock, Download, AlertTriangle, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { useAuthStore } from '../../store/authStore';
import { userApi } from '../../api/users';
import { trackingApi, type TrackingResponse, type TrackingRow, type SnapshotResult } from '../../api/tracking';

const TIER_STYLE: Record<string, string> = {
  T1: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  T2: 'bg-blue-50 text-blue-700 border-blue-200',
  T3: 'bg-amber-50 text-amber-700 border-amber-200',
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-ink-muted">—</span>;
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${TIER_STYLE[tier]}`}>{tier}</span>;
}

// Eligibility is the dean's call, not a computed verdict: an on/off switch that
// can also sit undecided (null) until they make it.
function EligibleToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  const on = value === true;
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(on ? false : true)}
        title={value === null ? 'Not decided — click to mark eligible' : on ? 'Eligible — click to mark not eligible' : 'Not eligible — click to mark eligible'}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          on ? 'bg-emerald-500' : value === false ? 'bg-red-400' : 'bg-surface-border'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
      </button>
      {value === null
        ? <span className="text-[10px] text-ink-muted">not set</span>
        : <button type="button" onClick={() => onChange(null)} title="Clear the decision" className="text-[10px] text-ink-muted hover:text-ink-secondary">clear</button>}
    </div>
  );
}

function EligibleBadge({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-xs text-ink-muted">—</span>;
  return value
    ? <CheckCircle2 size={16} className="text-emerald-600" />
    : <XCircle size={16} className="text-red-500" />;
}

function RequirementRows({ row }: { row: TrackingRow }) {
  if (!row.eligibility.requirements.length) {
    return <div className="text-xs text-ink-muted px-3 py-2">No cadre target configured for this faculty ({row.cadreLabel ?? 'unknown cadre'}).</div>;
  }
  return (
    <div className="px-3 py-2 bg-surface-muted/40">
      <table className="text-xs w-full max-w-lg">
        <tbody>
          {row.eligibility.requirements.map((req) => (
            <tr key={req.key}>
              <td className="py-1 pr-3 text-ink-secondary">
                {req.label}
                {!req.gating && <span className="ml-1 text-ink-subtle">(info)</span>}
              </td>
              <td className="py-1 pr-3 text-ink-muted">target {req.target}</td>
              <td className="py-1 pr-3 text-ink-primary">actual {req.actual}</td>
              <td className="py-1">
                {req.met ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-red-500" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TIER_GROUPS: { key: 'T1' | 'T2' | 'T3' | 'none'; label: string }[] = [
  { key: 'T1', label: 'Tier 1' },
  { key: 'T2', label: 'Tier 2' },
  { key: 'T3', label: 'Tier 3' },
  { key: 'none', label: 'Unassigned' },
];

// End-of-year tier-wise roster: faculty grouped under their assigned tier.
function TierGroupedList({ rows }: { rows: TrackingRow[] }) {
  const groups: Record<string, TrackingRow[]> = { T1: [], T2: [], T3: [], none: [] };
  for (const r of rows) groups[r.tier ?? 'none'].push(r);
  return (
    <div className="space-y-4">
      {TIER_GROUPS.map((g) => (
        <Card key={g.key}>
          <div className="flex items-center gap-2 mb-2">
            {g.key === 'none'
              ? <span className="text-sm font-semibold text-ink-secondary">Unassigned</span>
              : <span className={`text-sm font-semibold px-2 py-0.5 rounded border ${TIER_STYLE[g.key]}`}>{g.label}</span>}
            <span className="text-xs text-ink-muted">{groups[g.key].length} faculty</span>
          </div>
          {groups[g.key].length === 0 ? (
            <div className="text-xs text-ink-muted py-1">None.</div>
          ) : (
            <ul className="divide-y divide-surface-border/60">
              {groups[g.key].map((r) => (
                <li key={r.submissionId} className="flex items-center justify-between py-1.5 text-sm">
                  <div>
                    <span className="font-medium text-ink-primary">{r.faculty.name}</span>
                    <span className="text-xs text-ink-muted ml-2">{r.faculty.employeeCode}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ink-secondary">
                    <span>{r.cadreLabel ?? '—'}</span>
                    {/* No denominator: tracking is read by the dean and the
                        special scrutinizers, who must never be shown the /550
                        scale — it implies the withheld Cat 6 block. */}
                    <span className="text-ink-muted">{r.actuals.totalScore}</span>
                    <EligibleBadge value={r.eligible} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function TrackingPage() {
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotResult | null>(null);
  const { canAllocateTier, isDean, isPrincipal } = useAuthStore();
  // Tier/eligibility editing follows canAllocateTier (dean, special
  // scrutinizer, principal). The quarterly snapshot route is guarded with
  // CONFIG server-side, so a special scrutinizer pressing it would only get a
  // 403 — that button is dean/principal only.
  const canRunSnapshot = isDean() || isPrincipal();

  // Two-step. The button only ever asks the server for a dry run; the real
  // send goes out from the confirm dialog, because it mails every opted-in
  // faculty at their real address and cannot be recalled.
  const previewSnapshot = async () => {
    setSnapshotting(true);
    try {
      setSnapshotPreview(await trackingApi.runSnapshot(yearId || undefined));
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Snapshot preview failed');
    } finally {
      setSnapshotting(false);
    }
  };

  const confirmSnapshot = async () => {
    setSnapshotting(true);
    try {
      const res = await trackingApi.runSnapshot(yearId || undefined, true);
      toast.success(res.message);
      setSnapshotPreview(null);
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Snapshot failed');
    } finally {
      setSnapshotting(false);
    }
  };

  // Admin/dean sets a faculty's tier and eligibility by hand. Re-fetch after each
  // so the segregation matrix + filters stay in sync.
  const refresh = async () => setData(await trackingApi.get(yearId));

  const setTier = async (userId: string, tier: 'T1' | 'T2' | 'T3' | null) => {
    try {
      await trackingApi.setTier(userId, yearId, tier);
      await refresh();
    } catch {
      toast.error('Failed to set tier');
    }
  };

  const setEligible = async (userId: string, eligible: boolean | null) => {
    try {
      await trackingApi.setEligible(userId, yearId, eligible);
      await refresh();
    } catch {
      toast.error('Failed to set eligibility');
    }
  };

  const [fCadre, setFCadre] = useState('');
  const [fTier, setFTier] = useState('');
  const [fElig, setFElig] = useState('');
  const [view, setView] = useState<'table' | 'tiers'>('table');
  const [exporting, setExporting] = useState(false);

  const exportXlsx = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await trackingApi.exportExcel(yearId, data.year.label);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    userApi.listAcademicYears().then((ys: any[]) => {
      setYears(ys);
      const open = ys.find((y) => y.submissionOpen) ?? ys[0];
      if (open) setYearId(open.id);
    }).catch(() => toast.error('Failed to load academic years'));
  }, []);

  useEffect(() => {
    if (!yearId) return;
    setLoading(true);
    trackingApi.get(yearId).then(setData).catch(() => toast.error('Failed to load tracking')).finally(() => setLoading(false));
  }, [yearId]);

  const inputCls = 'border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';
  const th = 'py-2 px-2 font-semibold text-left';
  const cell = (met: boolean) => `py-2 px-2 ${met ? 'text-ink-primary' : 'text-red-600'}`;

  const cadreOptions = data ? Object.keys(data.aggregates.byCadre) : [];
  const filtered = (data?.rows ?? []).filter((r) => {
    if (fCadre && (r.cadreLabel ?? 'Unassigned') !== fCadre) return false;
    if (fTier && (r.tier ?? 'none') !== fTier) return false;
    if (fElig === 'eligible' && r.eligible !== true) return false;
    if (fElig === 'not' && r.eligible !== false) return false;
    if (fElig === 'undecided' && r.eligible !== null) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Criteria Tracking"
        subtitle="Each faculty's actuals against their cadre targets. Tier and eligibility are set by the dean."
        breadcrumbs={[{ label: 'Criteria Tracking' }]}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={exportXlsx}
              disabled={exporting || !data || data.rows.length === 0}
              className="flex items-center gap-2 border border-surface-border text-ink-secondary px-3 py-2 rounded text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
              title="Download the cadre + tier report as Excel"
            >
              <Download size={16} /> {exporting ? 'Exporting…' : 'Export'}
            </button>
            {canRunSnapshot && (
              <button
                onClick={previewSnapshot}
                disabled={snapshotting || !yearId}
                className="flex items-center gap-2 border border-surface-border text-ink-secondary px-3 py-2 rounded text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
                title="Snapshot this quarter's standing and email each faculty their feedback"
              >
                <CalendarClock size={16} /> {snapshotting ? 'Running…' : 'Run quarterly snapshot'}
              </button>
            )}
          </div>
        }
      />

      {snapshotPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSnapshotPreview(null)}>
          <div className="bg-surface-card rounded-md max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-primary-700 text-white rounded-t-md">
              <h2 className="font-bold font-serif flex items-center gap-2">
                <AlertTriangle size={18} /> Confirm quarterly send
              </h2>
              <button onClick={() => setSnapshotPreview(null)} className="text-white/70 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-ink-secondary">
                This snapshots {snapshotPreview.quarter} standing for <strong>{snapshotPreview.faculty}</strong> faculty and
                emails their feedback to their real college address. Sent mail cannot be recalled.
              </p>
              <div className="rounded border border-surface-border divide-y divide-surface-border text-sm">
                <div className="flex justify-between px-3 py-2">
                  <span className="font-medium">Will be emailed</span>
                  <span className="font-bold text-danger-500">{snapshotPreview.recipients ?? 0}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-ink-secondary">
                  <span>Skipped — opted out</span><span>{snapshotPreview.optedOut ?? 0}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-ink-secondary">
                  <span>Skipped — already sent this quarter</span><span>{snapshotPreview.alreadySent ?? 0}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-ink-secondary">
                  <span>Skipped — no email address</span><span>{snapshotPreview.noEmail ?? 0}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-border">
              <button
                onClick={() => setSnapshotPreview(null)}
                className="px-3 py-2 rounded text-sm font-medium border border-surface-border text-ink-secondary hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                onClick={confirmSnapshot}
                disabled={snapshotting || (snapshotPreview.recipients ?? 0) === 0}
                className="px-3 py-2 rounded text-sm font-medium bg-danger-500 text-white hover:opacity-90 disabled:opacity-50"
              >
                {snapshotting ? 'Sending…' : `Send to ${snapshotPreview.recipients ?? 0} faculty`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 max-w-xs">
        <label className="block text-xs font-medium text-ink-secondary mb-1">Academic Year</label>
        <select value={yearId} onChange={(e) => setYearId(e.target.value)} className={`${inputCls} w-full`}>
          {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </select>
      </div>

      {data && !data.hasTargets && (
        <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          No cadre targets set for this year — there is nothing to compare actuals against. Set them in Dean → Cadre Targets.
        </div>
      )}
      {data && canAllocateTier() && data.rows.length > 0 && (
        <div className="mb-3 text-xs text-ink-muted bg-surface-muted/40 border border-surface-border rounded px-3 py-2">
          Expand a row to compare a faculty's actuals with their cadre targets, then record your decision in the Tier and Eligible columns on the right.
        </div>
      )}

      {data && data.rows.length > 0 && (
        <>
          <Card className="mb-4 overflow-x-auto">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">Segregation by cadre &amp; tier</div>
            <table className="text-sm min-w-[36rem]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
                  <th className={th}>Cadre</th>
                  <th className={th}>T1</th>
                  <th className={th}>T2</th>
                  <th className={th}>T3</th>
                  <th className={th}>No tier</th>
                  <th className={th}>Eligible</th>
                  <th className={th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.aggregates.byCadre).map(([cadre, a]) => (
                  <tr key={cadre} className="border-b border-surface-border/50">
                    <td className="py-1.5 px-2 font-medium text-ink-primary">{cadre}</td>
                    <td className="py-1.5 px-2 text-ink-secondary">{a.tiers.T1}</td>
                    <td className="py-1.5 px-2 text-ink-secondary">{a.tiers.T2}</td>
                    <td className="py-1.5 px-2 text-ink-secondary">{a.tiers.T3}</td>
                    <td className="py-1.5 px-2 text-ink-muted">{a.tiers.none}</td>
                    <td className="py-1.5 px-2 text-emerald-700">{a.eligible}</td>
                    <td className="py-1.5 px-2 font-medium">{a.total}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 px-2">All</td>
                  <td className="py-1.5 px-2">{data.aggregates.byTier.T1}</td>
                  <td className="py-1.5 px-2">{data.aggregates.byTier.T2}</td>
                  <td className="py-1.5 px-2">{data.aggregates.byTier.T3}</td>
                  <td className="py-1.5 px-2 text-ink-muted">{data.aggregates.byTier.none}</td>
                  <td className="py-1.5 px-2 text-emerald-700">{data.aggregates.eligible}</td>
                  <td className="py-1.5 px-2">{data.aggregates.total}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <div className="flex flex-wrap gap-2 mb-3 items-center">
            <div className="inline-flex rounded border border-surface-border overflow-hidden text-sm">
              <button
                onClick={() => setView('table')}
                className={`px-3 py-1.5 ${view === 'table' ? 'bg-primary-600 text-white' : 'text-ink-secondary hover:bg-surface-muted'}`}
              >Table</button>
              <button
                onClick={() => setView('tiers')}
                className={`px-3 py-1.5 border-l border-surface-border ${view === 'tiers' ? 'bg-primary-600 text-white' : 'text-ink-secondary hover:bg-surface-muted'}`}
              >By tier</button>
            </div>
            <select value={fCadre} onChange={(e) => setFCadre(e.target.value)} className={inputCls}>
              <option value="">All cadres</option>
              {cadreOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {view === 'table' && (
              <select value={fTier} onChange={(e) => setFTier(e.target.value)} className={inputCls}>
                <option value="">All tiers</option>
                <option value="T1">T1</option>
                <option value="T2">T2</option>
                <option value="T3">T3</option>
                <option value="none">No tier</option>
              </select>
            )}
            <select value={fElig} onChange={(e) => setFElig(e.target.value)} className={inputCls}>
              <option value="">All eligibility</option>
              <option value="eligible">Eligible</option>
              <option value="not">Not eligible</option>
              <option value="undecided">Not decided</option>
            </select>
            <span className="text-xs text-ink-muted self-center">{filtered.length} of {data.rows.length}</span>
          </div>
        </>
      )}

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : !data || filtered.length === 0 ? (
        <Card><div className="text-sm text-ink-muted py-4 text-center">No matching faculty.</div></Card>
      ) : view === 'tiers' ? (
        <TierGroupedList rows={filtered} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
                <th className={th}></th>
                <th className={th}>Faculty</th>
                <th className={th}>Cadre</th>
                <th className={th}>Exp</th>
                {/* No denominator. Tracking is read by the dean and the special
                    scrutinizers, who must never be shown the /550 scale — it
                    implies the withheld Cat 6 block. */}
                <th className={th}>Reviewed total</th>
                <th className={th}>Feedback</th>
                <th className={th}>Indexed</th>
                <th className={th}>Journal</th>
                <th className={th}>Pat</th>
                <th className={th}>Proj</th>
                <th className={th}>Cons</th>
                <th className={th}>Tier</th>
                <th className={th}>Eligible</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const req = (k: string) => r.eligibility.requirements.find((x) => x.key === k);
                const isOpen = expanded === r.submissionId;
                return (
                  <Fragment key={r.submissionId}>
                    <tr
                      className="border-b border-surface-border/60 hover:bg-surface-muted/40 cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : r.submissionId)}
                    >
                      <td className="py-2 px-2 text-ink-muted">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="py-2 px-2">
                        <div className="font-medium text-ink-primary">{r.faculty.name}</div>
                        <div className="text-xs text-ink-muted">{r.faculty.employeeCode}</div>
                      </td>
                      <td className="py-2 px-2 text-ink-secondary">{r.cadreLabel ?? '—'}</td>
                      <td className="py-2 px-2 text-ink-secondary">{r.expYears}y</td>
                      <td className={cell(req('totalScore')?.met ?? true)}>
                        {r.actuals.totalScore}
                        <span className="text-ink-subtle text-[10px] ml-0.5">{r.actuals.totalScoreSource === 'SELF' ? '(self)' : ''}</span>
                      </td>
                      <td className={cell(req('feedback')?.met ?? true)}>{r.actuals.feedback}</td>
                      <td className={cell(req('indexed')?.met ?? true)}>{r.actuals.indexedCount}</td>
                      <td className={cell(req('journal')?.met ?? true)}>{r.actuals.journalCount}</td>
                      <td className="py-2 px-2 text-ink-secondary">{r.actuals.patentCount}</td>
                      <td className="py-2 px-2 text-ink-secondary">{r.actuals.projectCount}</td>
                      <td className="py-2 px-2 text-ink-secondary">{r.actuals.consultancyCount}</td>
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        {canAllocateTier() ? (
                          <select
                            value={r.tier ?? ''}
                            onChange={(e) => setTier(r.faculty.id, (e.target.value || null) as 'T1' | 'T2' | 'T3' | null)}
                            className="text-xs border border-surface-border rounded px-1.5 py-1 bg-surface-base focus:outline-none focus:ring-1 focus:ring-primary-500"
                            title="Assign tier"
                          >
                            <option value="">—</option>
                            <option value="T1">T1</option>
                            <option value="T2">T2</option>
                            <option value="T3">T3</option>
                          </select>
                        ) : <TierBadge tier={r.tier} />}
                      </td>
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        {canAllocateTier()
                          ? <EligibleToggle value={r.eligible} onChange={(v) => setEligible(r.faculty.id, v)} />
                          : <EligibleBadge value={r.eligible} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={13}><RequirementRows row={r} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
