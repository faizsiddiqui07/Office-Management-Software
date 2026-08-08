# Audit 04 — Leaves (2026-08-08)

> Process: 5 specialist agents (lifecycle/balance, cross-module, security, performance, UX/roles) ne poora Leaves module padha → **53 raw findings**. Adversarial verification **beech me session-limit se ruk gaya** — sirf **2 findings adversarially verify hue** (dono RED, dono REAL). Ek teesra RED **maine khud directly verify kiya**. Baaki saare findings **UNVERIFIED** hain — inhe abhi bug NA maano; limit reset hone par verify round dobara chalana hai.
>
> **STATUS (2026-08-08): teeno RED (L1, L2, L3) FIXED — owner approved. Commit local, push/zip owner ke kehne par.** Baaki UNVERIFIED findings abhi bhi verify-round ke intezaar me.

## ✅ FIX SUMMARY (2026-08-08)

> **L1 fix:** `decideLeave` post-commit ab har leave-din ke liye `clearAbsencePenalty` call karta hai (backdated leave ka `auto_absent` hat jaata hai). leave.service ab bonus.service import karta hai (no cycle).
> **L2 fix:** naya `reconcileNoLeaveMonth(userId, month)` (bonus.service) — write-or-delete, sirf beete mahine pe. `decideLeave` (approve) + `cancelLeave` dono post-commit har touched past-month ke liye call karte hain. Direction-1 (stale award hata) + Direction-2 (cancel pe wapas) dono cover.
> **L3 fix:** `RequestsQueue` me APPROVED leave ke detail footer me approver ke liye **"Cancel approved leave"** button + confirm dialog (self-cancel + WFH-owner rule frontend pe bhi mirror; backend pehle se enforce karta hai).
> **Verified:** L1+L2 isolated-DB test (10 checks incl. current-month guard + cancel-restores) + L3 website build clean.
>
> **✅ Do RELATED edges bhi FIX ho gaye (2026-08-08, owner-approved "dono edge fix kr do"):**
> **(a) Perfect-attendance (+20) reconcile:** naya `reconcilePerfectMonth(userId, month)` (bonus.service, write-or-delete, past months only, runMonthRollup ki exact perfect logic mirror) — approve pe agar absent din ON_LEAVE ban ke mahina perfect ho jaaye to +20 milta hai; cancel pe absent wapas aaye to +20 hat jaata hai. `decideLeave` + `cancelLeave` dono post-commit call karte hain.
> **(b) Cancel-reverse-absence:** naya `reconcileAbsence(userId, dateYMD)` (bonus.service, scanAbsences ki ek iteration mirror) — approved past leave cancel pe har reverted working-din ka `auto_absent` −N wapas lag jaata hai (holiday/weekend/worked/today+future skip). `cancelLeave` post-commit har range-din pe call karta hai.
> **Verified:** isolated-DB test — approve→+20 awarded + −10 cleared; cancel→+20 removed + −10 re-applied. All pass.

## 🔴 RED — VERIFIED → ✅ FIXED (3)

