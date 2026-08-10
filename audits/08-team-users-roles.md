# Audit 08 — Team · Users directory · User detail · Roles (2026-08-10)

> Process: 5 specialist agents (logic, security, consistency, performance, UX/roles) → **32 unique findings**. 27 RED/MEDIUM adversarially verify hue → **27 confirmed, 0 REFUTED**, 5 LOW parked.
>
> 27 confirmed me kaafi **overlap** tha (paanch agents ne kuch ek hi cheez alag-alag angle se pakdi) → dedupe ke baad **6 RED + 13 MEDIUM = 19 distinct bugs**.
>
> **STATUS: kuch bhi fix NAHI hua.** Har bug owner ko samjha ke, approval ke baad hi ([[explain-bugs-before-fixing]]).

Ye module baaki sab se alag hai: yahan ke bugs **galat number** dikhane tak seemit nahi hain — yahan **kaun kya kar sakta hai** wo tay hota hai. Isliye is baar teen sabse bade findings **security/privilege** ke hain, figures ke nahi. Do bug to aise hain jinse ek junior role **poora system apne haath me** le sakta hai.

**Maine khud verify kiya** (agents pe blind bharosa nahi) — har RED ka mechanism apni aankhon se code me dekha, aur joining-date drift to Node me chala kar numerically prove ki.

---

# 🔴 RED — 6

## 🔴 T1 — Roles editor pe **koi rank guard nahi**: `manageRoles` wala khud ko **sab kuch** de sakta hai, aur owner role **nanga** kar sakta hai

**Kahan:** `backend/src/controllers/roles.controller.js:76-99` (`update`), route `roles.routes.js:17`
**Kis-kis finder ne pakda:** logic + security (2 alag angle se) — teen findings, ek hi jad.

### Mechanism

`PUT /api/roles/:id` par **sirf ek** pehra hai: `requirePermission('manageRoles')`. Uske andar:

- Role `req.params.id` se load hota hai — **kaunsa** role hai, ye kabhi check nahi hota.
- `sanitizePermissions(body.permissions)` sirf **invalid keys** hataata hai. Wo ye nahi dekhta ki **maangne wale ke paas khud wo permission hai ya nahi**.
- **Na** `canAssignRole`, **na** `getRoleRank` ki tulna, **na** ye check ki "ye to tumhara apna role hai".

Ek hi guard hai — *lockout counter* (lines 85-88): "kam se kam ek role ke paas `manageRoles` bacha rahe". Aur hamlaawar ka apna role `manageRoles` rakhta hi hai, to ye guard **hamesha pass** ho jaata hai.

Ye baaki module ke apne rules ke **bilkul khilaaf** hai: usi module me `user.service.js` me `resetCredentials`, `updateUser`, `deleteUser`, `setLeaveBalance` — sab par `canAssignRole` ka rank-guard laga hai, theek isi khatre ke liye ("junior custom role ko permission mil gayi to?"). Sirf **Roles editor** khula chhoot gaya.

### Din-ba-din (asli scenario)

**Cast:** Asha = owner (`CEO_PRESIDENT`, rank 1). Ravi = HR.

| Kab | Kya hua |
|---|---|
| **10 Aug, 10:00** | Asha "HR Steward" role banati hai. `create()` use **rank 100** deta hai. Wo ismein `manageUsers` (profile edit karne ke liye) aur `manageRoles` (role ka naam badalne ke liye) tick karti hai. Ravi ko de deti hai. |
| **10 Aug, 14:30** | Ravi login karta hai. Roles page khulta hai. `GET /roles/catalog` bhi `manageRoles` pe gated hai — jo uske paas hai — to use **saari permission ki list** dikh jaati hai. |
| **10 Aug, 14:31** | Ravi **apne hi role** ka editor kholta hai, **har ek box tick** karta hai, Save. Lockout check: role ke paas `manageRoles` tha, ab bhi hai → **koi rok nahi**. Save ho gaya. `loadRoles()` cache turant refresh. |
| **10 Aug, 14:32** | Agle hi click par Ravi ke paas: `manageSettings` (SMTP + branding), `viewAudit`, `viewEveryone` (sabki attendance/salary), `deactivateUsers`, `resetCredentials`, `manageExpenses`, `downloadReports`, `changeRoles`. **Usne kisi user ka role field chhua tak nahi**, isliye `canAssignRole` ko rokne ka mauka hi nahi mila. |
| **10 Aug, 14:40** | (Optional) Ravi `CEO_PRESIDENT` ka editor kholta hai, **sab untick** karke Save. Lockout check pass — kyunki HR_STEWARD ke paas abhi bhi `manageRoles` hai. **Asha ab Settings aur Roles nahi khol sakti.** |
| **11 Aug (cold start)** | `ensureRoleManagerExists` boot pe chalta hai: rank-1 role me `manageRoles` missing dekh kar **Asha ka role wapas theek kar deta hai**. Asha ko access mil jaata hai. **Lekin** HR_STEWARD rank 100 hai, kabhi `minRank` nahi banta → **Ravi ki escalation permanent hai**. |

