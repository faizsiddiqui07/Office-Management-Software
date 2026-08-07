# Audit 02 — To-Do / Tasks (2026-08-07)

> 5 agents (lifecycle, security, performance, board-UX, roles/features) + 10 adversarial verifications (9 REAL, 1 REFUTED). 8 medium claims verification queue se overflow hue (neeche ⚠ marked).

## 📊 LIVE DATA (read-only DB snapshot us waqt ka)
- Total tasks **219** | delegated **128** | delegated DONE **90** | forwarded **3** | tagged **40** | requiresApproval **57** | seen-stamped **124/128**
- Points-eligibility: owner-assigned **115**, tag se eligible **2**, **INELIGIBLE 11** (Priyanshi ke 10 + Faiz ke 3 assigned me se)
- taskAssign access: **8 users** | active CEO_PRESIDENT: **3** — Khaan Aamir, Kalpana Saini, **aur "ADMIN. CONTROLLER"** ⚠️

## 🔴 RED BUGS — points integrity / state machine (VERIFIED REAL)

| # | Bug | Kya hota hai | Evidence |
|---|---|---|---|
| R1 | **Self-service penalty wipe** | Assignee apne hi PENDING task pe `status:PENDING` dobara bhej de → `onAssignedTaskUndone` saare drips + −5 delete. Roz karke penalty ~0 rakh sakta hai. Due-date edit se bhi drip history udti hai (rule kehta hai drips survive) | task.service.js:271,300,331; bonus.service.js:516-518,659-662 |
| R2 | **Chain overpayment** | Forwarded parent ka owner apni copy DONE kar de (ya approver approve kar de) jabki neeche leaf PENDING hai → poori chain paid, **kaam kiye bina junior ko +10**. `collectChainCopies` status check hi nahi karta. UI se reachable (Done toggle) | task.service.js:281,308-330,500-511; bonus.service.js:459-513 |
| R3 | **Personal task forward** | Personal to-do forward karo → child delegated ban jata hai: penalties lagti hain, reward kabhi nahi (payout path root pe `!assignedBy` se return), stale −5 permanent | task.service.js:442-474; bonus.service.js:457,459 — *API-only (UI me button nahi)* |
| R4 | **DONE→DONE non-idempotent** | Dobara done → `completedAt` overwrite → on-time award **late penalty me flip**; forwarded parent pe `completedBy` asli doer se badal jata hai | task.service.js:281,308-310 |
| R5 | **Submit ke baad forward** | Submitted parent forward ho jata hai, `submittedAt` clear nahi → ek saath approval queue me + neeche forwarded; approve karne par pending leaf ko payment (permanent, dobara judge nahi hota) | task.service.js:448,461-479 |
| R6 | **deleteTask cascade** | Chain delete karne par **DONE/submitted descendants bhi delete** + unke points claw-back — jabki reassign path (274f965) me yahi jaan-boojh ke preserve kiya gaya tha. Dusre ka completed record mit jata hai | task.service.js:810-824 vs 638-657 |
| R7 | **Approved task reopen** | Assignee approved task khud PENDING kar sakta hai → late penalty delete, approval trail (`approvedBy`) mit jata hai, assigner ko notify bhi nahi. Pre-Aug due dates pe **permanent** (drip floor unhe re-mark nahi karta) | task.service.js:271,308-311; bonus.service.js:516-518,632 |

**REFUTED (fix nahi chahiye):** "Settled chain reopen = award permanently gone" — daily `rescoreAllDoneAssigned` use restore kar deta hai. *Residual narrow issue:* rescore sirf last-45-din ke roots load karta hai, to 45+ din purani chain restore nahi hogi → P-list me.

## 🔒 SECURITY (verified)

- **R2/R7 upar hi security findings bhi hain** (points mint + penalty erase)
- **Eligibility gate self-grantable (REAL):** koi bhi assigner CEO ko tag karke apni chain points-system me daal sakta hai (tag consent-less hai), **aur owner-tier ke paas self-untag ka koi rasta nahi** — sirf assigner/owner collaborators badal sakta hai. *Gate tag-based hona intentional hai; defect = consent + no opt-out.*
- **Rank hierarchy server-side enforce NAHI hoti** ⚠ — `canAssignTo` sirf `taskAssign.mode` dekhta hai; mode ALL wala junior CEO ko bhi assign kar sakta hai. Routes ka comment ise deliberate "purely per-person" kehta hai → **product decision chahiye**, warna rank check add karo
- **Due-date floors sirf frontend pe** ⚠ — API se `dueYMD:'2020-01-01'` chal jata hai (backdated due = guaranteed late penalty pin karna, ya drip-floor se escape)
- `manageUsers` holder khud ko `taskAssign: ALL` de sakta hai (self-grant) ⚠
- `/:id` params validate nahi — malformed id pe 500 (400 hona chahiye); 404-vs-403 se id enumeration
- **VERIFIED CLEAN:** markSeen owner-only, batch per-target ACL, review assigner-only (self-approve impossible), PDF server-side actor-scoped, payloads name-only (koi email/phone leak nahi), eodDigest owner-gated

## ⚡ PERFORMANCE / FUTURE-RISK