| # | Bug | Kya hota hai (din-ba-din) | Evidence | Verify |
|---|---|---|---|---|
| L1 ✅ | **Backdated leave approve karo → us din ka absent penalty kabhi nahi hatता — banda do baar bhugtata hai** | (1) Somwar 3 Aug — banda bimaar, ghar pe, koi check-in nahi, request abhi nahi daali. (2) Mangal 4 Aug pehla tick — daily scan "kal" judge karta hai: na attendance row, na APPROVED leave → `auto_absent:<uid>:2026-08-03` −N points likh deta hai. (3) 4 Aug ko banda SICK leave 3 Aug ke liye apply karta hai. (4) 5 Aug approve — 3 Aug ON_LEAVE ban gaya, balance −1. **Nateeja:** sheet kehti ON_LEAVE, balance −1 din, aur rewards ledger me abhi bhi "Absent · 2026-08-03" ka minus — kabhi self-heal nahi hota (scan watermark aage badh chuka). Attendance-edit aur regularization dono `clearAbsencePenalty` call karte hain; leave-approval — jo absence legitimise karne ka sabse aam tarika hai — nahi karta. | leave.service.js:1-18 (koi bonus import nahi), 843-868; bonus.service.js:570-572, 777-791, 1357-1381; attendance.service.js:188-190 + regularization.service.js:172 (jo paths clear karte hain) | ✅ adversarial |
| L2 ✅ | **"Poore mahine koi leave nahi" bonus late-approved / cancelled leave se reconcile nahi hota** | **Direction 1 (bina haq ka award reh jata hai):** (1) banda 28–31 Aug bimaar, request nahi daali. (2) 1 Sep pehla tick — Aug ka rollup chalta hai, koi APPROVED leave nahi mili → +N "No leave taken all month" mil gaya. (3) 2 Sep apply, 3 Sep approve (3 working days charged). Ab August ki approved leave AUR August ka no-leave bonus dono ledger pe hamesha ke liye. **Direction 2 (haq ka award kabhi nahi milta):** August me li leave 3 Sep ko cancel ho jaye (balance refund, ON_LEAVE hata) — mahina ab sach me leave-free hai, par band ho chuka rollup dobara nahi chalta → award chup-chaap gum. | bonus.service.js:800-830 (single-instant count), 1350-1361 (once-per-month watermark), `auto_noleave` sirf likha jaata hai kabhi delete nahi; leave.service.js:721-881 (decideLeave) + 1025-1106 (cancelLeave) — koi reconcile hook nahi | ✅ adversarial |
| L3 ✅ | **Approved leave cancel karne ka UI me koi rasta nahi — jabki backend flow bana hai aur Attendance kehta hai "Leaves page se cancel karo"** | Cancel mutation (`POST /leaves/:id/cancel`) frontend me maujood hai par button sirf **PENDING** request pe dikhta hai (`isPending` gate). APPROVED leave ke detail footer me sirf "Close", RequestsQueue non-pending me sirf "Close", Approvals inbox sirf PENDING dikhata hai. (1) CEO Priya ki agle hafte ki 3-din leave approve karta hai — 3 din kate, 3 ON_LEAVE rows. (2) Plan badla, Priya aayegi. (3) CEO Attendance kholta hai → message "Leaves page se cancel karo" → Leaves → Approved row → sirf "Close". Kahin Cancel nahi. **Ab 3 din permanently kate, ON_LEAVE rows khadi, aur naya A4 guard full-day ON_LEAVE pe check-in bhi block karega** — Priya office aake bhi haazri nahi laga sakti. Sirf workaround: manageUsers se `used` haath se ghatana (attendance se desync) ya curl. | leave-history.jsx:76 (cancelMut hai), 122-127 (sirf `isPending` pe button); requests-queue.jsx non-pending footer = Close; attendance/everyone-tab.jsx:418 ("cancel the leave from the Leaves page first"); leaves.routes.js:25 (backend cancel flow ready) | ✅ maine khud verify kiya (auditor ne "ek bhi button nahi" bola tha — sahi: mutation hai, par APPROVED pe exposed nahi) |

**L1 + L2 ek hi jodi ka double/triple-count bhi ban sakte hain:** ek hi backdated-sick-month me banda ek saath (a) auto_absent penalty, (b) no-leave bonus jo nahi milna chahiye tha, aur (c) charged leave — teeno ledger pe. Ye wahi "state change pe points reconcile nahi hote" pattern hai jo To-Do aur Attendance me mila (ab `reconcileLatePenalty`/`clearAbsencePenalty` helpers hain — inhe leave lifecycle me hook karna hai).

## ⚠️ UNVERIFIED — inhe verify round me confirm karna hai (session-limit se chhoot gaye)

> Ye finders ne raise kiye par adversarial verify NAHI hue. Plausible lagte hain, par owner ko present karne/fix karne se pehle verify chahiye.

