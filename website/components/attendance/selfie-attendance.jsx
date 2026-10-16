'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, MapPin, TriangleAlert, RotateCcw, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { uploadToS3 } from '@/lib/chat-media';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * Site par kaam karne walon ke liye "selfie se attendance".
 *
 * Office ka geo-fence 50 m ka hai, isliye site par gaya banda attendance laga hi nahi
 * paata tha. Ye raasta geo-fence se nahi guzarta aur us par late bhi nahi lagti (owner ka
 * niyam) — iska ikloata control ye hai ki photo me background dikhta hai, aur attendance
 * table me saaf likha aata hai ki ye selfie se laga tha.
 *
 * Teen padaav: warning → camera → preview. Warning dono jagah dikhti hai — pehle alag se,
 * aur phir camera ki screen par bhi chipki rehti hai, kyunki asli maqsad wahi hai:
 * background me working site dikhni chahiye.
 */

const WARNING = 'Make sure your working site is clearly visible in the background.';

/** Canvas par ek gol kona wala box — purane browsers me roundRect nahi hota. */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  ctx.fill();
}

/**
 * Photo par stamp — date, time, lat/lng aur naam, photo ke PIXEL me pakka.
 *
 * Alag se dikhane ke bajaye photo me hi chhapa ja raha hai: uske baad koi doosri photo
 * laga kar wahi stamp nahi bana sakta. Asli data phir bhi DB me alag jaata hai, taaki
 * report me dhoondha ja sake.
 */
