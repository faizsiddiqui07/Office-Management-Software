'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Check, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RELEASES } from '@/lib/release-notes';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * "WHAT'S NEW" — koi bada update live hone ke baad app pehli baar khole, to sabse pehle
 * yahi dikhta hai (owner ka faisla, 19 Nov 2026).
 *
 * Kya likha hoga: website/lib/release-notes.js. Har update ka ALAG card hai — owner ne
 * saaf kaha tha "har update ka separate hoga taaki confusion na ho" — aur neeche EK
 * checkbox. Tick kiye bina band nahi hota: na X se, na bahar tap karke, na Esc se.
 *
 * BAND NA HONE DENA KAISE: `open` hamesha true hai aur `onOpenChange` sirf tab maanta hai
 * jab checkbox tick ho. Esc ya outside-press par Base UI `onOpenChange(false)` bulata hai,
 * aur hum use chup-chaap gira dete hain. Isliye `dismissible={false}` par bharosa nahi
 * kiya — library ka wo prop sirf outside-press ka hai, Esc ka nahi; yahan dono ek hi
 * rukawat se rukte hain.
 *
 * YAAD SERVER PAR: POST /auth/releases/ack us bande ke `seenReleases` me id daal deta hai.
 * localStorage me rakhte to phone par padh kar laptop par dobara dikhta — aur multi-account
 * switcher ke saath ek device par do logon ki yaad bhi mil jaati.
 * Band karne par modal TURANT chala jaata hai; request peeche chalti rehti hai aur fail ho
 * jaye to agli baar dobara dikh jaayega. Band hone ke liye network ka intezaar karwana —
 * jab asli khabar bas padhni hi thi — galat sauda hai.
 *
 * NAYE BANDE KO PURANI BAATEIN NAHI: jo update uske account banne se PEHLE ka hai wo chhant
 * jaata hai. Warna pehle hi din ko bande ko unn badlavon ki list milti jo usne dekhe hi nahi.
 */
