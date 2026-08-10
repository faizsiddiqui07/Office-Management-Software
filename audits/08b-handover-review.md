# Review — delete-handover (audit 08 "D"), 10 Aug 2026

> 4 reviewers (points / delete-path / frontend / edges) + adversarial verification of every finding.
> **27 confirmed, 1 refuted.** Dedupe ke baad **6 RED + 7 MEDIUM + 1 LOW**.
>
> Ye review MERE APNE fix par tha (commit `1d39686`, un-pushed). Isne mere hi kaam me
> 4 RED nikale, aur 2 aur RED jo **pehle se prod me hain**.

---

## 1. [RED] Naming a non-owner-tier heir makes completion DELETE the doer's existing point entries

**Kahan:** `backend/src/services/user.service.js`:366 · reviewer: points · verdict: CONFIRMED

**Claim:** The handover sets `assignedBy = heir` but no award path ever consults `assignerDeleted` — only `pruneOrphanTaskEntries` does (bonus.service.js:1709). `onAssignedTaskDone` re-derives the owner-tier gate from the NEW assigner (bonus.service.js:631-634) and, when it fails, runs `PointEntry.deleteMany({ taskRef: {$in: copies}, source: {$in:['auto_task','auto_forward']} })`. So handing a departed CEO/President's open work to an ordinary manager hard-deletes points belonging to the ASSIGNEE the moment the task is finished — the exact thing `assignerDeleted` was added to prevent, and strictly worse than the 'Nobody' option the dialog warns about (with `assignedBy = null`, onAssignedTaskDone returns at bonus.service.js:619 and the entries survive).

**Scenario:** Rules: assignedTaskLate 5, assignedTaskOverdueDaily 1, graceDays 1. President P (owner tier) assigns 'Client audit pack' to employee E, due 2026-08-02. E is late, so E accrues the -5 mark filed 2026-08-04 plus drips for 08-05…08-10 (-6) = -11 in August. On 2026-08-10 the CEO deletes P and names manager N (role MANAGER, taskAssign ALL) as heir: assignedBy = N, assignerDeleted = true. From that tick scanOverdueTasks (bonus.service.js:1038) no longer sees the task as eligible, so the drip silently stops. On 2026-08-12 E marks it done: onAssignedTaskDone -> taskEligible false (N not in ownerIds, no owner-tier collaborator) -> deleteMany wipes the -5 and all six -1 drips. E's August total jumps by +11 and E carries no penalty at all for delivering ten days late. Had leadership picked 'Nobody', the -11 would have stayed exactly as the dialog promises.

**Verifier:** Finding sahi hai — maine har link code me verify kiya, aur refute karne ki koshish fail hui.

**1. Handover kya likhta hai** — `backend/src/services/user.service.js:364-367`: `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Yaani task ab bhi ek assigner rakhta hai (heir), aur flag bhi.

**2. `assignerDeleted` ko sirf ek jagah padha jaata hai** — poore `backend/src` par grep: `Task.js:14` (schema), `user.service.js` (sirf writes), aur `bonus.service.js:1691, 1692, 1709`. 1709 = `pruneOrphanTaskEntries`. Award path (`onAssignedTaskDone`, `scanOverdueTasks`, `rebuildOverdueForTask`) me ek bhi reference nahi. Claim ka core sach hai.

**3. Completion par destruction** — `bonus.service.js:619` `if (!b.enabled || !task.assignedBy) return;` → heir named hai to `assignedBy` truthy, early return nahi hota. Phir `631-634`:
```js
const ownerIds = await ownerTierIds();
if (!copies.some((c) => taskEligible(c, ownerIds))) {
  await PointEntry.deleteMany({ taskRef: { $in: copies.map((c) => c._id) }, source: { $in: ['auto_task', 'auto_forward'] } });
  return;
}
```
`taskEligible` (555-560) sirf `assignedBy ∈ ownerIds` ya owner-tier collaborator dekhta hai. Heir MANAGER hai → false → **hard delete**. Safety valve `if (!ownerIds.size) return true` (557) yahan nahi bachata: deleting actor khud owner tier ka hai (rank guard ke wajah se), to deletion ke baad bhi `ownerIds.size >= 1`.

**4. Kya delete hota hai** — `-5` mark `scanOverdueTasks:1054` se aata hai (`source: 'auto_task'`, key `auto_task:<id>`), drips `1066` se (`source: 'auto_task'`, key `auto_overdue:<id>:<ymd>`). Dono `deleteMany` ke `source` filter me aate hain. Sab wipe. Kuch bhi inhe wapas nahi banata (`scanOverdueTasks` sirf "today" likhta hai, aur ab wo task 1038 par skip ho raha hai) → permanent loss.

**5. 'Nobody' waqai bachata hai (asymmetry real hai)** — `user.service.js:392` `assignedBy: null` → `onAssignedTaskDone:619` early return, koi delete nahi. Aur `pruneOrphanTaskEntries:1691` ka `{ assignerDeleted: true }` arm task ko lookup me rakhta hai, `1709` `t.assignerDeleted ? true : ...` eligible=true deta hai, `1724` `keep = t.status === 'DONE' || e.points < 0` → -11 zinda. To heir naam dena **strictly worse** hai — bilkul jaisa claim kehta hai.

**6. Scenario ke numbers verify** — due `2026-08-02`, grace 1 → `duePlus = 08-03`; `overdueDayFor = due + grace + 1 = 08-04` (1013-1016) → -5 August me file. Drip condition (1064): `dueYMD >= DRIP_FLOOR '2026-08-01'` ✔ aur `today > addDays(duePlus,1) = 08-04` → 08-05…08-10 = 6 × -1. Total **-11 August me**, sab 08-12 ki completion par gayab. E ka August total +11 upar chala jaata hai, 10 din late delivery par zero penalty.

**7. Setup legal hai** — `permissions.js:127-130` `canAssignRole` → `tRank >= cRank`, to ek CEO_PRESIDENT doosre CEO_PRESIDENT (President P) ko delete kar sakta hai. Heir validation (`user.service.js:355`) sirf `canAssignAny` chalata hai, jo `task.service.js:89-92` me **sirf `taskAssign.mode` dekhta hai — role tier bilkul nahi**. To `MANAGER` + `taskAssign ALL` ek valid heir hai. `ownerTierIds` (527-533) `isActive` filter nahi lagata, isliye P ke deactivate hone tak task eligible tha; sirf deletion hi gate girata hai.

Ye design intent #1 (dusron ke point entries kabhi destroy na hoN) aur #2 (owner-tier faisla dobara derive na ho) — dono ka seedha ulta hai, aur wahi cheez karta hai jiske liye `assignerDeleted` add kiya gaya tha.

**Correction:** Core sahi hai; paanch cheezeN theek/aage badhani chahiye:

1. **Drip ki ginti timing par depend karti hai.** Agar 10 Aug ka daily scan handover se pehle nahi chala, to 08-10 ka drip likha hi nahi gaya → -10 (5 drips), -11 nahi. Mechanism aur severity same.

2. **Sirf penalties nahi — positive award bhi marta hai.** 633-634 delete karke `return` karta hai, koi award likhta hi nahi. Handover ke baad agar E task **on time** karta to `assignedTaskOnTime` ke points bhi kabhi nahi milte. Intent #2 dono direction me toota hai, sirf "penalty wipe" nahi.

3. **Doosra wipe-route hai, aur wo fix ko bhi tod sakta hai.** `rescoreAllDoneAssigned` (1617-1638) roz last-45-din ke DONE tasks par `onAssignedTaskDone` chalata hai, aur `catchUpHistory` (1428-1433) bhi. Dono ke projections — `1627`, `1656`, `1428` — me `assignerDeleted` **nahi** hai (`collectChainCopies:591` me bhi nahi). Yaani agar fix `task.assignerDeleted` padhta hai par ye projections update nahi hoti, to flag `undefined` aayega aur agli daily tick par entries dobara wipe ho jayengi.

4. **Same missing check do aur jagah, par wahan destructive nahi.** `scanOverdueTasks:1038` sirf `continue` karta hai (drip chup-chaap ruk jaata hai — misleading, data-loss nahi), aur `rebuildOverdueForTask:728` ka `return` `731` ke `deleteMany` se **pehle** hai, to wo delete nahi karta — lekin iska matlab handover ke baad due-date correction par history kabhi rebuild nahi hogi.

5. **Dialog copy ulta wada karti hai.** `website/components/users/delete-user-dialog.jsx:157-166` (Nobody) explicitly kehti hai "Points already earned on them are kept", jabki heir branch `168-171` sirf "Finished work keeps its original history" kehti hai — points wipe ka koi zikr nahi. UI leadership ko exactly us option ki taraf push karti hai jo zyada destructive hai.

**Suggested fix:** Sabse chhota sahi fix: award path ko `pruneOrphanTaskEntries:1709` wali hi decision use karwao.

`backend/src/services/bonus.service.js` me ek helper:
```js
/** Assigner gone => award-time gate decision stands; re-deriving it would wipe earned points. */
function gateEligible(task, copies, ownerIds) {
  return task.assignerDeleted ? true : copies.some((c) => taskEligible(c, ownerIds));
}
```
`onAssignedTaskDone` 631-634 ko badlo:
```js
const ownerIds = await ownerTierIds();
if (!gateEligible(task, copies, ownerIds)) { ...deleteMany...; return; }
```
Iske saath **zaruri**: `assignerDeleted` ko in projections me add karo, warna daily rescore flag ko `undefined` padh kar wapas wipe karega — `bonus.service.js:1627` (rescoreAllDoneAssigned), `1656` (rescoreAssignedTasks), `1428` (catchUpHistory), aur hygiene ke liye `591` (collectChainCopies).

Consistency ke liye (intent #2 ke mutabik "faisla khada rehta hai"): `scanOverdueTasks:1038` aur `rebuildOverdueForTask:728` par bhi wahi `assignerDeleted ? true : chainEligible(...)` shortcut lagao, taaki handover ke baad drip chalta rahe aur due-date correction history rebuild kar sake.

Aur `website/components/users/delete-user-dialog.jsx:168-171` ki heir-branch copy me Nobody wali guarantee dohrao ("Points already earned stay as they are") — abhi wo chup hai aur usse ulta impression banta hai.

---

## 2. [RED] Handing tasks to an owner-tier heir back-dates new penalties into already-closed months

**Kahan:** `backend/src/services/user.service.js`:365 · reviewer: points · verdict: CONFIRMED

**Claim:** The same missing `assignerDeleted` check runs in the other direction. A task assigned by a NON-owner-tier user was fully outside the points system (bonus.service.js:555-560 taskEligible). Re-homing it to an owner-tier heir (the CEO is both the likeliest deleter and the natural fallback) makes `taskEligible` true, and `scanOverdueTasks` then writes the one-time overdue mark filed under `overdueDayFor(dueYMD, grace)` — a PAST day, in a PAST month (bonus.service.js:1051-1054). `carryInFor` (bonus.service.js:92-106) recomputes the compounding deficit from go-live on every read, so a new negative in a closed month rewrites that person's net for every later month, the leaderboard, the monthly report (periodPoints) and the rupee payout.

**Scenario:** Manager M (role MANAGER) assigned 'Vendor GST reconciliation' to E on 2026-06-10, due 2026-06-20, no owner-tier collaborator. It scored nothing for two months. On 2026-08-10 the CEO deletes M and names themself heir. The next EventBridge tick runs scanOverdueTasks: the task now matches the query (assignedBy != null, PENDING, dueYMD set), chainEligible is true because assignedBy is in ownerIds, and no prior entry exists, so awardOnce writes -5 with month '2026-06', earnedYMD '2026-06-22'. E's closed June total drops 5; if June was +2 it becomes -3, which now carries into July and August. The damage compounds if the heir later corrects the due date: updateTask (task.service.js:799) -> onAssignedTaskUndone -> rebuildOverdueForTask backfills a drip for EVERY day from due+grace+2 to today, so a due date moved to 2026-08-05 on 2026-09-10 writes 34 daily -1 rows covering weeks when the task was outside the points system entirely.

**Verifier:** CONFIRMED — mechanism paper par poori tarah reproduce ho gaya, sirf scenario ke do-teen numbers galat hain (neeche `correction` mein).

Maine refute karne ki poori koshish ki. Har gate check kiya, koi bhi ise nahi rokta:

1. Handover ke baad `assignedBy` dobara populate ho jaata hai — user.service.js:364-367 `{ $set: { assignedBy: heir._id, assignerDeleted: true } }`. Yahi ek line pehle wali suraksha tod deti hai.

2. Pehle (commit d0cc333) delete `assignedBy: null` set karta tha (user.service.js:392), aur teenon scoring paths usi null par bail karte the:
   - scanOverdueTasks query: `assignedBy: { $ne: null }` (bonus.service.js:1030)
   - rebuildOverdueForTask: `if (!t || !t.assignedBy || ...) return;` (bonus.service.js:726)
   - onAssignedTaskDone: `if (!b.enabled || !task.assignedBy) return;` (bonus.service.js:619)
   d0cc333 ka commit message khud yeh promise karta hai: "the other scans still filter on a live assigner, so such a task earns no new points and accrues no new penalties either." Handover woh promise chupchaap tod deta hai.

3. `assignerDeleted` ko poore codebase mein SIRF EK jagah honour kiya jaata hai — pruneOrphanTaskEntries (bonus.service.js:1691 aur 1709 `t.assignerDeleted ? true : await chainEligible(...)`). scanOverdueTasks us field ko `.select()` mein project tak nahi karta (line 1030), rebuildOverdueForTask bhi nahi (line 725). Grep se confirm: assignerDeleted sirf Task.js:14, user.service.js:361/366/392, bonus.service.js:1691/1692/1709 mein hai. Yani design intent #2 ("must NOT be re-derived") sirf prune path par lagoo hai, award path par nahi.

4. Eligibility flip real hai: taskEligible (bonus.service.js:555-560) `ownerIds.has(String(task.assignedBy))` par true deta hai. Non-owner-tier MANAGER M ne assign kiya tha aur koi owner-tier collaborator nahi tha → task points system se poori tarah bahar tha (koi PointEntry hi nahi bana). Heir CEO_PRESIDENT hai → ownerRoleKeys() (lib/roles.js:136-140, min-rank tier) mein aata hai → chainEligible ab true.

5. scanOverdueTasks ka duplicate-guard bhi nahi bachata: line 1045 `PointEntry.findOne({ taskRef, source: 'auto_task', dedupeKey: { $not: /^auto_overdue:/ } })` — koi entry hai hi nahi (task kabhi eligible nahi tha), isliye `marked` null, aur line 1054 awardOnce chal jaata hai, `month: overdueDay.slice(0,7)` — ek PAST month.

6. Past month "frozen" nahi hai — yeh sabse important confirmation hai. runMonthRollup (bonus.service.js:1187-1243) sirf awards likhta hai, koi month-total snapshot store nahi karta. carryInFor (92-106) har read par PointEntry se live aggregate karta hai (`$match: { month: { $gte: goLive, $lt: targetMonth } }`) aur `carry = Math.min(0, (byMonth.get(ym) || 0) + carry)` se compound karta hai. Isliye ek back-dated negative genuinely har baad wale month ka net, leaderboard aur payout badal deta hai.

7. Heir bilkul owner-tier ho sakta hai: deleteUser sirf `reassignTasksTo === uid` block karta hai (line 346), actor khud ko naam kar sakta hai. Dialog ka candidate filter (delete-user-dialog.jsx:57-62) sirf `isActive` + `taskAssign.mode !== NONE` dekhta hai — CEO list mein sabse upar aane wala natural choice hai. canAssignAny (task.service.js:89-92) CEO ke ALL mode par true.

8. Compounding wala doosra hissa bhi reachable hai: task.service.js:792-799 — due-date edit par `if (dueChanged && mm.assignedBy)` (handover ne yahi field wapas bhara hai) → PENDING copy par onAssignedTaskUndone → bonus.service.js:701 → rebuildOverdueForTask, jiske dono gates (726 assignedBy, 728 chainEligible) ab pass ho jaate hain, aur 749-752 ka loop `addDays(duePlus, 2)` se `today` tak har din ek row likhta hai. Arithmetic bhi sahi hai: due 2026-08-05, grace 1 → duePlus 08-06, pehla drip 08-08, 09-10 tak = 34 rows.

Net: E (jisne kuch galat nahi kiya, aur jiska assigner ab exist hi nahi karta) ke closed month mein naya penalty ghus jaata hai, aur woh carry-in ke through aage ke har month mein compound hota hai. Yeh design intent #1 aur #2 dono ka seedha violation hai.

**Correction:** Core mechanism sahi hai, teen detail correct karni hongi:

1. Month '2026-06' / earnedYMD '2026-06-22' GALAT hai. overdueDayFor (bonus.service.js:1013-1016) filed day ko go-live tak aage clamp karta hai: `return d < APP_LIVE_YMD ? APP_LIVE_YMD : d`, aur APP_LIVE_YMD = '2026-07-01' (backend/src/lib/appLive.js:13). Due 2026-06-20 + grace 1 → 2026-06-22, jo clamp hokar 2026-07-01 ban jaata hai → month '2026-07'. Aur carryInFor line 94 `targetMonth <= goLive` par 0 return karta hai, isliye June mein kuch land bhi jaata to carry hi na hota. Damage phir bhi real hai (10 Aug ko July ek closed month hai, aur loop line 102 goLive='2026-07' se shuru hokar August mein carry karta hai) — bas scenario ko go-live ke baad ki due date chahiye. Cleaner repro: M ne 2026-07-10 due wala task diya, grace 1 → duePlus 07-11, mark 2026-07-12, month '2026-07', bilkul unclamped.

2. Daily scan se back-date sirf EK entry aati hai, stream nahi. Drip (bonus.service.js:1064-1066) hamesha `today` ke under file hota hai aur `t.dueYMD >= DRIP_FLOOR_YMD` ('2026-08-01') se gated hai — July-due task par drip chalta hi nahi. Yani scanOverdueTasks ka back-dated nuksan = ek `auto_task:<id>` mark (-assignedTaskLate). Multi-day back-fill sirf rebuildOverdueForTask (749-752) se aata hai, jaisa finding ke doosre paragraph mein likha hai — lekin woh conditional hai: heir ko due date edit karna padega. "Damage compounds" ko conditional kehna chahiye.

3. Root cause ko "user.service.js:365 par missing assignerDeleted check" kehna thoda misleading hai. Delete-side line theek hai (flag set ho raha hai, intent #2 ke mutabik). Asli bug consume-side par hai: `assignerDeleted` sirf pruneOrphanTaskEntries (bonus.service.js:1691, 1709) padhta hai; scanOverdueTasks (1030, select mein field hi nahi), rebuildOverdueForTask (725-728) aur onAssignedTaskDone (619, 631-635) teeno abhi bhi live `assignedBy` se eligibility re-derive karte hain. Handover ne inn teeno ko dobara khol diya.

4. Ek aur cheez jo finding mein nahi hai par saath hi jaati hai: delete-user-dialog.jsx ka "Nobody" branch (lines 157-166) explicitly promise karta hai "no new ones are awarded and no further overdue penalties build up" — aur woh branch sach hai. Handover branch (167-172) sirf itna kehta hai ki finished work apni history rakhega; user ko kahin nahi bataya jaata ki open tasks ab owner-tier heir ke against score karna shuru kar sakte hain.

**Suggested fix:** Sabse chhota sahi fix: teenon award paths par `assignerDeleted` ko wahi izzat do jo prune deta hai — yani "frozen: current assigner se eligibility mat nikalo, naya auto entry mat likho". Yeh exactly pre-handover behaviour reproduce karta hai (jo `assignedBy: null` se apne aap mil raha tha), isliye kisi bhi direction mein naya risk nahi:

1. backend/src/services/bonus.service.js:1030 — scanOverdueTasks ki query mein `assignerDeleted: { $ne: true }` add karo.
2. backend/src/services/bonus.service.js:725-728 — rebuildOverdueForTask ke `.select(...)` mein `assignerDeleted` project karo aur `if (t.assignerDeleted) return;` line 726 ke saath add karo.
3. backend/src/services/bonus.service.js:616-635 — onAssignedTaskDone mein root copy par same bail (`if (task.assignerDeleted) return;`), aur field ko har us jagah project karo jahan se tasks isme aate hain: collectChainCopies (591), rescoreAllDoneAssigned (1627), rescoreAssignedTasks (1656).
4. website/components/users/delete-user-dialog.jsx:167-172 — handover branch mein wahi baat likho jo Nobody branch likhta hai: handed-over tasks par pehle ke points bane rahenge, par naye points/penalties nahi banenge.

Behtar (thoda zyada kaam, dono directions theek se handle karta hai): handover ke waqt eligibility ka faisla snapshot kar lo — user.service.js mein updateMany se pehle har matching task ka `chainEligible` nikaal kar `scoringEligible: true/false` store karo — aur taskEligible/chainEligible ko `assignerDeleted === true` hone par usi stored value ko padhne do. Isse owner-tier ke diye hue task heir ke baad bhi normally score karte rahenge, non-owner-tier wale bahar hi rahenge, aur heir ka tier kabhi consult hi nahi hoga — jo intent #2 ka literal matlab hai. Simple freeze (option 1-3) mein trade-off yeh hai ki ek genuinely eligible owner-tier task handover ke baad chup ho jaayega; woh pre-handover se bura nahi hai, par ideal bhi nahi.

Dono soorat mein: fix ke saath ek isolated-DB test chahiye jo pehle failure prove kare — non-owner-tier assigner + go-live ke baad ki past due date + owner-tier heir → handover ke baad scanOverdueTasks chalao aur assert karo ki us past month mein koi nayi PointEntry nahi bani.

---

## 3. [RED] Forwarded child copies are re-homed while their parent is deleted in the same call — penalties attach to a task that can never be rewarded

**Kahan:** `backend/src/services/user.service.js`:365 · reviewer: points · verdict: CONFIRMED

**Claim:** The handover filter has no `forwardedFrom: null` clause, so a copy the departing user had FORWARDED down (assignedBy = departing user, status PENDING, owner = junior) is re-homed to the heir — while `Task.deleteMany({ owner: uid })` (user.service.js:378) deletes the departing user's own copy, which is that child's `forwardedFrom` parent. The child is left pointing at a dead parent: `onAssignedTaskDone` returns immediately for any copy with `forwardedFrom` (bonus.service.js:621), `rebuildOverdueForTask` returns too (bonus.service.js:726), and `settleParent` (task.service.js:560-561) finds no parent so nothing above ever closes. But `scanOverdueTasks` DOES include it (it is not in forwardedParentIds), and with an owner-tier heir taskEligible passes on the first check — so the junior can only lose points on it, never gain. Before this change the copy got `assignedBy = null` and was excluded from the scan entirely, so the penalty exposure is new.

**Scenario:** CEO assigns 'Prepare Q2 audit file' to manager M, due 2026-08-05; M forwards it to junior J. On 2026-08-08 the CEO deletes M and names themself heir. M's own copy is deleted; J's copy becomes assignedBy = CEO, assignerDeleted = true, forwardedFrom = a task id that no longer exists. From the next tick J is charged the -5 mark back-dated to 2026-08-07 plus -1 for every day. J delivers on 2026-08-20: setStatus finds no open child so it closes, onAssignedTaskDone returns at the `forwardedFrom` guard, settleParent finds nothing. J ends up -5 -13 = -18 for work that was delivered, receives no completion reward ever, and the entries are kept forever (prune keeps a DONE task's rows).

**Verifier:** I tried to refute this five ways and every mechanism in the chain reproduces on paper.

1. The child IS caught by the handover. `forwardTask` sets the child's `assignedBy = actor._id` (task.service.js:527), `owner = target` (:526), `forwardedFrom = parent._id` (:528), `status: 'PENDING'` (:531), and inherits `dueYMD: parent.dueYMD` (:525). So M's forwarded child matches the handover filter `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }` exactly (user.service.js:365) — there is no `forwardedFrom: null` clause. Confirmed.

2. The parent IS destroyed in the same call. `Task.deleteMany({ owner: uid })` (user.service.js:378) removes M's own copy, which is the child's `forwardedFrom` target. deleteUser has no cascade — I grepped: `forwardedFrom` appears nowhere in user.service.js, users.controller.js, or delete-user-dialog.jsx. This is doubly damning because the codebase already knows this exact failure: `deleteTask` collects `collectForwardDescendants` before deleting (task.service.js:872-886) and the reassign path does the same with the comment "someone they had passed the work down to kept a copy pointing at a parent that no longer existed: finishing it settled nothing" (task.service.js:691-715). deleteUser bypasses both by hitting the collection directly.

3. Reward path is dead. `onAssignedTaskDone` returns at `if (task.forwardedFrom) return;` (bonus.service.js:621). `settleParent` does `Task.findById(childTask.forwardedFrom)` → null → `if (!parent || ...) return` (task.service.js:560-561). And I checked every other award path: `rescoreAllDoneAssigned` filters `forwardedFrom: null` (bonus.service.js:1626), `backfillMonth` filters `forwardedFrom: null` (:1428), `rescoreAssignedTasks` only loads chain ROOTS (:1655). Nothing can ever pay this copy. `rebuildOverdueForTask` also bails at `|| t.forwardedFrom` (:726), so it can't even be re-priced.

4. Penalty path is alive. `scanOverdueTasks` selects `{ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $nin: ['', null] }, _id: { $nin: forwardedParentIds } }` (bonus.service.js:1030). `forwardedParentIds` contains the DEAD parent's id, not the child's (nothing was forwarded off J), so the child is in the scan. `chainEligible` → `taskEligible` sees `assignedBy` = the owner-tier heir and returns true on the first check (:558). Mark + daily drip both fire.

5. Entries are kept forever. In `pruneOrphanTaskEntries` the task is found via the `assignedBy: { $ne: null }` arm (:1691), `assignerDeleted` short-circuits eligibility to true (:1709), `hasScorableDeadline` passes on dueYMD, and `keep = t && (t.status === 'DONE' || e.points < 0)` (:1724) keeps everything once J closes it.

Scenario re-run with the real defaults (grace = 1, bonus.service.js:120): due 2026-08-05 → `overdueDayFor` = addDays(05, 1+1) = 2026-08-07, exactly as claimed. On 08-08 the CEO deletes M with themself as heir; M's copy vanishes, J's copy now reads assignedBy = CEO, assignerDeleted = true, forwardedFrom = a dead id. Each daily tick from 08-08 writes `auto_overdue:<childId>:<today>`. J delivers 08-20: setStatus finds no open child (:304), sets DONE, `onAssignedTaskDone` returns at the forwardedFrom guard, `settleParent` finds nothing. J is left holding only penalties, on work that was delivered, permanently. The one saving grace — the heir can now at least approve it if `requiresApproval` was set — still yields no points, because reviewTask also routes into `onAssignedTaskDone` (task.service.js:416) which bails identically.

Note this is not merely pre-existing behaviour restored: under the old delete, `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, ... } })` (user.service.js:392) froze the child out of `scanOverdueTasks`' `assignedBy: { $ne: null }` filter. The handover un-freezes the drip while leaving the reward permanently unreachable — the change strictly widens the loss and dresses it up as "handed over".

**Correction:** Three details to fix, none of which touch the core.

(a) The total is -17, not -18, under default rates. duePlus = 08-06, so the drip's first day is duePlus+2 = 08-08 and the scan condition `today > addDays(duePlus, 1)` (bonus.service.js:1064) first passes on 08-08. Days written are 08-08 through 08-19 = 12 drips, not 13 (a 13th only if the 08-20 tick lands before J closes it). So -5 mark + -12 drip = -17, range -17 to -18.

(b) "-5" and "-1" are CEO-configured values from `autoRules`, not constants — 1 is only the seeded default for `assignedTaskOverdueDaily` (bonus.service.js:1603). The mechanism holds at any configured value.

(c) The claim "the penalty exposure is new" needs one qualifier: J was ALREADY accruing the mark and drips before the deletion, because `chainEligible` resolved through the still-live root (bonus.service.js:567-583). What the change introduces is the RESUMPTION of accrual after the delete (the pre-change `assignedBy = null` had stopped it), against a reward that the delete has made permanently unreachable. The "never rewarded" half is pre-existing — deleting the root always orphaned the child — but this change is what turns a frozen orphan into a bleeding one.

Also worth recording as scope: the ongoing accrual requires an OWNER-TIER heir. With a non-owner-tier heir, `taskEligible` fails, `chainEligible` walks up, `Task.findById(deadParentId)` returns null, `if (!parent) break` (:578) → false → the scan skips it. That heir gets no new drips, but the already-written penalties are still kept forever by the `assignerDeleted` arm of prune, and the completion reward is still never paid. So every heir choice loses; only the bleeding rate differs.

**Suggested fix:** Two edits in `deleteUser`, both before line 378.

1. Stop re-homing children onto a corpse — add `forwardedFrom: null` to the handover filter (user.service.js:365):
   `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid }, forwardedFrom: null }`
   A forwarded copy is not "work M delegated" in the sense the heir can take over; its assigner relationship is the chain, not the field.

2. Deal with the chain hanging off M's own copies, mirroring what `deleteTask` (task.service.js:872-886) and the reassign path (task.service.js:700-715) already do — collect BEFORE the delete, while the links are intact:

   - Collect `collectForwardDescendants` of M's own PENDING copies (export it from task.service.js; it is currently module-private).
   - Then pick one of two, per the design intents:
     (i) Cascade-delete the still-open descendants and call `onAssignedTaskUndone(d._id)` on each, so J's accrued penalties on work that no longer exists are cleared and J is notified — same semantics as an assigner deleting the task. Leave DONE / awaitingApproval descendants alone, exactly as the reassign path does. This satisfies intent 3 (settled work keeps its history) and intent 1 (no other person's settled points destroyed — only the open-task penalties, which the app already treats as void when the task goes away).
     (ii) Or, if the intent is genuinely "the junior keeps doing the work": RE-ROOT the descendant instead — `{ $set: { forwardedFrom: null, assignedBy: heir._id, assignerDeleted: true }, }` keeping `originalAssignedBy`. That makes it a root `onAssignedTaskDone` can actually pay. But this only works if the award-side eligibility gate honours `assignerDeleted` the way `pruneOrphanTaskEntries` already does at bonus.service.js:1709 — as written, `onAssignedTaskDone`'s gate (bonus.service.js:632-635) would hard-delete every entry on the re-rooted task whenever the heir is not owner-tier, which is precisely the wipe intent 2 exists to prevent. So (ii) requires also threading `assignerDeleted` into `taskEligible`/the :632 gate.

   (i) is the smaller, safer change and matches the existing precedent in the file. Whichever is chosen, both must run before `Task.deleteMany({ owner: uid })` and inside the same rejected-handover guard so intent 4 (a rejected handover half-deletes nobody) still holds.

Regression test to add to the throwaway-DB suite: CEO→M→J chain, due in the past, delete M naming the CEO as heir, run `maybeRunDaily` twice, then close J's copy — assert J's net on that taskRef is >= 0 and that no `auto_overdue:` row survives for a task J actually delivered.

---

## 4. [RED] A task the departing user had assigned TO the heir becomes self-assigned, enabling self-approval and self-award

**Kahan:** `backend/src/services/user.service.js`:365 · reviewer: points · verdict: CONFIRMED

**Claim:** The filter excludes only the departing user's own copies (`owner: { $ne: uid }`), not the heir's. Any task the departing user had assigned to the heir ends up with `assignedBy === owner` — a state the app itself forbids (`canAssignTo` returns false for self, task.service.js:81). The approval gate then becomes self-service: setStatus (task.service.js:314-331) submits the task to the heir and notifies the heir about their own submission, and reviewTask's only guard is `isAssigner` (task.service.js:389-390), so the heir approves their own work. With an owner-tier heir the points gate also passes because THEY are now the assigner.

**Scenario:** X (role MANAGER) assigned 'Sign the lease renewal' to the CEO, requiresApproval true, due 2026-08-20. The CEO deletes X and names themself heir: the task now has owner = CEO and assignedBy = CEO. The CEO marks it done -> it is 'submitted for approval' to themself, they get a TASK_APPROVAL notification about their own submission, they approve it, and onAssignedTaskDone pays +assignedTaskOnTime (say +5) because taskEligible passes on `assignedBy in ownerIds`. Under X the same task scored nothing. A review requirement the departing user deliberately set is silently dissolved, and points are self-awarded on a task nobody assigned.

**Verifier:** Reproduced on paper, end to end. I tried to refute it four ways and every attempt failed.

MECHANISM
`backend/src/services/user.service.js:365` filters `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }`. `uid` is the DEPARTING user only. A task whose owner is the heir passes the filter, and line 366 sets `assignedBy: heir._id` — producing `assignedBy === owner`.

That state is unreachable through every other route. `canAssignTo` (task.service.js:80-81) returns false for self, and it gates every producer of `assignedBy`: `createTask:153`, `forwardTask:510`, `updateTask` reassign:678. `assignableUsers:96` also excludes self at the query level (`_id: { $ne: actor._id }`). So user.service.js:365 is the only writer that can create it.

CONSEQUENCE 1 — self-approval. In `setStatus`, `isOwner` (line 268) and `isAssigner` (line 271) are both true. The gate at line 314 (`wantDone && requiresApproval && task.assignedBy && isOwner`) fires, sets `submittedAt`, and `notify({ user: task.assignedBy })` at 321-322 posts a TASK_APPROVAL to the actor about their own submission — `notify` (models/Notification.js:34-44) has no self-suppression. `reviewTask:389-390` then has `isAssigner` as its only identity guard, so the same person approves.

CONSEQUENCE 2 — self-awarded points. `onAssignedTaskDone` (bonus.service.js:616-620) only bails on `!task.assignedBy`, now set. `taskEligible` (bonus.service.js:558) returns true via `ownerIds.has(String(task.assignedBy))`. `awardOnce` writes to `copy.owner` — the same person. Nothing in bonus.service.js excludes owner-tier users from earning; line 397 only restricts who may DELETE points.

REFUTATION ATTEMPTS THAT FAILED
- Does the later detach block undo it? No. `Task.updateMany({ assignedBy: uid }, ...)` at user.service.js:392 matches on the OLD id; re-homed rows now carry the heir's id and are skipped.
- Does `Task.deleteMany({ owner: uid })` (line 387) clear them? No — the owner is the heir, not `uid`.
- Does the dialog stop you picking yourself? No. `website/components/users/delete-user-dialog.jsx:56-62` filters only on `u.id !== target?.id`, active, and non-empty `taskAssign`. And self-selection is not even required: any heir who was also an assignee triggers it.
- Is it UI-invisible? No. `listTasks` scope `assigned` matches `{ assignedBy: actor._id }` (task.service.js:940); the awaiting queue (task-board.jsx:1040-1058) and the Approve button (task-board.jsx:1397) render it in the heir's own list, labelled with their own name as owner.

SCENARIO, VERIFIED STEP BY STEP
Bonus enabled. X = MANAGER (not owner-tier), taskAssign.mode ALL. X assigns 'Sign the lease renewal' to the CEO: owner = CEO, assignedBy = X, requiresApproval true, dueYMD 2026-08-20, no collaborators. Under X, `taskEligible` is false (X not owner-tier, no owner tagged) → the task scores nothing, correctly. X is deactivated, then the CEO deletes X and names themself heir (`canAssignAny(CEO)` passes on mode ALL; `canAssignRole(CEO, MANAGER)` passes; the only self-check at line 346 compares the heir to `uid`, not to the actor). The updateMany at 365 matches → owner = CEO, assignedBy = CEO, assignerDeleted = true. CEO taps done: gate 314 fires, TASK_APPROVAL lands in their own bell. CEO taps Approve: reviewTask passes on `isAssigner`, sets DONE/completedAt 2026-08-10, calls `onAssignedTaskDone` → taskEligible true, `hasScorableDeadline` true, no descendants so leaf → `assignedTaskOnTime` (+5) written to PointEntry for the CEO. Approval requirement dissolved, points created that did not exist before, on a task nobody assigned.

**Correction:** Core is right; four refinements.

1. SEVERITY should be RED, not MEDIUM. Per the stated rubric ("RED = data loss, wrong points, security, crash") this writes a PointEntry that would not otherwise exist — wrong points, not merely a missing guard. The self-approval half is additionally an authorization control being silently dissolved.

2. It is WORSE than written: no `setStatus` step is needed for the already-submitted case. `awaitingApproval` is a virtual over `requiresApproval && status === 'PENDING' && submittedAt` (backend/src/models/Task.js:52-54), so a task the departing user had ALREADY received a submission on from the heir still has `status: 'PENDING'` and matches the handover filter. The instant the delete completes, that task sits in the heir's own approval queue, submitted and one tap from approved. The finding's scenario needs a mark-done first; this variant does not.

3. The points half does NOT require an owner-tier heir. `taskEligible` (bonus.service.js:557-559) also passes on `(task.collaborators || []).some(c => ownerIds.has(c))`. So X assigning to H (an ordinary MANAGER with taskAssign ALL) with the CEO merely TAGGED gives the same self-approve-and-self-award once H is named heir — no owner-tier heir needed. The owner-tier-heir path is the narrower of the two.

4. This is a direct violation of design intent 2, not just of intent 3. `onAssignedTaskDone` never reads `assignerDeleted` — the flag is only consulted in `pruneOrphanTaskEntries` (bonus.service.js:1709). So the award path RE-DERIVES the owner-tier eligibility decision from the new assigner, which is precisely the derivation `assignerDeleted` exists to forbid. The commit message asserts the flag "keeps the rewards housekeeping from re-deriving an owner-tier decision"; that is true of the daily pruner and false of the completion hook.

Minor: "reviewTask's only guard is isAssigner" is loose — there are also an `awaitingApproval` check (line 391) and a forwarded-open-child check (394-399). Neither is an identity guard, so the claim's substance holds.

**Suggested fix:** One-line change at backend/src/services/user.service.js:365 — never hand a task to the person who already owns it:

  { assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }

I checked the fall-through and it is safe. Tasks excluded here drop to the detach block at user.service.js:392 and become `assignedBy: null, assignerDeleted: true` — the documented "nobody named against it" state, which is the RIGHT answer for a task the heir already owns (they hold it; there is no one else to chase it). It does not freeze them: `setStatus`'s approval gate at task.service.js:314 requires a truthy `task.assignedBy`, so with it null the gate is skipped and the owner closes the task directly, no approver needed. And `onAssignedTaskDone` bails at line 618 on `!task.assignedBy`, so no points are awarded — exactly what the dialog copy already promises ("Points already earned are kept, but no new ones are awarded").

Two things to fix alongside it:
- `handedOver` (line 368) will now correctly exclude these, but `exitSummary` (user.service.js:290-292) still counts them in `openTasksDelegated`, so the dialog would promise "N tasks move" and the toast would report fewer. Make the exitSummary count and the updateMany filter agree — easiest is to have exitSummary return the delegated count and let the dialog's post-delete toast be the source of truth, or recount after the heir is known.
- Add a regression assertion to the throwaway-DB suite the commit describes: create a PENDING task with `assignedBy: X, owner: H, requiresApproval: true`, delete X with `reassignTasksTo: H`, and assert `assignedBy !== owner` on every surviving task. The existing 30 assertions cover the heir as a bystander but never as an assignee, which is why this slipped through.

---

## 5. [MEDIUM] canAssignAny is not canAssignTo — the heir gains assigner powers over people they may not assign work to

**Kahan:** `backend/src/services/user.service.js`:355 · reviewer: points · verdict: CONFIRMED

**Claim:** The guard only proves the heir can delegate to SOMEBODY (task.service.js:89-92), not to the owners of the tasks being moved, yet the code comment and the dialog copy (delete-user-dialog.jsx:57-62) justify it as 'they can reassign, chase or close it'. Once `assignedBy = heir`, every assigner route checks nothing but `isAssigner`: updateTask (task.service.js:642-646) lets them rewrite title/notes/due date, deleteTask (task.service.js:861-867) lets them delete the task outright, reviewTask lets them approve it, and the reassignment branch deletes a member's copy with NO canAssignTo check on the person being dropped (task.service.js:690-703).

**Scenario:** Heir N has taskAssign { mode: 'SELECTED', users: [P] } — leadership deliberately limited N to one person. The departing user's four open tasks belong to E, F, G and H, none of whom N may assign to. After the delete, N is assigner on all four: N can open E's task, delete it (deleteTask -> onAssignedTaskUndone wipes E's accrued overdue penalties on it), or reassign the batch to P, which deletes E's, F's, G's and H's copies via the removal branch without a single delegation check. The dialog told leadership this check guarantees the heir can act on the work; it actually grants them authority over people the ACL says they have none over.

**Verifier:** The mechanism reproduces exactly as described, and every guard I hoped would refute it does not exist.

Guards, as read: `canAssignTo` (backend/src/services/task.service.js:80-86) is purely per-person taskAssign — no rank fallback, no role fallback. `canAssignAny` (task.service.js:89-92) returns true for `mode:'SELECTED'` with a non-empty list, regardless of who is in it. deleteUser (backend/src/services/user.service.js:355) calls only `canAssignAny(heir)`, then `Task.updateMany({ assignedBy: uid, status:'PENDING', owner:{$ne:uid} }, { $set:{ assignedBy: heir._id, ... } })` (user.service.js:364-367). Nothing anywhere compares the heir against the owners of the tasks being moved.

Attempted refutation 1 — route-level gate. None. backend/src/routes/tasks.routes.js:7-10 only applies `requireAuth`, with a comment stating the service is the sole authoriser; `PATCH /:id` and `DELETE /:id` (lines 24-25) carry no permission middleware.

Attempted refutation 2 — a hidden owner check in updateTask. None. task.service.js:642-646 admits anyone where `isAssigner`; the only `canAssignTo` in the whole edit path is task.service.js:678, and it applies exclusively to NEWLY added people. Existing members are never re-checked, and the removal branch (task.service.js:690-703) deletes a member's copy with no delegation check at all.

Attempted refutation 3 — the point-wipe parenthetical. It holds. `onAssignedTaskUndone` deletes `{ taskRef, source: { $in: ['auto_task','auto_forward'] } }` (backend/src/services/bonus.service.js:698). Overdue marks and daily drips are written with `source: 'auto_task'` (bonus.service.js:743, 751, 1054, 1066, 1107), so they are inside that delete set. After `deleteTask`, `rebuildOverdueForTask` returns at bonus.service.js:725-726 because the task no longer exists, so nothing is rebuilt — the penalties are gone permanently.

Walking the scenario on paper. Heir N has `taskAssign {mode:'SELECTED', users:[P]}`. `canAssignAny(N)` → true (list length 1), so user.service.js:355 passes. `canAssignTo(N, E)` → false (E not in [P]). After the delete, all four PENDING tasks owned by E, F, G, H carry `assignedBy = N`. N now satisfies `isAssigner` on every one of them and can: rewrite title/notes/dueYMD (task.service.js:642-646), delete outright (task.service.js:861-867), approve a submission (task.service.js:389-390), or PATCH `assignTo:[P]` — where P passes line 678 and E/F/G/H are dropped through line 703 with zero checks. The ACL says N may direct work at exactly one person; after the handover N holds assigner authority over four people it excludes.

The one thing I would not call proven is the "misleading UI" half — see `correction`. The ACL half is solid.

Severity MEDIUM is right and I would not raise it. The escalation is initiated by a leadership actor who already holds manageUsers and could simply widen N's taskAssign directly, so this is escalation-by-configuration rather than a bypass an ordinary user can reach. But it is a real widening that no one is shown, so it is not LOW either.

**Correction:** Four corrections; the core stands.

1. "Dialog copy" is wrong — it is a code comment. The "reassign, chase or close it" justification appears at backend/src/services/user.service.js:353-354 and as a comment at website/components/users/delete-user-dialog.jsx:55-56. The cited lines 57-62 are the candidate filter, not copy. The user-visible text (delete-user-dialog.jsx:138-172) never makes that claim — it asks "Who takes over the N open tasks they delegated?" and warns only about the "Nobody" path. So leadership is not literally told the check guarantees anything; they are shown a pre-filtered list with no rationale. The rationale being wrong is a code-comment defect, and the silent widening is the real UI gap.

2. The guard is wrong in BOTH directions, not merely too weak. Chasing, closing, editing, deleting and reviewing a delegated task require only `isAssigner` — no taskAssign whatsoever (task.service.js:642-646, 861-867, 389-390). An heir with `mode:'NONE'` would still be able to chase and close the work, so the comment's premise that naming them would be "decorative" is false. The only assigner action that genuinely needs taskAssign is ADDING new people (task.service.js:678). `canAssignAny` is therefore neither necessary nor sufficient for its stated purpose.

3. There is a stronger lever than deletion, and it leaves the task in place. In updateTask, a due-date change on a PENDING copy calls `onAssignedTaskUndone` (task.service.js:770, 792-799), which deletes every `auto_task` entry for the task and then rebuilds overdue against the NEW deadline (bonus.service.js:698-701, 721-751). So N can push E's due date out and erase E's accrued overdue penalties, or pull it in and manufacture the mark plus a drip for every day from D+2 to today — silently, with no deletion and no notification of the point change. This is the cleanest demonstration of "wrong points for someone the ACL protects."

4. Batch caveat on the four-in-one-call step. The removal branch reaches all four copies in a single PATCH only if E/F/G/H share an `assignBatch` (the batchQuery at task.service.js:655) — true when the departing user multi-assigned them in one action. Otherwise it is one PATCH per task, with the same end state.

**Suggested fix:** Make the guard per-owner instead of blanket, in backend/src/services/user.service.js around lines 355-367.

Before moving anything, load the distinct owners of the tasks that would move:

  const owners = await Task.distinct('owner', { assignedBy: uid, status: 'PENDING', owner: { $ne: uid } });
  const ownerDocs = await User.find({ _id: { $in: owners } }).select('name');
  const blocked = ownerDocs.filter((o) => !canAssignTo(heir, o));

Then pick one of two policies and make the copy match it:
- Strict (matches the "a rejected handover must not half-delete anyone" intent): if `blocked.length`, throw 400 naming them — `${heir.name} can't be given work for ${blocked.map(o => o.name).join(', ')} — grant them assign access first, or pick someone else`. The whole delete fails, nobody is half-removed.
- Partial: move only the tasks whose owner passes `canAssignTo(heir, owner)`, leave the rest on the existing `assignedBy: null, assignerDeleted: true` path at user.service.js:392, and return the leftover count so the toast can say so.

