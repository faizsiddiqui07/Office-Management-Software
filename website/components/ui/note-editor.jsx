'use client';

import * as React from 'react';
import { Bold, Italic, List, ListOrdered, Strikethrough } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { toggleWrap, toggleList, enterInList } from '@/lib/note-editing';

/**
 * Note likhne ka box — Claude ke box jaisa.
 *
 * Teen cheezein:
 *   - upar chhote button: Bold, Italic, kaata hua, bullet list, ginti wali list
 *   - keyboard: Ctrl/Cmd+B, Ctrl/Cmd+I
 *   - "1. kaam" likh kar Enter → agli line apne aap "2. " se shuru; khaali item par
 *     Enter → list wahin khatam
 *
 * Matn SAADA hi rehta hai — markdown ke nishaan ke saath, jaise Claude me. Save bhi
 * waisa hi hota hai; dikhate waqt <RichText> use hota hai. Isliye purane likhe note
 * bina chhue chalte rehte hain aur kahin HTML sanitise karne ki zaroorat nahi.
 *
 * `onChange` seedha nayi value deta hai (event nahi) — yahan value sirf typing se nahi,
 * toolbar aur Enter se bhi badalti hai, to event ka dikhawa karna jhooth hota.
 */
const ACTIONS = [
  { key: 'bold', icon: Bold, label: 'Bold', hint: 'Bold (Ctrl+B)', mark: '**' },
  { key: 'italic', icon: Italic, label: 'Italic', hint: 'Italic (Ctrl+I)', mark: '*' },
  { key: 'strike', icon: Strikethrough, label: 'Strikethrough', hint: 'Strikethrough', mark: '~~' },
  { key: 'ul', icon: List, label: 'Bulleted list', hint: 'Bulleted list', list: 'ul' },
  { key: 'ol', icon: ListOrdered, label: 'Numbered list', hint: 'Numbered list', list: 'ol' },
];

export function NoteEditor({
  id,
  value = '',
  onChange,
  placeholder,
  disabled = false,
  rows,
  maxLength,
  className,
  autoFocus,
}) {
  const ref = React.useRef(null);
  // Cursor ko badlaav ke BAAD rakhna padta hai: React pehle naya matn likhta hai, tabhi
  // selection set karne ka matlab banta hai. Isliye yahan rakh kar effect me lagate hain.
  const nextSel = React.useRef(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    const sel = nextSel.current;
    if (!el || !sel) return;
    nextSel.current = null;
    el.focus({ preventScroll: true });
    el.setSelectionRange(sel.start, sel.end);
  });

  /** Ek badlaav laagu karo aur cursor yaad rakh lo. */
  const apply = (result) => {
    if (!result || disabled) return;
    nextSel.current = { start: result.start, end: result.end };
    onChange?.(result.value);
  };

  const act = (a) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    apply(a.list ? toggleList(value, s, e, a.list) : toggleWrap(value, s, e, a.mark));
  };

  const onKeyDown = (ev) => {
    const el = ref.current;
    if (!el) return;
    const meta = ev.metaKey || ev.ctrlKey;
    if (meta && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === 'b' || k === 'i') {
        ev.preventDefault();
        act(ACTIONS.find((a) => a.key === (k === 'b' ? 'bold' : 'italic')));
        return;
      }
    }
    // Shift+Enter ko haath nahi lagate — wo hamesha saadi nayi line hai, aur jab banda
    // list se bahar nikalna chahe to yahi uska raasta hai.
    if (ev.key === 'Enter' && !ev.shiftKey && !meta) {
      const r = enterInList(value, el.selectionStart, el.selectionEnd);
      if (r) { ev.preventDefault(); apply(r); }
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-center gap-0.5">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            // `onMouseDown` par preventDefault: warna button par click karte hi textarea
            // ka focus (aur uske saath chuna hua matn) chala jaata hai, aur toolbar ko
            // pata hi nahi chalta ki kya lapetna tha.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => act(a)}
            disabled={disabled}
            title={a.hint}
            aria-label={a.label}
            className={cn(
              // Chhune ka ilaaka phone par 36px — toolbar ke chhote button par angootha
              // aksar chook jaata hai.
              'inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground sm:size-7',
              'transition-colors hover:bg-foreground/10 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            <a.icon className="size-4 sm:size-3.5" />
          </button>
        ))}
      </div>
      <Textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        className="bg-background/50"
      />
    </div>
  );
}
