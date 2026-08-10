# Audit 08 — Team · Users directory · User detail · Roles (2026-08-10)

> Process: 5 specialist agents (logic, security, consistency, performance, UX/roles) → **32 unique findings**. 27 RED/MEDIUM adversarially verify hue → **27 confirmed, 0 REFUTED**, 5 LOW parked.
>
> 27 confirmed me kaafi **overlap** tha (paanch agents ne kuch ek hi cheez alag-alag angle se pakdi) → dedupe ke baad **6 RED + 13 MEDIUM = 19 distinct bugs**.
>
> **STATUS (10 Aug 2026):** owner ne detail me sab dekh kar chuna —
> ✅ **FIXED: T3, T5, T6** (45/45 isolated-DB suite + pre-fix regression proof)
> 🚫 **Owner ne mana kiya: T1, T2, T4** — wajah [00-open-bugs.md](00-open-bugs.md) me darj
> ⏸️ **T7–T19 park** — saare page audit hone ke baad ek saath review honge
> Push/zip nahi hua ([[no-auto-push]]).

Ye module baaki sab se alag hai. Baaki pages me bug ka matlab tha "**galat number dikha**". Yahan bug ka matlab hai "**galat aadmi ko galat taakat mil gayi**". Isliye is baar teen sabse bade findings security ke hain, figures ke nahi. Do bug aise hain jinse ek junior role **poora system apne haath me** le sakta hai.

**Maine khud verify kiya** (agents pe blind bharosa nahi) — har RED ka mechanism apni aankhon se code me dekha, aur joining-date drift to Node me chala kar numerically prove ki.

**Har bug is dhaanche me likha hai:**
1. **Kya galat hai** — bina code ke, seedhi baat
2. **Ye hota kaise hai** — kadam-dar-kadam
3. **Asli misaal** — naam, tarikh, numbers ke saath
4. **Nuksaan kitna**
5. **Aaj tak dikha kyun nahi**
6. **Fix se kya badlega** (aur purane data ka kya hoga)

---
---

# 🔴 RED — 6 bugs

---

## 🔴 T1 — Jise "role ka naam badalne" ka haq diya, wo **khud ko malik bana sakta hai**

**Kahan:** `backend/src/controllers/roles.controller.js:76-99` · route `roles.routes.js:17`
**Kis-kis ne pakda:** logic + security, teen alag findings — ek hi jad

### 1. Kya galat hai

Aap kisi ko "Roles page khol sakte ho" ki ijaazat dete ho — soch kar ki wo bas role ka **naam** theek karega, ya kisi role me ek chhota toggle badlega.

Lekin wahi aadmi **apne hi role ka page khol kar, saare toggles on karke, Save** dabaa sakta hai. Uske baad uske paas wo sab kuch aa jaata hai jo aapke paas hai — Settings, SMTP, branding, sabki salary/attendance, audit log, expenses, sabke passwords reset karna.

Aur wo **aapka role khaali** bhi kar sakta hai.

### 2. Ye hota kaise hai

`PUT /api/roles/:id` par sirf **ek** pehra hai: "kya tumhare paas `manageRoles` hai?" Bas. Uske andar jaakar maine dekha ki teen cheezein **nadaarad** hain:

- **Kaunsa role edit ho raha hai, ye kabhi check nahi hota.** Apna role? Owner ka role? Code ke liye sab barabar.
- **Jo permission maangi ja rahi hai, wo maangne wale ke paas hai ya nahi — ye bhi check nahi hota.** `sanitizePermissions()` sirf itna dekhta hai ki naam sahi likha hai ya nahi.
- **Rank ki koi tulna nahi.** Junior senior ka role edit kar sakta hai.

Ek hi guard hai, aur wo bilkul alag cheez ke liye hai: *"kam se kam ek role ke paas `manageRoles` bacha rahe"* (taki system se sab tale na lag jaayein). Hamlaawar ka apna role `manageRoles` rakhta hi hai — to ye guard **hamesha pass** ho jaata hai. Wo raksha karta hai *system* ki, *aapki* nahi.

**Ye baat isliye zyada chubhti hai** ki usi module me baaki har jagah ye pehra laga hua hai. `user.service.js` me `resetCredentials`, `updateUser`, `deleteUser`, `setLeaveBalance` — sab par rank-guard hai, theek isi khatre ke liye. Comment tak likha hai: *"a junior custom role granted the permission"*. Sirf **Roles editor** chhoot gaya — aur wahi sabse khatarnaak darwaza hai.

### 3. Asli misaal

**Asha** = owner (`CEO_PRESIDENT`, rank 1). **Ravi** = HR.

| Kab | Kya hua |
|---|---|
| **10 Aug, 10:00** | Asha "HR Steward" role banati hai. System use chupchaap **rank 100** de deta hai. Asha `manageUsers` tick karti hai (HR profile edit kar sake) aur `manageRoles` bhi (HR role ka naam theek kar sake). Ravi ko assign kar deti hai. **Asha ki niyat: HR housekeeping.** |
| **10 Aug, 14:30** | Ravi login karta hai. Roles page khulta hai. `GET /roles/catalog` bhi `manageRoles` ke peeche hai — jo uske paas hai — to use **saari 24 permissions ki poori list** dikh jaati hai. Kaunsi cheez kya karti hai, sab likha hua. |
| **10 Aug, 14:31** | Ravi **apne hi role** ka editor kholta hai. **Har ek box tick** karta hai. Save. Server sochta hai: "manageRoles hai? haan. Lockout? role ke paas manageRoles tha, ab bhi hai — theek hai." **Save ho gaya.** `loadRoles()` cache turant refresh ho jaata hai. |
| **10 Aug, 14:32** | Agle hi click par Ravi ke paas: `manageSettings` (SMTP + branding), `viewAudit`, `viewEveryone`, `deactivateUsers`, `resetCredentials`, `manageExpenses`, `downloadReports`, `changeRoles`. Wo Settings kholta hai, company ka sender email badal deta hai. Company report download karta hai. Sabki attendance dekhta hai. **Usne kisi user ka role field chhua tak nahi** — isliye jo rank-guard use rok sakta tha, use kabhi mauka hi nahi mila. |
| **10 Aug, 14:40** | (Agar wo chaahe) Ravi `CEO_PRESIDENT` ka editor kholta hai, **sab untick** karke Save. Lockout check pass ho jaata hai kyunki HR_STEWARD ke paas abhi bhi `manageRoles` hai. **Asha ab Settings aur Roles nahi khol sakti.** |
| **11 Aug (server restart)** | Boot par `ensureRoleManagerExists` chalta hai. Wo dekhta hai "rank-1 role me `manageRoles` nahi hai" → **Asha ka role wapas theek kar deta hai**. Asha ko access mil jaata hai. |
| **Uske baad hamesha** | **Ravi ka inflated role kabhi theek nahi hota.** Wo failsafe sirf `minRank` wale role ko dekhta hai. HR_STEWARD rank 100 par hai, kabhi minRank nahi banega. **Escalation permanent hai.** |

### 4. Nuksaan kitna

- Ek aadmi ko diya gaya "naam badal do" ka haq **poore system ki chaabi** ban jaata hai
- Aapka apna role khaali ho sakta hai (restart tak)
- Uski escalation **apne aap kabhi wapas nahi hoti** — sirf tab hatengi jab aap khud Roles page khol kar uske toggles manually utaaro
- Audit log me sirf `role.update` likha hoga — kya-kya juda, wo nahi

### 5. Aaj tak dikha kyun nahi

Kyunki aaj tak aapne shayad kisi ko `manageRoles` diya hi nahi hai — sirf apne paas rakha hai. **Ye bug tab tak soya hua hai jab tak aap kisi aur ko Roles ka haq nahi dete.** Jis din denge, us din se ye zinda ho jaayega. Yahi ise "abhi theek karo" wali cheez banaata hai — baad me nahi, jab zaroorat pad chuki ho.

### 6. Fix se kya badlega

`update()` (aur `remove()`) me role chhoone se pehle teen check jodne honge: (a) caller ka rank target role se **upar ya barabar** ho, (b) caller **wahi permission na de sake jo uske apne role ke paas nahi hai**, (c) apna hi role edit karna alag se handle ho. Wahi `canAssignRole` jo `user.service.js` me pehle se hai.

**Purane data par asar: koi nahi.** Ye sirf naye requests ko rokta hai. Aapke maujooda roles jaise hain waise rahenge.
**Ek side-effect:** agar aap khud (owner) ho, aap par koi rok nahi lagegi — kyunki aapka rank sabse upar hai.

---

## 🔴 T2 — App se bana **har role ek hi level par** hai — isliye "junior senior ko promote nahi kar sakta" wala pehra **bekaar** hai

**Kahan:** `roles.controller.js:66` (`rank: 100` hardcoded); `updateSchema` (22-25) me `rank` field **hai hi nahi**

### 1. Kya galat hai

System me ek seedhi si suraksha hai: **"tum kisi ko apne se ooncha role nahi de sakte."** Ye rok "rank" (seedhi ka danda) par chalti hai — chhota number = zyada taakat.

