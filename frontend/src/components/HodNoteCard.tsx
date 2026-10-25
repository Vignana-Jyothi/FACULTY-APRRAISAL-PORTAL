import { useEffect, useState } from 'react';
import { StickyNote } from 'lucide-react';
import { appraisalApi, type SharedDraftNote } from '../api/appraisals';

// The HoD's overall comment from the draft review, shown only once the HoD
// ticked "share". Same note the faculty sees on their appraisal; surfaced here
// so it sits with the quarter-wise feedback. Renders nothing when no note is
// shared. The endpoint serves owner and the owner's department HoD/reviewer.
export default function HodNoteCard({ submissionId }: { submissionId: string }) {
  const [note, setNote] = useState<SharedDraftNote | null>(null);

  useEffect(() => {
    let live = true;
    appraisalApi.getSharedNote(submissionId)
      .then((n) => { if (live) setNote(n); })
      .catch(() => { if (live) setNote(null); });
    return () => { live = false; };
  }, [submissionId]);

  if (!note) return null;

  return (
    <div className="mb-4 bg-primary-50 border border-primary-200 rounded p-3">
      <div className="text-xs font-semibold text-primary-800 mb-1 flex items-center gap-1.5">
        <StickyNote size={13} className="text-primary-600" /> HoD's comment
      </div>
      <p className="text-sm text-ink-primary whitespace-pre-wrap">{note.note}</p>
      <p className="text-[10px] text-ink-muted mt-1.5">Shared {new Date(note.sharedAt).toLocaleDateString()}</p>
    </div>
  );
}
