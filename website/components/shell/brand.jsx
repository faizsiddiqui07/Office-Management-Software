'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useSettings, usePublicBranding } from '@/lib/settings';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * ManagiBot ek PRODUCT hai jo companies ko diya jaata hai. Isliye:
 *
 *   • Product ka logo (ManagiBot) HAR JAGAH — login, sidebar, header, app icon. Ye CODE se
 *     aata hai (`public/brand/`); Settings se kabhi nahi badalta, chahe jo ho jaye.
 *   • Client (company) apna logo Settings → Branding se upload karta hai, aur wo SIRF EK
 *     jagah dikhta hai: login ke baad sidebar me, ManagiBot ke theek neeche
 *     (`showClient`). Logo na ho to wahan KUCH NAHI — naam bhi nahi (owner ka niyam).
 *     Logo S3 se aane tak wahan skeleton — taaki user ko pata rahe kuch load ho raha hai.
 *
 * `compact` (phone ka header): sirf product ka gol nishaan.
 * `size="topbar"`: 56px ki patti ke liye chhota.
 */
export const PRODUCT_NAME = 'ManagiBot';
export const PRODUCT_LOGO = '/brand/managibot.webp';
export const PRODUCT_MARK = '/brand/managibot-mark.webp';
export const PRODUCT_TAGLINE = 'ManagiBot | A product of BrainQbit';
export const PRODUCT_SITE = 'https://www.brainqbit.com';

export function Brand({ className, compact = false, size = 'sidebar', showClient = false }) {
  const settings = useSettings();
  const branding = usePublicBranding();
  const b = settings.data || branding.data;
  // Dono query abhi jawab nahi laayi → client ka logo hai ya nahi, ye pata hi nahi.
  const pending = !b && (settings.isLoading || branding.isLoading);

  // Product logo ke neeche hamesha SAFED chip: logo navy+blue hai, dark theme aur login ke
  // purple panel par seedha rakhne se "Managi" dab jaata tha. Chip par rang waise ke waise.
  if (compact) {
    return (
      <div className={cn('flex items-center', className)}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PRODUCT_MARK} alt={PRODUCT_NAME} className="size-full object-contain" />
        </span>
      </div>
    );
  }

  const topbar = size === 'topbar';

  return (
    <div className={cn('flex min-w-0 flex-col items-start', topbar ? 'gap-0.5' : 'gap-1.5', className)}>
      {/* 1. Product — fixed, safed chip par */}
      <span className={cn('inline-flex items-center rounded-lg bg-white shadow-sm ring-1 ring-black/5', topbar ? 'px-1.5 py-0.5' : 'px-2 py-1')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={PRODUCT_LOGO}
          alt={PRODUCT_NAME}
          className={cn('block w-auto object-contain', topbar ? 'h-[18px] max-w-[120px]' : 'h-7 max-w-[170px]')}
        />
      </span>

      {/* 2. Client — sirf sidebar me */}
      {showClient ? <ClientLogo b={b} pending={pending} /> : null}
    </div>
  );
}

/**
 * Client ka logo, teen haalat:
 *   • settings abhi aa rahi hain → skeleton
 *   • logo hai, par S3 se image abhi utri nahi → skeleton (img ke onLoad tak)
 *   • logo hai hi nahi → kuch nahi
 */
function ClientLogo({ b, pending }) {
  const light = (b?.logoLight || b?.logoDark || b?.logoUrl || '').trim();
  const dark = (b?.logoDark || b?.logoUrl || b?.logoLight || '').trim();
  const [loaded, setLoaded] = React.useState(false);
  const key = `${light}|${dark}`;
  React.useEffect(() => { setLoaded(false); }, [key]); // logo badla → phir se intezaar

  if (pending) return <Skeleton className="h-7 w-[140px] rounded-md" />;
  if (!light && !dark) return null;

  return (
    <span className="relative flex items-center">
      {!loaded ? <Skeleton className="h-7 w-[140px] rounded-md" /> : null}
      <span className={cn('flex items-center', !loaded && 'absolute inset-0 opacity-0')}>
        {light ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={light} alt={b?.companyName || 'Company'} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} className="block h-7 w-auto max-w-[180px] object-contain dark:hidden" />
        ) : null}
        {dark ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dark} alt={b?.companyName || 'Company'} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} className="hidden h-7 w-auto max-w-[180px] object-contain dark:block" />
        ) : null}
      </span>
    </span>
  );
}

/** "ManagiBot | A product of BrainQbit" — login footer aur har page ke neeche. Hardcode. */
export function ProductCredit({ className }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}>
      <span>{PRODUCT_NAME}</span>
      <span aria-hidden>|</span>
      <span>
        A product of{' '}
        <a href={PRODUCT_SITE} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">
          BrainQbit
        </a>
      </span>
    </span>
  );
}
