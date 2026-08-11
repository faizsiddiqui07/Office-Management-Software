# 🐞 Open Bugs — saare audits ka master list

> **Ye file kis liye hai:** har page ke audit me jo bug mila aur **abhi tak theek nahi hua**, wo yahan ek jagah jama hota hai. Jab saare page audit ho jaayein, aap **ek hi file** se dekh kar tay kar sakte ho ki kaun-kaun sa banana hai — har audit alag-alag kholni na pade.
>
> Ye [00-features.md](00-features.md) ka jodidaar hai: **wo naye feature ke liye, ye tooti hui cheezon ke liye.**
>
> **Har bug ke aage:**
> 🔴 **RED** = galat data / paisa / security · ⚠️ **MEDIUM** = galat dikhta hai ya do jagah alag · 🔵 **LOW** = polish
> **VERIFIED** = adversarial verifier ne confirm kiya · **PARKED** = mila hai par verify nahi hua
>
> Sources: [01](01-dashboard.md) · [02](02-todo.md) · [03](03-attendance.md) · [04](04-leaves.md) · [05](05-rewards.md) · [06](06-my-summary.md) · [07](07-reports.md) · [08](08-team-users-roles.md)

---

## 🚫 Owner ne "abhi nahi" kaha — ye jaan-boojh kar chhode gaye

| # | Bug | Kyun chhoda | Audit |
|---|---|---|---|
| T1 | 🔴 Roles editor pe koi rank guard nahi — `manageRoles` wala khud ko sab permission de sakta hai aur owner role khaali kar sakta hai | *"ye role kisi aise ko diya hi nahi jaayega jo CEO/Admin role se ched-chad kare"* | 08 |
| T2 | 🔴 App se bana har custom role rank 100 par — anti-escalation flat | *"website me kahin rank system banaya hi nahi hai"* | 08 |
| T4 | 🔴 `manageUsers` wala apni hi schedule badal kar attendance/overtime rig kar sakta hai | owner ne mana kiya | 08 |
| A3 | Attendance ka ek behaviour | jaan-boojh kar aisa hi rakha | 03 |
| — | To-Do ke 3 fix | owner ne revert karwaye | 02 |

**⚠️ T1 + T2 ke saath ek baat yaad rakhni hai:** dono aaj isliye surakshit hain ki (a) `manageRoles` sirf owner ke paas hai, aur (b) prod ke roles **DB me haath se** rank ke saath banaye gaye the. Agar kabhi Roles page se naya senior role banaya jaaye, wo **rank 100** par banega aur system use **owner nahi maanega** — jiska asar bonus ke owner-tier gate aur office-wide WFH par padega. Us din ye dono wapas dekhne padenge.

---

## ⛔ OWNER KA FAISLA (11 Aug 2026) — DELETE WALA POORA AREA CHHOD DIYA GAYA

> *Owner ke shabdon me:* "jo user delete hone par task delete kr rha tha wo sab rahne doo, hum nhi chahte
> hai ki isko theek krne ke chakkar me kuch or kharab kr doo. future me agar delete krna hoga to wo sab
> manually manage kr lia jaega tb hi"

**Neeche ke saare bug jaan-boojh kar chhode gaye hain. Inhe bina owner ke naye faisle ke haath mat lagana.**

Wajah saaf hai: **teen baar** koshish hui, **teenon baar** naya RED nikla —
`08b` (4 RED), `08c` (5 RED, jisme ek maine hi daala tha), `08f` (24 objections, 0 refuted).
Har fix ke bagal me ek naya surakh khulta raha. Chhodna zyada surakshit hai.

**Aaj ka khatra kam hai** kyunki inme se koi bhi bug tab tak nahi chalta jab tak koi account
**permanently DELETE** na kiya jaaye. **Deactivate karna bilkul surakshit hai.** Owner ne tay kiya hai ki
delete ki zaroorat padi to wo **manually** sambhala jaayega.

### Agar kabhi dobara uthana ho — asli jad ye hai

Poori chheen-taan ke baad ek hi baat nikli: **`assignedBy` ek hi field do kaam karti hai** —
*"kaun approve/edit/close kar sakta hai"* (authority) **aur** *"ye task points kamaayega ya nahi"*
(eligibility). Aap authority badalna chahein, to eligibility apne aap badal jaati hai — kabhi points mit
jaate hain, kabhi band mahine me jhoothi penalty ban jaati hai.

**Jab tak ye do kaam alag nahi hote, is area me har fix naya bug banata rahega.** Owner ka apna design
(`08d`) is se sabse zyada bacha — uske Niyam 1 aur 2 **verified neutral** hain — par jahan chain me koi
nahi bachta wahan wo bhi isi jad se toota.

Neev ka kaam: jawab **ek jagah likho**, aur points system ki **saaton** jagah wahi padhein. Line numbers
`08f` me hain. Uske saath ek test jo **har** PointEntry chhoone wale function ko chalaye — grep se
nikaal kar, chun kar nahi. *(Teeno round me yahi chhoota.)*

