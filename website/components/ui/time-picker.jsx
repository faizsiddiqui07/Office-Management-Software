'use client';

import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const pad = (n) => String(n).padStart(2, '0');

/** "18:05" → { h12: 6, minute: 5, pm: true } — or null for '' */
function parts(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const h24 = Number(value.slice(0, 2));
  return { h12: ((h24 + 11) % 12) + 1, minute: Number(value.slice(3, 5)), pm: h24 >= 12 };
}

/** "18:05" → "6:05 PM" for the trigger. The stored value stays 24-hour. */
export function formatPickedTime(value) {
  const p = parts(value);
  if (!p) return '';
  return `${p.h12}:${pad(p.minute)} ${p.pm ? 'PM' : 'AM'}`;
}

function Column({ items, selected, onPick, label, render = (x) => x }) {
  const ref = React.useRef(null);
  // Bring the selected entry into view when the popup opens — a minute column has 60
  // rows and nobody should scroll from 00 to find 45. scrollTop, not scrollIntoView:
  // the latter also scrolls every ancestor, which yanks the page under the popup.
  React.useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector('[data-on="true"]');
    if (box && el) box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }, []);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div ref={ref} className="h-48 overflow-y-auto overscroll-contain rounded-lg bg-foreground/[0.03] p-1">
        {items.map((it) => {
          const on = it === selected;
          return (
            <button
              key={it}
              type="button"
              data-on={on}
              onClick={() => onPick(it)}
              className={cn(
                'flex w-full items-center justify-center rounded-md py-1.5 text-sm tabular-nums transition-colors',
                on ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-foreground/8',
              )}
            >
              {render(it)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/**
 * The app's time picker — hour and minute columns plus AM/PM, instead of the bare
 * native input. Value in and out is the same "HH:mm" 24-hour string the backend
 * already stores (workStart, visitor times, attendance corrections).
 */
export function TimePicker({ value = '', onChange, placeholder = 'Pick a time', disabled = false, id, className, align = 'start' }) {
  const [open, setOpen] = React.useState(false);
  const p = parts(value) || { h12: 10, minute: 0, pm: false }; // a sensible office-morning default

  const commit = (next) => {
    const { h12, minute, pm } = { ...p, ...next };
    const h24 = pm ? (h12 % 12) + 12 : h12 % 12;
    onChange(`${pad(h24)}:${pad(minute)}`);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        render={
          <button
            id={id}
            type="button"
            className={cn(
              'flex h-9 w-full items-center gap-2 rounded-lg border border-input px-3 text-left text-sm transition-[color,border-color,box-shadow] outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          >
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            {value ? (
              <span className="truncate tabular-nums">{formatPickedTime(value)}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align={align} sideOffset={6} className="isolate z-50">
          <Popover.Popup className="w-56 rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex gap-2">
              <Column label="Hour" items={HOURS} selected={p.h12} onPick={(h12) => commit({ h12 })} />
              <Column label="Min" items={MINUTES} selected={p.minute} onPick={(minute) => commit({ minute })} render={pad} />
              <div className="flex flex-col">
                <span className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">&nbsp;</span>
                <div className="flex h-48 flex-col gap-1">
                  {[false, true].map((pm) => (
                    <button
                      key={String(pm)}
                      type="button"
                      onClick={() => commit({ pm })}
                      className={cn(
                        'flex-1 rounded-lg px-2.5 text-sm font-medium transition-colors',
                        p.pm === pm ? 'bg-primary text-primary-foreground' : 'bg-foreground/[0.03] hover:bg-foreground/8',
                      )}
                    >
                      {pm ? 'PM' : 'AM'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2 flex justify-end border-t border-border/50 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                Done
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
