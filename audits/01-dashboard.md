# Audit 01 — Dashboard (2026-08-07)

> Process: 5 specialist agents (correctness, security, performance, leadership-UX, roles-UX) + 10 findings ka adversarial verification. 9 verified REAL, 1 REFUTED. Red bugs **usi din fix** (commit `f0f260c`), baaki yahan pending hain.

## ✅ FIX HO CHUKA (commit `f0f260c`)

1. **Stale-after-check-in** — check-in/out ab `['dashboard']` query bhi invalidate karta hai; Today card + Team counts turant update. (`use-attendance-today.js`)
2. **Permanent "Not in" warning** — personal cards ab per-permission: Today/Overtime → `markAttendance`, Leave/Pending → `applyLeave`. BP_TEAM/EXECUTIVE_MANAGER ki jhoothi warning gayi. (`dashboard/page.jsx`)
3. **Donut/rate contradiction** — breakdown me `awaited` (not in yet) + `offToday` (part-timer off-day) slices; slices ab roster se sum hote hain. `team.awaited` + hints. (`dashboard.service.js`, `charts.jsx`) — *shared `attendanceOverview` untouched.*
4. **Deactivated users** — whosOut me hidden + deduped; overtime/task leaderboards filter (over-fetch 10 → slice 5, `withNames` me `isActive` filter). ULTA case: `ownerTierUserIds` ab isActive filter NAHI karta (sole CEO deactivate → board history blank hoti thi) + all-roles-rankless guard (honest empty). (`dashboard.service.js`)
5. **Write-on-read** — naya `balanceJSONReadOnly` (leave.service me; leave flows purane `getOrCreateBalance` pe hi); dashboard kabhi LeaveBalance row create nahi karta (quota-freeze hazard band). Leadership balance/myPendingLeaves SKIP → 4-5 queries kam per open.
6. **Admin Manager ka dead expense card** — `&& !analytics` gate hataya; ab har viewExpenses holder ko month-total + categories.
7. **Dead-end "Review →"** — sirf `approveLeave` walon ko link.
8. **Open tasks KPI** — sirf delegated (`assignedBy != null`); personal to-dos excluded. Hint: "delegated work pending".
9. Chhote: `/dashboard/leaders` month validation (9999-99 → 400); header date IST-pinned; attendance ticker/cooldown/would-be-late **server time** se (serverNow offset); whosOut dedupe.

**REFUTED claim (fix ki zaroorat nahi):** "Birthday notifications kho sakte hain (fire-and-forget)" — EventBridge tick unhe awaited chala ke bhejta hai (scheduler.service.js:29); dashboard wala path sirf redundant backup hai.

## ⏳ PENDING — Performance / Future-risk (consolidated phase me)