**Ravi ka inflated role apne aap kabhi wapas nahi hota** — jab tak Asha khud manually notice karke toggles na hataaye.

### Fix ki disha
`update()` (aur `remove()`) me role ko chhoone se pehle: (a) caller ka rank target role se **upar ya barabar** ho, (b) caller **wahi permission na de sake jo uske apne role ke paas nahi hai**, (c) apna hi role edit karna alag se handle ho. Wahi `canAssignRole` jo `user.service.js` me pehle se use ho raha hai.

---

## 🔴 T2 — App se bana **har custom role rank 100** pe hi banta hai → poori anti-escalation **flat**

**Kahan:** `backend/src/controllers/roles.controller.js:66` (`rank: 100` hardcoded), `updateSchema` (lines 22-25) me `rank` field **hai hi nahi**
**Finders:** consistency (2 findings)

### Mechanism

- `create()` har naye role ko `rank: 100` deta hai. **Bas.**
- `update()` ke schema me `rank` hai hi nahi → UI/API se rank kabhi **badla nahi ja sakta**.
- Role editor dialog bhi sirf `label` + `permissions` bhejta hai (`role-editor-dialog.jsx:44-48`).
- Router me rank ka koi endpoint nahi.

Ab `canAssignRole` (`permissions.js:128-130`) ka asli code: `return tRank >= cRank`. Do custom roles = `100 >= 100` = **hamesha true**. Matlab custom roles ke beech **"senior" ka concept khatam**.

### Din-ba-din

**Setup (1 Aug, owner ek baar karta hai):** Owner do custom role banata hai — "HR Executive" (sirf `manageUsers` + `changeRoles`) aur "Super Admin" (sab kuch, `manageRoles` samet). Staff "Team Member" pe hai. Teenon **rank 100**. Priya ko HR Executive mila. Priya ke paas `manageRoles` ya `manageSettings` **jaan-boojh kar nahi** diya gaya.

| Kab | Kya hua |
|---|---|
| **10 Aug, 10:05** | Priya → Users → Ravi (Team Member) → Edit → Role = **"Super Admin"** → Save. Checks: `canAssignRole('HR_EXECUTIVE','TEAM_MEMBER')` = 100 ≥ 100 = ✅; `canAssignRole('HR_EXECUTIVE','SUPER_ADMIN')` = 100 ≥ 100 = ✅. **Ravi ab full admin.** |
| **10 Aug, 10:07** | Ravi → Users → Priya → Edit → role = "Super Admin". Wahi checks pass. **Dono full administrator.** |

Do log jinke paas milaakar sirf "users edit karo + role badlo" tha, ab **roles, settings, points deletion — sab** control karte hain. Jo control ye rokne ke liye banaya gaya tha (rank ladder) wo **zinda hai lekin andha** — kyunki sab 100 par khade hain.

**Sabooot ki guard zinda hai:** agar Priya `CEO_PRESIDENT` (rank 1) ko chhoone ki koshish kare → `1 >= 100` = false → **sahi se block**. Matlab code theek hai, sirf **rank set karne ka koi rasta nahi hai**.

