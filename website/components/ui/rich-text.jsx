'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { parseRichText } from '@/lib/rich-text';

/**
 * Note / announcement ka matn — bold, italic, list waghairah ke saath.
 *
 * HTML ki string kabhi nahi banti: parser se mile tukdon se seedha React ke elements
 * bante hain. Isliye `dangerouslySetInnerHTML` kahin nahi hai aur kisi ke likhe note se
 * script chalna namumkin hai. Niyam aur unki wajah lib/rich-text.js me.
 *
 * Jahan ek hi line dikhani ho (dashboard ka preview, notification, PDF) wahan ye NAHI —
 * wahan `plainText()` se nishaan hata kar saada matn dikhao.
 */
function Inline({ nodes }) {
  return nodes.map((n, i) => {
    const key = `${n.type}-${i}`;
    if (n.type === 'text') return <React.Fragment key={key}>{n.value}</React.Fragment>;
    if (n.type === 'bold') return <strong key={key} className="font-semibold"><Inline nodes={n.children} /></strong>;
    if (n.type === 'italic') return <em key={key}><Inline nodes={n.children} /></em>;
    if (n.type === 'strike') return <s key={key} className="opacity-70"><Inline nodes={n.children} /></s>;
    if (n.type === 'code') {
      return (
        <code key={key} className="rounded bg-foreground/[0.08] px-1 py-0.5 font-mono text-[0.9em]">
          {n.value}
        </code>
      );
    }
    if (n.type === 'link') {
      return (
        // `noopener` zaroori hai — bina iske khuli hui site `window.opener` se is tab ko
        // kisi aur pate par bhej sakti hai. Scheme parser me hi http/https tak seemit hai,
        // to `javascript:` jaisa kuch yahan pahunch hi nahi sakta.
        <a
          key={key}
          href={n.href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-primary underline underline-offset-2 hover:opacity-80"
          onClick={(e) => e.stopPropagation()} // row par click = row khulna; link par nahi
        >
          {n.value}
        </a>
      );
    }
    return null;
  });
}

export function RichText({ text, className }) {
  const blocks = React.useMemo(() => parseRichText(text), [text]);
  if (!blocks.length) return null;
  return (
    <div className={cn('space-y-1.5 break-words', className)}>
      {blocks.map((b, i) => {
        if (b.type === 'p') {
          return (
            <p key={`p-${i}`}>
              {b.lines.map((line, j) => (
                <React.Fragment key={`l-${j}`}>
                  {j > 0 ? <br /> : null}
                  <Inline nodes={line} />
                </React.Fragment>
              ))}
            </p>
          );
        }
        const List = b.type === 'ol' ? 'ol' : 'ul';
        return (
          <List
            key={`${b.type}-${i}`}
            // `ps-5` + marker ke liye jagah: lamba text agli line par bullet ke NEECHE
            // nahi, uske saath aligned rehta hai.
            className={cn('ps-5', b.type === 'ol' ? 'list-decimal' : 'list-disc')}
            {...(b.start && b.start !== 1 ? { start: b.start } : {})}
          >
            {b.items.map((item, j) => <li key={`i-${j}`}><Inline nodes={item} /></li>)}
          </List>
        );
      })}
    </div>
  );
}
