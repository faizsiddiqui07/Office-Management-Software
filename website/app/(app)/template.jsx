'use client';

import { motion } from 'framer-motion';

import { useCalm } from '@/lib/lite-mode';

/**
 * A gentle cross-page transition. A `template` (unlike a `layout`) re-mounts on every
 * navigation, so wrapping the page here gives each route a soft fade-in instead of a hard
 * cut when you click a link.
 *
 * Deliberately opacity-only: a transform would turn this wrapper into a containing block
 * and could displace `position: fixed` children, so we animate just opacity. Honours the
 * OS "reduce motion" setting by rendering the page with no animation at all.
 *
 * LITE MODE ME BHI BILKUL BAND (owner, 28 Nov 2026). Ye nirī sajawat hai — har navigation
 * par poore page ka 240ms ka fade — aur Lite ka poora maqsad kamzor phone par frames
 * bachana hai. Ye fade CSS ka nahi, framer ka hai, isliye Lite ka CSS wala rule ise chhoo
 * hi nahi pata tha; ab `useCalm()` se JS bhi Lite ko padhta hai.
 */
export default function Template({ children }) {
  const { still } = useCalm();
  if (still) return children;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
