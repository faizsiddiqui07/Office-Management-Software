# Review 2 — delete-handover v2 + the B fixes (11 Aug 2026)

> Same 4 lenses, every finding put to a verifier told to refute it.
> **22 confirmed, 0 refuted.** Two verifiers died mid-stream, so two findings are missing from this record.
>
> This is the SECOND round on my own work. It found five distinct RED, including one
> I introduced in D v2 that destroys data, and which my own e2e test gave a false pass on.

---

## 1. [RED] The daily re-score deletes the exact points pruneOrphanTaskEntries just protected (onAssignedTaskDone never asks gateFrozen)

**Kahan:** `backend/src/services/bonus.service.js`:633 · lens: points

**Claim:** gateFrozen() has exactly two readers in bonus.service: the import at line 10 and pruneOrphanTaskEntries at line 1710. onAssignedTaskDone re-derives the owner-tier gate raw at line 633 — `if (!copies.some((c) => taskEligible(c, ownerIds)))` → `PointEntry.deleteMany({ taskRef: {$in: copies}, source: {$in:['auto_task','auto_forward']} })` — with no freeze check. Its `!task.assignedBy` early return at line 620 shields the assigner-deleted case, but NOT the collaborator-deleted case that commit 00f7b8d was written for: there assignedBy is still set, so the function runs all the way to the delete. rescoreAllDoneAssigned (line 1618) feeds every DONE assigned task completed in the last 45 days straight into it (line 1633), and maybeRunDaily runs pruneOrphanTaskEntries at line 1774 and rescoreAllDoneAssigned at line 1779 — five lines apart, same tick. The same hole is reachable from backfillMonth (line 1434), reviewTask (task.service.js:445) and the due-date re-score in updateTask (task.service.js:828).

**Scenario:** Take one of the five live tasks B1 names: 'Vendor GST reconcile', assignedBy = Ravi (Manager, not owner tier), owner = Sneha, collaborators = [Aamir, CEO_PRESIDENT], due 2026-08-06, DONE 2026-08-05, assignedTaskOnTime = +10 → PointEntry auto_task:<id> +10 to Sneha, month 2026-08. On 2026-08-10 Aamir's account is deleted: user.service.js:400-403 sets pointsGateFrozen=true (delegated + Aamir tagged), then line 414 pulls Aamir out of collaborators. Next daily tick: pruneOrphanTaskEntries selects GATE_FIELDS, gateFrozen(t) is true, Sneha's +10 is kept — the B1 fix working. Then rescoreAllDoneAssigned loads the same task (status DONE, assignedBy=Ravi ≠ null, completedAt inside 45 days, forwardedFrom null) and calls onAssignedTaskDone: ownerTierIds no longer contains Aamir, collaborators is now empty, Ravi is not owner tier → `!copies.some(taskEligible)` is true → the deleteMany fires and Sneha's +10 is gone. Net effect of the whole daily pass: the doer loses 10 points, on the very first night after an unrelated account was deleted. Exactly the defect B1 claims to have fixed, one function over.

**Verifier:** Reproduced on paper, end to end. `onAssignedTaskDone` (backend/src/services/bonus.service.js:617) has two early returns — `!b.enabled || !task.assignedBy` at :620 and `task.forwardedFrom` at :622 — and then re-derives the owner-tier gate raw at :633 (`if (!copies.some((c) => taskEligible(c, ownerIds)))`), hard-deleting every auto_task/auto_forward entry on the chain at :634. It never calls gateFrozen(). A grep of the whole file for gateFrozen|GATE_FIELDS|pointsGateFrozen|assignerDeleted returns only lines 10, 1692, 1693 and 1710 — the import and pruneOrphanTaskEntries. The finding's "exactly two readers" is literally correct.

The `!task.assignedBy` shield at :620 covers the ASSIGNER-deleted case only (user.service.js:412 nulls assignedBy there). It does not cover the COLLABORATOR-deleted case that commit 00f7b8d/B1 exists for: user.service.js:399-404 sets pointsGateFrozen=true on delegated tasks the departing owner-tier user was tagged on, then :415 `$pull`s the tag, and `assignedBy` is left untouched. So the frozen task walks straight past :620 into the raw gate.

Walking the scenario with the real code: task assignedBy = Ravi (non-owner), owner = Sneha, one collaborator Aamir holding the owner-tier role, dueYMD 2026-08-06, status DONE 2026-08-05, PointEntry `auto_task:<id>` +10 to Sneha in month 2026-08. Aamir is deleted on 2026-08-10 → freeze set, tag pulled. Next daily tick: pruneOrphanTaskEntries selects `${GATE_FIELDS}` (:1693), gateFrozen(t) is true (:1710), hasScorableDeadline true (dueYMD set), status DONE → the +10 is kept, exactly as B1 intended. Five lines later maybeRunDaily calls rescoreAllDoneAssigned (:1779). Its query (:1627) is `status:'DONE', assignedBy:{$ne:null}, completedAt:{$gte: now-45d}, forwardedFrom:null` — the task matches on every clause — and feeds it to onAssignedTaskDone at :1633. Inside: b.enabled true, assignedBy=Ravi non-null, forwardedFrom null, descendants empty so copies=[task]; taskEligible (:556) finds assignedBy not in ownerIds and collaborators now [] → false; `!copies.some(...)` is true → PointEntry.deleteMany at :634 removes Sneha's +10 permanently. Nothing ever rewrites it: the only writer is this same function, which will fail the same gate every night.

I tried three refutations and all failed. (1) `taskEligible`'s `if (!ownerIds.size) return true` (:558) cannot save the task, because deleting an owner-tier user requires an owner-tier actor (canAssignRole, backend/src/lib/permissions.js:127-131, `tRank >= cRank`) who cannot delete themselves (user.service.js:328), so at least one owner-tier user always survives and ownerIds.size >= 1. The wipe is guaranteed, not a coincidence of headcount. (2) The task itself survives deletion — `Task.deleteMany({ owner: uid })` (user.service.js:351) only removes tasks the departing user OWNED; here Sneha owns it. (3) Nothing in the same tick restores the entry: scanOverdueTasks (:1019-1069) only `continue`s on an ineligible task and never writes a completion award, and prune cannot resurrect a deleted row regardless of ordering.

This is a genuine gap in 00f7b8d, not a leftover of the reverted attempt: B1 fixed the prune reader and left the award/re-score reader of the same gate untouched.

**Correction:** Four corrections/additions, none of which change the verdict:

1. Scenario notation. "collaborators = [Aamir, CEO_PRESIDENT]" must be read as ONE collaborator, Aamir, whose ROLE is the owner tier. If a second, still-existing owner-tier user were also tagged, taskEligible (:559-560) would pass and nothing would be deleted. Also, the freeze itself only fires when the deleted user is owner-tier (`if (isOwnerRole(user.role))`, user.service.js:399), so the bug is specific to deleting a tagged owner-tier account — which is exactly B1's population ("five tasks in the live data" per the commit message).

2. Adding a gateFrozen() call to onAssignedTaskDone is NOT sufficient on its own. Three of its callers pass projected documents that do not select the flag, so it would read undefined = false: rescoreAllDoneAssigned (:1628), rescoreAssignedTasks (:1657) and backfillMonth (:1429) all select `owner completedBy dueYMD title completedAt submittedAt requiresApproval assignedBy status forwardedFrom collaborators createdAt` with no `pointsGateFrozen`/`assignerDeleted`. Those three selects must gain `${GATE_FIELDS}`. The task.service call sites are safe as they stand — setStatus (:396), reviewTask (:445), settleParent (:628) and updateTask (:828/:858) all pass full documents from `Task.findById`/`Task.find(batchQuery)` with no projection.

3. Reachable call sites are broader than the three the finding names. Beyond rescoreAllDoneAssigned (:1633), backfillMonth (:1434), reviewTask (task.service.js:445) and the due-date re-score (task.service.js:828), the same delete is reachable from setStatus (task.service.js:396) when the assignee finishes a frozen task, from the forward-chain cascade (task.service.js:858), from settleParent (task.service.js:628) and from rescoreAssignedTasks (:1662). setStatus is the worst of the extras: it turns a frozen PENDING task's accrued overdue marks/drips into a silent amnesty on completion, in the opposite direction.

4. Why D v2's harness missed it, which is worth putting in the fix commit: 83c7500's ONLY bonus.service change was exporting scanOverdueTasks (:1019), i.e. the snapshot test runs pruneOrphanTaskEntries + scanOverdueTasks + "let the assignee finish the task". Neither prune nor the overdue scan deletes on a failed gate (the scan just `continue`s at :1039), so the invariant test passes while rescoreAllDoneAssigned — never invoked by the harness — is the one function that breaks it. The regression test must call rescoreAllDoneAssigned (or maybeRunDaily end to end) or it will keep passing over this hole.

**Suggested fix:** In backend/src/services/bonus.service.js, make the owner-tier gate in onAssignedTaskDone read the freeze the same way pruneOrphanTaskEntries does at :1710 — frozen means the gate held when the points were written, so it still holds. Replace :632-636 with:

  const ownerIds = await ownerTierIds();
  if (!gateFrozen(task) && !copies.some((c) => taskEligible(c, ownerIds))) {
    await PointEntry.deleteMany({ taskRef: { $in: copies.map((c) => c._id) }, source: { $in: ['auto_task', 'auto_forward'] } });
    return;
  }

Prefer this over an unconditional `if (gateFrozen(task)) return;` at the top: an early return would also short-circuit the no-deadline gate at :640 and stop a frozen task being re-priced when its due date is corrected, whereas deletion never changes dueYMD/createdAt so that gate needs no freezing.

Then add the flag to the three projections that feed this function, or it reads undefined = false: :1628 (rescoreAllDoneAssigned), :1657 (rescoreAssignedTasks) and :1429 (backfillMonth) — append `${GATE_FIELDS}` to each select, the same template already used at :1693.

Regression test: freeze a DONE, owner-tier-collaborator-tagged, non-owner-assigned task with a +10 auto_task entry, delete the tagged owner, then run maybeRunDaily (or rescoreAllDoneAssigned directly) and assert the entry is byte-identical. Pre-fix it must report 0 points for the doer.

---

## 2. [RED] Reopening a frozen task hard-deletes the doer's own points with no way back — and the frontend suppresses the warning

**Kahan:** `backend/src/services/task.service.js`:397 · lens: points

**Claim:** The design says the frozen points state means 'nothing deleted', but setStatus line 397 still calls onAssignedTaskUndone(task._id) on any reopen, and that function (bonus.service.js:699) does an unconditional `PointEntry.deleteMany({ taskRef, source: {$in:['auto_task','auto_forward']} })`. Its restore path, rebuildOverdueForTask, bails at line 727 on `!t.assignedBy` — which is precisely the frozen state — and neither function consults gateFrozen. Re-completing does not restore either: onAssignedTaskDone returns at line 620 on the same `!task.assignedBy`. The reopener is the task's own owner, so the B2 guard at line 306 (`!isOwner && ...`) does not stop them. The frontend makes it worse: task-board.jsx:1084 gates the 'this takes back your points' confirmation on `t?.assignedBy`, which is null on a frozen task, so the toggle fires straight through with no dialog, while canCompleteTask (line 82) keeps the circle enabled via iOwnTask.

**Scenario:** 'Client onboarding pack': assignedBy = Aamir (CEO), owner = Sneha, due 2026-08-15, DONE on time 2026-08-12 → auto_task:<id> +10 to Sneha for month 2026-08. On 2026-08-13 Aamir is deleted and Ravi is named successor: assignedBy → null, pointsGateFrozen → true, handedOverTo → Ravi. On 2026-08-14 Sneha taps the completion circle on the History row by mistake. No confirmation dialog appears (assignedBy is null). PATCH /tasks/:id/status {PENDING} → line 397 onAssignedTaskUndone → the +10 is deleted → rebuildOverdueForTask returns immediately at `!t.assignedBy`. She taps again to re-complete: onAssignedTaskDone returns at `!task.assignedBy`, awarding nothing. Sneha's August total is permanently 10 points lower, the Rewards page shows no entry, and no pass in the system can ever put it back. A deletion is what created the state that made an ordinary undo irreversible.

**Verifier:** Maine har link code me verify kiya — mechanism bilkul reproduce hota hai, aur ye v2 ke apne stated design ("frozen = no new awards, no new penalties, nothing deleted") ko todta hai.

CHAIN, line by line:

1. Freeze DONE tasks par bhi lagta hai. `backend/src/services/user.service.js:412` — `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`. Koi status filter nahi. Handover wala updateMany (line 383-386) sirf `status: 'PENDING'` par hai, lekin freeze+clear sab par. To ek DONE task jispar +10 pada hai, wo bhi `assignedBy: null + pointsGateFrozen: true` ho jata hai.

2. Owner ko reopen se koi cheez rokti nahi. `task.service.js:294` isOwner true → line 307 ka guard (`!isOwner && !(isCollaborator && sharedPersonal)`) pass. Line 324 no-op guard DONE→PENDING par lagu nahi. Line 333 openChild guard sirf `wantDone` par. Line 344 approval-gate sirf `wantDone` par. Line 366 withdraw sirf `awaitingApproval` par. To flow seedha 374-379 (status=PENDING) → 397 tak pahunchta hai.

3. `task.service.js:397` — `else await onAssignedTaskUndone(task._id);` — poori tarah unconditional, gateFrozen kahin consult nahi hota.

4. `bonus.service.js:698-703` — `PointEntry.deleteMany({ taskRef: taskId, source: { $in: ['auto_task','auto_forward'] } })` unconditional. Sneha ka +10 yahi mar jata hai.

5. Restore fail: `rebuildOverdueForTask` (bonus.service.js:722) line 726 me projection `.select('owner dueYMD title status completedAt assignedBy collaborators forwardedFrom')` karta hai — GATE_FIELDS select hi nahi hote — aur line 727 `if (!t || !t.assignedBy || ...) return;` par turant bail. Kuch bhi rebuild nahi hota.

6. Re-complete bhi kuch wapas nahi lata: `onAssignedTaskDone` (bonus.service.js:617) line 620 `if (!b.enabled || !task.assignedBy) return;` — frozen task par instant return, koi award nahi.

7. Koi automatic pass ise wapas nahi la sakta — maine teeno dekhe: `rescoreAllDoneAssigned` (line 1627) query me `assignedBy: { $ne: null }`, `backfillMonth` ka task scan (line 1429) me bhi `assignedBy: { $ne: null }`, aur `pruneOrphanTaskEntries` (1678) sirf DELETE karta hai, kabhi likhta nahi.

FRONTEND, dono halves confirm:
- `website/components/tasks/task-board.jsx:1084` — `if (t?.status === 'DONE' && !t?.awaitingApproval && t?.assignedBy) { setUndoing(t); return; }` — frozen task par `assignedBy` null hai, to confirmation dialog (line 1652-1659, `undoWarning`) skip ho jata hai aur line 1085 seedha `toggleMut.mutate(t)` fire karta hai. Ironically usi file me line 82 aur 297 `gateFrozen(t)` sahi use karte hain (`website/lib/task.js:24`), sirf 1084 chhoot gaya.
- Circle enabled rehta hai: line 82 `canCompleteTask = iOwnTask(t, myId) || ...` — owner ke liye true. History view line 1568-1583 me `canToggle` hard-coded true + `onToggle={handleToggle}`, aur PersonFolder ka doneTasks list (line 539) bhi wahi wiring use karta hai. To DONE row par tap karna literally ek tap door hai.

Task list me row dikhta hai: `listTasks` scope 'mine' = `{ owner: actor._id }` (task.service.js:983), status DONE filter (line 995) — frozen task Sneha ki History me rehta hai.

INTENT KE KHILAF: `ff41ece revert(tasks): owner's call — restore delete cascade, self-reopen and drip clearing; confirm un-done` — owner ne khud decide kiya tha ki doer apna kaam reopen kar sakta hai LEKIN usse warn kiya jayega ki points wapas jayenge. Frozen state me dono cheezein toot ti hain: warning gayab, aur points reversible nahi rehte. Aur commit 00f7b8d (B) ka apna message B2 ka mechanism exactly yahi describe karta hai ("runs onAssignedTaskUndone... bails out of the rebuild... points were gone with nothing to restore them") — B ne sirf COLLABORATOR ka raasta band kiya (line 306-307), OWNER ka wahi raasta khula chhod diya. To ye B ke apne stated scope ka adhoora fix hai, koi naya alag bug nahi.

**Correction:** Core sahi hai; ye details theek karo:

1. Line attribution: `!isOwner` wala throw `task.service.js:307` par hai; 306 sirf `sharedPersonal` define karta hai. Baaki saare line numbers (397, 620, 698/699, 727, 82, 1084) exact hain.

2. "no pass in the system can ever put it back" — automatic passes ke liye 100% sach (rescoreAllDoneAssigned:1627 aur backfillMonth:1429 dono `assignedBy: {$ne: null}` par filter karte hain; prune sirf deletes). Lekin CEO manually `manual` source ka +10 adjustment daal sakta hai. To "irrecoverable automatically, sirf haath se patch ho sakta hai" kehna zyada precise hai.

3. Reachability: scenario me Aamir CEO hai, aur CEO ko delete karne ke liye doosra owner-tier account chahiye (deleteUser:328 self-delete block, 336 rank guard, 339 deactivate-first). Simpler reachable variant — assigner ek manager hai aur CEO task par COLLABORATOR tagged hai (taskEligible:559-560 tab bhi eligible). Us manager ko delete karo → line 412 wahi `assignedBy: null + pointsGateFrozen: true` set karta hai, aur trap identical hai. Ye variant kisi CEO deletion par depend nahi karta.

4. Fix ke baare me ek important cheez jo finding me nahi hai: sirf `onAssignedTaskUndone` ko gateFrozen se guard kar dena KAAFI NAHI hai. `pruneOrphanTaskEntries` (har rewards load par chalta hai, comment line 1675-1676) line 1725 par `const keep = t && (t.status === 'DONE' || e.points < 0);` karta hai — task ab PENDING hai aur entry positive (+10) hai, to agla prune pass usse waise bhi delete kar dega. Matlab entry ko bachane ke liye prune ko bhi frozen tasks par positive entries keep karni padengi.

5. Aur ek trap jise fix karte waqt avoid karna hai: `onAssignedTaskDone` ko naive tareeke se `wasDelegated()` par switch karna (yaani frozen ko bhi accept karna) purana RED #2 wapas khol dega. Kyunki user.service.js:412 HAR task par freeze lagata hai jo us user ne assign kiya tha — including wo tasks jo kabhi points-eligible the hi nahi (non-owner ne assign kiya, koi owner-tier collaborator nahi). Agar award path me gateFrozen ko "eligible" maan liya, to aisa never-eligible task re-completion par pehli baar points de dega. `pruneOrphanTaskEntries:1710` ye short-circuit safely kar pata hai kyunki wo sirf delete karta hai, kabhi award nahi.

**Suggested fix:** Sabse chhota correct fix = frozen state ko sach me "kuch nahi badalta" banao, dono jagah (delete-side aur prune-side), aur frontend ko sach bulwao:

(a) `backend/src/services/task.service.js:396-397` — reopen par frozen task ke liye points hook skip karo:
```js
if (task.status === 'DONE') await onAssignedTaskDone(task);
else if (!gateFrozen(task)) await onAssignedTaskUndone(task._id);
```
(ya, behtar: `onAssignedTaskUndone` ke andar task load karke `if (gateFrozen(t)) return;` — taaki forward/reassign/edit ke saare callers bhi cover ho jayein; delete-cascade callers 910/917 ko chhodna theek hai kyunki wahan task hi mit raha hai aur prune usse anyway saaf karta hai).

(b) `backend/src/services/bonus.service.js:1725` — warna (a) bekar ho jayega. Frozen task par positive entry PENDING hone ke bawajood rakhni hai:
```js
const keep = t && (t.status === 'DONE' || e.points < 0 || gateFrozen(t));
```
(`GATE_FIELDS` already us projection me select hote hain, line 1693 — to yahan koi projection bug nahi.)

(c) `website/components/tasks/task-board.jsx:1084` — dialog gate ko `gateFrozen` samajhna chahiye (import line 31 me already maujood hai):
```js
if (t?.status === 'DONE' && !t?.awaitingApproval && (t?.assignedBy || gateFrozen(t))) { setUndoing(t); return; }
```
aur `undoWarning` (website/lib/task.js) me frozen case ke liye alag text: "iske points frozen hain — reopen karne par wo na hatenge na dobara milenge", taaki UI server se sach me agree kare.

ALTERNATIVE (zyada principled, thoda bada): deletion ke waqt eligibility ka VERDICT bhi save karo — user.service.js:399-412 se pehle `taskEligible(task, ownerIds)` evaluate karke `pointsEligibleAtFreeze: true/false` likho, aur `onAssignedTaskDone` / `rebuildOverdueForTask` / prune sab usi stored verdict ko padhein. Tab reopen→re-complete symmetric ho jayega (+10 wapas mil jayega) bina never-eligible tasks ko points system me ghaseete. Sirf `gateFrozen ⇒ eligible` maan lena award path me MAT karna — wo purana RED #2 wapas le aayega.

---

## 3. [RED] The freeze does not travel down a forward chain — chainEligible ignores gateFrozen and its parent projection omits the flag

**Kahan:** `backend/src/services/bonus.service.js`:576 · lens: points

