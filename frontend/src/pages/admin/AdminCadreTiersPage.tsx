import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Sparkles, Save } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import {
  cadreTierApi,
  type CadreTier,
  type Cadre,
  type TierName,
  type Criterion,
  type CriterionThreshold,
} from '../../api/cadreTiers';

const CADRE_LABEL: Record<Cadre, string> = {
  ASSISTANT_PROFESSOR: 'Assistant Professor',
  SR_ASSISTANT_PROFESSOR: 'Sr. Assistant Professor',
  ASSOCIATE_PROFESSOR: 'Associate Professor',
  PROFESSOR: 'Professor',
};
const CADRE_OPTIONS = Object.keys(CADRE_LABEL) as Cadre[];
const TIERS: TierName[] = ['T1', 'T2', 'T3'];

const CRITERIA: { key: Criterion; label: string; step: string }[] = [
  { key: 'totalScore', label: 'Total Score', step: '1' },
  { key: 'feedback', label: 'Feedback', step: '0.1' },
  { key: 'indexedCount', label: 'Indexed (WOS + Scopus)', step: '1' },
  { key: 'journalCount', label: 'Indexed Journals', step: '1' },
  { key: 'patentCount', label: 'Patents', step: '1' },
  { key: 'projectCount', label: 'Projects', step: '1' },
  { key: 'consultancyCount', label: 'Consultancy', step: '1' },
];

type Draft = Record<Criterion, CriterionThreshold>;
const blankDraft = (): Draft =>
  CRITERIA.reduce((acc, c) => ({ ...acc, [c.key]: { enabled: false, value: 0 } }), {} as Draft);

const draftFromCell = (cell: CadreTier | undefined): Draft => {
  const d = blankDraft();
  if (cell) for (const c of CRITERIA) if (cell.criteria[c.key]) d[c.key] = { ...cell.criteria[c.key]! };
  return d;
};

// enabled-criteria count for a configured cell (null = no cell)
const enabledCount = (cell: CadreTier | undefined): number | null =>
  cell ? CRITERIA.filter((c) => cell.criteria[c.key]?.enabled).length : null;