### Verifier ki zaroori correction
- Ye **sirf custom roles** ka issue hai. Seeded built-ins (CEO=1 … SECURITY=8) ke rank alag-alag hain, unme guard kaam karta hai.
- **Lekin aapki live deployment poori tarah custom hai** (`CEO_PRESIDENT` owner + baaki custom) — matlab **owner ko chhod kar har tier rank 100 par hai**, aur ye bug wahan poora lagu hota hai.
- Aur ek baat: aapka production **aaj sirf isliye safe hai** ki jisne DB me haath se roles banaye, usne `rank: 1` type karna yaad rakha. **App khud ye kabhi nahi kar sakti.** Agar aaj Roles page se naya "top" role banaya jaaye, wo rank 100 par banega aur `isOwnerRole` use **owner maanega hi nahi** — matlab bonus ka owner-tier gate, WFH declare, sab galat role ko dekhenge.

---

## 🔴 T3 — Ek user **delete** karne par doosre employees ke **kamaye hue bonus points ud jaate hain**

**Kahan:** `backend/src/services/user.service.js:347` + `backend/src/services/bonus.service.js:1684, 1710-1713`
**Finder:** logic

### Mechanism (teen kadam ki chain)

1. **`deleteUser` points ko haath nahi lagata.** Deletion list (lines 332-343) me Attendance, LeaveRequest, LeaveBalance, Task(owner), Notification, LedgerEntry… sab hai — **`PointEntry` hai hi nahi**. Uske badle line 347: `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null } })` — delete hone wale ne jo tasks **doosron ko diye the**, unse "kisne diya" ka link hata diya jaata hai. (Tasks delete nahi hote — wo doosron ke hain.)

2. **Points task ke KARNE WALE ke hote hain, dene wale ke nahi.** Completion award `user: copy.owner` (`bonus.service.js:686-691`), overdue penalty `user: t.owner` (1054, 1066). Sab `taskRef` ke saath likhe jaate hain.

3. **Safai-job un points ko anaath samajh kar hard-delete kar deta hai.** `pruneOrphanTaskEntries` tasks ko is filter se dhoondhta hai:
   ```js
   Task.find({ _id: { $in: ids }, assignedBy: { $ne: null } })   // :1684
   ```
   Jis task ka `assignedBy` abhi-abhi null kiya gaya, wo is filter me **aata hi nahi** → `t` undefined → line 1710 ka `keep = t && (...)` **falsy** → entry `dead` me → `PointEntry.deleteMany` (1713). **Koi log nahi, koi audit trail nahi.**

4. **Wapas kabhi nahi aata.** `onAssignedTaskDone` `!task.assignedBy` par return karta hai (619), daily re-sync `rescoreAllDoneAssigned` bhi `assignedBy: { $ne: null }` filter karta hai (1626), `scanOverdueTasks` bhi (1030). System dobara score karne se pehle **har jagah** "assigner set ho" check karta hai — jo ab kabhi pass nahi hoga.

### ⚠️ Verifier ki correction (finder galat tha)
Finder ne kaha "ye har Rewards load pe hota hai" — **galat**. Wo `bonus.service.js:1674-1675` ke **purane comment** se aaya. Asli call site **line 1759** hai, `maybeRunDaily` ke **din me ek baar** wale throttled block ke andar, aur `maybeRunDaily` ab **sirf EventBridge scheduler** se chalta hai. To wipe **"agle IST din ki pehli scheduler tick"** par hota hai — max ~1 din ki der. **Nuksaan wahi hai, sirf trigger alag hai.**

### Din-ba-din (rate ₹10/point maan lo)

