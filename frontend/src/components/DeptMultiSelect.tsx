import { useState } from 'react';
import { PROJECT_DEPARTMENTS } from '../constants/departments';

interface Props {
  value: string;
  onChange: (v: string) => void;
  label: string;
}

const KNOWN: readonly string[] = PROJECT_DEPARTMENTS;

// Split the stored comma-joined string back into known departments and "other"
// leftovers. Some department names contain ", " themselves (e.g. "CSE(CYE, DS)
// and AI & DS"), so a plain split would break them — match the longest known
// name starting at each token instead.
function parse(value: string): { selected: Set<string>; other: string } {
  const tokens = (value ?? '').split(', ').map((t) => t.trim()).filter(Boolean);
  const selected = new Set<string>();
  const others: string[] = [];
  let j = 0;
  while (j < tokens.length) {
    let matched = 0;
    for (let k = tokens.length; k > j; k--) {
      if (KNOWN.includes(tokens.slice(j, k).join(', '))) { matched = k - j; break; }
    }
    if (matched) {
      selected.add(tokens.slice(j, j + matched).join(', '));
      j += matched;
    } else {
      others.push(tokens[j]);
      j += 1;
    }
  }
  return { selected, other: others.join(', ') };
}

function compose(selected: Set<string>, other: string): string {
  const parts = KNOWN.filter((d) => selected.has(d)) as string[];
  const o = other.trim();
  if (o) parts.push(o);
  return parts.join(', ');
}

export default function DeptMultiSelect({ value, onChange, label }: Props) {
  const { selected, other: otherFromValue } = parse(value);
  const [otherOn, setOtherOn] = useState(!!otherFromValue);
  const [otherText, setOtherText] = useState(otherFromValue);

  const toggle = (dept: string) => {
    const next = new Set(selected);
    if (next.has(dept)) next.delete(dept); else next.add(dept);
    onChange(compose(next, otherOn ? otherText : ''));
  };

  const toggleOther = (on: boolean) => {
    setOtherOn(on);
    onChange(compose(selected, on ? otherText : ''));
  };

  const editOther = (text: string) => {
    setOtherText(text);
    onChange(compose(selected, text));
  };

  return (
    <div className="mb-2">
      <label className="block text-xs font-medium text-ink-secondary mb-1">{label}</label>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {PROJECT_DEPARTMENTS.map((d) => (
          <label key={d} className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <input type="checkbox" checked={selected.has(d)} onChange={() => toggle(d)} />
            {d}
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <input type="checkbox" checked={otherOn} onChange={(e) => toggleOther(e.target.checked)} />
          Other
        </label>
      </div>
      {otherOn && (
        <input
          value={otherText}
          onChange={(e) => editOther(e.target.value)}
          placeholder="Other department(s)"
          className="mt-1.5 w-full border border-surface-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      )}
    </div>
  );
}
