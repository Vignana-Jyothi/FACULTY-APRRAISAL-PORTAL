import { useEffect, useMemo, useState } from 'react';
import { userApi } from '../../api/users';
import { emailApi } from '../../api/emails';
import { auditApi } from '../../api/audit';
import toast from 'react-hot-toast';
import { Users, UserCheck, UserMinus, Mail, MailWarning, Clock, Activity } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import { ALL_ROLES, type Role } from '../../store/authStore';

// Accounts and plumbing only. The maintenance admin is off every appraisal
// route, so nothing here reads submission content — that overview now lives on
// the institute report (/reports/institute), which the principal lands on.
export default function AdminDashboardPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [emails, setEmails] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      // includeInactive so the deactivated figure is counted, not inferred.
      userApi.listUsers({ limit: '1000', includeInactive: 'true' })
        .catch(() => { toast.error('Failed to load users'); return []; }),
      emailApi.list({ limit: 200 }).catch(() => []),
      auditApi.list({ limit: 15 }).catch(() => []),
    ]).then(([u, e, a]: any[]) => {
      setUsers(Array.isArray(u) ? u : (u?.rows ?? []));
      setEmails(Array.isArray(e) ? e : (e?.rows ?? []));
      setEvents(Array.isArray(a) ? a : (a?.rows ?? []));
    }).finally(() => setLoading(false));
  }, []);

  const accounts = useMemo(() => {
    const active = users.filter((u) => u.isActive !== false).length;
    const roleCounts = {} as Record<Role, number>;
    for (const r of ALL_ROLES) roleCounts[r] = 0;
    for (const u of users) {
      if (u.isActive === false) continue;
      for (const ur of u.userRoles ?? []) {
        const role = ur.role as Role;
        if (role in roleCounts) roleCounts[role]++;
      }
    }
    return { total: users.length, active, inactive: users.length - active, roleCounts };
  }, [users]);

  const mail = useMemo(() => {
    const by: Record<string, number> = {};
    for (const e of emails) by[e.status] = (by[e.status] ?? 0) + 1;
    return {
      pending: (by['PENDING'] ?? 0) + (by['QUEUED'] ?? 0),
      failed: by['FAILED'] ?? 0,
      sent: by['SENT'] ?? 0,
    };
  }, [emails]);

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;

  return (
    <div>
      <PageHeader
        title="Admin Dashboard"
        help="Maintenance home: accounts, role assignment, the email queue and the audit log. The admin holds no appraisal content."
        help="Maintenance home: accounts, role assignment, the email queue and the audit log. The admin holds no appraisal content."
        subtitle="Accounts, roles and mail plumbing"
        breadcrumbs={[{ label: 'Home' }, { label: 'Admin Dashboard' }]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatTile icon={<Users size={18} />} label="Total Accounts" value={accounts.total} color="primary" />
        <StatTile icon={<UserCheck size={18} />} label="Active" value={accounts.active} color="success" />
        <StatTile icon={<UserMinus size={18} />} label="Deactivated" value={accounts.inactive} color="danger" />
        <StatTile icon={<Clock size={18} />} label="Mail Pending" value={mail.pending} hint="last 200 queued" color="warning" />
        <StatTile icon={<MailWarning size={18} />} label="Mail Failed" value={mail.failed} hint="last 200 queued" color="danger" />
        <StatTile icon={<Mail size={18} />} label="Mail Sent" value={mail.sent} hint="last 200 queued" color="accent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="none">
          <div className="px-5 py-3 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-ink-primary">Roles in Use</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-5 py-2 font-medium">Role</th>
                <th className="text-left px-5 py-2 font-medium">Active Holders</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {ALL_ROLES.map((r, i) => (
                <tr key={r} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-5 py-2 font-medium text-ink-primary">{r.replace(/_/g, ' ')}</td>
                  <td className="px-5 py-2 text-ink-secondary">{accounts.roleCounts[r]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card padding="none">
          <div className="px-5 py-3 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-ink-primary">Recent Account Activity</h2>
          </div>
          {events.length === 0 ? (
            <div className="p-8 text-center text-ink-muted text-sm">
              <Activity className="mx-auto text-ink-subtle mb-3" size={32} />
              No recent activity.
            </div>
          ) : (
            <ul className="divide-y divide-surface-border">
              {events.map((e: any) => (
                <li key={e.id} className="px-5 py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-ink-primary truncate">{e.action}</div>
                    <div className="text-[10px] text-ink-muted truncate">
                      {e.user?.name ?? '—'} · {e.entityType}
                    </div>
                  </div>
                  <div className="text-[10px] text-ink-subtle whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
