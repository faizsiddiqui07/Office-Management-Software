# Audit 03 — Attendance (2026-08-08)

> Process: 5 specialist agents (timezone/calc, check-in flow, security, performance, UX/roles) + 12 adversarial verifications → **10 REAL, 2 REFUTED**. Har bug owner ko detail me samjha ke, unki approval ke baad hi fix hua ([[explain-bugs-before-fixing]]).
>
> **STATUS (2026-08-08, push/zip abhi NAHI hua):** ✅ **A1, A2, A4, A5, A6, A7 — saare RED fix**, sirf A3 chhoda. ⛔ **A3 — owner ne kaha intentional hai, fix mat karo.** Verification: do isolated-DB tests (14 + 20 = 34 checks, sab pass) + website build clean.
>
> **A5 ka birthday part** ek NAYE two-way sync feature se solve hua (owner ka design): User pe `dateOfBirth` + Profile page picker + Calendar pe employee-linked BIRTHDAY entry — dono taraf sync; apne birthday pe late penalty nahi. Naye shared helpers: bonus.service.js me `reconcileLatePenalty()` + `clearAbsencePenalty()`; attendance.service.js me `isOffDayFor()`; holiday.service.js me `syncBirthdayForUser()`.
>
> **Security A8/A9, perf A10/A11, aur saare UX/features consolidated phase ke liye PARKED hain.**

## 🔴 RED — points/data correctness (VERIFIED REAL)

| # | Bug | Kya hota tha → kya kiya | Evidence |
|---|---|---|---|
| A1 | ✅ **FIXED — Excused late ki penalty nahi lauti thi** | Leadership late ko "excused/on-duty" mark kare → reports me punctual, par check-in ka −lateArrival penalty kabhi reverse nahi hota tha (`excuseLate` sirf flags set karta tha). **Fix:** naya `reconcileLatePenalty(userId, ymd, shouldPenalise)`; excuse → `auto_late` delete, un-excuse → wapas add. Configured value use hoti hai (**−1**, hardcoded nahi). | attendance.service.js:194-206; bonus.service.js:548-560 |
| A2 | ✅ **FIXED — Corrected absent ki penalty padi rehti thi** | Daily scan missed day pe −absentDay likhta hai; baad me din correct ho jaye (regularization/leadership edit) to sirf overtime recompute hota tha — `auto_absent` kabhi delete nahi, watermark aage badh chuka to self-heal bhi nahi. **Fix:** naya `clearAbsencePenalty(userId, ymd)`; `setAttendanceRecord` + regularization `applyToAttendance` dono me, jab bhi din ko asli check-in mile. | bonus.service.js:566-572; attendance.service.js:186-190; regularization.service.js:168-172 |
| A3 | ⛔ **FIX NAHI — owner: intentional, aise hi rehne do** | `checkOut` din `now` se nikaalta hai; IST midnight ke baad overtime wala banda check-out kare to lookup AGLE din pe jaata hai → `NOT_CHECKED_IN`. Documented, jaan-boojh ke nahi chheda. | attendance.service.js (checkOut) |
| A4 | ✅ **FIXED — Leave wale din check-in leave mita deta tha** | `checkIn` sirf ALREADY_CHECKED_IN + WFH rokta tha — ON_LEAVE guard tha hi nahi. Full-day approved leave wala "Check in" dabaa de → status PRESENT se overwrite, leave marker gayab, par balance pehle hi charged + LeaveRequest APPROVED — din ka double-count. **Fix (owner-approved):** **FULL-day** leave (`ON_LEAVE && !halfDayLeave`) → check-in BLOCK (`ON_LEAVE` error, WFH jaisa). **HALF-day** (`halfDayLeave`) → worked half ke liye check-in ALLOWED — PRESENT, flag preserved (0.5 hi charge), aur **us din late penalty nahi** (owner ka choice: half-day din pe penalty hi nahi). | attendance.service.js:75-100 |
| A5 | ✅ **FIXED — Off-day/holiday/birthday check-in LATE + deduct karta tha** | `isLateCheckIn` sirf workStart+grace compare karta tha, working-day guard nahi — apne off-day/holiday pe aane wala grace ke baad LATE + −1. **Fix:** naya `isOffDayFor(user, ymd, settings)` = company holiday YA user ka weekend/off-day (Sunday etc.) YA **uska apna birthday** → PRESENT, koi penalty nahi (overtime phir bhi count). `checkIn`, `setAttendanceRecord`, regularization teeno me lagta hai. Birthday niche wale naye DOB/sync feature se reliable hua. | attendance.service.js:28-42, 88-92 |
| A6 | ✅ **FIXED — Live overtime server se zyada dikhata tha** (roz dikhne wala) | Card ka live "Overtime" workEnd (6 PM) se ginta tha, par server sirf workEnd + buffer ke baad credit karta hai (60 → 7 PM). 6:45 tak ruko → card "45m overtime", checkout 0 likhta. **Fix:** `getTodayPayload.settings` ab `overtimeAfterMinutes` bhejta hai (office ya per-user override); `use-attendance-today.js` ab `workEnd + buffer` se ginta hai. | attendance.service.js:322-325; use-attendance-today.js:109-119 |
| A7 | ✅ **FIXED — Leadership-set/corrected LATE: penalty na lagti thi na hatati thi** | `auto_late` sirf self-service `checkIn` likhta tha. Leadership late din type kare → koi penalty nahi (self check-in se inconsistent — leadership se time daalwa ke penalty bach sakti thi); self-late din on-time me correct ho → purani penalty padi rehti. **Fix (owner: consistent, dono direction):** `setAttendanceRecord` + regularization ab `reconcileLatePenalty(user, ymd, status==='LATE' && !excused)` call karte hain → leadership-typed LATE pe bhi −penalty; on-time/absent me correct hone par penalty removed; excused pe kabhi nahi. | attendance.service.js:191-194; regularization.service.js:173-175 |

