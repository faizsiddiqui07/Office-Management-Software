# 14 — Punctual streak ko LIVE karna: jaanch + plan

**Taarikh:** 16 Oct 2026
**Sawaal (owner):** My Summary me punctual streak ki line kal tak ka data kyun dikhati hai? Agar koi wajah nahi hai to aaj ka hona chahiye — subah time par aaya to streak wahin badh jaye, late hua to usi waqt zero, aur time correction hote hi poori streak apne aap theek ho jaye. Half-day me bhi (chahe first half ho ya second).

**Status:** sirf JAANCH aur PLAN. Abhi koi code nahi badla. Neeche "Faisle chahiye" wale sawaalon ke jawab ke baad hi haath lagega.

---

## 1. Chhota jawab

Wajah **hai**, aur wo code me likhi hui hai — ye bug nahi, ek soch-samajh kar liya gaya faisla hai jo 2026-08-08 wale rolling-streak commit se chala aa raha hai.

```js
// backend/src/services/bonus.service.js:1486-1487
/**
 * Judge every finished day since the last scan (up to YESTERDAY — today is still in
 * progress) ...
 */
const yesterday = prevDay(ymdInTz(new Date()));        // :1503
for (let d = start; d <= yesterday; d = addDays(d, 1)) // :1527
```

Aur check-in wale raaste par bhi likha hai ki streak yahan **jaan-bujh kar** tay nahi hoti:

```js
// backend/src/services/bonus.service.js:866-871
// The punctual-streak reward is NOT decided here ... Deciding it per check-in couldn't
// work: a day can still turn into an absence-with-leave, and a run whose 6th day is
// followed by leave/holiday has no check-in to trigger on.
```

Do asli wajah:

1. **Aaj ka din abhi palat sakta hai.** 10:16 par LATE laga, par 14:00 par aadhe din ki chhutti approve ho gayi → wahi din PRESENT ban jata hai (`leave.service.js:688-690`). Emergency holiday aaj ke liye declare ho sakti hai (`leave.service.js:1203-1205` sirf 14 din *peechhe* rokta hai), office-wide WFH aaj ke liye lag sakti hai, excuse-late kabhi bhi lag sakti hai.
2. **Kuch din ka koi check-in hota hi nahi.** Chhatha on-time din agar chhutti/holiday se ghira ho, to award ko trigger karne ke liye koi event hi nahi hota. Isi wajah se purana "check-in par streak tay karo" wala design pehle hi hataya ja chuka hai (commit `aa1c0ce`: *"onCheckIn no longer decides the streak (it couldn't...)"*).

Aur My Summary ka card khud kuch calculate karta hi nahi — wo seedha scan ka jama kiya hua number padhta hai:

```js
// backend/src/services/snapshot.service.js:150-160
const runs = b.streakRuns || {};
const raw = Number(runs[String(user._id)]) || 0;
const count = Math.max(0, Math.min(STREAK_LEN - 1, raw));
... asOfYMD: b.lastStreakScan || null,   // "counted up to <din>" wali line yahi hai
```

**Ek baat jo aur buri hai:** card ek nahi, **do din** purana ho sakta hai. 15 Oct ki tick `lastStreakScan = 14 Oct` likhti hai; 16 Oct ko aadhi raat se us din ki pehli EventBridge tick tak card "counted up to 14 Oct" hi dikhata rahega.

---

## 2. Agar seedha "aaj" shaamil kar dein to kya hoga (ye MAT karna)

Agar koi `:1503` ko `const yesterday = ymdInTz(new Date())` kar de:

| waqt | kya hoga |
|---|---|
| 00:0x IST | din ki pehli tick chalti hai; `lastPenaltyRun` abhi kal ka hai, to throttle nahi rokta |
| | attendance query `aaj..aaj` chalti hai — **abhi kisi ne check-in kiya hi nahi**, khaali |
| | `if (!rec \|\| rec.status === 'ABSENT') { count = 0 }` → **poore office ka counter 0** |
| | `lastStreakScan = aaj` likh diya jata hai |
| 10:10 | banda time par aata hai — `onCheckIn` streak ko chhuta hi nahi |
| agli tick | `start = kal > aaj` → return. **Wo din dobara kabhi judge nahi hoga** |