Lekin **Roles page se banaya gaya har role rank 100 par banta hai**, aur rank badalne ka **koi rasta hi nahi hai** — na UI me, na API me. Maine poora dhoondha.

Nateeja: sab log ek hi danda par khade hain. `100 >= 100` hamesha sach hai. Matlab **wo suraksha zinda to hai, par andhi hai.**

### 2. Ye hota kaise hai

- `create()` har naye role ko `rank: 100` de deta hai. Bas — koi vikalp nahi
- `update()` ke schema me `rank` hai hi nahi → API se bhi nahi badal sakta
- Role editor dialog sirf `label` + `permissions` bhejta hai
- Router me rank ka koi endpoint nahi

Ab `canAssignRole` ka asli code: `return tRank >= cRank` — "target ka rank mere rank se bada ya barabar hai?" Do custom roles = `100 >= 100` = **hamesha haan**.

### 3. Asli misaal

**Setup (1 Aug, owner ek baar karta hai):** Owner do custom role banata hai —
- **"HR Executive"** — sirf `manageUsers` + `changeRoles`. **Jaan-boojh kar** `manageRoles` aur `manageSettings` nahi diye
- **"Super Admin"** — sab kuch, `manageRoles` samet

Staff "Team Member" par hai. **Teenon rank 100.** Priya ko HR Executive mila.

| Kab | Kya hua |
|---|---|
| **10 Aug, 10:05** | Priya → Users → Ravi (Team Member) → Edit → Role dropdown → **"Super Admin"** → Save. Server ke checks: `canAssignRole('HR_EXECUTIVE','TEAM_MEMBER')` = `100 ≥ 100` ✅ · `canAssignRole('HR_EXECUTIVE','SUPER_ADMIN')` = `100 ≥ 100` ✅. **Ravi ab full admin hai.** Jis insaan ne ye taakat di (Priya) uske paas khud `manageRoles` bhi nahi hai. |
| **10 Aug, 10:07** | Ravi (ab Super Admin) → Users → Priya → role = "Super Admin". Wahi checks pass. **Ab dono full administrator hain.** |

Do log jinke paas milaakar sirf "users edit karo + role badlo" tha, ab roles, settings, points deletion — sab control karte hain. **Jo ek control ye rokne ke liye banaya gaya tha, usne kuch nahi kiya.**

### 4. Guard zinda hai — sirf andhi

Agar Priya `CEO_PRESIDENT` (rank 1) ko chhoone ki koshish kare → `1 >= 100` = **false** → **sahi se block**. Matlab code bilkul theek likha hai. Sirf **sab log ek hi rank par khade hain**, isliye wo kabhi kaam hi nahi aata.

### 5. Aapke liye khaas — verifier ki sabse zaroori baat

Verifier ne ek cheez pakdi jo finder ne miss ki thi:

> **Aapka production aaj sirf isliye surakshit hai ki jisne DB me haath se roles banaye the, usne `rank: 1` type karna yaad rakha.**

App khud kabhi rank 1 nahi de sakti. Matlab:

- Aaj agar aap **Roles page se** naya "sabse ooncha" role banaayein, wo **rank 100** par banega
- `isOwnerRole` use **owner maanega hi nahi**
- Aur us par tikke hue saare faisle galat role ko dekhenge: **bonus ka owner-tier gate** (kis task pe points milenge), **office-wide WFH declare karna**, aur wo har jagah jahan "sirf malik" ka matlab hai

Yaani ye bug sirf security ka nahi — **points aur attendance ka bhi** hai.

### 6. Fix se kya badlega

Role banate/edit karte waqt **rank ka field** dena hoga (ya "is role ko kis role ke neeche rakhna hai" wala simple dropdown, jo andar rank me badal jaaye).

**Purane data par asar:** aapke maujooda roles ka rank waisa hi rahega jaisa DB me hai. Sirf naye/edited roles ko sahi rank milega. Ek baar ki safai chahiye hogi — maujooda custom roles ko sahi seedhi par bithana.

⚠️ **Ye sabse dhyaan se karne wala fix hai** — rank galat set ho gaya to log ek doosre ko edit nahi kar paayenge. Isliye main pehle aapko **maujooda roles ki list rank ke saath** dikhaunga, aap tay karenge kaun kiske upar hai, tab hi kuch chhedunga.

---

## 🔴 T3 — Ek aadmi ka account **delete** karne par **doosre logon ke kamaye hue points ud jaate hain**

**Kahan:** `user.service.js:347` + `bonus.service.js:1684, 1710-1713`

### 1. Kya galat hai

Maan lijiye ek manager resign karke chala gaya. Aap uska account **permanently delete** kar dete ho — bilkul saaf-suthri, samajhdaari wali baat.

Lekin usne jaate-jaate jo tasks **doosron ko diye the**, un tasks par **doosron ne** jo points kamaye the — **wo saare points agle din chupchaap mit jaate hain.**

Aur ulta bhi hota hai: jinke us manager ke tasks par **penalty** lagi thi, unki **penalty bhi maaf** ho jaati hai.

### 2. Ye hota kaise hai — teen kadam ki chain

**Kadam 1 — delete points ko haath nahi lagata.**
Maine `deleteUser` ka poora deletion list khud padha. Usme hai: Attendance, LeaveRequest, LeaveBalance, Regularization, Task (jinka *owner* wo tha), Notification, PushSubscription, LedgerEntry… **`PointEntry` list me hai hi nahi.**

Uski jagah ek aur line chalti hai:
```js
Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null } })   // :347
```
Matlab: jo tasks usne **doosron ko diye the** wo delete nahi hote (wo doosron ke hain, sahi baat hai) — bas un par se **"kisne diya"** ka naam hata diya jaata hai.

**Kadam 2 — points task ke KARNE WALE ke hote hain, dene wale ke nahi.**
Completion ka award `user: copy.owner` par likha jaata hai, overdue ki penalty `user: t.owner` par. Yaani jo point us manager ke diye task par bane, wo **us manager ke nahi — E1, E2, E3 ke hain.**

**Kadam 3 — safai-job unhe anaath samajh kar mita deta hai.**
Roz ek safai-job chalti hai jo aise points dhoondhti hai jinka task delete ho chuka hai. Wo tasks ko is filter se dhoondhti hai:
```js
Task.find({ _id: { $in: ids }, assignedBy: { $ne: null } })   // :1684
```
Dekhiye — `assignedBy: { $ne: null }` = "**jinka assigner set ho**". Jis task ka assigner abhi-abhi null kiya gaya, wo is filter me **aata hi nahi**. Job sochti hai *"ye task to hai hi nahi"* → us par ke saare points **hard-delete** (`:1713`).

**Koi log nahi. Koi notification nahi. Koi audit trail nahi.**

**Aur wapas kabhi nahi aata.** Dobara score karne se pehle teen jagah wahi "assigner set ho" check hota hai (`:619`, `:1626`, `:1030`) — jo ab kabhi pass nahi hoga.

### 3. Asli misaal (rate ₹10/point maan lo)

| Kab | Kya hua |
|---|---|
| **Mon 3 Aug** | Manager **M** teen tasks deta hai: **E1** ko "Vendor invoices reconcile" (due 5 Aug), **E2** ko "Client proposal" (due 6 Aug), **E3** ko "Stock audit" (due 4 Aug) |
| **5 Aug** | E1 on time complete → **+5 points (₹50)** |
| **6 Aug** | E2 on time → **+5 (₹50)** |
| **5–9 Aug** | E3 late: 5 Aug ko **−5** ka mark, phir roz **−1** → 9 Aug tak **E3 = −9** |
| **10 Aug** | M resign kar chuka hai. Leadership uska account deactivate karke **permanently delete** karti hai. Tasks delete nahi hote. **Points ko us waqt kuch nahi hota — sab totals bilkul theek dikhte hain.** Isiliye kisi ko shak bhi nahi hota, aur delete "safal" lagta hai. |
| **11 Aug, subah pehli tick** | Safai-job chalti hai. M ke tasks filter me aate hi nahi → **E1 ka +5, E2 ka +5, E3 ka −5 aur saare −1 — sab hard-delete** |
| **11 Aug, din me** | E1 Rewards kholta hai: August ka net **5 points (₹50) kam**, leaderboard par neeche, header ka badge bhi kam. E2 ka wahi haal. **E3 ka bilkul ULTA — uske −9 maaf ho gaye, wo leaderboard par upar aa gaya.** |
| **31 Aug** | Month-end payout inhi live totals se banta hai → E1 aur E2 ko **₹50-50 kam**, aur E3 ka deficit gayab |

**Aur ye sirf August nahi:** M ne July me jo bhi tasks diye the, unke points bhi **usi ek tick** par udte hain. July ke wo figures jo aap **pehle dekh chuke ho** retroactively badal jaate hain, aur July ka carry-in August ki net standing bhi hila deta hai.

### 4. Nuksaan kitna

- **Paisa seedha:** har affected employee ka payout kam, bina kisi wajah ke
- **Dono taraf galat:** mehnat karne wale ka award udta hai, aur late karne wale ki penalty maaf ho jaati hai — leaderboard ulta ho jaata hai
- **Purane mahine badalte hain:** jo report aap July me dekh chuke ho, wo ab alag padhegi
- **Koi nishaan nahi:** dhoondhne ka koi rasta nahi ki kya-kya udaa

