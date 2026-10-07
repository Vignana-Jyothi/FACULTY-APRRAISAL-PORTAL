import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { appraisalApi, type TargetStatus } from '../../api/appraisals';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { FileText, Plus, Clock, Send, CheckCircle2, Target, Check, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import StatusBadge from '../../components/StatusBadge';
import { SkeletonStatTile, SkeletonTable } from '../../components/Skeleton';

export default function DashboardPage() {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [years, setYears] = useState<any[]>([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<TargetStatus | null>(null);
  const { user, hasRole, isPrincipal, isDean, isScrutinizer, isHodOrReviewer, isAdmin, isDeptAdmin } = useAuthStore();
  // This is the faculty filing page (My Submissions, targets, drafts). It is
  // for FACULTY only — a HoD/reviewer/dean/etc. who lands here (e.g. via the
  // "/" catch-all) is sent to their own home, so they never see a personal
  // submissions list that isn't theirs.
  const isFaculty = hasRole('FACULTY');

  useEffect(() => {
    if (!isFaculty) { setLoading(false); return; }
    Promise.all([
      appraisalApi.list(),
      userApi.listAcademicYears(),
    ]).then(([subs, yrs]) => {
      setSubmissions(subs);
      setYears(yrs);
      if (yrs.length) setSelectedYear(yrs[0].id);
    }).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, [isFaculty]);

  const createNew = async () => {
    if (!selectedYear) return toast.error('Select an academic year');
    try {
      const sub = await appraisalApi.create(selectedYear);
      window.location.href = `/appraisal/${sub.id}/edit`;
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Failed to create');
    }
  };

  const currentYear = years.find((y) => y.id === selectedYear);
  // One appraisal per faculty per year — hide "New Appraisal" once an active
  // (non-REJECTED) one exists for the selected year (backend enforces this too).
  const activeSub = submissions.find(
    (s: any) => ((s.academicYearId ?? s.academicYear?.id) === selectedYear) && s.status !== 'REJECTED'
  );
  const hasActiveThisYear = !!activeSub;

  // Target progress for the selected year's appraisal — drives the top bar.
  useEffect(() => {
    if (!activeSub?.id) { setTargets(null); return; }
    let live = true;
    appraisalApi.getTargetStatus(activeSub.id)
      .then((t) => { if (live) setTargets(t); })
      .catch(() => { if (live) setTargets(null); });
    return () => { live = false; };
  }, [activeSub?.id]);

  // Non-faculty never see the faculty filing page — send them to their home.
  if (!isFaculty) {
    const home = isPrincipal() || isDean() ? '/oversight'
      : isScrutinizer() ? '/final-review'
      : isHodOrReviewer() ? '/reviews'
      : (isAdmin() || isDeptAdmin()) ? '/admin/users'
      : '/profile';
    return <Navigate to={home} replace />;
  }

  if (loading) {
    return (
      <div className="max-w-5xl">
        <div className="grid grid-cols-3 gap-4 mb-5">
          <SkeletonStatTile /><SkeletonStatTile /><SkeletonStatTile />
        </div>
        <SkeletonTable rows={5} cols={4} />
      </div>
    );
  }

  // A faculty is red-listed when a proof of theirs was rejected: the appraisal
  // goes on hold until they replace it. Surface it loudly so they act.
  const redSub = submissions.find((s: any) => s.redListed || s.status === 'HOLD');

  const drafts = submissions.filter((s) => s.status === 'DRAFT').length;
  const submitted = submissions.filter((s) => s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW').length;
  const approved = submissions.filter((s) => s.status === 'APPROVED').length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Welcome, ${user?.name?.split(' ')[0] ?? 'Faculty'}`}
        titleStyle={{ fontFamily: 'var(--font-sans)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: 0 }}
        subtitle="Faculty Appraisal Dashboard"
        help="Your home. Start or continue this year’s appraisal draft, see your latest reviewed score out of 500, and track proof status. One draft carries through the year; submit after Q4."
        breadcrumbs={[{ label: 'Home' }, { label: 'Dashboard' }]}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="border border-surface-border rounded px-3 py-2 text-sm bg-surface-base"
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>{y.label}</option>
              ))}
            </select>
            {currentYear?.submissionOpen && !hasActiveThisYear && (
              <button
                onClick={createNew}
                className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-primary-700"
              >
                <Plus size={16} /> New Appraisal
              </button>
            )}
            {currentYear?.submissionOpen && hasActiveThisYear && (
              <span className="text-xs text-ink-muted max-w-[180px]">You already have an appraisal for this year.</span>
            )}
          </div>
        }
      />

      {redSub && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800">
            <div className="font-semibold">You are on the red list — your appraisal is on hold.</div>
            {redSub.holdReason && <div className="mt-0.5 text-red-700">{redSub.holdReason}</div>}
            <div className="mt-1 text-red-700">
              Replace the rejected proof in{' '}
              <Link to={`/appraisal/${redSub.id}`} className="font-medium underline">your appraisal</Link>
              {redSub.proofDeadlineAt && (
                <> before <span className="font-medium">{new Date(redSub.proofDeadlineAt).toLocaleDateString()}</span>, or the marks for that item are voided</>
              )}.
            </div>
          </div>
        </div>
      )}

      {/* Top target bar — progress against the FAPA targets */}
      {targets && targets.total > 0 && <TargetBar t={targets} />}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-5 animate-rise" style={{ animationDelay: '60ms' }}>
        <StatTile icon={<FileText size={18} />} label="Drafts" value={drafts} color="warning" />
        <StatTile icon={<Send size={18} />} label="In Review" value={submitted} color="primary" />
        <StatTile icon={<CheckCircle2 size={18} />} label="Approved" value={approved} color="success" />
      </div>

      {!currentYear?.submissionOpen && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-4 text-sm text-amber-800 flex items-center gap-2">
          <Clock size={16} />
          Submission window is currently closed for this academic year.
        </div>
      )}

      {drafts > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded p-3 mb-4 text-sm text-primary-900">
          Your draft carries across the whole academic year — keep adding to it each quarter. Submission opens
          once, after the Q4 review is over; the exact date is shown on the draft's Preview &amp; Submit step.
        </div>
      )}

      {/* Submissions list. The active one for the selected year is pinned to the
          top and highlighted, so a queue cluttered by past/demo submissions
          still surfaces the one that matters now. */}
      <Card padding="none" className="animate-rise" style={{ animationDelay: '120ms' }}>
        <div className="px-5 py-3 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-ink-primary">My Submissions</h2>
        </div>
        {submissions.length === 0 ? (
          <div className="p-8 text-center">
            <FileText className="mx-auto text-ink-subtle mb-3" size={40} />
            <p className="text-ink-muted text-sm">No submissions yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {[...submissions]
              .sort((a, b) => (a.id === activeSub?.id ? -1 : b.id === activeSub?.id ? 1 : 0))
              .map((sub) => {
                const isActive = sub.id === activeSub?.id;
                return (
                  <div
                    key={sub.id}
                    className={`px-5 py-3 flex items-center justify-between transition-colors ${
                      isActive
                        ? 'bg-primary-50/70 border-l-4 border-primary-600'
                        : 'hover:bg-surface-muted/50 opacity-80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <FileText size={16} className={isActive ? 'text-primary-600' : 'text-ink-subtle'} />
                      <div>
                        <div className="text-sm font-medium text-ink-primary flex items-center gap-2">
                          Submission #{sub.submissionNumber} — {sub.academicYear?.label}
                          {isActive && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide bg-primary-600 text-white px-1.5 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-muted">
                          {sub.submittedAt
                            ? `Submitted ${new Date(sub.submittedAt).toLocaleDateString()}`
                            : sub.status === 'DRAFT' ? 'Draft — open all year, submit after the Q4 review window' : 'Not submitted'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={sub.status} />
                      <Link
                        to={sub.status === 'DRAFT' ? `/appraisal/${sub.id}/edit` : `/appraisal/${sub.id}`}
                        className="text-primary-600 text-sm font-medium hover:underline"
                      >
                        {sub.status === 'DRAFT' ? 'Edit' : 'View'}
                      </Link>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>
    </div>
  );
}

// The faculty's progress against their FAPA targets — a single horizontal bar
// with a per-target breakdown. Faculty-safe: it shows only the target labels,
// the counts and how many are met (from /target-status), never cadre or tier
// machinery.
function TargetBar({ t }: { t: TargetStatus }) {
  const pct = t.total > 0 ? Math.round((t.achieved / t.total) * 100) : 0;
  const done = t.achieved >= t.total;
  return (
    <Card className="mb-5 animate-rise">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-primary">Your Targets — {t.year}</h2>
        </div>
        <span className={`text-xs font-semibold ${done ? 'text-emerald-700' : 'text-ink-secondary'}`}>
          {t.achieved} / {t.total} met
        </span>
      </div>

      {/* The bar */}
      <div className="h-2.5 rounded-full bg-surface-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`h-full rounded-full transition-all ${done ? 'bg-emerald-500' : 'bg-primary-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-ink-muted mt-1.5">
        {done ? 'All targets met.' : t.leftText}
      </p>

      {/* Per-target breakdown */}
      <div className="mt-3 flex flex-wrap gap-2">
        {t.rows.map((r) => (
          <span
            key={r.label}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
              r.achieved
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-surface-base border-surface-border text-ink-secondary'
            }`}
          >
            {r.achieved
              ? <Check size={12} className="text-emerald-600" />
              : <span className="text-ink-subtle">•</span>}
            {r.label}: <strong>{r.current}</strong>/{r.required}
            {!r.achieved && <span className="text-ink-subtle">({r.left} to go)</span>}
          </span>
        ))}
      </div>
    </Card>
  );
}