export function WhatsNewDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [agreed, setAgreed] = React.useState(false);
  const [closed, setClosed] = React.useState(false);
  // Checkbox tab tak band rehta hai jab tak poori list neeche tak scroll na ho jaye
  // (owner, 19 Nov 2026) — warna koi bhi bina padhe tick karke nikal sakta tha.
  const [readAll, setReadAll] = React.useState(false);
  // CALLBACK REF (plain useRef nahi): jab tak user load nahi hota ye component `null`
  // lautata hai, yaani pehle render par dabba hota hi nahi. useRef + useEffect wala
  // tareeka us khaali render par chal kar chup ho jaata tha aur DOBARA kabhi nahi
  // chalta — natija: ek chhote update par, jahan scroll karne ko kuch hai hi nahi,
  // checkbox hamesha band rehta aur banda modal me PHANS jaata. State me node rakhne se
  // effect theek us waqt chalta hai jab dabba sach me ban jaata hai.
  const [scrollEl, setScrollEl] = React.useState(null);

  const checkScrolled = React.useCallback(() => {
    if (!scrollEl) return;
    // Abhi layout hua hi nahi (height 0) → abhi koi faisla mat lo. Warna 0 − 0 − 0 = 0
    // "poora padh liya" padha jaata, aur lambi list par bhi checkbox bina scroll ke khul
    // jaata — yaani bilkul ulta bug.
    if (scrollEl.clientHeight <= 0) return;
    // 4px ki chhoot: browser zoom aur fractional height par scrollTop + clientHeight
    // theek-theek scrollHeight ke barabar kabhi nahi hota, aur tab aakhri line padh
    // lene ke baad bhi checkbox band rehta.
    //
    // Content dabbe se CHHOTA ho (ek hi chhota update) to yahi hisaab 0 <= 4 aa kar
    // seedha khol deta hai — scroll karne ko kuch hai hi nahi.
    if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= 4) setReadAll(true);
  }, [scrollEl]);

  React.useEffect(() => {
    if (!scrollEl) return undefined;
    checkScrolled();
    // Dabba aur uska content dono naap me badal sakte hain — dialog ka khulne wala
    // animation, font baad me load hona, phone ghumana. Sirf ek baar naapte to faisla
    // galat waqt par ho jaata; ResizeObserver har asli naap par dobara poochh leta hai.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(checkScrolled);
    ro.observe(scrollEl);
    // Andar wala wrapper: list ki POORI unchai. Sirf bahar wale dabbe par nazar rakhte
    // (jiski max-height tay hai) to content badalne par kuch pata hi na chalta.
    if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild);
    return () => ro.disconnect();
  }, [scrollEl, checkScrolled]);

  const ack = useMutation({
    mutationFn: (ids) => api.post('/auth/releases/ack', { ids }),
    onSuccess: (res) => {
      // Session ka user turant seedha kar do, taaki ye modal isi session me dobara na
      // soche ki kuch un-padha pada hai.
      const seen = res?.seenReleases;
      if (!Array.isArray(seen)) return;
      qc.setQueryData(['auth', 'me'], (old) => (old ? { ...old, seenReleases: seen } : old));
    },
  });

  const unseen = React.useMemo(() => {
    if (!user) return [];
    const seen = new Set(user.seenReleases || []);
    // Account kab bana — uske pehle ki updates is bande ke liye khabar nahi, itihaas hain.
    let joinedYMD = '';
    const since = user.createdAt || user.dateOfJoining;
    if (since) {
      const d = new Date(since);
      if (!Number.isNaN(d.getTime())) joinedYMD = d.toISOString().slice(0, 10);
    }
    return RELEASES.filter((r) => !seen.has(r.id) && (!joinedYMD || !r.ymd || r.ymd >= joinedYMD));
  }, [user]);

  if (!user || closed || !unseen.length) return null;

  const close = () => {
    if (!agreed) return;
    setClosed(true);
    ack.mutate(unseen.map((r) => r.id));
  };

  const many = unseen.length > 1;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent
        showCloseButton={false}
        // SABSE UPAR. Baaki saare popup z-50 par hain, aur portal ka kram mount ke kram se
        // nahi, data aane ke kram se banta hai — announcement ka popup isi wajah se iske
        // upar aa gaya tha. Backdrop bhi upar uthana zaroori hai, warna wo doosre dialog ke
        // neeche reh jaata aur uske button tap hote rehte.
        overlayClassName="z-[60]"
        className="z-[60] gap-0 overflow-hidden border-0 p-0 shadow-glass sm:max-w-xl"
      >
        <div className="bg-gradient-to-br from-indigo-500 via-primary to-sky-500 px-6 pb-5 pt-7 text-white">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/40 backdrop-blur">
            <Sparkles className="size-6" />
          </span>
          <DialogTitle className="mt-3 text-2xl font-bold tracking-tight text-white">
            What&apos;s new
          </DialogTitle>
          <p className="mt-1 text-sm text-white/80">
            {many
              ? `${unseen.length} updates are now live. Please read them.`
              : 'A new update is now live. Please read it.'}
          </p>
        </div>

        {/* Har update apna card. `max-h` + scroll: paanch updates ek saath aa jayein to
            bhi neeche ka checkbox screen par hi rehta hai.
            Andar ek wrapper hai taaki ResizeObserver POORI list ki unchai dekhe — sirf
            pehle card par nazar rakhte to neeche wale badalne par khabar hi na hoti. */}
        <div
          ref={setScrollEl}
          onScroll={checkScrolled}
          className="max-h-[52vh] overflow-y-auto overscroll-contain px-5 py-4 sm:px-6"
        >
          <div className="space-y-3">
          {unseen.map((r, i) => (
            <section
              key={r.id}
              className="rounded-xl border border-border/60 bg-card/60 p-4"
              aria-labelledby={`wn-${r.id}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 id={`wn-${r.id}`} className="text-base font-semibold leading-snug">
                  {many ? `${i + 1}. ` : ''}{r.title}
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground">{r.date || r.ymd}</span>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {(r.points || []).map((p) => (
                  <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                    <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span className="text-foreground/90">{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          </div>
        </div>

        <div className="border-t border-border/60 px-5 py-4 sm:px-6">
          {/* Poora row hi label hai — phone par ek chhote checkbox par nishaana lagana
              nahi padta (bottom-nav wala hi 44px ka niyam). */}
          <label
            className={cn(
              'flex items-start gap-3 rounded-lg p-1 text-sm',
              readAll ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={agreed}
                disabled={!readAll}
                onChange={(e) => setAgreed(e.target.checked)}
                className="peer size-5 appearance-none rounded border border-input bg-background outline-none ring-offset-2 checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed"
              />
              <Check className="pointer-events-none absolute size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100" />
            </span>
            <span className="font-medium">
              I have read {many ? 'these updates' : 'this update'}
            </span>
          </label>
          <Button
            onClick={close}
            disabled={!agreed}
            className={cn('mt-3 w-full', !agreed && 'cursor-not-allowed')}
          >
            Close
          </Button>
          {/* Ek waqt par ek hi baat: pehle "neeche tak padho", uske baad "tick karo". */}
          {!readAll ? (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <ArrowDown aria-hidden className="size-3.5 shrink-0" />
              Scroll to the end to read {many ? 'all of them' : 'it'} first.
            </p>
          ) : !agreed ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Tick the box above to close this.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
