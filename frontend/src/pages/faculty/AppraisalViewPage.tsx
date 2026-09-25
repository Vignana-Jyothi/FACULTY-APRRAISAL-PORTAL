import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { appraisalApi } from '../../api/appraisals';
import toast from 'react-hot-toast';
import { CheckCircle, Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatusBadge from '../../components/StatusBadge';
import FeedbackSection from '../../components/FeedbackSection';
import RejectedProofsCard from '../../components/RejectedProofsCard';
import { useAuthStore } from '../../store/authStore';

const CAT6_FIELDS: [key: string, label: string][] = [
  ['cat6Punctuality', 'Punctuality'],
  ['cat6Professionalism', 'Professionalism'],
  ['cat6Willingness', 'Willingness'],
  ['cat6Cordiality', 'Cordiality'],
  ['cat6Classroom', 'Classroom Conduct'],
];

export default function AppraisalViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // This page is reached by the owning faculty, by the department review layer
  // and by scrutinizers following the link out of their queue. Category 6 and
  // the /550 grand total render only for the roles allowed to see them; the
  // server strips them from the payload for everyone else as well. Ownership
  // wins over role, so the owner's id is passed in — an HoD reading back their
  // own appraisal stays on the /500 scale.
  const canSeeCoreValues = useAuthStore((s) => s.canSeeCoreValues);
  const [submission, setSubmission] = useState<any>(null);
  const [score, setScore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const showCoreValues = canSeeCoreValues(submission?.userId ?? submission?.user?.id ?? null);

  const load = useCallback(() => {
    Promise.all([
      appraisalApi.get(id!),
      appraisalApi.getScore(id!),
    ]).then(([sub, sc]) => {
      setSubmission(sub);
      setScore(sc);
    }).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const downloadPdf = async () => {
    try {
      const blob = await appraisalApi.downloadPdf(id!);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `appraisal-${submission?.user?.employeeCode ?? id}-${submission?.academicYear?.label ?? ''}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('PDF download failed');
    }
  };

  const handleWithdraw = async () => {
    try {
      await appraisalApi.withdraw(id!);
      toast.success('Withdrawn');
      navigate('/dashboard');
    } catch (e: any) {
      toast.error(e.response?.data?.error ?? 'Failed');
    }
  };

  if (loading) return <div className="text-sm text-ink-muted">Loading...</div>;
  if (!submission) return <div className="text-sm text-danger-500">Not found</div>;

  const review = submission.review;

  return (
    <div className="max-w-4xl">
      {/* Print-only institute header */}
      <div className="print-only" style={{ textAlign: 'center', marginBottom: '12pt', borderBottom: '2pt solid #000', paddingBottom: '8pt' }}>
        <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>VALLURUPALLI NAGESWARA RAO VIGNANA JYOTHI</div>
        <div style={{ fontSize: '11pt' }}>INSTITUTE OF ENGINEERING &amp; TECHNOLOGY</div>
        <div style={{ fontSize: '9pt', marginTop: '2pt' }}>NAAC A++ · NBA Accredited · Autonomous Institution</div>
        <div style={{ fontSize: '12pt', fontWeight: 'bold', marginTop: '8pt' }}>
          Faculty Appraisal — Submission #{submission.submissionNumber} · {submission.academicYear?.label}
        </div>
      </div>

      <PageHeader
        title={`Submission #${submission.submissionNumber} — ${submission.academicYear?.label}`}
        help="Your submitted appraisal: the reviewer’s per-category marks and total out of 500 with comments. Category 6 and the grand total out of 550 are not shown to faculty."
        help="Your submitted appraisal: the reviewer’s per-category marks and total out of 500 with comments. Category 6 and the grand total out of 550 are not shown to faculty."
        breadcrumbs={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: 'Appraisals', to: '/dashboard' },
          { label: `#${submission.submissionNumber}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={submission.status} size="md" />
            <button onClick={downloadPdf} className="flex items-center gap-1 text-sm border border-surface-border px-3 py-1.5 rounded hover:bg-surface-muted">
              <Download size={14} /> PDF
            </button>
            {submission.status === 'SUBMITTED' && (
              <button onClick={handleWithdraw} className="text-sm text-danger-500 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50">
                Withdraw
              </button>
            )}
            {submission.status === 'DRAFT' && (
              <button onClick={() => navigate(`/appraisal/${id}/edit`)} className="text-sm bg-primary-600 text-white px-3 py-1.5 rounded hover:bg-primary-700">
                Edit
              </button>
            )}
          </div>
        }
      />

      {/* Rejected proofs: replace before the deadline or lose those marks */}
      {submission.status !== 'DRAFT' && <RejectedProofsCard submissionId={id!} onChanged={load} />}

      {/* Score Summary */}
      {score && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3">Self-Appraisal Score</h2>
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Teaching', val: score.cat1.total, max: 150 },
              { label: 'Research', val: score.cat2.total, max: 150 },
              { label: 'Development', val: score.cat3.total, max: 100 },
              { label: 'Governance', val: score.cat4.total, max: 50 },
              { label: 'Supplementary', val: score.cat5.total, max: 50 },
            ].map(({ label, val, max }) => (
              <div key={label} className="bg-surface-muted rounded p-3 text-center">
                <div className="text-lg font-bold text-primary-700">{val.toFixed(1)}</div>
                <div className="text-xs text-ink-muted">{label}</div>
                <div className="text-xs text-ink-subtle">/ {max}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-center">
            <span className="text-sm font-medium text-ink-secondary">Total: </span>
            <span className="text-lg font-bold text-primary-600">{score.selfTotal.toFixed(1)}</span>
            <span className="text-sm text-ink-subtle"> / 500</span>
          </div>
        </Card>
      )}

      {/* Reviewed score — categories 1-5 only. Category 6 and the /550 grand
          total are the reviewer's assessment and are not returned to faculty. */}
      {review && review.totalScore != null && score && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3">Reviewed Score</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-ink-muted">
              <span>Category</span>
              <span className="flex gap-4">
                <span className="w-24 text-right">Self</span>
                <span className="w-24 text-right">Reviewed</span>
              </span>
            </div>
            {[
              { label: 'Cat 1 — Teaching', self: score.cat1.total, rev: review.cat1Score, max: 150 },
              { label: 'Cat 2 — Research', self: score.cat2.total, rev: review.cat2Score, max: 150 },
              { label: 'Cat 3 — Development', self: score.cat3.total, rev: review.cat3Score, max: 100 },
              { label: 'Cat 4 — Governance', self: score.cat4.total, rev: review.cat4Score, max: 50 },
              { label: 'Cat 5 — Supplementary', self: score.cat5.total, rev: review.cat5Score, max: 50 },
            ].map(({ label, self, rev, max }) => {
              const changed = rev != null && Math.abs(rev - self) > 0.001;
              return (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-ink-secondary">
                    {label}
                    {changed && (
                      <span className="ml-1 text-[10px] text-accent-600">
                        ({rev > self ? '+' : ''}{(rev - self).toFixed(1)})
                      </span>
                    )}
                  </span>
                  <span className="flex gap-4 text-xs">
                    <span className="w-24 text-right text-ink-secondary">{self.toFixed(1)} / {max}</span>
                    <span className={`w-24 text-right font-medium ${changed ? 'text-accent-600' : 'text-ink-primary'}`}>
                      {(rev ?? self).toFixed(1)} / {max}
                    </span>
                  </span>
                </div>
              );
            })}
            <div className="border-t border-surface-border pt-2 flex items-center justify-between font-medium">
              <span className="text-sm text-ink-secondary">Total</span>
              <span className="flex gap-4 text-sm">
                {/* The self total frozen at review time — what the reviewer
                    actually judged. Falls back to the live figure for reviews
                    written before that was stored. */}
                <span className="w-24 text-right text-ink-secondary">
                  {(review.selfTotalScore ?? score.selfTotal).toFixed(1)} / 500
                </span>
                <span className="w-24 text-right text-primary-700">{review.totalScore.toFixed(1)} / 500</span>
              </span>
            </div>
          </div>
          <p className="text-[10px] text-ink-muted mt-3">
            Your reviewed score, as awarded by the reviewer against the evidence submitted.
          </p>
        </Card>
      )}

      {/* Category 6 + the /550 grand total — withheld from the faculty who owns
          this appraisal, from the dean, from scrutinizers and from the
          maintenance admin. */}
      {showCoreValues && review && review.grandTotal != null && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink-primary mb-3">Category 6 — Core Values</h2>
          <div className="space-y-1">
            {CAT6_FIELDS.map(([key, label]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-ink-secondary">{label}</span>
                <span className="text-ink-primary font-medium">{(review[key] ?? 0).toFixed(1)} / 10</span>
              </div>
            ))}
            <div className="border-t border-surface-border pt-2 mt-2 flex items-center justify-between font-medium">
              <span className="text-sm text-ink-secondary">Grand Total</span>
              <span className="text-sm text-primary-700">{review.grandTotal.toFixed(1)} / 550</span>
            </div>
          </div>
          <p className="text-[10px] text-ink-muted mt-3">
            Not visible to the faculty member, and not included in any email or export sent to them.
          </p>
        </Card>
      )}

      {/* Reviewer Comments */}
      {review && (review.overallComment || review.teachingComment) && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-success-500" />
            <h2 className="text-sm font-semibold text-ink-primary">Reviewer Feedback</h2>
          </div>
          <div className="space-y-2 text-sm">
            {[
              ['Teaching', review.teachingComment],
              ['Research', review.researchComment],
              ['Development', review.developmentComment],
              ['Governance', review.governanceComment],
              ['Supplementary', review.supplementaryComment],
              ['Overall', review.overallComment],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k}>
                <span className="font-medium text-ink-secondary">{k}: </span>
                <span className="text-ink-primary">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Annual HoD feedback (visible once issued) */}
      <div className="mb-4">
        <FeedbackSection submissionId={id!} />
      </div>

      {/* Status notice */}
      {['SUBMITTED', 'UNDER_REVIEW'].includes(submission.status) && (
        <div className="bg-primary-50 border border-primary-200 rounded p-3 text-sm text-primary-700">
          Your submission is under review. Reviewer feedback will be visible once the review is complete.
        </div>
      )}
    </div>
  );
}
