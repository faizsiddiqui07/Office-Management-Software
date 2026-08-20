# Audit 12 — MASTER CONSOLIDATION (11 Aug 2026)

> **Ye kya hai:** poore audit programme (01–11) ka ek jagah nichod. Ab tak har page alag file me tha; ye document **saare bache hue bug ek saath, root-cause ke hisaab se group karke** dikhata hai — taaki aap ek nazar me dekh sako ki **kaun si ek jad theek karne se kai cheezein band ho jaati hain**.
>
> Iske do jodidaar: [00-open-bugs.md](00-open-bugs.md) (page-wise list) aur [00-features.md](00-features.md) (naye feature ideas).

---

## 🎯 Sabse pehle — 01–07 ki "darawni" parked lists ka sach

Maine baar-baar kaha tha ki 01–07 ki parked lists **kabhi verify nahi hui** aur bharose ke layak nahi. Audit 12 me un **saari 183 parked findings ko aaj ke code se dobara jaancha**. Nateeja rahat wala hai:

| | Ginti |
|---|---|
| **0 RED** | Un lambi lists (56/57/32…) me **ek bhi asli RED nahi tha** |
| **19 already FIXED** | Code aage badh gaya — To-Do ke R1–R5, rewards ka reconcile-rate bug, my-summary ka carry-in, waghera **ab theek hain** |
| **8 MOOT / REFUTED** | Ab lagu hi nahi hote, ya kabhi the hi nahi |
| **18 MEDIUM** | Ye asli hain, dekhne layak |
| **138 LOW** | Perf/UX ki lambi poonch — koi jaldi nahi (perf 43, ux 45, correctness 23, security 16, consistency 11) |

**Matlab:** jo 145+ parked findings ka dhher darawna lag raha tha, wo asal me **18 MEDIUM + lambi LOW poonch** hai — aur wo bhi tab jab 08–11 ke bade RED pehle hi nikaale aur fix ho chuke hain.

---

## 📊 Poore programme ki halat

| Audit | RED fix + push | Fix (zip pending) | Owner ne mana | Bacha (verified) |
|---|---|---|---|---|
| 01 Dashboard | ✅ | — | — | 17 LOW + 1 MED |
| 02 To-Do | ✅ | — | 3 revert (delete area) | 1 MED (R6, owner-accepted) + ~19 LOW |
| 03 Attendance | ✅ | — | A3 | 2 MED (A8/A9) + ~10 LOW |
| 04 Leaves | ✅ | — | — | 6 MED + ~25 LOW |
| 05 Rewards | ✅ | — | — | 1 MED + ~27 LOW |
| 06 My Summary | ✅ | — | — | 2 MED + ~11 LOW |
| 07 Reports | ✅ (R1–R7) | — | — | 4 MED + ~30 LOW |
| 08 Team/Users/Roles | ✅ (T3/T5/T6, pushed) | — | T1/T2/T4 | T7–T19 (13 MED) |
| 09 Expenses/Dues | — | **E1/E2/E4/E5** | RED3 (skip) | 9 MED |
| 10 Settings/Rules | — | **S1/S3/S5/S7** | S2/S4/S6 | 8 MED |
| 11 Six pages | — | **V6** (+ garbage-key) | — | ~14 MED + 4 LOW |

**⚠️ Zip Lambda par chadhna baaki:** 09 (E2/E4) + 10 (S1/S3/S5/S7) + 11 (V6). Jab tak zip nahi chadhti, ye **live nahi** hain. **S1 aur V6 khaas** — abhi prod me kisi ka perfect-attendance award kha rahe hain.

---

## 🔗 ASLI TAAKAT — root-cause pattern (ek jad, kai findings)

Ye is consolidation ka dil hai. Neeche har group ek **jad** hai; use theek karo to uske saare findings ek saath band.

### P-C — "Settings badalne se BEETA HUA waqt dobara likha jaata hai" *(sabse bada)*
Rewards R2 fix me point ki **ginti** effective-dated ho gayi, par baaki live padhe jaate hain. Ye sab isi jad se:
- **S2** — ₹/point badlo → band mahine ka payout badal jaata hai (RED, deferred)
- **S4** — hours/grace/OT buffer badlo → poora ateet dobara naapa jaata hai (RED, deferred)
- **S10** — weekendDays badlo → band mahine ki attendance sheet peeche se badal jaati hai
- **07-late** — Reports task "Late" ko **live graceDays** se judge karte hain, jabki ledger us din ke effective grace se bana — ek hi PDF apne rate-table se contradict
- **04-holiday** — approval ke BAAD leave-range me holiday declare ho → refund nahi, din charged reh jaata hai

**Ek foundation — "har config effective-dated ho" — ye paanch band kar deta hai.** Par ye bada aur nazuk kaam hai (S2/S4 RED hain), alag se dhyan se.

### P-A — Sensitive/khud-ki-daali data sabko dikhta hai *(privacy)*
- **V1** — har colleague ka **birth YEAR** (umar) sabke API response me
- **01** — **Sick leave** ka type poori company ko dikhta hai (health disclosure)
- **A8** — attendance overview me har bande ka **GPS/IP/email/device** leak
- **T14/V5** — dossier bina `viewAudit` ke **poora audit log** dikha deta hai
- **S8** — `GET /settings` bina permission ke bonus config + sabke streak counters

