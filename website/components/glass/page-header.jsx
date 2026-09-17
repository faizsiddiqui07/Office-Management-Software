import { cn } from '@/lib/utils';

/**
 * `media`: icon ki jagah koi bhi element (jaise bandi ki profile photo) — user detail page
 * isi se photo dikhata hai. Icon aur media dono ho to media jeet-ta hai.
 */
export function PageHeader({ title, description, eyebrow, icon: Icon, media, actions, className }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="space-y-1.5">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary/80">{eyebrow}</p>
        ) : null}
        <div className="flex items-center gap-3">
          {media ? (
            <span className="shrink-0">{media}</span>
          ) : Icon ? (
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Icon className="size-5" />
            </span>
          ) : null}
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        </div>
        {description ? (
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
