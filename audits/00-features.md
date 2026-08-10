# 💡 Feature & Improvement Backlog — saare audits ka master list

> **Ye file kis liye hai:** har page ke audit me jo bhi **naya feature / improvement idea** nikla, wo yahan **role-wise** jama hota hai. Jab saare page audit ho jaayein, aap **ek hi jagah** se decide kar sakte ho ki kaun-kaun sa banana hai — har audit file alag-alag kholni na pade.
>
> **Har idea ke saath likha hai:** kis audit se aaya, aur **kitna kaam hai** —
> 🟢 **ZERO-BACKEND** = data pehle se frontend ke paas hai, sirf dikhana hai
> 🟡 **CHHOTA** = ek chhota backend field / ek query
> 🔴 **BADA** = naya endpoint / naya model / bada UI
>
> **Status:** kuch nahi bana hai. Ye sirf backlog hai — consolidated phase me aapke chunne par banega.
> Sources: [01-dashboard](01-dashboard.md) · [02-todo](02-todo.md) · [03-attendance](03-attendance.md) · [04-leaves](04-leaves.md) · [05-rewards](05-rewards.md) · [06-my-summary](06-my-summary.md) · [07-reports](07-reports.md) · [08-team-users-roles](08-team-users-roles.md)

---

## 👑 CEO & President (owner tier)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| C1 | **Team leave calendar** — month-grid "kaun kab off hai", chips me naam, WFH alag rang. Coverage-clash approve karne se PEHLE dikhega. `listLeaves` from/to/status pehle se support karta hai | 🟢 ZERO | 04 |
| C2 | **Batch approve** tasks — 57 approval-gated tasks, har ek alag click; late approval = employee late | 🟡 CHHOTA | 02 |
| C3 | **Approval-queue badge** landing pe (teeno queue: leaves / corrections / task reviews — abhi sirf leave) | 🟡 CHHOTA | 01, 02 |
| C4 | **Bulk mark-absent/present** attendance me (abhi ek-ek karke) | 🟡 CHHOTA | 03 |
| C5 | **"Never checked out" anomaly tile + filter** — bhoole hue checkouts ek nazar me | 🟢 ZERO | 03 |
| C6 | **Rewards: cost preview** — rule badalne se kitna kharcha aayega, save karne se pehle | 🔴 BADA | 05 |
| C7 | **Rewards: config diff** — kya-kya badla (ab audit log me before/after aata hai, UI baaki) | 🟡 CHHOTA | 05 |
| C8 | **Rewards: recalculate button** — abhi koi manual re-run ka rasta nahi (sirf API) | 🟡 CHHOTA | 05 |
| C9 | **Approvals inbox me requester balance + coverage warning** (abhi sirf Leaves queue me hai) | 🟡 CHHOTA | 04 |
| C10 | Right-now roster **naam ke saath** (data ready — overview rows abhi phenki jaati hain) | 🟢 ZERO | 01 |
| C11 | Overdue-by-person **folder chips** + per-person on-time % insights | 🟢 ZERO | 02 |
| C12 | Dashboard: expense **delta vs last month**; quick actions me Assign task / Dues / Visitors / Give points | 🟡 CHHOTA | 01 |
| C13 | EOD digest dismiss karne ke baad **wapas dekhne ka rasta** (abhi nahi hai) | 🟡 CHHOTA | 01 |
| C14 | Settings-change ka **impact preview** (attendance A10 fix ke saath) | 🔴 BADA | 03 |

## 🧑‍💼 Delegating seniors / Managers

| # | Feature | Kaam | Audit |
|---|---|---|---|
| M1 | **One-click Nudge/Remind** button task pe (notify infra ready) | 🟡 CHHOTA | 02 |
| M2 | **"Assigned by me: N pending, M overdue"** view | 🟢 ZERO | 01, 02 |
| M3 | Leaves page ke **"Requests" tab pe pending-count badge** (`/approvals/count` already hai) | 🟢 ZERO | 04 |
| M4 | Coverage list me naam ke saath **department** — "teeno off log EK team ke hain" hi asli decision-breaker hai (`populate('name department')`) | 🟡 CHHOTA | 04 |
| M5 | **Leaderboard ka view** managers/employees ko milta hi nahi (abhi leadership-only) | 🟡 CHHOTA | 05 |