---

## 🔴 LIVE IN PRODUCTION — deletion ke do bug (11 Aug 2026)

Ye audit 08 ke findings nahi hain — ye T3 fix karte waqt jo review chalayi thi, usme **niklе**. Dono **abhi prod me zinda hain**. Theek karne ki koshish ki gayi thi aur **revert** kar di gayi (neeche wajah).

| # | Bug | Kya hota hai |
|---|---|---|
| **B1** | Tagged owner ka account delete karne par doer ke points udte hain | Task ke points sirf isliye the ki koi owner-tier banda usme **tagged** tha. Uska account delete → raat ki job un points ko "ineligible" padh kar **mita deti hai**. Live data me theek isi shakl ke **5 tasks** hain. **Trigger delete hai, deactivate nahi** — deactivated owner bhi gate khula rakhta hai |
| **B2** | Orphaned delegated task "personal" ban jaata hai | Assigner delete → `assignedBy` null → task shared-personal jaisa. Ab tagged banda use **reopen** kar sakta hai, jisse doer ke points **delete** ho jaate hain aur dobara bante bhi nahi |

**Aaj ka khatra kam hai** kyunki dono ke liye kisi **owner-tier account ko permanently delete** karna padta hai — jo abhi hota nahi. Par jis din ho, chupchaap ho jaayega.

### Fix kyun revert hui

B ka fix likha gaya, 17/17 test pass hue, pre-fix proof bhi liya — phir adversarial review ne **teen aur RED** nikale jo usi fix ke bagal me khule reh gaye the:

1. **Award-path bhi wahi gate poochta hai.** `pruneOrphanTaskEntries` ko nishaan padhna sikhaya gaya, par `onAssignedTaskDone` ko nahi. Nateeja: usi raat ki tick me safai-job points bachati hai aur **paanch line baad** daily re-score unhe mita deta hai
2. **Freeze forward chain me neeche nahi jaata** — leaf doer ka award ab bhi udta hai
3. **Apna hi frozen task reopen** karne par doer ke apne points ud jaate hain

Teenon ke fix ab **exact define ho chuke hain** (file + line tak) — `08c-handover-review-2.md` me.

---

## ⏸️ "Delete par kaam kis ko sonpein" (feature D) — do baar banaya, do baar revert

Owner ne ye feature chuna tha. **Do alag design se banaya gaya, dono revert hue.**

| Try | Design | Review me kya nikla |
|---|---|---|
| 1 | task ka `assignedBy` naye bande ka kar do | **4 RED** — non-owner ko dene par completion par doer ke points **delete**; owner-tier ko dene par **band mahine me nayi penalty**; forward chain toota; heir ka apna task **khud-assign** ban gaya |
| 2 | `assignedBy` chhua hi nahi; alag field `handedOverTo` | **5 RED** — jisme ek **maine hi daala tha**: validation se **pehle** hi account ka saara data delete ho jaata tha, aur mera apna e2e test us par **pass** ho gaya kyunki wo account check karta tha, uska data nahi |

**Kyun ruka:** `assignedBy`, points ka gate, forward chains aur approval queue itne aapas me jude hain ki har fix ke bagal me naya chhed khulta raha. Teen round me har baar RED nikla. Dono attempts ka poora record `08b-handover-review.md` (1,526 lines) aur `08c-handover-review-2.md` (1,113 lines) me hai — dobara shuru karne wale ke liye wahi naksha hai.

**Agar dobara banana ho to:** pehle B poora karo (uske 3 bug), phir D — aur invariant test **har us raste par** chalao jo points ko chhoo sakta hai, do-teen chun kar nahi. Yahi cheez teeno round me chhooti.

---

## 08 — Team / Users / User-detail / Roles

**Fix ho chuke:** T3 ✅ · T5 ✅ · T6 ✅ (10 Aug 2026)

