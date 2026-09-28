'use client';

/**
 * The landing page header.
 *
 * Transparent over the hero, then it takes on a surface and a hairline once the
 * page scrolls. That is a small amount of state, but it is what lets the hero
 * image run full-bleed under the nav instead of starting below a white bar.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Logo } from './visuals';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '#problem', label: 'The problem' },
  { href: '#how', label: 'How it works' },
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#scenarios', label: 'Sites' },
  { href: '#rigour', label: 'Rigour' },
];

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Lock the page while the mobile sheet is open, so the background does not
     scroll behind it. */
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-colors duration-200',
        scrolled || open ? 'border-b bg-background' : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size={30} className="text-primary" />
          <span className="font-display text-[15px] font-bold tracking-[-0.02em]">
            Thermal Shelter
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="btn-ghost hidden sm:inline-flex">
            Sign in
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Open dashboard
            <ArrowRight size={14} aria-hidden />
          </Link>

          <button
            type="button"
            className="btn-ghost -mr-2 px-2 lg:hidden"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t bg-background lg:hidden"
          >
            <nav className="mx-auto flex w-full max-w-[1200px] flex-col px-5 py-3 sm:px-8">
              {SECTIONS.map((section) => (
                <a
                  key={section.href}
                  href={section.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  {section.label}
                </a>
              ))}
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="mt-2 rounded-lg px-3 py-2.5 text-[14px] font-semibold text-primary"
              >
                Sign in
              </Link>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
