interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  color?: 'primary' | 'accent' | 'success' | 'warning' | 'danger';
}

const colorMap = {
  primary: 'text-primary-600 bg-primary-50',
  accent:  'text-accent-600 bg-accent-50',
  success: 'text-success-500 bg-emerald-50',
  warning: 'text-warning-500 bg-amber-50',
  danger:  'text-danger-500 bg-red-50',
};

export default function StatTile({ icon, label, value, hint, color = 'primary' }: StatTileProps) {
  return (
    <div className="lift bg-surface-card border border-surface-border rounded-md shadow-sm p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-xl font-bold text-ink-primary leading-tight tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-ink-subtle mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}