## 👤 Employees (sab)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| **E1** | **Punctual-streak progress card** — *"aaj 4 of 6 on-time, 2 aur → +8 points"*. `Setting.bonus.streakRuns[uid]` me **live counter pehle se hai**, aur snapshot Setting already load karta hai → **zero extra query**. Ye page ka pehla **aage dekhne wala** number hoga (baaki sab peeche dekhte hain). Caveat label me: counter **kal tak** ka hai (aaj ka scan raat me hota hai) | 🟢 ZERO | 03, 05, 06 |
| **E2** | **"Kis cheez ne points kaate"** — negative entries ka grouped one-liner: *"Late arrival −2 ×3 · Overdue task −5 · Absent −10"*. Rewards ka `SOURCE_LABEL` map as-is reuse. **Note:** S2 fix ke saath coordinate — agar `pointRows` payload se hat rahe hain to grouping **server-side** `$group by source` bhejo (wo behtar bhi hai, kyunki 100-row cap se grouping bhi galat ho sakti thi) | 🟡 CHHOTA | 05, 06 |
| **E3** | **"Leave left" pe pending context** — *"12 of 24 · 3 din approval me (approve hue to 9)"*. `buildSelfReport` **pehle se** pending laata hai, snapshot use girata hai → zero query. Warn-tone bhi `remaining − pending` pe chalna chahiye | 🟢 ZERO | 04, 06 |
| **E4** | **"My tasks due/overdue" card** dashboard pe — *audit 01 ne ise **sabse bada gap** bola tha* | 🟡 CHHOTA | 01 |
| E5 | **Points preview task pe** — *"+10 if done by Fri"* / *"−8 ab tak kat chuke"* (detail dialog me ek query) | 🟡 CHHOTA | 02 |
| E6 | **"Due today" filter preset** + urgency signal (abhi na badge na color) | 🟢 ZERO | 02 |
| E7 | **Forgot-checkout → correction shortcut** (abhi form khud dhoondhna padta hai) | 🟢 ZERO | 03 |
| E8 | **Apni shift / grace / overtime-buffer** attendance card pe (6 custom-shift users abhi andhere me) | 🟡 CHHOTA | 03 |
| E9 | **Apne ledger ka fiscal-year picker** — backend `?year=` **pehle se leta hai**; April me pichhle saal ka record (tax/HR) abhi nikal hi nahi sakte | 🟢 ZERO | 04 |
| E10 | Apply karte waqt **"us din aur kaun off hai"** anonymized hint — approver ka reject-cycle bachega | 🟡 CHHOTA | 04 |
| E11 | **WFH remaining** dashboard pe render — *data payload me already hai!* | 🟢 ZERO | 01 |
| E12 | **Points earned / carried / net** card dashboard pe | 🟢 ZERO | 01 |
| E13 | Birthday wale din card pe *"Happy birthday — aaj late nahi ginenge 🎂"* + birthday top-banner | 🟢 ZERO | 01, 03 |
| E14 | Submit ke baad **"kab se pada hai / kiske paas"** | 🟢 ZERO | 02 |

## ⏱️ Part-timers / custom-shift

| # | Feature | Kaam | Audit |
|---|---|---|---|
| P1 | **Shift context card** — mere workDays, mera workStart–workEnd, mera buffer. Abhi office-wide values se confuse hote hain | 🟡 CHHOTA | 01, 03 |
| P2 | My Summary pe **"aapke working days: Mon, Wed, Fri"** — *"8 of 12 days"* ka **12 unexplained** hai; full-timer colleague *"19 of 21"* dekhta hai to lagta hai system ne din kha liye. `req.user` pehle se hai → zero query | 🟡 CHHOTA | 06 |

## 🆕 Mid-month joiners

| # | Feature | Kaam | Audit |
|---|---|---|---|
| J1 | Period header me **"from your joining on 16 Aug"** — abhi *"Days present 10 of 10"* bina context ke ajeeb lagta hai (mahina 21 din ka tha). `data.joinedYMD` **payload me hai** — ek conditional | 🟢 ZERO | 06 |

## 🛡️ Role-specific (Admin Manager, Security/PSO, watchers)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| R1 | **Admin Manager:** dues-outstanding card, visitors-today, regularization queue | 🟡 CHHOTA | 01, 03 |
| R2 | **Security/PSO:** light `logVisitors` permission + "Log visitor" button + shift card | 🔴 BADA | 01, 03 |
| R3 | **Tagged watchers:** reject/overdue pe bhi notify (abhi sirf tag + complete pe) | 🟡 CHHOTA | 02 |

## 📅 Period / navigation (sab pages)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| N1 | **"Last month" / "Last quarter" preset** — backend `?date=` anchor + `quarterly` **pehle se support karta hai**, UI expose hi nahi karta. Abhi July dekhne ke liye Custom → 4 tap + 2 calendar navigation, aur label bhi *"01 Jul – 31 Jul"* banta hai, saaf *"July 2026"* nahi. **Expenses page pe ye pattern already bana hua hai** (`anchorFor`, overflow-bug-fix samet) | 🟢 ZERO | 06 |
| N2 | **Quarterly pill** My Summary pe — fiscal Q1 = Apr–Jun ka math backend me **poora** hai (Reports isi se PDF banata hai), picker me hai hi nahi. **Ek line** | 🟢 ZERO | 06 |

---