| Kab | Kya hua |
|---|---|
| **Mon 3 Aug** | Manager M teen tasks deta hai: E1 ko (due 5 Aug), E2 ko (due 6 Aug), E3 ko (due 4 Aug). |
| **4-6 Aug** | E1 on time → **+5 (₹50)**. E2 on time → **+5 (₹50)**. E3 late: 5 Aug ko −5 mark, phir roz −1 → 9 Aug tak **E3 = −9**. |
| **10 Aug** | M resign kar chuka hai. Leadership uska account deactivate karke **permanently delete** karti hai. Tasks delete nahi hote (wo E1/E2/E3 ke hain), bas "kisne diya" link hat jaata hai. **Points ko us waqt kuch nahi hota — sab totals theek dikhte hain.** Isiliye kisi ko shak bhi nahi hota. |
| **11 Aug, subah pehli tick** | Safai-job chalti hai. M ke tasks filter me aate hi nahi → system samajhta hai "task hai hi nahi" → **E1 ka +5, E2 ka +5, E3 ka −5 aur saare −1 — sab hard-delete.** |
| **11 Aug, din me** | E1 Rewards kholta hai: August net **5 points (₹50) kam**, leaderboard pe neeche, header badge kam. E2 ka bhi wahi. **E3 ka ULTA** — uske −9 maaf, wo leaderboard pe **upar** aa gaya. |
| **31 Aug** | Payout inhi live totals se banta hai → E1/E2 ko **₹50-50 kam**, E3 ka deficit gayab. |

**Aur ye sirf August nahi:** M ne July me jo tasks diye the, unke points bhi **usi tick** par udte hain — July ke **pehle se dikhaye gaye** figures retroactively badal jaate hain, aur July ka carry-in August ki net standing bhi hila deta hai.

**Dono taraf galat:** sirf positive award nahi — **negative penalty bhi** udte hain, matlab kisi slacker ka deficit chupchaap **maaf** bhi ho jaata hai.

---

## 🔴 T4 — `manageUsers` wala **apni hi shift** badal kar attendance aur overtime points **rig** kar sakta hai

**Kahan:** `backend/src/services/user.service.js:203-206` (profile block) + `users-directory.jsx:152`
**Finder:** security (verifier ne severity MEDIUM → **RED** upgrade ki)

### Mechanism

`updateUser` me `isSelf` calculate to hota hai — lekin use **sirf do jagah** lagaya gaya hai:
- role badalna (line 184): "apna role khud nahi badal sakte" ✅
- khud ko deactivate karna (line 194): ✅

**Profile block (line 203-206) me `isSelf` ka koi zikr nahi.** Aur `PROFILE_FIELDS` me kya-kya hai? Maine khud dekha:
```js
['name','department','designation','phone','reportsTo','dateOfJoining',
 'lastWorkingYMD','taskAssign','employmentType','schedule']
```
**`schedule` aur `employmentType` ismein hain.**

Apne aap par `canActOnTarget` = `canAssignRole(myRole, myRole)` = same rank = **hamesha true**. To bas `manageUsers` chahiye.

**UI me bhi khula hai:** `users-directory.jsx` me Deactivate (line 162) aur Delete (line 171) dono par `row.original.id !== user.id` ka self-guard hai — **lekin Edit (line 152) par nahi**. Ye asymmetry code me saaf dikhti hai.

### ⚠️ Verifier ki correction
Finder ne kaha `employmentType = PART_TIME` karna padega — **zaroori nahi**. `normalizeSchedule` `employmentType` ko dekhta hi nahi, aur `schedule.workDays/workStart/workEnd` **full-timers par bhi lagu** hote hain. Matlab exploit **aur simple aur bada** hai.

### Din-ba-din

**Setup:** office 10:00–18:00, grace 10 min, weekend sirf Sunday, `overtimeAfterMinutes` 0. Bonus: late = −2, overtime = +2/ghanta. **Priya** ka custom HR role (non-leadership) = `{manageUsers, viewEveryone}`, FULL_TIME, attendance roster par.

Priya **ek** request bhejti hai apni hi id par:
```
PATCH /users/<priya-id>
{ "schedule": { "workStart":"13:00", "workEnd":"17:00",
                "graceMinutes":30, "workDays":[1,2,3] } }
```

Hafte ka asar (Mon 3 – Sat 8 Aug):

| Din | Ab kya hota hai | Office rule ke hisaab se kya hona chahiye tha |
|---|---|---|
| **Mon 3** | 13:20 badge → threshold 13:30 → **PRESENT** | 10:10 se late → **−2** |
| **Tue 4** | 13:25 → **PRESENT** | late → **−2** |
| **Wed 5** | 13:29 → **PRESENT** | late → **−2** |
| **Thu 6** | `workDays` me nahi → ab uska "weekend" → **absent nahi** | working day tha → **ABSENT** |
| **Fri 7** | wahi → **absent nahi** | **ABSENT** |
| **Sat 8** | off | off |