function stampPhoto(video, { name, coords, at }) {
  const MAX = 1080;
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 1280;
  const scale = Math.min(1, MAX / Math.max(vw, vh));
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Preview mirror hoti hai (apna chehra ulta dekhna ajeeb lagta hai), par SAVE seedha
  // hota hai — warna background ka likha hua ulta chhap jaata.
  ctx.drawImage(video, 0, 0, w, h);

  const pad = Math.round(w * 0.03);
  const fs = Math.max(13, Math.round(w * 0.032));
  const line = Math.round(fs * 1.45);
  const lines = [
    name,
    coords ? `Lat ${coords.lat.toFixed(6)}°   Long ${coords.lng.toFixed(6)}°` : 'Location not available',
    at,
  ].filter(Boolean);

  const boxH = line * lines.length + pad * 1.2;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  roundRect(ctx, pad, h - boxH - pad, w - pad * 2, boxH, Math.round(fs * 0.6));

  ctx.textBaseline = 'top';
  lines.forEach((text, i) => {
    ctx.font = `${i === 0 ? '600 ' : ''}${fs}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,0.88)';
    ctx.fillText(text, pad * 1.7, h - boxH - pad + pad * 0.6 + i * line);
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82));
}

const fmtWhen = (d) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(d);

export function SelfieAttendance({ mode, userName, disabled }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState('warn');       // warn | camera | preview
  const [coords, setCoords] = React.useState(null);
  const [geoError, setGeoError] = React.useState('');
  const [camError, setCamError] = React.useState('');
  const [shot, setShot] = React.useState(null);          // { blob, url, at }
  const [now, setNow] = React.useState(() => new Date());

  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);

  const isOut = mode === 'out';

  // Camera band karna ZAROORI hai — warna dialog band hone ke baad bhi phone ki light
  // jalti rehti hai aur battery jaati hai.
  const stopCamera = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  React.useEffect(() => stopCamera, [stopCamera]);

  // Ghadi sirf camera khulne par chalti hai.
  React.useEffect(() => {
    if (step !== 'camera') return undefined;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [step]);

  // Location camera ke saath hi maangi jaati hai, taaki submit ke waqt intezaar na ho.
  React.useEffect(() => {
    if (!open || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(
      (p) => { setGeoError(''); setCoords({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      () => setGeoError('Location is off. Turn it on so your attendance can record where you are.'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [open]);

  const openCamera = async () => {
    setCamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      setStep('camera');
      // Video element step badalne ke BAAD mount hota hai, isliye ek frame ruk kar.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
      });
    } catch {
      setCamError('Could not open the camera. Please allow camera access and try again.');
    }
  };

  const capture = async () => {
    const v = videoRef.current;
    if (!v) return;
    const at = new Date();
    const blob = await stampPhoto(v, { name: userName || '', coords, at: fmtWhen(at) });
    if (!blob) { toast.error('Could not save the photo — please try again'); return; }
    stopCamera();
    setShot({ blob, url: URL.createObjectURL(blob), at });
    setStep('preview');
  };

  const retake = () => {
    if (shot?.url) URL.revokeObjectURL(shot.url);
    setShot(null);
    openCamera();
  };

  const submit = useMutation({
    mutationFn: async () => {
      // Pehle photo, phir attendance. Is kram se agar upload fail ho to attendance lagi hi
      // nahi — ulta karne par bina photo ki attendance lag jaati, jo is poore kaam ka
      // maqsad hi tod deta.
      const slip = await api.post('/attendance/selfie-upload', {});
      await uploadToS3({ url: slip.url, fields: slip.fields }, shot.blob).promise;
      const body = {
        selfieToken: slip.token,
        ...(coords ? { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy } : {}),
      };
      return api.post(isOut ? '/attendance/check-out' : '/attendance/check-in', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      qc.invalidateQueries({ queryKey: ['my-summary'] }); // the streak card counts today
      toast.success(isOut ? 'Checked out with selfie' : 'Checked in with selfie');
      close();
    },
    onError: (e) => toast.error(e?.message || 'Could not save your attendance'),
  });

  const close = () => {
    stopCamera();
    if (shot?.url) URL.revokeObjectURL(shot.url);
    setShot(null);
    setStep('warn');
    setCamError('');
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="w-full gap-2"
      >
        <Camera className="size-4" />
        {isOut ? 'Check out with selfie' : 'Check in with selfie'}
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{isOut ? 'Check out with selfie' : 'Check in with selfie'}</DialogTitle>

          {step === 'warn' ? (
            <>
              <DialogDescription className="sr-only">Take a selfie at your working site</DialogDescription>
              <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-500" />
                <p className="text-sm">{WARNING}</p>
              </div>
              {geoError ? <p className="text-xs text-destructive">{geoError}</p> : null}
              {camError ? <p className="text-xs text-destructive">{camError}</p> : null}
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={close}>Cancel</Button>
                <Button className="flex-1 gap-2" onClick={openCamera}>
                  <Camera className="size-4" /> Open camera
                </Button>
              </div>
            </>
          ) : null}

          {step === 'camera' ? (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black">
                {/*
                  MIRROR JAAN-BUJH KAR NAHI HAI.

                  Pehle yahan `-scale-x-100` tha — apna chehra seedha dekhne ke liye, jaise
                  har selfie camera dikhata hai. Par photo canvas par BINA mirror save hoti
                  hai, to jo dikh raha tha aur jo save hua wo do alag cheezein thin, aur
                  photo "ulti" lagti thi.

                  Ab dono ek jaise hain: jo screen par dikh raha hai, bilkul wahi save hoga.
                  Aur mirror wapas lagana theek bhi nahi — is photo ka poora maqsad
                  background hai, aur mirror me site ka har sign-board ulta padha jaata.
                */}
                <video ref={videoRef} playsInline muted className="block max-h-[55vh] w-full object-contain" />
                {/* Warning camera par bhi — yahi is poore kaam ka maqsad hai */}
                <div className="pointer-events-none absolute inset-x-0 top-0 flex gap-2 bg-gradient-to-b from-black/75 to-transparent p-2.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  <p className="text-[11px] font-medium leading-snug text-white">{WARNING}</p>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-0.5 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2.5 pt-6 text-[11px] text-white/90">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="size-3" />
                    {coords ? `Lat ${coords.lat.toFixed(6)}°  Long ${coords.lng.toFixed(6)}°` : (geoError ? 'Location unavailable' : 'Getting location…')}
                  </p>
                  <p className="tabular-nums">{fmtWhen(now)}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={close}>Cancel</Button>
                <Button className="flex-1 gap-2" onClick={capture}>
                  <Camera className="size-4" /> Take photo
                </Button>
              </div>
            </>
          ) : null}

          {step === 'preview' && shot ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.url} alt="Your attendance selfie" className="max-h-[55vh] w-full rounded-xl object-contain" />
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 gap-2" onClick={retake} disabled={submit.isPending}>
                  <RotateCcw className="size-4" /> Retake
                </Button>
                <Button className="flex-1 gap-2" onClick={() => submit.mutate()} disabled={submit.isPending}>
                  {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {submit.isPending ? 'Saving…' : 'Submit'}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
