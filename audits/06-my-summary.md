# Audit 06 — My Summary (2026-08-09)

> Process: 4 specialist agents (figures/consistency, security/perf, UX, roles/features) → **40 raw findings**. 8 RED/MEDIUM adversarially verify hue → **8 confirmed, 0 REFUTED**. Baaki **32 PARKED (unverified)**.
>
> Confirmed 8 me se **4 ek hi bug hain** (chaaron agents ne alag-alag angle se pakda) — to asli me **3 RED + 1 MEDIUM**.
>
> **STATUS (2026-08-10): S1, S2, S3, S4 — chaaron FIXED** (owner-approved). 11-check isolated-DB suite + ek decisive S4 test + clean website build. 32 parked findings abhi bhi verify ke intezaar me.
>
> **Fix summary:** S1 — `standing` ab `{pointsThisMonth: net, pointsEarnedThisMonth, pointsCarriedOver}` bhejta hai (`carryInFor` ab exported), card NET dikhata hai + deficit hone par hint me split. S2 — `.find().limit(100)` + JS reduce ki jagah DB `$group $sum`; dead `pointRows` payload hataya. S3 — `leaveDays` ab `report.attendance.totals.onLeave` se (per-day, half-day-aware). S4 — `standing.leave`/`standing.wfh` ab `balanceJSONReadOnly(user, leaveYearOf(today))` se, period se nahi.

Ye module chhota hai (backend 135 lines + frontend 261) par iska kaam hi **doosre pages ke numbers dohrana** hai — isliye har finding "ek number do jagah alag" ki shreni ka hai.

---

## 🔴 S1 — "Points this month" carry-in deficit ignore karta hai — ek hi banda, **4 surfaces pe 2 alag numbers**
**(4 agents ne pakda; Rewards audit ka parked item — ab VERIFIED + fix direction tay)**

**Kaun kya dikhata hai:**

| Surface | Kya dikhata hai | Derivation |
|---|---|---|
| Header badge | **NET** | `mySummary()` = earned + carriedOver |
| Rewards page | **NET** (+ 3-card split jab deficit ho) | wahi |
| Leaderboard + company report | **NET** | `leaderboard()` ka carry walk |
| **My Summary "Points this month"** | **RAW** ❌ | `PointEntry` pe sirf `{user, month}` ka `$sum` — carry kahin nahi |
| **Exit dialog `pointsThisMonth`** | **RAW** ❌ | `user.service exitSummary` — chautha surface, same family |

**Din-ba-din:** Rahul ne **July me net −20** kiya (overdue drips + lates). **August me ab tak +38** kamaya.
- Header badge: **18**
- Rewards page: *This month 38 / Carried over −20 / **Net 18***
- Leaderboard: **18**
- **My Summary: 38** ❌

Rahul samajh leta hai deficit maaf ho gaya — month-end pe standing 18 nikalta hai.

**Fix (tay):** `standing` me teeno bhejo — `{ earned: 38, carriedOver: −20, net: 18 }`. UI **headline NET** dikhaye (badge se match) aur deficit hone par hint me split — bilkul Rewards page ka pattern. *Sirf net dikhana kaafi nahi* (38→18 ka jump unexplained lagega), *sirf earned* aaj ka jhooth hai. Exit dialog ko bhi wahi treatment.
*Verifier ne ek aur jodi:* usi card ka rupee hint bhi RAW figure pe lagta hai (abhi `rupeesPerPoint=0` hai to dormant, par fix me isko bhi net pe le jaana).
*Note:* period card ka "Points earned" **RAW hi rehna chahiye** — wo period-scoped earnings hai, standing nahi.

**Evidence:** snapshot.service.js:74-77,130; points-badge.jsx:10-20; bonus.service.js:305-347, 92-106, 424-450; rewards/page.jsx:490-502; report.service.js:428-465; user.service.js:293,302

---

## 🔴 S2 — "Points earned" sirf **latest 100 entries** ka sum hai — yearly view me hamesha kam dikhega

`snapshot.service.js:72` → `PointEntry.find({user, earnedYMD range}).sort({earnedYMD:-1}).limit(100)`, aur line 94 usi **truncated list** ka reduce kar deta hai. Sort DESC hai, to window ke **sabse purane rows pehle girte hain**.

Rewards page usi window ke liye **unbounded aggregate** chalata hai — dono surfaces alag number denge jaise hi kisi ke 100+ rows ho jaayein.

**Din-ba-din:** Priya heavy user — roz 3-4 delegated task complete (1 row each), 2 task overdue drip me (−1/din each), kuch lates. 1 Jul se ab tak **~110 rows**. Wo **"This year" (FY)** tab dabati hai:
- Backend latest 100 rows uthata hai → **July ke pehle ~10 rows (+22) gir jaate hain**
- Card: **+41** | Rewards page ka FY view: **+63** ❌

