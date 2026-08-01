'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, Copy, Download, HandCoins, QrCode, Smartphone, Wallet } from 'lucide-react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/expense';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/glass/page-header';
import { GlassCard } from '@/components/glass/glass-card';
import { GlassPanel } from '@/components/glass/glass-panel';
import { EmptyState } from '@/components/glass/empty-state';
import { LoadingState } from '@/components/glass/skeletons';
import { DuesEntryDetailDialog } from './dues-entry-detail-dialog';

/**
 * Uses the entry's plain `dateYMD` rather than its stored instant, which is IST
 * midnight and renders as the previous day for anyone whose device sits west of
 * India. (The detail dialog already does it this way.)
 */
function fmtDate(entry) {
  const ymd = typeof entry === 'string' ? entry : entry?.dateYMD;
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  const iso = typeof entry === 'string' ? entry : entry?.date;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TONES = {
  warning: 'bg-warning/12 text-amber-600 ring-warning/25 dark:text-amber-300',
  success: 'bg-success/12 text-success ring-success/20',
  muted: 'bg-muted/50 text-muted-foreground ring-border',
};

function BalanceHero({ pending, advance }) {
  let tone = 'muted';
  let Icon = CheckCircle2;
  let label = 'All settled';
  let value = formatMoney(0);
  let hint = 'You don’t owe anything right now.';

  if (advance > 0) {
    tone = 'success';
    Icon = Wallet;
    label = 'Advance balance';
    value = formatMoney(advance);
    hint = 'You’ve paid ahead — future dues are deducted from this.';
  } else if (pending > 0) {
    tone = 'warning';
    Icon = ArrowUpRight;
    label = 'You owe the admin';
    value = formatMoney(pending);
    hint = 'Pay the admin manager — they’ll mark it here.';
  }

  return (
    <GlassPanel className="flex items-center gap-5 p-6">
      <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl ring-1', TONES[tone])}>
        <Icon className="size-7" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
    </GlassPanel>
  );
}

/**
 * Pay the admin manager — UPI id with one-tap copy (phone) + scan-to-pay QR (desktop).
 *
 * Deliberately NO upi:// deep-link button. Field-tested to death: the link was
 * spec-perfect (GPay resolved the verified payee name and prefilled the amount), but at
 * the moment of payment GPay refuses web-initiated P2P intents with a misleading
 * "exceeded the bank limit" error (confirmed from two different payer accounts, while
 * MANUALLY paying the same id works), and iMobile refuses them outright with "Request
 * Restricted". Personal-VPA intent links are simply blocked policy-side now; the flows
 * that work in every app are the two below — exactly what every shop uses.
 */
const QR_WINDOW_SECONDS = 5 * 60; // the on-phone QR hides after 5 minutes

function UpiPay({ pending, upi }) {
  const [copied, setCopied] = React.useState(false);
  // Phone QR: opened on demand, auto-hides when the window runs out. The window is
  // display hygiene (a stale amount shouldn't sit on screen) — a downloaded image is
  // just a picture and can't be expired; the admin records whatever actually arrived.
  const [qrLeft, setQrLeft] = React.useState(0);
  // Advance flow: when nothing is pending (or the person chooses to), they type their
  // own amount and get the exact same QR / download / copy paths for it.
  const [customAmt, setCustomAmt] = React.useState(false);
  const [amtStr, setAmtStr] = React.useState('');
  const qrBoxRef = React.useRef(null);
  React.useEffect(() => {
    if (qrLeft <= 0) return undefined;
    const t = setTimeout(() => setQrLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [qrLeft]);

  if (!upi?.id) return null;

  const hasPending = pending > 0;
  // Advance mode is forced when nothing is pending, optional (toggle) when something is.
  const payingCustom = customAmt || !hasPending;
  const amountPaise = payingCustom ? Math.round((parseFloat(amtStr) || 0) * 100) : pending;
  const valid = amountPaise > 0;
  const amount = (amountPaise / 100).toFixed(2);
  const slipTitle = payingCustom ? 'Office advance payment' : 'Office dues payment';

  /**
   * The downloaded file is a payment SLIP, not a bare QR: title, QR, amount, id, and —
   * in red — the validity window. The QR itself can't expire (it's just an image), so a
   * human-readable "Valid only till …" is what stops someone innocently paying an old
   * screenshot two days later. Composed on a scratch canvas from the on-screen QR.
   */
  const downloadQr = () => {
    const qrCanvas = qrBoxRef.current?.querySelector('canvas');
    if (!qrCanvas || !valid) return;
    const W = 640;
    const H = 872;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';

    ctx.fillStyle = '#111827';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(slipTitle, W / 2, 58);
    ctx.font = '400 23px system-ui, sans-serif';
    ctx.fillStyle = '#374151';
    if (upi.name) ctx.fillText(`To: ${upi.name}`, W / 2, 96);

    ctx.drawImage(qrCanvas, (W - 512) / 2, 122, 512, 512);

    ctx.fillStyle = '#111827';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillText(`₹ ${amount}`, W / 2, 700);
    ctx.font = '400 22px system-ui, sans-serif';
    ctx.fillStyle = '#374151';
    ctx.fillText(upi.id, W / 2, 736);

    const fmt = (d) =>
      d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    const till = new Date(Date.now() + qrLeft * 1000);
    ctx.fillStyle = '#B91C1C'; // red — the one thing a later viewer must not miss
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(`Valid only till ${fmt(till)}`, W / 2, 792);
    ctx.fillStyle = '#6B7280';
    ctx.font = '400 19px system-ui, sans-serif';
    ctx.fillText(`Generated ${fmt(new Date())} · do not pay after the valid time`, W / 2, 826);

    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `upi-dues-${amount}.png`;
    a.click();
  };
  // The QR carries the standard NPCI string (pa raw — %40 breaks apps; minimal params).
  // SCANNING is a different trust path than intent links: apps accept personal-VPA QRs.
  const qrValue = `upi://pay?${[
    `pa=${upi.id}`,
    upi.name ? `pn=${encodeURIComponent(upi.name)}` : null,
    `am=${amount}`,
    'cu=INR',
  ].filter(Boolean).join('&')}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(upi.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the id is visible to type manually */
    }
  };

  return (
    <GlassPanel className="space-y-3 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Smartphone className="size-4 text-primary" /> {payingCustom ? 'Give an advance to the admin manager' : 'Pay the admin manager'}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {payingCustom ? (
              'Enter the amount, then pay this UPI id from GPay / PhonePe / any UPI app — future lunches and errands get deducted from it.'
            ) : (
              <>Send <span className="font-semibold tabular-nums text-foreground">{formatMoney(pending)}</span> to this UPI id from GPay / PhonePe / any UPI app.</>
            )}
          </p>
          {/* The id itself, plainly visible and select-all — copying by hand also works. */}
          <p className="mt-1 select-all break-all text-sm font-semibold tabular-nums">{upi.id}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied!' : 'Copy UPI ID'}
        </button>
      </div>
      {/* Advance mode: the person types how much they're handing over. */}
      {payingCustom ? (
        <div className="flex items-center gap-2">
          <label htmlFor="upi-adv-amt" className="text-sm font-medium">₹</label>
          <input
            id="upi-adv-amt"
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={amtStr}
            onChange={(e) => setAmtStr(e.target.value)}
            placeholder="Amount"
            className="w-36 rounded-xl border border-border bg-background/50 px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary"
          />
          {valid ? <span className="text-xs text-muted-foreground">QR below carries {formatMoney(amountPaise)}</span> : <span className="text-xs text-muted-foreground">Enter an amount to get the QR</span>}
        </div>
      ) : null}

      {/* People WITH pending can still choose to hand over an advance instead. */}
      {hasPending ? (
        <button
          type="button"
          onClick={() => { setCustomAmt((v) => !v); setAmtStr(''); setQrLeft(0); }}
          className="text-left text-xs font-medium text-primary hover:underline"
        >
          {payingCustom ? `← Back to your pending amount (${formatMoney(pending)})` : 'Want to give an advance instead? Enter your own amount →'}
        </button>
      ) : null}

      <p className="text-xs text-muted-foreground">Tap to copy the id, then pay it directly from your UPI app (open the app → Pay by UPI ID → paste → amount). Direct payment works in every app. The admin marks it paid once the money arrives.</p>

      {/* Phone QR — on demand, since you can't point your camera at your own screen:
          generate → download the PNG → open the UPI app's scanner → pick it FROM THE
          GALLERY (GPay/PhonePe/Paytm scanners all take gallery images). Canvas (not SVG)
          so toDataURL gives the download; rendered at 512px for a crisp, scannable file
          but displayed at 200. Auto-hides after QR_WINDOW_SECONDS. */}
      {valid ? (
      <div className="border-t border-border/50 pt-3 sm:hidden">
        {qrLeft > 0 ? (
          <div className="flex flex-col items-center gap-2.5">
            <span ref={qrBoxRef} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-border/60">
              <QRCodeCanvas value={qrValue} size={512} marginSize={2} bgColor="#ffffff" fgColor="#000000" style={{ width: 200, height: 200 }} />
            </span>
            <p className="text-xs text-muted-foreground">
              Amount <span className="font-medium tabular-nums text-foreground">{formatMoney(amountPaise)}</span> filled in · hides in{' '}
              <span className="font-medium tabular-nums text-foreground">{Math.floor(qrLeft / 60)}:{String(qrLeft % 60).padStart(2, '0')}</span>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={downloadQr}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Download className="size-4" /> Download QR
              </button>
              {/* For whoever doesn't want the QR at all — the id, one tap away, right here. */}
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted/40"
              >
                {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                {copied ? 'Copied!' : 'Copy id'}
              </button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Download it, open your UPI app’s scanner and pick this QR from your <span className="font-medium text-foreground">gallery</span> — the payment opens with the amount filled in.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setQrLeft(QR_WINDOW_SECONDS)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium ring-1 ring-border transition-colors hover:bg-muted/40"
          >
            <QrCode className="size-4" /> Show QR to pay {formatMoney(amountPaise)}
          </button>
        )}
      </div>
      ) : null}

      {/* Scan-to-pay QR — the same upi:// string every shop QR uses. Hidden on phones
          (you can't scan your own screen); on a laptop this is THE way to pay, and a
          phone whose app refuses intent links (iMobile) can scan it here too. White tile
          always, whatever the theme — scanners want dark-on-light. */}
      {valid ? (
      <div className="hidden items-center gap-4 border-t border-border/50 pt-3 sm:flex">
        <span className="shrink-0 rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-border/60">
          <QRCodeSVG value={qrValue} size={132} bgColor="#ffffff" fgColor="#000000" />
        </span>
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="text-sm font-medium text-foreground">Scan to pay {formatMoney(amountPaise)}</p>
          <p className="mt-0.5">Open any UPI app on your phone — GPay, PhonePe, Paytm or your bank’s app — and scan this code. The amount comes filled in.</p>
        </div>
      </div>
      ) : null}
    </GlassPanel>
  );
}

function EntryRow({ e, onOpen }) {
  const isDue = e.kind === 'DUE';
  const paid = isDue && e.status === 'PAID';
  const partial = isDue && e.status === 'PARTIAL';
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      className="flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-foreground/5"
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl ring-1',
          !isDue || paid ? TONES.success : TONES.warning,
        )}
      >
        {!isDue ? <ArrowUpRight className="size-4" /> : paid ? <CheckCircle2 className="size-4" /> : <ArrowDownLeft className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {isDue ? e.item || 'Item' : e.note || 'Payment / advance'}
          {isDue && e.source ? <span className="font-normal text-muted-foreground"> · {e.source}</span> : null}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{fmtDate(e)}</span>
          {isDue ? (
            paid ? (
              <span className="font-medium text-success">Paid</span>
            ) : partial ? (
              <span className="font-medium text-amber-600 dark:text-amber-300">Partial · {formatMoney(e.remaining)} left</span>
            ) : (
              <span className="font-medium text-amber-600 dark:text-amber-300">Pending</span>
            )
          ) : (
            <span>Advance / credit</span>
          )}
        </div>
      </div>
      <span className={cn('shrink-0 text-sm font-semibold tabular-nums', !isDue ? 'text-success' : paid ? 'text-muted-foreground line-through' : 'text-amber-600 dark:text-amber-300')}>
        {isDue ? '−' : '+'}
        {formatMoney(e.amount)}
      </span>
    </button>
  );
}

export function DuesPersonal() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['dues', 'me'], queryFn: () => api.get('/dues/me') });
  const [viewing, setViewing] = React.useState(null); // ledger line opened from History

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Dues"
        title="My dues"
        icon={HandCoins}
        description="What you owe the office admin for lunch, tea, and errands — and any advance you’ve paid."
      />

      {isError ? (
        <EmptyState icon={HandCoins} title="Couldn’t load your dues" description={error?.message || 'Check your connection and try again.'} />
      ) : isLoading || !data ? (
        <LoadingState label="Loading your dues…" />
      ) : (
        <>
          <BalanceHero pending={data.pending} advance={data.advance} />

          <UpiPay pending={data.pending} upi={data.upi} />

          <section className="space-y-3">
            <h2 className="px-1 text-lg font-semibold tracking-tight">History</h2>
            {data.entries.length ? (
              <GlassCard className="divide-y divide-border/50 p-2">
                {data.entries.map((e) => (
                  <EntryRow key={e.id} e={e} onOpen={setViewing} />
                ))}
              </GlassCard>
            ) : (
              <EmptyState icon={HandCoins} title="Nothing here yet" description="When the admin adds a lunch or errand for you, it’ll show up here." />
            )}
          </section>
        </>
      )}

      <DuesEntryDetailDialog
        entry={viewing}
        open={!!viewing}
        onOpenChange={(o) => { if (!o) setViewing(null); }}
      />
    </div>
  );
}
