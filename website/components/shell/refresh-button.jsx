'use client';

import * as React from 'react';
import { RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

/** Spinner itni der to ghoome ki tap ka jawab dikh jaaye, chahe jawab turant aa jaye. */
const MIN_SPIN_MS = 450;

/**
 * Is page ka data dobara laata hai — poora page reload nahi, to scroll aur baaki haalat
 * waisi ki waisi rehti hai.
 *
 * Teen cheezein jaan-boojhkar aisi hain, teeno owner ki "iPhone par ye button kuch karta
 * hi nahi" wali shikayat se aayi hain (27 Oct 2026):
 *
 *  1. TAP KA NISHAANA 44px hai. Pehle 32px tha, aur dono taraf 6px par doosre button —
 *     iOS ka apna minimum 44px hai, yaani angootha aksar button par padta hi nahi tha
 *     (ya padosi par pad jaata tha). Dikhne wala gol nishaan utna hi chhota hai; sirf
 *     chhune ka ilaaka bada hai.
 *  2. KUCH HOTA HUA DIKHTA HAI. Pehle data aksar wahi ka wahi hota tha aur spinner ek
 *     frame me gayab — screen par kuch badalta hi nahi tha, to lagta tha button marda
 *     hai. Ab spinner kam se kam MIN_SPIN_MS ghoomta hai aur ant me ek toast aata hai.
 *  3. Poora app taaza hota hai, bekaar ki requests bheje bina. `invalidateQueries()` har
 *     query ko purana (stale) nishaan laga deta hai aur SIRF screen par chal rahi queries
 *     turant dobara laata hai — baaki agle page par jaate hi khud aa jaati hain. Ek baar
 *     maine `refetchType: 'all'` lagaya tha; usse ek hi tap par har bandh page ka data bhi
 *     maanga jaata tha, yaani Lambda par ek saath kai thande container — theek wahi cheez
 *     jiske liye /bootstrap banaya gaya tha.
 *
 * iPhone par ye button aur bhi zaroori hai: home screen wali app me browser ka apna
 * refresh hota hi nahi — na address bar, na pull-to-refresh. Wahan yahi "refresh" hai.
 */
export function RefreshButton() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = React.useState(false);

  const refresh = async () => {
    if (spinning) return;
    setSpinning(true);
    const started = Date.now();
    try {
      // Isme /bootstrap bhi hai (auth ki apni query) — yaani settings, branding, badges,
      // notifications aur chat ki ginti sab dobara aati hai.
      await qc.invalidateQueries();
      toast.success('Up to date');
    } catch {
      toast.error('Could not refresh — check your connection');
    } finally {
      const left = MIN_SPIN_MS - (Date.now() - started);
      if (left > 0) await new Promise((r) => { setTimeout(r, left); });
      setSpinning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={refresh}
      aria-label="Refresh this page"
      aria-busy={spinning}
      title="Refresh this page"
      className={cn(
        // Chhune ka ilaaka 44px (iOS ka minimum), dikhne wala gol utna hi chhota.
        'inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground sm:size-8',
        'transition-colors hover:bg-foreground/5 hover:text-foreground active:bg-foreground/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
    >
      <RotateCw className={cn('size-4 transition-transform', spinning && 'animate-spin')} />
    </button>
  );
}
