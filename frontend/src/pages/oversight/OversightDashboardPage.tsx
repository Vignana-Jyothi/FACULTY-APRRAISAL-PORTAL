import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FileText, Gavel, Layers, BadgeCheck, AlertTriangle, TrendingUp,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import StatusBadge from '../../components/StatusBadge';
import { userApi } from '../../api/users';
import { oversightApi, type OversightSummary } from '../../api/oversight';

// Order the status breakdown follows the appraisal's life, not the enum.
const STATUS_ORDER = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'HOLD', 'FINAL_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'];
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  HOLD: 'On hold',
  FINAL_REVIEW: 'Final review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '—');

// Dean + principal landing page: where the cycle stands, institute-wide.
// The average score is /550 for the principal and /500 for the dean — the
// server chooses (utils/reviewVisibility), the page only labels what it gets.
export default function OversightDashboardPage() {
  const [years, setYears] = useState<{ id: string; label: string }[]>([]);
  const [yearId, setYearId] = useState('');
  const [data, setData] = useState<OversightSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    userApi.listAcademicYears().then(setYears).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setMissing(false);
    oversightApi.summary(yearId || undefined)
      .then(setData)
      .catch((e) => {
        setData(null);
        if (e?.response?.status === 404) setMissing(true);
        else toast.error('Failed to load the dashboard');
      })
      .finally(() => setLoading(false));
  }, [yearId]);

  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

  return (
    <div>
      <PageHeader
        title="Dashboard"
        help="Institute-wide oversight for the principal and dean. Pick a department to drill in; the dean also configures tiers and allocates scrutinizers."
        help="Institute-wide oversight for the principal and dean. Pick a department to drill in; the dean also configures tiers and allocates scrutinizers."
        subtitle={data ? `Institute-wide status for ${data.year.label}${data.year.submissionOpen ? ' (open)' : ''}` : 'Institute-wide appraisal status'}
        breadcrumbs={[{ label: 'Home' }, { label: 'Dashboard' }]}
        actions={
          <select
            value={yearId}
            onChange={(e) => setYearId(e.target.value)}
            aria-label="Academic year"
            className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
          >
            <option value="">Open year</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          </select>
        }
      />

      {loading ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : missing || !data ? (
        <Card className="text-center py-8">
          <p className="text-ink-muted text-sm">
            {missing ? 'No academic year is open. Pick a year above.' : 'Nothing to show.'}
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-5">
            <StatTile icon={<FileText size={18} />} label="Submissions" value={data.submissions.total} color="primary" />
            <StatTile
              icon={<Gavel size={18} />}
              label="Final reviews pending"
              value={data.finalReviews.pendingSubmissions}
              hint={`${data.finalReviews.pendingCount} scrutinizer assignment(s)`}
              color="warning"
            />
            <StatTile
              icon={<Layers size={18} />}
              label="Tier decided"
              value={`${data.allocation.tier.decided} / ${data.allocation.faculty}`}
              hint={`${data.allocation.tier.undecided} undecided`}
              color="accent"
            />
            <StatTile
              icon={<BadgeCheck size={18} />}
              label="Eligibility decided"
              value={`${data.allocation.eligibility.decided} / ${data.allocation.faculty}`}
              hint={`${data.allocation.eligibility.eligible} eligible · ${data.allocation.eligibility.undecided} undecided`}
              color="success"
            />
            <StatTile icon={<AlertTriangle size={18} />} label="Red-listed" value={data.redListed} color="danger" />
            <StatTile
              icon={<TrendingUp size={18} />}
              label={data.averageScore.outOf === 550 ? 'Avg grand total' : 'Avg reviewed total'}
              value={data.averageScore.value != null ? data.averageScore.value.toFixed(1) : '—'}
              hint={`/ ${data.averageScore.outOf} · ${data.averageScore.reviewed} reviewed`}
              color="primary"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card padding="none">
              <div className="px-5 py-3 border-b border-surface-border">
                <h2 className="text-sm font-semibold text-ink-primary">Submissions by status</h2>
              </div>
              <ul className="divide-y divide-surface-border">
                {STATUS_ORDER.map((s) => {
                  const n = data.submissions.byStatus[s] ?? 0;
                  return (
                    <li key={s} className="flex items-center justify-between px-5 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        <StatusBadge status={s} />
                        <span className="text-ink-secondary">{STATUS_LABEL[s] ?? s}</span>
                      </span>
                      <span className="font-semibold text-ink-primary tabular-nums">
                        {n}
                        <span className="ml-2 text-[11px] font-normal text-ink-subtle">{pct(n, data.submissions.total)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card padding="none" className="lg:col-span-2">
              <div className="px-5 py-3 border-b border-surface-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-primary">Pending final reviews</h2>
                <span className="text-xs text-ink-muted">{data.finalReviews.pendingCount} awaiting sign-off</span>
              </div>
              {data.finalReviews.pending.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-muted text-center">No final reviews outstanding.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-primary-700 text-white text-xs">
                        <th className="text-left px-4 py-2.5 font-medium">Faculty</th>
                        <th className="text-left px-4 py-2.5 font-medium">Department</th>
                        <th className="text-left px-4 py-2.5 font-medium">Scrutinizer</th>
                        <th className="text-left px-4 py-2.5 font-medium">Assigned</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      {data.finalReviews.pending.map((p, i) => (
                        <tr key={p.id} className={i % 2 === 1 ? 'bg-surface-muted/50' : ''}>
                          <td className="px-4 py-2.5">
                            <Link to={`/appraisal/${p.submission.id}`} className="font-medium text-primary-700 hover:underline">
                              {p.faculty.name}
                            </Link>
                            <div className="font-mono text-[11px] text-ink-muted">
                              {p.faculty.employeeCode} · #{p.submission.submissionNumber}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-ink-secondary">{p.faculty.department?.code ?? '—'}</td>
                          <td className="px-4 py-2.5 text-ink-secondary">
                            {p.scrutinizer.name}
                            <div className="font-mono text-[11px] text-ink-muted">{p.scrutinizer.employeeCode}</div>
                          </td>
                          <td className="px-4 py-2.5 text-ink-secondary">{fmtDate(p.assignedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
