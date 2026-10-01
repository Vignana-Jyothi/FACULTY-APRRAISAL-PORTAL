interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: { label: string; to?: string }[];
  actions?: React.ReactNode;
  /** How-to text for this page — shown behind a "?" beside the title. */
  help?: React.ReactNode;
  /** Override the title's size/font (defaults to a serif text-2xl). */
  titleClassName?: string;
  /** Inline overrides for the title — wins over the global serif heading rule. */
  titleStyle?: React.CSSProperties;
}

import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import InfoHint from './InfoHint';

export default function PageHeader({ title, subtitle, breadcrumbs, actions, help, titleClassName, titleStyle }: PageHeaderProps) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-ink-muted mb-1.5">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={10} className="text-ink-subtle" />}
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-primary-600">{crumb.label}</Link>
              ) : (
                <span className="text-ink-secondary">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 style={titleStyle} className={`font-bold text-ink-primary flex items-center gap-2 ${titleClassName ?? 'text-2xl'}`}>
            {title}
            {help && <InfoHint title={title}>{help}</InfoHint>}
          </h1>
          {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="h-px bg-accent-500/30 mt-3" />
    </div>
  );
}
