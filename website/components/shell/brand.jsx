'use client';

import { cn } from '@/lib/utils';
import { useSettings, usePublicBranding } from '@/lib/settings';

/**
 * Brand = do hisse, upar-neeche:
 *
 *   1. PRODUCT ka logo (ManagiBot) — CODE se aata hai, `public/brand/`. Settings se kabhi
 *      nahi badalta, chahe jo ho jaye. Badalna ho to yahan file badlo. Owner ka faisla:
 *      ye software ka naam hai, client ka nahi.
 *   2. CLIENT ka logo — Settings → Branding se upload hota hai (S3), product logo ke
 *      THEEK NEECHE. Upload na ho to company ka naam text me.
 *
 * `compact` (phone ka topbar, <500px): sirf product ka gol nishaan — wahan do line ki
 * jagah nahi hai. Client ka logo phone par sidebar (menu) me dikhta hai.
 *
 * `size`: 'sidebar' (default — desktop sidebar, mobile menu, login) ya 'topbar' (56px ki
 * patti — dono line chhoti).
 */
export const PRODUCT_NAME = 'ManagiBot';
export const PRODUCT_LOGO = '/brand/managibot.webp';
export const PRODUCT_MARK = '/brand/managibot-mark.webp';

export function Brand({ className, compact = false, size = 'sidebar' }) {
  const { data: settings } = useSettings();
  const { data: branding } = usePublicBranding();
  // Prefer live (authed) settings; fall back to public branding (works on login).
  const b = settings || branding;
  const name = b?.companyName?.trim() || 'Architectus Bureau';

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
  // Client ka wordmark — light/dark alag ho sakte hain, theme ke hisaab se CSS se toggle.
  const light = (b?.logoLight || b?.logoDark || b?.logoUrl || '').trim();
  const dark = (b?.logoDark || b?.logoUrl || b?.logoLight || '').trim();

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

      {/* 2. Client — Settings se; na ho to naam */}
      {light || dark ? (
        <span className="flex items-center">
          {light ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={light} alt={name} className={cn('block w-auto object-contain dark:hidden', topbar ? 'h-[18px] max-w-[130px]' : 'h-7 max-w-[180px]')} />
          ) : null}
          {dark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dark} alt={name} className={cn('hidden w-auto object-contain dark:block', topbar ? 'h-[18px] max-w-[130px]' : 'h-7 max-w-[180px]')} />
          ) : null}
        </span>
      ) : (
        <p className={cn('max-w-[180px] truncate font-medium tracking-tight text-muted-foreground', topbar ? 'text-[11px]' : 'text-xs')}>
          {name}
        </p>
      )}
    </div>
  );
}