### 🔒 Security (UNVERIFIED)
- **`POST /leaves/record` pe koi rank guard nahi + `replaceAttendance` asli check-ins hamesha ke liye uda deta hai** — sabse junior `approveLeave` holder kisi Director ke liye leave record kar sakta hai; range ki SAARI attendance rows (check-in times, worked/overtime samet, weekend-worked bhi) deleteMany se udti hain, sirf working-days pe ON_LEAVE banta hai; cancel karne par bhi original check-ins wapas nahi aate (irreversible). setLeaveBalance me rank guard hai, record me nahi. — leave.service.js:528-591, 798-803; leaves.routes.js:23. **[MEDIUM, verify pending]**
- **applyLeave pe date ki koi lower/upper bound nahi** — API se kisi bhi future/past fiscal year ki leave daali ja sakti hai; `getOrCreateBalance` us saal ka LeaveBalance row **aaj ke quota pe freeze** karke bana deta hai (delete karne par bhi row rehta hai). Yehi "pre-seed a future year's balance" attack jo ledger-read me band hua tha, apply me khula hai. Backdating bhi khula (app-live se pehle ON_LEAVE rows). — leave.service.js:348-353, 385-394, 457-507. **[MEDIUM, verify pending]**
- **GET balance endpoints ab bhi write-path pe** — `GET /leaves/balance` aur `GET /users/:id/leave-balance` dono `getOrCreateBalance` (write) use karte hain (dashboard wala read-only fix yahan apply nahi hua). (a) non-existent userId pe orphan LeaveBalance row ban sakta hai; (b) 1 April ko koi profile khole to us employee ka naya-saal row purane quota pe freeze. — leaves.controller.js:77-85; users.controller.js:152-159. **[MEDIUM, verify pending]**
- **Malformed ObjectId har jagah 500 (400 nahi)** — `:id` aur `?userId` kahin validate nahi; CastError → 500 INTERNAL, non-prod me raw message leak. dues.service.js ka `assertId` pattern yahan apply karna hai. **[LOW, verify pending]**
- **GET /leaves/balance bina viewEveryone ke ?userId maange to chup-chaap APNA balance de deta hai (403 nahi)** — leak nahi (fail-closed-to-self), par contract jhoota; ledger endpoint yahan saaf 403 deta hai. **[LOW, verify pending]**
- **`POST /leaves/record` ka reason unbounded** — apply/update pe 500-char cap hai, record pe nahi; 12mb express limit tak blob store ho sakta hai, phir har queue-open pe transfer. **[LOW, verify pending]**
- **Deactivated user pe koi guard nahi** — exit ho chuke employee ki pending leave approve ho jati hai (ON_LEAVE rows + balance charge). **[LOW, verify pending]**

### ⚡ Performance / Future-risk (UNVERIFIED)
- **LeaveRequest pe `{status, endYMD}` compound index MISSING** (dashboard audit ka flag confirm) — sabse garam query shape `{status:'APPROVED', startYMD<=, endYMD>=}` **7 jagah** chalti hai (coverage, clash-check, WFH declare, dashboard ×3/load, report, bonus rollups). Sirf `{status}` index se har APPROVED request scan hota hai. Fix: `index({status:1, endYMD:1})` + `{appliedAt:-1}` (queue sort). **[PERF]**
- **Approval queue: default 'ALL' + limit 200 + full populate** — 10 rows dikhane ke liye ~120-180KB; har decision ke baad poora `['leaves']` invalidate → poora re-download (8 decisions ≈ 1.2MB). Fix: populate `name employeeId` tak, invalidation `['leaves','queue']+['leaves','balance']` tak. **[PERF]**
- **listLeaves N+1**: har WFH-requester ke liye alag `wfhUsage` countDocuments per list GET — ek aggregate se ho sakta hai. **[PERF]**
- **markAttendanceOnLeave: per-day findOne+save transaction ke andar** — 18-din leave ≈ 30-40 sequential round-trips transaction hold karke (write-conflict window badhta hai); range prefetch + bulkWrite se theek. declareOfficeWideWFH per-user 2N trips. **[PERF]**

### 🔗 Cross-module edge bugs (UNVERIFIED)
- **Approval ke BAAD holiday declare ho leave range ke andar** — din charged hi rehta hai; recompute sirf approval-time pe hota hai. India me lunar festival dates late declare hote hain → realistic. **[MEDIUM, verify pending]**
- **recordLeaveForUser LATE/overtime rows uda deta hai par auto_late penalty + auto_ot points wahin** — pichhle mahine ki backdated recording pe band mahina inflated reh jata hai. **[MEDIUM, verify pending]**
- **Race: leave approve hote waqt check-in** — checkIn ka guard-check aur upsert ke beech window hai; ON_LEAVE row PRESENT se overwrite ho sakti hai (balance charged reh jata hai). **[MEDIUM, verify pending]**
- **WFH cap recheck race-safe nahi** — do simultaneous owner approvals 2-din cap tod sakte hain (WFH me shared-doc contention nahi). **[LOW]**
- **perfectAttendanceMonth poore mahine leave wale ko bhi milta hai** — ON_LEAVE na absent na late gina jata; policy sawaal (owner confirm kare). **[LOW]**
- **Personal WFH cancel × same-day office-wide WFH** — banda office-declared WFH din pe absent penalty kha sakta hai. **[LOW]**
- **Leadership balance override integer-only** — system khud 0.5 (joiner 7.5, half-day used 2.5) banata hai par override `.int()` forced → half-day truth type nahi kar sakte. **[LOW]**