Natija: kisi ka count kabhi 1 se aage jayega hi nahi → 6 kabhi poora nahi hoga → **`auto_streak` ka ek bhi point phir kabhi nahi banega.** Ek line ke badlaav se poora reward chup-chaap band.

Isi tarah agar award bhi live likh diya jaye: `awardOnce` **insert-only** hai (`bonus.service.js:459-474`), to 10:14 par likha hua award 16:00 par din ke palat jaane par khud hat hi nahi sakta. Hataane ka ek hi tareeka hai poora `PointEntry.deleteMany({ source: 'auto_streak' })` + re-walk — aur code do jagah chetavni deta hai ki is order ke bigadne se **ek baar log do baar pay ho chuke hain** (`:1497-1501`, `:2010-2013`).

---

## 3. Plan — "do hisse" wala design

Asli baat: aaj ek hi cheez dono kaam karti hai — **dikhane wala number** aur **paisa (points)**. Dono ka maalik `runRollingStreak` hai. Plan inhe alag karta hai.

### Hissa A — paisa (ledger) waisa ka waisa

`runRollingStreak`, watermark, award, rebuild, verify — **kuch nahi badlega**. Kal tak ka din hi award karega, raat ko. Isse ye sab surakshit rehte hain: double-pay se bachav, owner ka "Recalculate points" preview/verify, mahine ki settlement, rebuild lock.

### Hissa B — dikhne wala number LIVE

`mySnapshot` ab stored number ke **upar aaj ka faisla chadha kar** dikhayega:

```
base   = streakRuns[uid]                       // scan ne kal tak jo gina
from   = lastStreakScan + 1  ...  to = aaj     // aam taur par sirf 1 din (aaj)
har din d ke liye: verdict = judgeStreakDay(user, d, ctx)
   NEUTRAL  → kuch nahi
   ON_TIME  → +1
   BREAK    → 0
   PENDING  → kuch nahi  (sirf aaj ke liye: abhi check-in hua hi nahi)
```

`judgeStreakDay` ek **nayi saajhi file** `backend/src/lib/streakDay.js` me jayega — bilkul wahi branch-chain jo abhi `bonus.service.js:1531-1546` me hai, bas ek jagah. Ye project ka apna tareeka hai (`lib/offDay.js`, `lib/lateLadder.js`, `lib/taskApprovers.js` isi tarah bane hain). Phir teeno jagah wahi function use karenge:

| kaun | abhi | plan ke baad |
|---|---|---|
| `runRollingStreak` (:1531-1546) | apni copy | `judgeStreakDay` |
| `expectedLedger` (:1844-1852) | **doosri copy** | `judgeStreakDay` |
| naya live overlay | — | `judgeStreakDay` |

Isse wo khatra khud khatam ho jata hai jo audit ne pakda tha: teen copies alag-alag jawab de sakti thin, aur owner ke preview me roz ka "phantom diff" aa jata.

### Aaj ke din ka faisla (owner ke niyam se)

| aaj ki haalat | live natija | wajah |
|---|---|---|
| Sunday / holiday / janamdin / off-day | NEUTRAL | scan ka bhi yahi niyam (`:1532`) |
| WFH ya poore din ki chhutti | NEUTRAL | wahi (`:1535`) |
| Row hai, status PRESENT | **+1 turant** | owner ka #1 |
| Row hai, LATE + excused (on-duty) | +1 | abhi bhi aisa hi hai |
| Row hai, LATE (bina excuse) | **0 turant** | owner ka #2 — 10:15 tak kuch nahi, 10:16 par LATE lagte hi toot gayi |
| Row hai, half-day | abhi: +1 (kabhi nahi tootti) | **faisla chahiye — neeche Q3** |
| **Abhi koi row nahi** | **PENDING — kuch nahi** | din khatam nahi hua; 00:01 par sabki streak todna galat hoga |

