# 📋 Audit Programme — Master Index

> Har page ka audit ek alag file me hai. Ye index unhe jodta hai: kaunsa page ho gaya, kya fix hua, kya PARKED hai, aur **cross-page patterns** jo har naye audit me check karne hain. Sab audits complete hone par isi se consolidated phase plan banega.
>
> **Tarika (owner-approved):** har page → 5 specialist agents + adversarial verification → RED bugs owner ko detail me samjhao → jo approve ho wahi fix → baaki sab PARK. Push/zip sirf owner ke kehne par ([[no-auto-push]]).

## 🗺️ Page status

| # | Page | File | Status | Fixed commits | Parked counts |
|---|---|---|---|---|---|
| 01 | Dashboard | [01-dashboard.md](01-dashboard.md) | ✅ RED fixed | `f0f260c` (pushed) | P1–P14 perf, 3 security-lite, UX+features role-wise |
| 02 | To-Do / Tasks | [02-todo.md](02-todo.md) | ✅ RED fixed (3 owner-reverted) | `30fa00e` fix, `ff41ece` revert, `b7e7a2b` smart warning (pushed) | T1–T10 perf, 5 security ⚠, UX+features role-wise, 1 open sawaal (eligibility UI) |
| 03 | Attendance | [03-attendance.md](03-attendance.md) | ✅ RED fixed (A3 intentionally nahi) + 🎂 birthday feature | commits `a324595`/`19e99a1`/`3cde85b` + zip (local, push pending) | A8/A9 security, A10/A11 perf, UX+features role-wise |
| 04 | Leaves | [04-leaves.md](04-leaves.md) | ✅ 3 RED FIXED (L1/L2/L3) + 2 related edges (perfect-attendance, cancel-reverse-absence); **verify round still incomplete (session limit)** | local commits (push/zip on owner's word) | ~7 security + 4 perf + 5 cross-edge + 13 UX still UNVERIFIED; features role-wise |
| 05 | Rewards | — | queued | — | — |
| 06 | My Summary | — | queued | — | — |
| 07 | Reports | — | queued | — | — |
| 08 | Team / Users / Roles | — | queued | — | — |
| 09 | Expenses / Dues | — | queued | — | — |
| 10 | Visitors / Announcements / Calendar / Settings / Rules | — | queued | — | — |
| 11 | **MASTER consolidation** (cross-page fixes + features phase) | — | end me | — | — |

## 🔗 CROSS-PAGE PATTERNS (running list — har naye audit me check karo)

Har pattern ke aage: kahan mila ✔, kahan check karna baaki ⏳.

1. **State change pe points reverse/apply nahi hote** — To-Do ✔ (undo/reopen/delete), Attendance ✔ (A1/A2/A7), **Leaves ✅ FULLY FIXED (L1 `clearAbsencePenalty`; L2 `reconcileNoLeaveMonth`; + `reconcilePerfectMonth` & `reconcileAbsence` on approve/cancel — leave.service ab bonus.service import karta hai)**. ⏳ Rewards (manual entries), Expenses — inme yahi class check karni hai.
2. **isActive / day-type guards missing** — Dashboard ✔ (leaderboards/whosOut), To-Do ✔ (scanOverdueTasks deactivated users ko penalise karta hai), Attendance ✔ (A4/A5). ⏳ Team, Reports, Rewards.
3. **PII over-exposure in list payloads** — Attendance ✔ (A8: GPS/IP/UA/email). ⏳ Team, Users, Reports, Visitors ke list endpoints.
4. **$nin(forwardedFrom) unbounded growth** — Dashboard ✔ (P4), To-Do ✔ (source: listTasks/eodDigest/badges) — ek `wasForwarded` flag teeno theek karega. ⏳ consolidated me ek saath.
5. **Missing indexes** — Dashboard P5 + To-Do T9 → ek index migration me: `LeaveRequest {status,endYMD}/{status,startYMD}`, `Task {status,assignedBy,completedAt}`, `submittedAt`, `dueYMD`, `completedAt`. ⏳ har naye page ke queries se list badhao.
6. **Polling / standing load budget** — Dashboard P1/P6/P8/P11 (app-open burst, EOD 5-min, points badge, badges+notifications 60s), To-Do T1 (2×20s limit=10000 — sabse bada M0 burner). ⏳ ek app-wide polling review consolidated me.
7. **Sync heavy work request path pe / write-on-GET** — Dashboard ✔ (balance write-on-read fixed), Attendance ✔ (A10 settings-save recompute), **Leaves ⚠ (GET /leaves/balance + GET /users/:id/leave-balance ab bhi getOrCreateBalance = write path; dashboard fix yahan reh gaya — UNVERIFIED)**. ⏳ Settings, Rules seed, announcements publish.
8. **Device-clock vs server-time** — Dashboard ✔ (fixed: serverNow offset), Attendance ✔ (A6 fixed). ⏳ koi bhi naya live ticker.
9. **Period/month math har jagah alag** (computePeriod vs manual) — Dashboard ✔ note. ⏳ Reports, My Summary, Rewards boundaries.
10. **Stale comments/docs vs code** — Rules page ✔ (pehle bite kiya), To-Do ✔ (3 stale "submit day" comments). ⏳ har page pe.
11. **`:id` params unvalidated → 500** — To-Do ✔, Attendance ✔ (low). ⏳ ek app-wide param-validation middleware consolidated me.
12. **Frontend-only validation** (server pe nahi) — To-Do ✔ (due-date floors sirf UI pe). ⏳ Leaves dates, Expenses amounts.

## 📊 Data flows (kaun page kis page ka data dikhata hai)

- **Attendance → Dashboard:** Today card, team donut/counts, overtime leaderboard — sab attendance records se.
- **Leaves → Attendance:** leave.service ON_LEAVE/halfDayLeave markers likhta hai; attendance sheet unhe dikhata hai; check-in ab full-day leave pe block (A4). **Leaves audit me ulti direction dekhni hai: leave cancel → attendance row ka kya hota hai.**
- **Attendance → Rewards/Points:** auto_late (check-in), auto_absent (daily scan), auto_ot (checkout/recompute), auto_streak (weekly) — sab attendance se PointEntry ledger me.
- **To-Do → Rewards/Points:** auto_task/auto_forward + drips; eligibility owner-tag pe.
- **To-Do → Dashboard:** open-tasks KPI, task leaderboard, EOD digest.
- **Calendar (holidays) → Attendance/Leaves:** holidayYMDSet working-day math sab jagah; **BIRTHDAY ab User.dateOfBirth se two-way sync** (audit 03 feature).
- **Settings → sab kuch:** workStart/End/grace/buffer/weekendDays/bonus rules — Setting.getSingleton 3s-cache; effectiveSchedule per-user override.
- **Users/Roles → sab kuch:** permissions, rank, taskAssign, isActive — role cache restart-bound ([[role-permission-cache]]).

## ❓ OWNER KE OPEN DECISIONS (abhi tak)

1. **Eligibility UI** (To-Do): untagged task pe warning dikhaye, ya owner ko auto-tag kare, ya dono? — **undecided, parked**
2. Consolidated phase ka order jab saare audits ho jayen: pehle security, phir perf, phir UX/features — ya owner priority dega.

## ✅ OWNER KE LIYE HUE FAISLE (dobara mat poochho)

- "ADMIN. CONTROLLER" teesra CEO_PRESIDENT = **intended**; alag role nahi banana.
- Rank enforcement task-assign me **nahi** chahiye — purely per-person (`taskAssign.mode`) hi rahega; junior CEO ko assign kar sakta hai = theek.
- To-Do ke 3 reverts (drip clearing, delete cascade, self-reopen) = **jaan-boojh ke wapas**; block ki jagah confirm dialog.
- A3 (IST-midnight checkout) = **intentional, fix nahi karna**.
- Late penalty configured value se (abhi **−1**), kabhi hardcode nahi.
- A4 half-day: worked half pe check-in allowed, **us din late penalty nahi**.
- A7: leadership-typed LATE pe bhi penalty (consistent, dono direction reconcile).
