import { useEffect, useState } from 'react';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { Plus, Edit2, Check, X, Trash2, RotateCcw } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

export default function AdminDepartmentsPage() {
  const [depts, setDepts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ code: '', name: '' });
  const [loading, setLoading] = useState(true);
  // Inactive departments are hidden everywhere else; an admin turns them on here
  // to find and restore one. Without this a deactivated department was
  // unreachable, including from the page that deactivated it.
  const [showInactive, setShowInactive] = useState(false);

  const load = () => {
    setLoading(true);
    // Departments only. The list carries each department's faculty count and
    // HoD, so this page never touches the ADMIN-only /admin/users endpoint that
    // used to 403 it for the very dean/principal it is meant for.
    userApi.listDepartments(showInactive)
      .then((d) => setDepts(d))
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [showInactive]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await userApi.createDepartment(form);
      toast.success('Department created');
      setShowCreate(false);
      setForm({ code: '', name: '' });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const startEdit = (d: any) => {
    setEditId(d.id);
    setEditForm({ code: d.code, name: d.name });
  };

  const saveEdit = async () => {
    if (!editId) return;
    try {
      await userApi.updateDepartment(editId, editForm);
      toast.success('Updated');
      setEditId(null);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const deactivate = async (d: any) => {
    if (!confirm(`Deactivate department "${d.code} — ${d.name}"? Department will be hidden from new assignments.`)) return;
    try {
      await userApi.deleteDepartment(d.id);
      toast.success('Department deactivated');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const reactivate = async (d: any) => {
    try {
      await userApi.reactivateDepartment(d.id);
      toast.success('Department reactivated');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };


  const inputCls = "w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500";

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle={`${depts.filter((d) => d.isActive !== false).length} active department(s)`}
        breadcrumbs={[{ label: 'Dean' }, { label: 'Departments' }]}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ink-secondary whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                className="cursor-pointer accent-accent-500"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show deactivated
            </label>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700">
              <Plus size={16} /> New Department
            </button>
          </div>
        }
      />

      {showCreate && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Create Department</h2>
          <form onSubmit={create} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Code</label>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CSE" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Computer Science & Engineering" className={inputCls} />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
              <button type="submit" className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">Create</button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="text-sm text-ink-muted">Loading...</div>
      ) : depts.length === 0 ? (
        <Card className="text-center py-8">
          <p className="text-ink-muted text-sm">No departments yet.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-4 py-2.5 font-medium">Code</th>
                <th className="text-left px-4 py-2.5 font-medium">Name</th>
                <th className="text-left px-4 py-2.5 font-medium">HoD</th>
                <th className="text-left px-4 py-2.5 font-medium">Faculty Count</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {depts.map((d, i) => (
                <tr key={d.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  {editId === d.id ? (
                    <>
                      <td className="px-4 py-2.5">
                        <input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className={inputCls} />
                      </td>
                      <td className="px-4 py-2.5">
                        <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} />
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted">—</td>
                      <td className="px-4 py-2.5 text-ink-muted">—</td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className="text-success-500 hover:text-emerald-700 p-1" title="Save"><Check size={14} /></button>
                          <button onClick={() => setEditId(null)} className="text-danger-500 hover:text-red-700 p-1" title="Cancel"><X size={14} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-primary">{d.code}</td>
                      <td className="px-4 py-2.5 font-medium text-ink-primary">
                        {d.name}
                        {d.isActive === false && (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                            Deactivated
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-secondary">{d.hod ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-secondary">{d.facultyCount ?? 0}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <button onClick={() => startEdit(d)} className="flex items-center gap-1 text-xs text-ink-secondary hover:text-primary-600">
                            <Edit2 size={11} /> Edit
                          </button>
                          {d.isActive === false ? (
                            <button onClick={() => reactivate(d)} className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                              <RotateCcw size={11} /> Reactivate
                            </button>
                          ) : (
                            <button onClick={() => deactivate(d)} className="flex items-center gap-1 text-xs text-danger-500 hover:text-red-700">
                              <Trash2 size={11} /> Deactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
