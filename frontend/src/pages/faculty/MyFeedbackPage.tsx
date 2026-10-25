import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { appraisalApi } from '../../api/appraisals';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import FeedbackSection from '../../components/FeedbackSection';
import HodNoteCard from '../../components/HodNoteCard';

// A faculty's quarter-wise feedback log: the HoD's issued feedback and comments
// for each quarter. FeedbackSection (owner view) shows only issued periods, as
// tabs, read-only — the feedback persists in the database once issued.
export default function MyFeedbackPage() {
  const [subId, setSubId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    appraisalApi.list()
      .then((subs: any[]) => {
        // Most recent submission (feedback is per submission / academic year).
        const latest = [...subs].sort((a, b) => (b.submissionNumber ?? 0) - (a.submissionNumber ?? 0))[0];
        setSubId(latest?.id ?? null);
      })
      .catch(() => toast.error('Failed to load your feedback'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Feedback"
        subtitle="Your HoD's feedback and comments, quarter by quarter."
        help="Each quarter, after it ends, your HoD reviews your appraisal and issues feedback. Pick a quarter to read the strengths, areas to improve and growth targets. Only issued quarters appear here."
        breadcrumbs={[{ label: 'Home' }, { label: 'Feedback' }]}
      />
      {loading ? (
        <div className="text-sm text-ink-muted">Loading...</div>
      ) : subId ? (
        <>
          <HodNoteCard submissionId={subId} />
          <FeedbackSection submissionId={subId} />
        </>
      ) : (
        <Card><p className="text-sm text-ink-secondary">You don't have an appraisal yet, so there's no feedback to show.</p></Card>
      )}
    </div>
  );
}
