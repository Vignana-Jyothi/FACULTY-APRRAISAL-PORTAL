import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { appraisalApi } from '../../api/appraisals';
import { userApi } from '../../api/users';
import toast from 'react-hot-toast';
import { FileText, Plus, Clock, Send, CheckCircle2 } from 'lucide-react';
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
  const { user } = useAuthStore();

  useEffect(() => {
    Promise.all([
      appraisalApi.list(),
      userApi.listAcademicYears(),
    ]).then(([subs, yrs]) => {
      setSubmissions(subs);
      setYears(yrs);
      if (yrs.length) setSelectedYear(yrs[0].id);
    }).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, []);

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
  const hasActiveThisYear = submissions.some(
    (s: any) => ((s.academicYearId ?? s.academicYear?.id) === selectedYear) && s.status !== 'REJECTED'
  );

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

  const drafts = submissions.filter((s) => s.status === 'DRAFT').length;
  const submitted = submissions.filter((s) => s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW').length;
  const approved = submissions.filter((s) => s.status === 'APPROVED').length;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={`Welcome, ${user?.name?.split(' ')[0] ?? 'Faculty'}`}
        subtitle="Faculty Appraisal Dashboard"
        help="Your home. Start or continue this year’s appraisal draft, see your latest reviewed score out of 500, and track proof status. One draft carries through the year; submit after Q4."
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

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
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

      {/* Submissions list */}
      <Card padding="none">
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
            {submissions.map((sub) => (
              <div key={sub.id} className="px-5 py-3 flex items-center justify-between hover:bg-surface-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  <FileText size={16} className="text-ink-subtle" />
                  <div>
                    <div className="text-sm font-medium text-ink-primary">
                      Submission #{sub.submissionNumber} — {sub.academicYear?.label}
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
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
