'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCalm } from '@/lib/lite-mode';

const toneIcon = {
  default: 'bg-primary/12 text-primary ring-primary/20',
  success: 'bg-success/12 text-success ring-success/20',
  warning: 'bg-warning/15 text-amber-600 ring-warning/25 dark:text-amber-300',
  info: 'bg-info/12 text-info ring-info/20',
  destructive: 'bg-destructive/12 text-destructive ring-destructive/20',
};

/**
 * TEEN NAAP, AUR DONO PROP KA KAAM ALAG HAI:
 *
 *  • `compact`      — HAR naap par chhota. Ek kataar me BAHUT saare tile ho (dossier me
 *                     saat hain) tab. Poore size par saat-ka-row "From home" ko do line
 *                     aur "3h 13m" ko teen line me tod deta tha.
 *  • `tightOnPhone` — SIRF phone par chhota, `sm` (640px) se upar poora. Jab tile phone
 *                     par do-do ki kataar me aate hain: aadhi chaudai me poora size
 *                     bhadda lagta hai, par laptop par wahi tile poore chahiye.
 *                     (Owner ka faisla 20 Nov 2026 — dashboard ke "Team today" tile.)
 *
 * Dono ek saath dene ki zaroorat nahi: `compact` upar bhaari padta hai.
 */
export function StatCard({ label, value, icon: Icon, hint, tone = 'default', trend, compact = false, tightOnPhone = false, className }) {
  // Ek jagah tay, taaki chhe jagah `compact ? … : tight ? … : …` na likhna pade.
  const pick = (full, phone, small) => (compact ? small : tightOnPhone ? phone : full);
  const reduce = useReducedMotion();
  // Lite mode me ye entrance BAND (owner, 28 Nov 2026). Dashboard par ek saath 13 card
  // uthte hain, 450ms har ek — nirī sajawat, aur theek us phone par jiske liye Lite hai.
  //
  // PEHLE SIRF `duration: 0` kiya tha — aur browser me chala kar dekha ki usse 20 me se
  // 9 card GAYAB ho gaye (`opacity: 0; translateY(10px)` par jam gaye). Wajah: `useCalm`
  // apna jawab effect ke BAAD deta hai, to dashboard ka data aane par jo card BAAD me
  // mount hote hain wo pehle hi render se `duration: 0` paate hain — framer unhe apni
  // shuruaati (invisible) haalat se hilata hi nahi.
  //
  // Isliye `initial` bhi band karna padta hai: `initial={false}` par framer element ko
  // seedha apni aakhri haalat me rakhta hai, animate karta hi nahi. Yahi raasta `reduce`
  // ke liye pehle se chal raha hai, to ye aajmaaya hua hai.
  //
  // `animate` ko chhua NAHI: jo card flip se PEHLE mount ho chuke hain wo beech raaste me
  // hain, aur unka target chhin lene par wo wahin jam jaate.
  const { still } = useCalm();
  const calm = reduce || still;
  const TrendIcon =
    trend?.direction === 'up' ? ArrowUpRight : trend?.direction === 'down' ? ArrowDownRight : Minus;
  const trendColor =
    trend?.direction === 'up'
      ? 'text-success'
      : trend?.direction === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <motion.div
      initial={calm ? false : { opacity: 0, y: 10 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: still ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn('glass glass-highlight rounded-2xl', pick('p-5', 'p-3.5 sm:p-5', 'p-4'), className)}
    >
      <div className={cn('flex items-start justify-between', pick('gap-3', 'gap-2 sm:gap-3', 'gap-2'))}>
        <div className="min-w-0 space-y-1">
          <p className={cn('font-medium text-muted-foreground', pick('text-sm', 'text-xs sm:text-sm', 'text-xs'))}>{label}</p>
          <p
            className={cn(
              'font-semibold tracking-tight tabular-nums',
              pick('break-words text-2xl sm:text-3xl', 'break-words text-xl sm:text-3xl', 'whitespace-nowrap text-xl'),
            )}
          >
            {value}
          </p>
        </div>
        {Icon ? (
          <span
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl ring-1',
              pick('size-11', 'size-8 sm:size-11', 'size-9'),
              toneIcon[tone],
            )}
          >
            <Icon className={pick('size-5', 'size-4 sm:size-5', 'size-4')} />
          </span>
        ) : null}
      </div>

      {(trend || hint) && (
        <div className={cn('flex items-center gap-2', pick('mt-4 text-sm', 'mt-2 text-xs sm:mt-4 sm:text-sm', 'mt-2.5 text-xs'))}>
          {trend ? (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', trendColor)}>
              <TrendIcon className="size-4" />
              {trend.value}
            </span>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      )}
    </motion.div>
  );
}
