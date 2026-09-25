import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Trash2, ShieldCheck } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { userApi } from '../../api/users';

interface Role {
  id: string;
  role: string;
  departmentId: string | null;
}
interface U {
  id: string;
  name: string;
  employeeCode: string;
  email: string;
  departmentId: string | null;
  userRoles: Role[];
}
interface Dept {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

// Incharge = a Verifier, modelled as the REVIEWER role scoped to a department.
// Assignment reuses the existing role endpoints; this page presents the
// concept as first-class "Incharges" for admins.
export default function AdminInchargesPage() {
  const [depts, setDepts] = useState<Dept[]>([]);
  const [incharges, setIncharges] = useState<U[]>([]);
  const [allUsers, setAllUsers] = useState<U[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assignDept, setAssignDept] = useState('');
  const [assignUser, setAssignUser] = useState('');

  const loadIncharges = () =>
    userApi
      .listUsers({ role: 'REVIEWER' })
      .then(setIncharges)
      .catch(() => toast.error('Failed to load incharges'));

  useEffect(() => {
    // Inactive departments included on purpose: an incharge assigned before a
    // department was switched off must stay visible, or the role cannot be
    // revoked from anywhere in the UI.
    userApi.listDepartments(true).then(setDepts).catch(() => toast.error('Failed to load departments'));
    userApi.listUsers().then(setAllUsers).catch(() => {});
    loadIncharges();
  }, []);

  // deptId -> [{ user, roleId }]
  const byDept = useMemo(() => {
    const map = new Map<string, { user: U; roleId: string }[]>();
    for (const u of incharges) {
      for (const r of u.userRoles) {
        if (r.role === 'REVIEWER' && r.departmentId) {
          const list = map.get(r.departmentId) ?? [];
          list.push({ user: u, roleId: r.id });
          map.set(r.departmentId, list);
        }
      }
    }
    return map;
  }, [incharges]);

  // Only active departments may receive a new incharge.
  const activeDepts = useMemo(() => depts.filter((d) => d.isActive), [depts]);

  // A REVIEWER role pointing at no department, or at one that no longer exists,
  // belongs to no card above — collect it so it is still revocable.
  const orphans = useMemo(() => {
    const known = new Set(depts.map((d) => d.id));
    const out: { user: U; roleId: string; departmentId: string | null }[] = [];
    for (const u of incharges) {
      for (const r of u.userRoles) {
        if (r.role !== 'REVIEWER') continue;
        if (!r.departmentId || !known.has(r.departmentId)) {
          out.push({ user: u, roleId: r.id, departmentId: r.departmentId });
        }
      }
    }
    return out;
  }, [incharges, depts]);

  const assign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignDept || !assignUser) {
      toast.error('Pick a department and a user');
      return;
    }
    try {
      await userApi.assignRole(assignUser, 'REVIEWER', assignDept);
      toast.success('Incharge assigned');
      setShowAssign(false);
      setAssignUser('');
      setAssignDept('');
      loadIncharges();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Assign failed');
    }
  };

  const revoke = async (userId: string, roleId: string, name: string) => {
    if (!confirm(`Remove ${name} as incharge?`)) return;
    try {
      await userApi.revokeRole(userId, roleId);
      toast.success('Incharge removed');
      loadIncharges();
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Remove failed');
    }
  };

  const inputCls =
    'w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div>
      <PageHeader
        title="Incharges"
        help="Assign a stand-in who acts for a department’s HoD. An incharge is scoped to that one department."
        help="Assign a stand-in who acts for a department’s HoD. An incharge is scoped to that one department."
        breadcrumbs={[{ label: 'Admin', to: '/admin/dashboard' }, { label: 'Incharges' }]}
        actions={
          <button
            onClick={() => setShowAssign((v) => !v)}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700"
          >
            <UserPlus size={16} /> Assign Incharge
          </button>
        }
      />

      <p className="text-xs text-ink-muted mb-4">
        An incharge verifies all uploads for their department (the Verifier role). Departments are isolated, so an incharge
        must belong to the department they verify — only the dean and dean-level final reviewers work across departments.
      </p>

      {showAssign && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3 pb-2 border-b border-accent-500/30 font-serif">Assign Incharge</h2>
          <form onSubmit={assign} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">Department</label>
              <select value={assignDept} onChange={(e) => { setAssignDept(e.target.value); setAssignUser(''); }} className={inputCls}>
                <option value="">Select department…</option>
                {activeDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1">User</label>
              <select value={assignUser} onChange={(e) => setAssignUser(e.target.value)} className={inputCls}>
                <option value="">Select user…</option>
                {allUsers
                  // Only people who belong to the chosen department — the API
                  // rejects a cross-department assignment outright.
                  .filter((u) => assignDept && u.departmentId === assignDept)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.employeeCode})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="text-sm bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700">
                Assign
              </button>
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {depts.map((d) => {
          const list = byDept.get(d.id) ?? [];
          return (
            <Card key={d.id}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-ink-primary">
                  {d.name} <span className="text-ink-muted font-normal">({d.code})</span>
                  {!d.isActive && (
                    <span className="ml-2 text-[11px] font-normal uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                      Inactive
                    </span>
                  )}
                </div>
                <span className="text-xs text-ink-muted">{list.length} incharge{list.length === 1 ? '' : 's'}</span>
              </div>
              {list.length === 0 ? (
                <div className="text-sm text-ink-muted">
                  {d.isActive ? 'No incharge assigned.' : 'No incharge — department is switched off.'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {list.map(({ user, roleId }) => (
                    <div key={roleId} className="flex items-center justify-between bg-surface-muted/50 rounded px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <ShieldCheck size={15} className="text-primary-600" />
                        <span className="font-medium text-ink-primary">{user.name}</span>
                        <span className="text-ink-muted">{user.employeeCode}</span>
                      </div>
                      <button
                        onClick={() => revoke(user.id, roleId, user.name)}
                        className="p-1.5 rounded hover:bg-red-50 text-red-600"
                        title="Remove incharge"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}

        {orphans.length > 0 && (
          <Card>
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-ink-primary">
                Unattached <span className="text-ink-muted font-normal">(no department)</span>
              </div>
              <span className="text-xs text-ink-muted">
                {orphans.length} role{orphans.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs text-ink-muted mb-2">
              Incharge roles whose department is missing or was deleted. They still grant verify access, so remove any
              that are no longer wanted.
            </p>
            <div className="space-y-1.5">
              {orphans.map(({ user, roleId }) => (
                <div key={roleId} className="flex items-center justify-between bg-surface-muted/50 rounded px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <ShieldCheck size={15} className="text-amber-600" />
                    <span className="font-medium text-ink-primary">{user.name}</span>
                    <span className="text-ink-muted">{user.employeeCode}</span>
                  </div>
                  <button
                    onClick={() => revoke(user.id, roleId, user.name)}
                    className="p-1.5 rounded hover:bg-red-50 text-red-600"
                    title="Remove incharge"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
