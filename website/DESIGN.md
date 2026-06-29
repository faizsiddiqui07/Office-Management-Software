# Design System — "Premium Apple Glass"

A calm, spacious, glassy design language for the Office Management System. The
whole app should feel like a high-end Apple product: frosted surfaces, soft
depth, a single refined accent, and fluid motion. This document is the source of
truth for tokens and shared components — keep it updated as the system grows.

> Stack: **Next.js 14 (App Router, JavaScript/JSX) · Tailwind CSS v4 ·
> shadcn/ui (Base UI) · Vengeance UI · Framer Motion**. The whole frontend is
> plain JavaScript (no TypeScript). Tailwind v4 is CSS-first — all tokens live in
> [`app/globals.css`](app/globals.css) (there is no `tailwind.config.js`).
> shadcn components are generated as JS (`components.json` → `"tsx": false`).

---

## 1. Color tokens

Defined as CSS variables in `:root` (light) and `.dark` (dark), in **oklch** for
perceptual consistency, and exposed to Tailwind via `@theme inline` (so
`bg-primary`, `text-success`, etc. all work). Dark mode is **class-based**
(`next-themes` toggles `.dark` on `<html>`).

| Token | Role | Light | Dark |
| --- | --- | --- | --- |
| `--background` / `--foreground` | App base | near-white / slate-900 | deep slate / near-white |
| `--card` / `--popover` | Solid surfaces | white | dark slate |
| `--primary` | **Brand accent (themeable)** | indigo `oklch(0.52 0.22 277)` | indigo `oklch(0.66 0.19 277)` |
| `--secondary` / `--muted` / `--accent` | Neutral fills | slate-100 family | slate-700 family |
| `--success` | Present / approved | green | brighter green |
| `--warning` | Late / pending | amber | brighter amber |
| `--info` | Info / on-leave | blue | brighter blue |
| `--destructive` | Absent / rejected | red | brighter red |
| `--border` / `--input` / `--ring` | Lines & focus | slate-200 / accent | white-alpha / accent |
| `--chart-1…5` | Chart palette | indigo, blue, green, amber, rose | — |

**To re-theme the accent:** change `--primary` (and `--ring`, `--sidebar-primary`)
in both `:root` and `.dark`. Everything else cascades.

Use color sparingly — status only: **green = present/approved, amber =
late/pending, red = absent/rejected, blue = info**.

## 2. Shape, spacing, radii

- `--radius: 1rem`. Derived: `--radius-sm/md/lg/xl/2xl`. Prefer `rounded-2xl` /
  `rounded-3xl` for cards and panels.
- 8px spacing rhythm, generous padding, lots of whitespace.

## 3. Blur & glass

Glass is provided as utility classes (in `@layer components`):

| Class | Use | Blur |
| --- | --- | --- |
| `.glass` | Standard cards/panels | `blur(20px)` |
| `.glass-strong` | Dialogs, nav, modals | `blur(28px)` |
| `.glass-subtle` | Chips, small controls | `blur(14px)` |
| `.glass-highlight` | Adds the top hairline sheen (compose with the above) | — |

Each adapts to theme via `color-mix(... var(--card) ...)` and a hairline
`--glass-border`. Glass needs something behind it — the **AuroraBackground**
(fixed, `-z-10`) provides the animated mesh.

## 4. Shadows & depth

- `--shadow-glass` — soft layered card shadow (lighter in light, deeper in dark).
- `--shadow-glow` — accent ring + glow, used on hover/CTAs (`shadow-glow`).

## 5. Typography

- Family: SF system stack first (`-apple-system, BlinkMacSystemFont, "SF Pro
  Display", "SF Pro Text"`) with **Inter** loaded via `next/font` as the
  fallback (`--font-inter`). Exposed as `--font-sans`.
- Tight tracking on large headings (`tracking-tight`), comfortable body,
  `text-balance` / `text-pretty` helpers available.

## 6. Motion

- **Framer Motion** for hover lift, entrance fades, spring transitions.
- Keyframes/animations exposed as utilities: `animate-aurora`, `animate-float`,
  `animate-shimmer`, `animate-fade-up`.
- **`prefers-reduced-motion`** is globally respected (animations/transitions
  collapse to near-zero).

## 7. Theming & dark mode

- `next-themes` with `attribute="class"`, `defaultTheme="system"`,
  `disableTransitionOnChange`. No flash on load (`suppressHydrationWarning` on
  `<html>`). Toggle: [`components/theme-toggle.jsx`](components/theme-toggle.jsx).

---

## 8. Shared components

### Glass system — [`components/glass/`](components/glass)

