import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, MessageSquare, ChevronRight } from 'lucide-react';
import { reviewApi, type DraftInProgressRow } from '../../api/appraisals';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import FeedbackSection from '../../components/FeedbackSection';

// The HoD's own feedback log. Lists the department's faculty (one row each,
// their most recent submission), with a search box; picking one opens that
// faculty's quarter-wise feedback in the editor view — issued quarters are
// locked and read-only, the current quarter is still issuable.
export default function DeptFeedbackPage() {
  const [rows, setRows] = useState<DraftInProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<DraftInProgressRow | null>(null);

  useEffect(() => {
    reviewApi.listDrafts()
      .then((r) => {
        // One row per faculty (most recent submission), name-sorted.
        const byFaculty = new Map<string, DraftInProgressRow>();
        for (const row of r) {
          const prev = byFaculty.get(row.faculty.id);
          if (!prev || row.submissionNumber > prev.submissionNumber) byFaculty.set(row.faculty.id, row);
        }
        setRows([...byFaculty.values()].sort((a, b) => a.faculty.name.localeCompare(b.faculty.name)));
      })
      .catch(() => toast.error('Failed to load faculty'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      r.faculty.name.toLowerCase().includes(t) ||
      r.faculty.employeeCode.toLowerCase().includes(t));
  }, [rows, q]);

  return (
    <div>
      <PageHeader
        title="Feedback"
        subtitle="The feedback you've issued, faculty by faculty."
        help="Search for a faculty member and open their record to read the quarter-wise feedback you issued. Issued quarters are locked; the quarter currently due for review can still be issued here."
        breadcrumbs={[{ label: 'Home' }, { label: 'Feedback' }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Faculty list + search */}
        <Card className="h-fit">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or ID..."
              className="w-full border border-surface-border rounded pl-8 pr-3 py-2 text-sm bg-surface-base focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {loading ? (
            <div className="text-sm text-ink-muted px-1">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-ink-muted px-1">{rows.length === 0 ? 'No faculty found.' : 'No match.'}</div>
          ) : (
            <ul className="space-y-1 max-h-[70vh] overflow-y-auto">
              {filtered.map((r) => {
                const active = selected?.faculty.id === r.faculty.id;
                return (
                  <li key={r.faculty.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded border transition-colors ${
                        active ? 'bg-primary-50 border-primary-300' : 'bg-surface-base border-surface-border hover:bg-surface-muted'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink-primary truncate">{r.faculty.name}</span>
                        <span className="block text-xs text-ink-muted">{r.faculty.employeeCode}</span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0">
                        {r.issuedQuarters.length > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                            {r.issuedQuarters.length} issued
                          </span>
                        )}
                        <ChevronRight size={15} className="text-ink-muted" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Selected faculty's feedback */}
        <div>
          {selected ? (
            <div>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-ink-primary">{selected.faculty.name}</h2>
                <p className="text-xs text-ink-muted">{selected.faculty.employeeCode} · {selected.academicYear.label}</p>
              </div>
              <FeedbackSection key={selected.submissionId} submissionId={selected.submissionId} />
            </div>
          ) : (
            <Card>
              <div className="flex flex-col items-center justify-center text-center py-12 text-ink-muted">
                <MessageSquare size={28} className="mb-2 text-ink-subtle" />
                <p className="text-sm">Pick a faculty member to view their feedback.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
