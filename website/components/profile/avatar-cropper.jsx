'use client';

import * as React from 'react';
import Cropper from 'react-easy-crop';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cropToDataUrl } from '@/lib/crop-image';

/**
 * WhatsApp jaisa profile-photo cropper: tasveer ko ungli/mouse se ghumao, pinch ya slider
 * se zoom karo, circle me jo aaya wahi photo bani.
 *
 * Ye component khud koi modal nahi hai — do jagah use hota hai:
 *   • ProfilePhotoPrompt (pehli baar wala modal) ke ANDAR ek padaav ki tarah
 *   • Profile page par AvatarCropDialog ke andar
 *
 * Output: 384×384 JPEG data-URL (~40-60 KB). Server ise S3 par rakh deta hai.
 */
export function AvatarCropper({ file, onDone, onCancel, busy = false, className }) {
  const [src, setSrc] = React.useState('');
  const [crop, setCrop] = React.useState({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [area, setArea] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const save = async () => {
    if (!src || !area) return;
    setSaving(true);
    try {
      const dataUrl = await cropToDataUrl(src, area);
      await onDone(dataUrl);
    } finally {
      setSaving(false);
    }
  };

  const working = saving || busy;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Crop stage — square, dark; react-easy-crop ko fixed height chahiye. */}
      <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl bg-black">
        {src ? (
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            restrictPosition
            zoomWithScroll
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_a, px) => setArea(px)}
            style={{ cropAreaStyle: { border: '2px solid rgba(255,255,255,0.9)', boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)' } }}
          />
        ) : (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-white/70" />
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-[320px] items-center gap-3">
        <ZoomOut className="size-4 shrink-0 text-muted-foreground" />
        <input
          id="avatar-zoom"
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
        <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <p className="text-center text-xs text-muted-foreground">Drag to reposition · pinch or slide to zoom</p>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={working}>Cancel</Button>
        <Button type="button" onClick={save} disabled={working || !area}>
          {working ? <Loader2 className="size-4 animate-spin" /> : null} Use photo
        </Button>
      </div>
    </div>
  );
}

/** Profile page ke liye: file chunte hi ye dialog khulta hai. */
export function AvatarCropDialog({ file, onDone, onCancel, busy }) {
  return (
    <Dialog open={!!file} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogTitle>Adjust your photo</DialogTitle>
        <DialogDescription>Fit your face inside the circle.</DialogDescription>
        {file ? <AvatarCropper file={file} onDone={onDone} onCancel={onCancel} busy={busy} /> : null}
      </DialogContent>
    </Dialog>
  );
}
