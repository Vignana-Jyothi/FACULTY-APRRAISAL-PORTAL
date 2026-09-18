import { useEffect, useState } from 'react';
import { X, Trash2, Plus, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { userApi } from '../api/users';
import { ALL_ROLES, DEPT_SCOPED_ROLES, type Role } from '../store/authStore';

interface Props {
  open: boolean;
  user: any | null;
  onClose: () => void;
  onChanged: () => void;
}

const ROLES = ALL_ROLES;
// Only HOD and REVIEWER are department-scoped. The institute-wide roles must be
// assigned without a departmentId — `assignRole` rejects one outright.
const needsDept = (role: Role) => DEPT_SCOPED_ROLES.includes(role);

const ROLE_HINT: Partial<Record<Role, string>> = {
  ADMIN: 'Maintenance only — accounts, roles, email queue, audit log. No appraisal content.',
  PRINCIPAL: 'Institute-wide. The only role that sees core values and the /550 grand total everywhere.',
  DEAN: 'Configuration, tier allocation, and scrutinizer assignment.',
  SCRUTINIZER: 'Pool for final sign-off. Assigned per submission by the dean. Sees /500 only.',
  SPECIAL_SCRUTINIZER: 'Scrutinizer, plus tier allocation.',
  HOD: 'Head of their own department — review, core values, feedback, red list.',
  REVIEWER: 'Department incharge — proof verification and review in their own department.',
};

export default function RoleAssignModal({ open, user, onClose, onChanged }: Props) {
  const [depts, setDepts] = useState<any[]>([]);
  const [newRole, setNewRole] = useState<Role>('FACULTY');
  const [newDeptId, setNewDeptId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      userApi.listDepartments().then(setDepts).catch(() => toast.error('Failed to load depts'));
      setNewRole('FACULTY');
      setNewDeptId('');
    }
  }, [open]);

  if (!open || !user) return null;

  const activeRoles = (user.userRoles ?? []).filter((r: any) => r.isActive !== false);

  const addRole = async () => {
    if (needsDept(newRole) && !newDeptId) {
      toast.error(`${newRole} requires a department`);
      return;
    }
    setBusy(true);
    try {
      await userApi.assignRole(user.id, newRole, needsDept(newRole) ? newDeptId : undefined);
      toast.success(`${newRole} assigned`);
      onChanged();
      setNewDeptId('');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async (roleId: string, roleName: string) => {
    if (!confirm(`Revoke ${roleName} role?`)) return;
    setBusy(true);
    try {
      await userApi.revokeRole(user.id, roleId);
      toast.success('Role revoked');
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-md max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-primary-700 text-white rounded-t-md">
          <h2 className="font-bold font-serif flex items-center gap-2">
            <Shield size={18} /> Manage Roles
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5">
          {/* User info */}
          <div className="mb-4 pb-3 border-b border-surface-border">
            <div className="text-sm font-medium text-ink-primary">{user.name}</div>
            <div className="text-xs text-ink-muted font-mono">{user.employeeCode} · {user.email}</div>
          </div>

          {/* Active roles */}
          <h3 className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-2">Active Roles</h3>
          {activeRoles.length === 0 ? (
            <p className="text-sm text-ink-muted mb-4">No active roles assigned.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {activeRoles.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between bg-surface-muted border border-surface-border rounded p-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider bg-primary-50 text-primary-700 px-2 py-0.5 rounded border border-primary-200">
                      {r.role}
                    </span>
                    {r.departmentId && (
                      <span className="ml-2 text-xs text-ink-muted">
                        {r.department?.code ?? '—'} ({r.department?.name ?? '—'})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeRole(r.id, r.role)}
                    disabled={busy}
                    className="text-danger-500 hover:text-red-700 p-1 disabled:opacity-50"
                    title="Revoke role"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add role */}
          <h3 className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-2">Add Role</h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-[10px] text-ink-muted mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => {
                  const r = e.target.value as Role;
                  setNewRole(r);
                  // Institute-wide roles must carry no department at all.
                  if (!needsDept(r)) setNewDeptId('');
                }}
                className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-ink-muted mb-1">
                Department {needsDept(newRole)
                  ? <span className="text-danger-500">*</span>
                  : <span className="text-ink-subtle">(institute-wide)</span>}
              </label>
              <select
                value={newDeptId}
                onChange={(e) => setNewDeptId(e.target.value)}
                disabled={!needsDept(newRole)}
                className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base disabled:bg-surface-muted disabled:text-ink-subtle"
              >
                <option value="">— None —</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
              </select>
            </div>
          </div>

          {ROLE_HINT[newRole] && (
            <p className="text-[10px] text-ink-muted mb-3 -mt-1">{ROLE_HINT[newRole]}</p>
          )}

          <button
            onClick={addRole}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            <Plus size={14} /> Assign Role
          </button>

          <div className="flex justify-end mt-4">
            <button onClick={onClose} className="text-sm text-ink-secondary px-4 py-2 border border-surface-border rounded hover:bg-surface-muted">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