`canAssignTo` is already exported from task.service.js:80, so import it alongside the existing `canAssignAny` import. Keep `canAssignAny` only as a cheap pre-check; it is not the authorisation.

Frontend: the correct candidate list depends on the specific owners, so the filter at website/components/users/delete-user-dialog.jsx:57-62 cannot compute it from `/users` alone. Extend the existing exit-summary endpoint (user.service.js:282) to return the eligible heirs for this user, and render the ineligible ones disabled with a reason rather than hiding them, so leadership sees why someone is not offered.

Finally, correct the two comments (user.service.js:353-354 and delete-user-dialog.jsx:55-56): drop the "cannot reassign, chase or close it" rationale, since those actions need only `isAssigner`. The real reason for the check is that the heir must not gain assigner authority over people the taskAssign ACL excludes.

---

## 6. [MEDIUM] The handover is not atomic and not retryable — a mid-delete failure leaves tasks re-homed and the audit record wrong

**Kahan:** `backend/src/services/user.service.js`:364 · reviewer: points · verdict: CONFIRMED

**Claim:** The `updateMany` runs first and is never rolled back; there is no transaction across the ~20 collection operations that follow (user.service.js:373-401), and the audit row is only written after the whole service call returns (users.controller.js:147-150). If anything after the handover throws or the Lambda hits its timeout, the tasks are already re-homed AND flagged `assignerDeleted: true` while the user still exists — and the retry's `{ assignedBy: uid, ... }` filter now matches nothing.

**Scenario:** Leadership deletes a user with 12 open delegated tasks and picks N. The updateMany succeeds; the Promise.all of deletes then times out. No audit row is written and the UI shows an error. Leadership retries and this time picks a different heir, R: the filter matches 0 documents, so the tasks stay with N, `handedOver` comes back 0, the toast says a bare 'User deleted', and the audit meta records `reassignTasksTo: R, handedOver: 0, handedOverTo: ''` — a permanent record that contradicts what the data says. Meanwhile, between the two attempts, 12 tasks carry `assignerDeleted: true` while their assigner is alive and active, which permanently exempts them from the owner-tier re-derivation in pruneOrphanTaskEntries (bonus.service.js:1709).

**Verifier:** Mechanism paper par reproduce ho gaya. Maine teen tarah se isko refute karne ki koshish ki, teenon fail hue.

