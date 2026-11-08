import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import type { TrackingRow } from '../api/tracking';
import Card from './Card';

const TIER_STYLE: Record<string, string> = {
  T1: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  T2: 'bg-blue-50 text-blue-700 border-blue-200',
  T3: 'bg-amber-50 text-amber-700 border-amber-200',
  T4: 'bg-purple-50 text-purple-700 border-purple-200',
};

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-ink-muted">—</span>;
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${TIER_STYLE[tier]}`}>{tier}</span>;
}

function StatusBadge({ done }: { done: boolean }) {
  return done
    ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Verified</span>
    : <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Pending</span>;
}

type OnSetTier = (userId: string, tier: string | null, reason?: string | null) => void;

function TierControl({ row, onSave }: { row: TrackingRow; onSave: (tier: string | null, reason: string | null) => void }) {
  const [tier, setTierLocal] = useState<string | null>(row.tier);
  const [reason, setReason] = useState(row.tierReason ?? '');
  useEffect(() => {
    setTierLocal(row.tier);
    setReason(row.tierReason ?? '');
  }, [row.tier, row.tierReason]);
  const verified = row.academicVerified && row.deanVerified;
  const needsReason = tier === 'T3' || tier === 'T4';
  const dirty = tier !== row.tier || reason.trim() !== (row.tierReason ?? '').trim();

  const choose = (v: string | null) => {
    setTierLocal(v);
    if (v !== 'T3' && v !== 'T4') onSave(v, null);
  };
  const save = () => {
    if (needsReason && !reason.trim()) {
      toast.error('Justification required for Tier 3/4');
      return;
    }
    onSave(tier, needsReason ? reason.trim() : null);
  };

  return (
    <div className="space-y-1 min-w-[9rem]">
      <select
        value={tier ?? ''}
        onChange={(e) => choose(e.target.value || null)}
        disabled={!verified}
        className="text-xs border border-surface-border rounded px-1.5 py-1 bg-surface-base focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        title={verified ? 'Assign tier' : 'Verify at department and dean level first'}
      >
        <option value="">—</option>
        <option value="T1">T1</option>
        <option value="T2">T2</option>
        <option value="T3">T3</option>
        <option value="T4">T4</option>
      </select>
      {!verified && <div className="text-[10px] text-ink-muted">Verify at department and dean level first</div>}
      {verified && needsReason && (
        <>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Justification (required)"
            className="block w-full text-xs border border-surface-border rounded px-1.5 py-1 bg-surface-base focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            className="text-[11px] px-2 py-0.5 rounded bg-primary-600 text-white hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </>
      )}
    </div>
  );
}

const HEADERS = [
  'Faculty Name', 'Designation', 'Department', 'Cadre', 'Experience (Years)', 'Reviewed Total',
  'Feedback Score', 'Indexed Publications', 'Journal Publications', 'Patents', 'Projects',
  'Department Verification', 'Dean Verification', 'Tier', 'Action',
];

export default function ConsolidatedFacultyTable({
  rows,
  canAllocate,
  onSetTier,
}: {
  rows: TrackingRow[];
  canAllocate: boolean;
  onSetTier: OnSetTier;
}) {
  const navigate = useNavigate();
  if (rows.length === 0) {
    return <Card><div className="text-sm text-ink-muted py-4 text-center">No faculty to show.</div></Card>;
  }
  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-primary-700 text-white text-xs">
              {HEADERS.map((h) => <th key={h} className="text-left px-3 py-2.5 font-medium border border-primary-800 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.submissionId} className="border-b border-surface-border hover:bg-surface-muted/40 align-top">
                <td className="px-3 py-2 font-medium text-ink-primary">{r.faculty.name}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.faculty.designation}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.department?.name ?? '—'}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.cadreLabel ?? 'Unassigned'}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.expYears}</td>
                <td className="px-3 py-2 text-ink-primary">{r.actuals.totalScore} / {r.scoreScale}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.actuals.feedback}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.actuals.indexedCount}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.actuals.journalCount}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.actuals.patentCount}</td>
                <td className="px-3 py-2 text-ink-secondary">{r.actuals.projectCount}</td>
                <td className="px-3 py-2"><StatusBadge done={r.academicVerified} /></td>
                <td className="px-3 py-2"><StatusBadge done={r.deanVerified} /></td>
                <td className="px-3 py-2">
                  {canAllocate
                    ? <TierControl row={r} onSave={(t, reason) => onSetTier(r.faculty.id, t, reason)} />
                    : <TierBadge tier={r.tier} />}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => navigate('/proofs/' + r.submissionId)}
                    className="text-xs px-2.5 py-1 rounded border border-primary-600 text-primary-700 hover:bg-primary-50 whitespace-nowrap"
                  >
                    Verify Proofs
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