Saal chalte-chalte ye **guarantee** ban jayega (har user ke hazaron rows/saal). December tak har yearly view galat. Extreme monthly view bhi cross kar sakta hai (3 dripping tasks × 31 din = 93 drips + lates + completions).

**Saath me ek aur:** wo poora 100-row payload (`pointRows`, reason text samet ~15KB) frontend ko jaata hai par page **kahin render hi nahi karta** — M0 budget pe pura dead weight.

**Fix:** `monthPoints` jaisa aggregate use karo (`$match` + `$group $sum`), aur `pointRows` payload se hatao. **Ek hi edit dono theek karta hai.**

**Evidence:** snapshot.service.js:71-73, 94, 116-117; my-summary/page.jsx:238-246; contrast bonus.service.js:311-316

---

## 🔴 S3 — "Leave taken" har overlap karti request ke **POORE din** gin leta hai

`buildSelfReport` overlap query se leaves laata hai (`startYMD <= to AND endYMD >= from`) aur har request pe `days: l.workingDays` — **poori request ka total, window se clip nahi**. `snapshot.service.js:93` unhe seedha sum kar deta hai.

**Din-ba-din:** Amit **29 Jul – 4 Aug** ki leave leta hai (Mon–Sat office, Sunday off) → `workingDays = 6` (29,30,31 Jul + 1,3,4 Aug).

| Kaunsa view | Dikhta hai | Asli |
|---|---|---|
| **July** monthly | Leave taken: **6** | 3 |
| **August** monthly | Leave taken: **6** | 3 |
| **Daily view, 30 Jul** (ek din!) | Leave taken: **6** · 1 request | 1 |
| Weekly 29–31 Jul | **6** | 3 |

Ek 6-din ki leave dono mahine milakar **12 din** ban jaati hai.

**Aur payload me seedha contradiction:** usi response me `attendance.onLeave = 3` hai (per-day, half-day 0.5 aware) par `leaveDays = 6`. Screen pe wo 3 "Days present: X of Y" ke denominator me baitha hai — do cards reconcile ho hi nahi sakte.

*Company report / self PDF safe hain* — wo sirf request **list** dikhate hain (per-request days column sahi hai); SUM sirf snapshot karta hai. Half-day requests single-day hote hain to unpe ye nahi lagta.

**Fix:** `report.attendance.totals.onLeave` use karo — already computed, half-day-aware, per-day sahi. **Ek line**, aur attendance card se by-construction agree karega.

**Evidence:** snapshot.service.js:93,110; report.service.js:532, 642; contrast report.service.js:612-614

---

## 🟡 S4 (MEDIUM) — "Right now" ke Leave/WFH balance **period ke** fiscal year se bandhe hain, aaj ke se nahi

`standing.leave` aur `standing.wfh` dono `buildSelfReport` se aate hain jo `leaveYearOf(period.from)` use karta hai. Par page ka header bolta hai *"these don't change with the period above"* aur cards *"resets 1 April"* — yaani **aaj ka** standing hona chahiye.

**Abhi LATENT hai** — aaj (Aug 2026) saare pickable periods FY2026 ke andar hain (custom ka min 1 Jul 2026).

**Kab phatega:** **15 Apr 2027** ko Sunita custom range **1–31 Jul 2026** chunti hai (pichhla mahina dekhne) → `leaveYearOf('2026-07-01')` = FY2026 ka balance uthta hai → *"Leave left this year: 2 of 18"* jabki uska **asli aaj ka (FY2027) balance 18 of 18** hai. Dashboard hamesha `leaveYearOf(today)` use karta hai — dono diverge.

*Verifier correction:* WFH cap **2** hai (12 nahi).

**Fix:** `standing` ke liye leave/WFH ko `leaveYearOf(today)` pe alag fetch karo; report ka period-anchored balance PDF ke liye theek hai, wahan rehne do.

**Evidence:** snapshot.service.js:121-125; report.service.js:534, 544; my-summary/page.jsx:125-126,133-135,141-144; contrast dashboard.service.js:220,237

---

## ⚠️ PARKED — 32 findings (UNVERIFIED — abhi bug NA maano)

### Numbers / consistency
- **Naye joiner ka "Leave left this year" fallback pro-rating ignore karta hai** — Dashboard "9 of 9", My Summary kuch aur *(MEDIUM)*
- **"Tasks finished" teen surfaces pe teen definitions** — snapshot forwarded-away kaam bhi apna ginta hai *(MEDIUM)*
- Sub-month windows me mahine ka overtime ek hi din pe lump hota hai (auto_ot ek monthly row hai) *(MEDIUM)*
- "Overdue" teen shades me — snapshot awaiting-approval ko overdue ginta hai, To-Do board nahi
- Legacy PointEntry rows jinka `earnedYMD` blank hai — period views se gayab, month views me ginte hain
- Manual award with explicit month: `month` vs `earnedYMD` diverge → same screen pe do ulti baatein

