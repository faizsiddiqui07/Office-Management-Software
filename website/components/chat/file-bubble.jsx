'use client';

import * as React from 'react';
import { Download, FileText, File as FileIcon, Play, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaUrl } from '@/lib/chat';
import { prettyBytes, isImage, isVideo, isPdf } from '@/lib/chat-media';

/**
 * Bubble ke andar ka attachment.
 *
 * Har file ka link har baar taaza maanga jaata hai (5 minute me mar jaata hai), aur wo
 * link tabhi banta hai jab server pehle jaanch le ki chat aapki hai — isliye kisi bhi
 * URL ko yahan sthayi maan kar rakhna galat hota.
 *
 * Jhalak (thumbnail) pehle aati hai, poori file tab jab kholi jaaye: chat kholte hi har
 * video ka poora data utaar lena mobile data ka nuksaan hai.
 */

/** Photo — chhoti jhalak, tap par poori screen. */
function ImageFile({ messageId, file, onOpen }) {
  const thumbUrl = useMediaUrl(messageId, { thumb: file.hasThumb });
  // Jhalak na bani ho (purani file, ya wo format jise browser nahi khol paaya) to
  // poori file hi dikha do — icon dikhane se behtar hai.
  const ratio = file.width && file.height ? file.width / file.height : 4 / 3;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ maxWidth: 260 }}
    >
      <span
        className="relative block w-full bg-foreground/10"
        style={{ aspectRatio: String(Math.max(0.5, Math.min(ratio, 2))) }}
      >
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

/** Video — jhalak + play. Chalane par hi poora data aata hai. */
function VideoFile({ messageId, file }) {
  const [playing, setPlaying] = React.useState(false);
  const thumbUrl = useMediaUrl(messageId, { thumb: true, enabled: file.hasThumb && !playing });
  const fullUrl = useMediaUrl(messageId, { enabled: playing });
  const ratio = file.width && file.height ? file.width / file.height : 16 / 9;

  if (playing && fullUrl) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={fullUrl} controls autoPlay className="w-full rounded-lg" style={{ maxWidth: 280 }} />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="relative block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ maxWidth: 280 }}
    >
      <span
        className="relative block w-full bg-foreground/15"
        style={{ aspectRatio: String(Math.max(0.5, Math.min(ratio, 2))) }}
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : null}
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid size-11 place-items-center rounded-full bg-black/55 backdrop-blur">
            {playing ? <Loader2 className="size-5 animate-spin text-white" /> : <Play className="size-5 fill-white text-white" />}
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

/** PDF aur baaki sab — naam, size, aur download. */
function DocFile({ messageId, file, mine }) {
  const [wanted, setWanted] = React.useState(false);
  const url = useMediaUrl(messageId, { enabled: wanted });

  React.useEffect(() => {
    if (wanted && url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      setWanted(false);
    }
  }, [wanted, url]);

  const Icon = isPdf(file.mime) ? FileText : FileIcon;
  return (
    <button
      type="button"
      onClick={() => setWanted(true)}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        mine ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20' : 'bg-foreground/5 hover:bg-foreground/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
      style={{ maxWidth: 280 }}
    >
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', mine ? 'bg-primary-foreground/15' : 'bg-primary/10')}>
        <Icon className={cn('size-4', mine ? 'text-primary-foreground' : 'text-primary')} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{file.name}</span>
        <span className={cn('block text-[11px]', mine ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {isPdf(file.mime) ? 'PDF' : (file.mime?.split('/')[1] || 'file').toUpperCase()} · {prettyBytes(file.size)}
        </span>
      </span>
      {wanted ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Download className="size-4 shrink-0 opacity-70" />}
    </button>
  );
}

/** Poori screen par photo. */
export function ImageViewer({ messageId, name, onClose }) {
  const url = useMediaUrl(messageId);

  React.useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm">
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="min-w-0 truncate text-sm">{name}</p>
        <div className="flex shrink-0 items-center gap-1">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full p-2 hover:bg-white/15"
              aria-label="Download karein"
            >
              <Download className="size-5" />
            </a>
          ) : null}
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/15" aria-label="Band karein">
            <X className="size-5" />
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex min-h-0 flex-1 items-center justify-center p-4"
        aria-label="Band karein"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
        ) : (
          <Loader2 className="size-6 animate-spin text-white" />
        )}
      </button>
    </div>
  );
}

export function FileBubble({ messageId, file, mine, onOpenImage }) {
  if (!file) return null;
  if (isImage(file.mime)) return <ImageFile messageId={messageId} file={file} onOpen={onOpenImage} />;
  if (isVideo(file.mime)) return <VideoFile messageId={messageId} file={file} />;
  return <DocFile messageId={messageId} file={file} mine={mine} />;
}
