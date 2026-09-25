import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Trash2, Pencil, Sparkles } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';
import { cadreTargetApi, type CadreTarget, type CadreTargetInput } from '../../api/cadreTargets';

const CADRE_LABEL: Record<CadreTarget['cadre'], string> = {
  ASSISTANT_PROFESSOR: 'Assistant Professor',
  SR_ASSISTANT_PROFESSOR: 'Sr. Assistant Professor',
  ASSOCIATE_PROFESSOR: 'Associate Professor',
  PROFESSOR: 'Professor',
};

const CADRE_OPTIONS = Object.keys(CADRE_LABEL) as CadreTarget['cadre'][];

const emptyForm: CadreTargetInput = {
  academicYearId: '',
  cadre: 'ASSISTANT_PROFESSOR',
  minExpYears: 0,
  maxExpYears: null,
  totalScoreTarget: 0,
  feedbackTarget: 3.5,
  indexedCount: 0,
  minJournal: 0,
  quartileSet: null,
  ppcRule: 'DESIRABLE',
  ppcCount: 1,
};

const expBand = (t: CadreTarget) => {
  if (t.maxExpYears === null && t.minExpYears === 0) return '—';
  const lo = `${t.minExpYears} yr`;
  return t.maxExpYears === null ? `≥ ${lo}` : `${t.minExpYears}–${t.maxExpYears} yr`;
};