**Claim:** pruneOrphanTaskEntries honours the freeze only for the task the entry points AT (line 1710). A forwarded child is not frozen by user.service (the freeze only touches `{assignedBy: uid}` and `{collaborators: uid, assignedBy: {$ne:null}}`; a child's assignedBy is the forwarder, and the deleted owner is not tagged on it), so it falls through to chainEligible. chainEligible walks ancestors with `Task.findById(pid).select('assignedBy collaborators forwardedFrom')` at line 576 — GATE_FIELDS is not in that projection — and evaluates each ancestor with taskEligible (line 580), which never calls gateFrozen. So a frozen parent reads as plain-ineligible from below, and the child's entries are pushed into `dead` at line 1718 and deleted at 1728.

**Scenario:** 'Q2 statutory audit': root R assignedBy = Aamir (CEO), owner = Carol, due 2026-08-20. Carol forwards it to Dave → child C (assignedBy = Carol, forwardedFrom = R). Dave finishes, the chain settles, R reaches DONE on 2026-08-12 on time. onAssignedTaskDone pays the tree: Carol auto_forward:R +5 (forwardOnTime), Dave auto_task:C +10 (assignedTaskOnTime). Aamir is deleted on 2026-08-13 → R gets assignedBy=null + pointsGateFrozen=true; C is untouched. Next daily prune: R is frozen so Carol keeps her +5. For C, gateFrozen(C) is false → chainEligible(C): taskEligible(C) false (Carol is not owner tier, no owner tagged); parent R is loaded without the gate fields, R.assignedBy is null and R.collaborators is empty → taskEligible(R) false; R.forwardedFrom is null so the walk ends → false. C's entry is deleted. Dave silently loses 10 points for work he actually did, while the forwarder above him keeps hers — the same chain, half-paid, because the freeze stopped at the root.

**Verifier:** The mechanism reproduces end to end, and every cited line is accurate.

WHY THE CHILD IS NOT FROZEN. deleteUser freezes exactly two sets: user.service.js:412 `Task.updateMany({assignedBy: uid}, {$set:{assignedBy:null, pointsGateFrozen:true}})`, and user.service.js:399-403 `{collaborators: uid, assignedBy:{$ne:null}}` for owner roles only. Neither walks `forwardedFrom`. And task.service.js:551-561 creates a forwarded child with `assignedBy: actor._id` (the FORWARDER, not the original assigner) and no `collaborators` at all (the field is omitted from Task.create, so it defaults to []). So a child under a frozen root carries neither tag the freeze matches on. It stays unfrozen. Confirmed.

WHY THE FREEZE DOES NOT READ FROM BELOW. bonus.service.js:576 is verbatim `parent = await Task.findById(pid).select('assignedBy collaborators forwardedFrom')` — GATE_FIELDS ('pointsGateFrozen assignerDeleted', pointsGate.js:22) is absent, so the parent's flag deserialises as undefined. Independently, taskEligible (556-561) tests only `assignedBy in ownerIds` or `collaborators ∩ ownerIds`; it never calls gateFrozen. So the ancestor walk cannot see a freeze even in principle.

WHY THE ENTRY IS REACHED AND DELETED. In pruneOrphanTaskEntries the child clears the lookup filter at 1690-1693 (`$or` first arm: its assignedBy is the forwarder, non-null), so it lands in `tasks` and `byId`. At 1710 `gateFrozen(child)` is false, so it falls to `chainEligible`, which returns false per above. At 1717-1718 the entry is pushed to `dead`, and 1728 `PointEntry.deleteMany({_id:{$in:dead}})` hard-deletes it. Meanwhile the root's own entry survives, because 1710 short-circuits to `true` on `gateFrozen(root)`. The asymmetry the finding describes — same chain, half paid — is exactly what the code does.

WHY THE LOSS IS PERMANENT. Nothing re-awards it. onAssignedTaskDone returns at line 620 on `!task.assignedBy`, and the root's assignedBy is now null; rescoreAllDoneAssigned (1627) filters `assignedBy: {$ne: null}`, so the root is never re-scored either. rescoreAssignedTasks (1656) has the same filter. The doer's entry is gone for good.

I attempted three refutations and all failed. (1) The collaborator arm does not catch the child — forwardTask copies no collaborators. (2) The root is not deleted with the user — `Task.deleteMany({owner: uid})` at user.service.js:351 only removes tasks the deleted user OWNED; the root is owned by the forwarder. (3) `originalAssignedBy` on the child DOES still hold the deleted CEO's id (deleteUser detaches assignedBy, collaborators, decidedBy, excusedBy, reportsTo, createdBy and taskAssign.users, but never originalAssignedBy), yet taskEligible does not read that field, so it provides no rescue. The chainMemo at 574-577 is also no help: it is populated only with narrow-projection docs, and the root never enters it under its own id.

This is squarely in scope for commit 00f7b8d, whose stated purpose is that deleting an account must not take other people's points with it. The fix stopped at the tasks the deleted user is tagged on and never followed the forward chain down.

**Correction:** Three corrections, none of which change the verdict.

1. THE PROJECTION IS ONLY HALF THE DEFECT. Adding GATE_FIELDS to bonus.service.js:576 alone fixes nothing, because taskEligible (556-561) never consults gateFrozen regardless of what is projected. Both must change together. The finding does state this, but the headline ("its parent projection omits the flag") reads as if the projection were the bug; the projection is the second half.

2. THE POINT FIGURES ARE ILLUSTRATIVE, NOT DEFAULTS. forwardOnTime seeds at +3 (bonus.service.js:1582), not +5, and assignedTaskOnTime has no seeded default at all — it is configured by leadership (bonus.service.js:34 declares only the label; rulePoints reads it from Setting.bonus.rules). The mechanism is independent of the figures: whatever the doer was paid, all of it is deleted. State the scenario as "Dave loses the full assignedTaskOnTime award" rather than a hard +10.

3. THERE IS A SECOND, OPPOSITE-DIRECTION LEAK ON THE SAME LINE. If the root's assigner is deleted while the chain is still PENDING, the child's already-accrued NEGATIVE entries (the auto_task overdue mark and the auto_overdue drips) are also swept at 1717-1718, because the eligibility test runs before the `e.points < 0` keep-rule at 1725. That mutates frozen points in the assignee's favour, which is still a violation of "nothing deleted". Worth folding into the same fix. Note the accrual side is already correct by accident and must NOT be changed: scanOverdueTasks:1039, backfillOverdueRuleV2:1096 and rebuildOverdueForTask:729 all bail on `!chainEligible`, so no NEW penalties are written down a frozen chain — which is what the design wants.

**Suggested fix:** Make the freeze inheritable downward, and use it only to PROTECT existing entries — never to re-open accrual.

(a) In bonus.service.js, widen the ancestor projection at line 576 to include the gate fields:
    parent = await Task.findById(pid).select(`assignedBy collaborators forwardedFrom ${GATE_FIELDS}`);

(b) Add a chain-aware freeze reader beside chainEligible, sharing the same memo so the prune pays for the ancestor fetches once:
    async function chainFrozen(task, memo = new Map()) {
      if (gateFrozen(task)) return true;
      let cur = task;
      for (let depth = 0; cur.forwardedFrom && depth < 12; depth += 1) {
        const pid = String(cur.forwardedFrom);
        let parent = memo.get(pid);
        if (parent === undefined) { parent = await Task.findById(pid).select(`assignedBy collaborators forwardedFrom ${GATE_FIELDS}`); memo.set(pid, parent); }
        if (!parent) break;
        if (gateFrozen(parent)) return true;
        cur = parent;
      }
      return false;
    }

(c) Use it at bonus.service.js:1710 in place of the bare gateFrozen check:
    eligibleById.set(String(t._id), (await chainFrozen(t, chainMemo)) ? true : await chainEligible(t, ownerIds, chainMemo));

(d) Also protect the negative entries from the 1725 keep-rule path: a task under a frozen chain should skip the whole dead-listing, i.e. `if (frozenById.get(String(t._id))) continue;` before the status/points keep test at 1723-1726, so a still-pending child's accrued drips are not swept either.

(e) Do NOT touch chainEligible's return value itself and do NOT wire chainFrozen into scanOverdueTasks (1039), backfillOverdueRuleV2 (1096) or rebuildOverdueForTask (729). Those already skip frozen-chain members via chainEligible returning false, which correctly implements "no new penalties down a frozen chain". Changing chainEligible to honour the freeze globally would re-open penalty accrual on frozen chains and re-introduce defect 2 from the reverted attempt (back-filing penalties into closed months).

Also fix the loose end this exposed: user.service.js:407-422 nulls assignedBy, collaborators, decidedBy, excusedBy, reportsTo, createdBy and taskAssign.users, but leaves `originalAssignedBy` pointing at the deleted user. task.service.js:265 populates it and 280 puts it in `linked`, so a forwarded task's provenance line will populate to null after a deletion. Not the cause of this bug, but the same sweep should clear it.

Regression test on the throwaway DB, mirroring the 00f7b8d suite: owner-tier Aamir assigns root R to Carol; Carol forwards to Dave (child C); the chain settles DONE on time; assert Carol's auto_forward:R and Dave's auto_task:C both exist; delete Aamir; run pruneOrphanTaskEntries; assert BOTH entries still exist and their points are unchanged. Pre-fix that test must show Dave at 0 while Carol keeps hers.

---

## 4. [MEDIUM] Handed-over approvals never reach the successor's Approvals inbox or its sidebar count

**Kahan:** `backend/src/services/approvals.service.js`:82 · lens: points

**Claim:** reviewTask was converted to isAssignerOf (task.service.js:419) and setStatus now notifies assignerAuthority (line 352), but the module that LISTS what is waiting on a person was not touched: pendingFor filters `Task.find({ assignedBy: user._id, ... })` at line 82, pendingCount the same at line 192, historyFor at line 162. After a handover assignedBy is null and only handedOverTo names the successor, so none of the three ever match. Nothing in the delete path re-points existing TASK_APPROVAL notifications either — they were addressed to the deleted user and go with the account.

**Scenario:** 'Q2 audit pack' requires approval; Sneha submits it 2026-08-09, so the TASK_APPROVAL notification goes to Aamir. On 2026-08-10 Aamir is deleted and Ravi (approveLeave holder, so the Tasks section is enabled for him) is named successor — handedOverTo = Ravi, submittedAt still set, status still PENDING. Ravi opens Approvals: the Tasks section reads 0 and the sidebar dot shows nothing, because pendingCount's query needs assignedBy = Ravi. He has no notification either. The task is only reachable if he happens to open the To-Do 'Assigned by me' tab, whose separate query (task.service.js:977) does include handedOverTo. Two surfaces built to answer the same question — 'what is waiting on my decision' — now disagree, and the one the CEO actually uses says nothing is.

**Verifier:** Maine refute karne ki poori koshish ki, lekin mechanism paper par exactly reproduce ho jaata hai. Har link verified:

1) HANDOVER TASK KO PAKADTA HAI. `deleteUser` ka handover update `backend/src/services/user.service.js:383-386` hai: `Task.updateMany({ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }, { $set: { handedOverTo: heir._id } })`. Ek approval-pending task ka status PENDING hi rehta hai — `task.service.js:344-350` sirf `submittedAt` set karta hai, `status` ko chhuta hi nahi, aur `Task.js:64-66` ka `awaitingApproval` virtual `requiresApproval && status==='PENDING' && submittedAt` hai. Sneha na Aamir hai na Ravi, to `owner: {$nin:[...]}` bhi pass. Task match karta hai.

2) assignedBy PERMANENTLY null ho jaata hai. `user.service.js:412`: `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`. Aur `assignedBy` poore task.service me sirf CREATE par likha jaata hai (`task.service.js:176`, `:556`, `:759`) — kisi existing doc par kabhi re-set nahi hota. To ye null permanent hai.

3) TEENO APPROVALS QUERIES MISS KARTI HAIN. `git show --stat 83c7500` confirm karta hai ki `approvals.service.js` dono commits me touch hi nahi hua. Wahan:
   - `approvals.service.js:82` — `Task.find({ assignedBy: user._id, requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } })`
   - `approvals.service.js:192` — `Task.countDocuments({ assignedBy: user._id, ... })`
   - `approvals.service.js:161-165` — `Task.find({ assignedBy: user._id, ..., $or: [{ approvedBy: user._id }, ...] })`
   Teeno `assignedBy` par exact-match hain, `handedOverTo` ka koi zikr nahi. `assignedBy` null hone ke baad Ravi ka `_id` inme kabhi match nahi karega.

4) SECTION KHULTA HAI, ROW ZERO. `sectionsFor` (`approvals.service.js:45-53`) me `tasks: allowed` hai jahan `allowed = can(user,'approveLeave') || can(user,'approveRegularization')` (`:36-38`). Ravi approveLeave rakhta hai, to Work tab render hota hai — `approvals/page.jsx:97` `visibleTabs` use dikhata hai, aur `page.jsx:206-217` empty state print karta hai: "Work comes here when someone finishes a task you handed out... None of yours is waiting." Ye seedha jhooth hai.

5) NOTIFICATION BHI NAHI. `user.service.js:352` me `Notification.deleteMany({ user: uid })` — Aamir ko addressed TASK_APPROVAL notification account ke saath delete ho jaata hai, aur delete path me kahin bhi `Notification.updateMany` se re-point nahi hota. Ravi ke bell me kuch nahi aata.

6) DOOSRA SURFACE SACH ME KAAM KARTA HAI (yaani drift real hai, dono jagah blank nahi). To-Do ka "Assigned by me" tab apni alag query maarta hai — `task-board.jsx:1043-1045` `/tasks?scope=assigned&awaiting=1&limit=500` → `listTasks` `task.service.js:977` `$or: [{assignedBy}, {handedOverTo}]` + `:1015` awaiting clause. Wahan task dikhta hai, Approve/Send back buttons `task-board.jsx:1400` par live hain, aur `reviewTask` `task.service.js:419` par `isAssignerOf` → `assignerAuthority` (`:244-251`) `handedOverTo` ko accept karta hai. To Ravi approve kar SAKTA hai — bas usko pata hi nahi chalega.

7) TAB HAMESHA MAUJOOD HOGA. `deleteUser` heir ko `canAssignAny` (`user.service.js:376`) se filter karta hai, aur frontend ka `canAssign` (`task-board.jsx:767`) bilkul wahi test hai (`mode==='ALL' || (mode==='SELECTED' && users.length)`). To valid heir ke paas "Assigned by me" tab hamesha rahega — matlab ye finding data-loss nahi, discoverability/drift defect hai. MEDIUM sahi hai.

REGRESSION NAHI HAI, INCOMPLETENESS HAI: is feature se pehle deleted-assigner wala approval-gated task koi bhi decide nahi kar sakta tha (83c7500 ka apna commit message ye maanta hai). v2 ne authority to transfer kar di, par "mere paas kya pending hai" wala module usme shaamil nahi kiya gaya. Isliye MEDIUM — RED nahi, LOW bhi nahi.

**Correction:** Core bilkul sahi hai, par teen precision fixes:

(a) SIDEBAR DOT KA FILE GALAT CITE HUA HAI. Sidebar `pendingCount` use karta hi nahi. `website/` par grep karne se sirf `/approvals` (`approvals/page.jsx:83`) aur `/approvals/history` (`:112`) milte hain — `/approvals/count` ka koi frontend caller hai hi nahi, wo endpoint (`approvals.routes.js:16`) practically dead hai. Asli dot `useNavBadges` → `GET /badges` → `backend/src/services/badges.service.js` se aata hai, jahan line 46 par `awaitingMyApproval = latest(Task, { assignedBy: mine, requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } })` — wahi assignedBy-only bug. Aur ye ek jagah nahi, DO dots feed karta hai: `badges.service.js:71` (approvals dot) aur `badges.service.js:62` `todo: newest(assignedToMe, awaitingMyApproval)`. Yaani Ravi ko Approvals par bhi dot nahi milega aur To-Do par bhi nahi — poore nav me ek bhi signal nahi. Finding ne conclusion sahi kaha par blast radius under-state kiya.

(b) historyFor DOUBLY blocked hai, sirf entry par nahi. `approvals.service.js:161-165` me `assignedBy: user._id` ke saath `$or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }]` bhi hai. Ravi jab To-Do se approve karega to `reviewTask` `task.service.js:441` par `approvedBy = Ravi` likhega — par `assignedBy` tab bhi null rahega. To jo decision usne khud liya, wo bhi uski apni Approvals History me kabhi nahi dikhega. Ye same defect ka doosra half hai.

(c) Scenario me "Tasks section reads 0" — technically section render hota hai aur `counts.tasks` undefined/0 hone se tab par badge chip hi nahi chhapta (`page.jsx:196-198` `{n ? ... : null}`), plus wo galat empty-state text. Net effect wahi hai jo finding ne kaha.

**Suggested fix:** Teeno task queries me `handedOverTo` ko `assignedBy` ke barabar khada karo — bilkul waise hi jaise `task.service.js:977`, `:687` aur `:1191` pehle se karte hain:

1. `backend/src/services/approvals.service.js:82` — `{ assignedBy: user._id, ... }` ko `{ $or: [{ assignedBy: user._id }, { handedOverTo: user._id }], requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } }` karo.
2. `backend/src/services/approvals.service.js:192` — `countDocuments` me wahi `$or`.
3. `backend/src/services/approvals.service.js:161-165` — outer `assignedBy: user._id` ko `$and: [{ $or: [{ assignedBy: user._id }, { handedOverTo: user._id }] }, { $or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }] }]` banao — dhyaan rahe ek hi object me do `$or` keys nahi likh sakte, doosra pehle wale ko overwrite kar dega.
4. `backend/src/services/badges.service.js:46` — `awaitingMyApproval` ke filter me bhi wahi `$or`. Yahi ek line dono dots (`:62` todo aur `:71` approvals) theek kar deti hai.

Safety note: ye `$or` double-counting nahi kar sakta. `handedOverTo` sirf `deleteUser` set karta hai un tasks par jinka `assignedBy === uid` hai, aur agli hi line (`user.service.js:412`) us `assignedBy` ko null kar deti hai; aur `assignedBy` kisi bhi existing doc par dobara likha hi nahi jaata (sirf create par — `task.service.js:176`, `:556`, `:759`). Isliye ek task par live `assignedBy` aur stale `handedOverTo` dono kabhi nahi ho sakte — do log same approval kabhi nahi dekhenge.

Alag se, `approvals.service.js:78-80` aur `:50` ke comments (jo "assignedBy is what keeps two people from seeing each other's work" kehte hain) update karne padenge, warna agla reader `$or` ko bug samajh kar hata dega. Projection `:83` me kuch add karne ki zaroorat nahi — `handedOverTo` sirf filter me chahiye, render me nahi.

---

## 5. [MEDIUM] A forwarded chain closes a handed-over parent by itself, skipping the successor's approval entirely

**Kahan:** `backend/src/services/task.service.js`:602 · lens: points

**Claim:** settleParent still tests `parent.assignedBy` directly at line 602 and again at line 629, rather than assignerAuthority(). On a handed-over parent assignedBy is null, so the approval branch is skipped and control falls to line 624, which sets status = DONE and completedAt unconditionally. The line 629 guard then suppresses the TASK_DONE notification too, so the successor is told nothing. This is the one authority check in the file that commit 83c7500 did not convert — setStatus (line 344), reviewTask (line 419), updateTask (line 673) and deleteTask (line 899) all went through assignerAuthority/isAssignerOf.

**Scenario:** Aamir assigns 'Vendor audit' to Carol with requiresApproval = true, due 2026-08-25. Carol forwards it to Dave. Aamir is deleted on 2026-08-13 and Ravi is named successor: the parent (assignedBy=Aamir, PENDING, owner=Carol, not owned by Ravi) matches user.service.js:383 and gets handedOverTo = Ravi. On 2026-08-15 Dave marks his child copy done → settleParent(child) → `parent.requiresApproval && parent.assignedBy` is false because assignedBy is null → the function skips straight past the review hand-off and writes parent.status = 'DONE', completedAt = now. The approval gate Aamir switched on is never exercised by anybody, and Ravi — the person the delete dialog told leadership would 'approve, edit or close' this work — receives no notification and never sees it. The task is simply closed. Compare the non-forwarded path: if Carol had finished it herself, setStatus line 344 would have routed it to Ravi for review.

**Verifier:** The mechanism reproduces exactly as described. settleParent is the one authority check commit 83c7500 did not convert.

PROOF OF STATE. user.service.js:383-386 sets handedOverTo on `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }`. A forwarder parent qualifies: forwardTask (task.service.js:551-575) creates the child but never changes the parent's status, so Carol's copy is still PENDING, owner Carol (neither Aamir nor Ravi), assignedBy Aamir. It matches. Then user.service.js:412 runs AFTER the handover in program order and sets `assignedBy: null, pointsGateFrozen: true`. Final parent state: assignedBy=null, handedOverTo=Ravi, pointsGateFrozen=true, requiresApproval=true, status=PENDING. The child (owner Dave, assignedBy Carol) is untouched — it does not match `assignedBy: uid`.

PROOF OF THE BUG. Dave marks the child DONE -> setStatus:404-405 calls settleParent(child). task.service.js:589-590 loads the parent (PENDING, so no early return); :593-598 finds no open sibling; :600 doer = Dave; :602 `parent.requiresApproval && parent.assignedBy` evaluates `true && null` = falsy, so the whole review hand-off at :603-621 is skipped; control reaches :624-627 which writes status='DONE', completedAt=new Date(), completedBy=Dave and saves. :629 `if (parent.assignedBy)` is also falsy, so the TASK_DONE notification is suppressed. :638 recurses, so a grandparent handed to a different successor is auto-closed by the same branch.

PROOF IT IS THE ONLY UNCONVERTED SITE. `git show 83c7500 -- backend/src/services/task.service.js` converts setStatus (:344 gate, :352 and :382-383 notify), reviewTask (:419), updateTask (:672-673 + the batch query at :687), deleteTask (:898-899), listTasks (:977) and taskSummary (:1191). settleParent appears nowhere in the diff. So the asymmetry the finding names is real: had Carol never forwarded and finished it herself, setStatus:344 (`assignerAuthority(task)` = Ravi) would have set submittedAt and notified Ravi at :351-361.

PROOF THE PROMISE IS BROKEN. website/components/users/delete-user-dialog.jsx:187 tells the deleting leader the successor "can then approve, edit or close them", and :179-180 justifies the whole feature by "no one can approve a submission on it". On this path nobody approves anything and Ravi is not told.

WHY IT IS NOT WORSE THAN MEDIUM. I checked the points side and it is clean in both directions: bonus.service.js:620 returns on `!task.assignedBy`, so onAssignedTaskDone(parent) at task.service.js:628 writes nothing and deletes nothing — and it would equally return if Ravi later approved via reviewTask:445. Zero point delta either way. Overdue drips are also unaffected: bonus.service.js:1031 filters on `assignedBy: { $ne: null }` and additionally excludes forwarded parents via `_id: { $nin: forwardedParentIds }`. So this is a governance/notification defect, not data loss.

WHY IT STILL MATTERS. The close is irreversible for the person who was made responsible: setStatus:307 requires isOwner (sharedPersonal is false because gateFrozen(parent) is true at :306), so Ravi cannot reopen the parent to force the review. Only Carol, the owner whose work it is, can. And converting is provably safe: reviewTask:419 already accepts Ravi via handedOverTo, :425 passes because the child is DONE, and :440 preserves completedBy=Dave that settleParent:609 recorded — so the review branch would behave correctly if it were reachable.

**Correction:** Three details to fix in the write-up.

1. Drop any implication of points harm — there is none, and the finding is stronger for saying so. bonus.service.js:620 (`if (!b.enabled || !task.assignedBy) return;`) means the auto-close at task.service.js:628 writes no entry and deletes none; the approval path would produce the identical (empty) result. Numbers: zero entries created, zero deleted, zero month re-filed, on both paths. The harm is that an approval gate is silently bypassed and the responsible person is never told.

2. "Ravi ... never sees it" is overstated. listTasks scope='assigned' (task.service.js:977) matches `handedOverTo: actor._id`, so the parent does appear on Ravi's "Assigned by me" tab — already DONE, with no TASK_APPROVAL and no TASK_DONE bell. The accurate statement is: he sees a closed task he was never given the chance to review, and setStatus:307 blocks him from reopening it because he is not the owner.

3. Add the exposure bound: this can only bite chains forwarded BEFORE the deletion. forwardTask:527 rejects a parent with `!parent.assignedBy` as 'PERSONAL_TASK', so nobody can build a new forward under a handed-over parent afterwards — i.e. an assignee cannot deliberately forward work to dodge the successor's review; only pre-existing chains settle wrongly. (Separately worth noting to the owner, but not part of this finding: that same line means a handed-over task can no longer be forwarded at all, and tells its holder it is "your own to-do".)

**Suggested fix:** In backend/src/services/task.service.js settleParent, route both tests through the helper that already exists at :244, exactly as setStatus:344/352 does.

Line 602: `if (parent.requiresApproval && assignerAuthority(parent)) {`
Line 612 (inside that branch): `user: assignerAuthority(parent),`
Line 629: `if (assignerAuthority(parent)) {`
Line 631: `user: assignerAuthority(parent),`

Nothing else changes. With no successor named, assignerAuthority returns null and the current auto-close behaviour is preserved unchanged — a task with nobody responsible still settles rather than sitting submitted forever, which is the deliberate "authority passes to nobody" case documented at :238-242. With a successor named, the parent goes to them for review with the doer already recorded at :609, and reviewTask:419 accepts them via handedOverTo.

Regression test to add to the throwaway-DB suite: A assigns to B with requiresApproval, B forwards to C, delete A naming R as successor, C marks done -> assert parent.status === 'PENDING', parent.submittedAt is set, parent.completedBy === C, and a TASK_APPROVAL notification exists for R; then R approves -> parent DONE and the PointEntry snapshot is byte-identical before and after.