### 5. Aaj tak dikha kyun nahi

Do wajah:
1. **Delete ke waqt kuch nahi hota** — sab totals theek dikhte hain. Nuksaan **agle din** hota hai, jab tak koi delete ko yaad bhi nahi rakhta
2. Aapne shayad abhi tak kisi ka account **permanently delete** kiya hi nahi (sirf deactivate kiya ho) — deactivate se ye bug nahi chalta, **sirf delete se**

### 6. ⚠️ Verifier ne finder ko sudhaara

Finder ne likha tha *"ye har Rewards load pe hota hai"* — **galat**. Wo `bonus.service.js:1674-1675` ke ek **purane comment** se aaya (comment stale ho chuka hai). Asli call site **line 1759** hai, `maybeRunDaily` ke **din me ek baar** wale throttled block ke andar, aur `maybeRunDaily` ab **sirf EventBridge scheduler** se chalta hai.

To wipe **"agle IST din ki pehli scheduler tick"** par hota hai — max ~1 din ki der. **Nuksaan wahi hai, sirf trigger alag hai.** Ye correction zaroori hai kyunki isse pata chalta hai ki **delete ke turant baad check karne se kuch galat nahi dikhega** — agle din dikhega.

### 7. Fix se kya badlega

Do tarah ho sakta hai, aap chunenge:
- **(a) Delete ke waqt hi** us aadmi ke diye tasks ke points ko "surakshit" mark kar dena (jaise `assignedBy` null karne ke bajaay ek `assignedByDeleted: true` flag rakhna) — taaki safai-job unhe anaath na samjhe
- **(b) Safai-job ko sikhana** ki "assigner null hai" ka matlab "task gayab hai" nahi hota — sirf sach me gayab task ke points hataaye

**Purane data par asar:** agar aap **pehle hi** kisi ka account delete kar chuke ho, to jo points ud chuke hain wo **wapas nahi aayenge** (record hi mit gaya). Un logon ko manual points dene padenge. Isliye pehle main aapko **batauunga ki ab tak kitne accounts delete hue hain aur kitne points affected hue** — tab aap tay karenge.

---

## 🔴 T4 — Jise "profile edit" ka haq diya, wo **apni hi shift badal kar** attendance aur points **rig** kar sakta hai

**Kahan:** `backend/src/services/user.service.js:203-206` + `website/components/users/users-directory.jsx:152`
**Severity:** finder ne MEDIUM likhi thi — **verifier ne RED ki**

### 1. Kya galat hai

Aap kisi HR-type role ko `manageUsers` dete ho — soch kar ki wo logon ka naam, department, phone theek karega.

Lekin **"profile"** me `schedule` (kis waqt aana-jaana, kaunse din kaam) aur `employmentType` bhi aate hain. Aur us aadmi par **apne aap ko edit karne ki koi rok nahi hai.**

To wo apni hi shift badal kar: **apni late-marking mita sakta hai, apne absent din gaayab kar sakta hai, aur apne liye farzi overtime points bana sakta hai.**

### 2. Ye hota kaise hai

`updateUser` me `isSelf` (ye khud hai kya?) calculate to hota hai — lekin use **sirf do jagah** lagaya gaya hai:
- role badalna (`:184`) — "apna role khud nahi badal sakte" ✅
- khud ko deactivate karna (`:194`) — ✅

**Profile block (`:203-206`) me `isSelf` ka naam tak nahi hai.**

Aur `PROFILE_FIELDS` me kya-kya hai, maine khud file me dekha:
```js
['name','department','designation','phone','reportsTo','dateOfJoining',
 'lastWorkingYMD','taskAssign','employmentType','schedule']
```
**`schedule` aur `employmentType` dono ismein hain.**

Bacha ek rank-check — lekin apne aap par wo `canAssignRole(myRole, myRole)` = same rank = **hamesha true**. To bas `manageUsers` chahiye.

**UI me bhi khula hai.** `users-directory.jsx` me:
- **Deactivate** (`:162`) par hai: `row.original.id !== user.id` — "apne aap ko nahi"
- **Delete** (`:171`) par bhi hai
- **Edit** (`:152`) par **nahi hai**

Ye asymmetry code me saaf dikhti hai — matlab likhne wale ko self-guard ka pattern pata tha, bas Edit par lagana reh gaya.

### 3. Asli misaal

**Setup:** office 10:00–18:00, grace 10 min, weekend sirf Sunday, overtime buffer 0. Bonus: late = **−2**, overtime = **+2/ghanta**.
**Priya** ka custom HR role (non-leadership) = `{manageUsers, viewEveryone}`, full-time, attendance roster par hai.

Priya **ek** request bhejti hai apni hi id par:
```
PATCH /users/<priya-id>
{ "schedule": { "workStart":"13:00", "workEnd":"17:00",
                "graceMinutes":30, "workDays":[1,2,3] } }
```

**Hafte ka asar (Mon 3 – Sat 8 Aug):**

| Din | Ab kya hota hai | Office rule ke hisaab se kya hona chahiye tha |
|---|---|---|
| **Mon 3** | 13:20 badge → uski nayi threshold 13:00+30 = 13:30 → **PRESENT** | 10:10 se late → **−2** |
| **Tue 4** | 13:25 → **PRESENT** | late → **−2** |
| **Wed 5** | 13:29 → **PRESENT** | late → **−2** |
| **Thu 6** | `workDays` me nahi → ab uska "weekend" hai. Ghar par rahi. **Absent nahi gina** | working day tha → **ABSENT** |
| **Fri 7** | wahi → **absent nahi** | **ABSENT** |
| **Sat 8** | off | off |

**Overtime ka hissa:** `schedule` chhoote hi `recomputeAllOvertime` chalta hai, jo uske **purane check-outs** ko **naye workEnd** se dobara naapta hai. Wo pehle 18:00 baje nikalti thi. Naya workEnd 17:00, buffer 0 → har Mon/Tue/Wed ka 18:00 wala checkout ab **60 min overtime** ban gaya.

10 Aug tak ke elapsed Mon/Tue/Wed: 3, 4, 5, 10 Aug = **4 din × 60 min = 4 ghante = +8 points**. Fix se pehle uske **0** the (checkout 18:00 = office ka workEnd).

### 4. Nuksaan kitna

Ek self-PATCH me:
- Hafte ke **~3 late penalty** bach gaye (−6 points nahi lage)
- **2 absent din (Thu + Fri) record se hi gaayab** — aur wo har report, My Summary, dossier me se gaayab
- **+8 farzi overtime points** ban gaye

Poora mahina chale: 5 Monday + 4 Tuesday + 4 Wednesday ke checkouts = **~13 farzi OT ghante = +26 points**, aur har Thu/Fri ki absence chhupi hui.

**Aur ye kisi leadership account ke bina hua.**

### 5. ⚠️ Verifier ki correction

Finder ne kaha tha ki `employmentType = PART_TIME` karna padega — **zaroori nahi**. `normalizeSchedule` `employmentType` ko dekhta hi nahi (uska parameter tak `_employmentType` naam se unused hai), aur `schedule.workDays/workStart/workEnd` **full-timers par bhi lagu** hote hain.

Matlab exploit **aur simple aur bada** hai. Isi wajah se severity MEDIUM → **RED**.

### 6. Aaj tak dikha kyun nahi

Kyunki abhi shayad `manageUsers` sirf aapke paas hai. Aur agar kisi HR ko diya bhi hai, to unhone ye kabhi try nahi kiya — ye koi "galti se ho jaane wali" cheez nahi, jaan-boojh kar karni padti hai. **Lekin darwaza khula hai.**

### 7. Fix se kya badlega

Do cheezein:
- **Backend:** profile block me `isSelf` ka check jodna — "apna `schedule`/`employmentType` khud nahi badal sakte" (baaki fields jaise phone, apna badal sakte ho — ya wo bhi aap tay karenge)
- **Frontend:** Edit menu par bhi wahi self-guard jo Deactivate/Delete par pehle se hai

**Purane data par asar:** agar kisi ne pehle se apni schedule badli hui hai, wo waise hi rahegi — fix sirf aage rokega. Main aapko **batauunga ki abhi kis-kis ke paas custom schedule set hai**, aap dekh kar tay karenge ki koi galat to nahi.

---

## 🔴 T5 — "Joined on" **har save par ek din peeche** khisakta hai, aur chhutti ka quota chupchaap badhta jaata hai

**Kahan:** `website/components/users/edit-user-dialog.jsx:67` (padhna) aur `:127` (likhna)

### 1. Kya galat hai

Aap kisi ki joining date **1 August** daalte ho. Save. Sahi ban jaati hai.

Agle hafte aap usi bande ka **sirf designation** theek karne Edit kholte ho. Screen par "Joined on" me likha aata hai **31 July** — aapne is field ko **chhua tak nahi**. Aap designation badal kar Save dabaate ho.

Ab uski joining date sach me **31 July** ho gayi. Aur uska chhutti ka quota **12 se 13.5 din** ho gaya — bina kisi ke maange.

