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
        {/* Catch the browser's install offer the instant it arrives.
            Chrome fires `beforeinstallprompt` within a moment of load, long before the
            authenticated shell mounts — the old listener lived in there, waiting on the
            /auth/me round-trip, so on a fresh device the event was simply missed. The app
            then believed it could not be installed, hid its own Install button, and sent
            people to the browser menu instead. Stashing it on `window` here means the
            React card can pick it up whenever it mounts, however late.
            IMPORTANT: this event only fires when the app is NOT already installed on THIS
            device, which makes it the most reliable per-device signal we have. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{window.__omInstallEvent=null;window.__omInstalled=false;addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__omInstallEvent=e;window.__omInstalled=false;dispatchEvent(new Event('pwa-installable'))});addEventListener('appinstalled',function(){window.__omInstallEvent=null;window.__omInstalled=true;dispatchEvent(new Event('pwa-installed'))})}catch(e){}",
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
