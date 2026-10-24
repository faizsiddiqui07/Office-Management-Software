'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, Loader2 } from 'lucide-react';
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
export function SelfieView({ attendanceId, which = 'in', label }) {
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
        </DialogContent>
      </Dialog>
    </span>
  );
}