| Component | Purpose |
| --- | --- |
| `AuroraBackground` | Fixed animated mesh/aurora behind the glass layer |
| `GlassCard` | Frosted surface (`intensity`, `interactive`, `highlight`) |
| `GlassPanel` | Larger frosted section surface |
| `StatCard` | KPI card with icon, tone, and trend |
| `PageHeader` | Page title + eyebrow + description + actions |
| `StatusBadge` | Glassy status pill (`success/warning/destructive/info/primary/neutral`) + `STATUS_TONES` map |
| `EmptyState` | Empty placeholder with icon/action |
| `DataTable` | TanStack table: sort, global filter, pagination, glass styling |
| `AppDialog` | Glassy controlled dialog wrapper |
| `ConfirmDialog` | Confirm flow with tone + loading |
| `Skeleton`, `Spinner`, `LoadingState`, `StatCardSkeleton`, `CardSkeleton`, `TableSkeleton` | Loading states |

### App shell — [`components/shell/`](components/shell)

`Brand` (reflects the **live company name** from `GET /api/settings`),
`AppSidebar` (desktop glass sidebar, role-filtered), `MobileNav` (bottom glass
dock), `Topbar` (brand, theme toggle, notifications, user menu), `UserMenu`
(Profile → `/profile`, Company settings → `/settings` for leadership, Sign out).

### Primitives — [`components/ui/`](components/ui)

shadcn/ui (Base UI) primitives: button, input, label, textarea, select, dialog,
dropdown-menu, table, tabs, badge, card, avatar, calendar, popover, switch,
tooltip, sheet, skeleton, separator, scroll-area, sonner.

### Vengeance UI — installed via `npx shadcn@latest add @vengeanceui/[name]`

Landing-grade animated components (in `components/ui/`), showcased on
`/style-guide`:

| Component | File | Notes |
| --- | --- | --- |
| Glass Dock | `glass-dock.jsx` | GSAP morphing dock; pass `items={[{title, icon}]}` |
| Spotlight Navbar | `spotlight-navbar.jsx` | Cursor-tracking spotlight nav |
| Animated Button | `animated-button.jsx` | Shine/shimmer button (default export) |
| Glow Border Card | `glow-border-card.jsx` | Animated conic-gradient glow card |
| Animated Rays | `animated-rays.jsx` | Aurora ray background |

Supporting CSS for these (`.glass-border`, `.glow-conic`, `.animate-aurora-bg`,
`.spotlight-nav*`) lives at the bottom of `app/globals.css`.

> **Rule:** use shadcn/ui for functional primitives and layer Vengeance UI for
> the premium glassy feel. If a Vengeance component doesn't fit a screen, build
> an equivalent glass component with Tailwind + Framer Motion that matches the
> aesthetic — never fall back to a plain default.

---

## 9. Accessibility

- Sufficient contrast on glass, visible focus rings (`--ring`), keyboard nav,
  `aria` labels on icon buttons, `aria-current` on active nav items.
- Mobile-first: every screen must work beautifully on a phone (employees mark
  attendance from mobile).

## 10. QA

Open **`/style-guide`** and toggle the theme to review every token and component
in both light and dark.

---

## 11. Dashboards & data visualization

The role-aware **`/dashboard`** layers content by what each role is allowed to
see — it renders only the sections present in the `GET /api/dashboard` payload:

| Tier | Audience | Adds |
| --- | --- | --- |
| Personal | everyone | today's status, leave balance, pending leaves, banked overtime, announcements, upcoming holidays |
| Team | Manager + | present/total, on-leave, absent, team overtime, pending-approval shortcut |
| Expenses | Admin Manager | month spend + top categories |
| Analytics | Leadership | the full Recharts suite below |

**Charts** live in [`components/dashboard/charts.jsx`](components/dashboard/charts.jsx)
(**Recharts**, all `'use client'`):

- `AttendanceDonut` — donut of present/late/absent/on-leave with the attendance
  rate in the center, plus a legend.
- `ExpenseTrendChart` — gradient area chart of monthly spend (₹).
- `OvertimeLeaders` — horizontal bar ranking of the top overtime earners.

All chart colors come from the `--chart-1…5` tokens (so they **re-theme and adapt
to dark mode automatically**); the custom `GlassTooltip` matches the glass
surfaces. Charts degrade to a dashed `EmptyMini` placeholder when there's no data.

**Quick actions** are role-aware glass pills at the top of the dashboard (Check
in/out, Apply leave, Approvals, Add expense, Announce, Reports, Settings) — each
gated by the cosmetic `can(user, action)` helper.

**Error & empty surfaces:** glass `app/not-found.jsx` (404) and `app/error.jsx`
(500, client component with `reset()`), both centered on a blurred accent halo.
Pages that a role can't access render a friendly `EmptyState` (e.g. `/settings`,
`/activity` for non-leadership) rather than a hard block — the server still
enforces the real permission.
