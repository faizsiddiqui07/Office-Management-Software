# Office Management System

An internal web app for a single company where every staff member logs in with
their own role and sees a role-appropriate dashboard: **attendance, leave
management, announcements, holiday calendar, expense tracking, user management,
and PDF reports** — all interconnected (e.g. an approved leave auto-decrements
that employee's yearly balance).

Built as a **monorepo** with two separately-runnable apps, **written entirely in
JavaScript**:

```
office-management-software/
├── website/       → Next.js 14 frontend (UI only — talks to the API over HTTP)   :3000
├── backend/       → Express.js + MongoDB REST API (business logic + DB)           :4000
├── package.json   → root scripts (runs both with "concurrently")
└── README.md
```

This is a **decoupled architecture**: the frontend never touches the database.
It calls the Express API, which is the source of truth for data and permissions.
The two apps run on **separate ports** and can be started independently.

---

## Tech stack

| | |
| --- | --- |
| **Frontend** (`/website`) | Next.js 14 (App Router, **JavaScript/JSX**), Tailwind CSS v4, shadcn/ui (Base UI), Vengeance UI, Framer Motion, TanStack Query + Table, React Hook Form + Zod, Recharts, sonner, lucide-react |
| **Backend** (`/backend`) | Express.js (**ESM JavaScript**), MongoDB + Mongoose, JWT (httpOnly cookie) + bcryptjs, Zod validation, helmet, cors (credentials), morgan, express-rate-limit, multer, @react-pdf/renderer, date-fns(-tz) |
| **Design** | "Premium Apple Glass" — glassmorphism, animated aurora background, dark/light, mobile-first. See [`website/DESIGN.md`](website/DESIGN.md) |

Local dev ports: **website → http://localhost:3000**, **backend → http://localhost:4000**.

---

## Prerequisites

- **Node.js ≥ 18.18** (tested on Node 20 — the backend uses `node --watch`)
- **MongoDB** — optional for Phase 1 (the backend boots and skips the DB if
  `MONGODB_URI` is unset); required once data features land.

---

## Getting started

### 1. Install dependencies (root + both apps)

```bash
npm run install:all
# or manually:
#   npm install
#   npm install --prefix backend
#   npm install --prefix website
```

### 2. Configure environment

Copy the example env files (sensible dev defaults are already provided):

```bash
cp backend/.env.example backend/.env
cp website/.env.example website/.env.local
```

| File | Key vars |
| --- | --- |
| `backend/.env` | `PORT=4000`, `CLIENT_URL=http://localhost:3000`, `MONGODB_URI`, `JWT_SECRET`, `COMPANY_TZ=Asia/Kolkata` |
| `website/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:4000` |

### 3. Seed the database (later phases)

```bash
npm run seed
```

> Phase 1 ships a seed **placeholder**. From the data-model phase on, this
> creates the settings singleton, one user per role (+ sample employees with
> known passwords), holidays, announcements, attendance and expenses — and
> prints all seeded logins to the console.

### 4. Run both apps

```bash
npm run dev          # runs website + backend together (concurrently)
```

Or run them separately (e.g. in two VS Code terminals):

```bash
npm run dev:website  # → http://localhost:3000
npm run dev:backend  # → http://localhost:4000
```

- Website → http://localhost:3000 (redirects to `/login`)
- Backend → http://localhost:4000 — health check: http://localhost:4000/api/health
- **Style guide / component QA → http://localhost:3000/style-guide**

---

## Root scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Runs website + backend together (concurrently) |
| `npm run dev:website` | Runs only the Next.js website (:3000) |
| `npm run dev:backend` | Runs only the Express API (:4000) |
| `npm run build` | Production build of the website |
| `npm run start:backend` | Starts the backend with `node` |
| `npm run seed` | Runs the backend seed script |
| `npm run lint` | Lints the website |
| `npm run install:all` | Installs root + backend + website deps |

---

## Features & roles

### Features

Attendance (self check-in/out, auto-captured times, late/overtime) · Leave
management (18 paid leaves/year, auto-deduction, working-days only) ·
Announcements (login pop-up + section) · Holiday calendar · Expense management
(Admin Manager) · User management (leadership creates accounts) · PDF reports
(daily/weekly/monthly/yearly) · **Role-aware dashboards** (rich Recharts
analytics for leadership) · **Live company settings** · **Profile & appearance**
(everyone) · **Activity log** (leadership audit trail) · **CSV exports**
(attendance + expenses) · Notifications.

### Roles (6)

`CEO`, `BOSS`, `ADMIN_MANAGER`, `MANAGER`, `EMPLOYEE`, `OFFICE_BOY`.
Groups: **leadership** = {CEO, BOSS}; **admins** = {CEO, BOSS, ADMIN_MANAGER}.
Permissions are enforced **server-side** on every endpoint; the client only
hides/shows UI cosmetically.

| Capability | CEO | BOSS | ADMIN_MANAGER | MANAGER | EMPLOYEE | OFFICE_BOY |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Mark / view own attendance & balances | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View everyone's attendance | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Apply for leave | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve / reject leave | ✅ | ✅ | ✅ | ✅* | ❌ | ❌ |
| Create users + credentials | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Deactivate users / change roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Post announcements | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit holiday calendar | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage / view expenses | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Download PDF reports / CSV exports | ✅ | ✅ | ✅† | ❌ | ❌ | ❌ |
| Leadership dashboard & analytics | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit live company settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View activity log (audit trail) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit own profile / change password / theme | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

<sub>* Manager leave approval is configurable; leadership can always override.
† Admin Manager can export the expense CSV; PDF reports remain leadership-only.</sub>

---

## Security baseline

JWT in an **httpOnly, secure cookie**; bcrypt (cost ≥ 10); CORS locked to the
client origin with `credentials: true` (never `*`); helmet; rate-limited auth
endpoints; Zod validation on every endpoint; server-side authorization on every
route; single-use hashed password-reset tokens; forced password change on first
login.

---

## Authentication (Phase 2)

MongoDB is **required** from Phase 2 on. Set `MONGODB_URI` in `backend/.env`
(local or Atlas), then seed: `npm run seed`. All seeded accounts share the
password **`Password@123`**:

| Role | Email |
| --- | --- |
| CEO | `zia@office.com` |
| BOSS | `boss@office.com` |
| ADMIN_MANAGER | `admin@office.com` |
| MANAGER | `manager@office.com` |
| EMPLOYEE | `employee@office.com` |
| OFFICE_BOY | `officeboy@office.com` |

- **Forgot password:** if SMTP isn't configured, the reset link is **printed to
  the backend console** (set `SMTP_*` in `backend/.env` to email it instead).
- **New employees** (admins → `/users`) get a one-time temp password and are
  forced to change it on first login.

## Project status

- **Phase 1 — Foundation ✅** Monorepo (`website` + `backend`, JavaScript),
  design system, shared glass components, app shell, split-screen login.
- **Phase 2 — Auth ✅** Login/logout, `GET /me`, forced first-login password
  change, forgot/reset password, JWT httpOnly cookie, role-based permissions
  (`can()` + `requirePermission`), role-filtered nav, and admin user onboarding
  with one-time temp passwords. Models: User, Setting, LeaveBalance,
  PasswordResetToken, AuditLog.
- **Phase 3 — Attendance ✅** One-tap auto-timed check-in/out, late/overtime math, personal history, leadership "everyone today" overview.
- **Phase 4 — Leaves ✅** Apply → approve (transactional) → auto-decrement balance → attendance `ON_LEAVE`; cancel restores; working-days only; over-quota block.
- **Phase 5 — Announcements ✅** Leadership posts, login pop-up (step-through, URGENT styling), feed, in-app notifications bell.
- **Phase 6 — Calendar ✅** Shared holiday calendar (admins edit) that drives the working-days + attendance math.
- **Phase 7 — Expenses + Users ✅** Expense register (charts, summaries, receipts) and full users/credentials admin area.
- **Phase 8 — Reports ✅** Leadership previews + downloads branded daily/weekly/monthly/yearly PDFs (`@react-pdf`).
- **Phase 9 — Dashboards & polish ✅** Role-aware `/dashboard` (personal stats for
  everyone → team snapshot for managers → expense rollup for admins → full
  Recharts analytics for leadership: attendance donut, monthly spend trend,
  overtime leaders, leave utilization, pending approvals, recent activity).
  Live company **/settings** (leadership, applied app-wide via `GET/PUT
  /api/settings`), everyone's **/profile** (name/phone/avatar, change password,
  light·dark·system theme), leadership **/activity** audit-log viewer
  (`GET /api/audit`), CSV exports (`/api/attendance/export.csv`,
  `/api/expenses/export.csv`), glass 404/500 pages, and quick actions.
