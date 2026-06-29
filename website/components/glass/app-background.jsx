'use client';

import { useSettings } from '@/lib/settings';
import { AuroraBackground } from './aurora-background';

/**
 * The app background. If a custom background image is uploaded (separate light /
 * dark versions, toggled by theme via CSS), it renders that photo — blurred and
 * toned for readability behind the glass UI. Otherwise it falls back to the
 * ambient aurora background, so it always looks good with no asset required.
 */
export function AppBackground() {
  const { data: settings } = useSettings();
  const light = (settings?.bgLight || settings?.bgDark || '').trim();
  const dark = (settings?.bgDark || settings?.bgLight || '').trim();

  if (!light && !dark) return <AuroraBackground />;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {light ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={light} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover dark:hidden" />
      ) : null}
      {dark ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dark} alt="" className="absolute inset-0 hidden h-full w-full scale-105 object-cover dark:block" />
      ) : null}
      {/* readability + theme tint over the photo */}
      <div className="absolute inset-0 bg-background/40 backdrop-blur-[3px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/10 to-background/65" />
    </div>
  );
}