| # | Sev | Bug | Ek line me |
|---|---|---|---|
| T7 | ⚠️ VERIFIED | "Leaves taken" window ke bahar ke din bhi poore ginta hai | 27 Jul–5 Aug ki leave par "Last 7 days" me card **9** dikhata hai, jabki window me kul **6** working day hain. Wahi screen ki table **2** dikhati hai. *(My Summary 06 me yahi bug tha — wahan fix hua, yahan reh gaya)* |
| T8 | ⚠️ VERIFIED | Users page + sidebar sirf `createUsers` ke peeche | Module ke **5 me se 4** toggles bekaar. Ulta bhi: page `createUsers` maangta hai par data `viewEveryone` → table hamesha 403. **6 endpoints** pahunch se bahar |
| T9 | ⚠️ VERIFIED | Role dropdown hardcoded `['CEO','DIRECTOR']` par chhaanta hai | Live setup me wo keys hain hi nahi → filter kuch nahi karta, **aur owner role Create User me default select ho jaata hai** → 403 |
| T10 | ⚠️ VERIFIED | Row menu seniors par bhi Edit/Reset/Deactivate offer karta hai | Confirm dialog wada karta hai, phir 403 |
| T11 | ⚠️ VERIFIED | `GET /users` chupchaap 200 sabse naye accounts par cap | Sabse **purane** log har jagah se gaayab (Team, search, task picker). Deactivated bhi budget khaate hain → cap **total accounts** par lagta hai, headcount par nahi |
| T12 | ⚠️ VERIFIED | Dossier kholne se hi LeaveBalance row **likh** jaati hai | Ek GET ka side-effect. Quota us din ki setting par freeze. Codebase khud ise bug declare karta hai aur read-only version bana rakha hai |
| T13 | ⚠️ VERIFIED | Leave-balance override sirf poore number leta hai | System aadhe din me chalta hai; `2.5` → **422 "Invalid request"**. Quota 13.5 par wapas kabhi set nahi ho sakta |
| T14 | ⚠️ VERIFIED | Dossier target ka poora audit log dikha deta hai | `viewAudit` ka gate bypass, **koi rank guard nahi** — manager owner ka log dekh sakta hai. MANAGER + ADMIN_MANAGER dono me gap |
| T15 | ⚠️ VERIFIED | Deactivate par push subscriptions clear nahi hote | Follow-on notifications (task edits/completions, leave decision) offboarded phone par jaate rehte hain |
| T16 | ⚠️ VERIFIED | Base64 avatar har hot path par | Verifier ne numbers ~6× kam kiye (avatar ~30 KB). Wahi pattern jisne Setting-images wala 9.5s/page incident kiya tha |
| T17 | ⚠️ VERIFIED | Har Edit-user save par poori attendance history ka overtime recompute | Aaj ~35 rows (chhota), 3 saal me ~900. Chhupa khatra: unrelated edit se bonus recompute trigger |
| T18 | ⚠️ VERIFIED | Activity tab ka audit query bina `{actor}` index | Aaj ~3,000 docs (theek), headcount × dino ke saath badhega. **Fix ek line ka hai** |
| T19 | ⚠️ VERIFIED | Permission revoke ke baad ~30s stale cache | Verifier ne chhota kiya: window instance ke last reload se, average ~15s; cold instance kabhi stale allow nahi karta |
| — | 🔵 PARKED ×5 | Dossier me duplicate kaam · Roles page "N users" deactivated bhi ginta hai · temp-password dialog ek Esc par khoya · 200-cap ke do aur angle | — |

---

## 07 — Reports

**Fix ho chuke:** R1–R7 saatoN ✅ (95/95 isolated-DB suite + pre-fix proof)
**Bacha hua:** **56 PARKED (unverified)** — P1–P10 performance, security, PDF fidelity, UX. Detail [07-reports.md](07-reports.md) me.

## 06 — My Summary

**Fix ho chuke:** S1–S4 ✅
**Bacha hua:** **32 PARKED (unverified)**.

## 05 — Rewards / Bonus

**Fix ho chuke:** 5 RED ✅ (effective-dated rates samet)
**Bacha hua:** **57 PARKED (unverified)** — ledger, jobs, security, perf, UX.

## 04 — Leaves

**Fix ho chuke:** L1/L2/L3 + 2 edge ✅
**Bacha hua:** ~7 security + 4 perf + 5 cross-edge + 13 UX — **sab UNVERIFIED**.

## 03 — Attendance

**Fix ho chuke:** A1/A2/A5/A6 ✅
**Bacha hua:** **A4, A7** (owner ki approval ka intezaar), A8/A9 security, A10/A11 perf.

## 02 — To-Do / Tasks

**Fix ho chuke:** RED fix ✅ (3 owner ne revert karwaye)
**Bacha hua:** T1–T10 perf, 5 security, UX — **unverified**. Ek khula sawaal: eligibility UI.

## 01 — Dashboard

**Bacha hua:** **P1–P14** ki pending list.

---

## 📌 Consolidation phase ke liye note

1. **Purane audits (01–07) ki PARKED list abhi UNVERIFIED hai.** Unme se kaafi galat ya bahut chhote nikal sakte hain — audit 08 me verifier ne finders ke numbers **6× tak** kam kiye the. Final report banane se pehle unhe verify karna hoga, warna list se zyada dara hua lagega.
2. **Ek hi bug kai page par milta hai.** "Aaj ka adhoora din absent gin liya" **teen** jagah mil chuka hai (Attendance, Reports R2, ab dossier T6). Fix ek shared helper me hona chahiye, warna chauthi jagah milegi. Aise cross-page patterns [00-index.md](00-index.md) me numbered list me hain.
3. **Tarteeb ka sujhaav:** pehle wo bug jinse **paisa/points** galat hote hain, phir wo jo **do jagah do jawab** dete hain, phir performance, phir polish.