Agli baar phone update karo → **30 July**. Department badlo → **29 July**. **Har save ek din khaata hai.**

### 2. Ye hota kaise hai — maine ye Node me chala kar prove kiya

```
picked 2026-08-01  →  DB me stored:  2026-07-31T18:30:00.000Z
                       (= IST me 1 Aug ki raat 12 baje. DB UTC me likhta hai,
                          isliye 5.5 ghante peeche dikhta hai. Yahan tak SAB THEEK.)

dialog jo dikhata hai (UTC slice) :  2026-07-31   ← EK DIN PEECHE
sahi IST din (ymdInTz)            :  2026-08-01   ← ye sahi hai

save ke baad stored               :  2026-07-30T18:30Z  = IST 2026-07-31
```

**Do lines milkar ye karti hain:**

- **`:67`** — `String(target.dateOfJoining).slice(0, 10)`
  Ye ISO string ka pehla 10 akshar kaat leti hai — jo **UTC** ka din hai. IST ki midnight UTC me pichhle din ka 18:30 hoti hai. Isliye **hamesha ek din peeche** dikhta hai.

- **`:127`** — `if (joiningDate) body.dateOfJoining = joiningDate;`
  **Koi dirty-check nahi.** "Agar kuch bhara hai to bhej do." Chhua ho ya na chhua ho — **har Save par** wahi galat din wapas server ko chala jaata hai.

Server dekhta hai "joining ka **mahina** badal gaya" → `quotaForJoiner` se quota **dobara nikaal deta hai**.

**Ek aur baat jo ise chhupaati hai:** usi file me `quota`/`used` ke liye likhne wale ne **theek yahi guard likha hai** (`:136-137` — "agar badla ho tabhi bhejo"). Matlab pattern unhe pata tha, bas `schedule` aur `dateOfJoining` par lagana reh gaya.

### 3. Asli misaal — **Rahul**, asli joining **1 Aug 2026**, annual quota 18 (1.5/mahina)

| Kab | Kya hua |
|---|---|
| **10 Aug — account bana** | Backend joining date maangta hi nahi (create form me wo field hai hi nahi), to system aaj ki date daal deta hai: 10 Aug. Quota = Aug–Mar = 8 × 1.5 = **12.0** |
| **10 Aug — admin sahi date daalta hai** | "Joined on" = 1 Aug 2026. DB me `2026-07-31T18:30Z`. Quota 12.0 hi rehta hai. **Yahan tak sab theek.** |
| **13 Aug — admin sirf DESIGNATION theek karta hai** | Screen par "Joined on" me likha aata hai **31 Jul 2026**. Admin ne is field ko **haath tak nahi lagaya** — sirf "Executive" se "Sr. Executive" kiya aur Save. → form ne wahi galat 31 Jul bhej diya → DB me date **31 Jul** → server: "mahina Aug se Jul ho gaya" → quota = Jul–Mar = 9 × 1.5 = **13.5**. **+1.5 din, bina maange, bina notification.** Audit log me sirf "user.update" likha hai. |
| **13 Aug ke baad — do page, do jawab** | Users table ka "Joined" column: **01 Aug 2026**. Rahul ke detail page ka header "Access since": **31 Jul 2026**. **Ek hi banda, ek hi date, do page par do din.** Koi bhi HR confuse hoga ki asli kaunsi hai. |
| **20 Aug, 25 Aug…** | Phone update → 30 Jul. Department badla → 29 Jul. **Har save ek din.** Quota 13.5 par khada rehta hai (kyunki July hi rehta hai). |
| **~30 saves baad (date 1 Jul par pahunchti hai)** | 1 Jul = wo din jab office is system par aaya (go-live). System ka rule: *"go-live ya usse pehle jo aaya, wo purana staff hai — usko poore saal ka quota do."* → **Rahul ka quota 13.5 se 18.0 ho jaata hai.** Asli haqeeqat: Rahul 1 Aug ko aaya tha, uska haq **12 din** ka tha. App ab **18** dikha rahi hai — **6 extra chhutti ke din**, sirf isliye ki uski profile 30 baar edit hui. |

### 4. Doosra nuksaan — attendance (finder ne miss kiya, verifier ne pakda)

System har report aur roster me kehta hai *"ye banda apni joining date se pehle ginega hi nahi"*. Rahul ki date jaise-jaise peeche khiskti hai:

- Uska **accountability window peeche khulta jaata hai** — un dino ka bhi jinme uska account tha hi nahi
- Un dino ka koi check-in record nahi hai → wo din **ABSENT** ginte hain
- Uski **attendance % neeche** aati hai aur **bonus points bhi** kam hote hain

Matlab quota me faayda, attendance me nuksaan — **dono taraf galat**.

### 5. ⚠️ Verifier ki do corrections

**(a)** Finder ne likha tha *"har month boundary par +1.5 milta rahega"* — **galat**. Sirf **do** chhalaang hain:
- Aug → Jul: 12 → **13.5** (ye month boundary hai)
- Jul-02 → Jul-01: 13.5 → **18** (ye month boundary se nahi, **go-live exemption** se)

Beech ke ~28 saves me quota **nahi badalta**, **par date khiskti rehti hai** — aur picker ka floor `min="2000-01-01"` hai, matlab koi practical rok nahi.

**(b)** Drift **pehle save se** shuru nahi hoti. Naye user ki date default `Date.now()` hoti hai (poori timestamp), aur drift **tab shuru hoti hai jab admin pehli baar picker se koi date chunta hai** (tabhi value IST-midnight banti hai). *(Ek exception: agar account IST raat 12:00–5:29 ke beech bana ho, to pehla open bhi ek din peeche dikhega.)*

### 6. Aaj tak dikha kyun nahi

Kyunki **ek din ka fark koi notice nahi karta.** Aur quota ka badhna kisi ko dikhta hi nahi — na notification, na audit me before/after. Sirf tab pata chalega jab kisi ka leave balance ajeeb lage.

**Ye bug abhi bhi chal raha hai** — jitni baar aapne kisi ki profile edit ki hai, utne din khisak chuke hain.

### 7. Fix se kya badlega

Teen chhote fix:
- **`:67`** — UTC slice ki jagah company-timezone se din nikaalna (`ymdInTz` jaisa helper frontend par bhi)
- **`:127`** — dirty-check jodna: "agar date badli ho tabhi bhejo" (wahi pattern jo `quota` par pehle se hai)
- **Detail page ka "Access since"** — wahi UTC slice hai, wo bhi theek karna, warna do page do din bolte rahenge

**Purane data par asar — ye zaroori hai:** jo dates **pehle se khisak chuki hain**, wo apne aap theek **nahi** hongi. Main aapko **poori list dunga** — kis-kis ki joining date shak-wali lagti hai aur uska quota kitna hai — aap dekh kar sahi date batayenge, phir hi theek karunga. Quota bhi tab hi dobara ginaunga.

---

## 🔴 T6 — User-detail ka **"Absent" tile** din khatam hone se pehle hi absent gin leta hai — aur **usi page ki table** se ladta hai

**Kahan:** `backend/src/services/dossier.service.js:108-111`

### 1. Kya galat hai

Aap subah 9 baje kisi ka page kholte ho. Upar **"Absent 2"** likha hai. Neeche usi page ki table me sirf **1** absent dikhta hai. Aur wahi range ka PDF download karo to **1** hi aata hai.

**Ek hi screen par teen jagah, do alag jawab.**

Wajah: tile aaj ka din bhi ginn leti hai — jabki aaj ka din **abhi khatam hi nahi hua**, aur wo aadmi 9:58 par aane wala hai.

### 2. Ye hota kaise hai — ek hi function ke andar do niyam

```js
// :108-111  — TILE ka hisaab. Koi guard NAHI.
let absentDays = 0;
for (const ymd of workingDates) {
  if (!presentSet.has(ymd) && !leaveSet.has(ymd) && !wfhSet.has(ymd)) absentDays += 1;
}
```

```js
// :137-147 — USI FUNCTION ki table. Guard laga hua hai.
: workWindowClosed(user, ymd, settings, now) ? 'ABSENT' : 'UPCOMING'
```

Aur table ke upar comment tak likha hai:
> *"A working day with no check-in is only ABSENT once the office day is over — today, before their window closes, is UPCOMING (matches the company report and the daily roster), not a red 'absent'."*

**Niyam likha hua hai. Table par laga hua hai. Tile par lagana reh gaya.**

### 3. Asli misaal

**Ravi**, shift 10:00–18:00, weekend Sunday, August me koi holiday nahi. Ab tak uski **sirf ek** asli absence hai — **Wed 5 Aug**.

Aaj **Mon 10 Aug 2026, subah 9:00** — Ravi ka din shuru bhi nahi hua. Boss Users → Ravi kholta hai, **"This month"** preset = 1 Aug se 10 Aug.

Is range ke working days: **1, 3, 4, 5, 6, 7, 8, 10 Aug = 8 din** (Sunday 2 aur 9 chhod kar). Aaj ka 10 Aug bhi list me hai.

