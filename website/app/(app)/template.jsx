'use client';

import { motion, useReducedMotion } from 'framer-motion';

/**
 * A gentle cross-page transition. A `template` (unlike a `layout`) re-mounts on every
 * navigation, so wrapping the page here gives each route a soft fade-in instead of a hard
 * cut when you click a link.
 *
 * Deliberately opacity-only: a transform would turn this wrapper into a containing block
 * and could displace `position: fixed` children, so we animate just opacity. Honours the
 * OS "reduce motion" setting by rendering the page with no animation at all.
 */
export default function Template({ children }) {
  const reduce = useReducedMotion();
  if (reduce) return children;
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