---

## 6. [MEDIUM] My-tasks still shows Edit and Delete on a frozen task that the server now refuses

**Kahan:** `website/components/tasks/task-board.jsx`:990 · lens: points

**Claim:** Commit 00f7b8d added gateFrozen to canCompleteTask (line 82) and to TaskRow's canManage (line 297), but missed the second copy of the same rule: `const canMgr = (t) => t.owner?.id === user?.id && !t.assignedBy;` at line 990, which supplies allowEdit/allowDelete to the detail dialog at lines 1166-1167, 1481, 1524 and 1581. A frozen task has assignedBy null, so canMgr returns true for its assignee. It also lands in the personal list rather than an assigner folder, because the grouping at line 913 branches on `t.assignedBy` too. Meanwhile commit 83c7500 tightened the server: updateTask line 672 and deleteTask line 899 now use wasDelegated(task), which is true via gateFrozen, so both calls 403. Before 83c7500 those buttons worked; the guard and the UI moved in opposite directions.

**Scenario:** Sneha's task from the deleted Aamir now shows in 'My tasks' under her own to-dos (line 918), not in an 'Assigned to me' folder. She opens it: the footer renders both Edit (line 578) and Delete (line 583) because view.allowEdit = canMgr(t) = true. Tapping Edit and saving returns 403 ASSIGNED_TASK, 'This task was assigned to you — only the person who assigned it can edit it', on a task the page is presenting as hers. Tapping Delete returns the same. The row itself is already correct — TaskRow's canManage at line 297 hides the pencil and bin — so the two views of the identical task contradict each other.

**Verifier:** Maine har link khud padha, aur mechanism bilkul reproduce hota hai — refute nahi kar paya.

1) State banti hai: `backend/src/services/user.service.js:412` — `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`. To Sneha ke task par assignedBy=null, pointsGateFrozen=true. Agar heir naam kiya gaya to `user.service.js:383-386` PENDING + `owner: { $nin: [uid, heir._id] }` walo par `handedOverTo=Priyanshi` bhi set karta hai (heir kabhi khud assignee nahi hota).

2) Flag client tak pahunchta hai: `task.service.js:1074` ki `Task.find(filter)` par koi `.select()` nahi hai, `Task.js:68` `toJSON({ virtuals: true })` hai, aur `tasks.controller.js:77` raw hi bhej deta hai. Matlab `pointsGateFrozen: true` browser me pahunchta hai — isliye `gateFrozen()` frontend par sach bolta hai aur "field hi nahi aata" wala refutation fail ho jata hai.

3) Row sahi hai: `task-board.jsx:297` `canManage = assignerView || (task.owner?.id === myId && !task.assignedBy && !gateFrozen(task))` → false → pencil/bin (lines 368-377) chhup jaate hain.

4) Dialog galat hai: `task-board.jsx:990` `const canMgr = (t) => t.owner?.id === user?.id && !t.assignedBy;` — yahan `gateFrozen` chhut gaya. Frozen task par owner match + assignedBy null → true. Yeh value `openTask` me `allowEdit`/`allowDelete` banti hai — line 1524 (grouped personal list), 1481 (flat list), 1581 (History tab), 1166-1167 (notification deep-link) — aur `TaskDetailDialog` footer line 578 (Edit) + 583 (Delete) render kar deta hai.

5) Grouping bhi wahi shape use karti hai: line 913 `else if (t.assignedBy)` false hone se task line 919 `personal[]` me chala jata hai, yaani "Assigned to me" folder ke bajaye Sneha ke apne to-dos me. Folder path me allowEdit/allowDelete hard-coded false hai (1548-1549, 1554), isliye galat sirf personal path se hi aata hai.

6) Server sach me refuse karta hai: Edit → `task-dialog.jsx:100` `api.patch('/tasks/'+id)` → `task.service.js:672-673` `wasDelegated(task)` true (kyunki `wasDelegated` line 255 = `!!task.assignedBy || gateFrozen(task)`), aur `isAssignerOf` false (assignerAuthority line 245 = null ya Priyanshi, Sneha nahi) → 403 ASSIGNED_TASK. Delete → `delMut` (line 1187-1188) → `task.service.js:899-901` → wahi 403.

7) Direction wali baat bhi sahi hai: `git show 83c7500` me purana code `if (task.assignedBy)` / `if (task.assignedBy && !isAssigner)` tha — frozen orphan par assignedBy null hone se woh `else if (!isOwner)` par gir jata tha aur owner-assignee ko edit/delete MIL jata tha. 83c7500 ne server band kiya, UI ka doosra copy waisa hi reh gaya.

Concrete scenario: Aamir (assigner) delete hua, Sneha ka task "Vendor GST reconciliation" (dueYMD 2026-08-05, PENDING) ab assignedBy=null + pointsGateFrozen=true, handedOverTo=Priyanshi. Sneha /todo → My tasks → task uske apne to-dos me dikhta hai, row par pencil/bin nahi, par row tap karte hi dialog me Edit + Delete dono. Edit save → PATCH → 403 "This task was assigned to you — only the person who assigned it can edit it". Delete confirm → DELETE → wahi 403. Ek hi task ke do view aapas me ulta bolte hain.

Data loss / points / security ka koi rasta nahi mila — server dono jagah rok deta hai (points wale chaaron purane defects genuinely wapas nahi aaye). Isliye MEDIUM sahi hai, RED nahi.

**Correction:** Finding ke saare line numbers aur claim verify ho gaye; teen chhoti additions:

(a) Yeh sirf "My tasks" tak seemit nahi hai — History tab bhi affected hai. `task-board.jsx:1581` bhi `canMgr(x)` deta hai, aur `user.service.js:412` DONE tasks ko bhi freeze karta hai (status filter nahi hai). To ek purana, complete ho chuka task bhi History me Edit/Delete dikhayega aur 403 dega.

(b) Usi dialog me `task-board.jsx:553` `const iOwn = task && task.owner?.id === myId && !task.assignedBy;` par bhi wahi galti hai. Line 558 ke through frozen delegated task par "Shared with <collaborator>" chip dikhta hai — yaani wahi co-ownership ka signal jo commit 00f7b8d ne server par (`task.service.js:306` `sharedPersonal = !task.assignedBy && !gateFrozen(task)`) jaan-boojh kar hataya tha. Row is chip ko chhupata hai (line 298 `canManage` par depend karta hai), dialog nahi — same do-tarfa contradiction.

(c) `canForwardTask` (line 1144, `!!t?.assignedBy`) is family me galat NAHI hai: server ka `forwardTask` bhi `task.service.js:527` par `if (!parent.assignedBy)` se refuse karta hai, to dono taraf consistent hain. Use mat chhedna.

**Suggested fix:** Sabse chhota sahi fix: `website/components/tasks/task-board.jsx:990` ko line 297 wale shape se milaa do —

  const canMgr = (t) => t.owner?.id === user?.id && !t.assignedBy && !gateFrozen(t);

`gateFrozen` file me pehle se import hai (line 31), to aur kuch nahi chahiye. Isse 1166-1167, 1481, 1524 aur 1581 — chaaron call sites — ek saath sahi ho jate hain aur row/dialog ek hi baat kehne lagte hain.

Saath me (b) ke liye line 553: `const iOwn = task && task.owner?.id === myId && !task.assignedBy && !gateFrozen(task);`

Line 913 ki grouping (`else if (t.assignedBy)`) ko is fix me mat chheduna: folder ek PERSON par key hota hai (line 915-916 `from.id`/`from.name`) aur frozen task par aisa koi person hai hi nahi — `handedOverTo` ko `listTasks` (`task.service.js:1074`) populate hi nahi karta, isliye wahan sirf raw ObjectId aata hai. Frozen task ka personal list me rehna cosmetic hai; asli galti sirf manage-affordance hai. (Agar baad me "Assigned to me" me dikhana hai to pehle `listTasks` me `.populate('handedOverTo', 'name')` add karna padega — waise bhi line 293 ka `from` fallback abhi `from.name` undefined dikhata hai, par woh alag finding hai.)

---

## 7. [RED] The freeze stops at the root: a forwarded child's award is still wiped by the nightly prune

**Kahan:** `backend/src/services/bonus.service.js`:576 · lens: authority

**Claim:** `gateFrozen()` is consulted only for the task an entry hangs off (bonus.service.js:1710). The ancestor walk that decides eligibility for every FORWARDED copy — `chainEligible` (568-584) → `taskEligible` (556-561) — reads only `assignedBy` and `collaborators`, and its ancestor projection at line 576 (`select('assignedBy collaborators forwardedFrom')`, and the same at 592) does not even select `pointsGateFrozen`/`assignerDeleted`, so the flag would read `undefined` = false even if it were tested. Deleting the account a chain's eligibility hung on therefore freezes only the root and leaves every copy below it re-derivable — which is exactly B1's failure mode, one link down. Nothing restores it either: `rescoreAllDoneAssigned` (1627, 1656) filters `assignedBy: { $ne: null }`, so the frozen root is skipped and the child's entries are never rewritten.

**Scenario:** CEO (owner tier) assigns "Ranchi site drawings, due 2026-07-20" to Priya. Priya forwards it to Rohit (child C, assignedBy=Priya). Rohit finishes on 18 Jul; onAssignedTaskDone pays the whole chain per copy (bonus.service.js:692 `taskRef: copy._id`): Priya +5 forwardOnTime on the root T, Rohit +10 assignedTaskOnTime on C. On 1 Aug the CEO's account is deleted: user.service.js:412 sets T to assignedBy=null + pointsGateFrozen=true; C is untouched (its assigner Priya is alive). The next daily pass runs pruneOrphanTaskEntries (bonus.service.js:1774). Entry on T: gateFrozen(T)=true → kept, Priya's +5 survives. Entry on C: gateFrozen(C)=false → chainEligible(C) → C not owner-assigned, no tags → walks to parent T → T.assignedBy is null and T.collaborators is empty → returns false → Rohit's +10 is hard-deleted. Rohit's month drops from e.g. 46 to 36 with no trace, and the doer who actually did the work is the only one who loses. The same happens for the B1 shape the commit was written for: freezing `{ collaborators: uid, assignedBy: { $ne: null } }` (user.service.js:400) marks only the tagged copy, never its forward descendants.

**Verifier:** Reproduced on paper against the code. The freeze is written per-document, but the eligibility question is answered per-CHAIN, and the chain walk cannot see the freeze.

MECHANISM, step by step:

1. `user.service.js:412` — `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`. Only documents whose `assignedBy` IS the deleted user are frozen. A forwarded child's `assignedBy` is the forwarder (`task.service.js:556`, `assignedBy: actor._id`), never the root's assigner, so no child is ever touched. `user.service.js:400` has the same shape for the tagged-collaborator case: `{ collaborators: uid, assignedBy: { $ne: null } }` marks the tagged copy only. There is no `forwardedFrom` walk anywhere in `deleteUser` (I read 300-426 in full).

2. `bonus.service.js:1710` — `eligibleById.set(String(t._id), gateFrozen(t) ? true : await chainEligible(t, ownerIds, chainMemo))`. `gateFrozen` is consulted for the task the entry hangs off and nothing else.

3. `chainEligible` (568-584) and `taskEligible` (556-561) never call `gateFrozen`. The ancestor fetch at :576 is `Task.findById(pid).select('assignedBy collaborators forwardedFrom')` — `pointsGateFrozen`/`assignerDeleted` are not projected, so even adding the check without fixing the projection would read `undefined` = false. `taskEligible` tests only `assignedBy ∈ ownerIds` and `collaborators ∩ ownerIds`, both of which deletion has just emptied.

4. `forwardTask:554` copies `dueYMD: parent.dueYMD` onto the child, so `hasScorableDeadline(C)` is true — the entry dies on the eligibility gate, not the deadline gate. And `assignedBy` on the child is non-null, so the child IS matched by the prune's `$or` at :1692 and does reach the walk. Both potential escape hatches are closed.

SCENARIO WITH NUMBERS (rules: assignedTaskOnTime +10, forwardOnTime +5):
- CEO (owner tier) assigns T "Ranchi site drawings, due 2026-07-20" to Priya. T.owner=Priya, T.assignedBy=CEO.
- Priya forwards to Rohit → child C (task.service.js:551-561): C.owner=Rohit, C.assignedBy=Priya, C.forwardedFrom=T, C.dueYMD=2026-07-20.
- Rohit finishes 18 Jul. `settleParent` closes T, `onAssignedTaskDone(T)` runs: `forwarderIds={T}`, so Priya gets auto_forward +5 on `taskRef=T`, Rohit gets auto_task +10 on `taskRef=C` (:692). Rohit's July = 46.
- 1 Aug: another owner-tier user deletes the CEO's account. :412 sets T.assignedBy=null, T.pointsGateFrozen=true. C untouched. President still exists, so `ownerTierIds()` is non-empty and :558's escape hatch does not fire.
- Nightly `pruneOrphanTaskEntries` (:1774): entry on T → `gateFrozen(T)` true → kept, Priya's +5 survives. Entry on C → `gateFrozen(C)` false → `chainEligible(C)`: `taskEligible(C)` false (Priya not owner tier, no collaborators) → walk to T with the freeze-blind projection at :576 → T.assignedBy null, T.collaborators [] → `taskEligible(T)` false → T.forwardedFrom null → return false. `eligibleById.get(C)` false → :1718 `dead.push(e._id)` → :1728 `PointEntry.deleteMany`.
- Rohit: 46 → 36. Priya, who only forwarded, keeps her +5. The person who did the work is the only one who loses — the exact inversion B was written to stop, displaced one link down the chain.

NOT RECOVERABLE: `rescoreAllDoneAssigned:1627` filters `assignedBy: { $ne: null }, forwardedFrom: null` — T is excluded (null assigner), C is excluded (non-root). `rescoreAssignedTasks:1656` has the same `assignedBy: { $ne: null }` filter.

The same walk fires for the tagged-collaborator shape B was actually written for: freeze the tagged copy at :400, pull the tag at :415, and every forward descendant's ancestor now reads as untagged and unassigned by an owner.

**Correction:** Four refinements to the finding as written:

1. PRECONDITION the finding omits: `taskEligible:558` returns true for everything when `ownerIds` is empty, so if the deleted user were the LAST owner-tier account nothing would be wiped. This never rescues the scenario — `user.service.js:328` blocks self-deletion and `permissions.js:130` (`tRank >= cRank`) requires the deleting actor to be at the same tier or above, so removing an owner-tier user guarantees at least one owner-tier user survives and `ownerIds.size >= 1`. State it as a satisfied precondition, not a gap.

2. The finding calls out `bonus.service.js:592` (`collectChainCopies`) alongside :576. :592 is currently INERT for this bug: `collectChainCopies` is only reached from `onAssignedTaskDone`, which returns at :620 on `!task.assignedBy` — a frozen root always has a null assigner, so it never gets there. The single load-bearing projection is :576. (Still worth adding GATE_FIELDS to :592 defensively, but do not cite it as part of the failure path.)

3. UNDERSTATED — "nothing restores it" is stronger than claimed. Beyond the two rescore filters, `onAssignedTaskDone:620` itself bails on `!task.assignedBy`, so even un-doing and re-completing the chain through the app can never re-award Rohit. The deletion is permanent, not merely un-swept.

4. MISSING CONSEQUENCE — negatives die too, not just awards. In the prune loop the eligibility branch at :1717 pushes to `dead` and `continue`s BEFORE the `const keep = t && (t.status === 'DONE' || e.points < 0)` protection at :1725. So a still-PENDING child copy's `-5` overdue mark and its `auto_overdue:` daily drips are hard-deleted on the same pass. That is the "both directions" case `pointsGate.js`'s own doc comment says the freeze exists to prevent — a late assignee is silently forgiven penalties they had genuinely accrued.

**Suggested fix:** Smallest correct fix — make the ancestor walk freeze-aware in `backend/src/services/bonus.service.js`. Two edits, one file:

(a) Project the gate fields on the ancestor fetch, line 576:
    parent = await Task.findById(pid).select(`assignedBy collaborators forwardedFrom ${GATE_FIELDS}`);
(`GATE_FIELDS` is already imported at :10.)

(b) Short-circuit `chainEligible` (568-584) on a frozen node anywhere in the walk:
    async function chainEligible(task, ownerIds, memo = new Map()) {
      if (gateFrozen(task) || taskEligible(task, ownerIds)) return true;
      let cur = task;
      for (let depth = 0; cur.forwardedFrom && depth < 12; depth += 1) {
        ... fetch parent ...
        if (!parent) break;
        if (gateFrozen(parent) || taskEligible(parent, ownerIds)) return true;
        cur = parent;
      }
      return false;
    }

That covers every shape at once: root-assigner deleted, tagged owner-tier collaborator deleted, and a frozen node sitting mid-chain rather than at the root. It also makes the `gateFrozen(t) ? true : ...` ternary at :1710 redundant but harmless.

Callers that inherit the fix for free: `rebuildOverdueForTask:729`, `scanOverdueTasks:1039`, `backfillOverdueRuleV2:1096`.

Also add GATE_FIELDS to `collectChainCopies`'s projection at :592 (inert today, but it is the same latent trap).

DEFENCE IN DEPTH (recommended, not sufficient alone): in `backend/src/services/user.service.js`, after the two freezes at :400-403 and :412, walk `forwardedFrom` descendants of every just-frozen task (bounded to depth 12 to match `chainEligible`) and set `pointsGateFrozen: true` on them. Do it BEFORE `user.deleteOne()` while the links are intact. This alone is not enough — it leaves rows frozen in older databases unprotected and does nothing for a chain forwarded further AFTER the deletion — so ship (a)+(b) regardless.