CODE JO PADHA (verified line numbers):
- `user.service.js:364-367` — `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Ye function ka PEHLA mutation hai, koi session/transaction nahi.
- `user.service.js:373-384` (10 deleteMany), `387-399` (7 updateMany), `401` (`user.deleteOne()`) — 18 aur ops, sab bina transaction.
- `users.controller.js:144` service call, `147-150` audit — audit BAAD me. Service throw kare to `sendServiceError` (line 152-153) chalta hai aur audit row kabhi nahi likhti. `audit()` khud apni error nigal jaata hai (`AuditLog.js:22-26`), par yahan wo reach hi nahi hota.

REFUTATION ATTEMPT 1 — "shayad transaction hai": FAIL. `runTransaction` codebase me MAUJOOD hai (`backend/src/lib/transaction.js:16-32`), replica-set na hone par `fn(null)` fallback ke saath, aur `leave.service.js:19` use bhi karti hai. `deleteUser` usko simply use nahi karti. Isse finding kamzor nahi, MAZBOOT hoti hai — fix ka tool pehle se shelf par rakha hai.

REFUTATION ATTEMPT 2 — "retry harmless hoga, sab idempotent hai": FAIL, aur yahi is finding ka sabse strong point hai. Function ke BAAKI saare ops idempotent hain — `deleteMany({user: uid})`, `Task.updateMany({assignedBy: uid} → null)` (line 392), `User.updateMany({reportsTo: uid})`, `user.deleteOne()`. Dobara chalao to ya to no-op ya wahi result. Handover AKELA non-idempotent step hai, kyunki uska filter SELF-CONSUMING hai: ek baar chalne ke baad `assignedBy` ab `heir._id` hai, to `{ assignedBy: uid, ... }` hamesha ke liye 0 match karega. Matlab ye partial-failure problem is change ne NAYI paida ki hai, pehle se maujood nahi thi.

REFUTATION ATTEMPT 3 — "failure scenario theoretical hai": FAIL. Lambda timeout documented hai `backend/DEPLOY-AWS.md:58-59` par — Memory 1024MB, **Timeout 30 sec**. Hard kill hai: koi catch nahi chalta, koi audit nahi likhti, process beech Promise.all me mar jaata hai. Handover ke baad 18 collection ops bache hote hain (Attendance/Notification purge + cold start), 30s ke andar. Ye exceptional-but-real exposure hai, kaalpanik nahi.

CONCRETE SCENARIO (12 open delegated tasks, heir N chuna):
1. Line 364 updateMany commit ho gaya — 12 tasks ab `assignedBy: N`, `assignerDeleted: true`.
2. Line 373 ka Promise.all 30s Lambda timeout par mara. User U abhi bhi zinda (deactivated). Koi audit row nahi. UI par error toast (`delete-user-dialog.jsx:80`).
3. Leadership dobara Delete dabata hai. Line 365 ka filter ab 0 match karta hai — tasks N ke paas hi rehte hain, chahe leadership ne R chuna ho.
4. Delete complete ho jaata hai. Line 392 bhi in tasks ko chhoo nahi sakti (unka `assignedBy` ab N hai, uid nahi).

Net: tasks us aadmi ke paas hain jo ek FAILED attempt me chuna gaya tha, aur audit record data se ulta bolta hai. Koi compensating logic kahin nahi — maine `assignerDeleted` ko poore website/ me grep kiya, ek bhi UI surface nahi; `task.service.js` me bhi koi repair path nahi.

SABSE KHARAB VARIANT (finding me nahi hai): agar leadership error dekh kar delete CHHOD deta hai, to U zinda rehta hai, 12 tasks permanently N ke naam, `assignerDeleted: true`, aur audit me kuch bhi nahi. Doosre logon ke tasks ka assigner ek FAIL hui operation se chup-chaap badal gaya, bina kisi record ke.

**Correction:** Core sahi hai, par do detail galat hain:

1. `handedOverTo: ''` GALAT hai. `user.service.js:368-369` me `handedOver = res.modifiedCount ?? 0` (= 0) hota hai, par `handedOverTo = heir.name` BINA kisi condition ke set hota hai — modifiedCount check nahi hota. To audit meta padhega `{ reassignTasksTo: R, handedOver: 0, handedOverTo: 'R ka naam' }`. Ye finding ke version se ZYADA misleading hai: record R ko recipient bata raha hai jabki tasks asal me N ke paas hain.

2. "Leadership retries and this time picks a different heir R" — ye sirf ek timing window me hi possible hai. `exitSummary` (`user.service.js:291`) BILKUL wahi filter use karti hai: `Task.countDocuments({ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } })`. Global staleTime 30_000 hai (`website/lib/queryClient.jsx:12`). To:
   - Retry 30s ke ANDAR: cached 12 dikhega, picker render hoga (`delete-user-dialog.jsx:138`), leadership R chun sakta hai → finding ka scenario reachable, magar `handedOverTo: 'R'` ke saath.
   - Retry 30s ke BAAD: refetch par `openTasksDelegated: 0` aayega, to picker block render hi NAHI hoga — leadership kisi ko chun hi nahi sakta, request bina heir ke jaati hai, aur audit `reassignTasksTo: null, handedOver: 0, handedOverTo: ''` likhta hai. Tasks N ke paas, aur N ka naam kahin kisi record me nahi.

3. `assignerDeleted` wali limb par nuance: `bonus.service.js:1709` ka `t.assignerDeleted ? true : await chainEligible(...)` short-circuit mechanically bilkul sahi describe kiya gaya hai, par retry-path par ye INCREMENTAL harm nahi hai — design intent #2 ke mutabik successful handover me bhi theek yahi state banti hai (naya assigner zinda + flag set). Ye limb sirf ABANDONED-delete path par real harm hai: wahan U zinda reh jaata hai, yaani evidence maujood hai aur `chainEligible` derive ho sakti thi, phir bhi decision permanently freeze ho gaya. Agar U owner-tier nahi tha, to jo entries `pruneOrphanTaskEntries` (line 1716) hata deti, wo hamesha ke liye bachi reh jaayengi.

4. "~20 collection operations" — exact ginti 18 hai (10 deleteMany at 373-384, 7 updateMany at 387-399, plus `user.deleteOne()` at 401). Chhoti baat, par claim me likha hai.

Severity MEDIUM sahi hai. Main path par points corrupt nahi hote aur kuch destroy nahi hota — ye galat-heir + jhootha record + missing guard hai. Design intent #4 ("rejected handover must not half-delete anyone") TOOTA NAHI hai: saara heir validation (lines 343-357) updateMany se PEHLE hai, to reject kiya gaya heir kuch bhi mutate nahi karta. Ye finding sirf updateMany ke BAAD ke crash ki baat hai.

**Suggested fix:** Sabse chhota sahi fix: poore `deleteUser` body ko pehle se maujood `runTransaction` helper me lapet do — naya infra likhne ki zaroorat hi nahi.

`backend/src/services/user.service.js`:
- `import { runTransaction } from '../lib/transaction.js';`
- Guards (lines 321-334) transaction ke BAHAR rakho (wo read-only hain), phir line 336 se 402 tak ka sab kuch `return runTransaction(async (session) => { ... })` ke andar. Har op me `session` thread karo: `Task.updateMany(filter, update, { session })`, har `deleteMany(..., { session })`, aur `user.deleteOne({ session })`. Ab handover ya to poora commit hoga ya poora roll back — retry ek saaf slate se shuru hogi.
- Dhyan rahe: `transaction.js:25-26` non-replica-set par `fn(null)` fallback karta hai, to local single-node Mongo par bhi code chalta rahega (wahan atomicity nahi milegi, magar Atlas replica set par milegi).

Do chhote sudhar jo transaction se independent hain aur waise bhi kar lene chahiye:

1. `user.service.js:368-369` — `handedOverTo` sirf tab set karo jab kuch actually move hua ho, warna audit ek aise aadmi ka naam record kar deta hai jise kuch mila hi nahi:
   `handedOver = res.modifiedCount ?? 0; handedOverTo = handedOver ? heir.name : '';`

2. Agar caller ne `reassignTasksTo` bheja tha par `modifiedCount === 0` aaya, to ye result me alag se batao (jaise `handoverMatchedNothing: true`) aur `delete-user-dialog.jsx:70-75` me uske liye ek warning toast dikhao. Abhi wo case chup-chaap bare `'User deleted'` bolta hai — bilkul wahi text jo "koi delegated task tha hi nahi" case me aata hai, to leadership ko pata hi nahi chalta ki unka chuna hua heir apply nahi hua.

---

## 7. [MEDIUM] The handover question disappears entirely if the exit-summary query fails, and the warning copy points the wrong way

**Kahan:** `website/components/users/delete-user-dialog.jsx`:138 · reviewer: points · verdict: CONFIRMED

**Claim:** `delegated` is derived from `exit?.openTasksDelegated ?? 0` (line 64) and the picker only renders when `delegated > 0` (line 138). The query has no error branch: on failure `exit` is undefined, `exitLoading` is false, so the summary box renders an empty `<dl>` with no error text and the Delete button is enabled — the handover is silently skipped. Separately, the only cautionary text in the dialog (lines 157-166) is attached to 'Nobody' and claims points already earned are kept and nothing further accrues; that is accurate for 'Nobody' and inaccurate for the recommended path — naming an heir is the option that deletes them (see the first finding).

**Scenario:** The CEO opens the delete dialog for a departing manager who has 7 open delegated tasks. `/users/:id/exit-summary` fails (cold Lambda, 30s timeout — this is the app's known failure mode). React Query retries, errors, and the dialog shows an empty summary box with no message and no 'who takes over' dropdown. The CEO, seeing no outstanding items, clicks Delete permanently. All 7 tasks are stripped to assignedBy = null and become untouchable personal to-dos in their assignees' lists forever — there is no later re-home path in the UI, since the picker exists only at delete time.

**Verifier:** The mechanism reproduces exactly as described, and every link in the chain is in the code.

1. `api.get` THROWS on a non-2xx or `ok:false` envelope (`website/lib/api.js:90-98`), so the query genuinely enters the error state — it does not resolve with `undefined` data.
2. The query destructures only `{ data: exit, isLoading: exitLoading }` (`website/components/users/delete-user-dialog.jsx:43`). There is no `isError`, no `error`, no error branch anywhere in the component.
3. `@tanstack/react-query@^5.101.1` with `retry: 1` (`website/lib/queryClient.jsx:13`): after the retry is exhausted the query settles to `status: 'error'`, so `isPending` and `isFetching` are both false and `isLoading` is false.
4. Therefore `exit` is `undefined` → `rows` is `[]` (line 83) → the summary box renders an empty `<dl>` with no text at all (lines 124-134), and `delegated = exit?.openTasksDelegated ?? 0` = 0 (line 64) → the whole picker block is skipped (line 138).
5. The Delete button is `disabled={mut.isPending || exitLoading}` (line 113) → enabled. `mut.mutate()` sends `body: {}` (line 68) because `heir` is still `NOBODY`.
6. Backend then runs `deleteUser` with `reassignTasksTo` undefined, skips the handover block entirely (`backend/src/services/user.service.js:342`), and line 392 does `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })` — all 7 open delegated tasks stripped.
7. The "no later re-home path" claim holds too: `assignerDeleted` is never read in `backend/src/services/task.service.js` (grep: it appears only in `Task.js`, `bonus.service.js`, `user.service.js`), and with `assignedBy: null` the task service treats it as a personal/shared-personal task (`task.service.js:276` `const sharedPersonal = !task.assignedBy;`, `task.service.js:843`). No endpoint sets an assigner on an existing task. The picker really is the only moment this can be answered.

The finding under-sells the trigger. It is not just a cold-Lambda flake — there is a deterministic permission mismatch that makes the picker vanish 100% of the time for a whole class of actor. See `correction`.

**Correction:** Three corrections, none of which weaken the finding.

A) The failure is deterministic for a real role shape, not just a timeout edge case. `backend/src/routes/users.routes.js:46` gates `DELETE /users/:id` on `manageUsers`, while `:39` gates `GET /users/:id/exit-summary` on `deactivateUsers`. The menu item that opens this dialog is gated on `canManage` alone — `website/components/users/users-directory.jsx:166` (`canManage && !row.original.isActive && ...`), deliberately NOT on `canDeactivate`, which line 157 uses for the Deactivate item. `manageUsers` and `deactivateUsers` are independent toggles in the roles editor (`backend/src/lib/permissionCatalog.js:52-53`); they only travel together for the built-in LEADERSHIP roles (`backend/src/lib/permissions.js:103-113`). So a custom role with "Edit users" but not "Deactivate users" sees "Delete permanently", opens the dialog, gets a hard 403 on the summary every single time, and can never be shown the handover question. The target must already be inactive (`user.service.js:332`) — but somebody else can have done that deactivation. Cite this as the primary scenario; the cold-Lambda timeout is the secondary one.

B) The copy half is right in substance but wrongly worded. The 'Nobody' warning (lines 157-166) is accurate on all three of its claims, and I verified each independently: points already earned are kept (`bonus.service.js:1691` second `$or` arm finds the task despite `assignedBy: null`, `:1709` forces eligible via `assignerDeleted`, `:1724` keeps negative entries on a PENDING task); no new awards (`onAssignedTaskDone` bails at `:619` on `!task.assignedBy`); no further overdue penalties (`scanOverdueTasks` filters `assignedBy: { $ne: null }` at `:1030`). So it is not "inaccurate for the recommended path" — it simply is not shown on that path. The heir branch's copy (lines 168-171) is also true as written. The actual defect is asymmetric disclosure: the only cautionary text is bolted to the option that is safe for points, while the option that can silently destroy them gets a bland reassurance.

C) The supporting claim that naming an heir can delete points is real, but NOT via `pruneOrphanTaskEntries` — prune keeps them (task found by the `assignedBy: {$ne: null}` arm, and `:1709` short-circuits to eligible on `assignerDeleted`). The loss is in `onAssignedTaskDone`, which does not honour `assignerDeleted` at all: `bonus.service.js:632` re-derives `taskEligible(copy, ownerIds)` and on false hard-deletes every `auto_task`/`auto_forward` entry on the whole chain at `:633`. `taskEligible` (`:555-560`) only checks `assignedBy ∈ ownerIds` or a tagged owner-tier collaborator. So: departing assigner was owner-tier, heir is not, no owner-tier collaborator → the instant the assignee finishes the task, every point entry on it (including overdue penalties accrued while the original assigner was alive) is deleted and no award is written. Precondition: the deleted account was owner-tier, which the rank guard at `user.service.js:329` (`canAssignRole`) limits to a peer deletion, so it needs ≥2 owner-tier accounts.

Severity stays MEDIUM per the stated rubric ("missing guard", "misleading UI"), but it belongs at the top of MEDIUM: the outcome is irreversible and there is no recovery UI.

**Suggested fix:** Two small changes, both in files already touched by this commit.

1. Never let the dialog proceed on an unread summary — `website/components/users/delete-user-dialog.jsx`:
   - line 43: `const { data: exit, isLoading: exitLoading, isError: exitError, refetch } = useQuery({...})`
   - lines 121-135: add a branch before the `<dl>`: when `exitError`, render "Couldn't check what's still open — the handover question can't be asked." plus a small Retry button calling `refetch()`.
   - line 113: `disabled={mut.isPending || exitLoading || exitError}` so the destructive action is blocked while the answer is unknown. Blocking is the right call here rather than defaulting the picker open: the count is what the label and the whole `delegated > 0` gate are built on.

2. Close the permission mismatch so the frontend cannot be put in that state — `backend/src/routes/users.routes.js:39`: change `requirePermission('deactivateUsers')` to `requireAnyPermission('deactivateUsers', 'manageUsers')` (already imported on line 3). Anyone who can delete an account must be able to read its exit summary; the endpoint is read-only.

3. Optional, for the copy asymmetry: keep the 'Nobody' warning as-is and add a matching one-liner under the heir branch (lines 168-171) that states what the handover does not preserve, once the `onAssignedTaskDone` eligibility hole in point C is decided on. Do not reword the 'Nobody' text — it is correct.

---

## 8. [LOW] The audit row the feature relies on is TTL-deleted after 120 days

**Kahan:** `backend/src/controllers/users.controller.js`:146 · reviewer: points · verdict: CONFIRMED

**Claim:** The comment states the audit entry is 'the only thing that explains why a task names somebody who never created it' 'months later', but AuditLog carries `schema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 })` (backend/src/models/AuditLog.js:16). Nothing on the Task records who the original assigner was — `assignerDeleted` is a bare boolean and `originalAssignedBy` is only set on forwarded copies (Task.js:39).

**Scenario:** A task is handed from departing user X to N on 2026-08-10. On 2027-01-15 someone asks why N is named as assigner on work N never created. The AuditLog row was TTL-purged on 2026-12-08, and the task itself holds only `assignedBy: N` and `assignerDeleted: true` — the question the change was written to answer is unanswerable after four months. Storing the previous assigner id on the Task (e.g. reusing originalAssignedBy) would survive the TTL.

**Verifier:** Every load-bearing claim checks out against the code.

1. The comment is verbatim as quoted — `backend/src/controllers/users.controller.js:145-146`: "months later it is the only thing that explains why a task names somebody who never created it".

2. The TTL is real and active — `backend/src/models/AuditLog.js:16`: `schema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 })`. I checked the refutation angle that the index might never be built: `backend/src/config/db.js:11-33` sets only `strictQuery` and passes `{ dbName, maxPoolSize }` to `mongoose.connect` — no `autoIndex: false` anywhere, so mongoose builds the TTL index on model init. Nothing rescues the row.

3. The Task keeps no trace of the original assigner. After a handover, `backend/src/services/user.service.js:364-367` writes exactly `{ $set: { assignedBy: heir._id, assignerDeleted: true } }` — `assignerDeleted` is a bare Boolean (`backend/src/models/Task.js:14`). And `originalAssignedBy` is genuinely forward-only: it is written at exactly one site, `backend/src/services/task.service.js:529` inside the forward path (`originalAssignedBy: parent.originalAssignedBy || parent.assignedBy || null`). The three normal creation paths — `task.service.js:170` (assign), `:209` (personal), `:726` (adding assignees to a batch) — never set it, so for a directly-delegated task it is null.

4. The user document is hard-deleted at `user.service.js:401` (`await user.deleteOne()`), so nothing can be recovered from the User collection either.

The scenario reproduces on paper. Task T: owner N2, assignedBy X, status PENDING. Leadership deletes X on 2026-08-10 naming N as heir. T becomes `{assignedBy: N, assignerDeleted: true}`; one AuditLog row is written with `createdAt: 2026-08-10`. 2026-08-10 + 120 days = 2026-12-08 — the arithmetic in the finding is correct — and Mongo's TTL monitor sweeps it within ~60s of that. On 2027-01-15, N is asked why they are named as assigner on work they never created: the Task holds `assignedBy: N` + `assignerDeleted: true`, the User doc for X is gone, and the audit row is gone. The question is unanswerable.

Severity LOW is right: nothing computes on this row (`audit()` at `AuditLog.js:21-27` is fire-and-forget and only feeds the activity list in `audit.controller.js:34` and the dashboard feed in `dashboard.service.js:329`), so no points or permissions are wrong — only the record the comment promises. The core is right; two details need correcting, below.

**Correction:** Two corrections, one widening the finding and one rejecting its suggested fix.

(a) The record is thin from day 0, not only after day 120. The audit call at `users.controller.js:147-150` stores `entityId: req.params.id` (X's ObjectId) and `meta: { reassignTasksTo, handedOver, handedOverTo }` — the heir's id, a COUNT, and the heir's NAME. It never stores the departed user's name, and never stores which task ids moved. Because `user.deleteOne()` (`user.service.js:401`) removes the User doc, that `entityId` can never be resolved back to a person — `audit.controller.js:34` only populates `actor`, not `entityId`. The `user.create` row would not save you either: `users.controller.js:77-83` stores `meta: { role, employeeId }`, no name, and carries the same TTL. So even on day 3 the row reads "leadership deleted <unresolvable id>, 4 tasks went to 'Nikhil'" — it names the heir, i.e. the person who is NOT the answer. The TTL then deletes even that. The finding's framing ("unanswerable after four months") understates it: the departed person's identity is already unrecoverable immediately, and after 120 days so is the fact that a handover happened at all.

(b) The proposed fix — "reusing originalAssignedBy" — is wrong for this codebase and would be a regression, not a LOW-severity improvement. `originalAssignedBy` is `ref: 'User'` (`Task.js:39`) and X's User doc is deleted, so `.populate('originalAssignedBy', 'name')` (`task.service.js:1037`, `:240`) resolves a dangling ref to null — the name still does not survive, so the fix does not even achieve its goal. Worse, the field is read as an owner-tier eligibility signal: `dashboard.service.js:91-95` matches `$or: [{ assignedBy: {$in: ceoIds} }, { originalAssignedBy: {$in: ceoIds} }, { collaborators: {$in: ceoIds} }]`, with `ceoIds = await ownerTierUserIds()` (`dashboard.service.js:196`) — a LIVE query that by definition can no longer contain the deleted user. It is also read as the chain "originator" at `task.service.js:1113-1116`. Stamping it on a task that was never forwarded would therefore (i) show a bogus originator in the chain view and (ii) feed an owner-tier re-derivation off evidence that no longer exists — precisely what design intent 2 and `assignerDeleted` exist to prevent.

**Suggested fix:** Do NOT touch `originalAssignedBy`. Two options, smallest first.

Cheapest (comment-only, zero risk): soften the claim at `users.controller.js:145-146` so it does not promise permanence the storage cannot deliver — e.g. note that the handover is recorded in the activity log, which is retained 120 days (`AuditLog.js:16`).

If the explainability is actually wanted long-term, denormalize a plain string onto the Task at handover time so it survives both the User delete and the TTL. In `backend/src/models/Task.js`, next to `assignerDeleted` (line 14), add `assignerDeletedName: { type: String, default: '' }`. Then in `backend/src/services/user.service.js`, load the departing user's name (already in `user`) and set it in both writes:
- handover path, line 364-367: `{ $set: { assignedBy: heir._id, assignerDeleted: true, assignerDeletedName: user.name } }`
- orphan path, line 392: `{ $set: { assignedBy: null, assignerDeleted: true, assignerDeletedName: user.name } }`
A String has no `ref`, so nothing populates it and no eligibility query can match on it — the award-time decision stays un-re-derivable, which keeps design intent 2 intact. Surface it in the task UI as "originally assigned by X (account removed)".

Independently, add the departed user's name to the audit meta at `users.controller.js:149` (`meta: { deletedUserName: result.deletedName ?? ..., reassignTasksTo, handedOver, handedOverTo }`) so the row is self-describing while it lives — today it identifies everyone except the person it is about.

---

## 9. [RED] Handover se task ka owner-tier eligibility dobara derive ho jati hai aur completion par doer ke point entries delete ho jate hain

**Kahan:** `backend/src/services/bonus.service.js`:632 · reviewer: delete-path · verdict: CONFIRMED

**Claim:** Design intent #2 kehta hai ki `assignerDeleted` ke baad owner-tier decision kabhi re-derive nahi hona chahiye. Daily prune ye honour karta hai (bonus.service.js:1709 `t.assignerDeleted ? true : await chainEligible(...)`), lekin AWARD path nahi karta. `onAssignedTaskDone` (bonus.service.js:616) `assignerDeleted` ko dekhta hi nahi — wo line 632 par CURRENT `assignedBy` se `taskEligible` re-derive karta hai aur fail hone par line 633 par `PointEntry.deleteMany({ taskRef: {$in: copies}, source: {$in:['auto_task','auto_forward']} })` chala deta hai. Pehle ye path chal hi nahi sakta tha, kyunki orphan hone par `assignedBy` null ho jata tha aur line 619 (`if (!b.enabled || !task.assignedBy) return;`) turant return kar deta tha. Naya reassign block (user.service.js:364-367) `assignedBy` ko heir se bhar deta hai, jisse ye guard khul jata hai — yaani handover khud hi wo re-derivation on kar deta hai jise flag rokne ke liye banaya gaya tha.

**Scenario:** CEO Anita 'Q2 filing' Bob ko assign karti hai, due 2026-09-10, status PENDING. Due nikal jaane par scanOverdueTasks Bob par -5 overdue mark + 6 din ke -1 drips (total -11, September month me filed) likh chuka hai. Anita resign karti hai; leadership use delete karti hai aur heir Ravi chunti hai (Ops manager, taskAssign mode ALL, par CEO_PRESIDENT tier ka NAHI). user.service.js:364-367 se task ka assignedBy=Ravi, assignerDeleted=true. Ab Bob task DONE mark karta hai -> setStatus (task.service.js:366) -> onAssignedTaskDone: line 619 ka guard ab pass ho jata hai (assignedBy truthy), line 632 par taskEligible false (Ravi owner tier me nahi, koi owner tagged nahi) -> line 633 us task ki SAARI auto_task entries hard-delete kar deta hai. Bob ka September -11 gaayab, aur completion par koi award bhi nahi. Ulta case bhi utna hi galat hai: agar original assigner non-owner-tier tha aur heir CEO tier ka hai, to wahi task ab eligible ban jata hai aur Bob ko assignedTaskOnTime points mil jate hain jo usne kabhi earn nahi kiye the — plus scanOverdueTasks (bonus.service.js:1031, 1037) un tasks par naye -5/-1 penalties likhna shuru kar deta hai jo pehle system se bahar the. Dono taraf, doosre insaan ke points heir ki role-tier par depend karne lag jate hain — intent #1 aur #2 dono violate.

**Verifier:** Maine ise refute karne ki poori koshish ki aur nahi kar paya — mechanism code me line-by-line reproduce hota hai.

**Kadam-dar-kadam proof:**

1. `taskEligible` (backend/src/services/bonus.service.js:555-560) sirf `task.assignedBy` aur `task.collaborators` dekhta hai. `assignerDeleted` ka naam tak nahi hai. Poore backend me `assignerDeleted` sirf 4 jagah hai (`grep`): Task.js:14 (schema), bonus.service.js:1691/1692/1709 (sirf prune), user.service.js:361/366/392 (delete path). Yaani award path me wo kahin consult hi nahi hota.

2. Purana behaviour genuinely protective tha. Delete par user.service.js:392 `assignedBy` ko `null` kar deta tha, aur `onAssignedTaskDone` ka guard bonus.service.js:619 (`if (!b.enabled || !task.assignedBy) return;`) turant return karta tha — line 632-633 ka destructive gate orphan tasks par **pahunchta hi nahi tha**. Isi tarah `scanOverdueTasks` ka query bonus.service.js:1030 `{ assignedBy: { $ne: null }, ... }` un tasks ko scan se hi bahar rakhta tha. Ye do guards hi wo cheez the jo prune ke assignerDeleted-honouring (1709) ko akela kaafi bana rahe the.

3. Naya handover block (user.service.js:364-367) `assignedBy` ko `heir._id` se bhar deta hai. Ab wo task line 392 ke `{ assignedBy: uid }` filter se bhi match nahi karta, to `assignedBy` heir par hi rehta hai — dono guards khul jate hain.

4. Bob DONE marks → task.service.js:366 `await onAssignedTaskDone(task)` → line 619 guard **pass** (assignedBy truthy) → line 621 pass (root copy, forwardedFrom null) → line 631-632 `ownerTierIds()` + `copies.some(taskEligible)`. Ravi owner-tier me nahi, koi owner tagged nahi → false → **line 633 `PointEntry.deleteMany({ taskRef: {$in: copies}, source: {$in:['auto_task','auto_forward']} })`** → line 634 return (koi award bhi nahi).

5. Scenario ke numbers verify hote hain: due 2026-09-10 → `overdueDayFor` (1013-1016) = 09-11, mark `awardOnce('auto_task:<id>', ..., source:'auto_task')` (1054) September me; drips 09-12 se, `source:'auto_task'` (1066), `dueYMD >= DRIP_FLOOR_YMD '2026-08-01'` satisfied. Dono sources line 633 ke `$in` me hain → -11 ka poora set hard-delete.

6. Ulta case bhi verify hota hai: agar original assigner non-owner-tier tha, task pehle 1038 `chainEligible` par filter ho jata tha (koi penalty nahi) aur completion par 632 par bahar hota tha. CEO heir aane par 632 par `taskEligible` **true** ho jata hai → Bob ko `assignedTaskOnTime` award (line 673-682 awardOnce) mil jata hai jo usne kabhi earn nahi kiya, aur scanOverdueTasks 1030+1038 se naye -5/-1 bhi shuru ho jate hain.

7. Koi rescue guard nahi hai: heir par sirf `isActive` aur `canAssignAny` check hai (user.service.js:350-357), koi tier constraint nahi. Frontend candidate list (delete-user-dialog.jsx:57-62) bhi sirf `taskAssign` par filter karta hai, tier par nahi. `taskEligible` ka `if (!ownerIds.size) return true` (557) bhi tabhi bachata hai jab company me koi CEO_PRESIDENT hi na ho.

8. Author ka apna test isi gap ko confirm karta hai: `backend/_tmp_handover_test.mjs` me `assignerDeleted` ke teen assertions (lines 92, 96, 109) hain par `onAssignedTaskDone` ka ek bhi zikr nahi — sirf daily housekeeping cover hui hai, award path nahi. Audit doc bhi yahi likhta hai ("daily housekeeping se nahi udte").

Intent #1 (doosre logon ke entries kabhi destroy na ho) aur intent #2 (assignerDeleted ke baad re-derive na ho) — dono violate.

**Correction:** Core bilkul sahi hai; teen precision fixes:

1. **Line numbers**: scanOverdueTasks ke liye finding 1031/1037 cite karti hai. Sahi lines **1030** (`Task.find({ assignedBy: { $ne: null }, status: 'PENDING', ... })` — wahi filter jo pehle orphan tasks ko scan se bahar rakhta tha) aur **1038** (`if (!(await chainEligible(t, ownerIds, chainMemo))) continue;`) hain. 1031 `ownerTierIds()` hai, 1037 ek comment line hai. Baaki saare citations (616, 619, 632, 633, 1709, user.service.js:364-367, task.service.js:366) exact hain.

2. **Gate ka shape**: line 632 single-task `taskEligible` nahi, poori chain par `copies.some((c) => taskEligible(c, ownerIds))` hai (copies = root + `collectChainCopies` ke descendants). Flat scenario (no forwarding, koi owner tagged nahi) me natija bilkul wahi hai jo finding kehti hai, par sahi wording ye hai: "chain ki **koi bhi** copy gate pass nahi karti". Iska matlab ye bhi hai ki blast radius **bada** hai — line 633 ka `$in: copies.map(c => c._id)` forward chain ki **saari** copies ke entries udata hai, yaani ek handover se ek se zyada logon ke points ja sakte hain, sirf Bob ke nahi.

3. **Ek aur affected site jo finding me nahi hai**: `rebuildOverdueForTask` (bonus.service.js:721-728) bhi `chainEligible` se re-derive karta hai aur uska early-return `if (!t || !t.assignedBy || ...)` line 726 par hai — bilkul 619 jaisa. Handover ke baad Bob agar task DONE→PENDING karta hai to `onAssignedTaskUndone` (697-698) unconditional `deleteMany` karta hai aur phir rebuild line 728 par non-owner heir ki wajah se return kar jata hai → penalties dobara kabhi nahi banti. (Note: is path ka deleteMany hissa pre-existing hai, handover se naya nahi bana — par fix karte waqt ise chhodna adhoora fix hoga.)

**Suggested fix:** Asli sawaal ye hai ki `assignerDeleted` ka matlab "eligible maan lo" nahi hona chahiye — matlab hona chahiye "faisla **freeze** ho chuka hai". Prune ne 1709 par shortcut liya (`assignerDeleted ? true`), jo tab safe tha jab handover exist hi nahi karta tha; ab wahi shortcut award path par copy karne se ulti disha (non-owner assigner → CEO heir) me un-earned points ban jayenge.

**Sahi aur sabse chhota fix — decision ko delete ke waqt freeze karo, phir sab jagah wahi padho:**

1. `backend/src/models/Task.js` me ek tri-state field: `assignerWasOwnerTier: { type: Boolean, default: null }`.

2. `backend/src/services/user.service.js` — dono jagah, handover block (364-367) aur orphan block (392), `assignedBy` badalne se **pehle** departing user ke role se ye compute karke likho:
   ```js
   const wasOwnerTier = ownerRoleKeys().includes(user.role);
   // handover:
   { $set: { assignedBy: heir._id, assignerDeleted: true, assignerWasOwnerTier: wasOwnerTier } }
   // orphan:
   { $set: { assignedBy: null, assignerDeleted: true, assignerWasOwnerTier: wasOwnerTier } }
   ```

3. `backend/src/services/bonus.service.js` — `taskEligible` (555) ko hi single source of truth banao, taaki har caller apne aap theek ho jaye:
   ```js
   function taskEligible(task, ownerIds) {
     if (!ownerIds.size) return true;
     if (task.assignerDeleted) {
       // Assigner ja chuka hai — award-time faisla freeze hai, dobara derive nahi hoga.
       // Tagged owner ab bhi apne aap jawab de sakta hai.
       if (task.assignerWasOwnerTier === true) return true;
       if (task.assignerWasOwnerTier === false) {
         return (task.collaborators || []).some((c) => ownerIds.has(String(c)));
       }
       return true; // legacy rows (flag se pehle delete hue) — purana lenient behaviour
     }
     if (task.assignedBy && ownerIds.has(String(task.assignedBy))) return true;
     return (task.collaborators || []).some((c) => ownerIds.has(String(c)));
   }
   ```

4. Jin projections me ab ye field chahiye, wahan add karo, warna `undefined` legacy branch me gir kar galat lenient ho jayega: 1030 (`.select(... 'assignedBy collaborators forwardedFrom')`), 1692, 1725 (`rebuildOverdueForTask` ka select), aur `chainEligible` ka parent fetch (line 578 `.select('assignedBy collaborators forwardedFrom')`) — sab me `assignerDeleted assignerWasOwnerTier` jodo.

5. `onAssignedTaskDone` (619) aur `rebuildOverdueForTask` (726) ke `!task.assignedBy` guards ko `(!task.assignedBy && !task.assignerDeleted)` karo, taaki bina-heir wale orphan tasks bhi ab chain-eligible hone par sahi tarah score/rebuild ho — aur na hone par bhi kuchh delete na ho.

6. Prune line 1709 ka `t.assignerDeleted ? true : await chainEligible(...)` ab hata do — naya `taskEligible` khud handle karta hai, to seedha `await chainEligible(t, ownerIds, chainMemo)` chalega aur poora system ek hi rule par aa jayega.

7. Test: `backend/_tmp_handover_test.mjs` me do case jodo jo abhi missing hain — (a) CEO assigner + **non-owner** heir + task DONE → Bob ke purane -5/-1 entries **survive** karein; (b) non-owner assigner + **CEO** heir + task DONE → Bob ko koi naya award **na mile** aur koi naya -5 mark na bane.

Agar sirf bleeding rokni ho (schema change ke bina, interim): line 632 ko `if (!copies.some((c) => c.assignerDeleted || taskEligible(c, ownerIds)))` kar do — isse data loss (RED half) turant band ho jata hai, par un-earned award wala ulta case khula reh jata hai, isliye ise permanent fix na maano.

---

## 10. [RED] deleteUser forward-chain ka parent copy bina cascade delete kar deta hai; child 'handed over' count hota hai par uske points hamesha ke liye mar jate hain

**Kahan:** `backend/src/services/user.service.js`:378 · reviewer: delete-path · verdict: CONFIRMED

**Claim:** `Task.deleteMany({ owner: uid })` deleted user ke apne copies uda deta hai, par unke forwarded CHILDREN ka `forwardedFrom` waise ka waisa reh jata hai — app ka apna delete path deliberately iska ulta karta hai (task.service.js:871 `collectForwardDescendants` + 880-886 cascade + notify). Naya reassign block ise chhupa deta hai: child copy `{assignedBy: uid, status:'PENDING', owner: {$ne: uid}}` filter me aata hai, isliye wo heir ko mil jata hai aur `handedOver` count me gina jata hai, jabki structurally wo copy ab kabhi pay nahi kar sakti — `onAssignedTaskDone` line 621 par `if (task.forwardedFrom) return;` se turant nikal jata hai (payout sirf ROOT karta hai), aur `settleParent` (task.service.js:558-561) missing parent par chupchaap return kar deta hai. `rescoreAllDoneAssigned` bhi `forwardedFrom: null` filter karta hai, to daily pass bhi ise kabhi theek nahi karega.

**Scenario:** CEO 'Vendor audit' manager Meena ko assign karti hai -> root R (owner Meena, assignedBy CEO, forwardedFrom null). Meena use Bob ko forward karti hai -> child C (owner Bob, assignedBy Meena, forwardedFrom R). Meena company chhod deti hai. Leadership Meena ko delete karti hai aur heir Ravi chunti hai. user.service.js:364-367 C ko match karta hai (assignedBy=Meena, PENDING, owner=Bob) -> C.assignedBy=Ravi, handedOver=1, toast bolta hai '1 open task moved to Ravi'. Turant baad line 378 R ko delete kar deta hai. Ab C ka forwardedFrom ek non-existent Task ko point karta hai. Bob C complete karta hai: onAssignedTaskDone line 621 par return -> Bob ko us kaam ke assignedTaskOnTime points KABHI nahi milte; settleParent parent na milne par chup reh jata hai, to chain upar band hi nahi hoti. UI, audit meta aur toast sab kehte hain kaam safely re-home ho gaya. Sahi fix: deleteMany se pehle chain ko deleteTask jaisa cascade karo (ya child ko root bana kar forwardedFrom null karo), warna ye 'handed over' figure jhooth hai.

**Verifier:** Maine poora chain padha aur mechanism paper par exactly reproduce ho gaya — finding sahi hai.

PROOF, step by step:

1) Handover filter `user.service.js:364-367` = `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }`. Forward-child C ka `assignedBy` forwarder hota hai (`task.service.js:527` — `assignedBy: actor._id`), aur uska owner koi aur hota hai. To har PENDING forward-child is filter me girta hai aur `handedOver` (line 368) me ginta hai.

2) Turant baad `user.service.js:378` — `Task.deleteMany({ owner: uid })` — bina kisi cascade ke deleted user ke saare copies uda deta hai. Yeh line diff me change nahi hui, lekin naya block iske theek upar chalta hai.

3) YEH EDGE CASE NAHI, STRUCTURAL HAI. `forwardTask` me guard hai `task.service.js:490` — `if (String(parent.owner) !== String(actor._id)) throw` — yaani sirf apni hi task forward kar sakte ho, aur child ka `assignedBy = actor._id` (`:527`). Iska matlab invariant hai: `child.assignedBy === parent.owner`. To JIS BHI forward-child ka `assignedBy = uid` hai, uska parent ka owner bhi uid hai → wo parent line 378 par guaranteed delete hoga. Yaani handover set ka HAR forwarded child 100% orphan hota hai. Scenario me diya CEO→Meena→Bob wala case exception nahi, rule hai.

4) Orphan pay nahi kar sakta: `bonus.service.js:621` — `if (task.forwardedFrom) return;` — non-root copy khud kabhi award nahi karta; payout sirf ROOT karta hai (`collectChainCopies` se poora tree ek saath). C ka `forwardedFrom` ab ek delete ho chuke Task ko point karta hai, aur `settleParent` `task.service.js:560-561` par `if (!parent || ...) return;` se chupchaap nikal jata hai. Daily self-heal bhi nahi bachata: `rescoreAllDoneAssigned` `bonus.service.js:1626` par `forwardedFrom: null` filter karta hai, aur `rescoreAssignedTasks` bhi sirf roots leta hai (`:1655`). To Bob kabhi bhi `assignedTaskOnTime` nahi paayega — na turant, na kal ke pass me.

5) App ka apna delete path deliberately ulta karta hai — finding ka yeh dawa bilkul sahi hai, aur uska proof mere paas dono jagah hai:
   - `deleteTask` `task.service.js:872` — "Collected BEFORE the delete so the links are still intact" + `:877-887` cascade + notify.
   - reassign path `task.service.js:693-716` — comment literally yehi bug describe karta hai: "someone they had passed the work down to kept a copy pointing at a parent that no longer existed: finishing it settled nothing".
   Sirf `deleteUser` bulk `deleteMany` karta hai — yahi gap hai.

6) Jhoot ka trail: `handedOver` → controller audit meta (`users.controller.js` diff, `meta: { handedOver, handedOverTo }`) → toast "N open tasks moved to X" (`delete-user-dialog.jsx` onSuccess) → dialog ka "Finished work keeps its original history — only the N open tasks move". Aur dialog ka figure bhi wahi hai: `exitSummary` `user.service.js:291` bilkul same filter use karta hai, to "Work they delegated, still open — needs a new owner" me bhi orphan children ginte hain.

Multi-level bhi tuta hai: CEO→Meena→Bob→Carol me Meena ki copy R hi ROOT thi (R.forwardedFrom = null, R.assignedBy = CEO). R delete hote hi Bob AUR Carol dono ka payout mar jata hai, chahe Carol ki copy handover set me thi hi nahi (uska assignedBy Bob hai).

**Correction:** Core sahi hai; teen cheezein theek karni hain:

(a) CITATIONS: `collectForwardDescendants` `task.service.js:618` par DEFINE hai, `:872` par deleteTask se call hota hai (finding ne 871 kaha — call site ke ek line off). Cascade loop `:877-887` hai (880-886 nahi). Sabse important: `onAssignedTaskDone` ka `if (task.forwardedFrom) return;` **bonus.service.js:621** hai, task.service.js:621 nahi — finding ka wording file ambiguous chhod deta hai.

(b) ATTRIBUTION: "points hamesha ke liye mar jate hain" pre-existing hai, is diff se NAHI aaya. Diff se pehle bhi R delete hota tha aur C orphan hota tha; C ka assignedBy detach step (`user.service.js:392`) se null ho jata tha, aur `bonus.service.js:619` (`if (!b.enabled || !task.assignedBy) return;`) payout waise hi rok deta tha. To point-loss purana hai — is diff ka NAYA nuksaan hai jhooti accounting (count + toast + audit meta + dialog copy) jo ek irreversible operation par claim karti hai ki kaam safely re-home ho gaya. Finding ka framing ("naya reassign block ise chhupa deta hai") isi wajah se sahi hai, par "yeh bug diff ne banaya" mat kehna.

(c) DIFF NE EK NAYA REGRESSION BHI ADD KIYA JO FINDING ME MISSING HAI — aur yeh RED ko justify karta hai:
   - `assignedBy = heir` set karne se orphan wapas overdue scan me aa jata hai. `scanOverdueTasks` `bonus.service.js:1030` ka filter hai `{ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: ..., _id: { $nin: forwardedParentIds } }` — orphan child leaf hai to `$nin` use nahi rokta, aur pehle `assignedBy: null` use bahar rakhta tha. Ab gate sirf `chainEligible` hai: agar heir owner-tier hai (CEO_PRESIDENT — leadership handover me sabse likely choice) to `taskEligible` `bonus.service.js:557` par TRUE ho jata hai. Result: Bob ko -5 overdue mark + har din -1 drip milta hai us task par jiska completion award structurally kabhi likha hi nahi ja sakta. Ek-tarfa loss — sirf minus, kabhi plus nahi. Diff se pehle yeh penalty impossible thi. (Heir non-owner-tier ho to `chainEligible` upar chalte waqt missing parent par `break` karke false deta hai — `bonus.service.js:576-579` — to penalty nahi lagti.)
   - Bob ab apni dead copy khud delete bhi nahi kar sakta: `deleteTask` `task.service.js:863-865` — `if (task.assignedBy && !isAssigner) throw 403 ASSIGNED_TASK`. Pehle assignedBy null tha to owner khud saaf kar sakta tha; ab wo phasa hua hai.

**Suggested fix:** Sabse chhota SAHI fix = orphan hone wale children ko ROOT bana do, delete mat karo (cascade-delete kisi aur ka chalta hua kaam maar dega — jo is feature ka poora ulta maqsad hai).

`user.service.js` me, handover updateMany (`:364`) se PEHLE (jab links abhi intact hain) aur `deleteMany` (`:378`) se pehle:

1. Deleted user ke apne copies ki ids nikalo: `const dyingIds = await Task.distinct('_id', { owner: uid });`
2. Un PENDING children ko promote karo jinka parent mar raha hai:
   `await Task.updateMany({ forwardedFrom: { $in: dyingIds }, status: 'PENDING' }, { $set: { forwardedFrom: null } });`
   (`originalAssignedBy` chhedna mat — wahi ek nishani bachti hai ki kaam kahan se aaya tha.)
   Ab wo copy khud ROOT hai: complete hone par `onAssignedTaskDone` line 621 se nahi nikalta, `collectChainCopies` uske neeche wale (Carol jaise) sabko ek saath pay karta hai, aur `rescoreAllDoneAssigned` ka `forwardedFrom: null` filter bhi use dobara pakad leta hai.
3. Iske baad hi handover updateMany chalao, taki `handedOver` me sirf wahi gine jayein jo sach me kaam de sakte hain.
4. DONE children ko mat chhedo — unka `forwardedFrom` waisa hi rehne do; unke entries `pruneOrphanTaskEntries` ke `assignerDeleted` arm (`bonus.service.js:1691, 1709`) se pehle se surakshit hain, aur settled points ko re-price karna khatarnak hai (design intent #3).

Agar promotion abhi nahi karna, to kam se kam count jhooth na bole: `handedOver` se un tasks ko ghatao jinka `forwardedFrom` `dyingIds` me hai, aur dialog me alag se batao ki itni forwarded copies ka chain toot raha hai. Bina 2-step ke, toast/audit dono ek irreversible delete par galat record chhod rahe hain.

Bonus (chhota, par isi block me): heir owner-tier ho to promotion ke bina wo orphan ab penalty khaata hai — step 2 se yeh apne aap theek ho jata hai, kyunki root ban-ne ke baad completion award bhi likha ja sakta hai.

---

## 11. [RED] Heir ko un logon par assigner-authority mil jati hai jinhe wo assign karne ka haqdaar hi nahi — guard canAssignAny hai, canAssignTo nahi

**Kahan:** `backend/src/services/user.service.js`:355 · reviewer: delete-path · verdict: CONFIRMED

**Claim:** Heir ka check `canAssignAny(heir)` hai (task.service.js:89), jo sirf itna poochta hai ki heir KISI-NA-KISI ko assign kar sakta hai ya nahi. Jo tasks move ho rahe hain unke owners arbitrary log hain, aur per-person delegation ACL `canAssignTo` (task.service.js:80) hai — jo yahan kabhi call hi nahi hota. Assigner ban jaane se heir ko un tasks par asli power mil jati hai: deleteTask (task.service.js:862-864) assigner ko delegated task delete karne deta hai, aur reviewTask (task.service.js:390) assigner ko submitted work approve/reject karne deta hai. Frontend candidate filter (delete-user-dialog.jsx:57-62) bhi bilkul yahi kamzor check mirror karta hai, isliye UI bhi galat logon ko offer karta hai.

**Scenario:** Ravi ka taskAssign = {mode:'SELECTED', users:[Sana]} — leadership ne use SIRF Sana ko kaam dene ka access diya tha. Deleted CEO ke 12 open delegated tasks hain: Bob, Neha aur Imran par. Delete dialog Ravi ko candidate dikhata hai (mode SELECTED + users.length > 0 -> pass), backend line 355 bhi pass kar deta hai. Handover ke baad Ravi teenon ke 12 tasks par assignedBy hai. Ab Ravi Bob ka task deleteTask se uda sakta hai -> wo onAssignedTaskUndone call karta hai -> bonus.service.js:698 `PointEntry.deleteMany({taskRef, source:{$in:['auto_task','auto_forward']}})` yaani Bob ke us task ke points bhi khatam. Ravi Neha ka approval-gated submission reject bhi kar sakta hai. In teenon par Ravi ko kabhi koi authority nahi di gayi thi. Sahi guard: sirf wahi heir allow karo jo har affected owner ke liye canAssignTo(heir, owner) pass kare (ya jinke liye pass na kare unke tasks skip karo aur count me alag dikhao).

**Verifier:** Mechanism paper par poora reproduce hota hai; koi mitigating guard kahin nahi mila.

1. Guard sach me sirf canAssignAny hai. backend/src/services/user.service.js:355 -> `if (!canAssignAny(heir))`. canAssignAny (backend/src/services/task.service.js:89-92) sirf itna poochta hai: `ta.mode === 'ALL' || (ta.mode === 'SELECTED' && (ta.users||[]).length > 0)` — kis PAR assign kar sakte ho, ye poochta hi nahi. Per-person ACL canAssignTo (task.service.js:80-86) handover path me kabhi call nahi hota: `grep canAssignTo|canAssignAny` ke saare hits = task.service.js:80,89,98,153,510,678 aur user.service.js:20,355. Yaani baaki har delegation write-path par ACL lagta hai (create 153, forward 510, batch-add 678) — sirf ye naya path use bypass karta hai.

2. Move ka scope arbitrary owners hai. user.service.js:369-372: `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Owner par koi filter nahi — heir un sab ka assigner ban jaata hai.

3. Assigner ban-ne se milne wali asli power confirm hui:
   - task.service.js:861-867 — `isAssigner` true hone par delegated task ko hard-delete kar sakta hai (`task.deleteOne()` line 875), aur line 869-886 poora forward-descendant chain bhi delete karta hai (aur bhi doosre logon ke tasks).
   - task.service.js:389-390 — `if (!isAssigner) throw` => heir ab submitted work approve/reject kar sakta hai.
   - task.service.js:641-644 + 653-654 — assigner delegated task ka title/notes/dueYMD edit kar sakta hai, aur batchQuery `{ assignBatch, assignedBy: actor._id }` ab heir ko match karta hai, to wo batch se kisi member ko nikaal ke uski PENDING copy delete bhi kar sakta hai (line ~688 aage ka else-branch).
   - task.service.js:875-876 -> onAssignedTaskUndone -> bonus.service.js:697-698 `PointEntry.deleteMany({ taskRef, source: { $in: ['auto_task','auto_forward'] } })` — doosre bande ki PointEntry rows.

4. Route-level koi backstop nahi. backend/src/routes/tasks.routes.js:9-11 khud kehta hai "there is no role-permission gate here"; `remove`/`review` ke liye sirf requireAuth hai.

5. Frontend bhi wahi kamzor check mirror karta hai — website/components/users/delete-user-dialog.jsx:56-62, predicate line 61 par literally canAssignAny ki copy hai. Aur ye data pahunchta bhi hai: listUsers (backend/src/controllers/users.controller.js:60-67) raw `u.toJSON()` bhejta hai aur User.js:59-71 sirf passwordHash strip karta hai, to taskAssign client tak jaata hai. Yaani UI genuinely galat candidates offer karta hai (refute nahi hua).

