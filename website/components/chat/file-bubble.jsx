'use client';

import * as React from 'react';
import { Download, FileText, File as FileIcon, Play, X, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaUrl } from '@/lib/chat';
import { prettyBytes, isImage, isVideo, isPdf } from '@/lib/chat-media';
import { PdfPages } from './pdf-pages';

/**
 * Bubble ke andar ka attachment, aur use kholne wala full-screen viewer.
 *
 * Har file ka link har baar taaza maanga jaata hai (5 minute me mar jaata hai), aur wo
 * link tabhi banta hai jab server pehle jaanch le ki chat aapki hai — isliye kisi bhi
 * URL ko yahan sthayi maan kar rakhna galat hota.
 *
 * Jhalak (thumbnail) pehle aati hai, poori file tab jab kholi jaaye: chat kholte hi har
 * video ka poora data utaar lena mobile data ka nuksaan hai.
 *
 * Owner ke do niyam:
 *   • File APP KE ANDAR khule — photo, video, PDF sab. Download tab tak nahi jab tak
 *     user khud Download na dabaye. (PDF ke liye pdf.js — dekho pdf-pages.jsx.)
 *   • Photo bubble bada aur responsive ho, taaki tasveer sach me dikhe.
 */

/* ── Sizes ──────────────────────────────────────────────────────────────────
 * Bubble khud message column ka 85% (phone) / 440px (desktop) tak jaata hai
 * (conversation-view.jsx). Andar ki file usme poori chaudai leti hai, bas ek upar ki
 * seema ke saath taaki desktop par 4K photo poora column na kha jaye.
 */
const IMAGE_MAX = 420;
const VIDEO_MAX = 440;
const DOC_MAX = 340;

/** Bubble me photo/video ka anupaat — 0.6 (lamba) se 1.9 (chauda) ke beech. */
const boxRatio = (w, h, fallback) => String(Math.max(0.6, Math.min(w && h ? w / h : fallback, 1.9)));

/** Photo — jhalak, tap par poori screen. */
function ImageFile({ messageId, file, onOpen }) {
  const thumbUrl = useMediaUrl(messageId, { thumb: file.hasThumb });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ maxWidth: IMAGE_MAX }}
    >
      <span className="relative block w-full bg-foreground/10" style={{ aspectRatio: boxRatio(file.width, file.height, 4 / 3) }}>
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt={file.name} className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : (
          <span className="absolute inset-0 grid place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </span>
        )}
      </span>
    </button>
  );
}

/** Video — jhalak + play; tap par viewer me chalta hai (WhatsApp jaisa full-screen). */
function VideoFile({ messageId, file, onOpen }) {
  const thumbUrl = useMediaUrl(messageId, { thumb: true, enabled: !!file.hasThumb });
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ maxWidth: VIDEO_MAX }}
    >
      <span className="relative block w-full bg-foreground/15" style={{ aspectRatio: boxRatio(file.width, file.height, 16 / 9) }}>
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : null}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-12 place-items-center rounded-full bg-black/55">
            <Play className="size-5 fill-white text-white" />
          </span>
        </span>
        {file.durationSec ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {Math.floor(file.durationSec / 60)}:{String(file.durationSec % 60).padStart(2, '0')}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** PDF aur baaki sab — naam, size; tap par viewer. */
function DocFile({ file, mine, onOpen }) {
  const Icon = isPdf(file.mime) ? FileText : FileIcon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
        mine ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20' : 'bg-foreground/5 hover:bg-foreground/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
      style={{ maxWidth: DOC_MAX }}
    >
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', mine ? 'bg-primary-foreground/15' : 'bg-primary/10')}>
        <Icon className={cn('size-5', mine ? 'text-primary-foreground' : 'text-primary')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{file.name}</span>
        <span className={cn('block text-[11px]', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {isPdf(file.mime) ? 'PDF' : (file.mime?.split('/')[1] || 'file').toUpperCase()} · {prettyBytes(file.size)}
        </span>
      </span>
    </button>
  );
}

/**
 * Full-screen viewer — photo, video, PDF, aur baaki (jinke liye sirf Download/Open).
 *
 * Link `fresh` hai: viewer der tak khula rah sakta hai aur cache wala 5-minute link beech
 * me mar jaata. Download button alag link maangta hai (`attachment` disposition) taaki
 * browser save kare, nayi tab me na khole.
 *
 * Overlay: phone par backdrop-blur nahi (Android compositing bug — dekho ui/dialog.jsx),
 * `isolate` + apni layer.
 */
export function MediaViewer({ message, onClose }) {
  const file = message?.file;
  const kind = !file ? 'none' : isImage(file.mime) ? 'image' : isVideo(file.mime) ? 'video' : isPdf(file.mime) ? 'pdf' : 'other';
  const url = useMediaUrl(message?.id, { fresh: true, enabled: !!file });
  const downloadUrl = useMediaUrl(message?.id, { download: true, enabled: !!file });

  React.useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!file) return null;

  return (
    <div className="fixed inset-0 isolate z-[60] flex flex-col bg-black/95 will-change-transform sm:backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2.5 text-white sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <p className="text-[11px] text-white/60">{prettyBytes(file.size)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={file.name}
              className="rounded-full p-2 hover:bg-white/15"
              aria-label="Download"
              title="Download"
            >
              <Download className="size-5" />
            </a>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {!url ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="size-6 animate-spin text-white" />
          </div>
        ) : kind === 'image' ? (
          <button type="button" onClick={onClose} className="flex min-h-full w-full items-center justify-center p-3" aria-label="Close">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={file.name} className="max-h-[calc(100dvh-5rem)] max-w-full object-contain" />
          </button>
        ) : kind === 'video' ? (
          <div className="flex min-h-full items-center justify-center p-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={url} controls autoPlay playsInline className="max-h-[calc(100dvh-5rem)] w-full max-w-4xl rounded-lg bg-black" />
          </div>
        ) : kind === 'pdf' ? (
          <div className="px-2 py-3 sm:px-4">
            <PdfPages url={url} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-white">
            <FileIcon className="size-10 opacity-70" />
            <div>
              <p className="text-sm font-medium">{file.name}</p>
              <p className="mt-1 text-xs text-white/60">This file type can&apos;t be previewed here.</p>
            </div>
            <div className="flex gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
                <ExternalLink className="size-4" /> Open
              </a>
              {downloadUrl ? (
                <a href={downloadUrl} download={file.name} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90">
                  <Download className="size-4" /> Download
                </a>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export function FileBubble({ messageId, file, mine, onOpen }) {
  if (!file) return null;
  if (isImage(file.mime)) return <ImageFile messageId={messageId} file={file} onOpen={onOpen} />;
  if (isVideo(file.mime)) return <VideoFile messageId={messageId} file={file} onOpen={onOpen} />;
  return <DocFile file={file} mine={mine} onOpen={onOpen} />;
}