### 🎨 UX gaps (UNVERIFIED)
- **BalanceCards loading/error pe hardcoded "18 / 18, 0 used"** dikhata hai (na skeleton na error) — 12 din use kiye bande ko bhi cold-start pe "Remaining 18/18" dikh sakta hai. (dues-admin me ye fix ho chuka, ye card chhoot gaya). **[MEDIUM]**
- **RequestsQueue error pe "Nothing in the queue." dikhata hai** — approver ko jhoothi khali queue (LeaveHistory ko error-state mila tha, queue reh gaya). **[MEDIUM]**
- **WFH rows har approveLeave holder ko Approve/Reject dikhate hain, par decide sirf owner-tier** — non-owner Approve dabaye = 403 toast; sidebar badge bhi jhoot bolta hai. **[MEDIUM]**
- **Approvals inbox (jahan notification le jaati hai) info-poor** — na requester balance na coverage warning; `requesterWfhRemaining` dead code. **[MEDIUM]**
- **INSUFFICIENT_BALANCE message "Apply as Unpaid (LOP) instead" bolta hai** — jabki UNPAID type retire ho chuka, UI me option hi nahi (3 jagah). **[UX]**
- **halfDayPart (Morning/Afternoon) collect+store hota hai par kahin dikhta nahi** — approver andha decide karta hai; data payload me hai. **[UX]**
- **Reject-reason rules dono surfaces pe alag** — Approvals page reason maangta hai, Leaves queue bina reason reject kar deta hai. **[UX]**
- **Apply dialog deduction preview remaining se compare nahi karta** — "3 din katenge" dikhata hai jab remaining 1 hai; balance usi page cache me hai. **[UX]**
- **Pending requests balance me invisible** — "Remaining 12" jab 4 din approval me atke hain. **[UX]**
- **Date pickers off-days/holidays gray-out nahi karte** — data client pe already hai. **[UX]**
- **"Applied on" UTC-slice se** — 5:30 IST se pehle ki application pichhla din dikhati hai; decidedAt kahin dikhta nahi. **[LOW]**
- **WFH row "Days: 0" dikhata hai + WFH cancel confirm copy leave-specific hai**. **[LOW]**
- **Leaves queue se decide karne pe sidebar Approvals badge stale**. **[LOW]**

## 💡 FEATURE IDEAS (role-wise — consolidated phase)

**CEO & President:**
- **Team leave calendar (month-grid: kaun kab off hai)** — `listLeaves` from/to/status=APPROVED already support karta hai; poora zero-backend view. Coverage-clash approve karne se PEHLE dikhega. Monday-morning "is hafte kaun hai" ka jawab ek nazar me.
- Approvals inbox me requester balance + coverage warning (abhi Leaves queue me hai, Approvals me nahi).

**Dual-role approvers (Manager/Director jo apply bhi karte hain approve bhi):**
- Leaves page ke "Requests" tab pe pending-count badge (`/approvals/count` already hai).

**Employees:**
- Apne ledger ka **fiscal-year picker** — backend `?year=` already leta hai; April me pichhle saal ka record nikalna (tax/HR) abhi namumkin.
- Apply karte waqt "us din aur kaun off hai" anonymized hint (approver ka reject-cycle bachega).
- Balance card pe "N din approval me pending" line (data same page pe).

**Approver (coverage decision):**
- Coverage list me naam ke saath **department** (teeno off log EK team ke hain — ye asli decision-breaker; `populate('name department')` one-word change).

## 🔗 CROSS-CONNECTIONS (00-index me update ho gaya)
- **State change pe points reconcile nahi hote** (L1, L2) — To-Do/Attendance wali hi root class. Ab shared helpers hain; leave decide/cancel me hook karne hain. **Rewards audit me ledger-vs-reality consistency deep-check.**
- **Write-on-GET** (GET balance) — dashboard me fix hua tha, yahan reh gaya. Settings/Rules me bhi dekhna.
- **Missing LeaveRequest indexes** — dashboard P5 + yahan; ek migration me.
- **PII in list payloads** — queue full docs; Team/Reports/Users me bhi.
- **`:id` unvalidated → 500** — app-wide param-validation middleware consolidated me.
- **Frontend-only validation** — apply dates sirf UI pe bound; API khula.
- **Leaves ↔ Attendance boundary** — A4 ne tight kiya; L3 (no cancel UI) usi boundary ka dusra sira.