## 🎂 NAYA FEATURE — Date of birth + Calendar↔Profile sync (A5 ke saath shipped)

Owner ka design — birthday late-exemption ko reliable banane ke liye (naam-matched BIRTHDAY docs user se map nahi ho sakte the).
- **User.dateOfBirth** (`'YYYY-MM-DD'`) + **Holiday.userId** (BIRTHDAY entry ko person se jodta hai).
- **Profile page** (`/profile`): "Date of birth" picker — koi bhi apni khud set kare → `PATCH /auth/profile { dateOfBirth }`.
- **Calendar** (`holiday-dialog`): BIRTHDAY ke liye free-text title ki jagah **employee picker** ("Whose birthday?"); pick karte hi `userId` link + label = employee ka naam. Purane free-typed birthdays waise hi chalte hain (unlinked — re-link hone tak exemption nahi).
- **Two-way sync:** profile save → `syncBirthdayForUser()` linked BIRTHDAY entry upsert/move/delete karta hai; calendar pe linked BIRTHDAY create/edit/delete → `User.dateOfBirth` wapas likha jaata hai (delete = clear).
- **Exemption:** `isOffDayFor` apne birthday (month-day match) ko no-late-penalty din maanta hai.
- Files: models/User.js, models/Holiday.js, services/holiday.service.js, controllers/auth.controller.js, validators/{auth,holidays}.validators.js, app/(app)/profile/page.jsx, components/calendar/holiday-dialog.jsx.
- **Verified:** 20-check isolated-DB test (dono sync directions, create/move/clear, exemption) — sab pass.

## 🔒 SECURITY (verified REAL — consolidated phase me fix honge)

- **A8 — attendanceOverview har colleague ka GPS + IP + userAgent + email leak karta hai** kisi bhi `viewEveryone` holder ko (MANAGER tak). UI sirf naam use karta hai; API `checkInMeta {ip,userAgent,lat,lng}` + email bhejti hai. listAttendance me bhi (meta only, email nahi). — attendance.service.js (overview/list)
- **A9 — setAttendanceRecord & excuseLate pe koi self-guard/rank-guard NAHI** → non-leadership role jise `approveRegularization` mila ho, APNE hi check-in times set kar sakta hai (fake on-time / overtime inflate) ya apni late excuse — regularization ka deliberate self-approval block bypass. Junior senior ka record bhi edit kar sakta hai. *Default roles me sirf leadership ke paas ye permission hai (wo attendance track nahi karte), to impact latent hai — custom role bante hi live ho jaayega.*

## ⚡ PERFORMANCE / FUTURE (verified REAL — consolidated phase me)