**Overtime:** `scheduleTouched` par `recomputeAllOvertime` chalta hai, jo purane check-outs ko **naye workEnd** se dobara naapta hai. Wo pehle 18:00 baje nikalti thi. Naya workEnd 17:00 + buffer 0 → har Mon/Tue/Wed ka checkout ab **60 min overtime**. 10 Aug tak Mon 3, Tue 4, Wed 5, Mon 10 = **4 × 60 min = 4 ghante = +8 points**. Pehle 0 tha.

**Ek self-PATCH me:** hafte ke ~3 late penalty bache, **2 absent din (Thu+Fri) record se gayab**, aur **+8 overtime points** ban gaye — bina kisi leadership account ke. Poora mahina chale to ~13 farzi OT ghante = **+26 points**, aur har Thu/Fri ki absence chhupi hui.

---

## 🔴 T5 — Edit-user me **"Joined on" har save par ek din peeche** khisakta hai, aur chhutti ka quota chupchaap badhta hai

**Kahan:** `website/components/users/edit-user-dialog.jsx:67` (padhna) aur `:127` (likhna)
**Finder:** ux

### Mechanism — maine ye Node me chala kar prove kiya

```
picked 2026-08-01  →  DB me stored: 2026-07-31T18:30:00.000Z   (= IST 1 Aug ki raat 12 baje — SAHI)
dialog jo dikhata hai (UTC slice) : 2026-07-31   ← EK DIN PEECHE
sahi IST din (ymdInTz)            : 2026-08-01
save ke baad stored               : 2026-07-30T18:30:00.000Z  = IST 2026-07-31
```

Do lines milkar ye karti hain:
- **Line 67:** `String(target.dateOfJoining).slice(0, 10)` — ye ISO string ka **UTC** hissa kaat leti hai. IST midnight UTC me pichhle din ka 18:30 hai, isliye **hamesha ek din peeche** dikhta hai.
- **Line 127:** `if (joiningDate) body.dateOfJoining = joiningDate;` — **koi dirty-check nahi**. Aap sirf designation badlo, phir bhi galat date **wapas server ko chali jaati hai**.

Server dekhta hai "joining month badal gaya" → `quotaForJoiner` se quota **dobara nikaal deta hai**.

### Din-ba-din — Rahul, asli joining **1 Aug 2026**, annual quota 18 (1.5/mahina)

| Kab | Kya hua |
|---|---|
| **10 Aug — account bana** | Backend joining date maangta hi nahi, to aaj ki date lag gayi: 10 Aug. Quota = Aug–Mar = 8 × 1.5 = **12.0** |
| **10 Aug — admin sahi date daalta hai** | "Joined on" = 1 Aug 2026. DB me `2026-07-31T18:30Z`. Quota 12.0 hi. **Yahan tak sab theek.** |
| **13 Aug — admin sirf DESIGNATION theek karta hai** | Screen par "Joined on" dikhta hai **31 Jul 2026**. Admin ne is field ko **chhua tak nahi**. Save. → form ne wahi galat 31 Jul bhej diya → DB me date **31 Jul** → server: "month Aug se Jul ho gaya" → quota = 9 × 1.5 = **13.5**. **+1.5 din, bina maange, bina notification.** Audit log me sirf "user.update". |
| **13 Aug ke baad** | Users table "Joined" = **01 Aug**. Detail page header "Access since" = **31 Jul**. **Ek hi banda, do page, do din.** |
| **20 Aug, 25 Aug…** | Phone update → 30 Jul. Department badla → 29 Jul. **Har save ek din khaata hai.** Quota 13.5 par khada rehta hai (July hi rehta hai). |
| **~30 saves baad (date 1 Jul)** | 1 Jul = go-live. Rule: "go-live ya usse pehle aaya = purana staff = poora saal ka quota". → **Quota 13.5 se 18.0.** Rahul ka haq 12 din ka tha, app **18** dikha rahi hai — **6 extra chhutti**, sirf isliye ki profile 30 baar edit hui. |

