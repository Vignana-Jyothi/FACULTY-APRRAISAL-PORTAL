import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PieChart, ChevronDown, BookOpen, Award, Briefcase, LayoutDashboard } from 'lucide-react';

// The Analytics nav entry as a dropdown: the row links to the overview dashboard;
// hovering (or clicking the chevron) reveals the per-type drill-downs, each a
// filtered view (date window + status) of publications / patents / projects.
const ITEMS: { to: string; label: string; Icon: any }[] = [
  { to: '/analytics', label: 'Overview', Icon: LayoutDashboard },
  { to: '/analytics/publications', label: 'Publications', Icon: BookOpen },
  { to: '/analytics/patents', label: 'Patents', Icon: Award },
  { to: '/analytics/projects', label: 'Projects', Icon: Briefcase },
];

export default function AnalyticsNavMenu({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = location.pathname.startsWith('/analytics');

  const hoverOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const hoverClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 150); };

  return (
    <div className="relative" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <div className={`flex items-center rounded text-sm font-medium transition-colors ${
        active ? 'bg-primary-50 text-primary-700 border-l-2 border-primary-600 -ml-px'
               : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
      }`}>
        <Link to="/analytics" onClick={() => onNavigate?.()} className="flex items-center gap-2.5 px-3 py-2 flex-1">
          <PieChart size={15} className={active ? 'text-primary-600' : 'text-ink-muted'} />
          <span>Analytics</span>
        </Link>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Analytics menu" className="px-2 py-2">
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="mt-0.5 ml-2 pl-2 border-l border-surface-border space-y-0.5">
          {ITEMS.map(({ to, label, Icon }) => {
            const isActive = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => { setOpen(false); onNavigate?.(); }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors ${
                  isActive ? 'bg-primary-50 text-primary-700' : 'text-ink-secondary hover:bg-surface-muted hover:text-ink-primary'
                }`}
              >
                <Icon size={13} className="text-ink-muted shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