| # | Item | Detail |
|---|---|---|
| T1 | **Assigned tab: 2 polls × 20s, limit=10000, staleTime 0** | Full list re-download har 20s (~300-500KB × 2 × 180/hr). Do owners tab khula rakhein = M0 budget ka 20-40%. **Sabse bada naya transfer burner** |
| T2 | **forwardChain N+1 walk** | Har forwarded row pe parent chain sequential `findById` (depth 12), har list call pe + har 20s poll pe + PDF export me |
| T3 | **listTasks 7-9 round trips/call**; `countDocuments` almost always redundant (limit 10000 pe) |
| T4 | **Drip kabhi expire nahi** | Abandoned PENDING tasks hamesha scan+penalise hote hain, **deactivated users ke bhi**; 1 PointEntry doc/task/day forever. `dueYMD` unindexed |
| T5 | **eodDigest saare DONE tasks scan** karta hai (day filter `$addFields` ke baad) — 12 mahine me ~5000 docs har digest call pe |
| T6 | **No virtualization** — History 300-600 rows = 15-30k DOM nodes; search ka raw state (debounced nahi) 5 memos ko har keystroke pe re-run karta hai |
| T7 | **Invalidate storm** — seen-receipt bhi poora `['tasks']` invalidate karta hai → pehli visit = 2× payload |
| T8 | PDF export 10000 docs + chain walk ek Lambda invocation me |
| T9 | Missing indexes (P5 se aage): `submittedAt` (20s-polled queue sort), `dueYMD`, `completedAt` |
| T10 | `reportSeen` callback identity churn — har render pe O(n) filter |

## 🎨 UX GAPS

**Sabse bada:** **Points-eligibility bilkul invisible** (high) — poore task UI me "points" ka ek shabd nahi. Live me **11 tasks silently ineligible** hain; assigner ko lagta hai points mil rahe hain, assignee ko pata hi nahi ki uska task points-system se bahar hai.

Baaki:
- **Grace days UI me kahin nahi** — red "Overdue" grace ke andar bhi dikhta hai; drip-active task same dikhta hai (koi "−1/day" signal nahi)
- **"Due today" ka koi urgency signal nahi** (na badge, na color) + koi "Due today" filter preset nahi
- **Approval queue sirf "Assigned by me" tab ke andar** — koi count badge nahi (Tagged tab pe hai — inconsistent); assigner ka delay = assignee late (approval day hi DONE day hai) par queue me "kab tak approve karo" ka koi hint nahi
- **Submitted circle pe galat tap = silent withdraw** (na confirm, na toast)
- Copy jhoothi: "shows under **Shared with me**" — wo section ab **Tagged tab** hai (3 jagah)
- Assign access revoke hone pe "Assigned by me" tab gayab → pending approvals limbo
- History empty-state hamesha "Nothing completed yet" (search/filter se khali hone pe bhi)
- People chips: koi search nahi, ~30px tap targets (25+ employees pe unusable)
- Overdue ka koi stat card nahi (dropdown me chhupa)
- Detail dialog me "Submitted" + "Awaiting approval" dono amber — redundant
- Folder rows me pending vs awaiting dot same color (duplicated ternary)

## 💡 FEATURE IDEAS (role-wise)

**CEO & President:** approval-queue badge on landing; **batch approve** (57 approval-gated tasks, har ek alag click — late approval = employee late); overdue-by-person folder chips (client-side, zero backend); per-person on-time % insights (data pada hai).

**Delegating seniors:** **one-click Nudge/Remind** button (notify infra ready); "assigned by me" overdue view; forward discoverability (3 forwards in total — infra bhaari, usage ~0 → ya row-level button, ya maan lo ROI kam hai).

**Employees:** **points preview on task** ("+10 if done by Fri" / "−8 ab tak kat chuke" — detail dialog me ek query); "Due today" preset; submit ke baad "kab se pada hai / kiske paas".

**Tagged watchers:** reject/overdue pe bhi notify (abhi sirf tag + complete pe milta hai).

**Maintainers:** 3 stale comments jo "submit day" kehte hain jabki rule approval-day hai (task.service.js:44-46, Task.js:24, task.service.js:283) — agla developer inhe padh ke galat "fix" kar sakta hai.

## ❓ OWNER SE SAWAAL

1. **"ADMIN. CONTROLLER" teesra active CEO_PRESIDENT hai** — iska assign/tag har task ko points-eligible banata hai aur ise EOD digest bhi dikhta hai. Ye intended hai?
2. **Rank hierarchy:** `taskAssign: ALL` wala kisi ko bhi (CEO samet) assign kar sakta hai. Rank check add karein ya "purely per-person" hi rakhein?
3. **Eligibility UI:** warning dikhaye, ya auto-tag owner, ya dono?

## 🔗 CROSS-CONNECTIONS (01-dashboard se)

- **isActive filter** — dashboard me fix hua; yahan `scanOverdueTasks` me bhi missing (deactivated users ke tasks penalise hote rehte hain) ✔ pattern confirmed
- **$nin forwardedFrom** — dashboard P4; yahan source: `listTasks` distinct + eodDigest + badges — ek `wasForwarded` flag teeno ko theek karega
- **Missing indexes** — P5 + T9 milake ek index migration
- **Polling load** — dashboard P6 (EOD) + T1 (assigned tab 2×20s) — app-wide polling budget ka review chahiye
- **Stale comments/docs vs code** — Rules page pe pehle bite kar chuka, yahan 3 aur mile
