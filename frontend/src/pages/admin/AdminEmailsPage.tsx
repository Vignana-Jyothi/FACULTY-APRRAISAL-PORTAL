import { useEffect, useState } from 'react';
import { emailApi } from '../../api/emails';
import toast from 'react-hot-toast';
import { Mail, RefreshCw, Send, CheckCircle2, XCircle, Clock } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 50;

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SENT:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED:  'bg-red-50 text-red-700 border-red-200',
};

export default function AdminEmailsPage() {
  const [emails, setEmails] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const load = () => {
    setLoading(true);
    const params: any = { paginated: true, limit: PAGE_SIZE, offset };
    if (statusFilter) params.status = statusFilter;
    emailApi.list(params)
      .then((r: any) => {
        if (Array.isArray(r)) { setEmails(r); setTotal(r.length); }
        else { setEmails(r.rows); setTotal(r.total); }
      })
      .catch(() => toast.error('Failed to load emails'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter, offset]);
  useEffect(() => { setOffset(0); }, [statusFilter]);

  const retry = async (id: string) => {
    try {
      await emailApi.retry(id);
      toast.success('Retried');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    }
  };

  const triggerNow = async (type: 'draft_reminders' | 'reviewer_digest') => {
    setTriggering(true);
    try {
      await emailApi.trigger(type);
      toast.success(`${type} queued`);
      setTimeout(load, 1000);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed');
    } finally {
      setTriggering(false);
    }
  };

  const counts = emails.reduce((acc: any, e: any) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="Email Notifications"
        help="Every transactional and reminder email the system has queued or sent, with delivery status. You cannot compose mail from this page."
        help="Every transactional and reminder email the system has queued or sent, with delivery status. You cannot compose mail from this page."
        subtitle="Transactional + reminder emails queued from the system"
        breadcrumbs={[{ label: 'Admin', to: '/admin/dashboard' }, { label: 'Emails' }]}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => triggerNow('draft_reminders')}
              disabled={triggering}
              className="flex items-center gap-2 text-sm border border-surface-border px-3 py-2 rounded hover:bg-surface-muted disabled:opacity-50"
            >
              <Send size={14} /> Send Draft Reminders
            </button>
            <button
              onClick={() => triggerNow('reviewer_digest')}
              disabled={triggering}
              className="flex items-center gap-2 text-sm border border-surface-border px-3 py-2 rounded hover:bg-surface-muted disabled:opacity-50"
            >
              <Send size={14} /> Send Reviewer Digest
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded flex items-center justify-center bg-amber-50 text-warning-500"><Clock size={18} /></div>
            <div>
              <div className="text-xs text-ink-muted">Pending</div>
              <div className="text-xl font-bold text-ink-primary">{counts.PENDING ?? 0}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded flex items-center justify-center bg-emerald-50 text-success-500"><CheckCircle2 size={18} /></div>
            <div>
              <div className="text-xs text-ink-muted">Sent</div>
              <div className="text-xl font-bold text-ink-primary">{counts.SENT ?? 0}</div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded flex items-center justify-center bg-red-50 text-danger-500"><XCircle size={18} /></div>
            <div>
              <div className="text-xs text-ink-muted">Failed</div>
              <div className="text-xl font-bold text-ink-primary">{counts.FAILED ?? 0}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-ink-secondary">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-surface-border rounded px-3 py-1.5 text-sm bg-surface-base"
          >
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
      </Card>

      {loading ? (
        <div className="text-sm text-ink-muted">Loading...</div>
      ) : emails.length === 0 ? (
        <Card className="text-center py-8">
          <Mail className="mx-auto text-ink-subtle mb-3" size={40} />
          <p className="text-ink-muted text-sm">No emails found.</p>
        </Card>
      ) : (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary-700 text-white text-xs">
                <th className="text-left px-4 py-2.5 font-medium">To</th>
                <th className="text-left px-4 py-2.5 font-medium">Subject</th>
                <th className="text-left px-4 py-2.5 font-medium">Template</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-left px-4 py-2.5 font-medium">Attempts</th>
                <th className="text-left px-4 py-2.5 font-medium">Created</th>
                <th className="text-left px-4 py-2.5 font-medium">Sent</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {emails.map((e: any, i: number) => (
                <tr key={e.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                  <td className="px-4 py-2 text-ink-primary">
                    <div className="font-medium">{e.toUser?.name ?? '—'}</div>
                    <div className="text-[10px] text-ink-muted font-mono">{e.toEmail}</div>
                  </td>
                  <td className="px-4 py-2 text-ink-secondary max-w-xs truncate" title={e.subject}>{e.subject}</td>
                  <td className="px-4 py-2 text-ink-muted font-mono text-[11px]">{e.template}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center font-semibold uppercase tracking-wider border rounded px-2 py-0.5 text-[10px] ${STATUS_STYLES[e.status] ?? ''}`}>
                      {e.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-muted">{e.attempts}/3</td>
                  <td className="px-4 py-2 text-ink-muted text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-ink-muted text-xs">{e.sentAt ? new Date(e.sentAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-2">
                    {e.status === 'FAILED' && (
                      <button
                        onClick={() => retry(e.id)}
                        className="flex items-center gap-1 text-xs text-primary-600 hover:underline font-medium"
                        title={e.error}
                      >
                        <RefreshCw size={11} /> Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination total={total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
        </Card>
      )}

      {/* Error tooltip notice */}
      {emails.some((e: any) => e.status === 'FAILED' && e.error) && (
        <p className="text-xs text-ink-muted mt-3">Hover Retry button to see error message.</p>
      )}
    </div>
  );
}