Circular-import se guard crash ho jaata ho — ye bhi check kiya: task.service.js:1-9 user.service import nahi karta aur bonus.service.js sirf holiday.service import karta hai, to cycle nahi hai, canAssignAny normally resolve hota hai aur guard sach me PASS karta hai.

Design intent #1 ("delete kabhi doosron ki point entries destroy na kare") is path se second-order tor par toota hai: delete khud entries nahi maarta, lekin delete ke through banaya gaya heir un entries ko maar sakta hai jinke liye use kabhi authority nahi di gayi thi.

**Correction:** Core sahi hai; teen detail durust karni hain.

(a) Scenario ka points-loss step abhi PENDING task par galat kism ki entries batata hai. Handover ke waqt task PENDING hai, aur positive auto_task award sirf DONE par likha jaata hai (bonus.service.js:659-669). PENDING task par jo auto_task rows hoti hain wo OVERDUE PENALTIES hain (bonus.service.js:743 one-time mark, 751 daily drip — dono `source: 'auto_task'`, negative). To Ravi ka delete un negative rows ko udayega (Bob ko fayda), positive kamaye hue points ko nahi. Positive-points wipe wala variant tab valid hai jab Bob task DONE kar chuka ho aur wo award bacha ho. Note: us variant me ek aur pech hai — handover ke baad assignedBy = Ravi (non owner-tier) hai aur onAssignedTaskDone ka taskEligible (bonus.service.js:632, 555-559) assignerDeleted ko honour NAHI karta (jabki pruneOrphanTaskEntries karta hai, bonus.service.js:1709), to jab tak chain par koi owner-tier collaborator tagged na ho, line 633 wahi entries pehle hi delete kar dega. Yaani positive-points scenario ke liye "owner-tier tagged" condition add karo, warna wo alag bug me merge ho jaata hai.

(b) Finding blast radius ko chhota bata raha hai. deleteTask sirf us ek task ko nahi maarta — task.service.js:869-886 `collectForwardDescendants` se poora forward chain delete karta hai aur har descendant par onAssignedTaskUndone chalata hai. Yaani Ravi ke ek delete se un logon ka kaam+entries bhi jaate hain jo chain me do hop neeche hain aur jinka naam handover me kabhi aaya hi nahi.

(c) Ek boundary jo finding me nahi hai (aur jo severity ko RED se neeche nahi laati, par accuracy ke liye zaroori hai): heir ki power fully unbounded nahi. Re-delegation par ACL abhi bhi lagta hai — forward par canAssignTo (task.service.js:510) aur batch me naye log add karne par canAssignTo (task.service.js:678). To Ravi in tasks ko arbitrary logon ko re-assign nahi kar sakta; wo unhe delete / review / edit / batch-se-nikaal sakta hai. Escalation delete+review+edit tak seemit hai, "poori assigner power" nahi.

Line-number nit: frontend filter expression 56-62 par hai (taskAssign predicate line 61); deleteTask ka guard 861-867 (isAssigner 861, throw 864-866); reviewTask ka guard 389-390.

**Suggested fix:** Handover ko per-owner ACL se baandho, blanket canAssignAny se nahi. backend/src/services/user.service.js:355 ke aas-paas:

1. Pehle affected set nikaalo, phir uske distinct owners:
   `const affected = await Task.find({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }).select('_id owner');`
   `const ownerIds = [...new Set(affected.map(t => String(t.owner)))];`
   `const owners = await User.find({ _id: { $in: ownerIds } }).select('_id name');`
2. canAssignAny(heir) ki jagah per-owner canAssignTo lagao (task.service.js se canAssignTo bhi import karo, line 20):
   `const allowedOwners = new Set(owners.filter(o => canAssignTo(heir, o)).map(o => String(o._id)));`
3. Do options me se koi ek chuno (behaviour ka decision owner ka hai):
   - STRICT: agar `allowedOwners.size !== ownerIds.length` to 400 throw karo, message me un logon ke naam do jinke liye heir authorised nahi (`${heir.name} isn't allowed to assign work to Bob, Neha` type).
   - PARTIAL (better UX): sirf allowed owners ke tasks move karo —
     `const res = await Task.updateMany({ _id: { $in: affected.filter(t => allowedOwners.has(String(t.owner))).map(t => t._id) } }, { $set: { assignedBy: heir._id, assignerDeleted: true } });`
     aur return me `handedOver` ke saath `skipped` (+ `skippedOwners` names) bhi bhejo, taaki 375 line wala `return { success: true, handedOver, handedOverTo }` jhooth na bole. Baaki (skipped) tasks neeche wala detach-block (user.service.js:391) waise hi `assignedBy: null, assignerDeleted: true` kar dega — wahi purana behaviour, jo safe hai.
   Note: canAssignTo(heir, owner) khud hi `heir._id === owner._id` par false deta hai (task.service.js:81), to heir ke apne PENDING tasks kabhi galti se re-home nahi honge.

4. Frontend ka client-side filter delete karo — wo authority ka faisla client par nahi ho sakta. delete-user-dialog.jsx:56-62 ki jagah backend se candidate list lo: ek naya endpoint `GET /users/:id/reassign-candidates` jo upar wala affected-owners set nikaal kar sirf wahi active users lautaye jo har (ya PARTIAL mode me kam-se-kam ek) affected owner ke liye canAssignTo pass karte hain, aur har candidate ke saath `covers: N / skips: M` bataye. Dialog usi list ko render kare aur "X tasks move honge, Y unassigned rah jaayenge" saaf dikhaye.

5. Regression test (isolated-DB pattern, MONGODB_DB override + dropDatabase): heir.taskAssign = {mode:'SELECTED', users:[Sana]}, deleted user ke 3 PENDING tasks Bob/Neha ke owned ho -> deleteUser({reassignTasksTo: heir}) ke baad assert karo ki un teeno par `assignedBy === null` (ya STRICT me 400 throw) hai, heir nahi.

---

## 12. [MEDIUM] Handover aur deletion ek transaction me nahi hain — partial failure par audit ulta jhoot bol deta hai

**Kahan:** `backend/src/services/user.service.js`:364 · reviewer: delete-path · verdict: CONFIRMED

**Claim:** Line 364 ka `Task.updateMany` apne aap commit ho jata hai; uske baad line 373-384 ka deleteMany block, 387-399 ka detach block aur line 401 ka `user.deleteOne()` alag-alag writes hain — koi session/transaction nahi. Intent #4 ('rejected handover kisi ko aadha-delete na kare') sirf ek taraf se poora hota hai (validation reassign se pehle throw karti hai); ulta side khula hai — handover commit ho chuka aur deletion fail. Aur controller ka audit (users.controller.js:147-150) sirf success par likhta hai, isliye us window me record kahin nahi banta. Retry par record ACTIVELY galat ho jata hai, kyunki reassign query `{assignedBy: uid}` ab 0 rows match karegi.

**Scenario:** Ravi ko heir bana kar CEO ka account delete kiya jata hai; line 364 turant 14 tasks par assignedBy=Ravi, assignerDeleted=true likh deta hai. Iske baad ka Promise.all (line 373-384) Lambda ke 30s timeout me maara jata hai (is codebase me ye documented real incident hai — bonus.service.js:1618-1623 ka comment). Result: 14 tasks par Ravi ka naam + assignerDeleted=true, jabki account abhi zinda hai (sirf inactive). Audit kuch nahi likhta. Leadership dobara Delete dabati hai: ab `{assignedBy: uid, status:'PENDING'}` 0 match karta hai -> handedOver=0 -> toast sirf 'User deleted', aur AuditLog meta me `{reassignTasksTo: '<ravi-id>', handedOver: 0, handedOverTo: ''}` — yaani permanent record 14 tasks ke move ko deny karta hai, exactly wahi cheez jise controller ke comment (line 145-146) ne 'months later ye hi samjhayega' bol kar justify kiya tha. Beech ki window me prune (bonus.service.js:1709) un tasks ko force-eligible bhi maan leta hai jabki unka assigner (Ravi) bilkul zinda aur re-derivable hai. Kam se kam: reassign se pehle audit likho (ya failure par audit likho), aur retry par 'pehle se move ho chuke' tasks ko `assignerDeleted:true, assignedBy:{$ne:uid}` se detect karke report karo.

**Verifier:** Core mechanism paper par reproduce ho gaya, har step code se proved:

1. **Koi atomicity nahi, aur ye choice nahi majboori bhi nahi.** `backend/src/services/user.service.js:364-367` ka `Task.updateMany` apne aap commit hota hai; uske baad `373-384` (10 deleteMany), `387-399` (7 updateMany) aur `401` (`user.deleteOne()`) sab alag writes hain — koi session pass nahi hota. Refute karne ki koshish me maine dekha ki codebase me transaction helper MAUJOOD hai: `backend/src/lib/transaction.js:16` (`runTransaction`), aur `backend/src/services/leave.service.js:841` + `:1169` use bhi karte hain. To "is deployment me transactions nahi chalte" wala defence bhi nahi bachta.

2. **Query self-consuming hai — yahi asli jad hai.** Filter `{ assignedBy: uid, status:'PENDING', owner:{$ne:uid} }` (line 365) chalte hi `assignedBy` overwrite kar deta hai. Task par kahin bhi original assigner ka koi nishaan nahi bachta (`$set` sirf `assignedBy` + `assignerDeleted` likhta hai, line 366). Matlab operation idempotent nahi hai aur retry un 14 tasks ko dhoondh hi nahi sakta.

3. **Audit sirf success par.** `backend/src/controllers/users.controller.js:147-150` service resolve hone ke BAAD chalta hai. Maine check kiya ki `audit()` khud throw karta hai kya — nahi, `backend/src/models/AuditLog.js:22-26` apni error swallow karta hai. Iska seedha matlab: audit skip hone ka ekmatra raasta hi service ka fail hona hai — yaani theek wahi partial-failure window.

4. **Failure realistic hai.** 30s Lambda timeout `backend/DEPLOY-AWS.md:59` par documented hai, aur usi timeout ka incident `bonus.service.js:1621-1624` me likha hua hai. Delete path 18 collection ops karta hai (multi-year `Attendance.deleteMany` sabse bhaari) — timeout/Atlas failover plausible hai.

5. **Retry par record ACTIVELY jhoot bolta hai.** `handedOver = 0` -> toast `delete-user-dialog.jsx:70-75` sirf "User deleted" bolta hai, aur AuditLog meta 14 tasks ke move ko deny karta hai — theek wahi cheez jise controller comment (145-146) "months later ye hi samjhayega" kehkar justify karta hai.

Refutation attempts jo FAIL huye: DELETE body plumbing zinda hai (`express.json` `backend/src/app.js:34` method-agnostic hai; `website/lib/api.js:109` body forward karta hai), to feature reachable hai. Frontend retry bhi reachable hai — `onError` sirf toast karta hai (`delete-user-dialog.jsx:80`), dialog mounted rehta hai (`users-directory.jsx` ab `{deleting ? <DeleteUserDialog/> : null}`).

**Correction:** Char corrections — core sahi, details me do galtiyan, ek sub-claim drop, aur ek missed consequence jo finding se ZYADA strong hai:

**(a) Quoted meta triple impossible hai.** Finding kehti hai retry par meta `{reassignTasksTo: '<ravi-id>', handedOver: 0, handedOverTo: ''}`. Ye shape ban hi nahi sakta: `handedOverTo = heir.name` line 369 par `if (reassignTasksTo)` block ke andar UNCONDITIONALLY set hota hai, `modifiedCount` dekhe bina. Do asli shapes hain, dono galat:
- heir dobara select karke retry -> `{reassignTasksTo: ravi-id, handedOver: 0, handedOverTo: 'Ravi'}`
- bina heir retry -> `{reassignTasksTo: null, handedOver: 0, handedOverTo: ''}`

**(b) MISSED, aur ye finding se bada hai — UI bhi jhoot bolta hai, sirf audit nahi.** `exitSummary` (`user.service.js:291`) BILKUL wahi query use karta hai: `Task.countDocuments({ assignedBy: userId, status:'PENDING', owner:{$ne:userId} })`. Partial failure ke baad ye 0 return karta hai. Nateeja: dialog reopen par "Work they delegated, still open: 0" dikhta hai aur poora heir selector gayab ho jata hai (`delete-user-dialog.jsx:138` ka `delegated > 0` gate). Leadership ko bataya jata hai ki handover karne ko kuch bacha hi nahi, jabki 14 tasks pehle hi Ravi par chipak chuke hain. Isse bhi kharab: `heir` state sirf `open` badalne par reset hota hai (`delete-user-dialog.jsx:37-39`), to agar query dialog khule rehte hi refetch ho (react-query `refetchOnWindowFocus`), selector gayab ho jata hai par mutation phir bhi `{reassignTasksTo: ravi-id}` post karta hai — ek invisible parameter.

**(c) MISSED — sirf missing record nahi, asli ownership drift.** Stale dialog par retry me DUSRA heir (Priya) chuno: query 0 match karti hai, tasks Ravi par hi rehte hain, audit Priya likhta hai, toast kuch nahi bolta. Leadership samajhti hai Priya owner hai; data me Ravi hai.

**(d) Prune wala sub-claim DROP karo — ye galat hai.** Finding kehti hai window me `bonus.service.js:1709` un tasks ko force-eligible maan leta hai "jabki assigner zinda hai". Par successful handover me bhi state bilkul yahi banti hai (`assignedBy: Ravi` + `assignerDeleted: true`) — design intent #2 ke mutabik jaanbujh kar. Prune original assigner ko consult karta hi nahi (wo reference handover ke waqt hi mit chuka hota hai). Aur direction conservative hai: line 1716 entries tab delete karta hai jab eligible NAHI ho, to force-eligible points ko BACHATA hai. Yahan koi point-loss nahi.

**(e) Severity MEDIUM sahi hai, par wajah precisely likho.** Retry ke baad DATA end-state actually SAHI hai: detach block (line 392) ka `{assignedBy: uid}` bhi ab 0 match karta hai, to 14 tasks Ravi par `assignerDeleted:true` ke saath baithe rehte hain — yahi intended outcome hai. Toota hua hissa record + operator ki samajh hai, points nahi. Kisi doosre ki `PointEntry` nashṭ nahi hoti, to intent #1 safe hai.

**(f) Headline "transaction me nahi hai" actionable fix ke taur par galat hai.** Poore delete ko `runTransaction` me lapetna bura minimal fix hai: 10 deleteMany + 7 updateMany + deleteOne ek transaction me — lambe tenure wale user ke `Attendance` rows Mongo ki 16MB oplog-entry limit / 60s transaction lifetime paar kara sakte hain, yaani aaj ka occasional partial-failure kal ka permanent failure ban jayega. Upar se `transaction.js:25-26` non-replica-set par chupchaap `fn(null)` par gir jata hai, to wrapping local par atomicity guarantee deti bhi nahi. Finding ka apna "kam se kam" clause hi sahi raasta hai.

**Suggested fix:** Teen chhote badlaav, transaction ke bina:

**1. Task par original assigner ko record karo (asli root cause).** `user.service.js:366` ke `$set` me ek field aur jodo, taaki `uid` tak wapas jaane ka link na mite:
```js
{ $set: { assignedBy: heir._id, assignerDeleted: true, assignedByOriginal: uid } }
```
(`backend/src/models/Task.js` me `assignedByOriginal: { type: ObjectId, ref: 'User', default: null }` — wahi jagah jahan `assignerDeleted` add hua tha.)
Isse teen cheezein ek saath theek hoti hain: (i) retry `{ assignedByOriginal: uid, status: 'PENDING' }` se pehle-se-move-ho-chuke tasks dhoondh sakta hai aur `handedOver` me unhe count/report kar sakta hai (0 ki jagah "already moved to X"); (ii) `exitSummary:291` usi `$or` se count kar sakta hai, to dialog "0 delegated" ka jhoot nahi bolega; (iii) controller comment (145-146) ka jo vaada hai — "months later ye hi samjhayega ki task par aisa naam kyun hai jisne banaya hi nahi" — wo ab task ke andar se hi verify ho jayega, sirf AuditLog par bharosa nahi karna padega.

**2. Audit ko unconditional karo.** `users.controller.js:143-151` me `audit()` ko `finally` (ya catch) me le jao, failure par `action: 'user.delete.failed'` ke saath, aur `reassignTasksTo` hamesha carry karo. `audit()` pehle se apni errors swallow karta hai (`AuditLog.js:22-26`), to catch block me isse koi naya failure risk nahi.

**3. Dialog me heir ko delegated ke saath reset karo.** `delete-user-dialog.jsx:37-39` ka effect `delegated` par bhi depend kare (`if (open && delegated === 0) setHeir(NOBODY)`), taaki selector gayab hone par chhupa hua `reassignTasksTo` post na ho.

Agar atomicity chahiye hi, to poora delete lapetne ke bajay sirf handover + `deleteOne` ko ek `runTransaction` me rakhna theek nahi hoga (beech ke deleteMany bahar reh jayenge) — behtar hai step 1 wali forward-recoverable approach, jo retry-safe hai aur transaction size limits se nahi takrati.

---

## 13. [MEDIUM] exit-summary fail hone par dialog handover ka sawaal hi nahi poochta, aur Delete button enabled rehta hai

**Kahan:** `website/components/users/delete-user-dialog.jsx`:64 · reviewer: delete-path · verdict: CONFIRMED

**Claim:** `delegated = exit?.openTasksDelegated ?? 0` (line 64) query fail hone par 0 ban jata hai. Poora picker block line 138 ke `delegated > 0` par gated hai, aur Delete button sirf `exitLoading` par disable hota hai (line 113) — error state par nahi. Component me koi `isError` branch hai hi nahi, aur `rows` khali array ho jata hai (line 83-100), to summary box bina kisi error message ke bilkul khali render hota hai. Feature ka pura maqsad 'ye sawaal usi lamhe pooch lo' hai — aur exactly usi lamhe wo sawaal chupchaap gayab ho jata hai.

**Scenario:** Leadership ek departing user par Delete kholti hai. `/users/:id/exit-summary` 500 deta hai (ya user ka network ek pal ke liye toot jata hai). isLoading false, data undefined -> delegated=0 -> koi dropdown nahi, koi warning nahi, summary box khali. Delete button enabled hai, wo click karti hain -> body `{}` jata hai -> backend reassign block skip -> user.service.js:392 saare 14 open delegated tasks par assignedBy=null. 14 tasks assignees ki list me bina kisi naam ke reh jate hain, aur toast sirf 'User deleted' bolta hai. Sahi behaviour: exit query error par Delete disable karo (ya kam se kam 'kya khula hai ye check nahi ho paya' warning + explicit confirm), aur delegated count fetch na ho paane par handover ka sawaal skip mat karo.

**Verifier:** Maine refute karne ki poori koshish ki (global QueryCache onError, error boundary, AppDialog ka apna error state, parent ka guard) — aisa koi safety net hai hi nahi. Har link chain ka verify hua:

1. `api.get` non-2xx par `ApiError` THROW karta hai (website/lib/api.js, `request()` ka `if (!res.ok || payload.ok === false) throw new ApiError(...)`). To 403/500 par query error state me jaati hai, `data` undefined rehta hai.
2. delete-user-dialog.jsx:43-47 me query se sirf `{ data: exit, isLoading: exitLoading }` nikala gaya hai. `isError`/`error`/`refetch` destructure hi nahi hue — poore component me `isError` shabd hi nahi hai (grep se confirm).
3. react-query v5 me error ke baad `isLoading = isPending && isFetching` → false. To line 121 ka `exitLoading ?` branch chhod deta hai, aur line 83-100 ka `exit ? [...] : []` khali array deta hai → line 124-134 ek khali `<dl>` render karta hai. Result: rounded box, ring, padding, andar kuch bhi nahi. Koi error text nahi, koi retry nahi.
4. Line 64 `const delegated = exit?.openTasksDelegated ?? 0` → 0. Line 138 ka `delegated > 0` gate false → picker, warning, sab gayab.
5. Line 113 `disabled={mut.isPending || exitLoading}` — error par dono false → Delete button ENABLED.
6. Click karne par line 68 `heir === NOBODY ? {}` → body `{}`. Backend users.controller.js `const heir = req.body?.reassignTasksTo || null` → null → user.service.js:339 ka `if (reassignTasksTo)` block skip. Fir user.service.js:392 `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })` saare open delegated tasks ko be-naam kar deta hai. `handedOver` 0 rehta hai to toast sirf 'User deleted' (line 74).

Yaani exactly wahi lamha jiske liye ye feature banaya gaya — "ye sawaal usi waqt pooch lo" — chupchaap gayab ho jata hai, aur delete purane (pre-change) behaviour par gir jata hai bina kisi ko bataye.

**Correction:** Core bilkul sahi hai. Teen corrections/strengthenings:

(a) SABSE BADI — ye sirf "kabhi-kabhaar 500" nahi hai, ek plausible role ke liye ye HAMESHA hota hai. Routes me permission split hai:
  - backend/src/routes/users.routes.js:39 → `GET /users/:id/exit-summary` needs `deactivateUsers`
  - backend/src/routes/users.routes.js:46 → `DELETE /users/:id` needs `manageUsers`
Ye do alag, independently toggle-able permissions hain (backend/src/lib/permissionCatalog.js:53, aur routes.js:44 ka apna comment kehta hai "the granular toggles are real"; permissions DB-driven hain — permissions.js `can()` `getRolePermissionSet(role)` padhta hai). Frontend Delete menu item bhi sirf `canManage` par gated hai (users-directory.jsx:49, :166), `canDeactivate` par nahi. To `manageUsers` = ON, `deactivateUsers` = OFF wale kisi bhi custom role ke liye exit-summary har baar 403 deta hai → khali box, handover ka sawaal kabhi nahi dikhta, Delete hamesha enabled. Ye deterministic hai, race nahi.

(b) "network ek pal ke liye toot jata hai" — default `retry: 1` hai (website/lib/queryClient.jsx:13), to ek retry ke baad hi ye state banti hai. Ek-frame ka blip apne aap recover ho jayega; 403/500/sustained outage nahi.

(c) Khali box sirf handover ka sawaal nahi chhupata — poori offboarding checklist chhupata hai, jisme DUES ka warning bhi hai (line 89-97: `duesPending > 0` par note "settle before deleting"). Aur delete un dues rows ko hard-delete karta hai — user.service.js:383 `LedgerEntry.deleteMany({ person: uid })`. To error path me leadership ₹X pending dues wale banda ko bina wo figure dekhe delete kar sakti hai aur ledger record bhi chala jata hai.

(d) Codebase me pattern pehle se maujood hai jo ye naya component skip kar gaya: `website/components/glass/query-error.jsx` ("Render this instead whenever `isError` is set and there is no cached data"), aur khud parent users-directory.jsx:55 `isError, error, refetch` use karta hai. Ye convention drift hai, oversight-by-omission.

(e) Chhota related gap: `usersData` query (line 49-53) ka bhi koi error branch nahi. Wo fail ho to `candidates` (line 57) khali → dropdown me sirf "Nobody" dikhta hai, jaise sach me koi eligible banda hi na ho. Practice me ye ['users'] cache parent se aata hai isliye kam risky hai, par silent-empty ka wahi pattern hai.

**Suggested fix:** Sabse chhota sahi fix teen tukdon me:

1. Root cause (backend, 1 line) — exit-summary ko delete-capable actor ke liye reachable banao:
   backend/src/routes/users.routes.js:39 → `requirePermission('deactivateUsers')` ko `requireAnyPermission('deactivateUsers', 'manageUsers')` karo (`requireAnyPermission` pehle se import hai, line 3, aur line 45 par isi tarah use hota hai). Isse `manageUsers`-only role ka deterministic 403 khatam.

2. Dialog error state (delete-user-dialog.jsx) — query se `isError, error, refetch` bhi lo (line 43), aur line 121 ke conditional me teesra branch daalo:
   `exitLoading ? <Checking…> : exitError ? <inline error + Retry (ya <QueryError/> from '@/components/glass/query-error')> : <dl>…`
   Message wahi bole jo sach hai: "Kya khula hai ye check nahi ho paya — delegated tasks ka handover offer nahi kiya ja sakta."

3. Delete button ko error par band karo (line 113):
   `disabled={mut.isPending || exitLoading || exitError}` — ya agar override chahiye to explicit acknowledge checkbox ("Bina check kiye delete karo") ke peeche rakho. Blind-enabled nahi.

Bonus (optional): line 49 wali users query ke liye bhi ek `usersError` flag rakh kar picker me "Ye list load nahi hui" dikhao, taaki khali dropdown ko "koi eligible nahi hai" na samjha jaye.

---

## 14. [RED] 'Nobody' chunne par tagged collaborator delegated task ko reopen karke doer ke points uda sakta hai — dialog ka wada iske ulta hai

**Kahan:** `website/components/users/delete-user-dialog.jsx`:157 · reviewer: delete-path · verdict: CONFIRMED

**Claim:** Dialog 'Nobody — leave them unassigned' ko benign bata kar likhta hai 'Points already earned on them are kept' (line 157-166). Par orphaning `assignedBy=null` set karti hai (user.service.js:392), aur setStatus us null ko 'ye shared PERSONAL task hai' ke roop me padhta hai: `const sharedPersonal = !task.assignedBy;` (task.service.js:276) aur guard `if (!isOwner && !(isCollaborator && sharedPersonal))` (line 277). Yaani delete ke baad us task par tagged koi bhi collaborator status flip kar sakta hai — jo delete se pehle bilkul mana tha (delegated task par tagging sirf awareness ke liye hai, wahi comment line 272-275 me likha hai). Reopen `onAssignedTaskUndone` call karta hai jo bonus.service.js:698 par us task ki auto_task/auto_forward entries delete kar deta hai.

**Scenario:** CEO ne 'Client deck' Bob ko assign kiya tha aur Priya ko collaborator tag kiya tha. Bob use complete kar chuka hai, uske +10 assignedTaskOnTime points August me file hain. CEO ka account 'Nobody' ke saath delete hota hai -> task ka assignedBy=null, assignerDeleted=true. Ab Priya (owner nahi, sirf tagged) task ko PENDING par flip kar sakti hai: pehle 403 milta tha, ab sharedPersonal true hone ki wajah se guard pass ho jata hai -> onAssignedTaskUndone -> Bob ke +10 delete. Bob ki August standing badal jati hai aur usne kuch kiya bhi nahi. Named-heir path is se bacha leta hai (assignedBy truthy rehta hai), isliye 'Nobody' ka warning text kam se kam ye bataye ki task collaborators ke liye shared-personal ban jayega — ya orphaned tasks ke liye sharedPersonal ko `!assignedBy && !assignerDeleted` karo.

**Verifier:** Mechanism paper par poori tarah reproduce ho gaya — har link verify kiya, koi bhi guard beech me nahi aata.

Chain (jo maine actually padha):
1. Delegated task par collaborators reh sakte hain: createTask assignee copies ko `collaborators` ke saath banata hai (backend/src/services/task.service.js:163-178) — "Tagged colleagues are for awareness... They ride on every copy".
2. Bob ka +10 PointEntry: onAssignedTaskDone `awardOnce('auto_task:<taskId>', { user: copy.owner, source: 'auto_task', taskRef: copy._id, ... })` likhta hai (bonus.service.js:668-693).
3. CEO delete hone par task Bob ka hai (owner=Bob), isliye `Task.deleteMany({ owner: uid })` (user.service.js:378) use nahi chhoota; detach step usi task ka assigner uda deta hai — `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })` (user.service.js:392).
4. Ab setStatus me `const sharedPersonal = !task.assignedBy;` true ho jata hai (task.service.js:276) aur guard `if (!isOwner && !(isCollaborator && sharedPersonal))` (task.service.js:277) Priya ko pass kar deta hai. Delete se pehle yahi call 403 deti thi — comment (task.service.js:272-275) khud kehta hai delegated task par collaborator ko "complete... or reopen" nahi karna chahiye.
5. Priya PENDING bhejti hai: no-op guard nahi lagta (DONE -> PENDING, task.service.js:294), `awaitingApproval` DONE task par false hai (Task.js:51-53), approval branch bhi `task.assignedBy` maangta hai (task.service.js:314) jo ab null hai. Seedha `task.status = 'PENDING'` (task.service.js:344) aur phir `onAssignedTaskUndone(task._id)` (task.service.js:367).
6. onAssignedTaskUndone `PointEntry.deleteMany({ taskRef: taskId, source: { $in: ['auto_task','auto_forward'] } })` chalati hai (bonus.service.js:698) — Bob ka +10 gaya.

Aur ye sirf UI se ek tap me hota hai, API craft karne ki zaroorat bhi nahi: client ka mirror `const canCompleteTask = (t, myId) => iOwnTask(t, myId) || !t?.assignedBy;` (website/components/tasks/task-board.jsx:82) hai, Tagged tab har status fetch karta hai (`const status = tab === 'history' ? 'DONE' : '';` task-board.jsx:846, scope 'tagged' = `{ collaborators: actor._id, owner: { $ne: actor._id } }` task.service.js:944), aur row ka circle "Mark as not done" label ke saath enabled render hota hai (task-board.jsx:296, 311).

Design intent #1 ka seedha ulanghan: delete ke baad ek non-owner doosre insaan ki earned points mita sakta hai, aur dialog ka wada (delete-user-dialog.jsx:162 "Points already earned on them are kept") galat sabit hota hai.

**Correction:** Core sahi hai, par teen important details galat/adhoore hain:

1) "Named-heir path is se bacha leta hai" — GALAT. Handover query me `status: 'PENDING'` filter hai (user.service.js:364-366), isliye DONE task ko wo chhoota hi nahi; wo aage detach `Task.updateMany({ assignedBy: uid }, ...)` (user.service.js:392) me match hota hai aur assignedBy waise hi null ho jata hai. Yaani finding ka apna scenario (Bob ne complete kar liya, +10 file ho chuke) DONO paths par bilkul same tarah hota hai. Isliye ye "Nobody" option ki warning ka issue nahi hai — heir wale branch ki line "Finished work keeps its original history — only the N open tasks move" (delete-user-dialog.jsx:169) actually zyada seedha jhoot hai, kyunki jo finished work hai wahi orphan hota hai.

2) "Bob ki August standing badal jati hai" — under-stated. Loss permanent aur un-recoverable hai: rebuildOverdueForTask `if (!t || !t.assignedBy ...) return;` par bail karti hai (bonus.service.js:726), daily rescoreAllDoneAssigned `{ status:'DONE', assignedBy: { $ne: null } }` filter karti hai (bonus.service.js:1626), aur Bob dobara DONE tick kare to onAssignedTaskDone `if (!b.enabled || !task.assignedBy) return;` (bonus.service.js:619) par nikal jati hai. Koi bhi pass +10 wapas nahi laata. (pruneOrphanTaskEntries assignerDeleted ko honour karti hai — bonus.service.js:1691, 1709 — isliye wo entry delete nahi karti, par restore bhi nahi karti.)

3) Wahi guard-hole ka blast radius sirf collaborator tak seemit nahi — same fix se ye bhi band hone chahiye:
   - deleteTask ka guard `if (task.assignedBy && !isAssigner)` (task.service.js:864) orphan hone par fire hi nahi karta, to ASSIGNEE khud delegated task delete kar sakta hai, aur :875 ka onAssignedTaskUndone uski entries bhi uda deta hai — comment (task.service.js:862-863) exactly isi ko mana karta hai.
   - Owner ke liye do-tap amnesty: PENDING orphan par DONE tap (onAssignedTaskDone bail, kuch nahi hota) phir un-tap -> onAssignedTaskUndone accrued `auto_task` mark + saare `auto_overdue:` drips delete, aur na rebuildOverdueForTask (bonus.service.js:726) na scanOverdueTasks (`assignedBy: { $ne: null }`, bonus.service.js:1030) unhe wapas likhti hai. Dialog ki line "no further overdue penalties build up" sach hai, par "already earned... are kept" yahan bhi tootta hai.
   - updateTask ka collaborator-edit gate `isOwner && !task.assignedBy` (task.service.js:843) bhi khul jata hai.

4) Severity MEDIUM se RED karne layak hai: nateeja doosre bande ke points ka silent, irreversible loss + ek permission escalation jo delete se pehle explicit 403 tha. (MEDIUM tabhi defensible hai jab bar "ek aur insaan ki action chahiye" rakha jaye.)

5) Minor: cited line 157 par warning block start hota hai, "Points already earned" wala vaakya delete-user-dialog.jsx:162 par hai.

**Suggested fix:** Ek discriminator already maujood hai — `assignerDeleted` (backend/src/models/Task.js:14), jo dono delete paths par set hota hai (user.service.js:366 aur :392). Use hi guards me lagao:

1. backend/src/services/task.service.js:276 — `const sharedPersonal = !task.assignedBy && !task.assignerDeleted;` (yehi ek line RED close karti hai: orphaned delegated task par collaborator wapas 403 pata hai).
2. website/components/tasks/task-board.jsx:82 — mirror karo: `const canCompleteTask = (t, myId) => iOwnTask(t, myId) || (!t?.assignedBy && !t?.assignerDeleted);` (`assignerDeleted` real schema path hai, toJSON me already aata hai), warna UI aisa button dikhata rahega jise server refuse karega.
3. Wahi `&& !task.assignerDeleted` clause task.service.js:864 (deleteTask guard) aur task.service.js:843 (collaborator-edit gate) par bhi lagao — dono usi `!assignedBy` par tike hain.
4. Dialog copy dono branches par theek karo (website/components/users/delete-user-dialog.jsx:156-170): finished delegated work dono raaste par apna assigner khota hai, isliye "Finished work keeps its original history" ko badal kar wahi likho jo sach hai — completed tasks ka assigner hata diya jayega, points intact rahenge, par unka delegated-status record sirf marker me bachega.

