'use client';

import Link from 'next/link';
import { ArrowRight, CalendarDays, ClipboardCheck, CreditCard, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const { t } = useTranslation();

  const features = [
    { icon: Users, label: t('nav.trainees') },
    { icon: CalendarDays, label: t('nav.schedules') },
    { icon: ClipboardCheck, label: t('nav.sessions') },
    { icon: CreditCard, label: t('nav.fees') },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -right-32 top-1/3 h-[26rem] w-[26rem] rounded-full bg-accent/60 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-[20rem] w-[40rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]"
        />
      </div>

      <div className="container mx-auto flex min-h-screen flex-col px-6">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/30">
              <span className="text-base font-bold">P</span>
            </div>
            <span className="text-base font-semibold tracking-tight">{t('app.name')}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/50 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl md:text-7xl">
            {t('app.name')}
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            {t('home.welcome')}
          </p>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground/80">{t('app.tagline')}</p>

          <div className="mt-10">
            <Button
              asChild
              size="lg"
              className="group h-12 gap-2 px-8 text-base shadow-lg shadow-primary/30 transition-shadow hover:shadow-xl hover:shadow-primary/40"
            >
              <Link href="/login">
                {t('home.signIn')}
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </div>

          <div className="mt-20 grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {features.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="group flex flex-col items-center gap-3 rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