### Security / performance
- **Custom period ka span backend pe unbounded** — `?type=custom&to=9999-12-31` ek request me poora lifetime *(MEDIUM)*
- `ledgerFor` har open pe **poora lifetime dues ledger** full-fields + populate ke saath kheenchta hai *(PERF)*
- `pointRows` dead payload — 100 entries har response me, frontend me zero consumers *(PERF)*
- Ek page open ≈ **17 Atlas round-trips**, 4-5 sequential waves me — 2 waves free me parallel ho sakti hain *(PERF)*
- `{user, earnedYMD}` query sirf `{user:1}` index pe chalti hai
- `snapshot.controller` ka `isYMD` shape-only — `2026-02-31` → 500
- ✅ **Positive verification:** strictly self (koi userId param nahi), koi write-on-GET nahi, koi polling nahi, koi PII over-fetch nahi

### UX
- **Period switch fail hone par purane period ke numbers chupchaap dikhte rehte hain** — na error, na spinner *(3 agents ne pakda)*
- Attendance tile ke apne numbers aapas me nahi judte, aur approved leave **amber warning** trigger karti hai
- "Right now" ka *"don't change with the period"* wada S4 se toota
- Backend `currency` bhejta hai, frontend hard-INR format karta hai
- Har fetch me 100 point-rows + poori leave list serialize hoti hai jo render hi nahi hoti
- Mid-month joiner: *"counted up to X"* likha hai par *"counted from your joining"* nahi
- **Quarterly period backend me poora supported hai (fiscal Q1 = Apr–Jun) par picker me hai hi nahi**

## 💡 FEATURE IDEAS (role-wise) — **master list: [00-features.md](00-features.md)**

Ye page ke 6 ideas (poora detail + evidence master file me):

- **E1 · Streak progress card** *(zero query)* — *"aaj 4 of 6 on-time, 2 aur → +8 points"*. `Setting.bonus.streakRuns[uid]` me live counter **pehle se** hai aur snapshot `Setting` already load karta hai. Ye page ka **pehla aage-dekhne wala** number hoga. Label me caveat: counter **kal tak** ka hai (aaj ka scan raat me).
- **E2 · "Kis cheez ne points kaate"** — negative entries ka grouped one-liner: *"Late arrival −2 ×3 · Overdue task −5 · Absent −10"*. Rewards ka `SOURCE_LABEL` reuse. **S2 ke saath coordinate:** `pointRows` hat rahe hain to grouping **server-side `$group by source`** bhejo (behtar bhi — 100-row cap se grouping bhi galat ho sakti thi).
- **E3 · "Leave left" pe pending context** *(zero query)* — *"12 of 24 · 3 din approval me (approve hue to 9)"*. `buildSelfReport` pehle se `pending` laata hai, snapshot use girata hai. Warn-tone bhi `remaining − pending` pe chale.
- **N1 · "Last month" preset** *(zero backend)* — controller `?date=` anchor **pehle se leta hai**; abhi July dekhne ke liye Custom → 4 tap + 2 calendar navigation, aur label *"01 Jul – 31 Jul"* banta hai, saaf *"July 2026"* nahi. Expenses page pe `anchorFor` pattern **already bana hua** hai.
- **N2 · Quarterly pill** *(ek line)* — fiscal Q1 = Apr–Jun ka math backend me poora hai (Reports isi se PDF banata hai), picker me hai hi nahi.
- **P2 · Part-timer schedule context** — *"8 of 12 days"* ka **12 unexplained** hai; full-timer colleague *"19 of 21"* dekhta hai. `req.user` pehle se hai → zero query.
- **J1 · Joiner context** *(zero backend)* — header me *"from your joining on 16 Aug"*; `data.joinedYMD` **payload me hai**, ek conditional.
- ✅ **Leadership:** view intentionally patla hai par **honest** — koi jhoothi figure nahi *(positive note)*

## 🔗 CROSS-CONNECTIONS
- **Same number, alag surfaces pe alag** — is page ka poora kaam yahi hai, aur teeno RED isi shreni ke hain. **Rewards audit ka parked #3 yahan confirm hua.**
- **`.limit(N)` se figure banana** (S2) — ye pattern doosri jagah bhi dhoondho (To-Do T1 ka limit=10000, prune ka 20000)
- **Window se clip na karna** (S3) — Leaves/Reports me bhi check karo jahan overlap query hoti hai
- **Period-anchored vs today-anchored** (S4) — Reports aur Dashboard me bhi ye distinction check karni hai
- **Dead payload** (pointRows, ledgerFor) — `/bonus/me` ka full ledger bhi wahi class (Rewards audit)
- **`isYMD` shape-only → 500** — 6th page pe confirm; app-wide param-validation middleware ka case aur pakka