| Kahan | Kya dikhta hai | Kyun |
|---|---|---|
| **Upar "Absent" tile** | **2** | 5 Aug (asli) + 10 Aug (subah 9 baje record hi nahi bana) |
| Usi page ki **attendance table** | **1** absent; 10 Aug par `UPCOMING` | table me guard laga hai |
| Wahi range ka **PDF** | **1** absent; 10 Aug Upcoming | PDF me guard laga hai |

Phir **09:58** par Ravi check-in karta hai — tile chupchaap **2 se 1** ho jaati hai, jaise kuch hua hi nahi.

Agar Ravi sach me na aata, to 18:00 ke baad **2** sahi hota. **Lekin us se pehle ka HAR page-load, HAR employee ke liye, Absent ko 1 zyada dikhata hai.**

### 4. Nuksaan kitna

Ye "paisa udne" wala bug nahi hai — ye **bharose** ka bug hai. Boss subah page kholta hai, "Absent 2" dekhta hai, kisi ko phone kar deta hai — aur wo banda 9:58 par aa raha tha. Aur usi page par neeche 1 likha hai, to boss ko samajh hi nahi aayega kaunsa maane.

### 5. ⚠️ Verifier ki correction — finder ne zyada bol diya tha

Finder ne **teesra** dawa bhi kiya tha ki `workingDays` (denominator) bhi galat hai. **Ye overreach hai.** PDF ka apna `workingDays` bhi aaj ka adhoora din ginta hai — to wo **drift nahi, consistency hai**. Report me use doosra bug batana galat hota.

**Sirf absent count hi asli contradiction hai.**

Do chhoti baatein aur: (1) "This month" preset `to = aaj` set karta hai, month-end nahi — matlab range hi aaj par khatam hoti hai. (2) Badge me capital `UPCOMING` likha aata hai, polished "Upcoming" nahi.

### 6. Ye teesri baar hai

Yahi bimari **Attendance audit (A-series)** me thi, phir **Reports (R2)** me thi, ab **yahan**. Teen jagah ek hi galti. Iska matlab: "absent" ka hisaab **ek hi shared jagah** se aana chahiye, warna chauthi jagah bhi milegi.

### 7. Fix se kya badlega

Tile ke loop me wahi `workWindowClosed` guard lagana jo **usi function ki table me pehle se hai**. Teen line ka fix.

**Purane data par asar: koi nahi.** Ye sirf screen par dikhne wala hisaab hai, kuch store nahi hota. Fix hote hi sahi dikhne lagega.

---
---

# ⚠️ MEDIUM — 13 bugs

---

## ⚠️ T7 — "Leaves taken" **window ke bahar ke din bhi poore** gin leta hai

**Kahan:** `dossier.service.js:185-192`

### Kya galat hai
Aap "Last 7 days" chunte ho. Card kehta hai **"Leaves taken 9"**. Lekin us window me **kul 6 working day hain hi** — 9 aa hi nahi sakte. Aur usi page ki attendance table me sirf **2** "On leave" rows dikhti hain.

### Ye hota kaise hai
Dossier leave requests ko **overlap** se fetch karta hai — "jo leave window ko chhoo bhi jaaye". Ye fetch **jaan-boojh kar** aisa hai (comment me likha hai) taki list me poori leave dikhe.

Lekin aage `approvedDays` har approved leave ka **poora `workingDays`** jod deta hai — window ke andar ke din nahi. **Clipping kahin hoti hi nahi.** `byType` chips bhi wahi karte hain.

Aur **usi screen par** attendance ke numbers **clipped hain** — `onLeaveDays` sirf un ON_LEAVE rows se ginta hai jinki date window ke andar hai. To ek hi screen par **do alag niyam** chal rahe hain.

### Asli misaal
Ek employee ki SICK leave approve hui: **27 Jul se 5 Aug 2026**. Weekend sirf Sunday, to leave ke working days: 27, 28, 29, 30, 31 Jul, 1 Aug, (2 Aug Sunday skip), 3, 4, 5 Aug = **9 din**.

Aaj **10 Aug**. Leadership uska page khol kar **"Last 7 days"** dabaati hai → window **4 Aug se 10 Aug**.

| Kahan | Kya dikhta hai |
|---|---|
| Attendance tab | sirf **4 aur 5 Aug** ki "On leave" rows → **2** |
| Upar "Leaves taken" card | **9** |
| Leaves tab ka chip | **"SICK: 9d"** |

**7 din ki window me 9 din ki chhutti.** Aur us window me kul 6 working day hain.

### ⚠️ Verifier ki correction
Finder ne Sat+Sun weekend maan kar 8 din likhe the. **Aapka default weekend sirf Sunday hai** (`Setting.js:28` → `weekendDays: [0]`), isliye asli count **9** hai — aur numbers **aur bhi kharab** dikhte hain.

### Ye pehle bhi mila hai
Bilkul yahi bug **My Summary audit (06)** me tha — "unclipped leave days". Wahan fix ho chuka hai, **yahan reh gaya**.

---

## ⚠️ T8 — Users page **sirf `createUsers`** ke peeche band hai — 4 doosri permissions bekaar ho gayi

**Kahan:** `website/app/(app)/users/page.jsx:12` · `website/lib/permissions.js:107` · `backend/src/routes/users.routes.js:37`

### Kya galat hai
Aap ek "HR Steward" role banaate ho aur use dete ho: `viewEveryone`, `manageUsers`, `resetCredentials`, `changeRoles`. **`createUsers` jaan-boojh kar nahi dete** — HR ko naye account banane ka haq nahi dena.

HR login karti hai. **Sidebar me "Users" hai hi nahi.** URL type karke jaaye to likha aata hai *"No access — Only admins can manage users and credentials."*

**Aapki di hui chaar permissions ka koi darwaza hi nahi hai.**

### Ye hota kaise hai
Page ka gate: `const allowed = !!user && can(user, 'createUsers');` — **sirf ek** permission. Sidebar ka gate bhi wahi.

Mazedaar baat: `NAV_ITEMS` me **`anyOf` ka support pehle se maujood hai** (Approvals me use hota hai). Pattern available tha, Users par lagaya nahi gaya.

### Ulta case bhi utna hi kharab hai
Page `createUsers` maangta hai, **par `GET /users` `viewEveryone` maangta hai**. To agar kisi ko sirf `createUsers` diya:
- Page **khul jaata hai**
- Table **hamesha 403** khaati hai — aur `retry: 1` ki wajah se request **do baar** jaati hai
- Screen par likha aata hai: *"Couldn't load the team — You do not have permission to do that (requires viewEveryone)"* + ek "Try again" button jo har baar wahi 403 laayega
- **Create button phir bhi kaam karta hai** (`/roles/options` sabke liye khula hai) — matlab banda naye users bana sakta hai par kisi ko dekh nahi sakta

### ⚠️ Verifier ki corrections
- Line number `:11` nahi, **`:12`** hai (`:11` par `useAuth()` hai)
- Scope finder ke likhe se **bada** hai: **5 me se 4** toggles dead hain — `deactivateUsers` bhi, kyunki Deactivate/Activate aur "Delete permanently" dono isi page ke andar hain. **`createUsers` ek de-facto master key ban gaya hai.**
- Fix sirf `anyOf` swap nahi hai — `GET /users` ka `viewEveryone` gate bhi saath me sochna padega, warna page khulega aur table 403 degi

### Kul milaakar kaunse endpoints bekaar ho jaate hain
`PATCH /users/:id`, `DELETE /users/:id`, `POST /users/:id/reset-credentials`, `GET /users/:id/leave-balance`, `PATCH /users/:id/leave-balance`, `GET /users/:id/exit-summary` — **6 endpoints**. Leave-quota override aur exit-summary to **sirf** usi dialog me hain.

---

## ⚠️ T9 — Role dropdown ek **purani hardcoded list** par chhaanta hai — aur owner role **default select** ho jaata hai

**Kahan:** `create-user-dialog.jsx:46-47`, `edit-user-dialog.jsx:33-34`, `website/lib/permissions.js:77`

### Kya galat hai
Frontend maanta hai ki "leadership" ka matlab hai role ki key `'CEO'` ya `'DIRECTOR'`. **Aapki live setup me koi role in keys ka hai hi nahi** — aapka owner role `CEO_PRESIDENT` hai.

Nateeja: wo filter **kisi ke liye kuch nahi chhaanta**. Aur kyunki list **rank ke hisaab se sorted** aati hai (rank 1 sabse upar) aur dialog `assignableRoles[0]` ko **auto-select** karta hai — **"CEO & President" hi Create User ka pehle se chuna hua default ban jaata hai.**

### Asli misaal
**Somvaar 10 Aug 2026:** Riya (custom role, `createUsers` diya gaya) "Create user" dabaati hai. Role dropdown me sabse upar — **aur pehle se chuna hua** — "CEO & President" aata hai. Riya naam, email, department sab bharti hai, role field ko haath nahi lagati (bhara hua to dikh raha tha), Create dabaati hai.

Server turant mana kar deta hai: **403 "You cannot create a user with that role"**. Poora form bekaar gaya, aur use khud samajhna padega ki galti kahan thi.