### ⚠️ Verifier ki do corrections
- Finder ne kaha "har month boundary par +1.5" — **galat**. Sirf **do** chhalaang hain: Aug→Jul (12 → 13.5) aur Jul-02→Jul-01 (13.5 → **18**, aur wo month boundary se nahi, **go-live exemption** se). Beech ke ~28 saves me quota nahi badalta, **par date khiskti rehti hai** (picker ka floor `min="2000-01-01"` hai, matlab koi practical limit nahi).
- Drift **pehle save se** shuru nahi hoti — tab shuru hoti hai jab admin **pehli baar picker se date chunta hai**. (Exception: agar account IST raat 12:00–5:29 ke beech bana ho, to pehla open bhi ek din peeche dikhega.)

### Doosra nuksaan (finder ne miss kiya, verifier ne pakda)
`joinedYMD` / `hadAccessOn` / `periodStartFor` isi stored date par chalte hain. Har save se **accountability window ek din peeche khul jaata hai** — un dino ka bhi jinme wo aadmi tha hi nahi. Un dino ka koi attendance record nahi hai → wo din **ABSENT** ginenge → attendance % aur bonus points **dono neeche**.

---

## 🔴 T6 — User-detail ka **"Absent" tile** aaj ka din khatam hone se pehle hi absent gin leta hai — aur **usi page ki table** se ladta hai

**Kahan:** `backend/src/services/dossier.service.js:108-111`
**Finder:** logic

Ye wahi bimari hai jo Reports (R2) aur Attendance audit me thi — **ek aur jagah**.

### Mechanism

Ek hi function ke andar **do alag jawab**:

```js
// :108-111  — TILE ka hisaab. Koi workWindowClosed guard NAHI.
let absentDays = 0;
for (const ymd of workingDates) {
  if (!presentSet.has(ymd) && !leaveSet.has(ymd) && !wfhSet.has(ymd)) absentDays += 1;
}
```
```js
// :137-147 — usi function ki TABLE. Guard laga hua hai.
: workWindowClosed(user, ymd, settings, now) ? 'ABSENT' : 'UPCOMING'
```

Table ke upar comment tak likha hai: *"only ABSENT once the office day is over — matches the company report and the daily roster"*. **Tile us convention ko todti hai.**

### Din-ba-din — Ravi, shift 10:00–18:00, ab tak **ek** asli absence (Wed 5 Aug)

Aaj **Mon 10 Aug, subah 9:00** — Ravi ka din shuru bhi nahi hua. Boss Users → Ravi kholta hai, "This month" preset = 1–10 Aug. Working days: 1, 3, 4, 5, 6, 7, 8, 10 = **8 din** (Sunday 2 aur 9 chhod kar).

**Ek hi screen par teen alag jawab:**

| Kahan | Kya dikhta hai | Kyun |
|---|---|---|
| **Absent stat tile** | **2** | 5 Aug (asli) + 10 Aug (abhi record nahi bana) |
| Usi page ki **attendance table** | **1** absent, 10 Aug = `UPCOMING` | table me guard laga hai |
| Wahi range ka **PDF** | **1** absent, 10 Aug Upcoming | PDF me guard laga hai |

Phir **09:58** par Ravi check-in karta hai — tile chupchaap **2 se 1** ho jaati hai, jaise kuch hua hi nahi. Agar Ravi sach me na aata, to 18:00 ke baad 2 sahi hota — **lekin us se pehle ka HAR page-load har employee ke liye Absent ko 1 zyada dikhata hai.**

### ⚠️ Verifier ki correction
Finder ne teesra dawa bhi kiya tha ki `workingDays` denominator bhi galat hai — **ye overreach hai**. PDF ka apna `workingDays` bhi aaj ka adhoora din ginta hai (`report.service.js:656-657`), to wo **drift nahi, consistency hai**. **Sirf absent count hi asli contradiction hai.** Report me denominator ko doosra bug bataana galat hoga.

Aur do chhoti baatein: (1) "This month" preset `to = aaj` set karta hai (`users/[id]/page.jsx:103-105`), month-end nahi — matlab range hi aaj par khatam hoti hai. (2) Badge me capital `UPCOMING` likha aata hai, polished "Upcoming" nahi (`website/lib/attendance.js:23`).