## 📄 Reports (audit 07)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| **RP1** | **Quarterly report** — fiscal-quarter math (Q1 = Apr–Jun) backend me **poora bana hua** hai, bas do arrays me se missing hai. Company reports quarterly bolte hain to picker bhi bole | 🟢 ZERO | 07 |
| **RP2** | **Reports page pe baaki 4 PDF ka index** — leave-ledger, holiday-list, expense-list, attendance-matrix ke endpoints **already live** hain, par unhe dhoondhne ka koi ek jagah nahi | 🟢 ZERO | 07 |
| **RP3** | **Pichhle period se comparison** — `previousPeriod()` **already likha hua** hai aur Expenses page use karta hai; report me "vs last month" kahin nahi | 🟡 CHHOTA | 07 |
| **RP4** | **Kisi aur ka personal report** (`?userId=`) — appraisal aur handover ke liye; per-user PDF ka endpoint already hai (Users page se) par Reports page se nahi | 🟡 CHHOTA | 07 |
| **RP5** | **WFH block self report me** — data poora compute hota hai aur kahin dikhta nahi | 🟢 ZERO | 07 |
| **RP6** | **Per-person "days counted" / joining column** — payload me `startedOn` already hai; joiner ka "10 of 10" bina context ke ajeeb lagta hai | 🟢 ZERO | 07 |
| **RP7** | **Admin Manager / Manager ke liye scoped company report** — abhi dono ko poora 403 milta hai, jabki section-gating ka poora infra maujood hai | 🔴 BADA | 07 |

---

---

## 🔐 Roles & access (audit 08)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| A1 | **Role rank UI** — role banate/edit karte waqt seniority set karna. Abhi har custom role rank 100 par banta hai aur badla hi nahi ja sakta, isliye poori “junior senior ko promote nahi kar sakta” guard bekaar hai (T2) | 🔴 BADA | 08 |
| A2 | **Role permission diff + confirm** — Save se pehle “ye 6 permission jud rahi hain, 2 hat rahi hain, N logon par asar”. Abhi ek click me poora role badal jaata hai bina kuch dikhe | 🟡 CHHOTA | 08 |
| A3 | **“Kaun kya kar sakta hai” matrix** — ek grid: roles × permissions, taki owner ek nazar me dekh le kiske paas kya hai | 🟢 ZERO | 08 |
| A4 | **Role change history** — kis role me kab kya permission judi/hati aur kisne ki (audit log me data hai, UI nahi) | 🟡 CHHOTA | 08 |
| A5 | **Sensitive-action alert** — owner ko notification jab koi role ko `manageRoles`/`manageSettings` mile, ya owner role edit ho | 🟡 CHHOTA | 08 |

## 👥 Users & directory (audit 08)

| # | Feature | Kaam | Audit |
|---|---|---|---|
| U1 | **Directory pagination / server-side search** — abhi 200 sabse naye accounts par chupchaap cap hai, purane log har jagah se gayab (T11) | 🔴 BADA | 08 |
| U2 | **Deactivated users ka alag filter/tab** — abhi wo active list ka budget khaate hain aur Team/Roles ke headcount alag-alag dikhte hain | 🟢 ZERO | 08 |
| U3 | **Offboarding checklist** — deactivate karte waqt ek screen: sessions, push, pending tasks kis-ko, pending leave, dues, delegated tasks. Abhi ye bikhre hue hain (T15 wahin se nikla) | 🔴 BADA | 08 |
| U4 | **Delete karne se pehle impact preview** — “is account ko hataane par N tasks ka assigner hat jaayega aur M logon ke X points par asar padega” (T3 chupchaap yahi karta hai) | 🟡 CHHOTA | 08 |
| U5 | **Bulk import / CSV se users** — abhi ek-ek karke banana padta hai | 🔴 BADA | 08 |
| U6 | **Temp password: copy confirm + resend** — abhi ek Esc par ekmatra copy chali jaati hai | 🟢 ZERO | 08 |
| U7 | **Profile change history** per user (kab kya badla, kisne) — joining-date jaisi cheez chupchaap khisak jaaye to pakda jaaye | 🟡 CHHOTA | 08 |

## 🎯 Meri sifarish — agar "sabse zyada fayda, sabse kam kaam" chahiye

Ye **7** sabse upar rakhne layak hain (saare 🟢/🟡, aur roz kaam aate hain):

1. **E1 — streak progress** *(zero query, page ka pehla forward-looking number)*
2. **E4 — "my tasks due/overdue" card** *(audit 01 ka sabse bada gap)*
3. **N1 + N2 — "Last month" + quarterly pill** *(do line, backend pehle se ready)*
4. **E3 — leave pending context** *(zero query, Diwali-planning wala asli sawaal)*
5. **C1 — team leave calendar** *(zero backend, CEO ka Monday-morning sawaal)*
6. **E2 — "kis cheez ne points kaate"** *(S2 fix ke saath free me aa jayega)*
7. **M3 — Requests tab pe badge** *(count endpoint already hai)*