| # | Item | Detail | Evidence |
|---|---|---|---|
| P1 | **10 AM burst** | Ek app open ~10 requests (auth/me, settings, branding, badges, notifications, bonus/me, dashboard, attendance/today, holidays, announcements; owners +eod) vs Lambda concurrency 10. 15 users = ~150 req burst. | page.jsx + shell libs |
| P2 | **buildDashboard waterfall** | Common block ~6 serial await groups; independent hain, Promise.all me batch karne se wall-time ~60-70% giregi | dashboard.service.js:201-231 |
| P3 | **/attendance/today duplicate** | Dashboard payload me `out.today` wahi data hai; QuickAttendanceAction alag request dagta hai. `setQueryData(['attendance','today'], data.today)` se ek invocation bachegi | page.jsx:177 |
| P4 | **taskAll all-time scan + $nin unbounded** | Har open pe saare DONE delegated tasks 2x scan; `forwardedFrom` distinct ka $nin array hamesha badhega. Fix: taskAll lazy, `wasForwarded` flag, index `{status,assignedBy,completedAt}` | dashboard.service.js:74-120,226,230 |
| P5 | **Missing indexes** | `LeaveRequest {status,endYMD}` + `{status,startYMD}`; `Task {status,assignedBy,completedAt:-1}`. Attendance/PointEntry/Expense OK verified. | models |
| P6 | **EOD digest all-day polling** | App-wide (app-shell), har 5 min, subah se — kyunki ready sirf shaam ko hota hai. Time-gate karo ya dashboard payload me flag | eod-digest-popup.jsx:49-53 |
| P7 | **active-unseen unbounded** | Announcements kabhi expire nahi hote; query saare visible full-body laati hai. limit(20) + date cutoff | announcement.service.js:112-125 |
| P8 | **Points badge 200 docs** | Har page pe /bonus/me full entries; sirf {enabled, points} chahiye. `?summary=1` variant | points-badge.jsx, bonus.service.js:189 |
| P9 | Dashboard 100 announcements fetch, 5 use; holidays 500-cap expand, 5 use | listVisible limit param | dashboard.service.js:205,210 |
| P10 | expenseSummary ke 6 aggregations (12-mo trend samet) jabki card ko 3 fields chahiye | lean variant | expense.service.js:142-172 |
| P11 | badges+notifications 60s polling merge (aadha load); badges ka passedOn distinct bhi $nin-type growth | badges.service.js:27-59 |
| P12 | Dashboard query staleTime 30s → 2-5 min (wapsi navigation heaviest endpoint refire karta hai) | page.jsx:135 |
| P13 | **Settings backgrounds legacy base64 check** — agar bgLight/bgDark abhi bhi data: hain to GET /settings ~0.9MB/pull; S3 confirm karo | — |
| P14 | 'Shell bootstrap' endpoint idea — me+settings+badges+points+unread ek invocation me (~10 → ~5 req/open) | — |

## ⏳ PENDING — Security/privacy (chhote)

- Sick-leave TYPE sabko dikhta hai (whosOut) — non-managers ke liye "Leave" collapse karna
- `/dashboard/leaders` har user ke liye khula (exact OT minutes kisi bhi month ke) — intended hai to theek, warna gate
- pendingApprovals list `leadershipDashboard` pe gated, `approveLeave` pe nahi (future custom-role risk)
- **VERIFIED CLEAN**: payload-vs-permission matrix sahi; koi cross-user leak nahi; IDOR nahi; EOD owner-gated server-side

## ⏳ PENDING — UX improvements + Features (consolidated phase)

**Leadership:** Right-now roster naam ke saath (data ready — overview rows phenki jaati hain); approvals strip teeno queues (Leaves/Corrections/Task reviews) — abhi sirf leave; Team-today vs analytics duplication; birthdays holidays-card me unlabeled; recent activity me entity/target गायब; period-mix stat row; rate tone hardcoded green; mobile ordering (decision-widgets neeche); EOD dismiss ke baad wapas dekhne ka rasta nahi; expense delta vs last month; quick actions me Assign task/Dues/Visitors/Give points.

**Self:** "My tasks due/overdue" card (sabse bada gap); WFH remaining render (data payload me already!); points earned/carried/net card; streak progress nudge ("2 din aur, +N"); leaderboards vs actionable content ordering; pending leaves duplication; overtime hint "this year" → "since Apr".

**Role-specific:** Admin Manager (dues outstanding card, visitors today, regularization queue); Security/PSO (logVisitors light permission + Log visitor button, shift card); delegators ("Assigned by me: N pending, M overdue"); part-timers (shift context card); birthday top-banner.

## 🔗 CROSS-CONNECTION SEEDS (doosre audits me check karna)

1. **isActive filter inconsistency** — yahan leaderboards/whosOut me mila; Team/Reports/Rewards/leaderboard me bhi check karo
2. **$nin(forwardedFrom) unbounded pattern** — dashboard taskLeaderboard + eodDigest + badges passedOn — To-Do audit me source of truth
3. **Missing indexes** (P5) — har page jo LeaveRequest/Task chhoota hai
4. **Polling/standing load** — badges/notifications/eod app-wide
5. **Period/month math** har jagah alag (computePeriod vs manual) — subtle boundary bugs ka source
6. **Device clock trust** — attendance me fix hua; doosre live tickers check karo
7. **Write-on-GET pattern** — yahan balance tha; doosre GET paths me side-effect writes dhoondo (rules seed, publishDueAnnouncements known)
