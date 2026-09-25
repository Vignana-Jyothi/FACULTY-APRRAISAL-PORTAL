import { useEffect, useState } from 'react';
import { auditApi } from '../../api/audit';
import toast from 'react-hot-toast';
import { Activity, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

const PAGE_SIZE = 50;

const ACTION_COLOR: Record<string, string> = {
  CREATED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ASSIGNED: 'bg-primary-50 text-primary-700 border-primary-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 border-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  UNLOCKED: 'bg-amber-50 text-amber-700 border-amber-200',
  WITHDRAWN: 'bg-surface-muted text-ink-muted border-surface-border',
  SIGNED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CHANGED: 'bg-amber-50 text-amber-700 border-amber-200',
  RESET: 'bg-amber-50 text-amber-700 border-amber-200',
  DEACTIVATED: 'bg-red-50 text-red-700 border-red-200',
  IMPORTED: 'bg-primary-50 text-primary-700 border-primary-200',
};

function actionStyle(action: string): string {
  for (const k of Object.keys(ACTION_COLOR)) {
    if (action.includes(k)) return ACTION_COLOR[k];
  }
  return 'bg-surface-muted text-ink-secondary border-surface-border';
}

export default function AdminAuditPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    auditApi.actions().then(setActions).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    const params: any = { limit: PAGE_SIZE, offset };
    if (actionFilter) params.action = actionFilter;
    if (entityFilter) params.entityType = entityFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate + 'T23:59:59.999Z';
    auditApi.list(params)
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
      })
      .catch(() => toast.error('Failed to load audit log'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [offset, actionFilter, entityFilter, fromDate, toDate]);

  const resetFilters = () => {
    setActionFilter('');
    setEntityFilter('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <PageHeader
        title="Audit Log"
        help="A read-only trail of who did what — logins, role changes, submissions, mail. Filter by user or action to trace an event."
        help="A read-only trail of who did what — logins, role changes, submissions, mail. Filter by user or action to trace an event."
        subtitle={`${total.toLocaleString()} event(s) recorded`}
        breadcrumbs={[{ label: 'Admin', to: '/admin/dashboard' }, { label: 'Audit Log' }]}
      />

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              <option value="">All Actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">Entity Type</label>
            <select
              value={entityFilter}
              onChange={(e) => { setEntityFilter(e.target.value); setOffset(0); }}
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              <option value="">All Entities</option>
              <option value="User">User</option>
              <option value="UserRole">UserRole</option>
              <option value="AppraisalSubmission">AppraisalSubmission</option>
              <option value="FPGPPlan">FPGPPlan</option>
              <option value="Department">Department</option>
              <option value="AcademicYear">AcademicYear</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setOffset(0); }}
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-secondary mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setOffset(0); }}
              className="w-full border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={resetFilters}
              className="w-full text-sm text-ink-secondary px-3 py-2 border border-surface-border rounded hover:bg-surface-muted"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <div className="text-sm text-ink-muted">Loading...</div>
      ) : rows.length === 0 ? (
        <Card className="text-center py-8">
          <Activity className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No audit events match filters.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="w-6 px-2 py-2.5"></th>
                <th className="text-left px-3 py-2.5 font-medium">When</th>
                <th className="text-left px-3 py-2.5 font-medium">Who</th>
                <th className="text-left px-3 py-2.5 font-medium">Action</th>
                <th className="text-left px-3 py-2.5 font-medium">Entity Type</th>
                <th className="text-left px-3 py-2.5 font-medium">Entity ID</th>
                <th className="text-left px-3 py-2.5 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {rows.map((r, i) => {
                const isExpanded = expanded.has(r.id);
                const hasMetadata = r.metadata && Object.keys(r.metadata).length > 0;
                return (
                  <>
                    <tr key={r.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                      <td className="px-2 py-2">
                        {hasMetadata && (
                          <button
                            onClick={() => toggleExpand(r.id)}
                            className="text-ink-muted hover:text-ink-primary"
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-muted text-xs whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs font-medium text-ink-primary">{r.user?.name ?? '—'}</div>
                        <div className="text-[10px] text-ink-muted font-mono">{r.user?.employeeCode ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-2 py-0.5 ${actionStyle(r.action)}`}>
                          {r.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink-secondary text-xs">{r.entityType}</td>
                      <td className="px-3 py-2 text-ink-muted text-[10px] font-mono">{r.entityId.slice(0, 8)}…</td>
                      <td className="px-3 py-2 text-ink-muted text-[10px]">
                        {hasMetadata ? `${Object.keys(r.metadata).length} field(s)` : '—'}
                      </td>
                    </tr>
                    {isExpanded && hasMetadata && (
                      <tr className="bg-surface-muted/30">
                        <td colSpan={7} className="px-3 py-3">
                          <pre className="text-[10px] font-mono text-ink-secondary bg-surface-card border border-surface-border rounded p-2 overflow-x-auto">
{JSON.stringify(r.metadata, null, 2)}
                          </pre>
                          <div className="text-[10px] text-ink-muted mt-2">
                            Full entity ID: <span className="font-mono">{r.entityId}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border bg-surface-muted/30">
              <div className="text-xs text-ink-muted">
                Page {currentPage} of {totalPages} · Showing {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="flex items-center gap-1 text-xs border border-surface-border px-3 py-1.5 rounded hover:bg-surface-card disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={12} /> Prev
                </button>
                <button
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                  className="flex items-center gap-1 text-xs border border-surface-border px-3 py-1.5 rounded hover:bg-surface-card disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight size={12} />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
