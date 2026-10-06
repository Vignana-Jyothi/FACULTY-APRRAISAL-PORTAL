import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { appraisalApi } from '../../api/appraisals';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import { SkeletonTable } from '../../components/Skeleton';

// A faculty's own red-list view. A submission lands here when a proof of theirs
// was rejected and the appraisal is held until they replace it. Mirrors the
// dashboard banner, but as a standing tab so it is reachable from anywhere.
export default function MyRedListPage() {
  const [held, setHeld] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    appraisalApi.list()
      .then((subs: any[]) => setHeld(subs.filter((s) => s.redListed || s.status === 'HOLD')))
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Red List"
        subtitle="Submissions held after a rejected proof"
        help="A submission is held when a proof you uploaded was rejected. Replace the proof from your appraisal to clear the hold before the correction deadline, or the marks for that item are voided."
        breadcrumbs={[{ label: 'Home' }, { label: 'Red List' }]}
      />

      {loading ? (
        <SkeletonTable rows={2} cols={1} />
      ) : held.length === 0 ? (
        <Card>
          <div className="flex items-center gap-3 px-2 py-6 text-ink-secondary">
            <CheckCircle2 size={20} className="text-emerald-600" />
            <span>You are not on the red list. All your proofs are in order.</span>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {held.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3"
            >
              <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />
              <div className="text-sm text-red-800">
                <div className="font-semibold">
                  Appraisal {s.academicYear?.label ?? ''} — on hold
                </div>
                {s.holdReason && <div className="mt-0.5 text-red-700">{s.holdReason}</div>}
                <div className="mt-1 text-red-700">
                  Replace the rejected proof in{' '}
                  <Link to={`/appraisal/${s.id}`} className="font-medium underline">your appraisal</Link>
                  {s.proofDeadlineAt && (
                    <> before <span className="font-medium">{new Date(s.proofDeadlineAt).toLocaleDateString()}</span>, or the marks for that item are voided</>
                  )}.
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