Yaani number **sirf asli record dekh kar** hilega, ghadi dekh kar nahi — bilkul jaisa aapne kaha ("jaise hi uske attendance me late mark ho jaye").

### "Time correction hote hi poori streak theek" — ye aadha pehle se bana hua hai

Purane din ke liye machinery maujood hai: approve par `markStreaksStale()` lagta hai (`regularization.service.js:256`) aur scheduler ki har tick par `rescanStaleStreaks()` (`bonus.service.js:2635`, daily throttle ke **upar**) poora `auto_streak` mita kar go-live se dobara walk karta hai. Yaani purane din ka sudhaar **minuton me** apne aap aa jata hai (points samet).

Jo nahi chalta: **aaj** ke din ki correction — kyunki re-walk bhi kal par rukta hai. Hissa B isi ko theek kar deta hai: aaj ka record live padha jayega, to correction approve hote hi number sahi.

Jo abhi bhi dhima rahega: purane din ka sudhaar agli tick tak (minute bhar) rukega. Request ke andar 3 second ka re-walk daalna theek nahi — wahi galti pehle do baar ki ja chuki hai (`bonus.controller.js:12-17`, `app.js:80-86`).

### Frontend

1. `['my-summary']` kahin bhi invalidate nahi hota (poore app me) — check-in/check-out aur correction ke baad isko invalidate karna hoga (`use-attendance-today.js:74-77`).
2. Streak card **sirf My Summary** par hai, jabki check-in Dashboard/Attendance se hota hai — "usi waqt update" dikhe isliye streak ki ek chhoti line check-in card ke neeche bhi honi chahiye.
3. Clamp `Math.min(STREAK_LEN - 1, raw)` (`snapshot.service.js:154`) "6 of 6" ko dikhne hi nahi deta. Live me 6th din ka lamha sabse important hai → clamp hatega, aur jab aaj run poori ho to card kahega: **"6 of 6 — aaj raat +8 jud jayenge"** (points raat ko hi banenge, Hissa A).
4. Caption badlegi: "counted up to 14 Oct" ki jagah → **"aaj ka din shaamil"** / **"aaj ka check-in abhi baaki"**.

### Suraksha ke pech (zaroori)

- **Live walk ki seema:** agar `lastStreakScan` 14 din se zyada peechhe hai (scheduler band tha), to live overlay band — purana number + purani caption. Request path kabhi bhari nahi hogi.
- **Live overlay kabhi kuch LIKHEGA nahi** — na counter, na award, na watermark. Sirf padhega. Isi wajah se: lost-update ka khatra nahi, rebuild lock se takraav nahi, double-pay ka khatra nahi.
- **Ek hi user, 1-2 din:** 2 chhoti query (us bande ki aaj ki attendance row + us din ki approved leave) aur holiday set. `~3s` wala poora re-walk kahin nahi aata.

---

> **Faisle ho chuke — jawab section 7 me, aur code ban chuka hai.** Neeche ke sawaal wahi
> hain jo poochhe gaye the, record ke liye rakhe hain.

## 4. Faisle chahiye (ye code se nahi nikalte — aapke niyam hain)

**Q1. Points bhi usi waqt milein, ya raat ko?**
Plan me number turant, points raat ko (00:0x par). Points bhi live karne ka matlab hai award ka row aaj likhna — aur wo row din palat jaane par apne aap hat nahi sakti (insert-only), owner ka "Recalculate points" use chup-chaap uda dega aur preview me dikhega tak nahi. **Salah: number live, points raat ko.**

**Q2. Aaj koi aaya hi nahi — streak kab tootni chahiye?**
(a) Kuch na ho; raat ka scan faisla kare (**salah**) — kyunki 16:00 par uski chhutti approve ho sakti hai.
(b) Shift khatam hote hi (`workWindowClosed`) toot jaye — tab chhutti baad me approve hone par wapas jodni padegi.