Optional (agar owner-side amnesty bhi band karni ho): rebuildOverdueForTask (bonus.service.js:726), scanOverdueTasks (bonus.service.js:1030) aur rescoreAllDoneAssigned (bonus.service.js:1626) ke `assignedBy` filters ko `$or: [{ assignedBy: { $ne: null } }, { assignerDeleted: true }]` bana do — bilkul wahi shape jo pruneOrphanTaskEntries (bonus.service.js:1691) already use karti hai.

---

## 15. [RED] Handover naye assigner se points-eligibility dobara derive kara deta hai — assignerDeleted sirf prune pass me maana jaata hai

**Kahan:** `backend/src/services/user.service.js`:366 · reviewer: frontend · verdict: CONFIRMED

**Claim:** `Task.updateMany(..., { $set: { assignedBy: heir._id, assignerDeleted: true } })` PENDING tasks par chalta hai — yaani wo kaam jiske points ABHI TAK award hue hi nahi. Owner-tier gate (`taskEligible` bonus.service.js:555-559 / `chainEligible` :567) sirf CURRENT `assignedBy` aur collaborators padhta hai; `assignerDeleted` ko sirf `pruneOrphanTaskEntries` (bonus.service.js:1709) honour karta hai. Award-time paths — `onAssignedTaskDone` (:631-635) aur `scanOverdueTasks` (:1038) — flag ko dekhte hi nahi. Isliye assigner badalne se eligibility ka faisla DONO taraf palat jaata hai, aur wo points KISI AUR ke ledger par hain. Design intent #2 exactly yahi rokna chahta tha.

**Scenario:** Direction 1 (naya penalty, band ho chuke month me): Manager Rahul (non-owner tier, taskAssign ALL) ne Priya ko "Vendor quotes" diya, dueYMD 2026-07-15, aaj tak PENDING. Koi owner-tier na assigner hai na collaborator, isliye `chainEligible` false rehta hai aur `scanOverdueTasks` ne 16 Jul se aaj tak har roz ise `continue` kiya — Priya par is task ka 0 points, bilkul sahi, kyunki ye points system me tha hi nahi. 10 Aug ko Rahul delete hota hai aur heir CEO (owner-tier, taskAssign ALL — picker me sabse obvious naam) chuna jaata hai. Ab `assignedBy = CEO`. Agli EventBridge daily tick par `scanOverdueTasks` (:1030) ye task uthata hai (assignedBy != null, PENDING, dueYMD set), `chainEligible` ab TRUE hai kyunki CEO `ownerTierIds()` me hai, aur :1054 `awardOnce('auto_task:<id>', { points: -assignedTaskLate, month: '2026-07', earnedYMD: overdueDayFor('2026-07-15') = '2026-07-16' })` likh deta hai. Priya ka JULY total -5 ho jaata hai — ek month jo already close ho kar report ho chuka tha — sirf ek August ke admin action ki wajah se jisse uska koi lena-dena nahi. Uske baad har din drip bhi chalega. Direction 2 (points destroy): agar jaane wala khud owner-tier tha aur ek aur owner-tier account bacha hai (ownerIds non-empty), to handover ke baad `taskEligible` false ho jaata hai; jis din doer task complete karega, `onAssignedTaskDone` :632-634 `PointEntry.deleteMany({ taskRef: { $in: copies }, source: { $in: ['auto_task','auto_forward'] } })` chala kar doer ki pehle se likhi entries MITA deta hai aur completion award bhi nahi deta. Tulna karo: handover na karne par `assignedBy = null` hota hai aur :619 (`if (!b.enabled || !task.assignedBy) return`) turant return kar jaata hai — kuch delete nahi hota. Yaani heir naam dena, kisi ko naam na dene se zyada destructive hai.

**Verifier:** Maine refute karne ki poori koshish ki — dono directions paper par reproduce ho gaye. Mechanism bilkul waisa hi hai jaisa finding kehti hai.

PROOF-1: `assignerDeleted` ko sirf EK jagah honour kiya jaata hai. `grep -rn "assignerDeleted" backend/src` ka poora output: Task.js:14 (schema), user.service.js:361/366/392 (writes), aur bonus.service.js:1691, 1692, 1709 — bas. 1709 `pruneOrphanTaskEntries` ke andar hai. `taskEligible` (bonus.service.js:555-559) aur `chainEligible` (:567-583) flag ko dekhte hi nahi; dono sirf `task.assignedBy` + `collaborators` (aur forward-chain ancestors) padhte hain. Yaani award-time gate poori tarah CURRENT `assignedBy` par chalta hai, jise handover (user.service.js:364-367) badal deta hai.

PROOF-2 (Direction 1 — naya penalty band ho chuke month me): scanOverdueTasks ki query bonus.service.js:1030 hai — `{ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $nin: ['', null] }, _id: { $nin: forwardedParentIds } }` — `assignerDeleted` ka koi zikr nahi. Rahul (non-owner-tier, taskAssign ALL) → Priya, dueYMD 2026-07-15, PENDING. Delete se pehle: task query me aata tha par :1038 `chainEligible` false → `continue`, isliye Priya par 0 points — sahi. 10 Aug ko Rahul delete + heir = CEO (owner-tier). user.service.js:366 `assignedBy = CEO`. Agli daily tick (maybeRunDaily :1774 → scanOverdueTasks): query match, :1035 `duePlus (2026-07-16, grace 1) >= today (2026-08-11)` false → aage badhta hai, :1038 `taskEligible` ab TRUE (`ownerIds.has(CEO)`, line 558), :1045 `marked` null, :1051-1054 `awardOnce('auto_task:<id>', { user: Priya, month: '2026-07', points: -assignedTaskLate, earnedYMD: '2026-07-17' })`. Priya ka JULY total girta hai — ek aisa month jo already report ho chuka — sirf August ke ek admin action ki wajah se. awardOnce insert-only hai (:510) to ye permanent hai.

PROOF-3 (Direction 2 — dusre ki already-earned entries DESTROY): President (owner-tier) → Priya, dueYMD 2026-08-05, PENDING. Delete se pehle eligible tha, isliye scanOverdueTasks ne -5 mark (2026-08-07) aur roz ke drips (:1064-1066, dueYMD >= 2026-08-01) Priya ke ledger par likh diye. 10 Aug: President delete, heir = Rahul (non-owner-tier, taskAssign ALL — dialog usko offer karta hai, delete-user-dialog.jsx:57-62 sirf `taskAssign` dekhta hai, tier nahi). Ab `assignedBy = Rahul`, `assignerDeleted = true`. 12 Aug ko Priya task complete karti hai → task.service.js:366 `onAssignedTaskDone(task)` → :619 pass (assignedBy truthy), :631-632 `copies.some(taskEligible)` false (Rahul ownerIds me nahi, koi owner-tier collaborator nahi) → :633 `PointEntry.deleteMany({ taskRef: { $in: copies }, source: { $in: ['auto_task','auto_forward'] } })` — mark + saare drips MIT gaye, aur completion award bhi nahi mila. Tulna: handover NA karne par user.service.js:392 `assignedBy = null` → :619 turant `return`, kuch delete nahi hota, aur prune :1709 flag ki wajah se entries bachaa leta hai. Yaani heir naam dena literally kisi ko naam na dene se zyada destructive hai — design intent #1 ("deleting a user must NEVER destroy point entries belonging to OTHER people") ka seedha ulanghan.

PROOF-4 (kyun test ne ye nahi pakda): commit 1d39686 ka message khud kehta hai "the points surviving the daily housekeeping with and without a handover" — yaani assertions `pruneOrphanTaskEntries` par hain, jo akela path hai jo flag maanta hai. Destructive paths (`onAssignedTaskDone` :633, `scanOverdueTasks` :1054) test ke dayre me the hi nahi. Commit me koi test file bhi nahi hai (name-only output: 2 audits md + 4 source files).

Owner-tier cache (:527-534, ~60s) sirf timing ko affect karta hai, outcome ko nahi. `ownerTierIds()` empty hone par :557 `if (!ownerIds.size) return true` short-circuit karta hai — isliye Direction 2 ke liye kam se kam ek owner-tier user ka bachna zaroori hai, jo finding ne khud bola hai.

**Correction:** Core sahi hai; teen detail theek karni hain aur ek amplification add karna hai:

1. DRIP wala hissa Direction 1 me galat hai. `DRIP_FLOOR_YMD = '2026-08-01'` (bonus.service.js:1008) aur gate :1064 `t.dueYMD >= DRIP_FLOOR_YMD`. July-15-due task par per-day drip kabhi nahi chalega — sirf ek baar ka -5 mark padta hai. "uske baad har din drip bhi chalega" tabhi sach hai jab dueYMD >= 2026-08-01 ho (us case me har roz -1 bhi chalega, jo aur bura hai).

2. `overdueDayFor('2026-07-15')` = '2026-07-16' nahi, '2026-07-17' hai. Default `graceDays: 1` (backend/src/models/Setting.js:73, aur bonus.service.js:120/151), aur :1014 `addDays(dueYMD, grace + 1)`. Month phir bhi July hi hai, isliye nateeja nahi badalta.

3. Direction 2 ki pre-condition thodi tight karo: sirf "ownerIds non-empty" kaafi nahi — jaane wala khud owner-tier hona chahiye AUR task ki eligibility SIRF uske `assignedBy` se aa rahi ho (koi owner-tier collaborator tagged na ho, warna :559 se eligible bana rehta hai).

4. AMPLIFICATION (finding me nahi tha, blast radius bada karta hai): forward-chain me root copy bhi PENDING rehti hai aur uska owner koi aur hota hai, isliye wo bhi re-home hoti hai (user.service.js:365 filter). Jab chain ka niche wala hissa settle hoke root DONE hota hai, `onAssignedTaskDone` :623-624 `copies = [root, ...descendants]` banata hai aur :633 ka deleteMany POORE tree ke `auto_task`/`auto_forward` entries uda deta hai — ek nahi, kai logon ke points ek saath. Note: `assignerDeleted` flag sirf us copy par set hota hai jiska `assignedBy` deleted user tha (root), descendants par nahi.

5. Fix ke liye ek trap: "assignerDeleted ⇒ eligible = true" ko seedha `taskEligible`/`chainEligible` me daal dena Direction 2 to theek karega par Direction 1 ko aur bigaad dega (jo task kabhi eligible tha hi nahi, wo ab award karne lagega). Flag ka matlab "eligible" nahi, "FROZEN" hai — dekho `fix`.

**Suggested fix:** Sabse chhota SAHI fix: `assignerDeleted` ko "eligible = true" ki tarah nahi, "decision FROZEN — na naya award, na purana delete" ki tarah treat karo, aur ye award-time paths par bhi lagao (abhi sirf prune par hai).

Minimal stop-gap (2 guards, dono jagah `assignerDeleted` ko projection me add karna zaroori hai):
- bonus.service.js:1030 — query me `assignerDeleted: { $ne: true }` add karo. Isse re-homed task par koi NAYA overdue mark/drip nahi likha jaayega (Direction 1 band). Purani entries chhedi nahi jaatin.
- bonus.service.js:619 ke turant baad `if (task.assignerDeleted) return;` — taaki :633 ka `deleteMany` re-homed chain par kabhi na chale (Direction 2 band). Iske liye `rescoreAllDoneAssigned` (:1627), `rescoreAssignedTasks` (:1656) aur `collectChainCopies` (:591) ke `.select(...)` me `assignerDeleted` add karna padega, warna field undefined aayegi aur guard chup-chaap fail ho jaayega.

Behtar (aur intent #2 ke exactly mutabik) fix: delete ke waqt faisla SNAPSHOT kar lo, derive karna hi band karo. user.service.js:364 se pehle affected PENDING tasks par `chainEligible` chala kar har task par ek naya boolean `pointsEligible` set karo (`{ $set: { assignedBy: heir._id, assignerDeleted: true, pointsEligible: <computed> } }`), aur `taskEligible` (bonus.service.js:555) ki pehli line kar do `if (typeof task.pointsEligible === 'boolean') return task.pointsEligible;`. Isse re-homed task apna award-time faisla lekar chalta hai: pehle se eligible tha to completion award milta rahega aur purani entries bachi rahengi; eligible nahi tha to naya penalty kabhi nahi banega. Ye 392 wale no-handover path par bhi lagao taaki dono raaste ek jaise behave karein.

Saath me: delete-user-dialog.jsx:170 ki line "Finished work keeps its original history — only the N open tasks move" ab bhi points ke baare me chup hai; fix ke baad copy me ye add karna chahiye ki khule tasks ke points ka faisla waise ka waisa rahega.

Test gap: naya test onAssignedTaskDone + scanOverdueTasks par likho (prune par nahi) — (a) non-owner assigner → owner-tier heir → daily scan ke baad July me koi nayi PointEntry nahi bani; (b) owner-tier assigner → non-owner heir → doer ke complete karne ke baad purani -5 + drips zinda hain.

---

## 16. [MEDIUM] Exit-summary ko deactivateUsers chahiye par delete ko manageUsers — fail hone par khaali box, handover picker gayab, Delete button phir bhi enabled

**Kahan:** `website/components/users/delete-user-dialog.jsx`:43 · reviewer: frontend · verdict: CONFIRMED

**Claim:** Dialog `useQuery` se sirf `{ data: exit, isLoading: exitLoading }` leta hai — `isError` kahin padha hi nahi jaata. `delegated = exit?.openTasksDelegated ?? 0` (:64) aur poora handover block `delegated > 0` par gated hai (:138). Udhar routes me mismatch hai: `GET /users/:id/exit-summary` par `requirePermission('deactivateUsers')` (backend/src/routes/users.routes.js:39) hai jabki `DELETE /users/:id` par `requirePermission('manageUsers')` (:46), aur menu item sirf `canManage` par dikhta hai (website/components/users/users-directory.jsx:166). Delete button sirf `mut.isPending || exitLoading` par disable hota hai (:113) — error par nahi.

**Scenario:** HR role ke paas manageUsers + createUsers hai par deactivateUsers nahi (permissions granular toggles hain, aur delete karne wale ko deactivate ka haq hona zaroori nahi — account pehle hi kisi aur ne deactivate kiya tha). Wo ek departed manager ka Delete kholte hain jiske 14 open delegated tasks hain. `GET /users/<id>/exit-summary` 403 deta hai → `exit` undefined → `rows` = [] → summary panel ek KHAALI `<dl>` render karta hai, koi error text nahi, koi retry nahi → `delegated` = 0 → handover picker aur 'Nobody' wali warning dono render hi nahi hote → 'Delete permanently' enabled rehta hai → wo click karte hain → user.service.js:392 saare 14 tasks ko `assignedBy: null` kar deta hai. Poora feature chup-chaap fire hi nahi hua, aur leader ko pata bhi nahi chala ki koi sawaal poochha jaana tha. Bilkul yahi cold-Lambda timeout ya ek network blip par bhi hota hai — sirf permission config par nirbhar nahi.

**Verifier:** Maine har link end-to-end padha, aur mechanism bilkul reproduce hota hai.

1. Permission mismatch asli hai. `usersRouter.get('/:id/exit-summary', requirePermission('deactivateUsers'), exitSummary)` — backend/src/routes/users.routes.js:39. `usersRouter.delete('/:id', requirePermission('manageUsers'), deleteUser)` — same file :46. Menu item sirf `canManage && !row.original.isActive && row.original.id !== user.id` par dikhta hai — website/components/users/users-directory.jsx:166. Yaani dialog kholne ka gate manageUsers hai, par uske andar ka summary call deactivateUsers maangta hai.

2. Ye do permissions genuinely independent toggles hain, koi implication nahi. backend/src/lib/permissionCatalog.js:52-53 me `manageUsers` aur `deactivateUsers` alag-alag rows hain, aur `can()` sirf `getRolePermissionSet(user.role).has(perm)` karta hai (backend/src/lib/permissions.js:73-75) — koi superset logic nahi. Toh manageUsers-without-deactivateUsers ek banane-yogya role hai.

3. Failure state exactly wahi banta hai jo finding kehti hai. `api.get` 403 par `ApiError` throw karta hai (website/lib/api.js:90-98), toh query error state me jaati hai aur `data` undefined rehta hai. Dialog sirf `{ data: exit, isLoading: exitLoading }` leta hai (delete-user-dialog.jsx:43-47) — `isError`/`error` kahin destructure hi nahi hote. Phir: `rows = exit ? [...] : []` (:83-100) → `exitLoading` false hone par `<dl>` render hota hai lekin bilkul khaali (:124-134), sirf ek khaali ring-wala box dikhta hai. `delegated = exit?.openTasksDelegated ?? 0` (:64) → 0 → `{delegated > 0 ? ... : null}` (:138) poora handover block, picker aur 'Nobody' warning — sab gayab. Delete button ka disable sirf `mut.isPending || exitLoading` hai (:113); react-query v5 me error status par `isPending` false ho jaata hai isliye `isLoading` bhi false — button enabled.

4. Consequence bhi verify hua. Bina `reassignTasksTo` ke `deleteUser` ka handover block skip hota hai (backend/src/services/user.service.js:342) aur fallthrough `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })` — user.service.js:392 — saare 14 open delegated tasks ko assigner-less kar deta hai. Delete khud safal hota hai kyunki wo manageUsers par hai.

5. Koi global rescue nahi hai. queryClient me sirf `staleTime: 30_000, retry: 1, refetchOnWindowFocus: false` (website/lib/queryClient.jsx:10-17) — na QueryCache onError, na throwOnError, na ErrorBoundary. AppDialog children ko jaisa hai waisa render karta hai.

6. Sabse strong corroboration: ISI codebase me Edit dialog ne yahi gate lagaya hua hai — `enabled: open && canDeactivate && !isSelf && target.isActive !== false` (website/components/users/edit-user-dialog.jsx:101-105), comment ke saath "Only fetched for someone who can deactivate". Naya Delete dialog wo gate copy karna bhool gaya, aur uske paas `canDeactivate` hai bhi nahi.

Refute karne ki koshish jahan-jahan ki, sab fail hui: cache warm nahi ho sakti (Edit dialog ka same key `['user-exit', id]` sirf ACTIVE user par fetch karta hai, jabki Delete sirf INACTIVE par khulta hai — dono kabhi overlap nahi karte), koi placeholderData/initialData nahi, aur error par UI me kuch bhi nahi badalta.

**Correction:** Core sahi hai. Chaar chhoti precision fixes:

(a) "koi retry nahi" — UI me koi retry affordance nahi, ye sach hai, par react-query andar-andar ek baar retry karta hai (`retry: 1`, website/lib/queryClient.jsx:13). Iska practical asar sirf itna hai ki failure thoda der se settle hota hai; final state wahi khaali box + enabled button.

(b) Minimal role jo scenario reproduce karta hai wo sirf manageUsers + createUsers nahi hai — user ko `viewEveryone` bhi chahiye, kyunki directory ka `GET /users` uspar gated hai (backend/src/routes/users.routes.js:37) aur nav item `createUsers` par (website/lib/permissions.js:107). Toh exact role = createUsers + viewEveryone + manageUsers, MINUS deactivateUsers. Ye scenario ko weak nahi karta, sirf sahi karta hai.

(c) Same dialog me doosra silent hole bhi hai, isi pattern ka: `usersData` query (delete-user-dialog.jsx:49-53) bhi `isError` nahi padhti. Agar wo fail ho ya `candidates` filter (:57-62, taskAssign mode ALL/SELECTED-with-users) sabko chhaant de, toh Select me sirf "Nobody — leave them unassigned" bachta hai, bina kisi explanation ke — leader ko lagega company me koi handover ke laayak hai hi nahi.

(d) Line number nit: claim me `:43` hai; useQuery block :43-47 hai aur missing-isError ka asar :64/:83/:113/:138 par surface hota hai.

**Suggested fix:** Do-taraf minimal fix:

1. Backend (asli root cause): backend/src/routes/users.routes.js:39 ko `requirePermission('deactivateUsers')` se badal kar `requireAnyPermission('deactivateUsers', 'manageUsers')` kar do. `requireAnyPermission` pehle se import hai (:3) aur PATCH par isi tarah use ho raha hai (:45). Ye koi naya data leak nahi karta: jo banda permanently delete kar sakta hai (manageUsers), use wahi counts dikhana strictly kam powerful hai — wo counts warna delete ke baad khud hi mit jaate.

2. Frontend (fail-safe): delete-user-dialog.jsx:43 par `isError`/`error`/`refetch` bhi destructure karo, aur:
   - :121 wale block me `exitError` par `<QueryError title="Couldn't check what's still open" error={error} onRetry={refetch} />` render karo (component pehle se maujood: website/components/glass/query-error.jsx:18) — khaali `<dl>` ki jagah.
   - :113 ka disable `mut.isPending || exitLoading || isError` karo, ya kam se kam error par ek explicit warning dikhao: "Couldn't check whether they have open delegated work — deleting now will leave any such tasks unassigned." Sabse zaroori baat: error-state ko "0 delegated tasks" jaisa mat dikhne do.

Optional (c ke liye): `usersData` ki `isError` bhi padho, aur agar `candidates.length === 0` ho toh Select ke neeche ek line dikhao ki koi eligible assigner mila hi nahi — taaki "koi option hi nahi aaya" aur "sach me koi eligible nahi hai" alag dikhein.

---

## 17. [MEDIUM] Heir sirf canAssignAny se validate hota hai, un task owners ke liye canAssignTo se nahi — handover se un logon par authority mil jaati hai jinse wo deliberately roka gaya tha

**Kahan:** `backend/src/services/user.service.js`:355 · reviewer: frontend · verdict: CONFIRMED

**Claim:** `if (!canAssignAny(heir))` sirf ye poochta hai ki heir KISI ko bhi kaam de sakta hai ya nahi (task.service.js:89-92 → mode ALL, ya SELECTED with non-empty list). Ye kabhi nahi poochta ki heir un ACTUAL task owners ko assign kar sakta hai ya nahi (`canAssignTo`, task.service.js:80-86). Frontend candidate filter bhi wahi galti dohraata hai (website/components/users/delete-user-dialog.jsx:57-62). Lekin `assignedBy` ban jaane se heir ko task.service.js me poore assigner powers mil jaate hain.

**Scenario:** Vikram ek team lead hai jiska `taskAssign = { mode: 'SELECTED', users: [Bob] }` — leadership ne jaan-boojh kar use sirf Bob tak seemit rakha tha. Departing manager ke 18 open delegated tasks hain, 18 alag logon ke paas. Vikram `canAssignAny` pass kar jaata hai (SELECTED + non-empty) isliye picker me dikhta hai; handover use un 18 tasks par `assignedBy` bana deta hai. Ab: task.service.js:255-262 (`linked` me assignedBy shaamil) se wo un 18 logon ke private task notes padh sakta hai; :642-646 se wo hi EKMAATRA insaan hai jo un tasks ka title/notes/dueYMD badal sakta hai (owner khud nahi badal sakta); :858-867 se wo unhe DELETE kar sakta hai, aur :872 wo delete poore forward chain me cascade karta hai aur har owner ko "Vikram removed a task" notification bhejta hai. Un 17 logon me se kisi ko bhi Vikram ko assign karne ka haq kabhi nahi diya gaya tha.

**Verifier:** Mechanism paper par reproduce ho gaya, har step code se.

1. Guard sirf coarse hai. `backend/src/services/user.service.js:355` — `if (!canAssignAny(heir))`. `canAssignAny` (`backend/src/services/task.service.js:89-92`) sirf `mode === 'ALL' || (mode === 'SELECTED' && users.length > 0)` dekhta hai. Task owners kaun hain, ye query hi nahi hoti: `user.service.js:364-367` seedhe `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })` chala deta hai. `canAssignTo` (`task.service.js:80-86`) is path par kahin call hi nahi hota — repo-wide grep me uske sirf 4 call-sites hain: task.service.js:98, 153, 510, 678. Yaani handover me per-owner ACL check ka koi wajood nahi.

2. Heir ko sach me power milti hai (verify kiya, sirf claim nahi):
   - Read: `listTasks` me `scope === 'assigned'` ka filter sirf `{ assignedBy: actor._id }` hai (`task.service.js:940`) aur `Task.find(filter)` poore documents lautata hai (`:1032-1041`) — yaani "Assigned by me" tab me un 18 tasks ke `notes` bhi. Detail route bhi khulta hai: `getTaskDetail` ka `linked` me `task.assignedBy` shaamil hai (`:255-257`), warna 403 milta (`:260-262`).
   - Edit: `updateTask:642-646` — `if (task.assignedBy) { if (!isAssigner) throw }`. Koi leadership override nahi hai, isliye handover ke baad title/notes/dueYMD sirf heir badal sakta hai aur owner khud nahi. (Handover skip karne par `assignedBy` null rehta hai — `user.service.js:392` — aur tab owner apna task khud edit/delete kar sakta hai. Yaani handover owner se rights CHHEENTA hai aur heir ko deta hai.)
   - Delete: `deleteTask:864-867` — sirf assigner. `:872-886` forward chain cascade karta hai aur `onAssignedTaskUndone` (`bonus.service.js:697-698`) har cascade-delete hue task ki `auto_task`/`auto_forward` PointEntry rows hard-delete kar deta hai.
   - Approve: `reviewTask:389-390` sirf `isAssigner` maangta hai, aur approve karne par `onAssignedTaskDone` (`:416`) points likhta hai. Yaani submitted-for-approval kaam ka faisla bhi heir ke haath aa jaata hai.

3. Frontend wahi galti dohraata hai: `website/components/users/delete-user-dialog.jsx:57-62` mein candidates ka filter literally `mode === 'ALL' || (mode === 'SELECTED' && users.length > 0)` hai. `listUsers` (`backend/src/controllers/users.controller.js:60-63`) poora `toJSON()` bhejta hai aur `taskAssign` User schema me hai (`models/User.js:27-30`), isliye ye filter chalta bhi hai — bas galat sawaal poochta hai.

Scenario, jaisa likha gaya hai, chalta hai: Vikram `taskAssign = { mode: 'SELECTED', users: [Bob] }`. Departing manager ke 18 PENDING delegated tasks 18 alag owners ke paas. Dialog Vikram ko dikhata hai (:57-62 pass), backend :355 pass, ek `updateMany` me 18 tasks par `assignedBy: Vikram`. Ab Vikram un 17 logon ke — jinhe assign karne ka haq use kabhi nahi diya gaya — tasks ke notes padh sakta hai, unhe edit kar sakta hai, aur delete kar sakta hai.

Ek extra baat jo finding ko aur mazboot karti hai: :353-354 ka comment guard ki wajah "warna heir reassign/chase/close nahi kar payega" batata hai — par ye guard apna hi maqsad poora nahi karta. `updateTask:678` aur `forwardTask:510` dono `canAssignTo` maangte hain, isliye SELECTED-heir un tasks ko unhi logon me dobara assign ya forward kar hi nahi sakta. Usse sirf destructive/read powers milti hain (edit, delete, notes), constructive wali nahi. Guard ne jo dena chaha wo diya nahi, aur jo nahi dena chahiye tha wo de diya.

Refutation attempts jo fail hue: (a) koi doosra rank/permission gate handover path me nahi hai — sirf `canAssignRole(actor.role, user.role)` hai aur wo DELETE hone wale user par hai, heir par nahi (`:329-331`); (b) tasks routes par koi role-permission middleware nahi (`routes/tasks.routes.js` — sab service me check hota hai), isliye heir ko rokne wali koi doosri layer nahi; (c) dialog ka candidate list backend-side filtered nahi hai.

Severity MEDIUM sahi hai, RED nahi: grant DELETE karne wale actor ke paas `manageUsers` hai, aur wahi actor `PROFILE_FIELDS` me `taskAssign` shaamil hone ki wajah se Vikram ko explicitly `mode: 'ALL'` de bhi sakta hai (`user.service.js:164, 204-207, 246-256`). Yaani ye actor ka apna privilege escalation nahi — ye ek chhupa hua, ACL-me-na-dikhne-wala grant hai jiske liye koi second actor ki galat niyat chahiye tab hi nuksaan hota hai. Missing guard = MEDIUM.

**Correction:** Core sahi hai; teen detail theek karne layak:

1. "har owner ko 'Vikram removed a task' notification bhejta hai" — galat, aur asliyat isse buri hai. `deleteTask` root task ke owner ko koi notification nahi bhejta: `task.deleteOne()` `:874` par hota hai aur `notify` sirf descendants ke loop me hai (`:883-885`). Yaani un 18 me se jis task ko Vikram delete karega, uska owner ko chup-chaap task gaayab milega; notification sirf forward-chain ke neeche walon ko jaata hai, wo bhi tab jab unki copy open ho.

2. Delete ka blast radius notification se bada hai. `collectForwardDescendants` (`:618-633`) DONE copies ko filter nahi karta — `updateTask` ke reassign-remove path (`:700-702`) me `d.status !== 'DONE'` ka filter hai, `deleteTask` me nahi. To har cascade-delete par `onAssignedTaskUndone` (`bonus.service.js:697-698`) un finished copies ki `auto_task`/`auto_forward` PointEntry rows bhi mita deta hai — yaani teesre logon ke kama liye gaye points. Ye design intent #1 ("kisi aur ke point entries kabhi destroy na hon") ki seedhi ulti hai, bas ek step baad.

3. Query `owner: { $ne: uid }` sirf DELETE ho rahe user ko chhodti hai, heir ko nahi. Agar departing manager ne khud heir ko koi PENDING task diya tha, to wo task ab `owner === assignedBy === heir` ban jaata hai — ek aisi state jo normal flow me ban hi nahi sakti (`canAssignTo:81` self ko block karta hai, `updateTask:667` `desired` se actor ko filter karta hai). Nateeja: `requiresApproval` wala aisa task heir khud submit karta hai (`setStatus:314`) aur khud hi approve karta hai (`reviewTask:389-390`), jo `onAssignedTaskDone` chalata hai.

Aur ek adjacent baat, is finding ke scope se bahar par isi line se nikalti hai (alag se verify ki, alag finding banti hai): award path `assignerDeleted` ko honour nahi karta. `onAssignedTaskDone:631-635` current `assignedBy` se `taskEligible` (`:555-559`) dobara derive karta hai, jabki prune path deliberately nahi karta (`bonus.service.js:1709`). To ek CEO-assigned task non-owner-tier heir ko dene ke baad, jab doer use finish karta hai, `:633` uski purani point entries delete kar deti hai aur naye points milte hi nahi — wahi "award-time decision stands" wala intent #2 yahan toot raha hai.

**Suggested fix:** `backend/src/services/user.service.js` me, `canAssignAny(heir)` check ke turant baad (line 357 ke aas-paas), heir ko un ASLI owners ke against validate karo — heir ko ghoshit karne se pehle:

```js
const ownerIds = await Task.distinct('owner', { assignedBy: uid, status: 'PENDING', owner: { $ne: uid } });
const owners = await User.find({ _id: { $in: ownerIds } }).select('name');
const blocked = owners.filter((o) => !canAssignTo(heir, o));
if (blocked.length) {
  throw httpError(400, 'INVALID',
    `${heir.name} ko ${blocked.map((o) => o.name).join(', ')} ko kaam dene ki access nahi hai — kisi aise ko chuno jiske paas hai, ya tasks ko unassigned rehne do`);
}
```
(`canAssignTo` ko `task.service.js` se import karna hoga — abhi sirf `canAssignAny` import hai, `user.service.js:20`.)

Do fayde ek hi guard se: `canAssignTo:81` self ko false deta hai, isliye heir ke apne owned task wala self-assigner case bhi isi check se block ho jaata hai (ya phir query me `owner: { $nin: [uid, heir._id] }` karke usse handover se hi bahar rakho — jo behtar hai, kyunki ek self-owned task ki wajah se poora handover fail nahi hona chahiye). Recommendation: query me `$nin` lagao AUR baaki owners par `canAssignTo` check karo.

Rejection poore delete ko fail karta hai — jo design intent #4 ke mutabik sahi hai (koi aadha-delete nahi), kyunki ye guard sabse pehle chalta hai, `Attendance.deleteMany` waghairah se pehle (`:373`).

Frontend ko bhi wahi sach dikhna chahiye, warna dialog aise log offer karta rahega jinhe backend reject karega: `exitSummary` (`user.service.js:287-304`) me `delegatedOwnerIds` bhi lautao (usi query se jo `openTasksDelegated` ginta hai, `:291`), aur `delete-user-dialog.jsx:57-62` ke filter ko badlo — `mode === 'ALL' || (mode === 'SELECTED' && delegatedOwnerIds.every((id) => u.taskAssign.users.includes(id)))`. Saath me ek line copy: "Sirf wahi log dikh rahe hain jo in sab ko kaam de sakte hain" — taki deleter ko samajh aaye picker chhota kyun hai.

---

## 18. [MEDIUM] Doer ko ab "Assigned by <heir>" dikhta hai — ek aisa insaan jisne wo task kabhi diya hi nahi; assignerDeleted UI me kahin surface nahi hota

**Kahan:** `website/components/tasks/task-board.jsx`:666 · reviewer: frontend · verdict: CONFIRMED

**Claim:** Task card/detail `task.assignedBy.name` bina kisi shart ke print karta hai (:666, :333, :680-682). `assignerDeleted` poore `website/` me kahin use nahi hota (grep: zero matches), jabki Task model ka comment (backend/src/models/Task.js:10-13) kehta hai ki flag ka maqsad hi ye FACT sambhaalna hai ki original assigner ja chuka hai. Backend bhi ise task payload me populate/expose nahi karta — task.service.js:1037 sirf `assignedBy`/`originalAssignedBy` populate karta hai.

**Scenario:** Priya ke to-do card par likha tha "Assigned by Rahul". Rahul delete hone aur Anita ko handover hone ke baad usi card par likha aata hai "Assigned by Anita". Anita ne ye task kabhi assign nahi kiya, uske paas iska koi context nahi, aur Priya ke paas ye samajhne ka koi tareeka nahi ki naam kyun badal gaya — na koi 'handed over' badge, na koi note. Iska ekmaatra record AuditLog me hai (backend/src/controllers/users.controller.js:147-150), jo Priya ko kabhi dikhta hi nahi. Data me ab bhi sach maujood hai (`assignerDeleted: true`), bas dikhaya nahi jaata.

**Verifier:** Core mechanism reproduce ho gaya, paper par poora.

Kya sach hai:
1. Handover literally `assignedBy` ko heir se overwrite karta hai — `backend/src/services/user.service.js:364-367`: `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Doer ke pending task par ab Anita ka id baith gaya.
2. Doer ka row us naam ko bina shart print karta hai. `website/components/tasks/task-board.jsx:290` — `const from = assignerView ? null : tagged ? task.owner : task.assignedBy || null;` — Priya tagged nahi hai, assignerView false hai, to `from = task.assignedBy` (= Anita). Line `:337` render karta hai `From: <name>`. Detail sheet `:664-667` — `task.assignedBy?.name && !(view.assignerView && ...)` → `Assigned by {task.assignedBy.name}`. Kahin bhi `assignerDeleted` ka koi check nahi.
3. Folder grouping bhi chup-chaap shift ho jaata hai: `:910-914` tasks ko `t.assignedBy.id` se bucket karta hai, to Priya ke To-Do me task "Rahul" folder se nikalkar "Anita" folder me chala jaata hai — bina kisi explanation ke.
4. `assignerDeleted` poore `website/` me zero baar use hota hai (repo-wide grep: sirf `backend/src/models/Task.js:14`, `backend/src/services/user.service.js:361,366,392`, `backend/src/services/bonus.service.js:1691-1709`, aur `audits/08-*.md`). Model comment `backend/src/models/Task.js:10-13` khud kehta hai flag ka maqsad "assigner gaya" FACT sambhaalna hai.
5. Koi notification nahi jaati. Asli assignment `TASK_ASSIGNED` notify karta hai (`backend/src/services/task.service.js:181-187`), handover block (`user.service.js:364-370`) me koi `notify()` nahi hai. Ekmaatra record AuditLog hai — `backend/src/controllers/users.controller.js:147-150` — jo Priya ko kabhi nahi dikhta. Dialog copy (`website/components/users/delete-user-dialog.jsx:168-171`) sirf deleter ko batati hai, kisi ko inform karne ka koi zikr nahi.

Refute karne ki koshish jahan fail hui: maine socha shayad `originalAssignedBy` sach bacha leta hai. Nahi bachaata — normal delegation use set hi nahi karta (`task.service.js:170-180` me sirf `assignedBy: actor._id`), wo sirf forwarded copies par stamp hota hai (`:529`). Aur handover purana id kahin stash bhi nahi karta, plus User doc delete ho jaata hai. To detail sheet ka "Originally from" row (`task-board.jsx:702-707`) plain delegated task par null hi rahega. Matlab Rahul ka naam task se permanently gayab hai — situation finding se thoda zyada kharab hai, kam nahi.

Severity MEDIUM sahi hai: points/data galat nahi hote, sirf UI jhoot bolti hai (misleading UI).

**Correction:** Do detail galat hain, core par asar nahi:

1. **"Backend ise task payload me expose nahi karta" — ye GALAT hai.** `assignerDeleted` pehle se wire par maujood hai. `Task` model par koi toJSON transform nahi hai (`backend/src/models/Task.js:54` — sirf `{ virtuals: true, versionKey: false }`; transform sirf PointEntry/RuleSection/Setting/User par hai). `listTasks` bina kisi `.select()` ke query karta hai aur `t.toJSON()` return karta hai (`backend/src/services/task.service.js:1037, 1041`); `getTaskDetail` → `populated()` → `task.toJSON()` (`:234-242, :263`). `populate` sirf ObjectId refs ke liye chahiye — boolean ko populate ki zaroorat hi nahi. **Iska matlab fix purely frontend hai, backend change zero.** Finding ne is fix ko zaroorat se zyada mehnga dikha diya.

2. **Doer ke liye line `:333` galat citation hai.** `:333` sirf TAGGED branch hai (`Tagged on X's task · from ...`). Priya (asli doer) ka path `:290` → `:337` hai. `:680-682` bhi tagged-only row hai. Sahi citations: `:290`, `:337`, `:664-667`, aur grouping ke liye `:910-914`.

3. Scope thoda bada hai: sirf Priya nahi, **Anita bhi** blind hai. `scope: 'assigned'` → `{ assignedBy: actor._id }` (`task.service.js:940`), to handover ke baad Anita ke "Assigned by me" tab me aise tasks aa jaate hain jo usne kabhi assign nahi kiye, wahan bhi koi marker nahi.

4. Related note (alag finding, isi flag se theek hota hai): jab heir NA chuna jaaye, `assignedBy` null ho jaata hai (`user.service.js:392`), aur tab `task-board.jsx:294` / `:550` ka `!task.assignedBy` check flip ho jaata hai — doer ko us delegated task par Edit/Delete mil jaata hai.

**Suggested fix:** Frontend-only, kyunki `assignerDeleted` already payload me aa raha hai.

`website/components/tasks/task-board.jsx`:
- `:337` (row) — jab `task.assignedBy && task.assignerDeleted`: `From: Anita` ke saath ek chhota muted suffix, jaise `· took over`. Jab `!task.assignedBy && task.assignerDeleted` (koi heir nahi chuna): `From: (assigner has left)` — abhi wahan bilkul khaali aata hai aur task personal to-do jaisa dikhta hai.
- `:664-667` (detail sheet "Type" row) — `Assigned by {name}` ke neeche ek line: `Original assigner has left the company; {name} took this over.` Naam mat likho purana — wo data me hai hi nahi.
- `:913` folder label — `assignerDeleted` wale bucket par heading me `(took over)` badge, taki folder ka naam badalna samjh aaye.

Optional but sasta: `user.service.js:364-370` me handover ke baad affected owners ko ek `notify({ type: 'TASK_ASSIGNED'-jaisa', title: '<heir> ab in tasks ka owner hai' })` bhej do — abhi handover bilkul silent hai jabki asli assignment notify karta hai (`task.service.js:181-187`).

Backend me kuch bhi badalne ki zaroorat NAHI — na naya field, na populate.

---

## 19. [RED] Forwarded child copies handover me 'move' ho jaate hain jabki unka parent usi call me delete ho raha hai — wo tasks kabhi pay nahi karenge

**Kahan:** `backend/src/services/user.service.js`:364 · reviewer: frontend · verdict: CONFIRMED

**Claim:** Handover query `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }` forwarded CHILD copies ko bhi match karti hai (forward par `assignedBy = actor._id` set hota hai, task.service.js:527). Uske turant baad :378 `Task.deleteMany({ owner: uid })` un children ke PARENT ko uda deta hai. Child ka `forwardedFrom` ab dangling pointer hai, par usse `handedOver` count me gina jaata hai aur toast me report kiya jaata hai.

**Scenario:** CEO ne Rahul ko task T diya; Rahul ne wo Priya ko forward kiya → child C banta hai jisme `C.forwardedFrom = T`, `C.assignedBy = Rahul`, `C.owner = Priya`, status PENDING. Rahul delete hota hai, heir Anita. Handover C ko match karta hai → `C.assignedBy = Anita`, `handedOver` 1 badhta hai, aur leader ko toast dikhta hai "1 open task moved to Anita". Phir :378 T ko delete kar deta hai. Ab Priya C complete karti hai: `onAssignedTaskDone` bonus.service.js:621 par turant return kar jaata hai kyunki `C.forwardedFrom` set hai (non-root copy khud kabhi pay nahi karti), aur `settleParent` task.service.js:561 par return kar jaata hai kyunki `parent` mil hi nahi raha. Priya ko kaam poora karne ke baad HAMESHA ke liye 0 points milte hain, upar kisi ko koi notification nahi jaata, aur Anita ko lagta hai task uske paas hai jabki wo ek marra hua branch hai. (Dangling parent khud purani behaviour hai, par handover ise 'move ho gaya' bata kar report karna naya hai.)

**Verifier:** Mechanism ka har link code me verify ho gaya — aur ye edge case nahi, forwarded children ke liye 100% case hai.

1) Forward child ka shape: `backend/src/services/task.service.js:522-532` — `Task.create({ owner: target._id, assignedBy: actor._id, forwardedFrom: parent._id, status: 'PENDING', dueYMD: parent.dueYMD })`. Yaani child par `assignedBy` = forwarder.

