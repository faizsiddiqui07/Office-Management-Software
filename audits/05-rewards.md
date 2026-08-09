# Audit 05 — Rewards / Bonus Points (2026-08-08)

> Process: 5 specialist agents (ledger-integrity, jobs/scheduling, security/config, performance, UX/roles) ne poora module padha → **65 raw findings**. 8 RED/MEDIUM claims adversarially verify hue → **7 confirmed, 1 REFUTED**. Baaki **57 lower-severity PARKED (unverified)**.
>
> **Do sabse critical claims maine KHUD independently test karke confirm kiye** (isolated DB + pure logic) — R1 (config save state wipe) aur R5 (infinite loop). Baaki verifiers ne kai claims ko **PARTIAL** kiya (numbers/scope correct kiye) — wo corrections neeche shamil hain.
>
> **STATUS (2026-08-09): saare 5 RED FIXED.** R1/R3/R4/R5 chhote fixes; **R2 owner ke design se** — *effective-dated rates*.
>
> **R2 ka fix (owner ka design, mere month-snapshot plan se behtar):** rule values ab **tareekh se bandhe** hain. 20 Aug ko on-time +10 → +15 karo to **1–19 Aug ke tasks +10 hi rahenge**, sirf 20 Aug se aage +15. `Setting.bonus.rateHistory` me har change ki entry; har scoring apne **us din** ka rate use karti hai (`ratesOn`/`rulePoints(key, forYMD)`/`graceDaysOn`). Go-live (1 Jul) se aaj ke rates seed hote hain, isliye **koi purana point nahi badla**. Har mahine ka **snapshot table** ab Rewards page + report screen + report PDF teeno pe dikhta hai (rate beech me badla to dono period alag-alag). Config change ka **before/after ab audit log me** bhi jaata hai.
>
> Verified: 11-check rates suite + 13-check R1/R3/R4/R5 suite + PDF render check + clean website build.

Ye module ab tak ka sabse bada hai (`bonus.service.js` akela 1515 lines) aur **aaj hi kaafi kuch badla** (overdue rule V2, rolling streak, half-day, leave reconciles) — agents ko wo sab "intended" bataya gaya tha, isliye ye findings un decisions ke bare me NAHI hain.

---

## 🔴 RED — 5 distinct bugs (7 confirmed findings, kuch overlap)

