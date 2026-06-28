'use client';

import { type ReactNode } from 'react';
import { Activity, CalendarDays, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

// Scoped, static CSS for the auth "brand stage" + form-side polish. Injected once per
// auth page via a plain <style> (no user input → SSR-safe, no dangerouslySetInnerHTML).
const PD_STYLES = `
  @keyframes pd-rise {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pd-aurora {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33%      { transform: translate(7%, -5%) scale(1.12); }
    66%      { transform: translate(-6%, 6%) scale(1.06); }
  }
  @keyframes pd-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-12px); }
  }
  @keyframes pd-pulse-draw {
    0%        { stroke-dashoffset: 1400; }
    70%, 100% { stroke-dashoffset: 0; }
  }
  @keyframes pd-shimmer {
    100% { transform: translateX(220%); }
  }

  .pd-rise { animation: pd-rise .62s cubic-bezier(.16, 1, .3, 1) both; }

  /* ===== Brand stage (always a dark "stage", regardless of theme) ===== */
  .pd-stage {
    background:
      radial-gradient(125% 85% at 100% 0%, hsl(20 100% 50% / 0.14), transparent 55%),
      linear-gradient(155deg, hsl(220 16% 10%), hsl(223 20% 6%));
  }
  .pd-aurora {
    position: absolute;
    border-radius: 50%;
    filter: blur(64px);
    opacity: 0.55;
    mix-blend-mode: screen;
    pointer-events: none;
  }
  .pd-aurora-1 {
    width: 30rem; height: 30rem; left: -8rem; top: -6rem;
    background: radial-gradient(circle, hsl(20 100% 55% / 0.95), transparent 65%);
    animation: pd-aurora 17s ease-in-out infinite;
  }
  .pd-aurora-2 {
    width: 26rem; height: 26rem; right: -7rem; bottom: -5rem;
    background: radial-gradient(circle, hsl(30 100% 52% / 0.8), transparent 65%);
    animation: pd-aurora 21s ease-in-out infinite reverse;
  }
  .pd-stage-grid {
    position: absolute; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(hsl(0 0% 100% / 0.05) 1px, transparent 1px),
      linear-gradient(90deg, hsl(0 0% 100% / 0.05) 1px, transparent 1px);
    background-size: 46px 46px;
    -webkit-mask-image: radial-gradient(ellipse at 28% 42%, black, transparent 78%);
            mask-image: radial-gradient(ellipse at 28% 42%, black, transparent 78%);
  }
  .pd-pulse path {
    stroke-dasharray: 1400;
    stroke-dashoffset: 1400;
    animation: pd-pulse-draw 6s cubic-bezier(.6, 0, .2, 1) infinite;
    filter: drop-shadow(0 0 6px hsl(20 100% 55% / 0.6));
  }
  .pd-chip {
    display: grid; place-items: center;
    width: 3.25rem; height: 3.25rem;
    border-radius: 1rem;
    background: hsl(0 0% 100% / 0.07);
    border: 1px solid hsl(0 0% 100% / 0.13);
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    color: hsl(22 100% 72%);
    box-shadow: 0 12px 34px hsl(220 45% 2% / 0.55);
    animation: pd-float 6.5s ease-in-out infinite;
  }

  /* ===== Form side ===== */
  .pd-dots {
    background-image: radial-gradient(hsl(var(--foreground) / 0.05) 1px, transparent 1.5px);
    background-size: 22px 22px;
  }
  .pd-dots::before {
    content: '';
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(80% 50% at 50% -10%, hsl(var(--primary) / 0.08), transparent 70%);
  }
  .pd-field { border-radius: var(--radius); transition: box-shadow .2s ease; }
  .pd-field:focus-within { box-shadow: 0 0 0 4px hsl(var(--ring) / 0.14); }
  .pd-field:focus-within .pd-icon { color: hsl(var(--primary)); }
  .pd-icon { transition: color .2s ease; }

  .pd-shimmer {
    position: absolute; inset: 0;
    transform: translateX(-120%);
    background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.28), transparent);
    pointer-events: none;
  }
  .group:hover .pd-shimmer { animation: pd-shimmer .9s ease; }

  @media (prefers-reduced-motion: reduce) {
    .pd-rise, .pd-aurora, .pd-chip, .pd-pulse path, .pd-shimmer { animation: none !important; }
    .pd-rise { opacity: 1 !important; transform: none !important; }
    .pd-pulse path { stroke-dashoffset: 0 !important; }
  }
`;

interface AuthShellProps {
  /** Form-side heading (already translated). */
  title: string;
  /** Optional form-side sub-heading (already translated). */
  description?: string;
  /** The form (and any banners) for this auth page. */
  children: ReactNode;
}

/**
 * Shared two-panel scaffold for all auth pages (login / forgot-password / reset-password):
 * a dark animated brand stage on the left and a focused, dotted form panel on the right,
 * with the theme + language switchers pinned top-right. Built on the app's color tokens.
 */
export function AuthShell({ title, description, children }: AuthShellProps) {
  const { t } = useTranslation();

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background lg:grid-cols-[1.05fr_minmax(0,1fr)]">
      <style>{PD_STYLES}</style>

      {/* ===== Brand stage — hidden on small screens ===== */}
      <aside className="pd-stage relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div aria-hidden className="pd-aurora pd-aurora-1" />
        <div aria-hidden className="pd-aurora pd-aurora-2" />
        <div aria-hidden className="pd-stage-grid" />

        {/* Signature "pulse" line */}
        <svg
          aria-hidden
          className="pd-pulse pointer-events-none absolute inset-x-0 top-1/2 -z-0 h-40 w-full -translate-y-1/2 opacity-80"
          viewBox="0 0 1200 200"
          fill="none"
          preserveAspectRatio="none"
        >
          <path
            d="M0 100 H360 l28 -64 l34 128 l30 -150 l34 150 l26 -64 H760 l40 -38 l30 38 H1200"
            stroke="hsl(20 100% 56%)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Floating product glints (decorative) */}
        <div aria-hidden className="pd-chip absolute right-16 top-24" style={{ animationDelay: '0s' }}>
          <CalendarDays className="h-5 w-5" />
        </div>
        <div aria-hidden className="pd-chip absolute right-28 top-1/2" style={{ animationDelay: '1.1s' }}>
          <Users className="h-5 w-5" />
        </div>
        <div aria-hidden className="pd-chip absolute bottom-28 right-20" style={{ animationDelay: '2.2s' }}>
          <Activity className="h-5 w-5" />
        </div>

        {/* Top — wordmark */}
        <div className="pd-rise relative z-10 flex items-center gap-3">
          <BrandMark className="h-10 w-10 text-lg" />
          <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
        </div>

        {/* Middle — hero */}
        <div className="pd-rise relative z-10 max-w-md" style={{ animationDelay: '.08s' }}>
          <h1 className="text-[2.6rem] font-extrabold leading-[1.08] tracking-tight">
            {t('app.tagline')}
          </h1>
          <div className="mt-8 flex items-center gap-2.5 text-sm text-white/55">
            <span className="h-px w-10 bg-gradient-to-r from-primary to-transparent" />
            <span className="font-mono uppercase tracking-[0.2em]">{t('app.name')}</span>
          </div>
        </div>

        {/* Bottom — meta */}
        <div className="pd-rise relative z-10 text-xs text-white/45" style={{ animationDelay: '.16s' }}>
          © {new Date().getFullYear()} PulseDesk
        </div>
      </aside>

      {/* ===== Form side ===== */}
      <section className="pd-dots relative flex min-h-screen items-center justify-center px-5 py-12">
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>

        <div className="relative z-10 w-full max-w-[26rem]">
          {/* Compact wordmark for mobile (stage is hidden there) */}
          <div className="pd-rise mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="h-9 w-9" />
            <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
          </div>

          <div className="pd-rise mb-7" style={{ animationDelay: '.05s' }}>
            <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}
