# 📋 Audit Programme — Master Index

> Har page ka audit ek alag file me hai. Ye index unhe jodta hai: kaunsa page ho gaya, kya fix hua, kya PARKED hai, aur **cross-page patterns** jo har naye audit me check karne hain. Sab audits complete hone par isi se consolidated phase plan banega.
>
> **Tarika (owner-approved):** har page → 5 specialist agents + adversarial verification → RED bugs owner ko detail me samjhao → jo approve ho wahi fix → baaki sab PARK. Push/zip sirf owner ke kehne par ([[no-auto-push]]).

> **📌 [00-features.md](00-features.md) — saare audits ke feature ideas ka master list, role-wise.** Har audit ke baad usme add karo; consolidated phase me owner wahi se chunega.

## 🗺️ Page status

| # | Page | File | Status | Fixed commits | Parked counts |
|---|---|---|---|---|---|
| 01 | Dashboard | [01-dashboard.md](01-dashboard.md) | ✅ RED fixed | `f0f260c` (pushed) | P1–P14 perf, 3 security-lite, UX+features role-wise |
| 02 | To-Do / Tasks | [02-todo.md](02-todo.md) | ✅ RED fixed (3 owner-reverted) | `30fa00e` fix, `ff41ece` revert, `b7e7a2b` smart warning (pushed) | T1–T10 perf, 5 security ⚠, UX+features role-wise, 1 open sawaal (eligibility UI) |
| 03 | Attendance | [03-attendance.md](03-attendance.md) | ✅ RED fixed (A3 intentionally nahi) + 🎂 birthday feature | commits `a324595`/`19e99a1`/`3cde85b` + zip (local, push pending) | A8/A9 security, A10/A11 perf, UX+features role-wise |
| 04 | Leaves | [04-leaves.md](04-leaves.md) | ✅ 3 RED FIXED (L1/L2/L3) + 2 related edges (perfect-attendance, cancel-reverse-absence); **verify round still incomplete (session limit)** | local commits (push/zip on owner's word) | ~7 security + 4 perf + 5 cross-edge + 13 UX still UNVERIFIED; features role-wise |
| 05 | Rewards / Bonus | [05-rewards.md](05-rewards.md) | 🔴 audited: **5 distinct RED** (7 confirmed findings, 1 refuted); 2 self-verified by me. Awaiting owner approval | none yet | 57 findings UNVERIFIED (ledger/jobs/security/perf/UX) + role-wise features |
| 06 | My Summary | [06-my-summary.md](06-my-summary.md) | ✅ **S1–S4 all FIXED** (3 RED + 1 MEDIUM) | local (push pending) | 32 findings UNVERIFIED + role-wise features |
| 07 | Reports | [07-reports.md](07-reports.md) | ✅ **saatoN RED FIXED** (R1-R7), isolated-DB suite **95/95**, pre-fix regression proof liya | R1-R7 | 56 UNVERIFIED (P1-P10 perf, security, PDF fidelity, UX) + features |
| 08 | Team / Users / User-detail / Roles | [08-team-users-roles.md](08-team-users-roles.md) | ✅ **T3/T5/T6 FIXED** (45/45 suite + pre-fix proof); T1/T2/T4 owner ne mana kiya | T3, T5, T6 | T7–T19 + 5 LOW → [00-open-bugs.md](00-open-bugs.md) |
| 09 | Expenses / Dues | [09-expenses-dues.md](09-expenses-dues.md) | 🔴 audited: **5 RED + 9 MEDIUM** (39 confirmed, 0 refuted; dedupe ke baad). Awaiting owner approval | none yet | 1 LOW |
| 10 | **Settings + Rules** | [10-settings-rules.md](10-settings-rules.md) | ✅ **S1/S3/S5/S7 FIXED** (12/12 suite + pre-fix proof); S2/S4/S6 + 8 MEDIUM parked | S1,S3,S5,S7 | S2/S4/S6 + 8 MEDIUM |
| 11 | Visitors / Announcements / Calendar / Approvals / Activity / Profile | — | queued | — | — |
| 12 | **MASTER consolidation** (cross-page fixes + features phase) | — | end me | — | — |

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
12. **Frontend-only validation** (server pe nahi) — To-Do ✔ (due-date floors sirf UI pe), Rewards ✔ (`?month=` bilkul unvalidated → infinite loop). ⏳ Expenses amounts.
13. **NAYA (Rewards R1): config save runtime-state ko WIPE kar deta hai** — `s.bonus = {...}` poora subdoc replace karta hai, flags/watermarks delete. ⏳ **Har us jagah check karo jahan `x.subdoc = {...}` hota hai** — Settings ke doosre panels (attendance, expenses, visitors, rules), Users ka schedule/taskAssign.
14. **NAYA (My Summary S2): `.limit(N)` wali list se FIGURE banana** — snapshot ka "Points earned" latest 100 rows ka reduce hai, aggregate nahi → yearly view galat. ⏳ Har us jagah check karo jahan ek list fetch karke uska sum/count dikhaya jaata hai (To-Do limit=10000, prune 20000, queue 200).
15. **NAYA (My Summary S3): overlap-query ke rows ko window se CLIP na karna** — poore request ke din har overlapping period me ginte hain. ⏳ Leaves/Reports ke overlap queries me bhi dekho.
16. **NAYA (My Summary S4): period-anchored vs today-anchored standing** — "Right now" figures period ke fiscal year se bandhe hain. ⏳ Reports/Dashboard me bhi ye distinction check karo.
18. **NAYA (Reports): PREVIEW vs PDF fidelity** — screen aur PDF ka gating, labels aur totals alag ho sakte hain (joinedLater notice PDF me nahi; self PDF ka Tasks section kabhi print hi nahi hota; % hint sirf screen pe). ⏳ Har download-able document pe check karo.
19. **NAYA (Reports): ek guard ek jagah, doosri jagah nahi** — custom-range ka 400-din cap `users.controller` me hai, `reports` me nahi (wahi function, wahi khatra). ⏳ Jo bhi guard kisi caller pe lage, uske SAARE callers pe lagao.
20. **NAYA (Reports): numerator/denominator alag din-set pe** — attendance rate aaj tak ginta hai par working-days kal tak → 0% ya 114%. ⏳ Har ratio/percentage pe dono taraf ka cutoff check karo.
17. **NAYA (Rewards R2): closed month ka concept hi nahi** — 11 write paths purane mahine badal sakte hain, aur mutation ADHURA hai (sirf tasks+overtime re-price hote hain) → ek mahina do price-lists pe. Reports ki stability isi pe tiki hai.

27. **NAYA (Settings S2/S4/S10): R2 ka fix AADHA tha** — `rateHistory` ne point ki KEEMAT effective-dated kar di, par ₹/point, grace, workStart/workEnd, overtime buffer aur weekendDays abhi bhi LIVE padhe jaate hain, to inme se koi bhi badalne par band mahina dobara likha jaata hai. ⏳ Har us setting ko dekho jise koi bhi hisaab peeche jaakar padhta hai.
28. **NAYA (Settings S5): rule book aur code ka alag hona** — Rules page overtime ka OFFICE buffer batata hai, scorer har bande ka APNA use karta hai. Jo staff ko likhit me diya jaata hai, wo code se milna chahiye. ⏳ Har {placeholder} token ko uske asli consumer se milaao.
29. **NAYA (Settings S1): apne hi fix se naya crash** — R2 ka commit `33ee465` ne `rulePoints(..., monthEnd)` add kiya jahan `monthEnd` 9 line neeche declare hota tha; function tab se har call pe ReferenceError deta hai aur dono call sites use `console.error` me nigal jaate hain. ⏳ Jo bhi call `try/catch { console.error }` me lipta ho, use ek baar CHALA kar dekho — wo chup-chaap mara ja sakta hai.

24. **NAYA (Expenses E1): client par money parse karna** — `parseFloat` comma par ruk jaata hai, to `12,500.50` → `₹12.00` store hota hai. Aur SAHI pattern usi repo me maujood hai (`type="number"` employee ke box par) par admin ke do money-box par nahi. ⏳ Har wo jagah dekho jahan user ka type kiya number seedha parse hota hai.
25. **NAYA (Expenses E4): ek hi cheez do darwaazon se** — Expenses page `viewExpenses` maangta hai, par Dashboard ka spend-chart wahi data bina us permission ke de deta hai. ⏳ Har gated data ke SAARE raaste ginno — page, chart, export, PDF, dashboard.
26. **NAYA (Expenses E3): sudhaar karte waqt purana sach mit jaana** — due ka amount ghataane par `paid` clamp ho jaata hai, yaani mila hua cash gayab (advance banna chahiye tha). ⏳ Har edit path pe poochho: purana data adjust ho raha hai ya mit raha hai?
21. **NAYA (Team/Users/Roles): “aaj ka adhoora din absent gin liya” — teesri baar** — Attendance (A-series) aur Reports (R2) me ye mil chuka tha; ab **User-detail dossier** ki Absent tile me bhi (`dossier.service.js:108-111`). Sabse chubhne wali baat: **usi function** ki day-by-day table me guard laga hua hai (`:137-147`), sirf tile me nahi. Matlab convention likhi hui hai, lagayi har jagah nahi gayi. → kisi ek shared helper se hi “absent” nikalna chahiye.
22. **NAYA (Team/Users/Roles): frontend permission model backend se alag hai** — Backend **rank-based** hai (`canAssignRole`, `getRoleRank`), frontend abhi bhi **hardcoded key list** `LEADERSHIP = ['CEO','DIRECTOR']` maanta hai. Live deployment me koi role in keys ka hai hi nahi → filter kuch karta hi nahi, aur owner role **default pre-select** ho jaata hai. Isi jad se T9, T10 dono nikalte hain. (`/roles/options` rank ko response se **strip** kar deta hai — to frontend chah kar bhi rank nahi dekh sakta.)
23. **NAYA (Team/Users/Roles): granular permission toggle sirf naam ka hai jab tak uska apna surface na ho** — `manageUsers` / `changeRoles` / `resetCredentials` / `deactivateUsers` — chaaron ka koi apna darwaza nahi; sab `createUsers` ke peeche band hain. Ulta bhi sach hai: page ka gate (`createUsers`) aur uske data ka gate (`viewEveryone`) **alag** hain, to ek permission milne par bhi screen 403 dikha sakti hai. Har naye toggle ke saath ye poochna chahiye: *iska darwaza kahan hai, aur uske peeche ka data kis gate par hai?*

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