REGRESSION TEST (isolated DB, per the project's existing harness): build CEO→Priya→Rohit, complete the chain, assert PointEntry rows {taskRef:T,+5} and {taskRef:C,+10} exist; run `deleteUser` on the CEO with a surviving second owner-tier user; run `pruneOrphanTaskEntries()`; assert BOTH rows still exist. Add the mirror case with an owner-tier collaborator tagged on the root instead of assigning it, and a third with a PENDING child carrying a -5 mark, asserting the mark survives.

---

## 8. [RED] deleteUser destroys the account's records before it validates the successor

**Kahan:** `backend/src/services/user.service.js`:346 · lens: authority

**Claim:** The `Promise.all` at 346-357 hard-deletes Attendance, LeaveRequest, LeaveBalance, Regularization, the user's Tasks, Notifications, PushSubscriptions, AnnouncementRead and LedgerEntry rows. The new `reassignTasksTo` validation runs AFTER it (363-378) and can throw 400 four different ways — bad id, self, not found/inactive, `!canAssignAny(heir)`. There is no transaction and no rollback, and the audit row is only written on success (users.controller.js:54). Before 83c7500 every throw in deleteUser preceded the destructive block; this commit introduced the first one after it. The DELETE route has no zod validator either (users.routes.js:46), so a non-string body value reaches `User.findById` at 370 and CastErrors into a 500 at the same point.

**Scenario:** Rahul is deactivated and deleted; the admin picks Meera as successor from the dialog's candidate list, which is served from the cached react-query `['users']` payload (delete-user-dialog.jsx:53-57). Meera was deactivated an hour earlier by another admin (or her taskAssign was set to NONE), so the cached row is stale. Request DELETE /users/rahul {reassignTasksTo: meera} → lines 346-357 delete Rahul's 214 attendance rows, his FY26 LeaveBalance (quota 12, used 7), 9 leave requests, 6 owned tasks and 4 LedgerEntry rows carrying ₹4,200 of pending dues → line 371 or 376 throws 400 → the client shows "Could not delete user"/"Meera isn't set up to assign work". Rahul's User doc still exists, still listed, still deactivated, now with zero attendance, zero leave balance and no dues ledger. No audit entry records the wipe, nothing is recoverable, and an admin who reacts by cancelling and reactivating him gets an empty shell of an account.

**Verifier:** The core claim is literally true in the code and I could not break it.

PROVEN:
1. backend/src/services/user.service.js:346-357 hard-deletes ten collections: Attendance, LeaveRequest, LeaveBalance, Regularization, Task({owner}), Notification, PushSubscription, PasswordResetToken, AnnouncementRead, LedgerEntry({person}).
2. The reassignTasksTo validation sits AFTER it at :363-378 with four throws: invalid ObjectId (:365), self (:368), not-found/inactive (:372), !canAssignAny(heir) (:377).
3. No session or transaction in deleteUser. A runTransaction helper exists (backend/src/lib/transaction.js:16) but is not used here — grep for startSession/withTransaction returns only that file.
4. `await user.deleteOne()` is at :424, after the detach block at :407-422. So on any of the four throws the User doc SURVIVES while its records are gone. The "empty shell account" claim is exactly right.
5. No archive: grep for pre/post 'deleteMany' hooks across backend/src/models returns nothing. The loss is permanent.
6. Audit is written only after the service resolves — backend/src/controllers/users.controller.js:147-150; the catch at :152-154 routes to sendServiceError with no audit. The wipe leaves no record.
7. backend/src/routes/users.routes.js:46 has no validate() middleware, unlike the POST/PATCH siblings at :41/:45.
8. git show 83c7500 confirms this commit introduced the first throw downstream of the destructive block; the pre-commit guards (self/404/rank/STILL_ACTIVE) were all upstream of it.

REFUTATION ATTEMPTS THAT FAILED (i.e. the finding holds):
- Could the body be silently dropped, making the path dead? No. express.json({limit:'12mb'}) is global at backend/src/app.js:34 and parses DELETE bodies; website/lib/api.js:109 spreads options into request(), which destructures body at :52 and sets init.body at :72-73; the dialog passes it at delete-user-dialog.jsx:72. The body genuinely arrives.
- Is the damage soft or rolled back? No, per 3/4/5 above.
- Does the outer flow re-validate first? No; controller passes req.body?.reassignTasksTo straight through (users.controller.js:143-144).

The mechanism reproduces on paper: any of the four 400s fires after 214 attendance rows, the FY26 LeaveBalance, 9 leave requests, 6 owned tasks and 4 LedgerEntry rows worth Rs 4,200 of dues are already gone, the client shows "Could not delete user", the account is still listed, and nothing recorded that it happened.

Two of the four throws (:365 invalid-id, :368 self) are pure request-body validation needing no DB read at all — there is no reason whatsoever for them to sit downstream of the deletes. That makes the ordering strictly indefensible rather than a trade-off.

**Correction:** Two details are wrong, and the scenario framing is overstated. Neither changes the verdict.

(A) The CastError/500 sub-claim is mostly wrong. The regex at user.service.js:364 — /^[a-f\d]{24}$/i.test(String(reassignTasksTo)) — runs BEFORE User.findById at :370. So {$ne:null} stringifies to "[object Object]", numbers to "123", any junk string stays junk: all fail the regex and throw a clean 400 at :365. They never reach findById. The ONLY value that slips through to a CastError/500 is a one-element array holding a 24-hex string, because String(['aaaa…24hex']) === 'aaaa…24hex' passes the regex and mongoose then cast-fails on _id: [ObjectId]. So "a non-string body value reaches User.findById and CastErrors into a 500" should be narrowed to "a one-element array body value". Same outcome, same point in the flow — but as written the claim misdescribes the code.

(B) The "cached/stale by an hour" scenario is weaker than stated. Global staleTime is 30_000 (website/lib/queryClient.jsx:12) and the dialog's ['users'] query mounts with enabled:!!open (delete-user-dialog.jsx:53-57), so data older than 30s triggers a refetch on open — an hour-old deactivation would normally be corrected before the admin clicks. I also checked for a systematic client/server disagreement and there is none: the client filter at delete-user-dialog.jsx:61-66 is predicate-identical to canAssignAny at backend/src/services/task.service.js:90-93, and taskAssign survives toJSON (backend/src/models/User.js:59-71, which strips only _id and passwordHash).

So replace the stale-cache story with the real triggers, all of which I can support from the code:
  (i) the admin clicks Delete on first paint, before the background refetch resolves — candidates render from cache immediately;
  (ii) true TOCTOU — a second admin deactivates the heir, or sets taskAssign.mode to NONE, between paint and submit;
  (iii) the heir is SELECTED-mode and their users[] is emptied concurrently (note deleteUser itself does exactly this kind of $pull at :421);
  (iv) any non-UI caller — curl, a script, a mobile client — since routes:46 has no validator at all.
The trigger is a race or a direct API call, not an everyday occurrence. Severity stays RED on impact, not on frequency: unrecoverable loss across ten collections, no audit row, and a surviving listed account.

(C) Worth adding: the vulnerable path only opens when reassignTasksTo is sent, and the dialog only sends it when openTasksDelegated > 0 (delete-user-dialog.jsx:155 gates the picker, :72 the body). That means the failure is concentrated on precisely the users with the most entangled records.

**Suggested fix:** Move the whole reassignTasksTo validation block (user.service.js:363-378 — the regex check, the self check, the User.findById lookup, and the canAssignAny check) up to immediately after the STILL_ACTIVE guard at :341, resolving `heir` into a local. Leave the Task.updateMany at :383-386 exactly where it is — it must still run before the detach at :412 sets assignedBy to null, or its {assignedBy: uid} filter matches nothing. Then the destructive Promise.all at :346-357 runs only once every way the request can be rejected has already been ruled out. Zero behavioural change, no transaction required, and it restores the pre-83c7500 invariant that every throw in deleteUser precedes the deletes.

Secondary, at the edge: give the route a validator — usersRouter.delete('/:id', requirePermission('manageUsers'), validate(deleteUserSchema), deleteUser) at backend/src/routes/users.routes.js:46, with reassignTasksTo as z.string().regex(/^[a-f\d]{24}$/).optional(). That kills the array/CastError 500 path before it reaches the service and makes the DELETE consistent with its POST/PATCH siblings at :41/:45.

Do NOT reach for runTransaction here. backend/src/lib/transaction.js:25-27 silently falls back to a session-less run on any deployment without a replica set, so it would give the appearance of atomicity without the guarantee. Ordering is the correct fix.

---

## 9. [RED] handedOverTo is never detached, so a successor who later leaves locks the task forever

**Kahan:** `backend/src/services/user.service.js`:407 · lens: authority

**Claim:** The detach block (407-422) clears every other inbound reference — assignedBy, decidedBy, excusedBy, reportsTo, createdBy, taskAssign.users — but there is no `Task.updateMany({ handedOverTo: uid }, ...)`. A second handover cannot rescue them either: the updateMany at 383-386 matches `assignedBy: uid`, and a handed-over task's assignedBy is already null. The dangling id is then TRUTHY to `assignerAuthority()` (task.service.js:244), so setStatus:344 takes the approval branch and only ever SUBMITS, while reviewTask:419 (`isAssignerOf`) can never be satisfied by anyone — not the assignee, not the CEO. That is strictly worse than naming nobody: with handedOverTo null, assignerAuthority is falsy, line 344 is skipped and the assignee's "done" closes the task immediately.

**Scenario:** Boss B assigns "File GST return, due 2026-09-15, approval required" to Aisha. B is deleted on 1 Aug with Hari named successor → Aisha's copy: assignedBy=null, pointsGateFrozen=true, handedOverTo=Hari. On 1 Nov Hari resigns. Step one of the app's own offboarding is deactivation, and auth.js:35 rejects an inactive user — so from that moment nobody can approve it. The admin then deletes Hari (naming yet another successor, which does nothing here): Aisha's task still carries handedOverTo=<Hari's dead id>. Aisha taps "Mark as done" → task.service.js:344 sees requiresApproval + a truthy assignerAuthority + isOwner → submittedAt is stamped, a Notification row is written to a user id that no longer exists, and the task returns as awaitingApproval. reviewTask 403s for every account in the company; updateTask:673 and deleteTask:899 403 for everyone too. The task can never reach DONE, can never be edited, can never be deleted — only a manual DB write clears it.

**Verifier:** Reproduced on paper, and every escape route I tried is closed in code.

WRITE/CLEAR ASYMMETRY. `handedOverTo` is written in exactly one place — `backend/src/services/user.service.js:385` — and cleared nowhere in the repo (verified by grep across backend/src and website/: the only other hits are readers at task.service.js:245,261,280,687,977,1191, the schema at Task.js:28, and the controller/dialog echo of the response string). The detach `Promise.all` at user.service.js:407-422 clears assignedBy, collaborators, decidedBy, excusedBy, reportsTo, createdBy and taskAssign.users, but has no `Task.updateMany({ handedOverTo: uid }, ...)`.

NO SECOND-HANDOVER RESCUE. The handover match at user.service.js:384 is `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }`. A handed-over task already has `assignedBy: null` (set at user.service.js:412 during the first deletion), so it cannot match. Naming a fresh successor when the successor is deleted is a no-op for exactly the tasks that need it.

DANGLING ID IS TRUTHY. `setStatus` loads the doc with `Task.findById(id)` (task.service.js:291) — unpopulated — so `task.handedOverTo` is a raw ObjectId. `assignerAuthority()` (task.service.js:245) returns it, and it is truthy regardless of whether the User row still exists.

THE DEADLOCK, step by step, on Aisha's copy (assignedBy=null, pointsGateFrozen=true, requiresApproval=true, handedOverTo=<Hari's dead id>, status=PENDING):
- setStatus ownership guard (task.service.js:305): isOwner=true, passes.
- no-op guard (:323): PENDING -> DONE, not skipped.
- forwarded-child guard (:336): no children, passes.
- approval gate (task.service.js:344): `wantDone && requiresApproval && assignerAuthority(task) && isOwner && status !== 'DONE'` — all true, because the dead id is truthy. `submittedAt` is stamped, saved, and `notify()` writes a Notification row addressed to a deleted user (harmless: notify swallows errors at Notification.js:34-44, and Notification.deleteMany({user: uid}) already ran at user.service.js:352). Returns awaitingApproval (virtual, Task.js:64-66: requiresApproval && PENDING && submittedAt).
- reviewTask (task.service.js:419): `if (!isAssignerOf(task, actor)) throw 403`. No leadership override, no permission bypass. Nobody in the company can satisfy it.
- Withdraw (task.service.js:359) works, but re-marking done re-enters :344. Infinite loop, never DONE.

ESCAPES I TRIED AND REFUTED:
- forwardTask (task.service.js:527-529): `if (!parent.assignedBy) throw 400 PERSONAL_TASK`. assignedBy is null, so Aisha cannot forward out of the deadlock and reach the settleParent path.
- settleParent (task.service.js:602) tests `parent.assignedBy` directly, which would have closed a handed-over parent outright — but it is unreachable here because forwarding is blocked above.
- tasks.routes.js: no admin/force route. update, delete and review are the only mutators and all three gate on isAssignerOf.
- The only in-product clearance is deleting the ASSIGNEE's own account (Task.deleteMany({ owner: uid }), user.service.js:346), or a manual DB write.

REACHABILITY. Deletion requires prior deactivation (user.service.js:339 STILL_ACTIVE), and requireAuth rejects inactive users (backend/src/middleware/auth.js:34-37). So the block starts the moment the successor is deactivated — recoverable by reactivation — and becomes permanent on deletion. Nothing exotic is needed: a successor leaving the company is the ordinary case.

CORROBORATION THE FINDING DID NOT CITE. getExitSummary counts `Task.countDocuments({ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } })` (user.service.js:292). Tasks the departing user holds only via handedOverTo are invisible to it, so delete-user-dialog.jsx:69 renders "Work they delegated, still open: 0" and the admin is never prompted to re-home them. The UI actively hides the problem it is creating.

COUNTERFACTUAL (why this is new damage). With heir = NOBODY: assignedBy null, pointsGateFrozen true, handedOverTo null. assignerAuthority is falsy, :344 is skipped, and the assignee's "done" falls through to `task.status = 'DONE'` at :371 and closes normally. So the handover strictly converts a self-closing task into a permanently stuck one.

**Correction:** Two corrections to the finding as written.

1. SCOPE OF THE LOCK IS NARROWER THAN CLAIMED. "can never be edited, can never be deleted" is true but PRE-EXISTING, not caused by the dangling handedOverTo. updateTask:673 and deleteTask:899-901 gate on `wasDelegated(task) && !isAssignerOf(task, actor)`; `wasDelegated` (task.service.js:253-255) is true via gateFrozen() whenever pointsGateFrozen is set, and isAssignerOf is false for everyone when handedOverTo is null too. So an assigner-deleted task is already uneditable and undeletable by anyone with or without a handover — that is the documented design at task.service.js:667-671. The genuinely NEW regression introduced by the dangling reference is the completion deadlock alone: a requiresApproval task that would previously have auto-closed at task.service.js:371 now can never leave awaitingApproval. That is still RED on its own; the finding should not bundle the pre-existing edit/delete lock in as new damage.

2. THE FINDING UNDERSTATES ONE THING AND OVERSTATES ANOTHER. Understated: the deletion dialog cannot even surface the orphans, because getExitSummary (user.service.js:292) counts only `assignedBy: userId`, so delete-user-dialog.jsx:69 shows 0 delegated tasks for the departing successor. Overstated: "a Notification row is written to a user id that no longer exists" implies breakage — notify() try/catches (Notification.js:34-44) so it is a silent dead row, not a crash, and it does not surface the problem to anyone.

Also worth flagging alongside the fix (adjacent, same root pattern, NOT part of this finding's mechanism): settleParent at task.service.js:602 tests `parent.requiresApproval && parent.assignedBy` directly instead of going through assignerAuthority(). On a handed-over parent that reads null, so the parent skips the successor's approval and is closed outright at :622. It is unreachable in this scenario only because forwardTask:527 blocks forwarding a task with a null assignedBy, but it is the same read-assignedBy-directly bug the v2 design set out to eliminate and should be converted in the same change.

**Suggested fix:** Two lines in backend/src/services/user.service.js, plus one query widening.

(a) Make the handover inherit work the departing user holds only by handover. Change the match at user.service.js:383-386 from `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }` to:

  { status: 'PENDING', owner: { $nin: [uid, heir._id] }, $or: [{ assignedBy: uid }, { handedOverTo: uid }] }

That lets a second, third, Nth handover chain correctly instead of dead-ending at the first one.

(b) Detach the leftovers. Add to the Promise.all at user.service.js:407-422, alongside the existing assignedBy clear:

  Task.updateMany({ handedOverTo: uid }, { $set: { handedOverTo: null } }),

Ordering matters: (a) runs before the detach block (it already does, at :380), so the heir claims what it should and (b) only nulls what nobody inherited. Falling back to handedOverTo=null restores the pre-handover behaviour — assignerAuthority is falsy, task.service.js:344 is skipped, and the assignee's "done" closes it — which is degraded but not stuck.

(c) Make the dialog tell the truth. Widen getExitSummary at user.service.js:292 to the same `$or: [{ assignedBy: userId }, { handedOverTo: userId }]`, so "Work they delegated, still open" counts inherited work and the admin is actually prompted to name a successor for it (delete-user-dialog.jsx:69).

Optional hardening, separate commit: convert settleParent's `parent.assignedBy` test at task.service.js:602 to `assignerAuthority(parent)`, and notify that same id at :607 and :628, so a handed-over parent honours its successor's approval instead of self-closing.

---

## 10. [MEDIUM] settleParent bypasses the successor's approval gate on a forwarded chain

**Kahan:** `backend/src/services/task.service.js`:602 · lens: authority

**Claim:** Every other authority check moved to `assignerAuthority()`, but settleParent still tests `parent.assignedBy` directly at 602 (whether to hand the parent up for approval) and at 629 (whether to tell the assigner it closed). On a handed-over parent both read null, so the approval gate is skipped and the parent is force-closed at 624-627, and the successor is never notified that work they are responsible for finished.

**Scenario:** Boss B assigns "Client site survey, approval required" to Priya; Priya forwards it to Rohit (child assignedBy=Priya). B is then deleted with Hari named successor → Priya's copy: assignedBy=null, handedOverTo=Hari, requiresApproval=true. Rohit marks his copy done → settleParent(child) → parent.requiresApproval is true but parent.assignedBy is null → the 602 branch is skipped entirely → the parent is set status=DONE, completedAt=now, completedBy=Rohit with no review at all, and line 629 suppresses the TASK_DONE notice so Hari never learns of it. Had Priya instead pressed "done" on her own copy, setStatus:344 would have submitted it to Hari for approval. The same piece of work therefore either needs Hari's sign-off or doesn't, depending purely on which route closes it.

**Verifier:** I tried to refute this three ways — that the state is unreachable, that the skip is deliberate, and that it costs points — and all three failed.

REACHABILITY (proved, step by step):
1. `backend/src/services/user.service.js:383-386` — the handover writes `handedOverTo: heir` on `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }`. Priya's forwarded PARENT copy (owner Priya, assignedBy B, status PENDING — `awaitingApproval` is a virtual over `status === 'PENDING'`, Task.js:64-65, so even a submitted copy matches) qualifies.
2. `user.service.js:412` then sets `assignedBy: null, pointsGateFrozen: true` on the same doc. Final parent state: assignedBy null, handedOverTo Hari, requiresApproval true, status PENDING. `Task.deleteMany({ owner: uid })` at :351 does not touch it — B owns nothing in this chain.
3. Rohit closes his child → `setStatus` reaches `settleParent(task)` at task.service.js:405 (or :447 via approve). `settleParent` loads the parent unprojected (`Task.findById`, :589), so `handedOverTo` IS in memory — this is not a projection miss, it is simply not read.
4. `task.service.js:602` — `if (parent.requiresApproval && parent.assignedBy)` → `null` → branch skipped entirely. Falls to :624-627: `status = DONE`, `completedAt = now`, `completedBy = Rohit`, `approvedBy` stays null. No review, ever.
5. `task.service.js:629` — `if (parent.assignedBy)` → false → the TASK_DONE notice to the responsible party is suppressed.

DELIBERATE? No. `git show 83c7500 -- backend/src/services/task.service.js` migrated every other authority site in the file to the new helpers — :344 and :352 (submit + notify), :382-383 (done notice), :419 (reviewTask gate), :672-673 and :678 (edit gate), :687 (batch query), :899 (delete gate), :977 and :1191 (listing/summary). settleParent is the single authority site the commit never opened. Nothing in the commit message carves forward chains out. And the receiving end already works: `reviewTask` resolves through `isAssignerOf` (:419), so Hari CAN decide a submitted parent — the submission just never happens.

ASYMMETRY IS REAL: an identically handed-over approval task that was NOT forwarded goes to Hari — `setStatus:344` tests `assignerAuthority(task)`, which returns Hari. Forwarded, it force-closes. Same field, same authority model, opposite outcome.

**Correction:** Five corrections, none of which change the verdict:

1. "Every other authority check moved to assignerAuthority()" is overstated. Several direct `assignedBy` reads legitimately remain and are correct — markSeen :482 ("is this my own note"), forwardTask :527 and :544 (personal-task test, upstream-loop test), batch content edits :807/:825/:856, collaborators :876. The accurate claim is narrower and stronger: of the sites that decide ASSIGNER AUTHORITY, settleParent is the only one the commit missed.

2. It is three lines, not two. If :602 is switched to `assignerAuthority(parent)`, then :612 (`user: parent.assignedBy`) must move with it or `notify()` is called with `user: null` on exactly the newly-reachable path. :629 is the third.

3. Severity MEDIUM is right, and for a sharper reason than the finding gives: there is provably ZERO points impact. `onAssignedTaskDone` bails at bonus.service.js:620 on `!task.assignedBy`, and the parent here IS the chain root, so the early close writes nothing — and honouring the gate would write nothing either, since Hari's later approval calls the same function on the same frozen doc. The nightly re-scores also filter `assignedBy: { $ne: null }` (:1429, :1627, :1656). The freeze holds. This is governance and notification drift only, not a points defect. Do not let anyone escalate it to RED.

4. "Hari never learns of it" — he gets no notification, but the task is not invisible to him: listTasks :977 puts `handedOverTo` rows on his "assigned" tab, where it appears as DONE. The loss is the alert, not the record.

5. The "which route closes it" framing is loose. Priya cannot actually choose the direct-done route on that doc — the FORWARDED_OPEN guard at :335-337 blocks her while Rohit's copy is open, and once he finishes, settleParent has already closed it. The genuine asymmetry is between a handed-over approval task that was forwarded (auto-closes) and one that was not (goes to Hari), not two live routes on one document.

**Suggested fix:** In `settleParent` (backend/src/services/task.service.js:587-639), resolve through the same helper the rest of the file uses:

- :602 → `const approver = assignerAuthority(parent); if (parent.requiresApproval && approver && String(approver) !== String(doer)) {`
- :612 → `user: approver,`
- :629 → `const closeNotify = assignerAuthority(parent); if (closeNotify && String(closeNotify) !== String(doer)) {` with :631 → `user: closeNotify,`

The `approver !== doer` guard is load-bearing and is why this is not a straight find-and-replace. The handover query at user.service.js:384 excludes only tasks the HEIR OWNS, so nothing stops the heir being Rohit — the very person the work was forwarded down to. Parent owner is Priya, so it still matches and gets `handedOverTo: Rohit`. Without the guard, fixing :602 would submit the parent for Rohit's approval of Rohit's own completion, and reviewTask :419 would let him approve it — re-creating defect #4 from the reverted attempt (self-approval; no self-award, since points stay frozen, but self-approval nonetheless). With the guard, that case falls through to the existing force-close, which is the correct degenerate behaviour.

Same guard shape covers the no-successor case: `assignerAuthority` returns null, the branch is skipped, and the parent auto-closes exactly as it does today — which is right, because authority deliberately passes to nobody there.

---

## 11. [MEDIUM] The Approvals page and its sidebar badge never show a successor's handed-over submissions

**Kahan:** `backend/src/services/approvals.service.js`:82 · lens: authority

**Claim:** pendingFor (82), pendingCount (192) and historyFor (162) all scope task approvals to `assignedBy: user._id` and were not widened to `handedOverTo`, unlike listTasks (task.service.js:977) and taskSummary (1191). reviewTask accepts the successor, so the permission moved but the queue built to surface it did not — and the original TASK_APPROVAL notification cannot cover the gap because it was addressed to the deleted assigner and destroyed with them (user.service.js:352).

**Scenario:** Aisha submits "Vendor quotes" for approval on 3 Aug. On 5 Aug boss B is deleted with Hari named successor; the task is PENDING with submittedAt set, so it matches the handover at user.service.js:384 and gets handedOverTo=Hari. Hari opens /approvals: the Tasks section reads 0 and lists nothing, and the sidebar dot does not count it; after he does approve it, historyFor never lists it either. The submission only surfaces if he happens to open To-Do → "Assigned by me", whose separate awaiting query (task-board.jsx:1043) does use scope=assigned. Aisha stays blocked for as long as nobody thinks to look there — the exact "sat submitted forever" outcome the commit set out to end.

**Verifier:** Maine poori chain code se verify ki, aur core claim sahi nikla — handover ne review karne ki AUTHORITY to move kar di, lekin us submission ko surface karne wale koi bhi queue/badge ko widen nahi kiya gaya.

Jo maine actually padha aur confirm kiya:

1) Filters genuinely un-widened hain. `backend/src/services/approvals.service.js:82` (pendingFor), `:162` (historyFor), `:192` (pendingCount) — teenon `assignedBy: user._id` par scoped hain. Dono commits ke `git show --stat` mein `approvals.service.js` touch hi nahi hua (na 00f7b8d mein, na 83c7500 mein). Iske ulat `task.service.js:977` (listTasks) aur `:1191` (taskSummary) dono `$or: [{ assignedBy }, { handedOverTo }]` ho chuke hain. To drift real hai.

2) Handover us exact task ko pakadta hai. `setStatus` submit par sirf `submittedAt` set karta hai, `status` `PENDING` hi rehta hai (task.service.js diff, submit branch). Handover query `user.service.js:383-386` = `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }` — Aisha ka submitted task match karta hai aur `handedOverTo = Hari` set hota hai. Uske baad `user.service.js:412` `assignedBy` ko `null` kar deta hai. Matlab task ab kisi bhi `assignedBy: Hari` filter se match nahi karega.

3) Authority sach mein Hari ke paas chali gayi. `reviewTask` (task.service.js:419) `isAssignerOf` use karta hai, jo `assignerAuthority` = `task.assignedBy || task.handedOverTo` (`:245`) padhta hai. Hari review kar SAKTA hai — bas use dikhta nahi.

4) Notification wala point bhi sahi hai. Submit par notify `user: assignerAuthority(task)` gaya tha, us waqt woh B tha. `user.service.js:352` `Notification.deleteMany({ user: uid })` use B ke saath uda deta hai, aur `deleteUser` mein heir ko koi naya notify nahi hai (maine poora 327-426 padha — ek bhi notify call nahi).

5) History bhi permanently miss karti hai. Approve karne par `task.approvedBy = actor._id` (Hari) set hota hai (`task.service.js:441`), aur historyFor ka inner `$or` `{ approvedBy: user._id }` match bhi kar leta, lekin outer `assignedBy: user._id` (`:162`) row ko pehle hi block kar deta hai. To approve karne ke baad bhi woh kabhi history mein nahi aata.

6) Ekmatr surfacing path wahi hai jo finding ne bataya — To-Do → "Assigned by me" ka alag awaiting query, `website/components/tasks/task-board.jsx:1043` → `/tasks?scope=assigned&awaiting=1`, jo widened `listTasks` par jaata hai. Verified.

Yani mechanism paper par reproduce ho gaya. Severity MEDIUM sahi hai — koi data loss ya points corruption nahi, purely "kaam surface nahi hota, aur assignee blocked baitha rehta hai" wala drift. Do details galat/adhoore the, woh `correction` mein hain — aur unmein se ek finding ko kamzor nahi, BALKI mazboot karti hai.

**Correction:** Teen corrections, jinmein pehli sabse important hai:

(a) Sidebar dot ka source galat bataya gaya hai — aur asli source finding ko aur bada banata hai. Sidebar dot `pendingCount` (approvals.service.js:192) se AATA HI NAHI. `website/lib/badges.js:19-25,74-83` dot ko `/badges` endpoint se leta hai, yani `backend/src/services/badges.service.js`. Wahan `awaitingMyApproval` = `latest(Task, { assignedBy: mine, requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }, 'submittedAt')` — `badges.service.js:46` — aur yeh bhi widen nahi hua. Ab crucial baat: yeh ek value DO dots feed karti hai — `approvals` dot (`badges.service.js:71`) AUR `todo` dot (`badges.service.js:62`). Iska matlab Hari ko To-Do par bhi koi dot nahi milta. To finding ka jo "sirf tab dikhega jab woh khud To-Do → Assigned by me kholne ki soche" wala anjaam hai, woh aur pukhta ho jaata hai: jis akele surface par submission dikhta hai, usi ko nudge karne wala dot bhi chup hai. Fix ke liye `badges.service.js:46` sabse zyada zaroori line hai, `approvals.service.js` se bhi pehle.