---

# ⚠️ MEDIUM — 13

| # | Bug | Kahan | Ek line me |
|---|---|---|---|
| **T7** | "Leaves taken" stat **range ke bahar ke din bhi poore** gin leta hai | `dossier.service.js:185` | 27 Jul–5 Aug ki leave (9 working days) par "Last 7 days" (4–10 Aug) window me card **"Leaves taken 9"** dikhata hai — jabki window me kul **6** working day hain hi. Attendance tab usi window me sirf **2** ON_LEAVE row dikhata hai. |
| **T8** | Users page + sidebar **sirf `createUsers`** pe gated | `users/page.jsx:12` | Module ke **5 me se 4** toggles bekaar: `manageUsers`, `changeRoles`, `resetCredentials`, `deactivateUsers` — inhe akele dene par banda page hi nahi khol sakta. `createUsers` de-facto **master key** ban gaya. Ulta bhi: page `createUsers` maangta hai par `GET /users` `viewEveryone` maangta hai → sirf `createUsers` wale ko page khulta hai aur table **hamesha 403**. |
| **T9** | Role dropdown **hardcoded `['CEO','DIRECTOR']`** par chhaanta hai | `create-user-dialog.jsx:47`, `edit-user-dialog.jsx:33` | Aapki live setup me koi role `CEO`/`DIRECTOR` key ka hai hi nahi → **filter kuch karta hi nahi**. Aur `assignableRoles[0]` default banta hai + `/roles/options` rank-ascending sorted hai → **Create User ka pre-selected role hi "CEO & President" ban jaata hai**. Built-in setup me bhi drift: MANAGER (rank 5) ko "Admin Manager" (rank 3) offer hoga aur Save par 403. |
| **T10** | Row menu seniors par bhi **Edit / Reset / Deactivate** offer karta hai | `users-directory.jsx:157` | Confirm dialog wada karta hai "password turant band ho jaayega", phir request **403** khaati hai. Built-in ADMIN_MANAGER (rank 3) me bhi wahi. |
| **T11** | `GET /users` chupchaap **200 sabse naye** accounts par cap | `users.controller.js:62` | Deactivated ex-employees bhi 200 ka budget khaate hain (koi `isActive` filter nahi) → truncation **200 headcount** par nahi, **total accounts** par lagta hai. Sabse **purane** log gayab: Team page, directory search, task-assignment picker — kahin nahi. Aur kahin likha nahi ki list kati hui hai. |
| **T12** | Dossier **kholne se hi** LeaveBalance row **likh** jaati hai | `dossier.service.js:195` | Ek GET ka side-effect — jo cheez codebase khud kahin aur bug declare karti hai. 1 Apr 2027 ko CEO quota 18→20 karne wala ho, aur usse pehle koi director kisi ka page khol de → us bande ki row **18 par freeze**, baaki colleagues ko 20. **PAST years bhi seed ho sakte hain** (is route par na APP_LIVE floor hai na 400-day cap). |
| **T13** | Leave-balance override **sirf poore number** leta hai | `users.validators.js:37` | Poora leave system **aadhe din** me chalta hai (half-day leave = 0.5). Admin `2.5` type kare → **422 "Invalid request"**. 2 ya 3 likhe → balance **0.5 din galat**. Aur quota ek baar edit hone ke baad wapas 13.5 par set **kabhi nahi** ho sakta. |
| **T14** | Dossier target ka **poora audit log** leak karta hai | `dossier.service.js:240` | `viewEveryone` wale ko `viewAudit` ke bina bhi target ke `role.update`, `user.reset_credentials`, settings changes, report downloads dikh jaate hain. **Rank guard bhi nahi** — MANAGER, CEO ka dossier khol sakta hai. Seeded ADMIN_MANAGER me bhi wahi gap. |
| **T15** | Deactivate par **push subscriptions clear nahi** hote | `user.service.js:199` | API session to agli request par 401 ho jaata hai, par phone par notification **aate rehte hain**. *(Verifier ne finder ke dono headline example **galat** bataye — naye task aur announcement pushes `isActive: true` se filtered hain. **Asli leak follow-on notifications se hai**: pehle se maujood task copies ke edits/completions, uske delegate kiye tasks ke completions, aur uski pending leave ke decisions.)* |
| **T16** | Base64 avatar **har hot path** par | `middleware/auth.js:34` | Fallback me photo User doc me base64 jaati hai; `requireAuth` **poora doc** fetch karta hai aur `/users` bina projection ke. *(Verifier: finder ke numbers **~6× inflated** the — upload se pehle 256px JPEG downscale hota hai, to avatar ~30 KB hai, 195 KB nahi. Dashboard visit ~180 KB, 1.5 MB nahi.)* Phir bhi ye wahi pattern hai jisne Setting-images wala 9.5s/page incident kiya tha — is baar **per-request auth path** par. |
| **T17** | **Har** Edit-user save par **poori attendance history** ka overtime recompute | `user.service.js:260` | Sirf naam ki typo theek karo, tab bhi. *(Verifier: "full scan" **nahi** hai — `{user, date}` par unique index hai. Aur working days ka count galat tha: 1 Jul–10 Aug = **35** working days, 28 nahi; 3 saal me **~900** rows, "700+" nahi.)* |
| **T18** | Dossier Activity tab AuditLog ko **bina `{actor}` index** ke chhaanta hai | `dossier.service.js:228` | Range ke har doc ki fetch, filter baad me. *(Verifier: volume ~2× kam hai — app 1 Jul ko live hui, TTL 120 din, aaj tak ek bhi log expire nahi hua; realistic ~100 rows/working day → collection me ~3,000 docs.)* |
| **T19** | Permission revoke hone par **~30s tak** doosre Lambda instances allow karte rehte hain | `lib/roles.js:105` | *(Verifier ne window ko sudhaara: "revoke ke baad 30s" **nahi** — "us instance ke last reload ke baad 30s". `ensureRolesFresh` `requireAuth` me chalta hai, matlab **cold ya 30s+ idle instance kabhi stale allow nahi karta**. Bug sirf us instance par jo pichhle 30s me reload kar chuka hai aur traffic serve kar raha hai. Worst ~30s, average ~15s. Aur "role delete" ko claim se hataana chahiye — `remove()` delete tabhi hone deta hai jab us role par koi user na ho.)* |

