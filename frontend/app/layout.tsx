import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport } from '@/components/toast';
import { ThemeProvider } from 'next-themes';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PulseDesk',
  description: 'Manage trainees, schedules, attendance and payments.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by middleware.ts. next-themes injects an inline script to apply the theme class
  // before paint; without the nonce the CSP blocks it and every load flashes the wrong
  // theme. Reading headers() opts the tree into dynamic rendering — acceptable here,
  // since every route below is an authenticated client-side app.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="bg" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <I18nProvider>
            {/* Outside {children} on purpose: a route change re-renders the page, not this, so a
                confirmation raised just before navigating is still on screen afterwards. */}
            <ToastViewport />
            <AuthProvider>{children}</AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
