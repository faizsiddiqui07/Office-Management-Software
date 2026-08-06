import { Inter } from 'next/font/google';
import './globals.css';

import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/lib/queryClient';
import { AuthProvider } from '@/lib/auth';
import { AppBackground } from '@/components/glass/app-background';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Architectus Bureau',
    template: '%s | Architectus Bureau',
  },
  description: 'Internal office management — attendance, leaves, announcements, and more.',
  applicationName: 'Architectus Bureau',
  // Stop Chrome/Google offering to "translate this page" — the UI is already English
  // and the auto-translate bar kept popping up on open and garbling the labels.
  other: { google: 'notranslate' },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Architectus Bureau', statusBarStyle: 'default' },
  // One icon everywhere — browser tab, install / home-screen, and iOS. /app-icon is a
  // same-origin route that streams the Settings-uploaded icon from S3 (browsers require
  // install icons on the site's own origin; the bytes still live in S3, managed from the
  // website — no image ships with the frontend). ?v busts the previously cached favicon.
  icons: {
    icon: [
      { url: '/app-icon?v=5', sizes: '512x512', type: 'image/png' },
      { url: '/app-icon?v=5', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: ['/app-icon?v=5'],
    apple: [{ url: '/app-icon?v=5', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e16' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" translate="no" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-dvh font-sans antialiased`}>
        {/* Apply the per-device "Lite UI" choice before anything paints, so a slow
            phone never flashes the heavy glass version first. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('om_lite_ui')==='1'){document.documentElement.dataset.lite='true'}}catch(e){}",
          }}
        />
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <TooltipProvider>
                <AppBackground />
                {children}
                <Toaster />
              </TooltipProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