---

## ⚠️ PARKED — 5 LOW (unverified)

- 200-cap ke do aur angle (Team page, har people-picker) — T11 me cover ho gaya
- Dossier me duplicate kaam: `holidayYMDSet` **do baar**, aur response me `records` + `days` **dono** jabki UI sirf `days` padhta hai
- Roles page "N users" **deactivated** holders bhi ginta hai, jabki Team page sirf active — ek hi role ke liye do page do headcount dikhate hain
- One-time temp-password dialog ek **Esc/backdrop click** par band ho jaata hai — password ki **ekmatra copy** chali jaati hai, koi guard nahi

---

## 🔗 CROSS-CONNECTIONS

- **T6 wahi bimari hai** jo Reports **R2** aur Attendance **A-series** me thi: "aaj ka adhoora din absent gin liya". Ab teen jagah mil chuki hai → ye ek **cross-page pattern** hai, ek jagah ka fix kaafi nahi.
- **T3 Rewards (audit 05) se juda hai** — `pruneOrphanTaskEntries` wahi function hai jo owner-tier visibility gate lagata hai. Wahan ka gate sahi tha; yahan uska **null-assignedBy blind spot** nikla.
- **T5 Leaves (audit 04) se juda hai** — `quotaForJoiner` aur go-live exemption wahin ke rules hain; bug unka **galat trigger** hai, khud rules theek hain.
- **T2 + T1 milkar** poore permission system ki neev hilate hain — dono ka fix ek saath sochna behtar hai.
- **T9 + T10 ek hi jad** — frontend `LEADERSHIP=['CEO','DIRECTOR']` maan kar chalta hai jabki backend rank-based hai.

---

## 💡 FEATURE IDEAS → **[00-features.md](00-features.md)** me add ho gaye
