'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, ExternalLink, Loader2, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ZoomableImage } from '@/components/ui/zoomable-image';

/**
 * Attendance table se selfie dekhna.
 *
 * Link SIRF kholne par maanga jaata hai (`enabled: open`), pehle se nahi: har row ke liye
 * pehle se link banana matlab har baar table khulte hi darjanon signed URL — bekaar ka
 * kaam, aur wo 5 minute me mar bhi jaate. Link bucket se seedha aata hai; bucket private
 * rehta hai.
 *
 * Kaun dekh sakta hai, ye server tay karta hai (apni row hamesha, baaki tabhi jab
 * viewEveryone ho) — client sirf button dikhata hai.
 */
/**
 * Jahan se selfie li gayi thi — padhne layak, aur ek tap me map par.
 *
 * PEHLE KYA KARNA PADTA THA (owner, 26 Nov 2026): selfie kholo, photo par CHHAPE hue
 * lat/lng padho, haath se copy karo, map kholo, wahan paste karo — tab jaa kar pata
 * chalta tha ki banda tha kahan. Har ek selfie ke liye.
 *
 * Aankde photo ke pixel me to hain hi (selfie-attendance.jsx wahan stamp karta hai), par
 * wo record par bhi sach me save hote hain — `checkInMeta.lat/lng`. Wahi yahan dikhaye
 * ja rahe hain; KOI BACKEND BADLAAV NAHI, ye data pehle se aa raha tha, bas kisi ne
 * use dikhaya nahi tha.
 *
 * SELFIE PAR "OFFICE SE KITNI DOOR" NAHI DIKHA SAKTE: selfie wale raaste par geo-fence
 * jaan-bujh kar skip hoti hai (site walon ke liye hi to hai), isliye attendance.service
 * ka selfieGeoMeta() sirf lat/lng/accuracy likhta hai — `distance` likhta hi nahi. Isliye
 * jawab map hi hai, koi ek aankda nahi.
 *
 * LINK HAI, EMBEDDED MAP NAHI: embed karne par har dialog khulte hi coordinates bahar
 * chale jaate, chahe dekhne wale ko zaroorat ho ya na ho. Link par wo tabhi jaate hain
 * jab koi jaan-bujh kar tap kare.
 */
function SelfieWhere({ meta }) {
  const lat = Number(meta?.lat);
  const lng = Number(meta?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Google ka documented format — laptop par site, phone par seedha Maps app.
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const acc = Number(meta?.accuracy);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2">
      <span className="inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" />
        <span className="min-w-0 tabular-nums">
          {lat.toFixed(6)}°, {lng.toFixed(6)}°
          {Number.isFinite(acc) ? <span className="ml-1.5">±{Math.round(acc)} m</span> : null}
        </span>
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary ring-1 ring-primary/30 transition-colors hover:bg-primary/10"
      >
        Open in Maps
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

export function SelfieView({ attendanceId, which = 'in', label, meta }) {
  const [open, setOpen] = React.useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['attendance', 'selfie', attendanceId, which],
    queryFn: () => api.get(`/attendance/${attendanceId}/selfie/${which}`),
    enabled: open,
    staleTime: 4 * 60 * 1000, // link 5 minute chalta hai
    retry: false,
  });

  // Admin wali table (Everyone tab) me POORI ROW par `onRowClick` laga hota hai jo time-edit
  // wala dialog kholta hai (data-table.jsx ka <tr> aur mobile card). Ye component usi row ke
  // andar baithta hai, to yahan ka har click upar chal kar row tak pahunch jaata hai.
  //
  // Sirf button par rokna KAAFI NAHI nikla: React me portal se khula dialog bhi COMPONENT
  // TREE ke hisaab se isi row ke andar hota hai (DOM me bhale body par ho), isliye dialog
  // band karne wala click — X ho ya bahar ka — bhi row tak pahunch jaata tha aur selfie band
  // hote hi edit dialog khul jaata tha.
  //
  // Isliye rok poore wrapper par hai: button ka click bhi, aur dialog ke andar ka har click
  // bhi yahin ruk jaata hai. `pointerdown` bhi isliye ki Radix dialog bahar wale click ko
  // usi se sunta hai.
  const stop = (e) => e.stopPropagation();

  return (
    <span onClick={stop} onPointerDown={stop} onMouseDown={stop}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="h-7 gap-1 px-2 text-xs"
        title={`View the ${which === 'out' ? 'check-out' : 'check-in'} selfie`}
      >
        <Camera className="size-3.5" />
        {label ?? (which === 'out' ? 'Out' : 'In')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{which === 'out' ? 'Check-out selfie' : 'Check-in selfie'}</DialogTitle>
          <DialogDescription className="sr-only">Attendance photo</DialogDescription>
          {isLoading ? (
            <div className="grid h-64 place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">
              {error?.message || 'Could not open the photo'}
            </p>
          ) : data?.url ? (
            // Zoom yahan zaroori hai: admin phone par chehra aur jagah verify karta hai (sahi
            // banda hai ya proxy), aur 24 Oct 2026 se phone par page ka zoom band hai.
            // Pinch / double-tap se badi karke dekh sakte hain. Tap par kuch band nahi hota.
            <div className="h-[60vh] w-full overflow-hidden rounded-xl bg-black/5">
              <ZoomableImage src={data.url} alt="Attendance selfie" />
            </div>
          ) : null}
          {/* Photo ke neeche, kyunki chehra pehle dekha jaata hai aur jagah uske baad. */}
          <SelfieWhere meta={meta} />
        </DialogContent>
      </Dialog>
    </span>
  );
}
