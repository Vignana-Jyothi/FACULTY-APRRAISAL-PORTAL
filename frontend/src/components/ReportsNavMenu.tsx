import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart2, ChevronDown, Download } from 'lucide-react';
import { reportApi } from '../api/reports';

// The Reports nav entry as a dropdown: clicking the row opens the report list,
// hovering opens it on desktop. Each item downloads straight away for the HoD's
// own department and the open academic year (both inferred server-side when the
// params are omitted). The two quarter-scoped reports use the inline quarter
// picker. The row label still navigates to the full Reports page (every filter).
export default function ReportsNavMenu({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [quarter, setQuarter] = useState('Q1');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = location.pathname.startsWith('/reports');

  const hoverOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const hoverClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 150); };

  const save = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  // key: the item's id (drives the spinner); run: returns [blob, filename].
  const run = async (key: string, fn: () => Promise<{ blob: Blob; name: string }>) => {
    setBusy(key);
    try {
      const { blob, name } = await fn();
      save(blob, name);
    } catch {
      toast.error('Export failed — open Reports to pick a department/year.');
    } finally {
      setBusy(null);
    }
  };

  const items: { key: string; label: string; go: () => Promise<void> }[] = [
    { key: 'scores', label: 'Scores (Criteria-wise)', go: () => run('scores', async () => ({ blob: await reportApi.exportReport({ format: 'excel' }), name: 'scores.xlsx' })) },
    { key: 'consolidated', label: 'Consolidated (Excel)', go: () => run('consolidated', async () => ({ blob: await reportApi.appraisalExcel(), name: 'consolidated.xlsx' })) },
    { key: 'publications', label: 'Publications (Excel)', go: () => run('publications', async () => ({ blob: await reportApi.publicationsExcel(), name: 'publications.xlsx' })) },
    { key: 'quarterly-pdf', label: `Quarterly Summary (PDF) — ${quarter}`, go: () => run('quarterly-pdf', async () => ({ blob: await reportApi.quarterlySummaryPdf({ period: quarter }), name: `quarterly-${quarter}.pdf` })) },
    { key: 'iqac', label: `Quarterly Summary (Excel) — ${quarter}`, go: () => run('iqac', async () => ({ blob: await reportApi.iqacExcel({ period: quarter }), name: `quarterly-summary-${quarter}.xlsx` })) },
  ];

  return (
    <div className="relative" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition-colors ${
          active ? 'bg-primary-50 text-primary-700 border-l-2 border-primary-600 -ml-px'
                 : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
        }`}
      >
        <BarChart2 size={15} className={active ? 'text-primary-600' : 'text-ink-muted'} />
        <span className="flex-1 text-left">Reports</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-0.5 ml-2 pl-2 border-l border-surface-border space-y-0.5">
          {/* Quarter picker for the two quarter-scoped reports. */}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-[11px] text-ink-muted">Quarter</span>
            <select
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              aria-label="Quarter for quarterly reports"
              className="text-xs border border-surface-border rounded px-1.5 py-1 bg-surface-base"
            >
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </div>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={it.go}
              disabled={!!busy}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-ink-secondary hover:bg-surface-muted hover:text-ink-primary disabled:opacity-50 text-left"
            >
              <Download size={13} className="text-ink-muted shrink-0" />
              <span className="flex-1">{busy === it.key ? 'Exporting…' : it.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => { navigate('/reports/department'); onNavigate?.(); }}
            className="w-full px-2.5 py-1.5 rounded text-xs text-primary-700 hover:bg-primary-50 text-left"
          >
            Open Reports (all filters) →
          </button>
        </div>
      )}
    </div>
  );
}