2) Handover query use match karti hai: `backend/src/services/user.service.js:364-367` — `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Child ka assignedBy = uid (Rahul), status PENDING, owner = Priya ≠ uid → match. `handedOver = res.modifiedCount` (`user.service.js:368`).

3) Parent HAMESHA usi call me marta hai: `forwardTask` guard `task.service.js:490` (`String(parent.owner) !== String(actor._id)` → 403) ka matlab hai ki jis bhi task par `forwardedFrom != null && assignedBy == uid`, uske parent ka `owner` uid hi tha. Aur `task.owner` creation ke baad kahin mutate nahi hota (sirf `task.service.js:174` aur `:526` par set hota hai). Phir `user.service.js:378` `Task.deleteMany({ owner: uid })` — bina kisi forward-chain cascade ke — us parent ko uda deta hai. Isliye handover jitne bhi forwarded children ko chhuti hai, un sab ka parent guaranteed dangling ho jaata hai.

4) Dead branch kabhi pay nahi karti: `bonus.service.js:616-621` — `if (task.forwardedFrom) return;` (non-root copy khud kabhi award nahi likhti). `task.service.js:558-561` — `settleParent` par `const parent = await Task.findById(childTask.forwardedFrom); if (!parent ...) return;` → upar kuch settle nahi hota. Aur recovery passes bhi nahi bachate: `bonus.service.js:1626` (`forwardedFrom: null` filter) child ko chhod deta hai, aur `bonus.service.js:1653-1661` root ko `Task.find({_id: {$in: forwardedParentIds}, ...})` se dhoondhta hai — root row hi delete ho chuki hai, isliye kuch nahi milta. Priya ke liye positive completion award permanently 0.

5) Reporting jhoot bolti hai: `website/components/users/delete-user-dialog.jsx:72-73` — toast `"User deleted — ${res.handedOver} open task(s) moved to ${res.handedOverTo}"`. Same query `exitSummary` ke `openTasksDelegated` count me bhi hai (`user.service.js:291`), to dialog ka headline number bhi dead branches gin raha hai.

Codebase khud is bug ko pehchan chuka hai — `task.service.js:691-703` (reassignTask) me exactly yahi likha hai: "Take their forward chain with them, exactly as deleting the task does. Without this, someone they had passed the work down to kept a copy pointing at a parent that no longer existed: finishing it settled nothing." `deleteUser` us convention ko follow nahi karta.

**Correction:** Do details galat hain, aur ek asar finding ne miss kiya jo severity ko MEDIUM se RED me le jaata hai.

(a) "upar kisi ko koi notification nahi jaata" — GALAT. Handover ke BAAD child ka `assignedBy` = Anita hai, isliye Priya ke complete karte hi `task.service.js:351-354` (`if (task.assignedBy && !isAssigner) notify(... 'completed a task')`) Anita ko TASK_DONE bhej deta hai. Ye behtar nahi, badtar hai: leadership ko "kaam ho gaya" ka notice milta hai jabki us kaam ne kisi ko ek bhi point nahi diya. Jo nahi hota wo hai upward settle (`settleParent` :561 par return).

(b) Sabse bada naya nuksaan finding ne chhoda: agar heir owner-tier hai (CEO_PRESIDENT — yaani sabse likely heir, kyunki delete wahi kar raha hota hai), to handover us mari hui branch par overdue drip DOBARA chalu kar deta hai. Daily scan `bonus.service.js:1030` ko `assignedBy: { $ne: null }` chahiye; is change se PEHLE child `user.service.js:392` se `assignedBy: null` ho jaata tha, isliye scan use skip karta tha. Ab `assignedBy = Anita` non-null hai, aur `chainEligible` → `taskEligible` (`bonus.service.js:558`) Anita ke owner-tier hone par TRUE de deta hai, to `bonus.service.js:1046-1066` roz `-assignedTaskOverdueDaily` likhta rehta hai (dueYMD >= 2026-08-01, `DRIP_FLOOR_YMD` :1008). Priya ka drip tab tak chalta hai jab tak wo task DONE na kar de — aur DONE karne par bhi positive award nahi milta (step 4), aur purana `-5` mark `pruneOrphanTaskEntries` ke `keep = t && (t.status === 'DONE' || e.points < 0)` (`bonus.service.js:1724`) se bacha rehta hai. Net: Priya ko kaam poora karne par sirf minus milta hai, aur handover se pehle wo minus rukta tha. Ye seedha design intent #1 ("deleting a user must never destroy/skew point entries belonging to OTHER people") ko todta hai — isliye RED.

(c) Chhota: "Dangling parent khud purani behaviour hai" — sahi hai, lekin ab wo dead branch pehli baar assigner-wali task ki tarah zinda dikhti bhi hai aur score bhi karti hai.

**Suggested fix:** Do line ka core fix, dono `backend/src/services/user.service.js` me:

1) Handover sirf ROOT delegations ko move kare — `user.service.js:365` ki query me `forwardedFrom: null` add karo:
   `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid }, forwardedFrom: null }`
   Isse forwarded children na move hote hain, na `handedOver` count/toast me jhooth aata hai. Wahi filter `exitSummary` ke `openTasksDelegated` (`user.service.js:291`) me bhi lagao taaki dialog ka number aur delete ka number ek doosre se match karein.

2) Apne tasks delete karte waqt forward chain saath le jao — bilkul wahi rule jo `task.service.js:691-703` reassignTask me pehle se chalta hai. `Task.deleteMany({ owner: uid })` (`user.service.js:378`) se PEHLE, jab links abhi intact hain:
   - `const mine = await Task.find({ owner: uid }).select('_id');`
   - `const orphans = (await collectForwardDescendants(mine.map(t => t._id))).filter(d => d.status !== 'DONE' && !d.awaitingApproval);`
   - unhe delete karo aur har ek par `onAssignedTaskUndone(d._id)` chalao (points ka wahi cleanup jo reassign path karta hai), phir apne tasks delete karo.
   `collectForwardDescendants` abhi `task.service.js:618` par non-exported hai — use `export` karna padega; `user.service.js` pehle se `task.service.js` se `canAssignAny` import karta hai, to koi naya cycle nahi banta.

DONE/awaiting-approval children ko chhodna zaroori hai — wahi tark jo `task.service.js:696-699` me likha hai (doosre ki history aur kamaye hue points mat cheeno). Un bache hue DONE copies ke liye `assignerDeleted: true` marker rakhna theek hai.

Agar owner sirf minimum chahta hai to (1) akela toast ka jhooth band kar deta hai, par Priya wali dead branch phir bhi rahegi — us haalat me (2) ke bina drip-resumption wala RED bhi nahi jaata, isliye dono chahiye.

---

## 20. [LOW] Handover kisi ko notify nahi karta — na heir ko, na un logon ko jinke tasks move hue

**Kahan:** `backend/src/services/user.service.js`:364 · reviewer: frontend · verdict: CONFIRMED

**Claim:** `Task.updateMany` ke aage-peeche koi `notify()` call nahi hai, jabki is codebase me har doosra reassignment/forward/delete notify karta hai (task.service.js:527-546 forward, :727 new assignment, :880-885 cascade delete). Heir ko sirf tab pata chalega jab wo khud 'Assigned by me' tab kholega.

**Scenario:** Anita ko 18 tasks inherit hote hain aur use koi khabar nahi. Agle din se un tasks ke approval requests uske paas aane lagte hain — task.service.js:322 `notify({ user: task.assignedBy, type: 'TASK_APPROVAL' })` — kaam ke liye jo usne kabhi assign hi nahi kiya aur jiska use context nahi. Udhar 18 owners ko bhi nahi bataya jaata ki ab unhe chase karne wala insaan badal gaya hai; unke card par naam chup-chaap badal jaata hai (finding 4).

**Verifier:** Maine refute karne ki poori koshish ki — koi indirect notification path nahi mila. Mechanism paper par reproduce ho gaya.

VERIFICATION (note: change ab committed hai as `1d39686`, working tree clean — `git diff` khaali aata hai):

1. Absence total hai, sirf missing call nahi: `backend/src/services/user.service.js:1-24` me `notify` ka import hi nahi hai (grep "notify" over poori file = 0 hits). Handover `Task.updateMany` (user.service.js:364-367) ke aas-paas kuch bhi nahi.
2. Indirect path bhi band: `backend/src/models/Task.js` me koi pre/post middleware nahi (grep "pre(|post(|notify" = sirf line 14, `assignerDeleted` field). Aur `updateMany` waise bhi document middleware bypass karta hai. To kisi hook se bhi notification nahi nikal sakti.
3. Controller bhi silent: `backend/src/controllers/users.controller.js:141-153` sirf `audit({... meta: { reassignTasksTo, handedOver, handedOverTo }})` likhta hai — koi notify nahi.
4. Comparison points sach hain: forward notify `task.service.js:539-545`, new assignment `:727`, cascade delete `:883-885`, TASK_APPROVAL `:321-327` (`user: task.assignedBy`).

SCENARIO REPRODUCED (Anita = heir, 18 tasks):
- Handover ke baad in 18 tasks par `assignedBy = Anita._id` (user.service.js:365-366).
- Jab koi owner apna task "done" karta hai aur `requiresApproval: true` hai → `task.service.js:314` gate pass → `:321-327` `notify({ user: task.assignedBy, type: 'TASK_APPROVAL' })` → ghanti Anita ke paas, aise kaam ke liye jo usne kabhi assign hi nahi kiya.
- Anita ko pata chalne ka koi push nahi: use khud `listTasks` scope='assigned' kholna padega, jo `task.service.js:940` par `and.push({ assignedBy: actor._id })` se match karta hai — yaani "Assigned by me" tab. Finding ka yeh dawa exact hai.
- 18 owners ko bhi kuch nahi jaata; unke card par naam isliye badal jaata hai kyunki list `populate('assignedBy','name')` karti hai.

Severity LOW hi sahi hai, aur maine iski do wajah verify ki:
- Anita locked out nahi hai — `reviewTask` (`task.service.js:389-390`) `assignedBy === actor._id` par key karta hai, to woh actually approve/reject kar sakti hai. Koi crash, koi stuck task nahi.
- Dialog jhooth nahi bolta — `website/components/users/delete-user-dialog.jsx` me "notif/inform/tell" ka ek bhi hit nahi, yaani UI ne notification ka wada kiya hi nahi. Isliye yeh MEDIUM (misleading UI) nahi banta.

Koi data loss nahi, points galat nahi hote, design intent 1-4 me se koi violate nahi hota. Purely an operational-handoff gap.

**Correction:** Core sahi hai; teen detail theek karne layak:

1. CITE DRIFT: forward notify `task.service.js:539-545` par hai, `:527-546` par nahi — `:527` to child doc ka `assignedBy: actor._id` field hai. Baaki teenon cites (`:727`, `:880-885`, `:322`) exact hain.

2. FINDING NE EK BRANCH MISS KI (yeh isse thoda strong banata hai): bell noise sirf `requiresApproval` waale tasks tak seemit nahi. Jin tasks me `requiresApproval: false` hai, wo approval gate (`:314`) skip karke seedha DONE hote hain aur `task.service.js:352-353` par `if (task.assignedBy && !isAssigner) notify({ user: task.assignedBy, type: 'TASK_DONE', title: '<owner> completed a task' })` chalta hai — yaani Anita ko phir bhi ghanti jaati hai, bas type alag (TASK_DONE). To 18 me se lagbhag har task eventually Anita ko ping karega, do types me bant kar: TASK_APPROVAL (`:321`) + TASK_DONE (`:353`). Scenario ko "approval requests" tak seemit likhna isse kam karke dikhata hai.

3. Scenario ki "agle din se" timing owner ke task complete karne par depend karti hai, daily EventBridge pass par nahi — `pruneOrphanTaskEntries` ka isse koi lena-dena nahi.

**Suggested fix:** Sabse chhota sahi fix: `updateMany` se pehle affected tasks fetch karo (kyunki `updateMany` docs return nahi karta), phir heir ko ek baar aur har distinct owner ko ek baar batao.

`backend/src/services/user.service.js` me import add karo:
```js
import { notify } from '../models/Notification.js';
```

Phir line 364-370 wale block ko replace karo:
```js
// updateMany docs return nahi karta — kise batana hai, wo pehle nikaalo.
const affected = await Task.find({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } })
  .select('_id owner');
const res = await Task.updateMany(
  { assignedBy: uid, status: 'PENDING', owner: { $ne: uid } },
  { $set: { assignedBy: heir._id, assignerDeleted: true } },
);
handedOver = res.modifiedCount ?? 0;
handedOverTo = heir.name;

// Chup-chaap handover ka matlab hai heir ko TASK_APPROVAL/TASK_DONE aise kaam ke
// liye milenge jo usne kabhi assign nahi kiya, aur owners ko pata hi nahi chalega
// ki ab unhe chase karne wala kaun hai.
if (affected.length) {
  await notify({
    user: heir._id,
    type: 'TASK_ASSIGNED',
    title: `${affected.length} open task${affected.length > 1 ? 's' : ''} ab aapke paas hain`,
    message: `${user.name} ka account hata diya gaya — unka open delegated kaam ab aapko follow up karna hai`,
    link: '/todo',
  });
  // Har vyakti ko ek baar, har task copy ke liye nahi — wahi convention jo
  // task.service.js:192-194 aur :747-749 follow karte hain.
  for (const oid of [...new Set(affected.map((t) => String(t.owner)))]) {
    await notify({
      user: oid,
      type: 'TASK_ASSIGNED',
      title: `Aapke open task${affected.length > 1 ? 's' : ''} ab ${heir.name} ke under hain`,
      message: `${user.name} ka account hata diya gaya`,
      link: '/todo',
    });
  }
}
```

Design intent 4 ("rejected handover must not half-delete anyone") safe rehta hai, aur maine yeh verify kiya: `notify` apne andar hi try/catch karta hai (`backend/src/models/Notification.js:35-43`) aur error ko sirf console par log karke nigal jaata hai — to notification fail hone se deletion adhoori nahi rukti. `Task.find` agar throw kare to wo `updateMany` se pehle hai, yaani abhi tak kuch mutate nahi hua — request cleanly fail hoti hai.

---

## 21. [RED] Handover to a non-owner-tier heir makes task completion hard-delete every point entry on the task and its whole forward chain

**Kahan:** `D:/React Projects/office-management-software/backend/src/services/user.service.js`:366 · reviewer: edges · verdict: CONFIRMED

**Claim:** The handover writes `assignedBy: heir._id` alongside `assignerDeleted: true`, but only `pruneOrphanTaskEntries` (bonus.service.js:1709) honours `assignerDeleted`. Every other scoring path still re-derives owner-tier eligibility from `assignedBy` — including `onAssignedTaskDone`, which starts at bonus.service.js:619 (`if (!b.enabled || !task.assignedBy) return;`) and, when the gate fails, runs `PointEntry.deleteMany({ taskRef: { $in: copies.map(c => c._id) }, source: { $in: ['auto_task','auto_forward'] } })` at bonus.service.js:631-634. Before the change, deleting a user set `assignedBy: null` (user.service.js:392) so that early return at line 619 fired and the entries were untouchable. Naming an heir removes that protection: the flag says 'do not re-derive', the code re-derives anyway, and the re-derived answer is now the HEIR's tier, not the original assigner's. `rescoreAllDoneAssigned` (bonus.service.js:1626) re-runs `onAssignedTaskDone` on every DONE assigned task from the last 45 days, so the wipe repeats daily and cannot be undone by hand.

**Scenario:** CEO-tier user D (owner tier) assigned 'Q2 vendor audit' to employee E, due 2026-07-01, requiresApproval, still PENDING. E has accrued the −5 overdue mark (filed 2026-07-02) plus ~39 daily drips — roughly −44 points, already visible in E's July and August Rewards totals. On 2026-08-10 the other CEO-tier user deletes D and, sensibly, names manager H (taskAssign ALL, NOT owner tier) as heir. Immediately: the task's `assignedBy` becomes H, `assignerDeleted` true. E's points survive the nightly `pruneOrphanTaskEntries` (correct). Then E finishes the task on 2026-08-14 and H approves it. `onAssignedTaskDone` runs, `copies.some(c => taskEligible(c, ownerIds))` is false (H is not in `ownerTierIds()`, nobody owner-tier is tagged), and all ~40 of E's PointEntry rows — plus any entries on forwarded children owned by third parties who were never mentioned in the delete dialog — are deleted outright, and no completion award is written. Choosing 'Nobody' in the same dialog would have preserved every one of them. The feature built to protect other people's points is the thing that destroys them.

**Verifier:** Maine ise refute karne ki poori koshish ki — mechanism reproduce ho gaya, line by line. Core claim sahi hai.

VERIFIED CHAIN:
1. Handover `user.service.js:364-367` — `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Yaani task ko ek naya, live `assignedBy` mil jaata hai.
2. `assignerDeleted` ko sirf ek jagah honour kiya jaata hai — `bonus.service.js:1709` (pruneOrphanTaskEntries): `eligibleById.set(String(t._id), t.assignerDeleted ? true : await chainEligible(...))`. Poore repo mein grep karke confirm kiya: flag sirf Task.js:14, user.service.js, aur bonus.service.js ke 1691/1692/1709 par aata hai. Kahin aur nahi.
3. `taskEligible` (`bonus.service.js:555-560`) aur `chainEligible` (567-583) eligibility ko purely `assignedBy` + `collaborators` se re-derive karte hain — dono ko `assignerDeleted` ka pata hi nahi hai.
4. `onAssignedTaskDone` ka guard `bonus.service.js:619` — `if (!b.enabled || !task.assignedBy) return;`. Handover ke baad `assignedBy` heir hai, isliye ye guard ab fire NAHI karta. Neeche `631-634`: `if (!copies.some((c) => taskEligible(c, ownerIds))) { await PointEntry.deleteMany({ taskRef: { $in: copies.map((c) => c._id) }, source: { $in: ['auto_task','auto_forward'] } }); return; }` — hard delete, aur `return` ke kaaran 659-694 wala award loop bhi kabhi nahi chalta.
5. PRE-CHANGE BASELINE bhi verify kiya: `user.service.js:392` `assignedBy: null` set karta tha, isliye 619 wala guard fire hota tha aur entries ko koi haath nahi lagata tha. Matlab ye ek asli regression hai jo heir naam dene se aata hai — "Nobody" chunne par nahi.
6. Heir owner-tier hona zaroori nahi: backend sirf `canAssignAny(heir)` check karta hai (`user.service.js:355`, `task.service.js:89` — sirf taskAssign mode dekhta hai), aur dialog ke candidates (`delete-user-dialog.jsx:57-62`) mein bhi koi owner-tier filter nahi hai. Toh non-owner heir bilkul selectable hai.
7. Trigger paths confirmed: `task.service.js:416` (approve) aur `:366` (setStatus) dono `onAssignedTaskDone` call karte hain. Aur `rescoreAllDoneAssigned` ki query `bonus.service.js:1626` mein `assignedBy: { $ne: null }` hai — orphan (Nobody) tasks is pass se bahar rehte hain, re-homed tasks andar aa jaate hain, isliye ye task rozana dobara process hoga aur permanently un-scorable rahega.
8. `ownerTierIds()` (527-534) User collection se resolve karta hai, aur deleted D ki id `collaborators` mein padi rehne ke baad bhi match nahi karegi (deleteUser collaborators se $pull nahi karta) — toh gate sach mein fail hota hai. `!ownerIds.size` wala escape hatch (557) bhi lagu nahi hota kyunki deleter khud owner-tier hai (`canAssignRole` rank guard).

Concrete reproduction (numbers theek karke): CEO-tier D ne E ko task diya, due 2026-08-05, requiresApproval, PENDING. 10 Aug tak E ke paas −5 overdue mark (filed 2026-08-06, `bonus.service.js:1051-1054`) + 3 daily drips (1064-1066) hain. D delete hota hai, heir = manager H (taskAssign ALL, non-owner). Nightly prune ye rows bacha leta hai (1709 — sahi). 14 Aug ko E submit karta hai, H approve karta hai → `task.service.js:416` → `onAssignedTaskDone` → gate 632 false → 633 par saari auto_task rows hard-delete, aur koi completion award nahi likha jaata. "Nobody" chunte toh 619 par early return hota aur sab kuch safe rehta.

Isliye severity RED bani rehti hai: PointEntry rows hard-delete hoti hain (forwarded copies ke through third parties ki bhi), band ho chuke mahine ke totals chupchaap badal jaate hain, aur ye tab hota hai jab leadership dialog ka madadgaar option chunti hai.

**Correction:** Core sahi hai, par paanch details galat/adhoori hain:

1. NUMBERS GALAT HAIN. Due 2026-07-01 wale task par ek bhi daily drip nahi banta. Drip ka floor `DRIP_FLOOR_YMD = '2026-08-01'` hai aur gate `t.dueYMD >= DRIP_FLOOR_YMD` hai (`bonus.service.js:1008`, `1064`; wahi floor `rebuildOverdueForTask:747` mein bhi). July-due task par sirf akela −5 mark hota hai (filed 2026-07-02 via `overdueDayFor`), −44 nahi. ~39 drips paane ke liye task ka due date 2026-08-01 ya uske baad hona chahiye.

2. NUKSAAN KI DISHA ULTI BATAYI GAYI HAI (root task ke apne rows ke liye). Re-homed task definition se PENDING hai (`user.service.js:365` ka filter), aur PENDING task par sirf NEGATIVE auto entries ho sakti hain — overdue mark aur drips. Positive completion awards tabhi likhe jaate hain jab root DONE ho, aur reopen hone par `onAssignedTaskUndone` (698) unhe mita deta hai. Toh 633 wala deleteMany penalties mitata hai: doer ko bin-mangi amnesty milti hai aur band ho chuke mahine ka total chupchaap upar chala jaata hai. Sahi behaviour ke muqable asli loss ye hai ki completion award kabhi likha hi nahi jaata (634 ka `return` award loop skip kar deta hai). "E ke points destroy ho gaye" wali framing is scenario ke liye theek nahi — "E ke points galat ho gaye, dono mahino ki history badal gayi" sahi framing hai.

3. THIRD-PARTY CLAIM SAHI HAI, PAR WAJAH ALAG HAI. Forwarded children re-home hote hi nahi — `forwardTask` child par `assignedBy: actor._id` set karta hai (`task.service.js:527`), isliye handover ka `assignedBy: uid` filter unhe miss karta hai. Phir bhi un par third-party rows hoti hain, kyunki `scanOverdueTasks` unhe `chainEligible` se paas karta hai jo ancestor chain chadhkar root par D (owner-tier) dekh leta hai (`bonus.service.js:1038`, 567-583) — toh F ka apna −5 mark/drips likhe jaate hain. Jab root settle hota hai, `collectChainCopies` (585) F ki copy ko `copies` mein daal deta hai aur 633 F ki rows bhi le jaata hai. Yaani F ke PENALTIES udte hain, F ke awards nahi (awards to root DONE hone se pehle exist hi nahi karte).

4. "cannot be undone by hand" ZYADA STRONG HAI. deleteMany `source: { $in: ['auto_task','auto_forward'] }` par filter karta hai, aur `manual` ek alag source hai (`PointEntry.js:22`), toh haath se di gayi compensating entry daily pass mein bach jaayegi. Jo wapas nahi aa sakta wo hain auto rows khud (dobara daali gayi koi bhi auto_task row agle `rescoreAllDoneAssigned` mein phir delete ho jaayegi) aur unka asli earnedYMD/reason.

5. EK AUR DISHA CHOOT GAYI, JO SHAYAD ZYADA MEHENGI HAI. Wahi one-line cause ulta bhi chalta hai. Agar ORIGINAL assigner owner-tier NAHI tha (task jaayaz taur par points system ke bahar, zero entries), aur heir CEO_PRESIDENT hai, toh `taskEligible:558` ab true return karta hai aur task points system ke ANDAR khinch aata hai. `scanOverdueTasks` turant −5 mark likh deta hai jo `overdueDayFor(dueYMD)` ke hisaab se ek PURANE mahine mein file hota hai (1051-1054), plus drips, aur completion par awards. Ye wali direction doer ke asli points cheenti hai — ek aise task par jo kabhi count hi nahi karta tha.