(b) `pendingCount` (approvals.service.js:192) aaj kisi user-visible cheez ko drive nahi karta. Uska akela caller `backend/src/controllers/approvals.controller.js:34` → route `GET /approvals/count` (`approvals.routes.js:16`) hai, aur poore `website/` mein `/approvals/count` ka koi consumer nahi mila. To woh latent API gap hai, live symptom nahi. Approvals page sirf `/approvals` (pendingFor) aur `/approvals/history` call karta hai (`website/app/(app)/approvals/page.jsx:83,112`), aur tab count `data.counts.tasks` se aata hai (`:92,179`).

(c) Approvals-page wala aadha hissa CONDITIONAL hai, unconditional nahi. `sectionsFor` (`approvals.service.js:45-53`) `tasks: allowed` ko `canUseApprovals` par gate karta hai, jo `approveLeave || approveRegularization` hai (`:36-38`); nav link bhi wahi gate rakhta hai (`website/lib/permissions.js:95`). Successor par sirf `canAssignAny(heir)` ki shart hai (`user.service.js:376`) — approval permission ki koi shart nahi. To agar Hari ke paas in dono mein se koi permission nahi, to uske liye /approvals page hi band hai aur woh "Tasks section 0 dikhata hai" wala step lagu nahi hota — us case mein sirf (a) wala badge gap aur To-Do path bachta hai. Scenario ko theek se likhne ke liye Hari ko `approveLeave` holder maanna padega.

Baaki sab jo finding ne kaha — file:line samet — verify ho gaya: user.service.js:352 (notification wipe), :384 (handover match), task.service.js:977 aur :1191 (widened), task-board.jsx:1043 (awaiting query).

**Suggested fix:** Chaar query filters ko wahi shape do jo `listTasks` (task.service.js:977) aur `taskSummary` (:1191) already use karte hain — `$or: [{ assignedBy: X }, { handedOverTo: X }]`:

1. `backend/src/services/badges.service.js:46` — sabse pehle yeh. `{ assignedBy: mine, ... }` → `{ $or: [{ assignedBy: mine }, { handedOverTo: mine }], requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }`. Isse `todo` aur `approvals` dono dots successor ke liye jag jaate hain, yani woh To-Do → "Assigned by me" tak pahunch jaata hai chahe uske paas approval permission ho ya na ho.

2. `backend/src/services/approvals.service.js:82` (pendingFor) — same widening.

3. `backend/src/services/approvals.service.js:192` (pendingCount) — same, taki endpoint pendingFor se consistent rahe.

4. `backend/src/services/approvals.service.js:161-166` (historyFor) — yahan SAAVDHAANI: is object mein pehle se ek `$or` key maujood hai (`:165` `$or: [{ approvedBy: user._id }, { rejectionReason: ... }]`). Dusra `$or` add karoge to JS object literal mein baad wali key pehli ko chup-chaap overwrite kar degi aur scope poori tarah tootega. Isliye ise `$and` mein wrap karo, e.g. `{ requiresApproval: true, updatedAt: {...}, $and: [{ $or: [{ assignedBy: user._id }, { handedOverTo: user._id }] }, { $or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }] }] }`.

Security-wise widening safe hai: `reviewTask` (task.service.js:419) already exactly isi authority ko `assignerAuthority()` ke through accept karta hai, to queue sirf wahi dikhayega jispar successor pehle se act kar sakta hai — koi nayi pahunch nahi khulti.

Optional, isi kaam ka dusra aadha: `deleteUser` mein handover ke waqt heir ko ek `TASK_APPROVAL` notification bhej do un tasks ke liye jo `requiresApproval && submittedAt != null` hain, kyunki purani wali `user.service.js:352` par delete ho chuki hoti hai. Isse woh submission bina kisi dot/queue ke bharose bhi turant uske saamne aa jaayega.

---

## 12. [MEDIUM] The assignee's screen calls a handed-over task "Personal task" and prints an empty "From:"

**Kahan:** `backend/src/services/task.service.js`:1074 · lens: authority

**Claim:** listTasks populates owner, assignedBy, collaborators, completedBy, approvedBy and originalAssignedBy — but not handedOverTo; only `populated()` (task.service.js:261) does, and the To-Do UI renders list rows, never a re-fetched detail. So `task.handedOverTo` arrives as a bare 24-char id string. task-board.jsx:293 falls back to it for the "From" line: a non-empty string is truthy, so the row enters the `From:` branch (line 340) and renders `{from.name}` = undefined. The detail sheet is worse — it has no handedOverTo branch at all, so its "Type" row (task-board.jsx:660-677) falls through tagged → assignedBy → assignerView → collaborators and lands on the literal string "Personal task" for work the server 403s every personal-task action on ("This task was assigned to you").

**Scenario:** Aisha's task from the deleted boss B is handed to Hari. Aisha opens To-Do → My tasks: the row reads "From: " with nothing after the label (before this change the label was simply absent, so the commit's stated fix — "otherwise this line goes blank and the assignee is left with a task from nobody" — is not delivered, it just gained a dangling label). She taps the row: Type reads "Personal task", there is no Edit or Delete button (canManage is correctly false via gateFrozen), and nowhere on the screen is Hari's name — so she still has no idea who to ask about it, which was the entire point of naming him.

**Verifier:** I tried to refute this three ways and could not.

1) Is `handedOverTo` populated on the list path? No. `backend/src/services/task.service.js:1074` is the only query behind `GET /tasks` and it chains `.populate('owner').populate('assignedBy').populate('collaborators').populate('completedBy').populate('approvedBy').populate('originalAssignedBy')` — `handedOverTo` is absent. Grepping the whole service, `populate('handedOverTo', 'name')` appears exactly once, at task.service.js:261 inside `populated()`, which serves `getTaskDetail` and the mutation returns, not the list. `Task.js:68` sets `toJSON {virtuals:true, versionKey:false}` with no transform and line 1074 has no `.select()`, so the unpopulated path survives as an ObjectId and `res.json` stringifies it to a 24-char hex string. The client gets `handedOverTo: "68f…"`.

2) Does the To-Do UI ever re-fetch a populated detail? No. `openTask` (task-board.jsx:1146-1149) just stores the row object it was handed (`onOpen={(x) => openTask({ task: x, … })}` at 1357/1429/1481/1524/1554/1581), and the only caller of `GET /tasks/:id` anywhere in `website/` is `website/app/(app)/rewards/page.jsx:61`. So the To-Do sheet renders the same unpopulated list row.

3) Does the row even reach `TaskRow`? Yes. `deleteUser` (user.service.js:383-386 then 412) sets `handedOverTo: heir._id` and then `assignedBy: null, pointsGateFrozen: true` on the same docs. With `assignedBy` null the task fails the `else if (t.assignedBy)` folder branch at task-board.jsx:913 and lands in `personal` (line 918), which renders through `TaskRow` (line 1516).

So at task-board.jsx:293 `from = task.assignedBy || task.handedOverTo` = the raw string. A non-empty string is truthy, the `from ?` branch at 338 wins, and `{from.name}` at 340 is `undefined` on a string primitive → React renders nothing. Before commit 83c7500 `from` was `null` and no line rendered at all (diff confirmed: the only frontend change in 83c7500 is that one line), so the commit's stated goal — "otherwise this line goes blank and the assignee is left with a task from nobody" — is not delivered; it converts "no line" into "From:" with a dangling empty value. The detail sheet has no `handedOverTo` branch (the only two frontend reads of the field in the entire `website/` tree are line 293 and the delete toast at delete-user-dialog.jsx:76), so the Type row falls through to the literal `'Personal task'` at task-board.jsx:678.

**Correction:** Three corrections, one of them material.

(a) MATERIAL — "there is no Edit or Delete button (canManage is correctly false via gateFrozen)" is wrong for the detail sheet, and the truth is worse. Two different helpers govern the two surfaces. `TaskRow`'s inline `canManage` (task-board.jsx:297) does include `&& !gateFrozen(task)`, so the row's pencil/trash icons are correctly hidden. But the sheet's buttons come from `view.allowEdit` / `view.allowDelete` (task-board.jsx:578, 583), fed by `canMgr` at task-board.jsx:990: `const canMgr = (t) => t.owner?.id === user?.id && !t.assignedBy;` — no `gateFrozen`, no `handedOverTo`. For Aisha's handed-over task `owner.id === myId` and `assignedBy` is null, so `canMgr` is TRUE and the sheet shows both Edit and Delete. Saving the edit hits `PATCH /tasks/:id` and dies at task.service.js:672-673 (`wasDelegated(task)` is true via `gateFrozen`, `isAssignerOf` resolves to Hari, not Aisha) with 403 `ASSIGNED_TASK` "This task was assigned to you — only the person who assigned it can edit it"; Delete dies the same way at task.service.js:899-900. This is drift introduced by 83c7500 itself: the server side newly routes edit/delete through `wasDelegated()`/`isAssignerOf()`, and `canMgr` was not updated to match (the commit touched only line 293 of this file). So Aisha gets a nameless "From:", a "Personal task" label, AND two buttons that 403.

(b) The Type-row line range is 657-680, not 660-677; the `'Personal task'` literal is at line 678.

(c) "Personal task" is the no-collaborator case only. `iOwn` (task-board.jsx:553) is `owner.id === myId && !task.assignedBy`, which is TRUE for the handed-over assignee, so `sharedWith` (line 558) is non-empty when the task has collaborators and the Type row reads `'Shared task'` (line 676) instead. Both labels are wrong; which one you get depends on whether anyone was tagged.

Everything else in the finding — the unpopulated projection, the truthy-string fallback, the empty `From:`, the absence of Hari's name anywhere on the assignee's screen (no notification is sent either; `deleteUser`, user.service.js:327-426, has no `notify` call) — reproduces exactly as written.

**Suggested fix:** Three small edits, all mechanical.

1. Populate the field on the list path. `backend/src/services/task.service.js:1074` — add `.populate('handedOverTo', 'name')` to the chain, so the row carries `{id, name}` instead of a bare id. (Cheap: it is one extra ref, same as the five already there.)

2. Make the row defensive and honest. `website/components/tasks/task-board.jsx:293` — require an object so a stale/unpopulated payload can never produce a dangling label:
   `const handover = task.handedOverTo?.name ? task.handedOverTo : null;`
   `const from = assignerView ? null : tagged ? task.owner : task.assignedBy || handover || null;`
   and label the handover case differently at 338-341, because "From: Hari" is a lie — Hari never assigned it. Render `Now with: <name>` (or "From: (removed) · now with Hari") when `!task.assignedBy && handover`.

3. Close the two sheet gaps. In `TaskDetailDialog`, add a Type branch before the `sharedWith`/`'Personal task'` fallback (after line 674) for `task.handedOverTo?.name` → "Assigner removed — now with {name}", so gate-frozen work never reads as personal; and fix `canMgr` at task-board.jsx:990 to match `TaskRow`'s `canManage` and the server: `const canMgr = (t) => t.owner?.id === user?.id && !t.assignedBy && !gateFrozen(t);` (`gateFrozen` is already imported at line 31), which removes the Edit/Delete buttons that currently 403.

---

## 13. [RED] Freeze is per-document, so a forwarded CHILD still re-derives the gate and the daily prune hard-deletes the doer's points

**Kahan:** `backend/src/services/bonus.service.js`:1710 · lens: chains

**Claim:** `pointsGateFrozen` is only written onto the document whose own `assignedBy` (or collaborator tag) matched the deleted user — user.service.js:399-404 and :412. Eligibility, however, is a CHAIN property: chainEligible() (bonus.service.js:568-584) walks `forwardedFrom` upward and asks taskEligible() of each ancestor, and taskEligible() (:556-561) reads only `assignedBy`/`collaborators` — it never calls gateFrozen(), and the ancestor projection at :576 does not even select the gate fields. So a forwarded copy, whose eligibility came entirely from the owner-tier person on its ROOT, is left unfrozen: prune's `gateFrozen(t) ? true : await chainEligible(...)` at :1710 takes the chainEligible branch for it, gets false, and line 1717 pushes every one of its entries into `dead` for deletion at :1728. This is exactly the B1 failure that 00f7b8d set out to fix, surviving intact one link down any forward chain.

**Scenario:** 1 Aug: CEO Aamir (owner tier) assigns "GST filing", due 8 Aug, to manager Priyanshi -> root R (owner=Priyanshi, assignedBy=Aamir). 2 Aug: Priyanshi forwards it to Rahul -> child C1 (owner=Rahul, assignedBy=Priyanshi, forwardedFrom=R, dueYMD 8 Aug). 7 Aug: Rahul finishes; settleParent closes R and onAssignedTaskDone(R) pays the chain — Priyanshi +3 (forwardOnTime, taskRef R), Rahul +assignedTaskOnTime (auto_task, taskRef C1). 10 Aug: Aamir's account is deleted. user.service.js:412 sets R.assignedBy=null and R.pointsGateFrozen=true; C1 matches NEITHER updateMany (its assignedBy is Priyanshi, and Aamir was never tagged on it), so it stays unfrozen. That night maybeRunDaily -> pruneOrphanTaskEntries: R's +3 survives because gateFrozen(R) is true, but for C1 the code re-derives — taskEligible(C1) is false (Priyanshi is not owner tier, no tags), the walk reaches R whose assignedBy is now null and whose collaborators are empty, so chainEligible returns false and Rahul's entire award is hard-deleted. Rahul silently loses every point he earned for the job, with nothing to restore it. The same happens through the collaborator door: if Aamir was merely TAGGED on R, :399-404 freezes R but the $pull at :415 strips the tag, and C1 again re-derives to false. If the chain was late instead of on time, the deletion runs the other way and REFUNDS the -5 mark plus every -1 drip day to the assignee, in months that are already closed.

**Verifier:** I tried to refute this three ways (does the child ever hold its own entries? is the child re-frozen anywhere? does anything restore the entries afterwards?) and it survived all three.

PROOF, step by step, all read:

1. The child really is a separate points-bearing document. task.service.js:551-561 creates the forwarded copy with `assignedBy: actor._id` (the forwarder, NOT the root's assigner), `forwardedFrom: parent._id`, and NO collaborators (Task.js:32 default []). onAssignedTaskDone(root) at bonus.service.js:646/660-694 pays each copy under its OWN `taskRef: copy._id` — the root becomes a forwarder (`auto_forward`), the leaf a doer (`auto_task`). So the doer's entry hangs off C1, never off R.

2. Nothing ever freezes the child. `pointsGateFrozen` is written in exactly two places, both in user.service.js: :400-403 (`collaborators: uid, assignedBy: {$ne:null}`) and :412 (`assignedBy: uid`). A grep of backend/src for pointsGateFrozen/assignerDeleted returns no other writer. Neither predicate matches C1 (its assignedBy is the forwarder; the deleted owner was never tagged on it). No descendant walk exists at deletion time.

3. The gate is re-derived for the child and answers "no". pruneOrphanTaskEntries pulls C1 into `tasks` via the `assignedBy: {$ne: null}` arm (:1692), then :1710 runs `gateFrozen(t) ? true : await chainEligible(...)` — gateFrozen(C1) is false, so chainEligible runs. taskEligible(C1) (:556-561) reads only assignedBy/collaborators → false. The walk (:571-582) loads the parent with `.select('assignedBy collaborators forwardedFrom')` (:576) — the gate fields are not even projected, so even a hand-written check there would read undefined. R.assignedBy is now null and its collaborators are empty, so taskEligible(R) is false, R.forwardedFrom is null, loop ends, returns false. :1717 pushes every C1 entry into `dead`, :1728 hard-deletes them.

4. The loss is permanent. In the assigner-deleted arm, R.assignedBy is null, so rescoreAllDoneAssigned's query (:1627) excludes R and onAssignedTaskDone bails at :620 (`!task.assignedBy`). Nothing rewrites the child's entry, ever.

Concrete numbers (assigner arm): owner tier = {Aamir CEO, Bilal President}. Aamir assigns "GST filing", due 8 Aug, to Priyanshi → R. Priyanshi forwards to Rahul → C1. Chain closes 7 Aug on time: Priyanshi +3 (forwardOnTime, seeded at 3 in bonus.service.js:1582, taskRef R), Rahul +5 (assignedTaskOnTime, taskRef C1). 10 Aug Aamir is deleted: user.service.js:412 sets R.assignedBy=null + pointsGateFrozen=true; C1 untouched. Next daily tick (maybeRunDaily :1774) → prune: Priyanshi's +3 is kept (gateFrozen(R)), Rahul's +5 is deleted. Rahul's August total drops by 5 for work he actually delivered, with no path back.

The claim that this is B1 surviving one link down is exactly right: 00f7b8d froze the document the deleted user touched, but eligibility is a chain property, and the freeze was not made one.

**Correction:** Four corrections, one of which makes it worse:

(a) PRECONDITION the finding omits: at least one owner-tier user must SURVIVE the deletion. ownerTierIds() (:528-535) rebuilds from User.find({role: {$in: ownerRoleKeys()}}), and taskEligible short-circuits `if (!ownerIds.size) return true` (:558). So if the deleted CEO was the only owner-tier user, the gate opens for everything and nothing is pruned. The scenario as written ("CEO Aamir deleted") only bites when a second owner-tier user (President) remains — which is also the only shape in which B1 itself was ever real. Use "President Bilal is deleted, CEO Aamir remains" to make it airtight.

(b) SCOPE is wider than "one link down": every descendant loses its entries, not just the leaf. On R → C1 → C2, both C1's auto_forward and C2's auto_task go; only the root's entry survives.

(c) The collaborator variant is WORSE than described — there the root's entries do NOT survive either. When the deleted owner was merely tagged, R keeps its (non-owner) assignedBy, so R still matches rescoreAllDoneAssigned's query at :1627 (`status DONE, assignedBy != null, completedAt >= now-45d, forwardedFrom: null`), which runs at :1779 and calls onAssignedTaskDone(R). That function never consults gateFrozen anywhere — :633 asks only `copies.some(c => taskEligible(c, ownerIds))`, and with the tag $pull'd at user.service.js:415 every copy fails — so :634 hard-deletes auto_task AND auto_forward entries for the WHOLE chain, root included. For any chain completed in the last 45 days, B1's headline fix is defeated on the very document it froze. Also note the wipe there comes from the re-score, not the prune, so "the daily prune hard-deletes" is only half the story.

(d) The refund direction checks out, with a mechanism detail worth stating: the drips/mark do live on the leaf, because scanOverdueTasks (:1031) selects PENDING assigned tasks and excludes only forwarded PARENTS, so the leaf accrues them under taskRef C1; and in the prune the eligibility test at :1717 runs BEFORE the "negatives survive on a PENDING task" rule at :1725, so a -5 mark plus N × -1 drips filed in July/August are deleted outright — an unearned refund into closed months.

**Suggested fix:** Make the freeze a CHAIN property, on both the read side and the write side. Read side is the one that must land:

1. bonus.service.js:568-584 — chainEligible: `if (gateFrozen(task)) return true;` first, and inside the walk change the projection at :576 to `.select(\`assignedBy collaborators forwardedFrom ${GATE_FIELDS}\`)` and `if (gateFrozen(parent) || taskEligible(parent, ownerIds)) return true;`. Without the projection change gateFrozen reads undefined → false, silently.

2. bonus.service.js:633 — onAssignedTaskDone must not wipe a frozen chain: `if (!copies.some((c) => gateFrozen(c) || taskEligible(c, ownerIds)))`. This needs GATE_FIELDS added to collectChainCopies' projection (:592) and to every projection that feeds it a root: :1628 (rescoreAllDoneAssigned), :1657 (rescoreAssignedTasks), :1429 (month rollup). Same for :1031 (scanOverdueTasks) and :726 (rebuildOverdueForTask), both of which call chainEligible on documents whose gate fields aren't selected today.

3. Write side, so existing rows heal: in user.service.js, after the two freezes at :400-403 and :412, walk the forward tree of every task just frozen and set the flag on the descendants too — bounded exactly like collectChainCopies (depth 12), e.g. collect the frozen ids, then loop `Task.updateMany({ forwardedFrom: { $in: frontier } }, { $set: { pointsGateFrozen: true } })` and re-read the frontier, capped at 12 levels. Do it inside the same pre-detach block, and for the collaborator arm BEFORE the $pull at :415.

Step 3 alone is not enough (rows already written by past deletions stay broken, and any freeze that lands mid-chain still needs the readers to honour it), and step 1 alone is not enough (onAssignedTaskDone at :633-634 is a second, independent wiper). Ship 1+2, then 3 as the data repair. A regression test must cover both arms — owner-tier ASSIGNER deleted and owner-tier COLLABORATOR deleted — on a 3-deep chain, asserting the leaf's award and the middle forwarder's award both survive a maybeRunDaily pass, not just pruneOrphanTaskEntries in isolation (running only the prune is what let this through the 17-assertion suite).

---

## 14. [RED] `handedOverTo` is never cleared when the successor is deleted, leaving an approval-gated task nobody can ever close

**Kahan:** `backend/src/services/user.service.js`:407 · lens: chains

**Claim:** The detach block at :407-422 clears `assignedBy`, `decidedBy`, `excusedBy`, `reportsTo`, `createdBy` and `taskAssign.users`, but nothing clears `handedOverTo`. The handover query at :383-386 only matches `assignedBy: uid`, so a task already handed to the departing user (assignedBy null) is never re-handed over, and exitSummary at :292 counts only `assignedBy: userId`, so delete-user-dialog.jsx renders the successor Select only when `delegated > 0` and never even asks the question. After the second deletion assignerAuthority() (task.service.js:244-246) still returns the dead id, which is truthy, so every authority check points at an account that no longer exists.

**Scenario:** Manager Meera assigns "Q2 audit pack" with requiresApproval=true to Anil. Meera is deleted, Harsh is named successor -> task.assignedBy=null, pointsGateFrozen=true, handedOverTo=Harsh. Months later Harsh leaves and is deleted; his delete dialog reports "Work they delegated, still open: 0" (exitSummary sees no assignedBy=Harsh row) so no successor is asked for, and handedOverTo stays pointed at Harsh's deleted id. Anil now taps Done: setStatus (task.service.js:344) sees requiresApproval && assignerAuthority(task) truthy && isOwner, stamps submittedAt and fires a TASK_APPROVAL notification at a user id that no longer exists. reviewTask (:419) can only be passed by an actor whose _id equals Harsh's, so no living person can approve or reject it. updateTask (:672) and deleteTask (:899) both see wasDelegated true and isAssignerOf false for everyone — including leadership, which has no permission bypass on either path — so the row cannot be edited or removed either. The task is permanently stuck awaiting an approval that can never be given, and it appears in no one's approvals queue; the only remedy is direct DB surgery. This is precisely the "sat submitted forever" state the commit message claims to have closed.

**Verifier:** The mechanism reproduces exactly as described, and I could not find any code path that breaks it.

VERIFIED LINK BY LINK:
1. `handedOverTo` is written in exactly one place — `backend/src/services/user.service.js:385` (`$set: { handedOverTo: heir._id }`). A whole-repo grep for `handedOverTo` returns that write, the model field (`backend/src/models/Task.js:28`), the controller audit meta (`users.controller.js:149`), the toast (`delete-user-dialog.jsx:76`), and five READ sites in `task.service.js` (245, 261, 280, 687, 977, 1191). There is no clearing write anywhere — not in the detach block, not in a cron, not in `bonus.service.js`.
2. The detach block `user.service.js:407-422` clears `assignedBy`, `collaborators`, `decidedBy` (x2), `excusedBy`, `reportsTo`, `createdBy`, `taskAssign.users`. `handedOverTo` is absent. Confirmed.
3. The handover query `user.service.js:383-384` matches `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }` — a task where the departing user is the *handedOverTo* (and `assignedBy` is already null) is never re-homed. Confirmed.
4. `exitSummary` `user.service.js:292` counts `{ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } }` only, and `delete-user-dialog.jsx:155` gates the whole successor block on `delegated > 0`, so the question is never asked on the second deletion. Confirmed.
5. `assignerAuthority()` `task.service.js:244-246` returns `task.assignedBy || task.handedOverTo || null` — a dangling ObjectId is truthy. Confirmed.
6. `setStatus` `task.service.js:306`: `sharedPersonal = !task.assignedBy && !gateFrozen(task)` = `true && false` = false, and `isOwner` is true, so the guard at :307 passes. Line 344 `wantDone && requiresApproval && assignerAuthority(task) && isOwner && status !== 'DONE'` is all true → `submittedAt` stamped, `notify()` fired at the dead id. `notify` (`models/Notification.js:34-44`) does no existence check on `user`, so it silently writes an orphan row. Confirmed.
7. `reviewTask` `task.service.js:419` demands `isAssignerOf(task, actor)`, i.e. `String(actor._id) === String(handedOverTo)`. The heir is deleted, so no living actor matches. `middleware/auth.js:35` rejects any session whose user is missing or inactive, so there is no way to authenticate as them. Confirmed.
8. `updateTask` `task.service.js:672` and `deleteTask` `task.service.js:899` both take the `wasDelegated(task)` branch (`gateFrozen()` true from `user.service.js:412`) and fail `isAssignerOf` for everyone. Neither controller (`tasks.controller.js:146-163`) nor either service has a `can(actor, …)` bypass. Confirmed.
9. Nobody sees it in an approvals queue: `listTasks` scope `assigned` (`task.service.js:977`) and the counts aggregate (`task.service.js:1191`) both match `$or: [{ assignedBy: actor._id }, { handedOverTo: actor._id }]` — the dead id matches no living actor.

DECISIVE POINT: this is a genuine regression of 83c7500, not a pre-existing condition. With NO successor named, the same task has `assignedBy: null, handedOverTo: null`, so `assignerAuthority()` returns null, line 344 is skipped entirely, and the assignee closes the task normally — the documented, safe outcome the dialog warns about at `delete-user-dialog.jsx:174-184`. Only a DANGLING `handedOverTo` makes the approval gate fire with nobody behind it. Naming a successor is strictly worse than naming nobody, once that successor leaves.

No points are corrupted, so the "wrong points" limb of RED does not apply — but the row becomes permanently un-closable, un-editable and un-deletable by every living user including leadership, with no in-app remedy at all. RED stands on unrecoverable-state grounds.

**Correction:** Four corrections, none of which touch the core:

1. "Permanently stuck awaiting an approval" overstates it slightly. Anil CAN withdraw: `setStatus(PENDING)` on a submitted task hits the withdraw branch at `task.service.js:366-372` and clears `submittedAt`. So it does not sit frozen in the submitted state — but every subsequent tap on Done re-enters :344 and re-submits. The accurate claim is that the task can NEVER reach DONE, and toggles forever between PENDING and submitted. That is the same dead end, just described correctly.

2. The window opens at DEACTIVATION, not deletion — which makes it strictly worse than the finding claims. `deleteUser` refuses unless the target is already inactive (`user.service.js:339-341`), and `middleware/auth.js:35` rejects any inactive user's session. So the moment Harsh is deactivated — the mandatory prior step, and by itself a far more common event than deletion — no living actor can pass `isAssignerOf`, and the task is already stuck. Deactivating a successor and never deleting them produces the identical stuck task with no deletion event to hang a fix on. Any fix must therefore consider deactivation too, not only the detach block.

3. No points bleed. `scanOverdueTasks` (`bonus.service.js:1031`) queries `{ assignedBy: { $ne: null }, status: 'PENDING', … }`, and the stuck task has `assignedBy: null`, so it accrues no further `assignedTaskLate` mark and no daily drip while it sits open forever. The damage is purely the unclosable task; do not claim point drift.

4. The "leadership cannot edit or delete it either" observation is TRUE but is NOT new to the handover — the identical 403 pair fires when no successor is named (`assignedBy: null` + `pointsGateFrozen: true` → `wasDelegated` true, `isAssignerOf` false for all), and that is the accepted, warned-about behaviour. Attributing it to this commit would misdirect the fix. Only the approval dead-end is the regression.

Additional supporting detail the finding did not mention: `populated()` at `task.service.js:261` populates `handedOverTo`, and a deleted ref populates to null, so `task-board.jsx:293` (`task.assignedBy || task.handedOverTo || null`) renders no "from" at all, while `canCompleteTask` (`task-board.jsx:82`, true because Anil owns it) keeps rendering the Done button. The UI therefore shows a clean-looking task and keeps offering the exact control that traps it.

**Suggested fix:** Minimal correct fix — add one line to the detach block in `backend/src/services/user.service.js:407-422`, alongside the existing `assignedBy` clear:

  Task.updateMany({ handedOverTo: uid }, { $set: { handedOverTo: null } }),

That alone restores the safe, already-designed no-successor state: `assignerAuthority()` goes back to null, `setStatus:344` stops firing, and the assignee can close the task exactly as they can when nobody was ever named. It cannot regress the points side — `bonus.service` never reads `handedOverTo`, and `pointsGateFrozen` is untouched.

Completeness half (should ship with it, or the responsibility just evaporates silently instead of jamming):
- Widen the handover query at `user.service.js:383-384` to `{ $or: [{ assignedBy: uid }, { handedOverTo: uid }], status: 'PENDING', owner: { $nin: [uid, heir._id] } }` so a chained handover moves to the new successor instead of being dropped. Note ordering: this `updateMany` already runs BEFORE the detach block, so the `$or` still sees the live links.
- Widen `exitSummary` at `user.service.js:292` to the same `$or`, so `openTasksDelegated` counts inherited work and `delete-user-dialog.jsx:155` actually renders the successor picker for the second departure.

Because deactivation alone is enough to jam the task (point 2 above), also consider making `isAssignerOf` treat an unresolvable authority as "nobody" rather than "somebody unreachable" — e.g. have `setStatus` fall through to the normal close when the authority id resolves to no active user. That is the belt-and-braces version; the one-line clear plus the two `$or` widenings is the smallest fix that closes the proven scenario.

Existing rows already in this state need a one-off cleanup: `db.tasks.updateMany({ handedOverTo: { $nin: <live user ids> } }, { $set: { handedOverTo: null } })`.

---

## 15. [MEDIUM] After a reassignment the batch is re-fetched on `assignedBy` only, so the successor's edits silently miss every retained copy

**Kahan:** `backend/src/services/task.service.js`:762 · lens: chains

**Claim:** The entry query was widened for the successor (`$or: [{assignedBy: actor._id}, {handedOverTo: actor._id}]` at :686-688), but the re-fetch that closes the reassignment branch was not: `members = await Task.find({ assignBatch: batch, assignedBy: actor._id })`. Handed-over copies have assignedBy null, so they drop out of `members`. Since `applyAll` is true whenever data.assignTo is present (:795), `editSet` is that truncated list — the retained assignees get no content edit, no tag sync (:769-779), no notification, and `batchCount`/`changedCount` in the response are wrong.

**Scenario:** Manager Meera multi-assigns "Stock count" to Anil, Bhavna and Chirag (assignBatch X, due 20 Aug). Meera is deleted, Harsh named successor -> all three copies get handedOverTo=Harsh, assignedBy=null. Harsh calls PATCH /tasks/<id> with { dueYMD: '2026-08-30', assignTo: [Anil, Bhavna] } — i.e. drop Chirag and move the deadline. The entry query correctly loads all three; Chirag's copy is deleted and his forward chain cascaded; Anil's and Bhavna's are retained. Then :762 re-fetches `{assignBatch: X, assignedBy: Harsh}` — nobody was added, so `members` comes back EMPTY. editSet is empty: the new 30 Aug deadline is written to nobody, no "task updated" notice is sent, and the response reports batchCount 0 / changedCount 0 while the removal it performed is permanent. Harsh sees the reassignment succeed and reasonably believes the deadline moved; Anil and Bhavna are still being judged against 20 Aug. If Harsh had instead added Dinesh, only Dinesh's brand-new copy would carry the 30 Aug date and the tag list, with Anil and Bhavna left on the old content.

**Verifier:** The mechanism is real and I reproduced it on paper from the code.

Handover state (backend/src/services/user.service.js:383-386 then :412): open delegated copies end up assignedBy=null, handedOverTo=heir, pointsGateFrozen=true, assignBatch unchanged.

Successor is admitted to updateTask: task.service.js:672-673 wasDelegated() is true via gateFrozen(), and :678 isAssigner is true because assignerAuthority() (:244-246) falls back to handedOverTo. The batch ENTRY query at :687 was correctly widened to $or:[{assignedBy: actor._id},{handedOverTo: actor._id}], so all copies load.

The re-fetch that closes the reassignment branch was NOT widened. task.service.js:762 is exactly `members = await Task.find({ assignBatch: batch, assignedBy: actor._id });`. Retained handed-over copies have assignedBy null, so they cannot match; only copies created at :759 (which carry assignedBy: actor._id) survive.

Consequences, all from code I read: :794 sets applyAll = !!data.applyToAll || data.assignTo !== undefined -> true whenever assignTo is present, so :795 editSet = members = the truncated (often empty) list. The retained assignees get no content edit, the tag loop at :769-779 iterates zero copies, no "task updated" notification is sent (:840), and the response at :882 reports batchCount 0 / changedCount 0. Meanwhile the removals performed in the :713-746 loop (deleteOne on the dropped member plus the cascade over collectForwardDescendants) are already permanent.

Scenario as verified: batch X with Anil/Bhavna/Chirag due 20 Aug, Meera deleted, Harsh named heir. PATCH /tasks/<AnilCopy> { dueYMD: '2026-08-30', assignTo: [Anil, Bhavna] }. :687 loads 3 copies; Chirag's copy and its open forward descendants are deleted; addedUsers is empty so nothing is created; :762 returns []; editSet is empty; 30 Aug is written to nobody; response is 200 with the old 20 Aug dueYMD and batchCount 0. Anil and Bhavna remain judged against 20 Aug.

The Mongo projection angle is clean here (Task.find with no .select(), so gateFrozen() reads a real field), and the entry query is fine. The single missed predicate at :762 is the whole defect.

**Correction:** Two corrections to the finding, one narrowing and one widening.

1) NARROWING - not reachable through the shipped UI, so it is an authenticated-API-only defect today, not something a successor trips in the browser. website/components/tasks/task-dialog.jsx:32-33 computes assignerId = task?.assignedBy?.id || task?.assignedBy || null and isAssignedByMe from that alone; for a handed-over task assignedBy is null, so isAssignedByMe is false. :83 reassigned = isAssignedByMe && (...) is therefore always false, and :93 only sets body.assignTo `if (reassigned)`. Harsh is shown the personal-task dialog with no assignee picker at all. So the scenario line "Harsh sees the reassignment succeed and reasonably believes the deadline moved" is wrong for the current web client; it requires a direct API call (updateTaskSchema at backend/src/validators/tasks.validators.js:25 accepts assignTo, and the heir passes the :673 authority check, so the endpoint is open to him). The intent to support this path is unambiguous from the :687 widening, so it is a genuine incompleteness rather than a non-issue - but it is latent, which is why MEDIUM rather than RED. (The UI gap itself - successor gets no assignee picker and never sends requiresApproval either - is a separate drift finding, not this one.)

2) WIDENING - the bug is not confined to multi-assign batches. With a single assignee createTask sets assignBatch = '' (task.service.js:167), so batchQuery collapses to {_id: task._id}, then :711 batch = task.assignBatch || randomUUID() mints a fresh id and :715 stamps the retained copy with it while leaving assignedBy null. The :762 refetch on that new batch id therefore also returns only genuinely new copies. Harsh adding Dinesh to Anil's single handed-over task gives Dinesh the new dueYMD and tag list and leaves Anil on the old content - identical silent drop, no batch needed.

3) Minor addition: when data.collaborators is present and members is empty, :781-788 still sends "tagged you on a task" notifications for a tag list that was written to zero documents. taggedLink degrades safely (task.service.js:37 returns '/todo?tab=tagged' for a falsy id), so no crash, just a notification about a tag that does not exist.

**Suggested fix:** Mirror the entry predicate in the re-fetch. backend/src/services/task.service.js:762:

  members = await Task.find({ assignBatch: batch, $or: [{ assignedBy: actor._id }, { handedOverTo: actor._id }] });

That is sufficient and safe: retained copies still carry handedOverTo = actor, and copies created at :759 carry assignedBy = actor, so both sets come back. It also repairs batchCount/changedCount and the tag sync for the same call.

Do NOT widen the two assignedBy guards the fix now routes handed-over copies through:
- :825 `if (dueChanged && mm.assignedBy)` must stay as-is. Skipping onAssignedTaskDone / onAssignedTaskUndone / rebuildOverdueForTask for a frozen copy is exactly the frozen-points contract (no new awards, no new penalties, nothing deleted). Widening it would re-import the reverted attempt's failure mode by letting a successor's due-date edit re-price points on a frozen task.
- :856 `if (dueChanged && d.assignedBy)` in the forward-descendant cascade, same reasoning.

One adjacent issue the fix exposes, worth a separate decision rather than folding in blindly: :807 `if (contentChanged && mm.assignedBy && mm.seenAt) mm.seenAt = null;` will now be reached with mm.assignedBy null, so a handed-over copy keeps a stale "Seen" receipt after the successor rewrites its wording. Clearing seenAt has no points side effect (it only drives the read receipt), so changing that guard to `contentChanged && wasDelegated(mm) && mm.seenAt` is likely correct - but it is a behaviour change beyond this finding.

Regression test to add against the isolated DB: multi-assign to 3, hand over to a heir, heir PATCHes with a new dueYMD and assignTo dropping one person; assert the two retained copies carry the new dueYMD, batchCount is 2, and no BonusEntry rows changed for any of the three.

---

## 16. [MEDIUM] Approvals queue and its sidebar badge still filter on `assignedBy`, so a successor's submissions never reach the page built for approving

**Kahan:** `backend/src/services/approvals.service.js`:82 · lens: chains

**Claim:** pendingFor (:82), pendingCount (:192) and historyFor (:162) all query `assignedBy: user._id` with no `handedOverTo` arm, even though reviewTask (task.service.js:419) now accepts the successor and setStatus (:352) routes the TASK_APPROVAL notification to them. The queue that exists to hold pending decisions never shows them, and the count that drives the sidebar dot never includes them.

**Scenario:** Meera assigns "Vendor KYC" with requiresApproval=true to Anil; Meera is deleted, Harsh named successor. Anil submits: setStatus:344-361 stamps submittedAt and sends Harsh one TASK_APPROVAL bell notification. Harsh opens Approvals — sections.tasks is allowed, but the query `{assignedBy: Harsh, requiresApproval: true, submittedAt: {$ne: null}}` returns nothing, so the page reads "nothing to decide" and counts.tasks is 0, as is the sidebar dot from pendingCount:192. The only trace is the single bell entry; once that scrolls away, Anil's submission is invisible on every screen designed to surface it and he stays blocked, while the overdue drip keeps charging him -1 a day (scanOverdueTasks counts an approval-gated task as unfinished until APPROVED, bonus.service.js:1026-1029). The successor's one working route is To-Do -> Assigned by me with the awaiting filter, which they have no reason to go looking for.

**Verifier:** The core mechanism is real and I reproduced it on paper against the code.

Server accepts the successor, the queue does not:
- `deleteUser` sets `handedOverTo: heir` on still-open delegated tasks (backend/src/services/user.service.js:383-386) and then nulls `assignedBy` + sets `pointsGateFrozen: true` on every task the deleted user assigned (user.service.js:412). So a handed-over task ends as `assignedBy: null, handedOverTo: Harsh, pointsGateFrozen: true`.
- `setStatus` (task.service.js:344-361) uses `assignerAuthority(task)` = `assignedBy || handedOverTo` (task.service.js:244-246), so Anil's "done" stamps `submittedAt` and fires exactly one `TASK_APPROVAL` notification at Harsh.
- `reviewTask` (task.service.js:419) gates on `isAssignerOf`, which also resolves through `handedOverTo` — Harsh really is the approver.
- All three approvals queries test `assignedBy` alone with no `handedOverTo` arm: pendingFor (approvals.service.js:82), historyFor (approvals.service.js:161-166), pendingCount (approvals.service.js:192). With `assignedBy: null` none of them match, so `counts.tasks` is 0 and the tasks tab renders the EmptyState at website/app/(app)/approvals/page.jsx:206-217 whose copy reads "None of yours is waiting" — an explicit false statement. After Harsh eventually approves it from To-Do, historyFor misses the row too, so the decision never appears in history either.

The successor's working route is exactly as described: `listTasks` scope `assigned` does carry the `handedOverTo` arm (task.service.js:977) and the `awaiting` filter (task.service.js:1014-1015) matches, so To-Do → "Assigned by me" → awaiting works. The stats aggregate (task.service.js:1191) also carries the arm.

Two claims in the write-up are wrong and are corrected below (badge source misattributed; the "-1 a day" harm does not happen). Severity MEDIUM holds — this is UI/queue drift and a silent badge, not data loss or wrong points.

**Correction:** 1) SIDEBAR DOT — right conclusion, wrong file. `/approvals/count` (pendingCount, approvals.service.js:186-196) is not consumed anywhere in website/ — grep finds it only in audits/04-leaves.md and audits/00-features.md as a "already exists" endpoint. The real sidebar dots come from `/badges` (website/lib/badges.js:19-25, 76-77) → backend/src/services/badges.service.js. And that file has the SAME gap: `awaitingMyApproval` at badges.service.js:46 filters `{ assignedBy: mine, requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }`. It feeds BOTH `todo` (badges.service.js:62) and `approvals` (badges.service.js:69-72), so a handed-over submission lights NO dot at all — not on Approvals, not even on To-Do, which is the page the design explicitly points people to (see the comment at badges.service.js:66-68). That makes the finding slightly worse than stated, but the citation must be badges.service.js:46, not approvals.service.js:192.

2) THE POINTS HARM IS FALSE — the overdue drip does NOT keep charging Anil. `scanOverdueTasks` queries `Task.find({ assignedBy: { $ne: null }, status: 'PENDING', ... })` (bonus.service.js:1031); after the handover `assignedBy` is null, so the task is out of the scan entirely — no new -5 mark, no new -1/day drip. Same for the award hook (`if (!b.enabled || !task.assignedBy) return`, bonus.service.js:620) and bonus.service.js:726-727. Entries accrued BEFORE the deletion survive (pruneOrphanTaskEntries keeps negative entries on a still-PENDING frozen task, bonus.service.js:1690-1726), but the ledger is frozen exactly as the design intends. Drop the "-1 a day while he stays blocked" escalation; the harm is purely "the submission is invisible on the screen built to surface it, and no dot anywhere".

3) SCOPE IS NARROWER THAN IMPLIED for the Approvals page half. `sections.tasks = canUseApprovals(user)` = `approveLeave || approveRegularization` (approvals.service.js:36-52), but `deleteUser` only requires the heir to pass `canAssignAny(heir)` (user.service.js:376) — nothing about approval permissions. So the Approvals-page half only bites a successor who happens to hold one of those two permissions; for every other successor the page is correctly hidden. The badges.service.js:46 half, by contrast, bites EVERY successor.

**Suggested fix:** Give the three approvals queries and the badge query the same assigner-authority arm task.service already uses (`$or: [{ assignedBy: X }, { handedOverTo: X }]`, cf. task.service.js:977, :1191):

- approvals.service.js:82 and :192 — swap `assignedBy: user._id` for `$or: [{ assignedBy: user._id }, { handedOverTo: user._id }]`.
- badges.service.js:46 — same swap, so both the To-Do and Approvals dots fire for a handed-over submission.
- approvals.service.js:161-166 — CAREFUL: that query already has a top-level `$or` (approvedBy / rejectionReason). A second `$or` key would silently overwrite it. Nest instead: `$and: [{ $or: [{ assignedBy: user._id }, { handedOverTo: user._id }] }, { $or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }] }]`.