**Q3. Half-day par late hone se streak tootni chahiye?**
Abhi: **kabhi nahi tootti** (`bonus.service.js:1538` me `!rec.halfDayLeave`) — purana niyam "half-day par koi penalty nahi". Par 13 Sep 2026 se subah ki chhutti wale (dopahar kaam) par ladder **4 rung tak penalty** lagata hai. Yaani aaj koi 17:10 par aakar 4 point khota hai par uski streak saabut rehti hai. **Salah: streak bhi tootni chahiye jab penalty lagi ho — par sirf ek nayi taarikh se aage (purana itihaas na badle).**

**Q4. Dusri half (subah kaam, dopahar chhutti) par late lag hi nahi sakti — theek karein?**
`lateLadder.js:55-56` dusri-half wale din ke liye mark list **khaali** chhodta hai, to 10:00 wali shift wala 11:30 par aakar bhi PRESENT hai. Aapne "chahe first half ho ya second" kaha — ismein symmetry laane ka matlab hai subah wale hisse ko normal `workStart + grace` se judge karna. Ye **late penalty** ko bhi badlega, sirf streak ko nahi. **Salah: haan karein, par nayi taarikh se aage.**

---

## 5. Kaam ke hisse (jab manzoori mile)

| # | kaam | file |
|---|---|---|
| 1 | `judgeStreakDay()` nikaal kar ek jagah laana | naya `backend/src/lib/streakDay.js` |
| 2 | `runRollingStreak` use isi se chalana (behaviour same) | `bonus.service.js:1531-1546` |
| 3 | `expectedLedger` ki duplicate chain hatana | `bonus.service.js:1844-1852` |
| 4 | live overlay (read-only, seema ke saath) | `snapshot.service.js:139-163` |
| 5 | caption + 6/6 + clamp | `snapshot.service.js:154`, `my-summary/page.jsx:134-163` |
| 6 | `['my-summary']` invalidate | `use-attendance-today.js:74-77`, correction/leave mutations |
| 7 | check-in card par streak ki chhoti line | `components/attendance/check-in-card.jsx` |
| 8 | Q3/Q4 ke faisle (agar haan) — nayi floor date ke saath | `lib/streakDay.js`, `lib/lateLadder.js` |

**Jaanch ka tareeka:** alag throwaway DB (`MONGODB_DB=office_test_streaklive`) par prod ki copy, phir ek-ek case: time par check-in, 1 minute late, excused, half-day dono taraf, off-day/holiday/janamdin, chhutti approve karke 10:16 wali LATE ko palatna, aur "chhatha din aaj" — har case me (a) card ka number, (b) raat wale scan ke baad ka number, (c) points — teeno milne chahiye. Saath me `scripts/test-streak-live.js` jaisa ek script, jaisa `test-streak-stale.js` pehle se hai.

---

## 6. Is jaanch me mile alag bugs (ye plan ka hissa NAHI — alag se faisla karein)

| # | kya | file |
|---|---|---|
| B1 | WFH wali chhutti **cancel** karne par streak stale nishaan nahi lagta | `leave.service.js:1396` (block ke andar hai) |
| B2 | office-wide WFH **undo** (guzra din) par na nishaan na rebuild | `leave.service.js:1141-1147` |
| B3 | Calendar se **holiday** add/edit/delete (guzre din par) — koi streak hook nahi | `holiday.service.js:371, 414, 551` |
| B4 | Kisi ki **janam-taarikh** badalne par streak dobara judge nahi hoti | `holiday.service.js:408, 555` |
| B5 | **Schedule / workDays / employmentType** badalne par sirf overtime banta hai, streak nahi | `user.service.js:268-271` |
| B6 | **Settings** me weekendDays badalne par streak dobara judge nahi hoti | `settings.controller.js:85-90` |
| B7 | **Joining date** badalne par streak ka daayra badalta hai, re-walk nahi hota | `user.service.js:217-242` |
| B8 | **Deactivate** kiye bande ke purane streak award har rescan par hamesha ke liye mit jate hain (points chup-chaap girte hain) | `bonus.service.js:1708` vs `:1512-1515` |
| B9 | `status: 'HOLIDAY'` wali row kisi branch se match nahi karti aur chup-chaap on-time din gin jati hai | `bonus.service.js:1535-1544` |
| B10 | `attendance.service.js:168` ka comment jhooth bolta hai ("an on-time one may extend a streak") | wahi line |
| B11 | Selfie wala check-in hamesha on-time hai (site ka niyam) — streak me bhi poora din ginta hai. Jaan-bujh kar hai ya nahi, kahin likha nahi | `attendance.service.js:147-152` |

