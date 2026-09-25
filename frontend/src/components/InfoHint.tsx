import { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface InfoHintProps {
  /** Short heading for the popover, e.g. the feature name. */
  title?: string;
  /** How-to text. A string, or several paragraphs / bullet lines. */
  children: React.ReactNode;
  /** Which side the bubble opens toward when there is room. */
  side?: 'right' | 'left';
  /** Extra classes for the trigger button (sizing / colour tweaks). */
  className?: string;
}

/**
 * A "?" button that reveals a short how-to for the feature it sits beside.
 *
 * Sits next to a page title, a section heading, or a single control, so the
 * explanation of how to use a feature lives right where the feature is instead
 * of in a separate manual. Click (or focus + Enter) opens the bubble; clicking
 * away, pressing Escape, or clicking the button again closes it. The trigger is
 * a real button with an aria-label so it is reachable by keyboard and screen
 * readers.
 */
export default function InfoHint({ title, children, side = 'right', className = '' }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={title ? `How to use: ${title}` : 'How this works'}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex items-center justify-center text-ink-subtle hover:text-primary-600 focus:outline-none focus:text-primary-600 transition-colors ${className}`}
      >
        <HelpCircle size={15} />
      </button>
      {open && (
        <div
          id={panelId}
          role="tooltip"
          className={`absolute z-30 top-6 ${side === 'right' ? 'left-0' : 'right-0'} w-72 max-w-[80vw] rounded-md border border-surface-border bg-surface-card shadow-lg p-3 text-left`}
        >
          {title && <p className="text-xs font-semibold text-ink-primary mb-1">{title}</p>}
          <div className="text-xs text-ink-secondary leading-relaxed space-y-1.5">
            {typeof children === 'string' ? <p>{children}</p> : children}
          </div>
        </div>
      )}
    </span>
  );
}