**Ek "shared data par kaun kya dekhe" pass — ye paanch band karta hai.**

### P-B — Leadership ke write-endpoints par self/rank guard gayab *(security)*
- **A9** — `setAttendanceRecord` / `excuseLate` par koi self/rank check nahi
- **04-record** — `POST /leaves/record` par rank guard nahi (senior ke liye leave record kar sakte ho)
- *(T4 — manageUsers apni schedule — owner ne mana kiya)*

**Ek uniform `canAssignRole` + self-guard — ye do band karta hai.** *(Wahi pattern jo audit 08 me thi.)*

### P-E — UI wo offer karti hai jo server refuse karta hai / hardcoded role list vs DB roles
- **T9, T10** — role dropdown + row menu hardcoded `['CEO','DIRECTOR']` par chalte hain
- **V2** — announcement audience custom/owner role offer karta hai → 422; owner khud role-scoped announcements se bahar
- **V3** — `postAnnouncements` wala doosre ki announcement edit/delete kar sakta hai

**Frontend ko live roles + author/rank check par le jaao — ye char band.**

### P-D — Overlap/window par clip na karna (straddling leave poore din dikhata hai)
- **T7** — "Leaves taken" window ke bahar ke din poore ginta hai
- **07-days** — Reports ki Leaves table ka "Days" window se clip nahi hota
*(My Summary S3 isi jad se tha — wo fix ho chuka)*

### P-I — Ek baar tay hua award/penalty dobara nahi dekha jaata (retroactive gap)
- **05-streak** — rolling punctual-streak retroactive correction ke baad reconcile nahi hota
- **04-holiday** — (upar bhi) approval ke baad calendar badle to refund nahi
*(V6 isi jad se tha — abhi fix hua)*

### P-F — Deactivated/deleted user ek figure se gayab, doosre se nahi
- **07-deactivated** — leaver ke Tasks/Rewards headline totals se gayab, par row me aa jaate hain → undercount
*(Dues E2 isi jad se tha — fix ho chuka)*

### P-J — "Invalid request" / galat error-state / jhoothi khali state
- **S15, E12, T13** — har validation fail par bas "Invalid request"
- **04** — BalanceCards error par hardcoded 18/18; RequestsQueue error par "Nothing in the queue"
- **V13** — announcement feed fail par "You're all caught up"

### P-G — IDOR / per-user write par ownership guard nahi
- **V4** — push unsubscribe kisi ka bhi endpoint se band kar sakta hai
- **02-tag** — koi bhi kisi ko (CEO samet) tag kar sakta hai, owner-tier tag hata nahi sakta

### P-K — Unbounded span / index gap *(perf, par crash bhi)*
- **06-span** — custom period backend par unbounded (`?to=9999-12-31` → OOM/timeout)
- **T18/V18** — AuditLog `actor` par index nahi
- Plus ~40 LOW perf items (over-fetch, N+1, serial awaits) — sab per-audit docs me

---

## 🚫 Owner ne jaan-boojh kar chhode (dobara mat chhedo)

| Kya | Kyun |
|---|---|
| **Delete wala poora area** (T3-adhoora, B1, B2, handover, 02 ke 3 revert, R6) | 3 baar koshish, har baar naya RED — `assignedBy` authority+eligibility dono karta hai. `00-open-bugs.md` me poora naksha |
| **T1, T2, T4** (roles rank guard, rank-100, self-schedule) | owner ne mana kiya |
| **S2, S4, S6** (settings effective-dating) | bade/nazuk, ek saath karne wale |
| **09 RED3** (dues amount edit par cash mit jaana) | owner ne skip kaha |
| **Himanshu 1 Jul / Uma 2 Jul absent** | "jaisa hai waisa rehne do" |
| **A3** | jaan-boojh kar aisa |

---

## 💡 Meri sifarish — kya pehle

Agar aap "sabse zyada faayda, sabse kam khatra" chahte ho, is kram me:

1. **Zip chadhaao** — 9 fixes pehle se ban chuke hain par live nahi (S1/V6 abhi award kha rahe). **Ye zero naya kaam hai.**
2. **P-A (privacy pass)** — 5 findings, chhote fix, aur ye wo cheez hai jo har employee ko chhoti hai (birth year, sick leave, GPS). Kam khatra
3. **P-B + P-E** (guards + live roles) — 6 findings, wahi patterns jo pehle bhi dekhe, ache se samjhe hue
4. **P-D, P-F, P-J** — chhote, seedhe
5. **P-C (effective-dating foundation)** — sabse bada faayda (5 findings + S2/S4 RED), par **sabse nazuk** — akele, poore review ke saath
6. **LOW poonch** — jab sab ho jaaye, ya jab koi page dobara chhue

**Ek line me:** asli kaam ab chhota hai — **18 MEDIUM + kuch RED (deferred)**, teen-chaar root-cause me bandhe hue. Programme ne apna kaam kar diya: bade RED nikal kar fix ho chuke, aur baaki ki asli tasveer ab saaf hai.

---

## Sthiti
- [x] Saare 11 page audit
- [x] 01–07 ki parked lists verify (183 → 0 RED, 18 MED, 138 LOW, 19 already-fixed)
- [x] Root-cause consolidation
- [ ] Owner tay kare: zip? phir kaun se root-cause?
