'use client';

import { cn } from '@/lib/utils';
import { useSettings, usePublicBranding } from '@/lib/settings';

/**
 * ManagiBot ek PRODUCT hai jo companies ko diya jaata hai. Isliye:
 *
 *   • Product ka logo (ManagiBot) HAR JAGAH — login, sidebar, header, app icon. Ye CODE se
 *     aata hai (`public/brand/`); Settings se kabhi nahi badalta, chahe jo ho jaye.
 *   • Client (company) apna logo Settings → Branding se upload karta hai, aur wo SIRF EK
 *     jagah dikhta hai: login ke baad sidebar me, ManagiBot ke theek neeche
 *     (`showClient`). Aur kahin nahi — na login par, na header par, na app icon me.
 *
 * `compact` (phone ka header): sirf product ka gol nishaan.
 * `size="topbar"`: 56px ki patti ke liye chhota.
 */
export const PRODUCT_NAME = 'ManagiBot';
export const PRODUCT_LOGO = '/brand/managibot.webp';
export const PRODUCT_MARK = '/brand/managibot-mark.webp';

export function Brand({ className, compact = false, size = 'sidebar', showClient = false }) {
  const { data: settings } = useSettings();
  const { data: branding } = usePublicBranding();
  const b = settings || branding;
  const name = b?.companyName?.trim() || '';

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
  const light = showClient ? (b?.logoLight || b?.logoDark || b?.logoUrl || '').trim() : '';
  const dark = showClient ? (b?.logoDark || b?.logoUrl || b?.logoLight || '').trim() : '';

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

      {/* 2. Client — sirf sidebar me (showClient); logo na ho to company ka naam */}
      {showClient ? (
        light || dark ? (
          <span className="flex items-center">
            {light ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={light} alt={name} className="block h-7 w-auto max-w-[180px] object-contain dark:hidden" />
            ) : null}
            {dark ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dark} alt={name} className="hidden h-7 w-auto max-w-[180px] object-contain dark:block" />
            ) : null}
          </span>
        ) : name ? (
          <p className="max-w-[180px] truncate text-xs font-medium tracking-tight text-muted-foreground">{name}</p>
        ) : null
      ) : null}
    </div>
  );
}
