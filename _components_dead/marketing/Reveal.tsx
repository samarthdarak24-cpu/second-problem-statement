'use client';

/**
 * Scroll reveal.
 *
 * `once: true` matters: an element that re-animates every time it re-enters the
 * viewport makes a long page feel restless, and on a page that is mostly
 * reading, motion should mark arrival and then get out of the way.
 *
 * The motion is deliberately small — 14 px and a fade. Anything larger reads as
 * a transition rather than as content settling.
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Seconds. Used to stagger siblings. */
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