- **A10 — recomputeAllOvertime settings-save handler me SYNC chalta hai:** workEnd/buffer change → har completed Attendance record ka full unindexed scan + sequential per-user-month point rebuilds (~240 seq ops 12 mahine pe). API-Gateway 30s timeout ka risk, Lambda slot hold. Admin action rare hai, par double mis-save = do storms. Fix (sign-off ke saath): async karo / scan bound + index / batch. — settings.controller.js; attendance.service.js (recomputeAllOvertime)
- **A11 — export.csv 5000 pe hard-cap, no .lean(), silent truncation:** full-year all-staff export (12 mahine me >6000 rows) chupchaap rows drop karega (payroll/audit trap) + 5000 docs ek saath hydrate. — attendance.controller.js; attendance.service.js (export)

## ✅ REFUTED (bugs NAHI hain — fix mat karna)
- "backfillMonth excused lates ko penalise karta hai" → wo live check-in hook ko hi MIRROR karta hai; excuse sirf positive award scans ko shield karta tha. Consistent tha; asli gap A1 tha (ab fixed — excuse ab penalty bhi reverse karta hai).
- "attendanceOverview no cache = medium risk" → jo schedule subdocs load hote hain wo ZAROORI hain (part-timer off-days, AWAITED math); ~20 users pe theek. Low `.lean()` note tak downgrade.

## 🎨 UX GAPS (parked — consolidated phase)

- Overtime buffer employee ko kahin explain nahi hota (OT "der se kyun shuru" hota hai) — A6 ke saath pair
- Apni shift + grace card pe nahi dikhti (6 custom-shift users andhere me)
- "You're late" dialog cutoff nahi batata, na kitne minute late — data payload me hai
- Checkout copy GALAT: "added to your leave balance" — OT ab alag bank hota hai, leave days nahi
- Holiday card pe surface nahi hota (WFH hota hai; holiday nahi)
- Geofence-denied message generic — distance/radius nahi dikhata
- Mobile grid 8 columns — jis phone se check-in hota hai usi pe heavy horizontal scroll

**Low bugs (parked):** double-tap race (read-then-write atomic nahi — hooks idempotent hain to low); ABSENT din pe checkout-only regularization se checkOut bina checkIn ke reh jaata hai; regularization `remove()` decided records bhi delete karta hai (audit-trail gap); `:id`/`:userId` params unvalidated → 500; onCheckOut ka dead 3rd arg; requested correction times pe koi plausibility bound nahi

## 💡 FEATURE IDEAS (role-wise — consolidated phase)

**CEO & President / leadership:** bulk mark-absent/present (abhi ek-ek karke); "never checked out" anomaly tile + filter (bhoole hue checkouts ek nazar me); regularization queue ka approvals-strip me count; A10 fix ke saath settings-change ka impact preview.

**Employees (sab jo attendance mark karte hain):** punctual-streak progress attendance page pe ("2 din aur → +N points"); forgot-checkout → correction shortcut (abhi form khud dhoondhna padta hai); apni shift/grace/buffer card pe; birthday wale din card pe "Happy birthday — aaj late nahi ginenge 🎂" note.

**Part-timers / custom-shift:** shift context card (mere workDays, mera workStart–workEnd, mera buffer) — abhi office-wide values se confuse hote hain.

**Security/PSO jaise roles:** (dashboard audit se carry) — light `logVisitors` permission + shift card yahan bhi relevant.

## 🔗 CROSS-CONNECTIONS (doosre pages se)

- **State change pe points reverse nahi hote** (A1, A2, A7) — To-Do ke undo-behaviour wali hi root class; ab shared `reconcileLatePenalty`/`clearAbsencePenalty` helpers ban gaye — **Leaves audit me bhi yahi class dhoondo** (leave cancel/approve pe points?)
- **isActive / day-type guards missing** — recurring pattern (dashboard me tha; yahan A4/A5 the) — har agle page pe check karo
- **PII over-exposure in list payloads** (A8) — Team/Reports/Users ke har list endpoint pe check karo
- **Sync heavy work request path pe** (A10) — dashboard ke write-on-GET wali class
- **Device-clock vs server-time** — A6 usi theme ka attendance-side hai jo dashboard pe fix hua
- **Attendance ↔ Leaves data flow:** ON_LEAVE/halfDayLeave markers leave.service likhta hai, attendance page unhe dikhata hai; A4 fix ne is boundary ko tight kiya — Leaves audit me ulti direction check karo (leave cancel hone par attendance row ka kya hota hai?)
- **Attendance ↔ Rewards:** auto_late/auto_absent/auto_ot/auto_streak sab attendance se nikalte hain — Rewards audit me ledger-vs-attendance consistency check karo