Chhoti baat: `onAssignedTaskDone` line 616 par shuru hota hai (619 guard hai), aur deleteMany 633 par hai — finding ke range thode dhile hain, matlab wahi hai.

**Suggested fix:** Sabse chhota SAHI fix: `assignerDeleted` ko akela mat rakho — award-time ka FAISLA bhi save karo, aur use har scoring path mein honour karo (sirf prune mein nahi).

1. Task.js mein ek field jodo: `assignerWasOwnerTier: { type: Boolean, default: false }`.
2. `user.service.js` ki `deleteUser` mein, kisi bhi update se pehle ek baar compute karo `const wasOwner = (await ownerTierIds()).has(String(uid))` (ya `isOwnerRole(user.role)` — user abhi tak load hai, line 324), aur DONO updateMany mein set karo: handover wala (`:364-367`) aur detach wala (`:392`). Isse "Nobody" aur "heir" dono raaste ek jaise behave karenge.
3. `bonus.service.js` ke `taskEligible` (555) mein sabse upar short-circuit lagao, `ownerIds.size` check ke turant baad:
   `if (task.assignerDeleted) return !!task.assignerWasOwnerTier;`
   Isse intent #2 sach mein lagu hota hai — faisla award-time par freeze, dono direction mein (non-owner heir points nahi mitaayega, owner-tier heir task ko system mein nahi kheenchega).
4. YE STEP CHHOOTNE PAR FIX CHUPCHAP BEKAAR HO JAAYEGA: har `.select()` projection mein naye dono fields add karne padenge, warna `taskEligible` ko `undefined` milega aur wo "deleted hi nahi" maan lega. Jo projections theek karni hain: `chainEligible` ka ancestor fetch (`bonus.service.js:575`), `collectChainCopies` (591), `scanOverdueTasks` (1030), `rebuildOverdueForTask` (725), `rescoreAllDoneAssigned` (1627), `rescoreAssignedTasks` (1656), aur `pruneOrphanTaskEntries` (1692). Ye aakhri wala tab `t.assignerDeleted ? true : ...` (1709) ki jagah seedha `chainEligible` par bhi ja sakta hai, kyunki gate ab khud sahi jawab de raha hoga.
5. Regression test (isolated DB): owner-tier D → E ko task, due kal, mark+drips accrue karao; D ko non-owner heir H ke saath delete karo; E complete kare, H approve kare; assert karo ki E ki purani entries jaisi ki taisi hain aur completion award likha gaya hai. Ulta case bhi: non-owner assigner M + owner-tier heir → assert karo ki koi mark/drip/award pehle jaisa hi nahi banta.
6. Sath mein: `user.service.js:361-363` aur `Task.js:14` ke comments abhi daawa karte hain ki flag re-derivation rokta hai — jab tak (3) nahi hota, wo comments code se jhooth bol rahe hain. Aur `delete-user-dialog.jsx:168-171` ka heir-wala text points ke baare mein kuch nahi kehta jabki "Nobody" wala branch (157-166) saaf-saaf points bachane ka vaada karta hai — fix ke baad heir branch mein bhi wahi aashwasan likh do.

---

## 22. [RED] Handover to an owner-tier heir drags previously-ineligible tasks into the points system and back-files penalties into closed months

**Kahan:** `D:/React Projects/office-management-software/backend/src/services/bonus.service.js`:1038 · reviewer: edges · verdict: CONFIRMED

**Claim:** The mirror of the same root cause. `scanOverdueTasks` selects `{ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: {...} }` (bonus.service.js:1030) and gates each row on `chainEligible(t, ownerIds)` (line 1038), which resolves through `taskEligible` → `ownerIds.has(String(task.assignedBy))` (line 558). Re-homing a task from a non-owner-tier assigner to an owner-tier heir flips that answer from false to true, and `assignerDeleted` is not consulted anywhere in this path. The overdue mark it then writes is filed under `overdueDayFor(t.dueYMD, grace)` (line 1051-1054), i.e. the day the deadline passed — a date that can be weeks in the past and in an already-rolled-up month.

**Scenario:** Manager M (rank below CEO, taskAssign ALL) assigned 'File the August GST return' to employee E, due 2026-08-02, still PENDING on 2026-08-10. Because M is not owner tier and nobody owner-tier is tagged, this task has always been outside the points system: E has zero entries on it. M resigns; leadership deletes M and picks the CEO as heir — the most natural choice in the dialog, and the only one many offices would make. On the next `maybeRunDaily` tick the task now reads as CEO-assigned: `scanOverdueTasks` writes E a −5 mark with `earnedYMD` 2026-08-03 and month '2026-08', plus a drip for every subsequent day, and `rebuildOverdueForTask` will fill 2026-08-04 onward. With a June-due task the mark lands in month '2026-06', silently changing a month E has already been paid/ranked on. E is penalised for lateness that, by the rule in force the entire time the work was late, never counted.

**Verifier:** Maine ise refute karne ki poori koshish ki — query, gate, filing date, aur har cleanup pass — lekin mechanism bilkul reproduce ho jaata hai.

Chain jo maine padha:
1. `backend/src/services/user.service.js:364-367` — handover `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })`. Yaani re-homed task ka `assignedBy` ab LIVE hai (heir ka id), null nahi.
2. `backend/src/services/bonus.service.js:1030` — `scanOverdueTasks` ka filter `{ assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $nin: ['', null] }, _id: { $nin: forwardedParentIds } }`. Handover ke baad task is filter mein aa jaata hai (pehle `assignedBy: null` hone ki wajah se bilkul bahar tha). `.select(...)` mein `assignerDeleted` project tak nahi hota — proof ki is path mein woh consult hi nahi hota.
3. `bonus.service.js:1038` → `chainEligible` → `taskEligible` (`:558`) → `ownerIds.has(String(task.assignedBy))`. Assigner badalne se yeh answer false → true flip ho jaata hai. `ownerTierIds()` (`:527-534`) rank se resolve hota hai (`lib/roles.js:136`), naam se nahi — to CEO heir turant gate paas kar deta hai.
4. `bonus.service.js:1045-1054` — `marked` check sirf existing PointEntry dhoondta hai; aise task par kabhi koi entry thi hi nahi, to `pts && !marked` sach hai aur `awardOnce('auto_task:<id>', { month: overdueDay.slice(0,7), earnedYMD: overdueDay, points: -|markPts| })` chal jaata hai, jahan `overdueDay = overdueDayFor(t.dueYMD, grace)` = due + grace + 1 — deadline wala din, aaj ka nahi.

Concrete scenario (verified on paper, grace 0, aaj 2026-08-10):
Manager M (non-owner rank, taskAssign ALL) ne E ko 'File the August GST return' diya, due 2026-08-02, abhi bhi PENDING. Aaj tak yeh task points system se bilkul bahar tha — E ke paas is par zero entries. M ka account delete hota hai, heir CEO chuna jaata hai (dialog mein sabse natural choice). Agle `maybeRunDaily` tick par `scanOverdueTasks` (`:1774`) task ko utha leta hai, `chainEligible` ab true, aur E ko `-5` milta hai `earnedYMD: '2026-08-03'`, `month: '2026-08'` — us lateness ke liye jo poore late-period ke dauraan rule ke hisaab se count hi nahi karti thi. Line `:1064` par drip bhi lagta hai kyunki `dueYMD '2026-08-02' >= DRIP_FLOOR_YMD`.

Aur sabse kharab hissa: yeh galat penalty permanent hai. `pruneOrphanTaskEntries` (`:1709`) `assignerDeleted` ko "eligible: true" padhta hai aur `:1724` PENDING task par har negative entry ko `keep` karta hai — to d0cc333 wala fix hi is bogus -5 ko har housekeeping pass se bacha leta hai. Koi automatic sweep ise kabhi saaf nahi karega.

Ek aur cheez jo isko pukka karti hai: commit d0cc333 ka apna message kehta hai "the other scans still filter on a live assigner, so such a task earns no new points and accrues no new penalties either." 1d39686 ne exactly wahi invariant tod diya — handover `assignedBy` ko dobara live kar deta hai.

Design intent #2 ke against judge karein to yeh seedha violation hai: "the award-time decision stands and must NOT be re-derived." Handover path prune mein to decision freeze karta hai, par scan/rebuild path mein decision NAYE assigner se re-derive ho jaata hai.

**Correction:** Core sahi hai; teen details theek karni hain:

1. "June-due task ka mark month '2026-06' mein girega" — GALAT. `overdueDayFor` (`bonus.service.js:1013-1016`) `d < APP_LIVE_YMD ? APP_LIVE_YMD : d` clamp karta hai, aur `APP_LIVE_YMD = '2026-07-01'` (`backend/src/lib/appLive.js:13`). To June-due task ka -5 mark 2026-07-01 par file hoga, month '2026-07'. Claim ka core (closed month mein back-filing) bachta hai — 2026-08-10 ko July already roll ho chuka hai — sirf month label galat tha. Saath hi: June/July-due task par drip bilkul nahi lagta, kyunki drip ka apna floor `DRIP_FLOOR_YMD = '2026-08-01'` `t.dueYMD` par lagta hai (`:1064`). Sabse purana month jismein yeh galat mark gir sakta hai woh '2026-07' hai.

2. "plus a drip for every subsequent day, and `rebuildOverdueForTask` will fill 2026-08-04 onward" — half sahi. `scanOverdueTasks` har run mein sirf AAJ ka drip likhta hai (`awardOnce('auto_overdue:<id>:<today>')`, `:1066`). To pehle tick par: -5 on 2026-08-03 + ek drip on 2026-08-10. 08-04 se 08-09 tak ke din scan khud kabhi back-fill nahi karta. `rebuildOverdueForTask` (`:749-752`) unhein bharta zaroor hai, par tab jab koi use call kare — practically due-date edit on a PENDING task (`task.service.js:799` → `onAssignedTaskUndone` → `bonus.service.js:701`). `backfillOverdueRuleV2` flag-gated hai (`:1083`) aur dobara nahi chalega. Yaani gap-days ka back-fill automatic nahi, trigger chahiye — lekin heir ka deadline push karna bilkul rozmarra ki baat hai, aur tab poora 08-04..08-09 ek saath gir jaata hai.

3. Heir ko owner-tier hone ke alawa `canAssignAny` bhi paas karna padta hai (`user.service.js:355`, `task.service.js:89-92`) — mode ALL ya non-empty SELECTED. `taskAssign` ka default NONE hai (`models/User.js:28`), to CEO automatically eligible nahi hai. Par practically hamesha ALL hoga (poora points gate hi "CEO ne assign kiya" par tika hai), aur `website/components/users/delete-user-dialog.jsx:57-62` owner-tier ko candidate list se alag nahi karta na koi warning deta — CEO baaki sabke saath ek jaisa dikhta hai, jabki usko chunne ka points par side-effect hai.

**Suggested fix:** Sahi fix: award-time ka eligibility answer TASK par persist karo, taaki assigner ke jaane ke baad usay kabhi re-derive na karna pade — dono direction ek saath theek ho jaayein (yeh finding, aur woh mirror jise prune abhi `assignerDeleted ? true` se paper over kar raha hai).

1. `backend/src/models/Task.js` mein `assignerDeleted` ke bagal mein `pointsEligible: { type: Boolean, default: null }` add karo (null = abhi tak decide nahi, normally derive karo).
2. `backend/src/services/user.service.js` mein, dono jagah `assignerDeleted: true` set karne se PEHLE (line 364-367 ka handover, aur line 392 ka detach), affected tasks par `chainEligible(t, await ownerTierIds())` chala kar answer `pointsEligible` mein likh do. Yeh sirf delete ke waqt ek baar chalega — assigner abhi zinda hai, isliye jawab abhi bhi sahi mil sakta hai.
3. `backend/src/services/bonus.service.js` mein `chainEligible` (`:567`) ki pehli line: `if (task.assignerDeleted && typeof task.pointsEligible === 'boolean') return task.pointsEligible;` — aur `pointsEligible` ko in teen jagah project karo: `scanOverdueTasks` ka `.select(...)` (`:1030`), `rebuildOverdueForTask` ka `.select(...)` (`:725`), aur `pruneOrphanTaskEntries` ka `.select(...)` (`:1692`). Prune ki line `:1709` ko wapas plain `await chainEligible(t, ownerIds, chainMemo)` kar do — ab woh khud hi frozen answer lauta degi, aur `assignerDeleted ? true` wala blunt override hat jaayega (jo aaj bhi ek non-owner task ke purane entries ko galat tareeke se "eligible" maan leta hai).

Agar chhota stopgap chahiye jo sirf yeh finding band kare: `scanOverdueTasks` ki query (`:1030`) mein `assignerDeleted: { $ne: true }` add karo, aur `rebuildOverdueForTask` mein `:726` ke guard ke saath `if (t.assignerDeleted) return;` laga do. Isse d0cc333 ka invariant ("assigner gaya = na naye points, na nayi penalties") wapas aa jaata hai, lekin keemat yeh hai ki woh tasks bhi freeze ho jaayenge jo genuinely owner-assigned the aur jinki penalty legitimately chalni chahiye thi. Persist wala fix hi sahi hai.

Iske alawa (alag, MEDIUM): `delete-user-dialog.jsx` mein candidate list par owner-tier ko flag karo aur copy mein batao ki owner-tier heir chunne se un tasks ka points-status nahi badlega — abhi UI is choice ka koi consequence nahi dikhata.

---

## 23. [RED] Handover doesn't exclude tasks the heir already owns, creating self-assigned tasks that double-count and let the heir approve their own work

**Kahan:** `D:/React Projects/office-management-software/backend/src/services/user.service.js`:365 · reviewer: edges · verdict: CONFIRMED

**Claim:** The update filter is `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }` — it excludes the DELETED user's own copies but not the HEIR's. Any pending task the departing user had assigned TO the heir ends up with `assignedBy === owner`, a state the rest of the app treats as impossible: `canAssignTo` returns false for self (task.service.js:81), `createTask` strips self from `assignTo` (line 147), and `updateTask`'s reassignment strips it too (line 667). Consequences are deterministic: `listTasks` returns the row under both `scope:'mine'` (line 946) and `scope:'assigned'` (line 940), and `taskSummary` counts it in both `mine` and `assigned` (lines 1150-1157). Worse, on an approval-gated task `setStatus` line 314 (`wantDone && task.requiresApproval && task.assignedBy && isOwner`) makes the heir submit to themselves — the TASK_APPROVAL notify at line 321 is addressed to `task.assignedBy`, i.e. the heir — and `reviewTask`'s only guard is `isAssigner` (line 389-390), so they approve their own submission. If the heir is owner-tier that self-approval then pays out through `onAssignedTaskDone`.

**Scenario:** Departing manager M had assigned 'Renew the office lease' to H (requiresApproval: true, due 2026-08-20, PENDING) among the 12 open items in M's exit summary. H is the named heir. After delete: task.owner = H, task.assignedBy = H, assignerDeleted = true. H's To-Do page now shows the same single task in 'My tasks' AND in 'Assigned by me', and the header badge counts it twice. H taps Done: instead of closing, it becomes 'awaiting approval', notifies H, and H taps Approve on their own work — the approval gate that leadership deliberately switched on is now a two-tap no-op. If H is CEO-tier, `onAssignedTaskDone` then writes H an `assignedTaskOnTime` award for a task H assigned to H and signed off themselves. Nothing in the dialog warns that some of the '12 open tasks' being handed over are the heir's own.

**Verifier:** The core mechanism reproduces exactly as claimed. I could not refute it at any link in the chain.

THE FILTER. `backend/src/services/user.service.js:365` is verbatim `{ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }` where `uid` is the DEPARTING user. Nothing excludes the heir. `heir` is loaded at line 348 (`User.findById(reassignTasksTo).select('name role isActive taskAssign')`) and the only gates on it are: valid ObjectId (line 341), not the departing user (line 344), active (line 349-351), and `canAssignAny(heir)` (line 353-355). `canAssignAny` (task.service.js:87-90) only reads `taskAssign.mode`. Nothing in that set is incompatible with the heir ALSO being one of the departing user's assignees — a middle manager who receives work from above and delegates below satisfies every gate. So a PENDING task with `assignedBy: M, owner: H` is matched and rewritten to `assignedBy: H, owner: H`.

Ordering check (a possible refutation I tested and discarded): the handover at line 363-366 runs BEFORE the orphan-detach at line 388 (`Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })`). Once re-homed, those rows no longer match `assignedBy: uid`, so the detach does NOT clean them back up. The self-assigned state persists.

SELF-ASSIGNMENT IS OTHERWISE UNREACHABLE — confirmed at all three cited sites. `canAssignTo` returns false for self at task.service.js:80-81. `createTask` strips self from the assignee list at task.service.js:147 (`.filter((id) => id && id !== String(actor._id))`). `updateTask`'s reassignment strips self at task.service.js:667 (same predicate) and then 400s if the list is empty. So `owner === assignedBy` is a state no user-facing path can produce; the handover is the only writer of it.

DOUBLE LISTING — confirmed. `listTasks` pushes `{ assignedBy: actor._id }` for scope 'assigned' (task.service.js:940) and `{ owner: actor._id }` for scope 'mine' (task.service.js:946). The only 'mine' subtraction is `passedOn` — `Task.distinct('forwardedFrom', { assignedBy: actor._id, forwardedFrom: { $ne: null } })` (line 956) — which only removes copies H forwarded onward; a plain re-homed task has no child, so it is not excluded. `taskSummary` (task.service.js:1146-1156) matches `owner: actor._id` for `mine` and `assignedBy: actor._id` for `assigned`, so the same document is counted in both boxes.

SELF-APPROVAL — confirmed, and it is worse than a display bug. `setStatus` line 314: `wantDone && task.requiresApproval && task.assignedBy && isOwner && task.status !== 'DONE'` — all true for H, so tapping Done sets `submittedAt` instead of closing, and the TASK_APPROVAL notify at line 321-322 is addressed to `user: task.assignedBy`, which is now H. `reviewTask`'s only authorisation check is `isAssigner` (task.service.js:389-390) — no owner!==assigner guard anywhere in the function. On approve it sets `status: 'DONE'`, `completedBy = task.completedBy || task.owner` (= H), `approvedBy = actor._id` (= H) and calls `onAssignedTaskDone(task)`.

The UI serves this without friction: `assignerView = isAssigned` (task-board.jsx:1159), `canReview = !!view?.assignerView && awaiting` (task-board.jsx:557) renders the Approve button, and the dedicated queue at task-board.jsx:1040-1042 (`/tasks?scope=assigned&awaiting=1`) surfaces H's own submission at the top of H's own "Assigned by me" tab with one-tap Approve/Reject buttons (lines 1394-1399). Two taps, no other human involved.

POINTS PAYOUT — confirmed, conditional on tier as stated. `onAssignedTaskDone` (bonus.service.js:616) returns early only on `!b.enabled || !task.assignedBy` or `task.forwardedFrom`; `assignedBy` is now H, truthy. The gate at line 632 is `copies.some((c) => taskEligible(c, ownerIds))`, and `taskEligible` (bonus.service.js:555-560) is `task.assignedBy && ownerIds.has(String(task.assignedBy))`. Crucially it does NOT consult `assignerDeleted` — that flag is only honoured in `pruneOrphanTaskEntries` (bonus.service.js:1709). So if H is owner-tier, the gate passes on H's own name and `awardOnce(\`auto_task:${copy._id}\`, { user: copy.owner /* = H */, ... 'assignedTaskOnTime' })` fires at bonus.service.js:674-690. H is paid for work H assigned to H and signed off themselves.

THE DIALOG CANNOT WARN. `exitSummary` (user.service.js:290-292) counts delegated work with the identical filter `{ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } }`, so heir-owned rows are inside the headline number. The dialog's candidate list (delete-user-dialog.jsx:57-62) filters only on id/isActive/taskAssign — it never checks whether a candidate owns any of the tasks being handed over, and the copy at delete-user-dialog.jsx:135-137 promises "the N open tasks they delegated" move, with no breakdown.

**Correction:** Three corrections, none touching the core:

1. WRONG: "the header badge counts it twice." `/tasks/summary` is consumed in exactly one place — task-board.jsx:838 — and only `sum.mine` (line 841) and `sum.tagged` (line 842) are rendered as headline stats. The `assigned` box is returned by the API but is not shown as a stat card, and no header or sidebar badge reads it. The correct statement: the `assigned` box in the taskSummary response is inflated, and the same row is visibly listed under BOTH the "My tasks" tab and the "Assigned by me" tab.

2. Line number: the TASK_APPROVAL notify's `user: task.assignedBy` is task.service.js:322, not 321 (line 321 is `await notify({`).

3. MISSED, and it makes the "My tasks" symptom uglier than described. task-board.jsx:910-914 buckets any row with `assignedBy` into a per-assigner folder keyed on `t.assignedBy.id`. So on H's own "My tasks" tab the re-homed task does not appear as a plain personal to-do — it appears inside a folder labelled with H's OWN name, i.e. "work assigned to me by H". Related: task-board.jsx:294 `canManage = assignerView || (task.owner?.id === myId && !task.assignedBy)` means H cannot edit/delete it from "My tasks" but can from "Assigned by me" — the same document behaves like two different objects depending on which tab it is opened from.

Also worth flagging as ADJACENT and out of scope for this finding (do not fold it in here, it is a separate bug): `onAssignedTaskDone` ignores `assignerDeleted` entirely. For ANY re-homed task — not just the self-assigned ones — if the original assigner was owner-tier and the heir is not, the first completion re-derives eligibility from the heir's role, fails the gate at bonus.service.js:632, and runs `PointEntry.deleteMany({ taskRef: { $in: copies... }, source: { $in: ['auto_task','auto_forward'] } })`, wiping the doer's already-accrued overdue entries. The commit message claims that protection is "asserted directly", but the assertion only covers the daily prune path.

**Suggested fix:** Minimal, one-line backend fix: exclude the heir from the re-homing filter at backend/src/services/user.service.js:365.

  { assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }

Tasks the heir already owns then fall through untouched to the existing orphan-detach at user.service.js:388, which sets `assignedBy: null, assignerDeleted: true` — the pre-existing, correct "assigner gone" behaviour. They keep their earned points (pruneOrphanTaskEntries honours `assignerDeleted` at bonus.service.js:1709) and no self-assigned document is ever created. `handedOver` then reports the true count, so the success toast stops overstating.

Because the count will now legitimately be lower than the `openTasksDelegated` figure the dialog showed, close the gap in the UI too: have `exitSummary` (user.service.js:288-293) additionally return the per-candidate excluded count, or simplest — after the heir is chosen, show a line under the Select reading "K of these N are <heir>'s own tasks and will be left unassigned instead." Otherwise leadership picks an heir, is told 12 tasks move, and 9 move.

Add a defence-in-depth guard while you are there, since `reviewTask` is the security-relevant leg: at task.service.js:390, reject self-review outright — `if (String(task.owner) === String(actor._id)) throw httpError(403, 'FORBIDDEN', ...)` — so no future writer of `assignedBy` can reopen a path that turns a deliberately-enabled approval gate into a two-tap no-op.

Data already in production needs a one-off repair if any delete has run with a handover: `db.tasks.find({ $expr: { $eq: ['$owner', '$assignedBy'] } })` and reset those rows to `assignedBy: null, assignerDeleted: true, submittedAt: null`.

---

## 24. [RED] Deleting a user who was TAGGED on someone else's delegated task still wipes the assignee's points — the assignerDeleted fix only covers the assigner arm

**Kahan:** `D:/React Projects/office-management-software/backend/src/services/user.service.js`:392 · reviewer: edges · verdict: CONFIRMED

**Claim:** `taskEligible` has two arms: the assigner is owner-tier, OR an owner-tier user is in `collaborators` (bonus.service.js:558-559). `deleteUser` only ever stamps `assignerDeleted` on tasks matching `{ assignedBy: uid }` (user.service.js:366 and 392), and the detach block (lines 387-399) cleans `assignedBy`, `decidedBy`, `excusedBy`, `reportsTo`, `createdBy` and `taskAssign.users` but never `Task.collaborators` — I grepped the whole backend and no `$pull` on `collaborators` exists anywhere. Meanwhile `ownerTierIds()` (line 527-534) is a live `User.find({ role: { $in: ownerRoleKeys() } })`, so a deleted user's id disappears from the set within 60s. So a task whose ONLY claim to eligibility was a tagged owner-tier user silently flips to ineligible, `pruneOrphanTaskEntries` re-derives it via `chainEligible` (line 1709, `assignerDeleted` is false so the guard does not apply) and hard-deletes every entry on it (lines 1716-1717). Tagging the CEO to make a task count is a first-class documented feature — `taggableUsers` returns `isOwner` precisely so the assign dialog can tell the assigner whether the task will earn points (task.service.js:102-111).

**Scenario:** Manager M assigns 'Client onboarding pack — Acme' to employee E, due 2026-07-15, and tags President P (owner tier) so it counts for points. E delivers on 2026-07-14 and is awarded +10 (`auto_task:<taskId>`); it shows in E's July total and on the July leaderboard. On 2026-08-10 the CEO deletes P's deactivated account. The delete dialog reports P's own open tasks and delegated work and offers a handover — none of which touches this task, because P was only a collaborator. That night `pruneOrphanTaskEntries` runs: the task still has `assignedBy: M` so it is found, `assignerDeleted` is false so `chainEligible` runs, M is not owner tier and P's id is no longer in `ownerTierIds()`, so the entry is pushed to `dead` and deleted. E's +10 is gone with no record and no way to tell it ever existed — the exact loss design intent #1 forbids, on a path the handover feature never considered.

**Verifier:** Mechanism paper pe reproduce ho gaya, har step verify kiya.

1) COLLABORATOR ARM SE POINTS MILTE HAIN — `taskEligible` (bonus.service.js:555-560) ke do arm hain: `assignedBy` owner-tier (:558) YA `collaborators` mein koi owner-tier (:559). `onAssignedTaskDone` isi gate ko :632 par `copies.some((c) => taskEligible(c, ownerIds))` se lagata hai. To M (non-owner) ka assign kiya task, P (owner-tier) tagged, E ko genuinely award karta hai — `awardOnce` :685-693, `source: 'auto_task'`, `taskRef: copy._id`.

2) DELETE COLLABORATORS KO HAATH NAHI LAGATA — `deleteUser` `assignerDeleted` sirf do jagah likhta hai, dono `{ assignedBy: uid }` par: handover arm user.service.js:364-367 aur detach arm :392. Poore `backend/src` mein `$pull` ke sirf 3 hits hain (roles.js:180, leave.service.js:1117, user.service.js:398 `taskAssign.users`) — `Task.collaborators` par ek bhi nahi. Task.js (56 lines) mein koi pre/post delete hook nahi. To P ki id task ke `collaborators` array mein dangling padi reh jaati hai.

3) SET SE ID GAYAB — `ownerTierIds()` (527-534) live `User.find({ role: { $in: ownerRoleKeys() } })` hai, ~60s cache, aur `isActive` filter NAHI karta. Yahi is bug ka trigger point pin karta hai: sirf DEACTIVATE karne se kuch nahi hota (P abhi bhi set mein hai), points DELETE par marte hain.

4) WIPE — prune ka lookup (:1689-1692) task ko dhoondh leta hai kyunki `assignedBy: M` abhi bhi non-null hai. :1709 par `t.assignerDeleted` false hai, to guard skip aur `chainEligible` chalta hai: `ownerIds.size` non-zero, M owner nahi, `ownerIds.has(String(P))` false (P delete ho chuka), `forwardedFrom` null to loop chalta hi nahi → false. :1716 ka `!eligibleById.get(...)` true → `dead.push(e._id)` → :1727 `PointEntry.deleteMany`. E ke +10 hard-delete, koi tombstone nahi, koi audit row nahi.

5) DIALOG SACH MEIN CHUP HAI — `exitSummary` (user.service.js:287-295) sirf `{ owner: userId, status: 'PENDING' }` aur `{ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } }` count karta hai. `collaborators` word pura function mein nahi aata. To delete dialog (delete-user-dialog.jsx:83-100) is task ka zikr tak nahi karta, aur handover Select (:138) bhi nahi dikhta agar `openTasksDelegated` 0 ho.

Scenario executable hai: `canAssignRole` (permissions.js:127-131) `tRank >= cRank` return karta hai, to ek rank-1 CEO_PRESIDENT doosre rank-1 CEO_PRESIDENT ko delete kar sakta hai (comment :120-121 khud kehta hai "a rank-1 owner role can create any role including another rank-1 role"). Deactivation prerequisite (:332) bhi scenario mein satisfied hai.

Design intent #1 ka seedha ullanghan: delete ne DOOSRE aadmi (E) ke point entries destroy kar diye. Fix commit d0cc333 ne sirf assigner arm band kiya, tagged-owner arm khula hai.

**Correction:** Core sahi hai. Paanch corrections/additions:

A) EK PRECONDITION MISSING HAI (finding ne nahi likha): kam se kam ek owner-tier user delete ke BAAD bacha hona chahiye. bonus.service.js:557 par `if (!ownerIds.size) return true` — agar delete kiya gaya tagged user AAKHRI owner-tier account tha, to set khaali ho jaata hai aur sab kuch eligible padh kar kuch bhi wipe nahi hota. Finding ke scenario mein CEO aur President dono top rank par hain, to precondition satisfy hai — par verdict mein yeh likha jaana chahiye, warna repro attempt single-owner DB par "refuted" dikhega.

B) EK DOOSRA WIPE PATH HAI JO FINDING NE MISS KIYA, AUR WOHI ZYADA KHATARNAAK HAI — `rescoreAllDoneAssigned()` (bonus.service.js:1617-1639) usi daily tick mein :1778 par chalta hai, prune ke theek 5 lines baad. Woh `{ status: 'DONE', assignedBy: { $ne: null }, completedAt: { $gte: cutoff }, forwardedFrom: null }` load karke `onAssignedTaskDone` call karta hai, aur wahan :632-634 par gate fail hone par `PointEntry.deleteMany({ taskRef: { $in: copies }, source: { $in: ['auto_task','auto_forward'] } })` chalta hai. Yeh path `assignerDeleted` ko BILKUL nahi dekhta. Cutoff 45 din hai (:1625); scenario ka task 2026-07-14 complete hua aur delete 2026-08-10 ko — 27 din, window ke andar. Matlab dono paths fire karte hain. Iska seedha implication fix par: sirf prune patch karna kaafi NAHI hai, `onAssignedTaskDone` ka :632 gate bhi freeze flag honour kare warna task in-app edit ya daily rescore par phir se wipe ho jayega.

C) NUKSAAN DONO DIRECTION MEIN HAI, sirf awards nahi — :1716 ka `!eligible` arm `continue` karta hai :1724 ke `e.points < 0` keep-check se PEHLE. To ek abhi bhi PENDING overdue task, jiska ekmatra owner-tier claim tagged (ab deleted) user tha, apne `auto_overdue` negative entries bhi kho deta hai. Late assignee ko chupchaap maafi mil jaati hai — bilkul wahi do-tarfa galti jo commit d0cc333 ne assigner arm ke liye theek ki thi.

D) EK SIDE-EFFECT JO FINDING MEIN NAHI HAI: dangling collaborator id task ki EDITING bhi tod deti hai. `resolveCollaborators` (task.service.js:127-137) ka check `users.length !== uniq.length` (:133) `alreadyOn` keep-set se PEHLE chalta hai, aur keep-set sirf DEACTIVATED logo ko bachata hai, deleted ko nahi (deleted id `User.find` mein aati hi nahi). To assigner jab task edit karta hai aur dialog poori collaborator list wapas bhejta hai (:661-662), 404 "One of the people you tagged was not found" milta hai — task permanently un-editable, aur screen par yeh batane ko kuch nahi ki kiski wajah se.

E) ASSIGNER ARM MEIN BHI EK CHHED BACHA HAI (same root cause, forwarded chains): `chainEligible` ka ancestor fetch (bonus.service.js:575) `.select('assignedBy collaborators forwardedFrom')` karta hai — `assignerDeleted` project hi nahi hota. :1709 ka guard sirf entry-wale task par flag padhta hai. To agar deleted assigner ROOT copy par tha, to root ko flag mil jaata hai par uske descendant copies ka `chainEligible` root ko re-derive karke ineligible padhta hai aur unke entries wipe ho jaate hain. Yani `assignerDeleted` fix forwarded chains ke liye abhi bhi adhoora hai.

F) Chhoti si baat: finding `user.service.js:392` cite karti hai; dono write-sites (:364-367 handover arm aur :392 detach arm) ka blind spot ek hi hai, to fix dono jagah lagana hoga.

**Suggested fix:** Chhota se chhota sahi fix — deleteUser ke detach block mein ek aur write, plus do consumers ko flag sikhana:

1) `backend/src/services/user.service.js` — `isOwnerRole` ko `../lib/roles.js` se import karke detach block (:387-399) mein add karo, EK hi atomic write mein dono kaam:
   `Task.updateMany({ collaborators: uid }, { $pull: { collaborators: uid }, ...(isOwnerRole(user.role) ? { $set: { assignerDeleted: true } } : {}) })`
   Dono zaroori hain: sirf `$pull` karoge to evidence gayab aur wipe wahi ka wahi (aur D-wala 404 fix ho jayega par points marte rahenge); sirf flag set karoge to points bach jayenge par task edit karna phir bhi 404 dega. `isOwnerRole` gate isliye ki jo tagged user owner-tier tha hi nahi, uska tag eligibility decide karta hi nahi tha — us par freeze lagana bekaar drift hai.
   Naam par ek note: `assignerDeleted` ab jhooth bolne lagega ("tagged owner deleted" case bhi isi mein aa gaya). Behtar hai model mein ise neutral naam de do — jaise `eligibilityFrozen` — aur `assignerDeleted` ko purani rows ke liye legacy alias ki tarah padhte raho (`t.eligibilityFrozen || t.assignerDeleted`). Semantic waise hi hai jo commit 1d39686 ne likha: "original evidence gone, award-time decision stands, dobara derive mat karo".

2) `backend/src/services/bonus.service.js:632` — `onAssignedTaskDone` ka owner-tier gate flag honour kare, warna B-wala `rescoreAllDoneAssigned` path (aur har in-app re-score) wipe karta rahega:
   `if (!task.assignerDeleted && !copies.some((c) => taskEligible(c, ownerIds))) { ...deleteMany... return; }`
   (flag set ho to gate skip, prune ke :1709 wali logic se bilkul consistent.)

3) `backend/src/services/bonus.service.js:575` — ancestor projection mein flag add karo (`.select('assignedBy collaborators forwardedFrom assignerDeleted')`) aur `chainEligible` ke loop mein `if (parent.assignerDeleted) return true;` — E-wala forwarded-chain chhed isi se band hota hai.

4) `backend/src/services/user.service.js:287-295` — `exitSummary` mein ek aur count:
   `Task.countDocuments({ collaborators: userId, owner: { $ne: userId }, status: 'PENDING' })`
   aur delete-user-dialog.jsx ke `rows` (:83-100) mein "Tasks they're tagged on" ke roop mein dikhao. Handover isse nahi chahiye (tag koi kaam ka maalik nahi banata), par leadership ko yeh dikhna chahiye ki delete points ke liye kya matlab rakhta hai — abhi dialog bilkul chup hai.

Test (isolated-DB pattern jo pehle se use ho raha hai): CEO + President dono owner-tier; M (non-owner) E ko task deta hai, P tagged, dueYMD set; task DONE karke `auto_task` entry assert karo; P ko deactivate + delete; phir `pruneOrphanTaskEntries()` AUR `rescoreAllDoneAssigned()` dono ko alag-alag chalao aur entry survive kare. Ek pre-fix run bhi lo — dono paths par entry 0 dikhni chahiye, warna test kuch prove nahi kar raha.

---

## 25. [MEDIUM] Nobody is notified about the handover, so an approval-gated submission goes invisible while the assignee keeps taking daily overdue penalties

**Kahan:** `D:/React Projects/office-management-software/backend/src/services/user.service.js`:364 · reviewer: edges · verdict: CONFIRMED

**Claim:** The `Task.updateMany` sends no notifications at all. Every other path in the app that changes who a task belongs to does: `createTask` (task.service.js:181), reassignment (line 727), removal (line 705), content edits (line 803), `forwardTask` (line 539), review (lines 415, 423). Combined with `Notification.deleteMany({ user: uid })` at user.service.js:379, an in-flight approval loses its bell entry with the departing user and no replacement is created for the heir. `scanOverdueTasks` deliberately does NOT skip submitted tasks (bonus.service.js:1025-1030 and the comment there: an approval-gated task counts as unfinished until APPROVED), so the meter keeps running on the assignee the whole time.

**Scenario:** Employee E finished 'Draft the vendor MSA' (due 2026-08-01, requiresApproval) on 2026-08-05 and submitted it; manager M got the TASK_APPROVAL bell but never acted before leaving. On 2026-08-10 M is deleted with heir H. M's notification row is deleted with the account, the task's assigner becomes H, and no notification is sent to H or to E. The submission is only discoverable if H happens to open To-Do → Assigned by me → awaiting queue, which H has no reason to do — H was never told they now hold 12 of M's tasks. E cannot close it themselves (setStatus line 317 no-ops a re-submit) and keeps losing `assignedTaskOverdueDaily` points every single day the task sits there. Adding a notify to the heir (and ideally to each assignee) in the handover block, plus re-creating a TASK_APPROVAL for any task with `submittedAt != null`, is the missing piece.

**Verifier:** The core mechanism is real and unconditionally provable.

1. The handover writes silently. `user.service.js:364-367` is a bare `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }, { $set: { assignedBy: heir._id, assignerDeleted: true } })` with no notification. Stronger than the finding claims: `user.service.js` never imports `notify` at all — line 11 imports only the `Notification` MODEL (used for `deleteMany`). There is no notification capability in the delete path, so this is an omission, not a filtered-out case. `users.controller.js:147-150` only writes an audit row.

2. The contrast is exact. Every other ownership-changing path calls `notify`: `task.service.js:181` (createTask), `539` (forwardTask), `705`/`713` (removal), `727` (reassignment), `803`/`830` (content edits), `415`/`423` (review), `321` (the TASK_APPROVAL itself).

3. The in-flight approval loses its bell. `user.service.js:379` `Notification.deleteMany({ user: uid })` deletes M's TASK_APPROVAL row, and nothing recreates it for H. `notify` also mirrors to Web Push (`Notification.js:37-40`), so both channels are lost.

4. The submitted task IS re-homed and IS still scanned. The `awaitingApproval` virtual (`Task.js:50-51`) is `requiresApproval && status === 'PENDING' && submittedAt`, so a submission still has `status: 'PENDING'`. It therefore matches the handover filter (correct) AND `scanOverdueTasks`'s filter at `bonus.service.js:1030` (`assignedBy: { $ne: null }, status: 'PENDING', dueYMD: { $nin: ['', null] }`), confirming the comment at 1023-1028. `maybeRunDaily` calls it once a day at `bonus.service.js:1774`.

5. E is genuinely stuck. `reviewTask` gates on `isAssigner` (`task.service.js:389-390`), so only H can approve; `setStatus:317` (`if (task.submittedAt) return populated(task)`) no-ops a re-submit.

6. H can see it but is never told. `listTasks` scope 'assigned' is `{ assignedBy: actor._id }` (`task.service.js:940`) plus the awaiting clause (`977-978`), so the task surfaces under "Assigned by me" — discoverable, unannounced.

Reproduced on paper (with the corrected precondition): task 'Draft the vendor MSA', owner E, assignedBy M, requiresApproval, dueYMD 2026-08-01, grace 0, CEO C tagged as a collaborator. E submits 2026-08-05 -> submittedAt set, TASK_APPROVAL created for M. Drip is live because `taskEligible` (bonus.service.js:559) matches the owner-tier collaborator regardless of assigner. 2026-08-10: M deleted with heir H. Line 366 sets assignedBy = H; line 379 deletes M's TASK_APPROVAL; no notification to H or E. Task still matches line 1030 (assignedBy = H, non-null) and still passes `chainEligible` via the tagged CEO, and `today (2026-08-10) > addDays(duePlus, 1) = 2026-08-02`, dueYMD >= DRIP_FLOOR_YMD '2026-08-01', so line 1066 awards `auto_overdue:<id>:<today>` = negative `assignedTaskOverdueDaily` to E every single day until someone tells H to open the awaiting queue.

MEDIUM is right: the accrual itself is the owner's intended 2026-08-08 rule, so the points are not "wrong"; the defect is that the only person who can stop the meter was never informed, and the state is recoverable (H can find it in their list). Not RED.

**Correction:** Four detail corrections; the core stands.

(a) The scenario's "manager M" does NOT produce the drip. `bonus.service.js:1038` gates every overdue mark and drip on `chainEligible`, which resolves through `taskEligible` (`555-560`): true only if the CURRENT `assignedBy` is in `ownerTierIds()` — the minimum-rank role set from `roles.js:136-140`, i.e. CEO/President tier — or an owner-tier user is a collaborator. For a plain manager M with no owner-tier collaborator, `chainEligible` is false BEFORE and AFTER the deletion, so E was never accruing anything and loses nothing. The scenario needs the task to stay owner-tier-visible across the assigner swap: realistically an owner-tier user tagged as a collaborator (which survives any assigner change), or both M and H at owner tier (unlikely here — memory notes a single CEO_PRESIDENT role). Restate the scenario with the tagged-CEO precondition or it is not reproducible.

(b) The sharper framing, and the part the finding misses: the handover is what RE-ARMS the meter. `scanOverdueTasks` filters `assignedBy: { $ne: null }` (`bonus.service.js:1030`). Choosing "Nobody" sends `assignedBy` to null via `user.service.js:392`, dropping the task out of the scan entirely — the drip stops, exactly as `delete-user-dialog.jsx:163-164` promises ("no further overdue penalties build up"). Naming an heir keeps `assignedBy` non-null so the meter keeps running, and the heir branch of the dialog (`delete-user-dialog.jsx:168-171`) mentions only that finished work keeps its history. So the responsible-looking choice is the one that silently keeps penalising the assignee, and the UI says the opposite only for the other branch.

(c) Adjacent mechanism worth its own line: `scanOverdueTasks` does NOT honour `assignerDeleted`. Line 1038 calls `chainEligible(t, ownerIds, chainMemo)` directly, re-deriving the owner-tier decision from the NEW assigner — unlike `pruneOrphanTaskEntries` at `bonus.service.js:1709`, which correctly does `t.assignerDeleted ? true : await chainEligible(...)`. A task assigned by an owner-tier M and handed to a non-owner-tier H silently stops accruing, which contradicts design intent #2 ("the award-time decision stands, must NOT be re-derived"). This is exactly why the "keeps taking penalties" claim is conditional rather than universal.

(d) "E cannot close it themselves" is right about approval but there is an undocumented escape: E can withdraw the submission (`task.service.js:336-341` sets `submittedAt = null` and clears TASK_APPROVAL), then mark done again, which now passes the `if (task.submittedAt)` check at 317 and fires a fresh TASK_APPROVAL to the CURRENT `assignedBy` — i.e. H. So the state is recoverable by accident, but nothing tells E that and withdrawing reads as undoing their own work.

**Suggested fix:** In the handover block of `deleteUser` (`backend/src/services/user.service.js:364-370`), add `notify` to the imports (from `../models/Notification.js`, alongside the existing model import on line 11) and turn the blind `updateMany` into a find-then-update so you have the affected documents:

1. `const moving = await Task.find({ assignedBy: uid, status: 'PENDING', owner: { $ne: uid } }).select('_id owner title dueYMD submittedAt requiresApproval');` then run the existing `updateMany` over `{ _id: { $in: moving.map(t => t._id) } }` so the set is identical to what you notify about (`updateMany` returns no documents, only a count).

2. Notify the heir once with the total: `notify({ user: heir._id, type: 'TASK_ASSIGNED', title: \`You now hold ${moving.length} of ${user.name}'s tasks\`, message: ..., link: '/todo?scope=assigned' })`. Without this H has no reason to ever open "Assigned by me".

3. Notify each assignee that their task changed hands, so E knows who to chase: loop `moving` and `notify({ user: t.owner, type: 'TASK_ASSIGNED', title: \`${heir.name} took over a task from ${user.name}\`, message: t.title, link: todoLink(t._id) })`.

4. Re-create the lost approval call-to-action for every in-flight submission: for each `t` where `t.submittedAt` is set, `notify({ user: heir._id, type: 'TASK_APPROVAL', title: 'Work waiting for your approval', message: t.title, link: todoLink(t._id, true), entityType: 'Task', entityId: t._id })`. The `entityType`/`entityId` pair is required, not optional — `clearNotificationsFor('Task', task._id, { types: ['TASK_APPROVAL'] })` at `task.service.js:340` and `404` keys on exactly those two fields, so a replacement raised without them would survive review or withdrawal and linger in H's bell forever.

Keep all four best-effort — `notify` already swallows its own errors (`Notification.js:41-43`) — so a bell hiccup can never half-delete the account (design intent #4). Do this inside the `if (reassignTasksTo)` block only; the no-heir path correctly needs no notification because line 392's `assignedBy: null` takes the task out of the overdue scan.

Separately (small, and it closes correction (b)): update the heir branch of `website/components/users/delete-user-dialog.jsx:168-171` to say that overdue penalties keep accruing for the assignees under the new owner, so the two branches describe the same rule from both sides.

---

## 26. [MEDIUM] Delete proceeds with no handover option and an empty summary if the exit-summary request fails

**Kahan:** `D:/React Projects/office-management-software/website/components/users/delete-user-dialog.jsx`:113 · reviewer: edges · verdict: CONFIRMED

**Claim:** The dialog derives everything from one query (lines 43-47) and has no error branch. On failure TanStack sets `isLoading` false with `data` undefined, so `exitLoading` is false, `rows` is `[]` (line 83), and `delegated` is `0` (line 64). The panel renders an empty `<dl>`, the `delegated > 0` guard at line 138 hides the heir picker entirely, and the destructive button's only guard is `disabled={mut.isPending || exitLoading}` (line 113) — nothing blocks the delete. There is also no retry affordance and no toast for the failed query.

**Scenario:** Leadership opens Delete on a departing manager who has 23 open delegated tasks. The `/users/:id/exit-summary` call times out (Lambda cold start, or a transient 500 — the same class of failure the rest of this codebase guards against elsewhere). The dialog shows a blank grey box where 'Work they delegated, still open: 23' should be, no picker, no warning. The leader reads the blank panel as 'nothing outstanding', clicks 'Delete permanently', and all 23 tasks fall to `assignedBy: null` with no heir — the precise outcome the feature exists to prevent, reached without ever being offered the choice. The dialog should render an error state and disable the destructive button until the summary loads.

**Verifier:** Reproduced end to end on paper; every mechanical claim holds.

CHAIN: `api.get` throws `ApiError` on any non-2xx (website/lib/api.js:90-98). The shared client sets `retry: 1` with no `throwOnError` and there is no error boundary (website/lib/queryClient.jsx:9-18), so a failed exit-summary settles as status 'error', isPending false. The dialog destructures only `{ data: exit, isLoading: exitLoading }` (delete-user-dialog.jsx:43-47) — no `isError`, no `error`, no `refetch`. Therefore `exitLoading === false` and `exit === undefined`, so `rows` is `[]` (line 83-100) and the panel renders an empty `<dl>` inside a styled box; `delegated` is `0` (line 64), so the `delegated > 0` guard at line 138 removes the heir picker AND the "nobody named against them" warning; and the destructive button's only guard, `disabled={mut.isPending || exitLoading}` (line 113), leaves it enabled.

WRONG OUTCOME IS REAL: with no `reassignTasksTo` the backend skips the handover block (user.service.js:342-370) and falls through to user.service.js:392, `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })` — all 23 still-open delegated tasks end up with no assigner. That is exactly the outcome the feature was built to prevent, reached without the operator ever being offered the choice.

THE REPRO IS STRONGER THAN REPORTED — it is deterministic, not transient. The two routes disagree on permission: `GET /users/:id/exit-summary` requires `deactivateUsers` (backend/src/routes/users.routes.js:39) while `DELETE /users/:id` requires `manageUsers` (line 46), and the UI gates the menu item on `manageUsers` alone (`{canManage && !row.original.isActive && row.original.id !== user.id}` -> "Delete permanently", website/components/users/users-directory.jsx:166-168). `manageUsers` and `deactivateUsers` are separate, independently-tickable checkboxes in the roles editor (backend/src/lib/permissionCatalog.js:52-53), and `can()` reads the DB-backed per-role set before any hardcoded fallback (backend/src/lib/permissions.js:74-75; frontend mirror website/lib/permissions.js:136). So a role holding `manageUsers` without `deactivateUsers` gets a hard 403 on exit-summary every single time: blank panel, no picker, delete button live, and the DELETE itself succeeds because it only needs `manageUsers`. For that whole role class the handover feature is invisible and unreachable, 100% of opens.

WARM-CACHE DEFENCE FAILS: the `['user-exit', target.id]` key is shared with edit-user-dialog.jsx:101-105, but that query is `enabled: open && canDeactivate && !isSelf && target.isActive !== false`, while Delete is only offered for INACTIVE users and user.service.js:332-334 rejects deleting an active one. So the delete dialog is effectively always the cold fetch; a stale cached row could only exist if someone deactivated and deleted inside the 5-minute default gcTime.

HOUSE PATTERN CONFIRMS INTENT: website/components/glass/query-error.jsx:16 states "Render this instead whenever `isError` is set and there is no cached data to show," and its docblock (lines 11-15) describes this exact regression class — destructuring only `{ data, isLoading }`, data undefined, fallback to an empty array, an empty state shown for a request that never arrived. Over 20 call sites follow `isError && !data`. This new dialog is the single place that skipped it, and the only one where the resulting action is irreversible.

SEVERITY: MEDIUM is the right call and I am not upgrading it. Nothing is destroyed that survived before (the tasks persist, `assignerDeleted` is still set at line 392, so the award-time eligibility decision is preserved per design intent 2 and no points go wrong), and there is no security hole — the server gates are each correctly enforced; the operator genuinely is allowed to delete. It is a misleading UI plus a missing guard on an irreversible action. But it sits at the top of MEDIUM, because the deterministic permission split means it is not a rare edge and the lost handover cannot be recovered after the delete.

**Correction:** Three corrections/additions to the finding as written:

(1) The failure is not merely transient. The finding frames it as a Lambda cold start or transient 500. There is a deterministic path: exit-summary requires `deactivateUsers` (routes/users.routes.js:39) but the delete route and the UI menu item both require only `manageUsers` (routes/users.routes.js:46; users-directory.jsx:166). Any role with `manageUsers` and not `deactivateUsers` — a combination the roles editor exposes as two separate checkboxes (permissionCatalog.js:52-53), honoured by the DB-backed `can()` (permissions.js:74-75) — hits a 403 on every open. This should be the headline repro; it needs no flaky network.

(2) The finding says "no error branch". Precisely: `isError`, `error` and `refetch` are never destructured at delete-user-dialog.jsx:43-47, which is why no branch is even possible. Worth stating because the fix is to destructure them, not to add a try/catch.

(3) "the same class of failure the rest of this codebase guards against elsewhere" is literally true and can be cited: website/components/glass/query-error.jsx:11-16 documents this exact regression as one already fixed across ~20 screens (the `isError && !data` pattern). This dialog is the lone regression.

**Suggested fix:** Two halves; both are small, and the permission half is the one that actually keeps the feature alive.

A. Align the permissions so the summary is readable by whoever can delete. In backend/src/routes/users.routes.js:39 change the gate to accept either capability:

  usersRouter.get('/:id/exit-summary', requireAnyPermission('deactivateUsers', 'manageUsers'), exitSummary);

(`requireAnyPermission` is already imported at line 3 and used at line 45.) The endpoint is read-only and already returns nothing a `manageUsers` holder cannot see elsewhere. Without this, fix B alone would permanently block a `manageUsers`-only role from deleting at all — trading a silent wrong outcome for a dead button.

B. Give the dialog a real error state and hold the destructive button. In website/components/users/delete-user-dialog.jsx:43-47 destructure the error surface:

  const { data: exit, isLoading: exitLoading, isError: exitError, error: exitErr, refetch: refetchExit } = useQuery({ ... });

Then in the panel (lines 121-135) add the middle branch, reusing the existing house component (import { QueryError } from '@/components/glass/query-error'):

  {exitLoading ? (<p …>Checking what's still open…</p>)
   : exitError && !exit ? (<QueryError title="Couldn't check what's still open" error={exitErr} onRetry={refetchExit} />)
   : (<dl …>…</dl>)}

And extend the button guard at line 113 so a delete cannot be issued on an unread summary:

  disabled={mut.isPending || exitLoading || (exitError && !exit)}

The `&& !exit` on both keeps a stale-but-present cached summary usable rather than blocking on a failed background refetch, matching the `isError && !data` convention used at users-directory.jsx:213, task-board.jsx:1332 and leave-history.jsx:100.

---

## 27. [MEDIUM] Forward-chain originator is never detached or re-homed, so the hand-off breadcrumb silently disappears from the assignee's task

**Kahan:** `D:/React Projects/office-management-software/backend/src/services/user.service.js`:387 · reviewer: edges · verdict: CONFIRMED

**Claim:** The detach block clears `assignedBy` but leaves `Task.originalAssignedBy` pointing at the deleted account — it is not in the `Promise.all` at lines 387-399, and the handover at line 364 does not update it either. `listTasks` populates it (task.service.js:1037) and builds `forwardChain` from `[originator, ...handlers].filter(n => n.name)`, then only attaches it when `chain.length >= 3` (task.service.js:1116-1129). A populate against a deleted document yields null, so the originator entry is filtered out and a three-node chain silently collapses to two and is dropped entirely.

**Scenario:** CEO D assigns 'Site survey — Sector 62' to manager M; M forwards it to junior J. J's task shows the chain 'D → M → You', which is how J knows where the work came from and who ultimately wants it. D is deleted on 2026-08-10 with heir H. M's parent copy is re-homed to H correctly. J's child copy is untouched (its `assignedBy` is M, not D), but its `originalAssignedBy` still points at the deleted D: `t.originalAssignedBy` populates to null, `chain` becomes `[M, J]`, length 2, and `forwardChain` is never set. J's task loses its provenance entirely with no explanation, at the exact moment the handover was supposed to make provenance clearer — and the row now names H as nothing, while the one person who could answer 'who wants this?' has just been appointed. Carrying the heir into `originalAssignedBy` (or at least nulling it alongside `assignedBy` and keeping the chain rendering honest) is missing.

**Verifier:** Mechanism paper pe reproduce ho gaya, end-to-end.

Setup: `forwardTask` child copy pe originator stamp karta hai — `originalAssignedBy: parent.originalAssignedBy || parent.assignedBy || null` (task.service.js:529).

Scenario (exact 3-node): CEO D → M ko 'Site survey — Sector 62' assign karta hai. Parent copy: owner=M, assignedBy=D, forwardedFrom=null, originalAssignedBy=null. M forward karta hai J ko. Child copy: owner=J, assignedBy=M, forwardedFrom=parentId, originalAssignedBy=D.

Baseline (D zinda): J ki row pe `forwardedRows` me aati hai, originator={D}, handlers walk se [M, J], chain=[D, M, J], length 3 → `t.forwardChain` set (task.service.js:1127-1129) → J ko "D → M → You" dikhta hai.

10-Aug ko D delete hota hai, heir H ke saath:
- Handover (user.service.js:364-367) filter `{assignedBy: D, status:'PENDING', owner:{$ne:D}}` — M ki parent copy match karti hai → assignedBy=H, assignerDeleted=true. Sahi.
- J ki child copy ka assignedBy M hai, D nahi → na handover, na detach block (user.service.js:392) ise chhuta hai.
- `originalAssignedBy` ko **koi bhi query touch nahi karti**. Maine `git log -S originalAssignedBy -- backend/src/services/user.service.js` chalaya: zero commits. Woh field wahan kabhi handle hi nahi hui.

Result: J ki child copy pe originalAssignedBy ab ek deleted document ko point karta hai. task.service.js:1037 ka `.populate('originalAssignedBy','name')` resolve nahi kar pata, `t.originalAssignedBy?.name` falsy, originator `.filter(n => n.name)` (line 1127) se gir jata hai, chain=[M, J] length 2 → gate `>= 3` fail → `forwardChain` set hi nahi hota. UI dono jagah mar jata hai: row ka `ForwardTrail` (task-board.jsx:238-241 — chain empty + origin undefined + koi forwardedTo nahi → `return null`, poora trail block gayab) aur detail sheet ka fallback (task-board.jsx:702 `task.originalAssignedBy?.name`). J ki row sirf "Assigned by M" bolti hai; provenance bilkul chala jata hai, bina kisi explanation ke.

Aur ussi kaam ki do copies ab aapas me disagree karti hain: M ki parent copy "Assigned by H" naam leti hai, J ki copy ke paas H ka koi zikr nahi — jabki H hi woh insaan hai jo ab "yeh kaam kaun chahta hai?" ka jawab de sakta tha.

Points safe hain (isliye MEDIUM, RED nahi): bonus.service.js `originalAssignedBy` ko kabhi padhta hi nahi — `taskEligible` (555-560) sirf `assignedBy` + `collaborators` dekhta hai, aur prune me `assignerDeleted ? true` short-circuit (bonus.service.js:1709) entries bacha leta hai.

**Correction:** Core sahi hai, chaar cheezein correct/expand karni hain:

1. **Impact finding se ZYADA bura hai, sirf "dropped entirely" nahi.** 4+ node chain pe chain gayab nahi hoti — galat ho jati hai. D → M → K → J: J ki copy ka originalAssignedBy=D, handlers walk se [M, K, J]. Originator girne ke baad chain=[M, K, J] length 3 → gate PASS → J ko "M → K → You" render hota hai, yaani UI confidently kehta hai ki kaam M ne shuru kiya tha, jo jhooth hai. Silent disappearance (3-node) se zyada khatarnak silent misattribution (4+) hai.

2. **Yeh REGRESSION nahi, pre-existing gap hai.** `git log -S originalAssignedBy -- backend/src/services/user.service.js` khali hai; d0cc333 se pehle bhi deleteUser sirf assignedBy clear karta tha. Jo cheez YEH commit naya laata hai woh **divergence** hai: pehle dono copies barabar orphaned thi, ab parent copy ek zinda naam (H) dikhati hai aur child copy ka originator dangling rehta hai. Review finding as-is valid hai (yeh diff hi woh jagah hai jo tay karti hai delegated kaam kahan jaata hai, aur do assigner pointers me se sirf ek ko re-home karti hai), par ise "handover ne toda" bolna galat hoga.

3. **Line anchors thoda off hain.** Detach `Promise.all` 387-399 par hai lekin asli line **user.service.js:392** hai; handover **user.service.js:364-367**. 387 sirf `await Promise.all([` hai.

4. **Proposed fix ("heir ko originalAssignedBy me carry karo") ko as-is mat lena — woh design intent #2 todta hai.** `originalAssignedBy` cosmetic field nahi hai: **dashboard.service.js:93** use owner-tier query me chalata hai (`{ originalAssignedBy: { $in: ceoIds } }`). Agar H owner-tier hai to un tasks ko CEO leaderboard me naya qualification mil jayega — yaani ek owner-tier decision ko us evidence se re-derive karna jo delete ho chuka hai; bilkul wahi cheez jise `assignerDeleted` rokne ke liye bana hai. Isliye DB me heir likhne ke bajaye display side theek karna chahiye.

5. **Ek related manifestation jo isi delete se aati hai (worth flagging alag se):** agar deleted user chain ke BEECH me tha (kisi ne D ko diya, D ne J ko forward kiya), to `Task.deleteMany({ owner: uid })` (user.service.js:378) D ki apni copy uda deti hai, jisse J ka `forwardedFrom` dangle karta hai; walk me `loadNode` null return karta hai aur loop `break` kar jata hai (task.service.js:1121-1122) — chain wahi collapse. Points tab bhi safe hain (handover J ki copy pe assignerDeleted=true set kar deta hai), sirf breadcrumb marta hai.

Ek robustness note mere haq me: mechanism is baat par depend nahi karta ki Mongoose dangling ref ko `null` karta hai ya raw ObjectId chhodta hai — dono soorat me `.name` absent hai, to `.filter(n => n.name)` originator ko girata hi hai.

**Suggested fix:** Sabse chhota SAHI fix display side par hai (DB me kuch mat likho, warna dashboard.service.js:93 wali owner-tier query re-derive ho jayegi):

task.service.js ke chain-builder (1112-1130) me walk ke dauran topmost parent ka assigner yaad rakho aur usko originator ka fallback banao — walk already `loadNode` se `assignerId`/`assignerName` uthata hai (1103-1104), to root copy ka current assigner (handover ke baad = H) muft me available hai:

```js
let rootAssigner = null;
let parentId = t.forwardedFrom;
let depth = 0;
while (parentId && depth < 12) {
  const parent = await loadNode(parentId);
  if (!parent) break;
  handlers.unshift({ id: parent.ownerId, name: parent.ownerName });
  rootAssigner = { id: parent.assignerId, name: parent.assignerName }; // topmost jeet-ta hai
  parentId = parent.forwardedFrom;
  depth += 1;
}
// Stamped originator ka account delete ho chuka ho to populate resolve nahi hota. Root
// copy ka MAUJOODA assigner hi woh insaan hai jo ab us kaam ka maalik hai (handover ka heir),
// isliye chain wahi dikhaye — DB me kuch likhe bina.
const originator = t.originalAssignedBy?.name
  ? { id: String(t.originalAssignedBy.id), name: t.originalAssignedBy.name }
  : (rootAssigner?.name ? rootAssigner : { id: null, name: null });
```

Isse J ko "H → M → You" milta hai — sach, aur bina kisi eligibility re-derivation ke.

Agar handover skip kiya gaya ho (koi heir nahi) to root ka assignedBy null hoga; tab chain chup-chaap chhoti karke drop/misattribute karne ke bajaye ek honest placeholder node rakho (e.g. `{ id: null, name: 'Removed user' }` jab `t.originalAssignedBy` set tha lekin resolve nahi hua — model pe id ab bhi maujood hai, sirf populate khali aata hai) aur `chain.length >= 3` gate ko filter se PEHLE ke length par lagao, taki 3-node chain silently gayab na ho.

Optional (agar denormalise karne ka mann ho): forward ke waqt `originalAssignedByName` string bhi stamp kar do — tab deletion se breadcrumb kabhi tootega hi nahi, aur kyunki woh mehez ek string hai, koi query use owner-tier evidence ki tarah re-derive nahi kar sakti.

---

## Refuted

- **ObjectId guard validated string par lagta hai par findById ko raw body value milti hai** (delete-path) — Finding ka core observation ("validate kiya String(), use kiya raw") text-level par sach hai, lekin claimed failure — CastError -> 500 -> user ko pata nahi chalta delete hua ya nahi — code se PROVABLY impossible hai. Maine mongoose 8.24.1 (backend/node_modules, version confirm kiya) ke against actual cast chala kar dekha.

Do baatein milkar finding ko tod deti hain:

(1) Guard line 349 se PEHLE chalta hai. backend/src/services/user.service.js:343 ka throw line 349 ke findById se pehle hai. Matlab jo bhi value line 349 par CastError degi, wo line 343 par already 400 le chuki hoti hai. Maine har JSON-possible shape probe ki:
  - {} -> String()="[object Object]" -> regex FAIL -> 400 at :343 (findById tak pahunchta hi nahi). Isolated cast: THREW CastError — yaani guard exactly wahi rok raha hai jo throw karti.
  - 12345 -> "12345" -> regex FAIL -> 400. Isolated cast: CastError.
  - true -> "true" -> regex FAIL -> 400. Isolated cast: CastError.
  Line 349 tak pahunch kar CastError dene wali koi input EXIST hi nahi karti.

(2) Jo ek shape guard paar karti hai, wo cast bhi saaf ho jaati hai. Scenario me diya gaya exact input ["66f0c2b4e1a2b3c4d5e6f708"]: String() = "66f0c2b4e1a2b3c4d5e6f708" -> regex PASS -> aur phir User.findById(["66f0..."]) CastError NAHI deta. Mongoose 8 use `{_id: {$in: ["66f0c2b4e1a2b3c4d5e6f708"]}}` me cast karta hai (maine query.cast(Model) chala kar getFilter() print kiya). findOne wahi ek heir dhoondh leta hai jo plain string dhoondhta. Uske baad line 366 `assignedBy: heir._id` likhta hai — heir._id ek asli ObjectId hai (select('name role isActive taskAssign') _id ko implicitly rakhta hai), to handover ka outcome plain-string case se BIT-IDENTICAL hai. Na 500, na galat data, na aadha delete. Bypass hai, par consequence zero hai.

Aur bypass widen bhi nahi ho sakta: 2+ element array ka String() comma daalta hai, aur comma [a-f\d] me nahi hai, to ["66f0...","66f0...9"] regex FAIL karta hai (maine verify kiya: regexPass=false). Iska matlab $in kabhi ek se zyada id nahi le sakta — koi injection/widening surface nahi.

Ek aur cheez jo finding ne miss ki par guard ke haq me jaati hai: {"_id":"66f0..."} wo shape hai jo mongoose ke castObjectId (node_modules/mongoose/lib/cast/objectid.js, `if (value._id)` branch) se successfully cast HO jaati, par String() = "[object Object]" hone ki wajah se regex use pehle hi 400 de deta hai. Guard fail-CLOSED hai, fail-open nahi.

Line 346 ka self-check bhi String() par hai, to [uid] wala array bhi wahin pakda jaata hai — us taraf se bhi leak nahi.

Net: koi input aisi nahi jo galat outcome de. Bacha sirf ek cosmetic asymmetry jiska koi observable effect nahi. Isliye REFUTED, DOWNGRADED nahi — finding ka failure scenario disprove ho gaya, aur uski jagah koi chhota-sa asli failure bhi nahi bacha.
