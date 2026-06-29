'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

const intensityClass = {
  subtle: 'glass-subtle',
  default: 'glass',
  strong: 'glass-strong',
};

/**
 * The workhorse frosted-glass surface. Reuse everywhere a panel of content
 * sits on top of the aurora background.
 */
export const GlassCard = React.forwardRef(
  ({ className, intensity = 'default', interactive = false, highlight = true, children, ...props }, ref) => {
    const reduce = useReducedMotion();
    return (
      <motion.div
        ref={ref}
        whileHover={
          interactive && !reduce
            ? { y: -4, transition: { type: 'spring', stiffness: 300, damping: 22 } }
            : undefined
        }
        className={cn(
          intensityClass[intensity],
          highlight && 'glass-highlight',
          'rounded-2xl',
          interactive && 'cursor-pointer transition-shadow hover:shadow-glow',
          className,
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);
GlassCard.displayName = 'GlassCard';