Better: export the arm once (e.g. `assignerArm(userId)` next to `assignerAuthority` in task.service.js, or in lib/pointsGate.js's neighbourhood) so the four call sites and the two in task.service can never drift again. Also update the tasks-tab EmptyState copy at website/app/(app)/approvals/page.jsx:212, which says "a task you handed out" and is now also true of work handed over to you.

---

## 17. [RED] Assignee reopening a frozen DONE task permanently destroys their own points — and the UI drops the warning that would have stopped them

**Kahan:** `backend/src/services/bonus.service.js`:698 · lens: ui-and-B

**Claim:** `onAssignedTaskUndone()` (bonus.service.js:698-703) deletes every `auto_task`/`auto_forward` PointEntry for the task unconditionally — it never consults `gateFrozen()`. Its repair arm `rebuildOverdueForTask()` then bails at line 727 (`if (!t || !t.assignedBy || ...) return;`) because a frozen task has `assignedBy: null`, and re-completing cannot re-award either, because `onAssignedTaskDone()` returns at line 620 on the same test. So on a frozen task the reopen path is delete-only, with no route back. Commit B closed exactly this hole for the COLLABORATOR arm (task.service.js:306 `sharedPersonal = !task.assignedBy && !gateFrozen(task)`) and left the OWNER arm wide open — the owner passes the `isOwner` guard at task.service.js:307 without touching `sharedPersonal` at all. The frontend then removes the only safety net: `handleToggle` (website/components/tasks/task-board.jsx:1084) shows the 'points will be removed' ConfirmDialog only when `t?.assignedBy` is truthy, which is null on a frozen task, so the destructive reopen fires on a single tap with no prompt — strictly less protection than an ordinary delegated task gets.

**Scenario:** Manager M delegates 'Site survey' to employee A, due 05 Aug, CEO C tagged so it passes the owner-tier gate. A completes it on time on 05 Aug → PointEntry auto_task:<task> = +10 to A for month 2026-08. On 10 Aug leadership deletes M's account: user.service.js:412 sets `assignedBy: null, pointsGateFrozen: true`. On 11 Aug A opens the History tab (task-board.jsx:1572-1583 renders each row with `canToggle` and `onToggle={handleToggle}`), and `canCompleteTask` returns true because A owns it. A taps the green circle — intending to fix a typo, or by mistake. No confirmation appears (1084 short-circuits on the null `assignedBy`). setStatus flips it to PENDING → onAssignedTaskUndone deletes the +10 → rebuildOverdueForTask returns immediately → A's August total drops from e.g. 42 to 32. A re-ticks the task: onAssignedTaskDone returns at line 620, no entry is written. The 10 points are gone permanently, for work that was done and accepted.

**Verifier:** Maine poora chain code padh ke reproduce kiya — mechanism bilkul waise hi chalta hai jaise finding kehti hai, aur saare line citations exact hain.

STATE BANTA HAI: `user.service.js:412` — `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`. Yahan koi status filter NAHI hai, to ek pehle se DONE task bhi freeze hota hai: `assignedBy:null` + `pointsGateFrozen:true`. (Handover wala `handedOverTo` sirf `status:'PENDING'` par lagta hai — user.service.js:383-386 — isliye frozen DONE task ka `handedOverTo` null rehta hai.)

SERVER REOPEN KO ROKTA NAHI: `task.service.js:306` `const sharedPersonal = !task.assignedBy && !gateFrozen(task)` → frozen par false. Guard `:307` `if (!isOwner && !(isCollaborator && sharedPersonal))` — owner (yaani assignee) `isOwner` se seedha nikal jaata hai, `sharedPersonal` ko chhua tak nahi jaata. No-op guard (:322) DONE→PENDING par lagta nahi. `wantDone` false hai isliye openChild/approval-gate dono skip. Phir `:397` `else await onAssignedTaskUndone(task._id)`.

DELETE UNCONDITIONAL HAI: `bonus.service.js:698-703` — `PointEntry.deleteMany({ taskRef: taskId, source: { $in: ['auto_task','auto_forward'] } })`. `gateFrozen()` yahan import hone ke bawajood (`bonus.service.js:10`) call hi nahi hota. Award `onAssignedTaskDone` ne `source:'auto_task'`, `taskRef: copy._id` ke saath likha tha (:668-688), to match ho jaata hai.

REPAIR ARM BAIL KARTA HAI: `bonus.service.js:727` — `if (!t || !t.assignedBy || !t.dueYMD || t.forwardedFrom) return;`. Exact line, exact test. Frozen task ka `assignedBy` null hai → turant return.

RE-COMPLETE SE WAPAS NAHI AATA: `bonus.service.js:620` — `if (!b.enabled || !task.assignedBy) return;`. Same test.

KOI NIGHTLY RECOVERY BHI NAHI: maine chaaron self-heal passes check kiye, sab `assignedBy: { $ne: null }` filter karte hain, yaani frozen task unke liye exist hi nahi karta — `rescoreAllDoneAssigned` (:1627), `scanOverdueTasks` (:1030), `backfillOverdueRuleV2` (:1090), `rescoreAssignedTasks` (:1656). Aur `pruneOrphanTaskEntries` (:1685-1725) sirf delete karta hai, kabhi re-add nahi. To "permanently gone" literally sach hai — sirf CEO ka manual PointEntry hi wapas laa sakta hai.

FRONTEND WARNING SACH MEIN GIR JAATA HAI: `task-board.jsx:1084` — `if (t?.status === 'DONE' && !t?.awaitingApproval && t?.assignedBy) { setUndoing(t); return; }`. Frozen par `assignedBy` null → dialog skip, seedha `toggleMut.mutate(t)`. Toggle button reachable hai: `canCompleteTask` (:82) `iOwnTask` se true, `mayToggle = canToggle && canCompleteTask(...)` (:300), aur History tab har row `canToggle` hardcode karke render karta hai (:1578). Note ye bhi: list query par koi `.select()` nahi hai (`task.service.js:1074`), to `pointsGateFrozen` client tak pahunchta hai — matlab frontend ke paas jaankari THI, bas `handleToggle` usse padhta nahi.

INVERSION HI ASLI DEFECT HAI: ek normal delegated task par reopen reversible hai (undo → rebuild → re-tick → re-award) aur uspar warning dialog aata hai. Frozen task par reopen irreversible hai aur warning aata hi nahi. Jahan nuksaan permanent hai, wahan protection kam hai.

Maine ise refute karne ki koshish ki aur nahi kar paaya. Do jagah refute hone ka scope tha, dono band nikle: (a) `deleteTask` (:899 `wasDelegated(task) && !isAssigner`) assignee ko frozen task delete karne se rokta hai, (b) `forwardTask` (:522 DONE block, :527 `!parent.assignedBy` → PERSONAL_TASK) forward rokta hai. Yaani reopen hi ekmatra zinda hole hai — jo finding ke daave se mel khata hai, badhaya hua nahi.

**Correction:** Core sahi hai, teen cheezein clarify/correct karni chahiye:

1) BLAST RADIUS finding se chhota hai, aur ye severity ka ekmatra counter-argument hai: frozen task par `sharedPersonal` false hone ki wajah se `setStatus` (:307) owner ke alawa SABKO 403 deta hai — collaborator, successor, leadership, koi bhi. To ye third-party destruction nahi, purely self-inflicted hai (apne hi points, apna hi tap). Phir bhi RED isliye rehta hai ki system exactly wahi safeguard hata deta hai jo isse rokta, aur wahi tap normal delegated task par fully reversible hai.

2) YE COMMIT B/D KA REGRESSION NAHI HAI — ye unse pehle se live hai (deletion ne hamesha `assignedBy` clear kiya hai). Sahi framing: B ne is EK hi mechanism ka collaborator-half fix kiya aur owner-half chhod diya. B ka apna comment (`task.service.js:303-305`) is exact chain ko shabd-ba-shabd describe karta hai ("runs onAssignedTaskUndone, which deletes the assignee's point entries, and the rebuild ... bails out on a task with no assigner") — aur phir usko sirf collaborator ke liye band karta hai. Finding ka "left the OWNER arm wide open" sahi hai; "commit B ne toda" kehna galat hota.

3) SIRF FRONTEND FIX KAAFI NAHI, aur agar sirf frontend gate flip kiya to naya jhooth ban jaayega: `undoWarning` (`task-board.jsx:136-144`) kehta hai "Finish it again by <date> and you get them straight back" — frozen task par ye promise galat hai, kyunki `onAssignedTaskDone` :620 par bail karta hai. Backend fix pehle, copy uske baad.

Scenario ke numbers (+10, 42→32) illustrative hain — actual value `assignedTaskOnTime` rule par depend karta hai (Settings se configurable); mechanism kisi bhi value par same hai.

**Suggested fix:** Sabse chhota sahi fix backend mein hai, `onAssignedTaskUndone` ko gate-aware banao — kyunki frozen ka wada hi yehi hai: "no new awards, no new penalties, nothing deleted", aur abhi teesra hissa toota hua hai.

backend/src/services/bonus.service.js:698 —
```js
export async function onAssignedTaskUndone(taskId) {
  const t = await Task.findById(taskId).select(GATE_FIELDS);
  if (t && gateFrozen(t)) return; // frozen = points state ko haath nahi lagana
  await PointEntry.deleteMany({ taskRef: taskId, source: { $in: ['auto_task', 'auto_forward'] } });
  try { await rebuildOverdueForTask(taskId); } catch (e) { console.error('overdue rebuild failed', e?.message); }
}
```
SUBTLETY jo miss karna aasan hai: guard `if (t && gateFrozen(t))` hona chahiye, `if (gateFrozen(t))` nahi. `deleteTask` ise doc `deleteOne()` ke BAAD call karta hai (task.service.js:910 aur cascade :917), wahan `findById` null lautayega — us genuine orphan case mein prune chalna hi chahiye. `t` null ho to fall through karo.

Frontend, do line:
- website/components/tasks/task-board.jsx:1084 — condition `t?.assignedBy` ki jagah `(t?.assignedBy || gateFrozen(t))` karo, taaki frozen DONE task par bhi confirm dialog aaye.
- website/components/tasks/task-board.jsx:136 `undoWarning()` — ek frozen branch add karo: backend fix ke baad sach ye hai ki "iske points freeze ho chuke hain (assigner ka account hata diya gaya tha) — reopen karne se points nahi badlenge", na ki "you get them straight back".

Regression test (isolated-DB suite mein, wahi shape jo B/D ne use ki): delegated task DONE + awarded → assigner delete → PointEntry snapshot lo → assignee `PATCH /tasks/:id/status {PENDING}` → snapshot identical rehna chahiye → phir `{DONE}` → phir bhi identical.

---

## 18. [RED] The collaborator freeze does not travel down a forward chain, so the leaf doer's award is still hard-deleted by the nightly prune

**Kahan:** `backend/src/services/user.service.js`:400 · lens: ui-and-B

**Claim:** The B1 freeze (user.service.js:399-404) sets `pointsGateFrozen` only on the documents the deleted owner-tier user was tagged on directly (`{ collaborators: uid, assignedBy: { $ne: null } }`), then line 415 `$pull`s the tag. But eligibility is a CHAIN property: `chainEligible()` (bonus.service.js:568-584) decides a forwarded copy's fate by walking `forwardedFrom` up and calling `taskEligible(parent, ownerIds)` on the ancestor — and that ancestor is fetched at line 576 with `.select('assignedBy collaborators forwardedFrom')`, a projection that contains neither `pointsGateFrozen` nor `assignerDeleted`, so the root's frozen flag is invisible from below even in principle. In `pruneOrphanTaskEntries` the short-circuit `gateFrozen(t) ? true : await chainEligible(...)` at line 1710 only protects the frozen document itself; the child is not frozen, falls through to `chainEligible`, reads the root's now-empty `collaborators`, gets false, and every entry on it is pushed to `dead` at line 1717 and deleted at 1728.

**Scenario:** Manager M (not owner-tier) delegates 'Client drawings' to A, tags CEO C — that tag is the only reason the chain scores. A forwards it to B (task.service.js:551, child.assignedBy = A). B finishes on time; the chain settles and onAssignedTaskDone pays the tree: A gets auto_forward +5 (forwarder), B gets auto_task +10 (leaf doer). C's account is then deleted. The freeze matches the ROOT (collaborators contains C, assignedBy = M ≠ null) and sets pointsGateFrozen there; the CHILD is not matched — its collaborators are empty. Line 415 pulls C off the root. Next time anyone opens Rewards, pruneOrphanTaskEntries runs: the root is frozen → A keeps +5; the child calls chainEligible → its own assignedBy is A (not owner-tier), walks up to the root whose collaborators is now [] and whose assignedBy is M (not owner-tier) → false → B's +10 is deleted. B, the person who actually did the work, silently loses 10 points; A, who only passed it on, keeps 5.

**Verifier:** CONFIRMED — mechanism paper pe end-to-end reproduce ho gaya, har step actual code se.

1) Freeze ka scope sach me sirf directly-tagged documents hai. backend/src/services/user.service.js:400-403 → `Task.updateMany({ collaborators: uid, assignedBy: { $ne: null } }, { $set: { pointsGateFrozen: true } })`. Uske baad :415 `$pull` tag hata deta hai.

2) Forward child pe collaborators copy hote hi nahi. backend/src/services/task.service.js:551-561 me `Task.create` sirf title/notes/dueYMD/owner/assignedBy/forwardedFrom/originalAssignedBy/requiresApproval/status set karta hai — `collaborators` field hai hi nahi, aur model default `[]` hai (backend/src/models/Task.js:32). Isliye child kabhi bhi freeze query se match nahi karta. Confirmed.

3) Leaf doer ka award CHILD doc pe hang karta hai, root pe nahi: bonus.service.js:686-694 → `taskRef: copy._id`. To root ka freeze uss entry ko structurally cover karta hi nahi. Yahi finding ka core hai aur ye sahi hai.

4) Prune ka path bilkul jaisa claim kiya gaya: bonus.service.js:1691-1693 ki query me child aa jata hai (child.assignedBy = A ≠ null), projection me GATE_FIELDS hai par child frozen nahi hai; :1710 `gateFrozen(t) ? true : await chainEligible(...)` → chainEligible(child). Wahan :569 `taskEligible(child)` false (assignedBy = A non-owner, collaborators []), phir :576 ancestor fetch `.select('assignedBy collaborators forwardedFrom')` — GATE_FIELDS nahi, to root ka `pointsGateFrozen` undefined padta hai *even in principle*, aur root ka assignedBy = M (non-owner) + collaborators ab `[]` → :583 false. Entry :1717 `dead.push`, :1728 `deleteMany`. B ka award delete. Claim bilkul sahi.

Numbers: seeded `forwardOnTime` = 3 (bonus.service.js:1582), `assignedTaskOnTime` CEO-configured hai (Setting.js:77-80 default `[]`) — maan lo 10. 45 din se purani chain me: A ka +3 bacha rehta hai, B ka +10 chala jata hai — exactly wahi asymmetry jo finding ne bataayi.

Do corrections neeche (`correction` field) — ek timing ki, ek scope ki, aur scope wali finding ko CHOTA nahi karti, badi karti hai.

**Correction:** (a) Trigger "Rewards page khulne pe" nahi hai. `pruneOrphanTaskEntries` ka ek hi caller hai — bonus.service.js:1774, aur wo `maybeRunDaily` ke once-a-day throttle (`b.lastPenaltyRun === today` return, :1770 ke aas-paas) ke NEECHE hai; function ka apna comment :1739 kehta hai ye job ab scheduler-only hai. To loss agle scheduled daily run pe hota hai, page-load pe nahi. Outcome wahi, timing alag.

(b) ZYADA IMPORTANT — "A apne forwarder points rakh leta hai" sirf tab sach hai jab root ka `completedAt` 45 din se purana ho. Usi daily pass me 5 line baad `rescoreAllDoneAssigned()` chalta hai (bonus.service.js:1779 → :1618-1640). Uska filter `{ status: 'DONE', assignedBy: { $ne: null }, completedAt: { $gte: 45d cutoff }, forwardedFrom: null }` root ko uthata hai, projection :1628 me gate fields hai hi nahi, aur `onAssignedTaskDone` (:617) `gateFrozen` kabhi nahi padhta — root.assignedBy = M abhi bhi non-null hai to :620 pe bail bhi nahi karta. copies = [root, child], C ka tag pull ho chuka hai, to :633 `!copies.some(taskEligible)` true → :634 `PointEntry.deleteMany({ taskRef: { $in: [root, child] }, source: ['auto_task','auto_forward'] })` — A ka +3 AUR B ka +10, dono uda. Yaani frozen root khud bhi protected nahi hai; freeze ka honor sirf prune me hai.

(c) Isi wajah se ye defect forward-chains tak seemit nahi. Plain B1 case bhi — M assign kare A ko, C tagged, koi forwarding nahi, pichle hafte DONE — agle daily pass me usi :634 se A ke points kho deta hai. Matlab commit 00f7b8d (B1) ka fix practically sirf un tasks pe tikta hai jo 45 din se purani hain. Caveat: agar deleted owner hi akela owner-tier user tha to `ownerTierIds()` empty ho jayega aur `taskEligible` :558 pe `true` return karega — tab bach jata hai; do owner roles (CEO + President) hone par ye raahat nahi milti.

(d) Chhota detail: `collectChainCopies` (:592) bhi gate fields select nahi karta, to onAssignedTaskDone me gateFrozen check add karne se pehle wo projection bhi theek karni padegi.

**Suggested fix:** Do jagah, dono chahiye (sirf ek se aadha hi bachta hai):

1. Frozen decision ko chain me travel karao (prune wala route):
   - bonus.service.js:576 → `.select(\`assignedBy collaborators forwardedFrom ${GATE_FIELDS}\`)`, aur :580 ke saath `if (gateFrozen(parent) || taskEligible(parent, ownerIds)) return true;`. Ab neeche wali copy apne frozen ancestor ko dekh sakti hai, to B ka +10 bacha rehta hai.

2. Award/re-score route ko bhi freeze honor karwao (warna 45 din ke andar sab kuch waise hi udta rahega):
   - `onAssignedTaskDone` me :633 ke owner-tier wipe se PEHLE: `if (copies.some((c) => gateFrozen(c))) { /* gate frozen — skip the wipe, keep what was awarded */ }` (bas `deleteMany` skip karo, baaki scoring chalne do).
   - Uske liye projections me GATE_FIELDS add karo: :1628 (`rescoreAllDoneAssigned`), :1657 (`rescoreAssignedTasks`), aur :592 (`collectChainCopies`) — warna flag `undefined` aayega aur chup-chaap "false" padhega.

Optional but sasta reinforcement: user.service.js:400-403 ke freeze ko chain ke descendants tak faila do (matched root ids se `forwardedFrom` neeche walk karke unpe bhi `pointsGateFrozen: true`), taaki DB-level state khud self-describing ho. Par ye akela kaafi nahi — (2) ke bina frozen child bhi :634 se udega.

---

## 19. [MEDIUM] `handedOverTo` is never populated by listTasks, so the successor fallback the commit added renders "From:" with a blank name

**Kahan:** `backend/src/services/task.service.js`:1074 · lens: ui-and-B

**Claim:** `populated()` (task.service.js:261) populates `handedOverTo`, but `listTasks` builds its own populate chain at line 1074 — `owner, assignedBy, collaborators, completedBy, approvedBy, originalAssignedBy` — and omits `handedOverTo`. Every task the To-Do board renders comes from that query (`out = tasks.map(t => t.toJSON())`, line 1078), so `t.handedOverTo` reaches the client as a bare 24-char id string, never an object with a `name`. task-board.jsx:293 then does `const from = ... task.assignedBy || task.handedOverTo || null` — the id string is truthy, so `from` is set, the `from ?` branch at line 338 wins, and it prints `From: {from.name}` where `from.name` is `undefined`. The commit's own comment at 290-292 says the fallback exists so 'this line goes blank and the assignee is left with a task from nobody' does not happen; it still goes blank, and now with a stray 'From:' label in front of it. (Side effect: the raw successor user id is shipped to every viewer of the list instead of a name.)

**Scenario:** D delegated 'Vendor quotes' to A and is deleted with Bob named as successor, so the task carries assignedBy: null, handedOverTo: <bob-id>. A opens To-Do → My tasks. The row renders `From:` followed by nothing at all — A still has no idea who to ask about the task, which is the exact failure the change was written to fix. The successor's name only appears if A opens a route that goes through populated() (e.g. the Rewards task detail), which the To-Do list never does.

**Verifier:** I tried to refute this and could not — the mechanism reproduces exactly, step by step, from code I read.

1. State after a handover. `backend/src/services/user.service.js:383-386` sets `handedOverTo: heir._id` on `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }`, and `user.service.js:412` then runs `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`. So the assignee's row ends up `owner: <A>`, `assignedBy: null`, `handedOverTo: <bob-id>`, `pointsGateFrozen: true`. Confirmed.

2. The list query really does omit the populate. `backend/src/services/task.service.js:1074` is one long chain: `.populate('owner','name').populate('assignedBy','name').populate('collaborators','name').populate('completedBy','name').populate('approvedBy','name').populate('originalAssignedBy','name')` — no `handedOverTo`. `grep -n handedOverTo backend/src/services/task.service.js` returns only 245, 261, 280, 687, 977, 1191; 261 is inside `populated()`, which `listTasks` never calls. There is no `.select()` on that `Task.find(filter)`, so the field is present in the document — it just arrives as a raw ObjectId. `task.service.js:1078` (`out = tasks.map(t => t.toJSON())`) and the tail of `listTasks` (which I read through to the `return` at :1176) never post-process it, unlike `siblings`, `forwardedTo` and `forwardChain`, which are all built by hand. `res.json` then serialises the ObjectId to a 24-char hex string.

3. The row is fed by exactly that query. To-Do fetches `api.get('/tasks?...')` at `website/components/tasks/task-board.jsx:872` → `tasks.controller.js:77` → `svc.listTasks`. With `assignedBy` null the task is not `onlyTagged`, so the grouping loop at `task-board.jsx:905-922` drops it into `personal` (the `else if (t.assignedBy)` folder branch is skipped), and `mine.personalPending.map(...)` renders it through `<TaskRow>` at `task-board.jsx:1515-1517` with `assignerView` left at its default `false`.

4. The render breaks. `task-board.jsx:293` — `const from = assignerView ? null : tagged ? task.owner : task.assignedBy || task.handedOverTo || null` — assigns the hex string. It is truthy, so the `) : from ? (` branch wins and `task-board.jsx:340` renders `From: <span …>{from.name}</span>`, where `from.name` on a String primitive is `undefined`. React renders nothing. Result: the literal text "From:" followed by empty space. No crash.

Concrete scenario, numbers included: D delegates "Vendor quotes" (due 2026-08-20, requiresApproval) to A. D is deactivated and deleted with Bob named successor. `updateMany` matches 1 doc → `handedOverTo = 68a1…bob`, `assignedBy = null`, `pointsGateFrozen = true`; the toast at `delete-user-dialog.jsx:76` correctly says "1 task is now with Bob". A opens To-Do → My tasks. The GET returns `{"handedOverTo":"68a1c4f2e91b7d3a5c0f22b7", "assignedBy":null, …}`. The row prints `From:` and nothing else. The exact failure the comment at `task-board.jsx:290-292` says the fallback exists to prevent ("this line goes blank and the assignee is left with a task from nobody") still happens, now with a dangling label in front of it.

**Correction:** Two claims in the finding are wrong, and one thing it missed makes it slightly worse.

(a) WRONG: "The successor's name only appears if A opens a route that goes through populated() (e.g. the Rewards task detail)." It appears nowhere. A repo-wide grep for `handedOverTo` under `website/` returns exactly two hits: `task-board.jsx:293` and `delete-user-dialog.jsx:76` (the deletion toast, which uses the name the server returns from `user.service.js:388`, not the task field). The Rewards detail does go through `getTaskDetail` → `populated()` (`rewards/page.jsx:61` → `task.service.js:296`, which does populate it at :261), but `TaskFacts` at `rewards/page.jsx:82` only renders `task.assignedBy?.name || task.originalAssignedBy?.name` — it never reads `handedOverTo`. So populating it there is dead weight; no screen in the product ever displays the successor's name against a task.

(b) OVERSTATED: the "raw successor user id is shipped to every viewer" side effect is not a new exposure. `Task.find(filter)` at :1074 has no projection, so `handedOverTo` was already in the JSON before the frontend change, and the same payload already carries `owner.id`, `assignedBy.id`, `collaborators[].id`. Nothing is leaked that the client did not already hold. Drop this from the write-up; it is not part of the defect.

(c) MISSED, same root cause, same commit: the fallback was added to the row only. Tapping the row opens `TaskDetailDialog` with the same in-memory object (`openTask({ task: x, … })` at `task-board.jsx:1517` — there is no re-fetch of `/tasks/:id` anywhere in task-board). Its "Type" row at `task-board.jsx:661-679` tests `tagged` → `task.assignedBy?.name` → `view.assignerView` → `sharedWith.length` → falls through to the literal `'Personal task'`. So A's handed-over, approval-gated, points-frozen delegated task is labelled **"Personal task"** in the detail sheet — a stronger misstatement than the blank row. Related: `fromOf` at `task-board.jsx:897` also ignores `handedOverTo`, so typing "Bob" in the My-tasks search will not match the task, and the task never lands in a person folder (`task-board.jsx:913`).

**Suggested fix:** One-line server fix, plus two small client follow-ons.

1. Required — `backend/src/services/task.service.js:1074`: add `.populate('handedOverTo', 'name')` to the chain, so it matches `populated()` at :258-266. This alone makes `task-board.jsx:293` and :340 behave as the commit intended.

2. Defensive — `task-board.jsx:340`: use `{from?.name}` (and `{from.name}` at :338 in the tagged branch) so a future unpopulated ref degrades to "no From line" rather than a dangling label. Even better, gate the branch on `from?.name` instead of `from`.

3. Consistency — extend the same fallback the row got to the two places that still only see `assignedBy`:
   - `task-board.jsx:661-679` Type row: before falling through to `'Personal task'`, add a branch for `task.handedOverTo?.name` rendering something like "Assigned by (account removed) — now with {name}"; gate it on `gateFrozen(task)` so a genuinely personal task is unaffected.
   - `task-board.jsx:897` `fromOf`: `(onlyTagged(t, myId) ? t.owner : t.assignedBy || t.handedOverTo) || null`, so name search and person-folder grouping agree with the row.

Optional cleanup: `rewards/page.jsx:82` `TaskFacts` could show the successor when `assignedBy` is null and the gate is frozen, otherwise the `populate('handedOverTo')` in `populated()` serves no consumer.

---

## 20. [MEDIUM] The detail sheet still offers Edit and Delete on a frozen task the server refuses — commit B patched two of the four client guards

**Kahan:** `website/components/tasks/task-board.jsx`:990 · lens: ui-and-B

