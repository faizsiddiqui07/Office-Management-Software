'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';

/**
 * Free-text input that suggests registered people as you type (type "kal" →
 * "Kalpana Saini"). You can still type anyone not in the system.
 */
export function PersonAutocomplete({ id, value, onChange, people = [], placeholder }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  const q = (value || '').toLowerCase().trim();
  const matches = q ? people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6) : [];
  const exact = matches.length === 1 && matches[0].name.toLowerCase() === q;
  const show = open && matches.length > 0 && !exact;

  React.useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        className="bg-background/50"
      />
      {show ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-border/60 bg-card p-1 shadow-glass">
          {matches.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                onChange(p.name);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-foreground/[0.06]"
            >
              <span className="truncate font-medium">{p.name}</span>
              {p.designation ? <span className="shrink-0 truncate text-xs text-muted-foreground">{p.designation}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
