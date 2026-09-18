import { useEffect, useState } from 'react';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { Plus, Lock, Unlock } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

export default function AdminAcademicYearsPage() {
  const [years, setYears] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ label: '', startDate: '', endDate: '', submissionOpen: false });

  const load = () => userApi.listAdminAcademicYears().then(setYears).catch(() => toast.error('Failed'));

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await userApi.createAcademicYear(form);
      toast.success('Year created');
      setShowCreate(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const toggleWindow = async (y: any) => {
    try {
      await userApi.updateAcademicYear(y.id, { submissionOpen: !y.submissionOpen });
      toast.success(y.submissionOpen ? 'Window closed' : 'Window opened');
      load();
    } catch {
      toast.error('Failed');
    }
  };

  const inputCls = "w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500";

  return (
    <div>
      <PageHeader
        title="Academic Years"
        breadcrumbs={[{ label: 'Dean', to: '/dean/appraisals' }, { label: 'Academic Years' }]}
        actions={
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700">
            <Plus size={16} /> New Year
          </button>
        }
      />

      {showCreate && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Create Academic Year</h2>
          <form onSubmit={create} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Label (e.g. 2025-26)</label>
              <input required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Start Date</label>
              <input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">End Date</label>
              <input type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputCls} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <input type="checkbox" checked={form.submissionOpen} onChange={(e) => setForm({ ...form, submissionOpen: e.target.checked })} />
                Open submission window
              </label>
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
              <button type="submit" className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">Create</button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {years.map((y) => (
          <Card key={y.id} className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-ink-primary">{y.label}</div>
              <div className="text-xs text-ink-muted mt-1">
                {new Date(y.startDate).toLocaleDateString()} — {new Date(y.endDate).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${y.submissionOpen ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-surface-muted text-ink-muted border-surface-border'}`}>
                {y.submissionOpen ? 'Open' : 'Closed'}
              </span>
              <button
                onClick={() => toggleWindow(y)}
                className="flex items-center gap-1 text-sm text-ink-secondary border border-surface-border px-3 py-1.5 rounded hover:bg-surface-muted"
              >
                {y.submissionOpen ? <><Lock size={14} /> Close</> : <><Unlock size={14} /> Open</>}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