**Mangalvaar 11 Aug:** aap khud Roles page par "Director" naam ka naya role banate ho. System uski key `DIRECTOR` banata hai — aur ab ye role **har insaan ke dropdown se gaayab** ho jaata hai (kyunki hardcoded list use "leadership" maan leti hai). Role bana hua hai, par kisi ko diya nahi ja sakta.

### Built-in setup me bhi drift hai
Verifier ne finder ki ek baat sudhaari: finder ne kaha tha *"built-in setup me ye theek chalta hai"* — **galat**. MANAGER (rank 5) ko `changeRoles` do → dialog use "Admin Manager" (rank 3) offer karega → Save par **403**.

### Ek aur baat
`/roles/options` `rank` ko DB se select to karta hai (sort ke liye) **par response se hata deta hai**. To frontend chah kar bhi rank se sahi filter nahi kar sakta — pehle backend ko rank bhejna hoga. *(Verifier: `/auth/me` pehle se `isOwner` bhejta hai, to aadha raasta bana hua hai.)*

---

## ⚠️ T10 — Row menu **seniors par bhi** Edit / Reset / Deactivate offer karta hai, phir 403 de deta hai

**Kahan:** `users-directory.jsx:143-171`

### Kya galat hai
Menu **sirf ye dekh kar** banta hai ki *aapke* paas kaunsi permission hai. **Jis par action karna hai uski seniority kabhi nahi dekhi jaati.** (Row ke andar sirf "ye main khud to nahi hoon" ka check hai.)

Client ke paas target ka rank **hai hi nahi** — `/roles/options` rank ko response se hata deta hai.

### Asli misaal
**Mon 3 Aug, 11:40** — CEO Roles page par "Office Admin" role banata hai. App use chupchaap **rank 100** de deti hai. CEO ticks karta hai: `viewEveryone`, `createUsers`, `manageUsers`, `deactivateUsers`, `resetCredentials`. Niyat: Priya HR/admin ka kaam sambhale.

**Tue 4 Aug** — Priya ko wo role mil jaata hai. Baaki 22 log EMPLOYEE/MANAGER par.

**Mon 10 Aug, 10:12** — Priya "Users & credentials" page kholti hai. **Poori list load hoti hai — saare 24 log, CEO ki row sabse upar.**

**10:13** — Priya CEO ki row ka ⋯ menu kholti hai. Usme teen cheezein dikhti hain: **Edit, Reset credentials, Deactivate.**

Wo "Reset credentials" dabaati hai. Confirm dialog kehta hai: *CEO ka password turant kaam karna band kar dega*. Priya confirm karti hai —

**403: "You cannot reset the credentials of a user senior to you."**

Yahi Deactivate par bhi (*"will be unable to sign in"*), aur Edit par bhi.

### Nuksaan
UI **wada karta hai** ki action ho jaayega, confirm dialog **uska nateeja bhi bata deta hai**, aur phir request fail ho jaati hai. Ye sirf jhalla dene wali baat nahi — **destructive confirm ka wada jhootha hona** apne aap me bharosa todta hai.

### ⚠️ Verifier ki corrections
- Repro karne wale role ko `createUsers` + `viewEveryone` + `resetCredentials` **teenon** chahiye (page ka gate + data ka gate + action)
- **"rank-30 custom role" exist hi nahi kar sakta** — app se bana har role rank **100** hi hota hai (T2 dekhiye)
- Ye sirf custom roles ka issue nahi — **built-in ADMIN_MANAGER (rank 3)** me bhi wahi hota hai

---

## ⚠️ T11 — `GET /users` chupchaap **200 sabse naye** accounts par kat jaata hai

**Kahan:** `backend/src/controllers/users.controller.js:62`

### Kya galat hai
```js
const users = await User.find().sort({ createdAt: -1 }).limit(200);
```
- Koi filter nahi, koi `page`/`limit` param nahi, koi `total` count nahi, **koi "truncated" flag nahi**
- Function ka signature hi `listUsers(_req, res, next)` hai — request **jaan-boojh kar ignore** hai, to client chaahe bhi paging nahi maang sakta

Aur `sort({ createdAt: -1 })` ka matlab: **sabse naye 200 bachte hain, sabse purane kat jaate hain.**

### Kis-kis par asar
Ye ek endpoint **Team page, Users directory, Rewards page, Edit dialog, Holiday dialog aur har people-picker** ko feed karta hai. Matlab jo kat gaya, wo **har jagah se** kat gaya — search me bhi nahi milega, task assign karte waqt tick bhi nahi kar paoge.

