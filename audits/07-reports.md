# Audit 07 — Reports (2026-08-10)

> Process: 5 specialist agents (figures, self-report+PDF fidelity, security, performance, UX/roles) → **64 raw findings**. 8 RED/MEDIUM adversarially verify hue → **8 confirmed, 0 REFUTED**. Baaki **56 PARKED (unverified)**.
>
> Confirmed 8 me se **do ek hi bug hain** (#2 aur #4 — attendance rate ka din-cutoff) → asli me **7 distinct RED**.
>
> **STATUS: kuch bhi fix NAHI hua.** Har bug owner ko samjha ke, approval ke baad hi ([[explain-bugs-before-fixing]]).

Ye module sabse **nazuk** hai: har page ka data ek jagah aata hai, aur iske **PDF bahar jaate hain** (records, accountant). Isliye teen sabse bade findings **attendance ke figures** ke hain — wahi cheez jo payroll decide karti hai.

---

## 🔴 R1 — "Absent" ginaa nahi jaata, **ghataaya** jaata hai — off-day pe aana ek asli absence **mita deta hai**

`absent = workingDays − present − onLeave − wfh` (residual). Par **denominator** sirf working days ginta hai (Sunday/holiday chhod ke), jabki **numerator** har attendance row ginta hai — **Sunday ki bhi, holiday ki bhi**. Har off-day attendance row **ek asli absence ko 1:1 kha jaati hai**.

**Din-ba-din (July 2026 — 27 working days, 4 Sundays):**
> **Rahul:** 25 weekday present · **8 aur 22 July ko gayab** (2 asli absence) · **12 aur 26 July (Sunday) ko deadline ke liye office aaya**
> Records: 27 PRESENT rows (25 weekday + 2 Sunday)

| | |
|---|---|
| Report ka hisaab | 27 − 27 = **Absent 0** ❌ |
| Attendance page ka hisaab | **Absent 2** ✅ |

**Payroll kis pe chalega?**

**Aur bura — 100% se upar:** poori team Sunday ko deadline pe aaye → har ek +1 → rate **104%** PDF me chhap jaata hai.

**Verifier ne ek teesra surface bhi pakda:** `buildSelfReport` ka apna alag hisaab hai — wahan absent **sahi** aata hai (2), par working-days alag. Yaani **teen views, teen jawab**.

**Fix:** absent ko bhi **per-day gino** (jaise attendance matrix karta hai), ya numerator ko `startedOn` + working-day test se guzaro — numerator aur denominator ek hi din-set pe khade hon.

**Evidence:** report.service.js:204, :221-241 (loop me na lower bound na working-day test), :247 (residual), :287-290; attendance.service.js:418-451 (matrix ka sahi per-day count)

---

## 🔴 R2 — Attendance rate: **numerator aaj tak ginta hai, denominator kal tak** — default report **0%** dikhata hai
*(2 agents ne alag-alag angle se pakda)*

Recorded facts jaan-boojhkar **aaj tak** ginte hain (taaki aaj ke check-in dikhein), par working-days **kal** pe rukte hain (office band hone tak). Rate = ek ko doosre se bhaag.

**Scenario A — DEFAULT view, har roz hota hai:**
> Reports page **"Daily · aaj"** pe khulta hai. CEO 11:00 baje kholta hai (office 18:00 tak).
> - Working days = **0** (aaj abhi khatam nahi hua)
> - Present = **25** (sab check-in kar chuke)
> - **Card: "Attendance rate 0%" · "Working days 0" · "Present 25"** ❌
>
> Aur koi explanation nahi — banner bhi nahi aata (same-day report pe `ongoing` false hota hai).
> Shaam 18:00 ke baad wahi report **100%** ho jaati hai.

**Scenario B — monthly, 114%:**
> 10 Aug 11:00 baje. Working days (1–9 Aug) = 7. Sab log 7 din present + aaj bhi check-in.
> Present = 8, denominator = 7 → **114%** — PDF me bhi chhapta hai.

**Verifier:** *"Severity understated"* — jitna shuruaat me kholo utna zyada. **Weekly report usi subah = 200%**.

Aur usi bande ka **My Report 100%** dikhata hai. Ek module, ek period, ek aadmi — **114% vs 100%**.

**Fix:** numerator aur denominator dono ek hi cutoff pe (ya rate ko elapsed days pe re-base karo).

**Evidence:** report.service.js:150-154, :201-204, :217, :227-241, :287-290, :478

---

## 🔴 R3 — Self report **aane wali (future) leave** ko "li hui" gin leta hai

Leave approve hote hi **future dates ki ON_LEAVE rows** ban jaati hain. Self report ka day-loop sirf WFH ko "abhi hua nahi" maanta hai — **ON_LEAVE ko elapsed din gin leta hai**.

**Din-ba-din:**
> Aaj **10 Aug**. **Asha** ne 3–10 Aug har din check-in kiya = **6 present**. 6 Aug ko uski **17–21 Aug** ki leave approve hui (5 future rows).
>
> Uska apna report (screen + PDF):
> - onLeave = **5** *(jo abhi aayi hi nahi)*
> - workingDays = 6 + 0 + 5 = **11**
> - **Attendance rate = 6/11 = 55%** ❌
>
> PDF me chhapta hai: *"Working days 11"* — **August ke pehle 10 din me 11 working days**, jo ganit se hi namumkin hai.
>
> **Sach: 6 of 6 = 100%.** Company report usi subah uske liye kehta hai: Present 6, Leave 0.

**Verifier ne scope badhaya:**
- Ye sirf employee ka view nahi — **leadership jab kisi ka per-person PDF nikalti hai** (Users page se) to wahi galat figures aate hain
- **Future half-day leave `absent` bhi kharab karta hai** — report kehta hai banda aadha din **absent** tha ek aise din jo **aaya hi nahi**

**Fix:** company report ki tarah **aaj pe clamp** karo.

**Evidence:** report.service.js:530 (uncapped fetch), :570-573 (sirf WFH guard), :602-618, :637; contrast :165, :217

---

## 🔴 R4 — Custom range pe **koi seema nahi** — ek request Lambda gira sakti hai *(PARTIAL)*

`users.controller` me ye khatra **pehle se pehchana aur band** hai (400-din cap, comment ke saath). Par **wahi function reports se bina cap ke** chalta hai.

Agent ne loop ka cost **naapa**: 50,000 din = **4.6s CPU + 9MB JSON**.
- `from=0001-01-01` → 739,858 din → **~68s** → API Gateway 30s pe **timeout**
- `from=1900-01-01` → 46,200 din → **8.3MB** → 6MB payload limit → **502**

**⚠️ Verifier ne "galti se ho jayega" wala hissa REFUTE kiya:** UI ka date-picker **APP_LIVE (1 Jul 2026) pe clamped** hai — koi typeable year field nahi, footer bhi *"Records start 01 Jul 2026"* likhta hai. **UI se ye nahi ho sakta.**

To ye **sirf API-level hole** hai — jaan-boojhkar URL banana padega. Har signed-in banda kar sakta hai (`downloadReports` har built-in role ko milta hai).

**Fix:** wahi 400-din cap jo users.controller me pehle se hai.

---

## 🔴 R5 — Tasks card ka **"% of dated work"** jhooth bolta hai *(PARTIAL — sirf screen)*

Hint kehta hai *"80% of dated work"*, par formula asal me `onTime / done` hai — kyunki **bina due-date wale task on-time gine jaate hain**.

**Din-ba-din:**
> July: 10 task done. **6 bina due-date ke**, 4 dated (jinme 2 late).
> Card: *"On time 8 · **80% of dated work**"*
> **Sach: dated work sirf 4 tha, uska aadha (50%) late gaya.**
>
> CEO 80% padh ke khush, jabki deadline wale kaam ka **aadha late**.

Usi card ka footnote khud is hint ko kaat-ta hai (*"A task with no deadline can't be late"*) — **ek hi section me do ulti baatein**.

**Verifier:** sirf **web preview** me hai — **PDF sahi hai** (wahan percentage hai hi nahi).

**Fix:** hint ko *"% of tasks done on time"* karo, ya dated/undated split bhejo.

---

## 🔴 R6 — "My report" me Dues = **poore ledger ka balance**, par label period ka *(PARTIAL — sirf self report)*

`pending`/`advance` **lifetime** figures hain, sirf `entries` period me filter hoti hain. Par card ka hint **period ka label** dikhata hai.

**Din-ba-land:**
> May me ₹3,000 ka due (unpaid), July me ₹1,500 ka.
> July ka report kholo:
> - Card: **"₹4,500 due"** · hint **"July 2026"**
> - PDF: *Pending Rs 4,500* · *Entries (period) 1* · table me **sirf ek row ₹1,500**
>
> **Document apne aap se reconcile nahi hota.** Jise ye PDF bheja jayega wo samjhega July me hi ₹4,500 bana.

**Fix (zero-backend):** hint *"as on 10 Aug 2026"* karo (`asOfYMD` payload me hai), aur PDF stat pe *"Pending (as on today)"*.

---

## 🔴 R7 — `joinedLater` warning **sirf screen pe**, PDF chupchaap log chhod deta hai *(PARTIAL)*

Screen saaf likhta hai *"3 log is report me nahi — wo baad me joined"*. **PDF me ye line hai hi nahi.**

> 15 staff, 3 log 5 Aug ko joined. July ka PDF:
> **Roster: 15 naam** · **Attendance table: 12 rows** · **beech ka 3 ka farak kahin explain nahi**

Padhne wala samjhega data missing hai. **Attendance CSV export tak ye footer chhapta hai** — report PDF akela chhoot gaya.

**⚠️ Verifier ne fix ka wording sudhara:** wo 3 log report se **gayab nahi** hain — Roster, Tasks (0/0/0) aur Rewards (0 points) me **aate hain**, sirf **Attendance table** se bahar hain. To line honi chahiye *"3 log attendance table me nahi (baad me joined)"*, **na ki** *"report me nahi"*.

---

## ⚠️ PARKED — 56 findings (UNVERIFIED)

### Figures
- **Deactivated employee company report se poori tarah gayab** — Tasks/Rewards ke **headline totals undercount** *(MEDIUM)*
- **Task "Late" LIVE graceDays se judge hota hai**, effective-dated grace se nahi — usi PDF me chhape rate-table se contradict *(MEDIUM)*
- "Tagged" tasks ka window **UTC-midnight** pe hai, company-day pe nahi — usi table ke "Done" column se 5h30m khisak jaata hai *(MEDIUM)*
- **"Pending requests: N" period ka figure hai hi nahi** — all-time count, bina date bound *(MEDIUM)*
- **Leaves table ke "Days" window se clip nahi hote** — 7-din ke report me ek leave "15 days" *(MEDIUM — My Summary S3 ka bhai)*
- Aaj join hone wala employee "joinedLater" me phenk diya jaata hai *(MEDIUM)*
- Leave balances aur "Working days" period ke nahi, **aaj** ke figures — ek card me dono anchor mile hue
- Company attendance me **"On-duty" (excused late) ka koi figure nahi**, jabki data hai

### Self report + PDF
- **Self PDF ka Tasks section KABHI print ho hi nahi sakta** — controller allowlist me `tasks` hai hi nahi, par uske liye 2 queries fir bhi chalti hain *(2 agents)*
- Self PDF ka Dues ledger **300-row slice** se banta hai par uske totals poore ledger se *(MEDIUM)*
- **PDF mid-stream fail ho to response adhoora** — Lambda 30s tak latakta hai *(MEDIUM)*
- **Multi-page PDF tables page 2 se header kho deti hain** — 365-row report = 7 page bina column names
- Self PDF pre-go-live dinon pe *"Not employed yet"* likhta hai un logon ke liye jo employed the
- Self report ka section gating **frontend-only** hai

### Security
- **Legal input date se ILLEGAL derived period** → Mongoose CastError → uncaught **500** *(MEDIUM)*
- **Rewards section company report se nikal jaata hai** par Rewards module use `manageSettings` ke peeche rakhta hai — gating mismatch *(MEDIUM)*
- Poori **pending-leave list (naam + type + dates)** preview me chali jaati hai *(MEDIUM)*
- **Company PREVIEW ka koi audit log nahi** (PDF download ka hai) — wahi data JSON me nikal jaata hai
- Company PDF me leave **TYPE (SICK)** har naam ke saath chhapta hai *(baaki PII containment saaf hai)*

### Performance — **P1–P10**
- **P1** — har report (daily bhi) **poori DONE-task history** load karta hai, koi date bound nahi
- **P2** — attendance rows bina projection/lean → FY report me **~3MB check-in metadata** jo use hi nahi hota
- **P3** — har report **5 expense aggregation** chalata hai, **3 phenk deta hai** (ek trailing-12-month scan)
- **P4** — **Preview poora report banata hai, phir Download dubara poora banata hai**
- **P5** — 4 index missing (2 poore COLLSCAN)
- **P6** — custom range unbounded *(= R4)*
- **P7** — Dues ka 300-cap **period filter se pehle** lagta hai → ~14 mahine baad purane period ka report "No dues" dikhayega *(MEDIUM)*
- **P8** — preview me company **logos** jaate hain jo render hi nahi hote
- **P9** — poori all-time pending-leave list load hoti hai sirf ek **count** chhapne ke liye
- **P10** — 7 serial round-trip phase jo 4 me sikud sakte hain

### UX
- **Company report ka error state khaali** — na message, na retry *(bagal wale card me QueryError already use ho raha hai)*
- **Custom range aadha bhara ho to report chupchaap "aaj" ka ban jaata hai** — Download button bhi enabled *(2 agents)*
- **PDF me custom/renamed role ka RAW KEY chhapta hai**, jabki payload me sahi label hai
- Screen pe expense list capped hai par **kahin likha nahi** — total aur rows add nahi hote *(PDF ye bata deta hai)*
- **Download filename client se aata hai** — custom/yearly ke liye galat, aur har failure ek hi generic message
- Leave list me **deactivate ho chuke log** bhi aate hain
- Self report card me **loading state hai hi nahi**; download preview se pehle bhi chalu
- Kahin nahi likha ki **leadership attendance/leave tables se bahar** hai — headcount se rows match nahi karte
- **Preview aur PDF ek document nahi lagte** — labels, columns, empty states alag

## 💡 FEATURE IDEAS → **[00-features.md](00-features.md)** me add ho gaye
Quarterly report (backend poora bana hua) · kisi aur ka personal report (`?userId=`) appraisal/handover ke liye · WFH block self report me (data compute hota hai, dikhta nahi) · per-person "days counted"/joining column · Reports page pe baaki **4 PDF documents ka index** (endpoints already live) · **Admin Manager/Manager ke liye scoped company report** (abhi dono ko poora 403) · **pichhle period se comparison** (`previousPeriod()` already likha hai aur Expenses me use ho raha hai)

## 🔗 CROSS-CONNECTIONS
- **Ek figure, alag surfaces pe alag** — R1/R2/R3 teeno isi ke hain, aur ab **teen views** (company / self / Attendance page) tak fail gaya
- **Overlap rows clip na karna** (My Summary S3) — **yahan bhi mila** (Leaves table ke "Days")
- **Period-anchored vs today-anchored** ek hi card me — My Summary S4 ka bhai
- **`.limit(N)` se figure banana** — yahan Dues ka 300-cap (P7)
- **Preview/PDF fidelity** — naya pattern: screen aur PDF ka **alag gating aur alag labels**; har download-able document pe check karna hai
- **`custom` span cap** — `users.controller` me fix hai, reports me nahi → **jo guard ek jagah lage wo har caller pe lagana hai**