export default function AdminCadreTargetsPage() {
  const [years, setYears] = useState<any[]>([]);
  const [yearId, setYearId] = useState('');
  const [targets, setTargets] = useState<CadreTarget[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CadreTargetInput>(emptyForm);

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
    cadreTargetApi.list(ayId).then(setTargets).catch(() => toast.error('Failed to load targets'));
  };

  useEffect(() => {
    load(yearId);
    resetForm();
  }, [yearId]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm, academicYearId: yearId });
  };

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, academicYearId: yearId });
    setShowForm(true);
  };

  const startEdit = (t: CadreTarget) => {
    setEditingId(t.id);
    setForm({ ...t, academicYearId: yearId });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: CadreTargetInput = {
        ...form,
        academicYearId: yearId,
        maxExpYears: form.maxExpYears === null || Number.isNaN(form.maxExpYears) ? null : form.maxExpYears,
        quartileSet: form.quartileSet?.trim() ? form.quartileSet.trim() : null,
      };
      if (editingId) {
        await cadreTargetApi.update(editingId, payload);
        toast.success('Target updated');
      } else {
        await cadreTargetApi.create(payload);
        toast.success('Target added');
      }
      resetForm();
      load(yearId);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Save failed');
    }
  };

  const remove = async (t: CadreTarget) => {
    if (!confirm(`Delete ${CADRE_LABEL[t.cadre]} target?`)) return;
    try {
      await cadreTargetApi.remove(t.id);
      toast.success('Target deleted');
      load(yearId);
    } catch {
      toast.error('Delete failed');
    }
  };

  const seedDefaults = async () => {
    if (targets.length && !confirm('Overwrite existing rows with FAPA defaults?')) return;
    try {
      await cadreTargetApi.seedDefaults(yearId);
      toast.success('FAPA defaults loaded');
      load(yearId);
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Seed failed');
    }
  };

  const inputCls =
    'w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';
  const numChange = (key: keyof CadreTargetInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value === '' ? (key === 'maxExpYears' ? null : 0) : Number(e.target.value) });

  return (
    <div>
      <PageHeader
        title="Cadre Targets"
        help="The per-cadre minimum figures faculty are measured against (papers, projects and so on). Add or edit a target row; the Tracking page compares each faculty’s actuals to these."
        help="The per-cadre minimum figures faculty are measured against (papers, projects and so on). Add or edit a target row; the Tracking page compares each faculty’s actuals to these."
        breadcrumbs={[{ label: 'Dean', to: '/dean/appraisals' }, { label: 'Cadre Targets' }]}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={seedDefaults}
              disabled={!yearId}
              className="flex items-center gap-2 border border-surface-border text-ink-secondary px-3 py-2 rounded text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
            >
              <Sparkles size={16} /> Load FAPA defaults
            </button>
            <button
              onClick={startCreate}
              disabled={!yearId}
              className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              <Plus size={16} /> Add Target
            </button>
          </div>
        }
      />

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

      {showForm && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">
            {editingId ? 'Edit Target' : 'Add Target'}
          </h2>
          <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Cadre</label>
              <select value={form.cadre} onChange={(e) => setForm({ ...form, cadre: e.target.value as CadreTarget['cadre'] })} className={inputCls}>
                {CADRE_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CADRE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Min Exp (yr)</label>
              <input type="number" min={0} step="0.5" value={form.minExpYears} onChange={numChange('minExpYears')} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Max Exp (yr, blank = none)</label>
              <input type="number" min={0} step="0.5" value={form.maxExpYears ?? ''} onChange={numChange('maxExpYears')} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Total Score Target</label>
              <input type="number" min={0} required value={form.totalScoreTarget} onChange={numChange('totalScoreTarget')} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Feedback Target</label>
              <input type="number" min={0} step="0.1" required value={form.feedbackTarget} onChange={numChange('feedbackTarget')} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Indexed Count</label>
              <input type="number" min={0} required value={form.indexedCount} onChange={numChange('indexedCount')} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Min Journal</label>
              <input type="number" min={0} value={form.minJournal} onChange={numChange('minJournal')} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Quartile Set (e.g. Q1-Q4)</label>
              <input value={form.quartileSet ?? ''} onChange={(e) => setForm({ ...form, quartileSet: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">PPC Rule</label>
              <select value={form.ppcRule} onChange={(e) => setForm({ ...form, ppcRule: e.target.value as CadreTarget['ppcRule'] })} className={inputCls}>
                <option value="DESIRABLE">Desirable</option>
                <option value="MANDATORY">Mandatory</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">PPC Count</label>
              <input type="number" min={0} value={form.ppcCount} onChange={numChange('ppcCount')} className={inputCls} />
            </div>
            <div className="col-span-2 md:col-span-3 flex gap-2 justify-end">
              <button type="button" onClick={resetForm} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">
                Cancel
              </button>
              <button type="submit" className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">
                {editingId ? 'Save' : 'Add'}
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card className="overflow-x-auto">
        {targets.length === 0 ? (
          <div className="text-sm text-ink-muted py-6 text-center">
            No targets for this year. Use <span className="font-medium">Load FAPA defaults</span> to seed the standard table.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
                <th className="py-2 pr-3 font-semibold">Cadre</th>
                <th className="py-2 px-3 font-semibold">Exp</th>
                <th className="py-2 px-3 font-semibold">Total</th>
                <th className="py-2 px-3 font-semibold">Feedback</th>
                <th className="py-2 px-3 font-semibold">Indexed</th>
                <th className="py-2 px-3 font-semibold">Min Jrnl</th>
                <th className="py-2 px-3 font-semibold">Quartile</th>
                <th className="py-2 px-3 font-semibold">PPC</th>
                <th className="py-2 pl-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className="border-b border-surface-border/60 last:border-0">
                  <td className="py-2 pr-3 font-medium text-ink-primary">{CADRE_LABEL[t.cadre]}</td>
                  <td className="py-2 px-3 text-ink-secondary">{expBand(t)}</td>
                  <td className="py-2 px-3 text-ink-secondary">≥ {t.totalScoreTarget}</td>
                  <td className="py-2 px-3 text-ink-secondary">≥ {t.feedbackTarget}</td>
                  <td className="py-2 px-3 text-ink-secondary">{t.indexedCount}</td>
                  <td className="py-2 px-3 text-ink-secondary">{t.minJournal}</td>
                  <td className="py-2 px-3 text-ink-secondary">{t.quartileSet ?? '—'}</td>
                  <td className="py-2 px-3 text-ink-secondary">
                    {t.ppcCount} {t.ppcRule === 'MANDATORY' ? 'mandatory' : 'desirable'}
                  </td>
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => startEdit(t)} className="p-1.5 rounded hover:bg-surface-muted text-ink-secondary" title="Edit">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => remove(t)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