export default function AdminCadreTiersPage() {
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [cells, setCells] = useState<CadreTier[]>([]);
  const [cadre, setCadre] = useState<Cadre>('ASSISTANT_PROFESSOR');
  const [tier, setTier] = useState<TierName>('T1');
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [saving, setSaving] = useState(false);

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
    cadreTierApi.list(ayId).then(setCells).catch(() => toast.error('Failed to load tier thresholds'));
  };

  useEffect(() => {
    load(yearId);
  }, [yearId]);

  const currentCell = useMemo(
    () => cells.find((c) => c.cadre === cadre && c.tier === tier),
    [cells, cadre, tier]
  );

  // Reset the draft whenever the selected cadre/tier (or loaded cells) change.
  useEffect(() => {
    setDraft(draftFromCell(currentCell));
  }, [currentCell]);

  const setRow = (key: Criterion, patch: Partial<CriterionThreshold>) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const save = async () => {
    if (!yearId) return;
    setSaving(true);
    try {
      await cadreTierApi.upsert(yearId, cadre, tier, draft);
      toast.success(`${CADRE_LABEL[cadre]} · ${tier} saved`);
      load(yearId);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const seedDefaults = async () => {
    if (cells.length && !confirm('Overwrite all cadre-tier cells with values from the cadre targets?')) return;
    try {
      const res = await cadreTierApi.seedDefaults(yearId);
      const skipped = res.skippedCadres.length
        ? ` (skipped ${res.skippedCadres.map((c) => CADRE_LABEL[c]).join(', ')} — no cadre target)`
        : '';
      toast.success(`Seeded ${res.seededCadres.length} cadre(s)${skipped}`);
      load(yearId);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Seed failed');
    }
  };

  const inputCls =
    'w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div>
      <PageHeader
        title="Tier Thresholds"
        help="Reference tier bands per cadre. Note: the dean now sets each faculty’s tier and eligibility by hand on the Tracking page."
        help="Reference tier bands per cadre. Note: the dean now sets each faculty’s tier and eligibility by hand on the Tracking page."
        breadcrumbs={[{ label: 'Dean', to: '/dean/appraisals' }, { label: 'Tier Thresholds' }]}
        actions={
          <button
            onClick={seedDefaults}
            disabled={!yearId}
            className="flex items-center gap-2 border border-surface-border text-ink-secondary px-3 py-2 rounded text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
          >
            <Sparkles size={16} /> Seed from cadre targets
          </button>
        }
      />

      <p className="text-sm text-ink-muted mb-4 max-w-3xl">
        Tiers are defined per cadre — a faculty is assigned the highest tier whose <span className="font-medium">enabled</span> criteria
        are all met (actual ≥ threshold). Pick a designation and tier, tick the criteria that count, and set each threshold.
      </p>

      <div className="mb-4 max-w-xs">
        <label className="block text-xs font-medium text-ink-secondary mb-1">Academic Year</label>
        <select value={yearId} onChange={(e) => setYearId(e.target.value)} className={inputCls}>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.label}
            </option>
          ))}
        </select>
      </div>

      {/* Overview matrix — click a cell to edit it */}
      <Card className="mb-4 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-muted">
              <th className="py-2 pr-4 text-left font-semibold">Designation</th>
              {TIERS.map((t) => (
                <th key={t} className="py-2 px-4 font-semibold">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CADRE_OPTIONS.map((c) => (
              <tr key={c} className="border-t border-surface-border/60">
                <td className="py-2 pr-4 font-medium text-ink-primary whitespace-nowrap">{CADRE_LABEL[c]}</td>
                {TIERS.map((t) => {
                  const cell = cells.find((x) => x.cadre === c && x.tier === t);
                  const n = enabledCount(cell);
                  const active = c === cadre && t === tier;
                  return (
                    <td key={t} className="py-1.5 px-2 text-center">
                      <button
                        onClick={() => {
                          setCadre(c);
                          setTier(t);
                        }}
                        className={`min-w-[3rem] px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                          active
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-surface-border hover:bg-surface-muted text-ink-secondary'
                        }`}
                        title={n === null ? 'Not configured' : `${n} criteria enabled`}
                      >
                        {n === null ? '—' : `${n} on`}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Editor for the selected cadre × tier */}
      <Card>
        <div className="flex flex-wrap items-end gap-3 mb-4 pb-3 border-b border-accent-500/30">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">Designation</label>
            <select value={cadre} onChange={(e) => setCadre(e.target.value as Cadre)} className={inputCls}>
              {CADRE_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CADRE_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">Tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value as TierName)} className={inputCls}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto">
            <button
              onClick={save}
              disabled={saving || !yearId}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              <Save size={16} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
              <th className="py-2 pr-3 font-semibold w-16 text-center">Count</th>
              <th className="py-2 px-3 font-semibold">Criterion</th>
              <th className="py-2 pl-3 font-semibold w-40">Threshold (≥)</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map((c) => {
              const row = draft[c.key];
              return (
                <tr key={c.key} className="border-b border-surface-border/60 last:border-0">
                  <td className="py-2 pr-3 text-center">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) => setRow(c.key, { enabled: e.target.checked })}
                      className="h-4 w-4 rounded border-surface-border text-primary-600 focus:ring-primary-500"
                      aria-label={`Enable ${c.label}`}
                    />
                  </td>
                  <td className={`py-2 px-3 ${row.enabled ? 'text-ink-primary font-medium' : 'text-ink-muted'}`}>
                    {c.label}
                  </td>
                  <td className="py-2 pl-3">
                    <input
                      type="number"
                      min={0}
                      step={c.step}
                      value={row.value}
                      disabled={!row.enabled}
                      onChange={(e) => setRow(c.key, { value: e.target.value === '' ? 0 : Number(e.target.value) })}
                      className={`${inputCls} ${!row.enabled ? 'opacity-50' : ''}`}
                    />
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