---

## 7. Faisla aur jo bana (16 Oct 2026)

Owner ke jawab:

| Sawaal | Faisla |
|---|---|
| Points bhi live? | **Nahi — jaise hain waise.** Award raat ka scan hi likhega. |
| Aaj koi aaya hi nahi? | **Jaise hai waise.** Raat ka scan faisla karega; din bhar number nahi hilega. |
| Half-day par late se streak tootegi? | **Haan**, nayi taarikh se |
| Doosri half (subah kaam) par late lagegi? | **Haan**, aam subah ke time se, nayi taarikh se |
| Nayi taarikh | **1 October 2026** |
| Grace | **Jaisa settings me hai (16 min)** — nahi chheda |
| Subah ka max | **−2 hi** (aam din jaisa) |

### Kya bana

| Kahan | Kya |
|---|---|
| `backend/src/lib/streakDay.js` (naya) | ek hi jagah ka niyam: `judgeStreakDay` → NEUTRAL / ON_TIME / BREAK / PENDING. `HALF_DAY_LATE_BREAKS_YMD = 2026-10-01`. |
| `bonus.service.js` | raat ka scan aur rebuild ka verifier — dono ab wahi function padhte hain (teen copies ki jagah ek) |
| `bonus.service.js` → `liveStreakFor()` | stored counter ke upar aaj (aur jo din scan ne abhi nahi dekhe) ka faisla. **Sirf padhta hai** — na counter, na watermark, na award. 14 din se zyada peechhe ho to live dikhana band. |
| `snapshot.service.js` | My Summary ka card ab isi se banta hai; caption "counted up to <kal>" ki jagah aaj ka haal |
| `attendance.service.js` | `/attendance/today` ke saath streak bhi — bina ek bhi nayi query ke |
| `lateLadder.js` | subah wala half ab `MORNING_HALF_LATE_FLOOR_YMD = 2026-10-01` se late ho sakta hai: grace, phir pehla poora ghanta, **max 2**, midpoint se aage koi mark nahi |
| `check-in-card.jsx` | check-in button ke neeche chhoti si streak line |
| `my-summary/page.jsx` | "today counted" / "today's late arrival reset it" / "today not counted yet" / "6 of 6 — tonight +5" |
| 6 jagah | `['my-summary']` invalidate (check-in, check-out, selfie, correction decide, admin edit, excuse, WFH declare) |

### Jaanch

| Kya | Natija |
|---|---|
| `scripts/test-streak-live.js` (nayi) | **36/36** — truth table, aaj ke saare case, 6-of-6, "overlay kuch likhta nahi", "scan aaj ko nahi chhuta", aur asli check-in par morning-half late |
| `scripts/test-late-ladder.js` (10 naye case) | PART A4 ke **10/10** pass (DB wala hissa is machine par RAM ki wajah se nahi chala — HEAD par bhi wahi) |
| Poore itihaas ka replay | prod ki copy par purana auto_streak **47** vs naye code se **47** — **bilkul ek jaisa**, yaani refactor aur 1 Oct floor se kisi ka ek point nahi hila |
| `my-summary` + `/attendance/today` payload | **8/8** — PENDING / ON_TIME / BREAK / 6-of-6 / 2 din peechhe wala catch-up |
| Frontend | saato badli hui file babel se parse — koi syntax error nahi |

**Jo nahi ho paya:** browser me aankhon se dekhna — is machine par 8 GB me se sirf ~150 MB RAM bachi thi aur Next ka dev server do baar "out of memory" se mar gaya. RAM khaali hone par ye 5 minute ka kaam hai.