### Asli misaal
**Jun 2026 (go-live se pehle data entry):** Zia Khan (CEO, account #1), Vikram Singh (#2), Amir Raza (#3), Pooja Verma (#4), Sara Ali (#5)… phir baaki 173 log → #6 se #178.
**Jul 2026:** 22 naye joiners → #179–#200. **Total 200 accounts** (173 active, 27 offboarded).

**5 Aug — Team page:** header padhta hai **"Everyone on the team · 173 members"**. Sab theek — 200 fetch hue, 27 inactive client-side chhat gaye.

**10 Aug, 09:15 — HR 5 naye joiners banata hai.** Ab DB me 205 accounts. Query 200 sabse naye leti hai → **sabse purane 5 accounts kat gaye: Zia, Vikram, Amir, Pooja, Sara — yaani CEO, Director, Admin Manager aur do sabse senior log.**

Ab:
- Team page ka header phir bhi **"173 members"** dikhata hai (5 gaye, 5 naye aaye) — **koi ishaara nahi ki kuch kata**
- Directory me "Zia" search karo → **"No users found."**
- Kisi ko task assign karte waqt CEO ko tick nahi kar sakte

### ⚠️ Verifier ki correction — ye finding ko **aur strong** karti hai
Finder ne kaha tha header "200 members" dikhayega — **galat**. Team page inactive users ko client-side chhaant deta hai, aur `users.controller.js:62` me `isActive` ka **koi filter hai hi nahi**.

Matlab **deactivated ex-employees bhi 200 ka budget khaate hain.** Truncation 200 **headcount** par nahi lagta — **total accounts** (active + deactivated) par lagta hai. Aur delete manual hai, to purane accounts jama hote rehte hain.

**Aapke liye:** ye abhi problem nahi hai (headcount 200 se kam hai), **par ye chupchaap aayega** — koi error nahi, koi warning nahi, bas log gaayab ho jaayenge.

---

## ⚠️ T12 — Kisi ka page **kholne se hi** uski leave-balance row **DB me likh** jaati hai

**Kahan:** `dossier.service.js:195`

### Kya galat hai
User detail page khulte hi dossier apne-aap load hota hai. Uske andar `getOrCreateBalance()` call hota hai — jo row **na milne par ek nayi row INSERT kar deta hai**, aur uska quota **us waqt ki settings** se freeze kar deta hai.

Yaani **ek page dekhne se DB me data likh jaata hai.**

### Codebase khud ise bug maanta hai
`leave.service.js:202-209` par likha hua hai:
> *"a landing-page GET must not seed a LeaveBalance as a side effect — that froze the new year's quota at whatever the setting was on first open, and wrote rows for leadership who can't take leave at all"*

Aur uske liye **`balanceJSONReadOnly` banaya bhi gaya hai**. Dossier abhi bhi **likhne wala** version use kar raha hai.

### Asli misaal
**Wed 31 Mar 2027** — leave year 2026 khatam. 2027 ki koi row abhi kisi ki nahi bani.

**Thu 1 Apr 2027** — CEO ka plan hai ki is hafte quota **18 se 20** karega.
- **11:00** — ek director Users se **Priya ka profile kholta hai**. Page khulte hi Priya ki 2027 row DB me likh jaati hai: **totalQuota 18**
- Director phir Team se 3-4 aur profiles browse karta hai, jinme COO bhi hai → un sabki rows **18 par** ban jaati hain (COO ki bhi, jo leave le hi nahi sakta)

**Fri 2 Apr 2027** — CEO Settings me quota **20** save karta hai. **Koi code purani rows update nahi karta.**

**Mon 5 Apr 2027** — Rahul (jiska profile kisi ne nahi khola tha) pehli baar leave apply karta hai → uski row ab banti hai, **totalQuota 20**.

**Nateeja:** Priya ka poora saal **18 par frozen** (2 paid din kam), Rahul ko **20**. Fark sirf itna ki kisi ne Priya ka page **kis din** khola tha.

### ⚠️ Verifier ki corrections
- Endpoint sirf `viewEveryone` wale **viewer** ke liye khulta hai — lekin **har target** ke liye, leadership samet. Matlab likhne wala leadership hai, **shikaar koi bhi**
- Finder ka future-year seeding wala dar yahan **possible nahi** — window aaj par clamp hoti hai, to naya saal **sirf 1 April ke din se** seed ho sakta hai
- **Ulta khatra hai: PAST years seed ho sakte hain** — is route par na go-live floor hai, na 400-day cap. Koi purani range daal kar purane saal ki rows bana sakta hai

---

## ⚠️ T13 — Leave-balance override **sirf poore number** leta hai, jabki poora system **aadhe din** me chalta hai

**Kahan:** `backend/src/validators/users.validators.js:37-38` + `leave.service.js:293-294`

### Kya galat hai
Validator `totalQuota` aur `used` dono ko **poora number** maangta hai. Aur validator se bach bhi jaao to `setLeaveBalance` dono ko `Math.round()` kar deta hai (`Math.round(13.5) = 14`).

**Lekin aadhe din system ka apna niyam hai:**
- `quotaForJoiner` pro-rata quota ko **nazdeeki aadhe din** par round karta hai (1.5/mahina)
- Ek approved half-day leave `used` me **theek 0.5** jodta hai

### Asli misaal
**Priya 15 July 2026 ko join karti hai** (go-live ke baad, to pro-rata lagta hai). System khud uska quota nikaalta hai: Jul–Mar = 9 × 1.5 = **13.5 din**. Ye aadha din **system ki apni ginti** hai.

**7 Aug 2026** — Priya ek **half-day** leave leti hai, approve hoti hai → `used = 0.5`, `remaining = 13`. Sab theek.

**10 Aug 2026** — admin ko pata chalta hai ki system aane se pehle Priya **2 din** chhutti le chuki thi. To sahi `used` = **2.5** hona chahiye.

Admin Edit User kholta hai — Quota box me **"13.5"** aur Used me **"0.5"** pehle se bhara dikhta hai. Used me **2.5** type karke Save:

**Server poora save reject kar deta hai — 422**, aur toast sirf **"Invalid request"** bolta hai. **Koi hint nahi** ki aadha din allowed hi nahi hai.

Admin haar kar 2 ya 3 daal deta hai:
- **2** → Priya ko aadha din **extra** mil gaya
- **3** → aadha din **kam** ho gaya

Aur ek baar quota field chhoo diya to **13.5 par wapas set kabhi nahi ho sakta** — sirf 13 ya 14. **Override permanently us aadhe din ki precision tod deta hai** jo baaki poora module sambhaal kar rakhta hai.

### ⚠️ Verifier ki corrections
- Error **400 "Expected int"** nahi — **422 VALIDATION_ERROR**, aur toast me sirf **"Invalid request"** dikhta hai (isliye admin ko samajh hi nahi aayega ki kya galat hai)
- Finder ka example joiner (15 Sep 2026) **aaj se aage** ka tha — **15 July 2026** wala joiner lena chahiye (quota 13.5), tabhi ye aaj asli hai

---

## ⚠️ T14 — Dossier target ka **poora audit log** dikha deta hai — `viewAudit` ka gate bypass, aur koi rank guard nahi

**Kahan:** `dossier.service.js:228-240` · route `users.routes.js:38`

### Kya galat hai
Audit log ka apna alag darwaza hai: `/audit` endpoint **`viewAudit`** permission maangta hai. Lekin **dossier** wahi data `activity` ke naam se de deta hai — aur dossier sirf **`viewEveryone`** maangta hai.

**Aur koi rank guard nahi** — rank-5 ka manager **rank-1 owner ka** dossier khol sakta hai. (Jabki paros ke routes alag-alag gated hain: exit-summary → `deactivateUsers`, leave-balance → `manageUsers`.)

Seeded **MANAGER** role ke paas `viewEveryone` hai par `viewAudit` nahi. **ADMIN_MANAGER** me bhi bilkul wahi gap.

### Asli misaal
**Wed 5 Aug 2026** — Owner din bhar apna kaam karta hai:
- Settings me **bonus point values badalta hai** → audit entry `bonus.config`, meta me **before/after rates**
- Priya ka role EMPLOYEE se MANAGER karta hai → `user.update`, meta me **poora PATCH body**
- Suresh ka **password reset** karta hai → `user.reset_credentials`
- Company report download karta hai → `report.download`, meta me scope + date range

Ye sab AuditLog me **actor = CEO** ke saath save hota hai.

**Mon 10 Aug 2026** — Manager Rakesh (seeded MANAGER: `viewEveryone` haan, `viewAudit` **nahi**) login karke Users me **CEO ka profile** kholta hai aur **"Activity" tab** dabaata hai.

Route sirf `viewEveryone` check karta hai → **200 OK**. Response ke `activity` array me **CEO ki last 100 entries saaf dikh jaati hain**: kis din bonus rates badle, kiska role badla, kiska password reset hua, kaunsi report download hui.

UI me bhi koi rok nahi — "Activity" tab bina kisi client-side gate ke render ho jaata hai.

### ⚠️ Verifier ki corrections
- Activity sirf wo entries dikhata hai jahan target **actor** hai — target ke *baare me* doosron ke actions nahi aate. **Phir bhi scenario valid hai**, kyunki CEO ke apne administrative actions hi sabse sensitive hain
- Finder ne sirf MANAGER bola — **ADMIN_MANAGER me bhi wahi gap** hai, to **do seeded roles** affected hain
- Finder ka *"leave balance + task list bhi dikh jaate hain"* wala hissa is finding ka **hard evidence nahi** hai — `viewEveryone` ka label hi "View everyone's attendance & data" hai, to wo arguably intended scope hai. **Sirf audit log hi asli leak hai.**

---

## ⚠️ T15 — Deactivate karne par **push notifications band nahi hote**

**Kahan:** `user.service.js:193-199`

### Kya galat hai
Aap kisi ko offboard karte ho — Users page se Active toggle **OFF**. Uska login turant band ho jaata hai (agli API call par 401).

**Lekin uske phone par notifications aate rehte hain** — kyunki uska push subscription DB me waisa ka waisa pada hai.

Push subscriptions **sirf do jagah** clear hote hain: `resetUserCredentials` aur **permanent delete**. Plain deactivation par nahi. *(M8 fix ne reset-path par clear add kiya tha, deactivation path chhoot gaya.)*

Web push VAPID se **seedha browser endpoint par** jaata hai — app-login se bilkul independent.

### ⚠️ Verifier ne finder ke DONO headline example galat bataye
Finder ne kaha tha "New task from X" aur announcement pushes jaate rahenge — **dono galat**:
- **Naye task:** `createTask` targets ko `isActive: true` se filter karta hai; `forwardTask` inactive par 404 deta hai
- **Announcements:** `notifyAudience` recipients ko `{ isActive: true }` se query karta hai

**Asli leak follow-on notifications se hai** — un cheezon se jo **pehle se maujood** hain:
- Uski pehle se maujood task copies ke **edits / removals / completions**
- Usne jo tasks doosron ko **delegate kiye the**, unke completions
- Uski **pending leave** ka decision

### Asli misaal
**Mon 10 Aug** — Priya resign karti hai. Admin uska Active toggle OFF karta hai. Login band. **Par uske phone ka push subscription zinda.**
Us waqt uske paas: ek pending batch-task copy *"Q3 vendor renegotiation — Acme pricing"*, 2 tasks jo usne juniors ko delegate kiye the, aur 14–15 Aug ki ek pending leave request.

**Tue 11 Aug** — Manager Rahul us batch task ki due date 20 → 25 Aug karta hai. System Priya ko notify karta hai → push mirror → **Priya ke phone par**: *"Rahul updated a task — Q3 vendor renegotiation…"*

Yaani offboarded insaan ko **office ke andar ka asli content** milta rehta hai.

---

## ⚠️ T16 — Profile photo base64 me **har request ke raste par** sawaar ho jaati hai

**Kahan:** `backend/src/middleware/auth.js:34` + `users.controller.js:62`

### Kya galat hai
Jab `ASSETS_BUCKET` set nahi hota, profile photo **base64 me User document ke andar** chali jaati hai. Aur:
- `requireAuth` **har API call par poora User doc** fetch karta hai
- `GET /users` **bina projection ke** sab users laata hai

Matlab photo har request par aur har list par saath aati hai.

### ⚠️ Verifier ki correction — numbers **~6× inflated** the
Finder ne kaha: "150KB photo → doc ~195KB → dashboard visit ≈1.5MB". **UI se ye possible hi nahi.** `profile/page.jsx:73` upload se **pehle** `downscaleImage(file, { maxDim: 256, mime: 'image/jpeg', quality: 0.85 })` chalata hai. Yaani 8MB ki photo bhi **256px JPEG** ban jaati hai ≈ 10–25 KB binary ≈ **14–34 KB base64**.

**Asli numbers:**
- Avatar ≈ **30 KB**, 195 KB nahi
- Ek dashboard visit (~6 authenticated calls) ≈ **180 KB**, 1.5 MB nahi
- `GET /users` 30 logon me 10 base64 avatars ke saath ≈ **320 KB**, 1.5 MB nahi

### Phir bhi ye kyun likha ja raha hai
Kyunki **ye theek wahi pattern hai** jisne Setting doc ke ~0.9MB images wala **9.5s/page** incident kiya tha ([[setting-doc-images-lean-read]]). Us waqt fix ye tha ki hot paths lean read karein. Yahan wahi galti **per-request auth path** par dobara ho rahi hai — abhi chhoti hai, par badhne ka rasta khula hai.

---

## ⚠️ T17 — **Har** Edit-user save par **poori attendance history** ka overtime dobara ginta hai

**Kahan:** `user.service.js:257-270` · trigger `edit-user-dialog.jsx:118-126`

### Kya galat hai
HR ne kisi ke department me **"Desgin" → "Design"** typo theek kiya. Aur kuch nahi chhua. Save.

Uske peeche system us bande ki **poori attendance history** nikaal kar sabka overtime **dobara ginta hai**.

### Ye hota kaise hai
`edit-user-dialog.jsx:118-126` par ye do lines **unconditional** hain:
```js
body.employmentType = employmentType;
body.schedule = schedule;
```
Koi dirty-check nahi, koi diff nahi. Jiske paas `manageUsers` hai, uske **har Save** par dono fields jaati hain. Backend `scheduleTouched` dekh kar `recomputeAllOvertime` chala deta hai.

**Aur (T5 ki tarah hi):** usi file me `quota`/`used` ke liye lekhak ne **theek yahi guard likha hai** (`:136-137`). Pattern pata tha — `schedule` par lagaya nahi.

### ⚠️ Verifier ki corrections
1. **Working-day count galat tha.** Finder ne "go-live se ~28 working days" kaha. Aapka weekend sirf Sunday hai, to hafta Mon–Sat. 1 Jul – 10 Aug = 41 din, usme 6 Sunday → **35 working days**, 28 nahi. Aur 3 saal baad ~305 working days/year × 3 ≈ **~900 rows**, "700+" nahi
2. **"Full scan" nahi hai.** `Attendance.js:56` par `{ user: 1, date: 1 }` unique index hai, aur line 16 par `user` khud bhi indexed. To query index-backed hai — sirf us bande ki rows padhti hai

### Asli asar
- **Aaj:** ~35 rows — chhota, ~50ms
- **3 saal baad:** ~900 rows per user → har routine edit par M0 se **~150–400ms extra**
- **Chhupa hua khatra:** agar office settings beech me badli hon, to ek **bilkul unrelated naam-edit** chupchaap stored `overtimeMinutes` rewrite kar deta hai aur us mahine ka **bonus recompute** bhi trigger kar deta hai

---

## ⚠️ T18 — Activity tab ka audit query **bina sahi index** ke chalta hai

**Kahan:** `dossier.service.js:228` · `models/AuditLog.js:16`

### Kya galat hai
```js
AuditLog.find({ actor: user._id, createdAt: { $gte: dFrom, $lte: dTo } })
        .sort({ createdAt: -1 }).limit(100)
```
AuditLog par **ekmaatra index** `{ createdAt: 1 }` hai (wo bhi TTL ke liye). **`actor` par koi index nahi** — poore repo me AuditLog par doosra index hai hi nahi, na koi migration script.

Matlab MongoDB ko us **poori date-range ke saare documents** padhne padte hain, aur `actor` ka filter **baad me** lagta hai.

### ⚠️ Verifier ki correction — volume **~2× kam** hai
Finder ne kaha: "~150 docs/din → 120-din TTL par ~18,000 live docs → window me ~6,000". **Galat:**
- App **1 Jul 2026** ko live hui, TTL 120 din ka hai → **aaj tak ek bhi log expire nahi hua**
- Rate bhi ~150/din nahi. Login ab lifetime hai ([[session-expiry]]), to `auth.login` roz nahi banta. Realistic: per-employee per-working-day check_in + check_out + 1–2 task/leave actions ≈ 3–4 rows → 30 log × ~3.5 ≈ **~100 rows/working day**
- 1 Jul – 10 Aug me ~30 working days → collection me **~3,000 docs**

### Asli asar
Aaj: CEO kisi ka page khol kar "90 days" dabaata hai → clamp hoke 1 Jul – 10 Aug → MongoDB ~3,000 docs padhta hai sirf **10–20 rows** lautaane ke liye. Abhi ye ~50-100ms hai — **theek hai**. Par ye **headcount × dino** ke saath seedha badhta hai, aur har baar date-range badalne par dobara chalta hai.

**Fix ek line ka hai** — `AuditLog` par `{ actor: 1, createdAt: -1 }` compound index.

---

## ⚠️ T19 — Permission hataane ke baad **~30 second tak** doosre server instances purani copy se allow karte rehte hain

**Kahan:** `backend/src/lib/roles.js:105`

### Kya galat hai
Roles ka cache **har server instance ke apne andar** hota hai. Jab aap kisi role se permission hataate ho, wo write **sirf us ek instance** ka cache refresh karta hai jisne request handle ki. Baaki instances ko pata hi nahi chalta — unke paas sirf **30-second ka TTL** hai.

Poore backend me role badalne ke baad **koi cross-instance invalidation nahi** hai — na pub/sub, na DB version stamp, kuch nahi.

### ⚠️ Verifier ki 4 corrections (ye zaroori hain — bug finder ke likhe se **chhota** hai)

**(a) Window "revoke ke baad 30s" NAHI hai — "us instance ke last reload ke baad 30s" hai.**
`ensureRolesFresh()` `requireAuth` me chalta hai, yaani route ke `requirePermission` se **pehle**. To koi bhi instance jiska cache pehle se 30s+ purana hai, wo apni **agli request par pehle reload karega, phir check**. Matlab **cold ya 30s+ idle instance kabhi stale allow nahi karta.** Bug sirf us instance par lagta hai jisne **pichhle 30s ke andar** reload kiya hai aur active traffic serve kar raha hai. Worst case ~30s, **average ~15s**.

**(b) "Role delete" ko claim se hata dena chahiye** — `remove()` delete tabhi hone deta hai jab us role par koi user na ho.

### Asli misaal
**Mon 10 Aug 2026, sab IST:**
- **11:03:58** — instance B (ek warm container) ne kisi employee ki request serve ki. Us waqt uska cache 30s se purana ho chuka tha, to usne DB se roles load kiye — us load me Manager ke paas `viewEveryone` **abhi bhi tha**. Instance B ab is copy ko **11:04:28 tak** "taaza" maanega
- **11:04:00** — CEO Roles page se "Manager" role se `viewEveryone` ka tick hataati hain. Request **instance A** par jaati hai. A DB update karke turant apna cache reload kar leta hai. Screen par "Saved". **CEO ke liye kaam khatam.**
- **11:04:07** — Manager Rohit apne phone par Team page kholta hai. `GET /api/users` **instance B** par land karti hai. `ensureRolesFresh()` dekhta hai "cache 9 second purana hai, taaza hai" → reload nahi karta → purana permission set → **Rohit ko poori team ka data mil jaata hai**, jabki 7 second pehle uska access chhina ja chuka tha
- **11:04:28 ke baad** — B ka TTL khatam, agli request par wo reload karega, aur Rohit block ho jaayega

**Ulta bhi sach hai:** naya **grant** kiya permission bhi ~30s tak doosre instances par kaam nahi karega — matlab aap kisi ko permission dekar kaho "ab try karo" aur wo kahe "nahi chal raha".

---
---

## ⚠️ PARKED — 5 LOW (unverified)

Ye verify nahi hue, sirf note kar rahe hain:

1. **200-cap ke do aur angle** (Team page ka header, har people-picker) — T11 me cover ho gaya
2. **Dossier me duplicate kaam** — `holidayYMDSet` **do baar** call hota hai, aur response me `records` + `days` **dono** jaate hain jabki UI sirf `days` padhta hai
3. **Roles page ka "N users"** deactivated holders bhi ginta hai, jabki Team page sirf active — **ek hi role ke liye do page do headcount** dikhate hain
4. **One-time temp-password dialog** ek Esc ya backdrop click par band ho jaata hai — password ki **ekmaatra copy** chali jaati hai, koi guard nahi

---

## 🔗 CROSS-CONNECTIONS (baaki audits se)

| Ye bug | Kis purane audit se juda hai |
|---|---|
| **T6** (absent tile) | **Attendance (A-series)** aur **Reports (R2)** me bilkul yahi tha. **Teesri baar.** Ab ye ek cross-page pattern hai — "absent" ka hisaab ek hi shared jagah se aana chahiye |
| **T7** (unclipped leave) | **My Summary (06)** ka "unclipped leave days" RED — wahan fix hua, yahan reh gaya |
| **T3** (points wipe) | **Rewards (05)** — `pruneOrphanTaskEntries` wahi function hai jisme owner-tier visibility gate hai. Wahan ka gate sahi tha; yahan uska **null-assignedBy blind spot** nikla |
| **T5** (joining drift) | **Leaves (04)** — `quotaForJoiner` aur go-live exemption wahin ke rules hain. **Rules theek hain, trigger galat hai** |
| **T1 + T2** | Dono ek hi neev (rank system) ke hain — **saath me sochna behtar** |
| **T9 + T10** | Ek hi jad — frontend `LEADERSHIP=['CEO','DIRECTOR']` maan kar chalta hai jabki backend rank-based hai |
| **T16** | **[[setting-doc-images-lean-read]]** — wahi 9.5s/page wala pattern, is baar avatars me |

---

## 💡 FEATURE IDEAS → **[00-features.md](00-features.md)** me add ho gaye

Roles & access (A1–A5) aur Users & directory (U1–U7) — kul **12 naye ideas** is audit se.
