import { useEffect, useState } from 'react';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { Plus, Search, Upload, Shield, UserMinus, RotateCcw } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import CsvImportModal from '../../components/CsvImportModal';
import RoleAssignModal from '../../components/RoleAssignModal';
import Pagination from '../../components/Pagination';
import { SkeletonTable } from '../../components/Skeleton';

const PAGE_SIZE = 50;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [roleUser, setRoleUser] = useState<any>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ employeeCode: '', name: '', email: '', password: '', designation: '', departmentId: '' });
  // Deactivated accounts are hidden by default, as they are everywhere else;
  // an admin turns them on to find and restore one.
  const [showInactive, setShowInactive] = useState(false);

  const load = () => {
    setLoading(true);
    const params: any = { limit: PAGE_SIZE, offset };
    if (search) params.search = search;
    if (showInactive) params.includeInactive = 'true';
    userApi.listUsers(params)
      .then((r: any) => {
        if (Array.isArray(r)) { setUsers(r); setTotal(r.length); }
        else { setUsers(r.rows); setTotal(r.total); }
      })
      .catch(() => toast.error('Failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search, offset, showInactive]);

  useEffect(() => { setOffset(0); }, [search, showInactive]);

  // Selection is page-scoped — clear it when the visible set changes.
  useEffect(() => { setSelected(new Set()); }, [search, offset, showInactive]);

  const toggleRow = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const someSelected = users.some((u) => selected.has(u.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)));

  const bulkDeactivate = async () => {
    const ids = [...selected].filter((id) => users.find((u) => u.id === id)?.isActive !== false);
    if (ids.length === 0) return;
    if (!confirm(
      `Deactivate ${ids.length} selected user(s)? They will not be able to sign in and their roles ` +
      `are stood down. Their appraisals and history are kept, and this can be undone.`,
    )) return;
    let ok = 0;
    const fails: string[] = [];
    for (const id of ids) {
      try { await userApi.deactivateUser(id); ok++; }
      catch { fails.push(users.find((u) => u.id === id)?.employeeCode ?? id); }
    }
    if (ok) toast.success(`Deactivated ${ok} user(s)`);
    if (fails.length) toast.error(`Failed to deactivate: ${fails.join(', ')}`);
    setSelected(new Set());
    load();
  };

  useEffect(() => {
    userApi.listDepartments().then(setDepts).catch(() => {});
  }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = { ...form };
      if (!payload.departmentId) delete payload.departmentId;
      if (!payload.designation) delete payload.designation;
      await userApi.createUser(payload);
      toast.success('User created');
      setShowCreate(false);
      setForm({ employeeCode: '', name: '', email: '', password: '', designation: '', departmentId: '' });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const deactivateUser = async (id: string) => {
    if (!confirm(
      'Deactivate this user? They will not be able to sign in and their roles are stood down. ' +
      'Their appraisals and history are kept, and this can be undone.',
    )) return;
    try {
      await userApi.deactivateUser(id);
      toast.success('User deactivated');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const reactivateUser = async (id: string) => {
    try {
      await userApi.reactivateUser(id);
      toast.success('User reactivated — assign their roles again if needed');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed');
    }
  };

  const inputCls = "w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500";

  return (
    <div>
      <PageHeader
        title="Users"
        breadcrumbs={[{ label: 'Admin', to: '/admin/dashboard' }, { label: 'Users' }]}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowImport(true)} className="flex items-center gap-2 border border-surface-border bg-surface-card text-ink-primary px-4 py-2 rounded text-sm font-medium hover:bg-surface-muted">
              <Upload size={16} /> Import CSV
            </button>
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700">
              <Plus size={16} /> New User
            </button>
          </div>
        }
      />

      <CsvImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={load}
      />

      <RoleAssignModal
        open={!!roleUser}
        user={roleUser}
        onClose={() => setRoleUser(null)}
        onChanged={() => { load(); /* refresh roles list in modal */ setTimeout(() => {
          if (roleUser) {
            const updated = users.find((u) => u.id === roleUser.id);
            if (updated) setRoleUser(updated);
          }
        }, 100); }}
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or code..."
            className="w-full pl-9 border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-secondary whitespace-nowrap cursor-pointer">
          <input
            type="checkbox"
            className="cursor-pointer accent-accent-500"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show deactivated
        </label>
      </div>

      {showCreate && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Create User</h2>
          <form onSubmit={createUser} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Employee Code</label>
              <input required value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Email</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Password</label>
              <input required type="password" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Designation</label>
              <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Assistant Professor" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Department</label>
              {/* Pick only. Departments are the dean's to create and edit
                  (/dean/departments) — the admin never adds one from here. */}
              <select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className={inputCls}
              >
                <option value="">— Select Department —</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Cancel</button>
              <button type="submit" className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">Create</button>
            </div>
          </form>
        </Card>
      )}

      {someSelected && (
        <div className="mb-3 flex items-center justify-between bg-primary-50 border border-primary-200 rounded px-4 py-2.5 text-sm">
          <span className="text-primary-700 font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(new Set())} className="text-xs text-ink-secondary hover:underline">Clear</button>
            <button onClick={bulkDeactivate} className="flex items-center gap-1.5 bg-danger-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-red-700">
              <UserMinus size={13} /> Deactivate selected
            </button>
          </div>
        </div>
      )}

      <Card padding="none">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-primary-700 text-white text-xs">
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  className="align-middle cursor-pointer accent-accent-500"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={toggleAll}
                />
              </th>
              <th className="text-left px-4 py-2.5 font-medium">Code</th>
              <th className="text-left px-4 py-2.5 font-medium">Name</th>
              <th className="text-left px-4 py-2.5 font-medium">Email</th>
              <th className="text-left px-4 py-2.5 font-medium">Department</th>
              <th className="text-left px-4 py-2.5 font-medium">Roles</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {users.map((u, i) => (
              <tr key={u.id} className={`${selected.has(u.id) ? 'bg-primary-50' : i % 2 === 1 ? 'bg-surface-muted/50' : ''}`}>
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${u.employeeCode}`}
                    className="align-middle cursor-pointer accent-accent-500"
                    checked={selected.has(u.id)}
                    onChange={() => toggleRow(u.id)}
                  />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{u.employeeCode}</td>
                <td className="px-4 py-2.5 font-medium text-ink-primary">
                  {u.name}
                  {u.isActive === false && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                      Deactivated
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{u.email}</td>
                <td className="px-4 py-2.5 text-ink-muted">
                  {u.department?.code ?? u.userRoles?.find((r: any) => r.department?.code)?.department?.code ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {u.userRoles?.map((r: any) => (
                      <span key={r.role} className="text-[10px] bg-primary-50 text-primary-700 px-2 py-0.5 rounded font-semibold">{r.role}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setRoleUser(u)}
                      className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-medium"
                      title="Manage roles"
                    >
                      <Shield size={11} /> Roles
                    </button>
                    {u.isActive === false ? (
                      <button onClick={() => reactivateUser(u.id)} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
                        <RotateCcw size={12} /> Reactivate
                      </button>
                    ) : (
                      <button onClick={() => deactivateUser(u.id)} className="text-xs text-danger-500 hover:text-red-700">Deactivate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && users.length === 0 && (
          <div className="p-2"><SkeletonTable rows={6} cols={7} /></div>
        )}
        <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
      </Card>
    </div>
  );
}
