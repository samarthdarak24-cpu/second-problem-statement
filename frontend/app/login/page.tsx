'use client';

/**
 * Sign in.
 *
 * A front-end demo gate. There is no authentication in this project — no user
 * table, no token, no protected route — so the page says so, in the form itself
 * rather than in a footnote. A sign-in screen that implies a control it does not
 * have is the most misleading thing this application could ship.
 *
 * What it does do is behave like a real form: validation with real error states,
 * a pending state, keyboard handling, and a session that survives a reload.
 */

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import { Logo } from '@/components/marketing/visuals';
import { writeSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/* Deliberately permissive. This is a demo gate, not a registration system, and
   a strict pattern here would reject valid addresses for no benefit. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const emailError =
    touched.email && email.length > 0 && !EMAIL_PATTERN.test(email)
      ? 'Enter a valid email address.'
      : touched.email && email.length === 0
        ? 'Email is required.'
        : null;

  const passwordError =
    touched.password && password.length > 0 && password.length < MIN_PASSWORD
      ? `Use at least ${MIN_PASSWORD} characters.`
      : touched.password && password.length === 0
        ? 'Password is required.'
        : null;

  const canSubmit = EMAIL_PATTERN.test(email) && password.length >= MIN_PASSWORD && !pending;

  const onSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    setSubmitError(null);

    if (!EMAIL_PATTERN.test(email) || password.length < MIN_PASSWORD) return;

    setPending(true);
    /*
     * There is nothing to authenticate against. The delay is honest about what
     * would happen here rather than faking a network round-trip.
     */
    await new Promise((resolve) => setTimeout(resolve, 450));
    writeSession(email, remember);
    router.push('/dashboard');
  };

  return (
    <div className="flex min-h-screen">
      {/* ============================================================
          Left — the visual panel (hidden below lg)
          ============================================================ */}
      <aside className="relative hidden w-[46%] shrink-0 lg:block">
        <Image
          src="/images/login-detail.jpg"
          alt="A rammed earth wall in warm terracotta tones, with a crisp shadow cast by a horizontal shading fin"
          fill
          priority
          sizes="46vw"
          className="object-cover"
        />
        {/* A warm scrim so the copy stays legible over any part of the image. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, hsl(24 30% 8% / 0.88) 0%, hsl(24 30% 8% / 0.55) 45%, hsl(24 30% 8% / 0.25) 100%)',
          }}
        />

        <div className="absolute inset-0 flex flex-col justify-between p-10 xl:p-12">
          <Link href="/" className="flex items-center gap-2.5">
            {/* The mark carries its own colour: `currentColor` fills the tile and
                `--primary-foreground` draws the glyph, so inheriting the white
                wordmark colour would flatten it into a blank square. */}
            <Logo size={30} className="text-primary" />
            <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-white/95">
              Thermal Shelter
            </span>
          </Link>

          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-white/60">
              Smart India Hackathon · PS-51
            </p>
            <p className="mt-4 max-w-[420px] font-display text-[27px] font-bold leading-[1.2] tracking-[-0.025em] text-white xl:text-[31px]">
              A shelter designed for its climate, not for a catalogue.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                '33 climatological stations across India',
                'ISO 7730 PMV/PPD and ASHRAE 55 comfort',
                'Parametric envelope, generated not imported',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-[13.5px] text-white/85">
                  <CheckCircle2 size={15} className="shrink-0 text-white/70" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <p className="max-w-[400px] text-[11.5px] leading-relaxed text-white/70">
            Every figure in this application is the output of a simplified monthly heat balance — an
            engineering estimate, not a measurement.
          </p>
        </div>
      </aside>

      {/* ============================================================
          Right — the form
          ============================================================ */}
      <main className="flex flex-1 flex-col">
        {/* Compact brand for the stacked layout. */}
        <div className="flex items-center justify-between border-b px-5 py-4 sm:px-8 lg:justify-end lg:border-0">
          <Link href="/" className="flex items-center gap-2.5 lg:hidden">
            <Logo size={28} className="text-primary" />
            <span className="font-display text-[14px] font-bold tracking-[-0.02em]">
              Thermal Shelter
            </span>
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} aria-hidden />
            Back to site
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[400px]"
          >
            <h1 className="font-display text-[28px] font-bold tracking-[-0.03em]">Sign in</h1>
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              Continue to the design workspace.
            </p>

            {/* ---- The honest bit ---- */}
            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.07] px-3.5 py-3">
              <Info size={15} className="mt-[2px] shrink-0 text-warning" aria-hidden />
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Demo gate — no real sign-in.</span>{' '}
                This project has no authentication backend. Any valid-looking email and an 8-character
                password will let you in, and nothing is sent anywhere.
              </p>
            </div>

            <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
              {/* ---- Email ---- */}
              <div>
                <label htmlFor="email" className="text-[12.5px] font-semibold">
                  Email
                </label>
                <div className="relative mt-2">
                  <Mail
                    size={15}
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    placeholder="you@example.com"
                    aria-invalid={emailError !== null}
                    aria-describedby={emailError ? 'email-error' : undefined}
                    className={cn(
                      'field pl-9',
                      emailError && 'border-destructive focus:border-destructive focus:ring-destructive/25',
                    )}
                  />
                </div>
                {emailError ? (
                  <p id="email-error" role="alert" className="mt-1.5 text-[12px] text-destructive">
                    {emailError}
                  </p>
                ) : null}
              </div>

              {/* ---- Password ---- */}
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="password" className="text-[12.5px] font-semibold">
                    Password
                  </label>
                  <span className="text-[11.5px] text-muted-foreground">
                    min {MIN_PASSWORD} characters
                  </span>
                </div>
                <div className="relative mt-2">
                  <Lock
                    size={15}
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    placeholder="••••••••"
                    aria-invalid={passwordError !== null}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                    className={cn(
                      'field pl-9 pr-10',
                      passwordError &&
                        'border-destructive focus:border-destructive focus:ring-destructive/25',
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {passwordError ? (
                  <p id="password-error" role="alert" className="mt-1.5 text-[12px] text-destructive">
                    {passwordError}
                  </p>
                ) : null}
              </div>

              {/* ---- Remember ---- */}
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                />
                <span className="text-[13px] text-muted-foreground">
                  Keep me signed in on this device
                </span>
              </label>

              {submitError ? (
                <p role="alert" className="text-[12px] text-destructive">
                  {submitError}
                </p>
              ) : null}

              <button type="submit" disabled={!canSubmit} className="btn-primary btn-lg w-full">
                {pending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight size={16} aria-hidden />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-[12.5px] text-muted-foreground">
              Just want to look around?{' '}
              <Link href="/dashboard" className="font-semibold text-primary hover:underline">
                Skip straight to the dashboard
              </Link>
            </p>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