**Claim:** Commit B added `!gateFrozen(t)` to `canCompleteTask` (line 82) and to `TaskRow.canManage` (line 297), but left the two sibling predicates testing `assignedBy` alone: `canMgr` at line 990 (`t.owner?.id === user?.id && !t.assignedBy`) and `iOwn` at line 553. `canMgr` is what fills `allowEdit`/`allowDelete` on the detail dialog at lines 1166-1167, 1481, 1524 and 1581, and those flags render the Edit and Delete buttons at 578-587 unconditionally. A frozen task is reachable there because the `mine` grouping at line 913 branches on `t.assignedBy` too, so a frozen delegated task falls through into the `personal` bucket (918) and is listed as one of the assignee's own to-dos. The server refuses both actions: `updateTask` throws 403 ASSIGNED_TASK via `wasDelegated(task) && !isAssignerOf(...)` (task.service.js:672-673) and `deleteTask` throws the same at 897-899.

**Scenario:** A's assigner is deleted with no successor named. A opens To-Do → My tasks; 'Vendor quotes' now sits in the personal list. The row itself correctly hides the pencil/bin (line 297 is guarded), but tapping the row opens the detail sheet where `allowEdit`/`allowDelete` came from `canMgr` — both buttons are there. A taps Delete → confirm → the server 403s and a red toast says 'This task was assigned to you — only the person who assigned it can delete it'. Same for Edit. The same row therefore says two different things about A's rights depending on whether they tapped the row or the icon strip.

**Verifier:** Reproduced end to end from the code. The precondition that could have refuted it holds the other way: `pointsGateFrozen` really does reach the browser — `listTasks` runs `Task.find(filter)...populate(...)` with NO `.select()` (backend/src/services/task.service.js:1074), `tasks.controller.js:77` returns the service payload verbatim, and `Task.js:68` sets `toJSON` with virtuals and no stripping transform. So client-side `gateFrozen()` (website/lib/task.js:24) is live and functioning, which is exactly what makes the two unpatched predicates a drift rather than a no-op.

The chain: (1) `user.service.js:412` sets `{ assignedBy: null, pointsGateFrozen: true }` on every task the deleted user had assigned. (2) In the client `mine` grouping, `t.assignedBy` is null so line 913 falls through to line 918 and the task lands in `personal` — the assignee's own to-do list. (3) That list renders at task-board.jsx:1515-1526 with `onOpen={... allowEdit: canMgr(x), allowDelete: canMgr(x) ...}` (line 1524). (4) `canMgr` at line 990 is `t.owner?.id === user?.id && !t.assignedBy` — owner matches, `assignedBy` is null, so it returns TRUE. (5) `TaskDetailDialog` renders the Edit button at 578-581 and the Delete button at 583-587 directly off `view.allowEdit`/`view.allowDelete`, wired through onEdit/onDelete at 1621-1632 into `setEditing` (TaskDialog, PATCH) and `setDeleting` (ConfirmDialog -> `delMut` -> `api.delete`, 1187-1195).

The server refuses both, unconditionally: `deleteTask` throws 403 ASSIGNED_TASK at task.service.js:899-901 (`wasDelegated(task) && !isAssigner`) and `updateTask` at 672-673. `wasDelegated()` (line 254-256) is `!!task.assignedBy || gateFrozen(task)` -> true on a frozen task, and `assignerAuthority()` (line 244-246) is `assignedBy || handedOverTo` -> never the assignee (user.service.js:384 excludes the heir's own tasks via `owner: { $nin: [uid, heir._id] }`, so the assignee can never be the authority). `api.js:94-95` surfaces the server's message, so the user gets the red toast quoting "only the person who assigned it can delete it".

The contrast the finding rests on is real: `TaskRow.canManage` at line 297 DOES carry `!gateFrozen(task)` and gates the pencil/bin at 368-377, so the icon strip on the row is correct while the sheet opened by tapping that same row is not.

This is UI drift only — no data loss, no wrong points, no privilege escalation. MEDIUM is the right severity.

**Correction:** Three corrections, none of which undermine the core:

1. `iOwn` at line 553 is NOT a second Edit/Delete leak. It is only consumed at line 558 (`sharedWith`), which renders the "Shared with" chip row at 721-728. On a frozen delegated task the assignee will see the ex-assigner's other collaborators labelled "Shared with" as if it were their own shared task — cosmetic drift, worth the same one-line fix, but it does not put a button on screen. The entire button leak is `canMgr` alone.

2. The scenario is narrower than the bug. It is not limited to "deleted with no successor named": `handedOverTo` does not appear in `canMgr` either, and user.service.js:412 freezes EVERY task the deleted user had assigned (the freeze runs unconditionally in the `Promise.all`, after the optional handover block at 383-386). So when leadership DOES name a successor, the assignee still sees Edit and Delete on a task whose authority now provably belongs to the heir — arguably the worse half, since the row is someone else's to manage rather than nobody's.

3. Four call sites, not one. `canMgr` fills allowEdit/allowDelete at 1166-1167 (notification deep link `/todo?task=<id>`), 1481 (the flat "All pending / All tasks" list), 1524 (the grouped personalPending list), and 1581 (the History/completed tab). The 1581 site means a frozen task that is already DONE also offers Delete in history and 403s the same way.

Adjacent, and NOT part of this finding, but read while verifying line 293: `listTasks` populates owner/assignedBy/collaborators/completedBy/approvedBy/originalAssignedBy but never `handedOverTo` (task.service.js:1074), so the new fallback `task.assignedBy || task.handedOverTo` at line 293 yields a raw ObjectId string and `from.name` at line 340 is undefined — the row renders "From: " with an empty name, which is precisely the blank the comment at 290-292 says it was added to prevent. Separate defect; flagging it only so it is not lost.

**Suggested fix:** Give the three predicates one shared definition so they cannot drift again. Add to website/lib/task.js next to `gateFrozen`:

export const iManage = (t, myId) => !!myId && t?.owner?.id === myId && !t?.assignedBy && !gateFrozen(t);

Then use it in all three places in task-board.jsx: line 297 `const canManage = assignerView || iManage(task, myId);`, line 553 `const iOwn = iManage(task, myId);`, line 990 `const canMgr = (t) => iManage(t, user?.id);`. That single change fixes all four detail-sheet call sites (1166-1167, 1481, 1524, 1581) at once, because they all read `canMgr`.

Minimum viable version if a one-line patch is preferred: append `&& !gateFrozen(t)` to line 990 and `&& !gateFrozen(task)` to line 553. The shared helper is better only because this is the second time these three copies of the same rule have gone out of sync.

Server needs no change — task.service.js:672-673 and 899-901 already enforce it correctly via wasDelegated()/isAssignerOf().

---

## 21. [MEDIUM] A handed-over task awaiting approval never reaches the successor's Approvals inbox, its count, or the sidebar badge

**Kahan:** `backend/src/services/approvals.service.js`:82 · lens: ui-and-B

**Claim:** task.service was moved to `assignerAuthority()` everywhere, and `listTasks` scope=assigned was widened to `$or: [{assignedBy}, {handedOverTo}]` (line 977) — but the three approval-surfacing queries outside that file were not. `pendingFor` filters `Task.find({ assignedBy: user._id, requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } })` (approvals.service.js:82), `pendingCount` repeats it at line 192, `historyFor` at line 161, and `badges.service.js:46` uses `{ assignedBy: mine, requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }`. A handed-over task has `assignedBy: null`, so it matches none of them, while `reviewTask` (task.service.js:418) now positively authorises the successor to decide it via `isAssignerOf`.

**Scenario:** D had 'Floor plan revision' with approval required, delegated to A; Bob is named successor on deletion. A submits it — setStatus:344 sees assignerAuthority = Bob, stamps submittedAt and sends Bob a TASK_APPROVAL bell (line 352). Bob opens Approvals: the Tasks section shows 0, the section count is 0, and the sidebar dot does not include it. Nothing in the module Bob is told to work from says the task exists. It surfaces only if Bob happens to open To-Do → Assigned by me, whose separate `awaiting=1` query does go through listTasks. If Bob then approves it there, `historyFor` never lists it either, so the decision leaves no trace on the page that records decisions.

**Verifier:** Reproduced on paper against the code, end to end.

STATE PRODUCED BY THE HANDOVER. `deleteUser` writes `handedOverTo` first (backend/src/services/user.service.js:383-386) over `{ assignedBy: uid, status: 'PENDING', owner: { $nin: [uid, heir._id] } }`, then in the detach block nulls the assigner for everything (:412 `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, pointsGateFrozen: true } })`). Both run sequentially inside the same call, so the settled document is exactly `assignedBy: null`, `handedOverTo: <heir>`, `pointsGateFrozen: true`, `requiresApproval: true`, `submittedAt` set, `status: 'PENDING'`. An awaiting-approval task IS `status: 'PENDING'` (Task.js:64-66 — the `awaitingApproval` virtual is `requiresApproval && status === 'PENDING' && submittedAt`), and setStatus never moves it off PENDING when it submits (task.service.js:344-362), so such a task does match the handover filter at user.service.js:384 in both orderings.

THE FOUR QUERIES ARE UNCHANGED. `git show 83c7500 --stat` touches only users.controller, Task.js, bonus.service, task.service, user.service and three frontend files — approvals.service.js and badges.service.js are not in the commit. I read them at HEAD and they still filter on the bare field:
 - approvals.service.js:82 `Task.find({ assignedBy: user._id, requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } })`
 - approvals.service.js:161-166 `Task.find({ assignedBy: user._id, requiresApproval: true, updatedAt: {...}, $or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }] })`
 - approvals.service.js:192 `Task.countDocuments({ assignedBy: user._id, ... })`
 - badges.service.js:46 `latest(Task, { assignedBy: mine, requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }, 'submittedAt')`
With `assignedBy: null` on the document, all four miss it. Nothing else in the request path can put it back: approvals/page.jsx renders purely from `data[tab]` (:143) and `counts[t.key]` (:179, :197), and its history list renders purely from `history.tasks` (:347).

THE AUTHORITY DID MOVE, WHICH IS WHAT MAKES IT DRIFT RATHER THAN A CLOSED DOOR. `reviewTask` now authorises through `isAssignerOf` (task.service.js:419), which resolves via `assignerAuthority` = `task.assignedBy || task.handedOverTo` (:245). So the successor is positively entitled to decide it, and `listTasks` scope=assigned was widened to `$or: [{assignedBy}, {handedOverTo}]` (:977) and `taskSummary` likewise (:1191) — the module that was updated shows it, the module that was not shows nothing.

CONCRETE RUN. D delegated 'Floor plan revision' to A with requiresApproval on. Bob is named successor in the delete dialog. A submits: setStatus:344 evaluates `assignerAuthority(task)` truthy (handedOverTo = Bob), stamps `submittedAt`, and notifies Bob (:351-352). Bob holds approveLeave, so `sectionsFor` (approvals.service.js:45-53) gives him `tasks: true` and the Work tab renders. `pendingFor`'s task branch returns [] → the Work tab shows no count pill (page.jsx:196-198), `rows.length === 0` → EmptyState "Work comes here when someone finishes a task you handed out… None of yours is waiting" (page.jsx:206-217), which is a false statement about a task the server will let him approve. Bob approves it from To-Do instead; `reviewTask` sets `approvedBy = Bob` (:441) but leaves `assignedBy` null, so `historyFor` never returns it — the History pane on the page whose job is recording decisions stays permanently blank for that decision, for Bob and for everyone.

NOT A LEFTOVER FROM THE REVERTED ATTEMPT. Before this feature, a deleted assigner meant `assignedBy` null and `isAssigner` false for everyone, so the task could not be reviewed at all and correctly surfaced nowhere. The gap is new and comes from the new authority model being applied inside task.service.js only.

Severity MEDIUM is right: no data loss, no point movement (bonus.service never reads `handedOverTo` — confirmed by grep, its only hits are user.service, task.service, Task.js, task-board.jsx, users.controller, delete-user-dialog), and no privilege escalation — the successor genuinely holds the authority. It is under-surfacing plus a permanently incomplete decision history.

**Correction:** Two substantive corrections, one line-number nit.

1) THE BADGE HALF IS BROADER THAN THE FINDING SAYS, and the finding files it under Approvals only. `badges.service.js:46` (`awaitingMyApproval`) feeds TWO dots: `approvals` at :71 (approvers only) and `todo` at :62 (everyone). So the To-Do sidebar dot also fails to light for the inherited submission. That matters because the Approvals half of the finding has a precondition it does not state: `sectionsFor`/`canUseApprovals` (approvals.service.js:36-53) gate the whole module on approveLeave || approveRegularization, while the handover only requires `canAssignAny(heir)` (user.service.js:376 → task.service.js:90-93, purely `taskAssign.mode`). A successor with taskAssign but no approval permission never sees the Approvals module at all — for them the finding's inbox scenario does not apply, but they still get NO dot on To-Do, the only page that shows the task. So the badge defect hits every successor; the inbox defect hits the subset who hold an approval permission.

2) THE SCENARIO PICKS THE KINDER ORDERING. The finding has A submit AFTER Bob is named, so Bob at least gets a TASK_APPROVAL bell (setStatus:351-352). The realistic ordering is the reverse — a departing manager leaves a submission undecided. Then the task already has `submittedAt` set and `status: 'PENDING'`, so it still matches the handover filter (user.service.js:384), but the TASK_APPROVAL notification belonged to the departing user and is destroyed by `Notification.deleteMany({ user: uid })` (user.service.js:352); nothing re-issues it to Bob. In that ordering Bob gets no bell, no dot, no inbox row and no count — the sole discovery path is manually opening To-Do → Assigned by me and scrolling the awaiting block. That is strictly worse than the scenario as written.

3) Nit: the successor's authorisation is task.service.js:419 (`if (!isAssignerOf(task, actor)) throw 403`), not :418 (that is the not-found guard); `historyFor`'s `assignedBy: user._id` is :162, with the `Task.find(` opening at :161.

**Suggested fix:** Widen the same `$or` that listTasks:977 already uses to the four queries outside task.service.js. Add a shared helper so a fifth reader cannot drift again — e.g. in backend/src/lib/pointsGate.js or a small task scope module: `export const assignerScope = (id) => ({ $or: [{ assignedBy: id }, { handedOverTo: id }] });`

- approvals.service.js:82 → `Task.find({ ...assignerScope(user._id), requiresApproval: true, submittedAt: { $ne: null }, status: { $ne: 'DONE' } })`
- approvals.service.js:192 → the same spread in `countDocuments`.
- badges.service.js:46 → `latest(Task, { ...assignerScope(mine), requiresApproval: true, status: 'PENDING', submittedAt: { $ne: null } }, 'submittedAt')`.
- approvals.service.js:161-166 needs care: that filter ALREADY has a top-level `$or` (approvedBy / rejectionReason). Spreading a second `$or` into the same object literal silently overwrites the first and would widen history to every task the person was ever assigner of, decided or not. Combine explicitly: `Task.find({ requiresApproval: true, updatedAt: { $gte: since, $lte: until }, $and: [assignerScope(user._id), { $or: [{ approvedBy: user._id }, { rejectionReason: { $nin: ['', null] } }] }] })`.

No self-exclusion clause is needed — the handover already skips tasks the heir owns (user.service.js:384 `owner: { $nin: [uid, heir._id] }`), so widening cannot create a self-approval row. Also refresh the now-stale comments that name the old rule: approvals.service.js:50 ("see pendingFor's assignedBy filter") and :78-80 ("assignedBy is what keeps two people… from ever seeing each other's work").

---

## 22. [MEDIUM] The dialog counts delegated tasks the server then silently refuses to hand over — the ones the successor already owns

**Kahan:** `backend/src/services/user.service.js`:384 · lens: ui-and-B

**Claim:** `exitSummary` counts open delegated work as `{ assignedBy: userId, status: 'PENDING', owner: { $ne: userId } }` (user.service.js:292), and the dialog drives its whole question off that number: 'Who becomes responsible for the {delegated} open tasks they delegated?' (delete-user-dialog.jsx:158) with the reassurance 'They'll appear under "Assigned by me" for that person, who can then approve, edit or close them' (186-189). The handover itself uses a strictly narrower filter — `owner: { $nin: [uid, heir._id] }` (user.service.js:384) — deliberately skipping tasks the heir owns. Nothing tells the admin: the skipped tasks keep `handedOverTo: null`, so after the freeze at 412 they satisfy `wasDelegated()` with `assignerAuthority()` null and become untouchable by everyone — updateTask and deleteTask 403 the assignee (task.service.js:672, 897) and nobody else qualifies as assigner. The only signal is the success toast quoting a smaller number than the dialog asked about, and only when it is non-zero (`res?.handedOver ?` at delete-user-dialog.jsx:74).

**Scenario:** D is leaving with 3 open delegated tasks: two with Alice, one with Bob — Bob being D's deputy and therefore the obvious pick. The dialog reads 'Work they delegated, still open — 3 · needs someone responsible' and asks who takes the 3 over. The admin picks Bob and reads that they will appear under his 'Assigned by me'. The server matches only 2 (Bob's own copy is excluded by `$nin`), the toast says '2 open tasks are now with Bob', and the third is orphaned for good: Bob can tick it off but no one can edit its deadline, approve it, or delete it, and the 'Nobody — leave them unassigned' warning that describes exactly this outcome was never shown, because a successor was chosen.

**Verifier:** Reproduced on paper from the code. exitSummary counts open delegated work as {assignedBy: userId, status:'PENDING', owner:{$ne:userId}} (backend/src/services/user.service.js:292) and the dialog drives its entire question and reassurance off that single number (website/components/users/delete-user-dialog.jsx:68, 158, 186-189). The handover updateMany is strictly narrower: {assignedBy: uid, status:'PENDING', owner:{$nin:[uid, heir._id]}} (user.service.js:383-386). The set difference is exactly the open tasks the chosen heir already owns, and those are silently skipped.

The freeze on the next step is NOT narrowed: Task.updateMany({assignedBy: uid}, {$set:{assignedBy:null, pointsGateFrozen:true}}) at user.service.js:412 hits the skipped tasks too. Final state of a skipped doc: assignedBy=null, handedOverTo=null, pointsGateFrozen=true.

Feeding that state through task.service: wasDelegated() = !!null || gateFrozen() = true (task.service.js:254-256, lib/pointsGate.js:17-19); assignerAuthority() = task.assignedBy || task.handedOverTo = null (task.service.js:244-246); isAssignerOf() = false for everyone (task.service.js:248-251). Therefore updateTask throws 403 ASSIGNED_TASK at task.service.js:672-673 for every caller including the owner, deleteTask throws 403 at task.service.js:899-900, and reviewTask throws 403 at task.service.js:419. I checked for an override: there is no permission-based escape (no can(actor,...) branch) on any of those three paths, and handedOverTo is written in exactly one place in the whole backend (user.service.js:385, confirmed by grep across backend/src) — so there is no later repair path. The orphan is permanent.

The dialog's reassurance is provably false for the skipped tasks: listTasks scope 'assigned' matches only {$or:[{assignedBy: actor._id},{handedOverTo: actor._id}]} (task.service.js:977), and the skipped doc has both fields null, so it never appears under "Assigned by me" for the heir. The only signal to the admin is the success toast quoting a smaller number, and it is gated on truthiness (`res?.handedOver ?` at delete-user-dialog.jsx:74-78), so it vanishes entirely in the all-skipped case. The "Nobody — leave them unassigned" warning at lines 174-184, which describes this exact outcome, is only rendered when no successor is chosen.

Scenario as filed checks out: D leaving with 3 open delegated tasks (2 owned by Alice, 1 owned by Bob). Dialog row reads "Work they delegated, still open — 3 · needs someone responsible"; admin picks Bob (D's deputy, the obvious pick) and reads that they will appear under his "Assigned by me". Server matches 2 ($nin excludes Bob's own copy), handedOver=2, toast "2 open tasks are now with Bob". Bob's copy is frozen with no assigner authority: Bob can still tick it off (setStatus allows isOwner at task.service.js:294, 307), but its deadline cannot be edited, it cannot be reviewed, and it cannot be deleted, by Bob or anyone else, forever.

Severity MEDIUM is right: no data loss and no points move (see correction), but the admin is asked about N tasks, told what will happen to N tasks, and a subset is silently left in the exact state the dialog warns about only under the option they did not choose.

**Correction:** Three corrections/strengthenings.

(1) Line cite: the deleteTask guard is task.service.js:899-900 (`if (wasDelegated(task) && !isAssigner) throw ...`), not 897 — 897 is comment text. updateTask:672-673 is correct.

(2) The worst case is stronger than filed, not weaker. If EVERY open delegated task belongs to the chosen heir (e.g. D delegated only to his deputy Bob — 3 tasks, all Bob's), modifiedCount is 0, so `res?.handedOver` is falsy and the toast falls back to the bare "User deleted" (delete-user-dialog.jsx:74-78). The admin is asked "Who becomes responsible for the 3 open tasks they delegated?", names Bob, is told they will appear under his "Assigned by me", and receives zero indication that nothing happened. All 3 are permanently un-editable, un-reviewable, un-deletable. The "smaller number in the toast" is not a floor on the signal — the signal can be nil.

(3) One over-claim in the finding: "no one can ... approve it" is not quite the failure mode. For a skipped task with requiresApproval=true, the submit branch at task.service.js:344 requires `assignerAuthority(task)` to be truthy, so it is skipped entirely — the heir's "done" closes the task outright rather than sitting stuck in awaitingApproval. So the assigner's approval requirement is silently DROPPED, not deadlocked. Relatedly, no points move either: onAssignedTaskDone returns immediately at bonus.service.js:620 (`if (!b.enabled || !task.assignedBy) return;`), so completing a frozen orphan awards nothing and deletes nothing. That means the justification written at user.service.js:381-383 ("naming them responsible for their own work would let them approve their own submission") is only half live — the self-AWARD half is already neutralized by the freeze; the real remaining risk is the heir editing a deadline they are judged against. The $nin is therefore still worth keeping; the defect is disclosure, not the exclusion itself.

**Suggested fix:** Do not remove the `$nin` — keep the heir excluded (it is what stops them editing their own deadline). Make the skip visible instead, ideally before the delete rather than after.

Minimum (server tells the truth): in deleteUser, before the freeze at user.service.js:412 and inside the `if (reassignTasksTo)` block, count what is being deliberately skipped and return it:

    const skippedOwnByHeir = await Task.countDocuments({ assignedBy: uid, status: 'PENDING', owner: heir._id });
    ...
    return { success: true, handedOver, handedOverTo, skippedOwnByHeir };

Then in delete-user-dialog.jsx:74-78 stop gating the toast on `res?.handedOver` and gate it on "a heir was chosen", so the zero case still speaks, e.g.: `${res.handedOver} of ${res.handedOver + res.skippedOwnByHeir} open tasks are now with ${res.handedOverTo}` plus, when skippedOwnByHeir > 0, a warning-level toast: "${n} were already ${name}'s own work — those stay with nobody able to edit, review or close them."

Better (ask before, not report after): have exitSummary return the per-owner breakdown of the same set it counts, e.g. add alongside openTasksDelegated at user.service.js:288-296

    Task.aggregate([{ $match: { assignedBy: new mongoose.Types.ObjectId(userId), status: 'PENDING', owner: { $ne: userId } } }, { $group: { _id: '$owner', n: { $sum: 1 } } }])

returned as `delegatedByOwner: [{ userId, n }]`. The dialog already has the users list, so on heir selection it can show the same warning text it shows for "Nobody", scoped to the overlap — "2 of these 3 are Bob's own work; naming Bob leaves those 2 with nobody able to edit or close them, pick someone else if you want them covered" — which lets the admin change their pick instead of learning about it from a toast after the account is already gone. Also drop or qualify the blanket reassurance at lines 186-189, since "They'll appear under 'Assigned by me' for that person" is false for the overlap (listTasks:977).

---