### R1 — Bonus settings SAVE karte hi poora system-state DB se ud jaata hai
**(confirmed ×2 — findings #5 + #7 same bug; MAINE KHUD TEST KIYA)**

`updateConfig` (`bonus.service.js:131-147`) `s.bonus = { ...10 keys... }` karta hai. Mongoose iska `$set: { bonus: {...} }` bhejta hai — matlab MongoDB me poora `bonus` subdoc **REPLACE** hota hai, merge nahi. Jo fields us literal me nahi hain wo **delete** ho jaate hain.

**Mera test (isolated DB):**
```
BEFORE save : {forwardRuleSeeded:true, overdueDripSeeded:true, overdueRuleV2:true,
               streakV2:true, lastStreakScan:"2026-08-07", streakRuns:{abc:3}}
AFTER  save : {}          ← sab gayab
```

**Teen alag nuksan:**
1. **Rule delete karna NAAMUMKIN.** CEO "Each extra day an assigned task stays overdue" ka Trash dabaakar Save kare → rule hat jaata hai, par `overdueDripSeeded` bhi ud gaya → agle scheduler tick (~5 min) pe `seedOverdueDripRule` rule **wapas** daal deta hai, hardcoded 1 point pe. Wahi `forwardOnTime:3` / `forwardLate:2` ke saath. Code ka apna comment (`:1321`) kehta hai *"Guarded by a flag so removing them later doesn't make them re-appear"* — wo guarantee toot chuki hai.
2. **`streakV2` udne se `rebuildStreakV2` dobara arm** → `PointEntry.deleteMany({source:'auto_streak'})` = **har punctual-streak row, har mahine ki, delete** + go-live se dobara derive. Verifier ne narrow kiya: ye **usi request me self-heal** ho jaata hai (rows same dedupe keys se wapas), to permanent loss nahi — **churn** hai. Par **do case me asli nuksan**: (a) usi save me `punctualStreak` rule bhi hata diya → `runRollingStreak` `if(!pts) return` → history delete hi reh jaati hai; (b) rebuild ke baad **deactivated/ex-employees ki saari streak history permanently chali jaati hai** (roster filter `isActive:true`, `:1031`) — ye bina kisi point-change ke, sirf ek settings save se.
3. **`overdueRuleV2` udne se** poora drip backfill + full overdue scan har save ke baad dobara. Verifier: **points corrupt nahi hote** (insert-only upsert), sirf wasted work + timeout risk.

**Ye pehle ho chuka hai:** audit log me **6 Aug ko 3 baar `bonus.config`** save hua (ADMIN. CONTROLLER). Yaani ye bug production me teen baar fire ho chuka hai.

**Evidence:** `bonus.service.js:131-147`, `:142-143` (sirf historyScored/rescoreVersion carry-forward), `:1320-1330`, `:1342-1351`, `:1080-1094`, `:837-873`, `:1468-1477`; `models/Setting.js:70-122`; `components/settings/bonus-settings.jsx:48`

**Fix shape:** `s.bonus = {...}` ki jagah **field-by-field assign** (sirf jo config keys aayi hain), ya explicitly saare state fields carry-forward karo. Behtar: config aur runtime-state ko **alag subdocs** me rakho taaki ye dobara kabhi na ho.

---

### R2 — Closed mahine mutable hain — **owner ne khud ye pakda tha (July report do baar alag)**
**(confirmed ×2 — findings #4 + #6; + parked #24, #33 same issue)**

Ye ek bug nahi — **11 alag write paths** kisi bhi purane mahine ko dobara likh sakte hain. Ledger me "month closed" ka concept hai hi nahi.

**Sabse bura hissa: mutation ADHURA hai.** `awardOnce` default **insert-only** hai (`:364-366`) — jo row pehle se hai uske `points`/`month` kabhi update nahi hote. Sirf **do** jagah `replace:true` hai — task result (`:524`) aur monthly overtime (`:736`). Nateeja: rule ka rate badlo to **sirf tasks + overtime re-price hote hain, lates/absents/streak/no-leave/perfect nahi** — ek hi mahina **do alag price-lists** pe khada rehta hai.

**Concrete (Rahul, July 2026):**
| | |
|---|---|
| 4 late arrivals (lateArrival=1) | −4 |
| 6 on-time tasks (assignedTaskOnTime=5) | +30 *(5 tasks 7 Jul ke baad, 1 task 3 Jul)* |
| 1 no-leave award (noLeaveMonth=10) | +10 |
| **19 Aug ko July report** | **+36** |

20 Aug: CEO `lateArrival` 1→3 aur `assignedTaskOnTime` 5→8 karta hai. **21 Aug ko wahi July report:**
- lates: **abhi bhi −4** (insert-only, kabhi re-price nahi) — nayi rate ignore
- no-leave: **abhi bhi +10**
- tasks: `rescoreAllDoneAssigned` ka 45-din cutoff = 7 Jul → **5 tasks +8 each = +40**, 3 Jul wala cutoff se bahar **+5 pe atka**
- **Naya July total: +51**

July ka data **ek din nahi badla**, par number **36 → 51**. Aur us mahine ke andar **6 identical tasks me se 5 ko 8 points, 1 ko 5 points**. Yahi wo "do report runs, alag totals" hai jo owner ne dekha.

**Doosra scenario — entry mahina badal deti hai:** task due 28 Jul, completed 3 Aug, grace 0 → late → July me −5. CEO `graceDays` 0→7 kare → ab on-time → row **July se August MOVE** ho jaata hai aur −5 se +5. Ek hi din me do report runs July pe **5 points** ka farak denge.

**Verified write paths (verifier ne kuch narrow kiye):**
| # | Path | Kab |
|---|---|---|
| 1 | `rescoreAllDoneAssigned` — 45-din window, `replace:true` (points + month dono) | **roz** |
| 2 | `pruneOrphanTaskEntries` — kisi bhi mahine ki rows delete (untagged chain / deleted task) | **roz** |
| 3 | `scanOverdueTasks` — −5 mark `overdueDay` ke month me file (July ho sakta hai) | **roz** *(pending marks pe guard hai — `:802` existence check)* |
| 4 | `recomputeMonthlyOvertime` — deleteMany + rewrite, **koi month floor nahi** | attendance settings change / checkout |
| 5 | `recomputeAllOvertime` — workEnd/buffer badlo → har affected user-month rebuild | Settings save |
| 6 | `onAssignedTaskDone` (app edits: task.service `:361, :411, :594`) — late result `overdueDayFor` pe file | har task edit |
| 7 | reconcile helpers (late/absence/no-leave/perfect) — **owner ka intended rule**, par report-stability yahi todta hai | leave/attendance events |
| 8 | `catchUpHistory → backfillMonth` — closed month ko **aaj ke rates** se likhta hai | har mahine ek baar |
| 9 | Manual `POST /bonus/backfill` | kabhi bhi (manageSettings) |
| 10 | `rebuildStreakV2` — saare streak delete + re-derive | R1 ki wajah se **har settings save** |
| 11 | `removeEntry` — koi bhi purani entry, koi guard nahi (CEO-only) | kabhi bhi |

*Verifier corrections:* `consolidateOvertime` aur `clampPreGoLive` self-terminating/narrow hain (live threat nahi); `awardManual` ka bogus-month **UI se reachable nahi** (sirf API surface).

**Fix shape:** ek `closedThrough: 'YYYY-MM'` watermark + **ek chokepoint pe guard** — `awardOnce` aur is file ke saare `PointEntry.deleteMany` (13 jagah). Reconcile helpers ko closed month me ya to **chup rehna** hoga, ya **current month me adjusting entry** likhni hogi (accounting style), warna leave-approve phir history chhedega.

---

### R3 — `backfillMonth` har EXCUSED late ki penalty wapas likh deta hai *(confirmed, PARTIAL)*

`backfillMonth` step 1: `Attendance.find({ status:'LATE' })` — **`excused` flag dekhta hi nahi**. Har match pe `awardOnce('auto_late:...')`. Par ledger ka sach `reconcileLatePenalty` hai jo `status==='LATE' && !excused` pe chalta hai — excuse karne pe status **LATE hi rehta hai**, sirf `excused:true` hota hai aur PointEntry row delete ho jaati hai. Backfill ko wo delete dikhta hi nahi → insert-only upsert **dobara daal deta hai**.

**Din-ba-din (lateArrival = 2):**
- 4, 11, 18, 21, 26 Aug: Priya client visit se late → −2 × 5 = **−10**
- HR paanchon din **"excuse (on-duty)"** kare → paanchon rows delete → August net **0**. ✅ Sahi.
- **1 September, pehla tick:** `catchUpHistory` (throttle ke UPAR) → `backfillMonth('2026-08')` → step 1 phir se 5 LATE rows dhoondta hai (`excused:true` ignore) → paanchon **−2 wapas** → Priya ka **closed August −10**, bina kisi notification ke.

*Verifier correction:* automatic path har closed mahine ko **theek ek baar** backfill karta hai (watermark aage badhta hai), to "permanent tug-of-war" sirf **manual button** se hota hai. Automatic akela **ek-baar-ka silent −10** hai. Aur half-day wala bhai-case affected nahi (`leave.service:670` status PRESENT kar deta hai) — **excused hi ekmatra chhed hai**.

Ye seedha owner ke **"excused late = on-time"** rule ko todta hai (`reconcilePerfectMonth` aur `runRollingStreak` dono `!excused` maante hain, sirf `backfillMonth` nahi).

**Evidence:** `bonus.service.js:1133-1142` (query `:1136` me filter missing), `:557-569`, `:1205-1222`, `:1468`; `attendance.service.js:211`
**Fix:** query me `excused: { $ne: true }` + jo rows already galat resurrect ho chuki hain unke keys explicitly delete (warna wo padi rahengi).

---

### R4 — Due-date edit ya task reopen karne se poora overdue-drip history mit jaata hai *(confirmed, PARTIAL)*

`onAssignedTaskUndone` blunt hai: `deleteMany({ taskRef, source: {$in:['auto_task','auto_forward']} })`. Drip rows ka source **bhi** `auto_task` hai aur taskRef wahi → **−5 mark ke saath saare per-day drips bhi udd jaate hain**. Aur `scanOverdueTasks` **kabhi retroactive fill nahi karta** (*"Today only (no retroactive fill)"*, `:820`); `backfillOverdueRuleV2` flag se off ho chuka hai → **deleted drip days permanently gone**.

**Din-ba-din (assignedTaskLate=5, drip=1, grace=0):**
- Task "Vendor audit", Priya, due **1 Aug**
- 2 Aug: −5 mark | 3–20 Aug: 18 drips = −18 → **total −23**
- **20 Aug:** assigner ko lagta hai due date galat thi, use **5 Aug** kar deta hai → `dueChanged` → `onAssignedTaskUndone` → **saari 19 rows delete**
- Agla scan: −5 mark (ab 6 Aug pe) + aaj ka drip = **−6**
- **Sahi hona chahiye tha −19** (due 5 Aug ke hisab se: −5 + 14 drips). **13-14 din ka drip permanently gayab** = chup-chaap ~13 points ka maafinaama

*Verifier corrections:* nuksan **13-14 points** hai, 17 nahi (date shift khud-se 4 din legitimately hataata hai). Aur ek din aur bura ho sakta hai (scan throttle ke neeche hai). **Forward path isme nahi** (wo intentional hai).

**Aur ek raasta jo auditor ne miss kiya:** **assignee khud** apna DONE task reopen karke apne drips wipe kar sakta hai (`setStatus` gate `isOwner`) — ye PENDING→PENDING wale purane hole ka seedha bhai hai, jo pehle fix ho chuka tha.

**Evidence:** `bonus.service.js:528-530`, `:820-823`, `:837-839`; `task.service.js:788-792, :815-819, :361-362`
**Fix:** `onAssignedTaskUndone` me `dedupeKey: { $not: /^auto_overdue:/ }` (drips ko chhod de), ya drip ko chhota backfill window de.

---

### R5 — Koi bhi employee ek URL se Lambda ko 30 second ke liye jaam kar sakta hai *(confirmed; MAINE KHUD TEST KIYA)*

`carryInFor` ka walk: `for (let ym = goLive; ym < targetMonth; ym = nextMonthYM(ym))`. Guard sirf `targetMonth <= goLive` (lexicographic). `nextMonthYM('10000-01')` **apna hi input wapas deta hai** — ek **fixed point** — to loop wahin hamesha ke liye phans jaata hai.

**Mera test:**
```
month="2026-09" → ends after 2 loops       month="zz"      → NEVER ENDS (stuck at 10000-01)
month="2027-01" → ends after 6 loops       month="foo"     → NEVER ENDS
month="2026-13" → ends after 6 loops       month="9999-99" → NEVER ENDS
fixed point: nextMonthYM("10000-01") = 10000-01
```

**Scenario:** koi bhi signed-in employee (**koi permission nahi chahiye** — route sirf `requireAuth`) `GET /bonus/me?month=zz` maar de. Controller `req.query.month` ko **bina validation** service ko deta hai → loop → **Lambda 30s timeout tak 100% CPU**. 20 parallel requests = 20 Lambdas 30s ke liye block (concurrency 10 pe poora app down).

*Verifier ne ek aur raasta pakda jo auditor ne miss kiya:* `GET /api/reports/monthly?date=9999-99-99` bhi hang karta hai — reports ka `isYMD` regex `9999-99-99` ko pass kar deta hai → `Invalid Date` → month `'NaN-NaN'` → wahi loop.

**Evidence:** `bonus.service.js:62-65` (fixed point), `:77-90` (walk), `:300` (leaderboard), `:174-176`; `bonus.controller.js:18-19, :98-99`; `bonus.routes.js:11`; `reports.controller.js:18-22`
**Fix:** entry pe `/^\d{4}-(0[1-9]|1[0-2])$/` validate (warna 400) + walk pe hard iteration cap (~600) + `reports.controller` ka `isYMD` tighten.

---

## ✅ REFUTED — fix NAHI karna
- **"`rebuildStreakV2` me do overlapping ticks streak awards permanently mita sakte hain"** → structure smelly hai (delete pehle, flag aakhir me, koi lock nahi), par scenario impossible: **EventBridge ka minimum interval 1 minute hai aur Lambda timeout 30s** — scheduled ticks structurally overlap kar hi nahi sakte. Aur B khud watermark zero karta hai, to claim ka causal chain hi ulta tha.

---

## ⚠️ PARKED — 57 findings (UNVERIFIED — abhi bug NA maano)

### Ledger / correctness (MEDIUM)
- reconcile helpers **naye rate** pe likhte hain jabki purani rows purane rate pe — do identical employees ka same closed month **alag price**
- **Rolling streak kabhi reconcile nahi hota** — leave approve / late excuse / regularization ke baad reset wapas nahi hota, banta hua award kho jaata hai *(ye R2 ka hissa hai)*
- Snapshot ka `pointsThisMonth` **carry-in ignore** karta hai jabki badge + Rewards page usko jodte hain → **ek user ko ek hi app me do alag numbers**
- **Deactivated employee leaderboard pe zinda** rehta hai, aur uske PENDING tasks hamesha −1/din drip karte rehte hain
- Manual award hamesha **current month** me girta hai (period picker ignore) + `month` body param unvalidated
- Reward rule me **negative value** daalo → guide −X dikhata hai, engine +X credit karta hai
- `scanAbsences` ka **31-din cap** chup-chaap din nigal jaata hai
- Reactivate/role-restore pe purana **streak counter resume** ho jaata hai (4 mahine ka gap invisible)
- **Overtime ka delete-then-write atomic nahi** — beech me crash = us user-month ke OT points permanently gayab
- **Penalty rule hataane par aadha refund**: DONE tasks ka penalty wapas, PENDING ka laga rehta hai

### Jobs / watermarks (MEDIUM)
- Daily throttle **rollup ke BAAD** likha jaata hai — overlapping tick poora heavy tail dobara chala deta hai (comment ulta daava karta hai)
- **Overdue drip ka koi catch-up nahi** — ek timed-out tick us din ka −1/din **hamesha ke liye** kha jaata hai
- `runMonthRollup` **bina kaam kiye watermark jala deta hai** — month-end rule baad me add karo to wo mahina hamesha skip
- `catchUpHistory` watermark **kaam se PEHLE** likhta hai — timed-out backfill = us mahine ke absences hamesha ke liye gayab

### Security (MEDIUM/LOW)
- `awardManual`: **self-award allowed**, magnitude unbounded, `month` seedha body se
- `removeEntry` ka owner check **hardcoded `'CEO_PRESIDENT'` string** (rank-based nahi), aur auto entries ko bhi hard-delete karta hai
- User hard-delete PointEntry rows **peeche chhod deta hai** (orphan ledger)
- Invalid ObjectId → **500** (400/404 ki jagah) — 3 endpoints
- **Config change ka koi before/after audit trail nahi** — jo rules paise decide karte hain unka koi history nahi

### Performance
- **`earnedYMD` pe koi index NAHI** — har weekly/quarterly/FY report + snapshot + 2 daily jobs **poori collection scan** karte hain
- Daily tick **~740 sequential DB ops** — 73% sirf ek loop se — 30s Lambda + M0 ki ~100 ops/s ceiling ke against
- Leaderboard **har baar go-live se aaj tak ka poora ledger** aggregate karta hai — hamesha badhta cost
- `/bonus/me` har page pe **poora ledger** bhejta hai 2-field badge ke liye; Rewards page wahi response **do baar** fetch karta hai
- Yearly (FY) view **1200 poore rows** ek request me
- `pruneOrphanTaskEntries` ka **20000 limit unordered** — cross hone par permanent silent blind spot
- Har award/delete pe `invalidateQueries(['bonus'])` → har browse kiye period ka full-history aggregate **dobara**

### UX
- **Automatic point entry delete karo → ek din me chup-chaap wapas** aa jaati hai (na confirm, na warning, manual se koi farak nahi)
- **Settings closed months ko bina kisi warning ke rewrite karta hai**
- FY view **carry-over deficit drop** kar deta hai aur usi "My points" label + green me dikhata hai
- Leaderboard drill-down ka total uski apni entry list se **contradict** karta hai (net vs earned)
- **Negative balance green "success"** treatment me
- **Rewards page pe koi loading/error state nahi** — failed fetch "0 points" aur *"No points in Aug 2026 — keep it up!"* ko sach ki tarah dikhata hai
- "Give points" **period selector ignore** karta hai → double award ka invite
- Employee price list se **saare caveats gayab**, 0-value rules chhupe, manual items automatic ke saath mile hue
- **Rule text vs code**: streak reset, drip ka August floor, "each point is worth ₹0"
- Closed month rewrite hone par **kisi screen pe kuch nahi** kehta — employee ko sirf badla hua number dikhta hai
- Ek long-overdue task se breakdown **identical −1 rows se bhar** jaata hai, list truncate hoti hai bina notice
- **32px destructive tap target** har point row ke bagal me

## 💡 FEATURE IDEAS (role-wise)
- **Employees:** koi forecast nahi, koi progress nahi, koi "mere points kyun badle" nahi — **jo state ye jawab de sakta hai wo server pe already baitha hai** (streakRuns, carry-in, entry history)
- **CEO/President:** koi **recalculate button** nahi, koi **cost preview** nahi (rule badalne se kitna kharcha), koi **config diff** nahi
- **Managers/employees:** leaderboard ka koi view hi nahi milta

## 🔗 CROSS-CONNECTIONS
- **State change pe points reconcile** — Leaves me FIXED, par yahan **ulta problem** mila: reconcile *hota* hai par **closed month me bhi** hota hai (R2) — yahi report-stability todta hai
- **`:id` unvalidated → 500** — 5th page pe confirm, ab app-wide middleware ka case pakka
- **Write-on-GET / heavy work on request path** — yahan `/bonus/me` ka full ledger
- **Missing indexes** — `earnedYMD` ab sabse bada gap (Dashboard P5 + To-Do T9 + Leaves ke saath ek migration me)
- **NAYA pattern:** *"config save runtime state ko wipe kar deta hai"* (R1) — **har us jagah check karo jahan `x.subdoc = {...}` hota hai** (Settings ke doosre panels: attendance, expenses, visitors, rules)
