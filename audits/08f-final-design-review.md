# Final design review — poora handover design (11 Aug 2026)

> 5 lenses, code likhne se **pehle**. **24 objections khadi, 0 refuted.**

> Dedupe karne par **7 asli cheezein**. Sabse badi: **paanch alag agents ne ek hi baat pakdi** —
> Niyam 3 ka Accept points ke gate ka jawab **NO se YES** kar deta hai.

> Achhi khabar: **Niyam 1 aur 2 sach me neutral hain** (verifier ne alag se confirm kiya) —
> yaani design ki buniyadi soch sahi hai, sirf wo raasta toota hai jahan chain me koi bacha hi nahi.

---

## 1. [RED] Niyam 3 ka Accept gate ka jawab NO se YES kar deta hai — band ho chuke mahine me back-dated penalty invent hoti hai

lens: limbo · `backend/src/services/bonus.service.js`:1054

**Scenario:** Manish Saini (Senior Manager, owner-tier NAHI) 18 Jul 2026 ko Rahul Yadav ko 'Ambernath site photos' deta hai, due 2026-07-25, koi owner tag nahi, koi forward nahi. Gate PEHLE: taskEligible (bonus.service.js:555-560) — assignedBy Manish ownerIds me nahi, collaborators khaali; forwardedFrom null hone se chainEligible:570 ka loop chalta hi nahi -> FALSE. Isliye scanOverdueTasks:1038 `continue` karta hai aur Rahul par is task ki EK BHI PointEntry kabhi nahi banti. July band ho jaati hai, Rahul ka July net +3. 10 Aug: Manish delete -> chain nahi, tag nahi -> Niyam 3 -> limbo (deleteUser user.service.js:351 assignedBy null + assignerDeleted true). Limbo tak sab frozen hai, design ka waada yahan tak sahi. 12 Aug: Kalpana Sharma (CEO & President) modal me Accept dabati hai. Rule 5 kaam kare iske liye assignedBy = Kalpana set karna hi padega — reviewTask:389 `isAssigner = task.assignedBy && ...` isi field se approver decide karta hai, aur koi doosra field hai hi nahi. Us raat scheduler tick -> maybeRunDaily:1774 -> scanOverdueTasks: query :1030 ab match karti hai (assignedBy != null, status PENDING, dueYMD set, forwardedParentIds me nahi), chainEligible:1038 -> taskEligible -> ownerIds.has(Kalpana) -> TRUE, `marked` (:1045) null -> awardOnce('auto_task:<id>') likh deta hai: points -5, earnedYMD = overdueDayFor('2026-07-25', graceDays 1 [Setting.js:73]) = '2026-07-27', month '2026-07'. Rahul ka July +3 se -2 ho jaata hai; carryInFor (bonus.service.js:92-106) us -2 ko August, September... har mahine compound karta hai, aur leaderboard:428-448 sab dobara live compute karta hai. Agar due date August ki ho (jaise 2026-08-02) to -5 mark ke saath :1064-1066 ka roz -1 drip bhi chalu ho jaata hai. Yahi cheez Niyam 3 ke 'aakhri bacha hua candidate ko seedha' aur 'owner-tier me sirf ek hi insaan ho to seedha uske paas' par bhi lagti hai — wahan to limbo hi nahi, deletion ke turant baad -5 lag jaata hai.

**Verifier:** Objection sahi hai. Maine ise refute karne ki poori koshish ki — har raasta band mila.

MECHANISM (har step code se proved):

1. GATE BEFORE = FALSE. `taskEligible` (backend/src/services/bonus.service.js:555-560) do hi arm rakhta hai: `assignedBy` ownerIds me ho, ya koi collaborator ownerIds me ho. `chainEligible` (:567-583) ka loop `cur.forwardedFrom` par chalta hai — forwardedFrom null hone par loop ek baar bhi nahi chalta aur :582 `return false`. Manish (Senior Manager, non-owner-tier) ka diya task, koi tag nahi, koi forward nahi -> FALSE. scanOverdueTasks :1038 `continue` -> Rahul par is task ki ek bhi PointEntry kabhi nahi banti. Sahi behaviour, kyunki task points system me hai hi nahi.

2. LIMBO GENUINELY FREEZES — yahan tak design ka waada sach hai. deleteUser (backend/src/services/user.service.js:351) `assignedBy: null, assignerDeleted: true` set karta hai, aur scanOverdueTasks ki query :1030 `{ assignedBy: { $ne: null }, ... }` hai, to limbo me task query me aata hi nahi. onAssignedTaskDone :619 bhi `!task.assignedBy` par turant return karta hai. Limbo par koi objection nahi.

3. ACCEPT KO assignedBy SET KARNA HI PADEGA — bachne ka raasta nahi. reviewTask (backend/src/services/task.service.js:389) `isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id)`, warna :390 par 403. setStatus:314 ka approval gate `wantDone && task.requiresApproval && task.assignedBy && isOwner` — assignedBy null ho to gate fire hi nahi hota aur task self-close ho jaata hai. Task.js:1-47 me koi doosra "kaun zimmedaar hai" field hai hi nahi. Yaani Niyam 5 (approval bani rahegi) sirf tabhi kaam karta hai jab Accept `assignedBy = Kalpana` likhe.

4. FLIP + BACK-DATED PENALTY. assignedBy = Kalpana (ownerTierIds :527-534, roles.js:136-140 se resolve — minimum-rank role = CEO & President tier, yaani design ke candidates aur bonus ka ownerIds bilkul same set hain) -> :558 pehla arm TRUE. Agli scheduler tick (maybeRunDaily :1774 -> scanOverdueTasks): query :1030 ab match karti hai, :1035 `duePlus (2026-07-26) >= today (2026-08-12)` false, :1038 chainEligible ab TRUE, :1045 `marked` null, :1051 `overdueDayFor('2026-07-25', graceDays 1 [models/Setting.js:73]) = addDays(due, 2) = '2026-07-27'`, :1054 `awardOnce('auto_task:<id>', { user: Rahul, month: '2026-07', points: -5, earnedYMD: '2026-07-27' })`. APP_LIVE_YMD = '2026-07-01' (backend/src/lib/appLive.js:13), to overdueDayFor :1015 ka go-live clamp lagta hi nahi — entry sach me JULY me girti hai. awardOnce :510 insert-only hai, yaani permanent.

NUMBERS: Rahul ka July +3 tha -> ab -2. carryInFor (:92-106) live compute karta hai, to carry into August = min(0, -2) = -2 — uska August net bhi 2 se gir jaata hai. leaderboard (:430-447) go-live se poora walk dobara karta hai, to July ka board AUR August ka board dono badal jaate hain. Ek July report jo band ho chuki thi, ek August ke admin action se dobara likhi gayi.

DONO DIRECTION ME INVENTION, sirf penalty nahi: agar task 2026-08-20 due ho aur Rahul 18 Aug ko Done kare, to onAssignedTaskDone :632 ab `copies.some(taskEligible)` TRUE deta hai aur :685 awardOnce use `assignedTaskOnTime` ka positive award de deta hai — wo bhi purani duniya me kabhi nahi milta. Aur August-due task par :1064-1066 ka roz -1 drip bhi chalu ho jaata hai (dueYMD >= DRIP_FLOOR '2026-08-01'). Agar naya zimmedaar due date edit kar de to rebuildOverdueForTask :741-752 saare beete din ka drip BACK-FILL kar deta hai — ek hi jhatke me -5 + har overdue din.

BINA KISI KE HAAN KE BHI HOTA HAI: Niyam 3 ke "owner-tier me sirf ek hi insaan ho -> seedha uske paas" aur "aakhri bacha candidate -> seedha uske paas" — yahan limbo hi nahi hai, deletion ke turant baad flip aur agli tick par -5.

NIYAM 1 AUR 2 SAHI ME NEUTRAL HAIN (objection ka ye hissa bhi verify kiya): Niyam 1 me child ka forwardedFrom zinda ancestor task par jaata hai aur assignedBy us task ka owner banta hai — chainEligible ka walk pehle bhi usi ancestor tak pahunchta tha, to jawab wahi. originalAssignedBy fallback bhi wahi originator hai jise walk pehle bhi padhta. Niyam 2 me tag pehle se hi :559 wala arm pass kara raha tha. Sirf Niyam 3 flip karta hai — objection ka ye diagnosis exact hai.

PEHLE SE PEHCHANA JA CHUKA KHATRA: 08e:229 ne "re-attach to the deleting actor" ko theek isi wajah se reject kiya tha ("taskEligible would flip a never-eligible chain to eligible, back-filing the -5 mark and drips into closed months"), aur 08b:798/804 me ye scenario line-by-line proved hai. 08d ka Niyam 3 wahi kaam doosre darwaze se karta hai.

KOI MAUJUDA SURAKSHA NAHI BACHATI: gate ke saare call sites (:568, :579, :632, :728, :1038, :1095, :1709) har baar LIVE derive karte hain. Sirf :1709 me assignerDeleted ka special case hai — aur wo `true` HARD-CODE karta hai aur sirf PRUNE padhta hai, writers nahi. pruneOrphanTaskEntries :1724 `keep = t && (t.status === 'DONE' || e.points < 0)` PENDING task par negative entry ko jaan-boojh kar bachata hai, to invented -5 mitega bhi nahi.

Design document me kahin nahi likha ki accept ke baad gate ka jawab freeze rahega — :186 saaf kehta hai "Accept hote hi normal chalu", aur "normal" ka matlab hi ye flip hai.

**Design me kya badle:** Design me EK clause add karo: "handover gate ka jawab BADALTA NAHI — sirf authority badalti hai."

1. STAMP (deletion ke waqt, kisi bhi delete se PEHLE — wahi ordering jo 08e ne pehle se mandatory kar di hai): departing account ke har delegated task (aur Niyam 1 se re-point hone wale har descendant) par `chainEligible(task, ownerTierIds())` ka jawab abhi compute karke Task par likh do — naya field, e.g. `gateAtHandover: Boolean` (null = kabhi handover nahi hua). Ye jawab pre-deletion duniya ka hai, kyunki links abhi tootey nahi.

2. READ (har writer, sirf prune nahi): `taskEligible` ka ASSIGNER wala arm (bonus.service.js:558) `gateAtHandover` non-null ho to `assignedBy` ki jagah stamp padhe. COLLABORATOR arm (:559) LIVE hi rahe — isse Niyam 4 ka neeche utra hua tag, aur baad me lagne wala koi bhi owner-tier tag, aaj ki tarah hi kaam karta rahega. Ye chainEligible (:568, :579), onAssignedTaskDone (:632), rebuildOverdueForTask (:728), scanOverdueTasks (:1038), backfillOverdueRuleV2 (:1095) aur pruneOrphanTaskEntries (:1709) — sab par lagu ho.

3. NATEEJA: Kalpana ka Accept `assignedBy = Kalpana` likh sakta hai (Niyam 5 ki approval authority, setStatus:314 ka submit gate, aur task.service.js:276/642/843 ke "ye personal task nahi hai" saare readings theek kaam karenge) — par taskEligible wahi jawab dega jo 10 Aug ko de raha tha. Accept se AUTHORITY milti hai, POINTS nahi.

Ye wo REJECTED "freeze flag jise sirf prune padhta hai" NAHI hai — us design ki galti hi yehi thi ki flag sirf deleter padhta tha; yahan shart hi ye hai ki har WRITER padhe. Aur pattern codebase me aadha maujood hai: :1709 pehle se `assignerDeleted ? true : chainEligible(...)` karta hai — badlaav sirf itna ki `true` maan lene ki jagah ASLI jawab handover par record ho, aur award paths bhi use padhein.

4. Ye clause Niyam 3 ke dono bina-limbo raaste par bhi lagu ho (sirf ek owner-tier insaan; aakhri bacha candidate) — wahan flip deletion ke pal me hota hai, Accept par nahi.

5. Design me ek line owner ke liye: "jo task pehle points system ke bahar tha, wo handover ke baad bhi bahar hi rahega — naye zimmedaar ke aane se na Rahul par purani penalty lagegi, na naya reward banega." Ye owner ka faisla hai aur likha hona chahiye, chhupa hua side-effect nahi.

---

## 2. [RED] Limbo ke andar task har guard ko 'personal to-do' dikhta hai — assignee use delete kar sakti hai (points mit jaate hain, kaam kisi ka nahi bachta) ya due date hata kar nightly prune se points udwa sakti hai

lens: limbo · `backend/src/services/task.service.js`:864

**Scenario:** Owner tier me teen account hain — Kalpana Sharma, Khaan Aamir, Rehan Siddiqui (roles.js:128-140 ek hi minimum rank par kai roles/log explicitly allow karta hai). Rehan 3 Aug 2026 ko Aarti Sharma ko 'Q1 TDS return' deta hai, due 2026-08-05, koi tag nahi, koi forward nahi. Task ELIGIBLE hai (taskEligible:558 — assignedBy Rehan ownerIds me hai), isliye scanOverdueTasks ne pehle hi likh diya hai: duePlus = '2026-08-06', mark overdueDayFor('2026-08-05',1) = '2026-08-07' par -5 (:1051-1054), phir :1064-1066 ka drip 08-08 se 08-12 tak 5 din x -1 = -5. Kul -10 Aarti ke August me. 12 Aug: Rehan retire hokar delete -> chain nahi, tag nahi -> Niyam 3 -> limbo, candidates Kalpana + Khaan Aamir. user.service.js:351 assignedBy null + assignerDeleted true kar deta hai. Yahan tak freeze sach me hai (prune :1691/:1709 assignerDeleted par row zinda rakhta hai, :1724 negative entry keep karta hai; scanOverdueTasks :1030 assignedBy null hone se task uthata hi nahi). 13 Aug ko Aarti apna To-Do kholti hai — aur us row par ab Delete/Edit button hai: deleteTask:864 `if (task.assignedBy && !isAssigner)` assignedBy NULL hone se skip, :867 `if (!isOwner && !isAssigner)` isOwner true hone se pass. Ek tap -> :874 task.deleteOne(), :875 onAssignedTaskUndone -> bonus.service.js:698 `PointEntry.deleteMany({ taskRef, source: {$in:['auto_task','auto_forward']} })` -> poora -10 gayab (drip bhi source 'auto_task' hi hai, :1066). Aur task ab exist hi nahi karta, isliye wo Kalpana/Khaan Aamir ke 'in par faisla chahiye' modal me kabhi nahi aayega — kaam bina kisi ko bataye gaayab. DOOSRA raasta, bina delete kiye: routes/tasks.routes.js:24 PATCH /tasks/:id har signed-in user ko khula hai, updateTask:642 `if (task.assignedBy)` skip hokar :644 `else if (!isOwner)` par isOwner true -> :842 wala personal-task branch title/notes/dueYMD seedha likh deta hai. Aarti `dueYMD: ''` bhejti hai (validators/tasks.validators.js:3,22 khaali string valid hai). Task ka createdAt 2026-08-03 hai, jo NO_DUE_FLOOR_YMD '2026-08-01' se baad me hai, to hasScorableDeadline (:548-552) FALSE -> us raat pruneOrphanTaskEntries:1716 us task ki HAR entry `dead` me daal deta hai aur :1727 hard-delete kar deta hai — wahi -10, is baar nightly job ke haath se, us window ke andar jise design 'jamee hui' kehta hai. Wapasi ka raasta bhi band: rebuildOverdueForTask:726 `!t.assignedBy` par return karta hai, aur accept ke baad bhi scanOverdueTasks:1030 ko dueYMD chahiye jo ab '' hai.

**Verifier:** Maine ise REFUTE karne ki koshish ki — dhoondha ki koi guard, koi flag, ya design ka koi clause limbo ke andar assignee ko rok raha ho. Kuch nahi mila. Ulta, frontend khud button dikha deta hai. Objection sahi hai, dono paths ke saath.

=== 1. Limbo ki shakl (design ki chuppi) ===
08d Niyam 1 explicitly `assignedBy` = surviving ancestor ka owner set karta hai (line 47-48), Niyam 2 tagged insaan par. Par **Niyam 3 ke limbo me `assignedBy` kya hoga, design me ek shabd nahi hai** — aur wahi ek rule hai jo jaan-boojh kar kai din ka window banata hai ("koi kai din tak kuch na kare → roz yaad-dehani", line 87). Code aaj kya karta hai: `user.service.js:351` — `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })`. Design isko badalne ko nahi kehta, to limbo = `assignedBy: null` + PENDING. Yahi wo exact invariant hai jise 08e ne "kabhi nahi hona chahiye" bola tha (08e §11, line 231) — aur 08d ne use uthaya nahi.

=== 2. Freeze aadha sach hai (create side band, destroy side khula) ===
Create side genuinely frozen hai, ye maine verify kiya:
- `bonus.service.js:1030` — scan ka filter `assignedBy: { $ne: null }` → limbo task uthta hi nahi, naya drip nahi banta.
- `bonus.service.js:726` — `if (!t || !t.assignedBy || ...) return;` → rebuild bhi bail.
- `bonus.service.js:1691` (`$or: [{assignedBy:{$ne:null}},{assignerDeleted:true}]`) + `:1709` (`t.assignerDeleted ? true`) + `:1724` (`e.points < 0` keep) → prune purani negative rows ko zinda rakhta hai.
Yaani "na naya banega" sach hai. **"Na kuch mitega" ka koi mechanism hai hi nahi** — aur destroy ke do raaste khule pade hain.

=== 3. Numbers (asli scenario) ===
Owner tier: Kalpana Sharma, Khaan Aamir, Rehan Siddiqui. graceDays default = 1 (`bonus.service.js:120`, `ratesOn`).
- 3 Aug 2026: Rehan → Aarti Sharma, "Q1 TDS return", due 2026-08-05, koi tag nahi, koi forward nahi. createdAt = 2026-08-03.
- Gate PASS: `taskEligible` (`:555-559`) — `ownerIds.has(assignedBy=Rehan)` true.
- duePlus = addDays('2026-08-05',1) = 2026-08-06. `overdueDayFor` (`:1013-1016`) = 2026-08-07 → **-5 mark**, month `2026-08`, dedupeKey `auto_task:<id>` (`:1051-1054`).
- Drip `:1064-1066`: 08-08 se roz -1 → 08-08…08-12 = **-5**. Kul **-10** Aarti ke August me.
- 12 Aug: Rehan delete. Chain nahi, tag nahi → **Niyam 3 → limbo**, candidates Kalpana + Khaan Aamir.

RAASTA A — assignee ek tap me task hi uda deti hai:
13 Aug ko Aarti ka To-Do khulta hai. `website/components/tasks/task-board.jsx:294`: `const canManage = assignerView || (task.owner?.id === myId && !task.assignedBy);` → `assignedBy` null hone se **canManage TRUE — Edit aur Delete button screen par aa jaate hain**. Ye API-only attack nahi, ek galti se ho jaane wala tap hai. Server bhi mana nahi karta:
- `task.service.js:864` — `if (task.assignedBy && !isAssigner)` → assignedBy null, guard skip.
- `task.service.js:867` — `if (!isOwner && !isAssigner)` → isOwner true, pass.
- `:874` `task.deleteOne()` → `:875` `onAssignedTaskUndone` → `bonus.service.js:698` `PointEntry.deleteMany({ taskRef, source: {$in:['auto_task','auto_forward']} })`. Mark aur drip **dono** ka source `auto_task` hai (`:1054`, `:1066`), to poora **-10 gayab**. Phir `:700` rebuild chalta hai par task hi nahi bacha → `:726` par return.
Nateeja: Aarti ke August me +10 ka jhootha sudhaar, aur task ka wajood khatam — wo Kalpana/Khaan Aamir ke "in par faisla chahiye" modal me **kabhi aayega hi nahi**. Kisi ko notification bhi nahi (`:883` sirf descendants ke owners ko bhejta hai). Ye seedha Niyam 3 ki likhi hui guarantee todta hai: *"Isi rule se task kabhi bina maalik ke nahi reh sakta"* (08d line 89).

RAASTA B — bina delete kiye, nightly job se:
`routes/tasks.routes.js:24` PATCH har signed-in user ko khula hai. `updateTask` me `:642` `if (task.assignedBy)` skip → `:644` `else if (!isOwner)` par isOwner true → `:842` wala personal-task branch `dueYMD` seedha likh deta hai. `validators/tasks.validators.js:3,22` — khaali string valid hai. Aarti `dueYMD: ''` bhejti hai. Ab `hasScorableDeadline` (`:548-551`): dueYMD falsy, createdAt '2026-08-03' `< '2026-08-01'` FALSE → **false**. Us raat `maybeRunDaily` (`:1773`) → `pruneOrphanTaskEntries`: task `:1691` ke `assignerDeleted:true` arm se load hota hai, `:1709` eligible=true, par `:1716-1717` `!hasScorableDeadline(t)` → **har entry `dead`**, `:1727` **hard-delete**. Wahi -10, is baar nightly job ke haath se, theek us window me jise design "jamee hui" kehta hai. Wapasi bhi band: `:726` `!t.assignedBy` par return, aur accept ke baad bhi `:1030` ko dueYMD chahiye jo ab '' hai.

=== 4. Kyun ye "purana bug" bol kar khaarij nahi ho sakta ===
(a) Design ki headline property literally yahi hai (08d line 186: "na kuch mitega, na naya banega") aur uska koi mechanism likha nahi gaya. (b) Niyam 3 khud is null-state ko **jaan-boojh kar kai din** rakhta hai — pehle ye window sirf ittefaq se banti thi, ab ye product ka feature hai. (c) Ye Niyam 5 ko bhi kaat deta hai: `:314` ka approval gate `task.assignedBy` maangta hai, to limbo me requiresApproval wala task submit hone ke bajaye seedha DONE ho jaata hai — approval shart "bani rahegi" wala waada usi window me toot jaata hai.

**Design me kya badle:** 08d me ek naya section jodo: "Limbo ke andar task DELEGATED hi rehta hai." Naya field mat banao — `assignerDeleted` pehle se model (Task.js:14) me hai aur deleteUser (user.service.js:351) pehle se set karta hai. Design ye tay kare ki "kya ye delegated kaam hai" ka test ab `task.assignedBy` nahi, balki ek helper `isDelegated(t) = !!t.assignedBy || t.assignerDeleted` hai, aur wo helper in saat jagah lagega: task.service.js:271 (isAssigner ke saath), :276 (sharedPersonal), :314 (approval gate), :498 (forwardTask), :642 (edit guard), :843 (collaborator add), :864 (delete guard) — plus frontend task-board.jsx:294 ka canManage aur :82 ka canCompleteTask.

Iska seedha asar: limbo me assignee `isAssigner=false` hoti hai, isliye :642 aur :864 dono 403 dete hain — na dueYMD clear ho sakti hai, na task delete. Aarti phir bhi kaam kar sakti hai (setStatus ka ownership check `isOwner` par hai, delegated shape usse nahi rokti), sirf mita/badal nahi sakti. Tagged colleague bhi :276 ke through use close nahi kar sakta.

Do line aur likhni hogi: (1) delete/edit ka 403 message limbo-specific ho — "ye kaam abhi handover me hai, CEO & President tier ke faisle ka intezaar hai"; (2) Accept par: `assignedBy = accepter`, `assignerDeleted = false`, phir `rebuildOverdueForTask(taskId)` chalao taaki jo din limbo me freeze the wo naye maalik ke gate ke saath dobara price ho jaayein (nahi to `:1030` ka scan sirf "aaj" ka drip likhta hai aur beech ke din maaf ho jaate hain).

Note: ye wo rejected "freeze flag jo sirf prune padhta tha" wala design NAHI hai — ulta hai. Flag prune me pehle se padha ja raha hai (:1691/:1709); jo chhoot gaya hai wo hain WRITE guards. Yahi ek addition Niyam 1/2 ke beech ke pal aur pehle se pade purane orphans, dono ko cover kar deta hai.

---

## 3. [RED] Limbo me approval gate chup-chaap gir jaata hai — Niyam 5 ka ulta: assignee khud task band kar deti hai, aur accept hote hi wo completion award mint ho jaata hai

lens: limbo · `backend/src/services/task.service.js`:314

**Scenario:** Manish Saini (Senior Manager) 3 Aug 2026 ko Rahul Yadav ko 'Andheri electrical BOQ recheck' deta hai, due 2026-08-20, requiresApproval TRUE (Manish BOQ bahar jaane se pehle khud dekhna chahta tha). 10 Aug: Manish delete -> Niyam 3 -> limbo (candidates Kalpana Sharma + Khaan Aamir), user.service.js:351 se assignedBy null. 11 Aug: Rahul 'Done' dabata hai. setStatus:314 ki shart hai `wantDone && task.requiresApproval && task.assignedBy && isOwner` — task.assignedBy NULL hone se ye poori branch skip ho jaati hai, submittedAt kabhi set nahi hota, aur :344-346 seedha status='DONE', completedAt = 11 Aug, completedBy = Rahul likh deta hai. :366 onAssignedTaskDone :619 par `!task.assignedBy` se return karta hai, to us pal koi point nahi banta — freeze theek dikhta hai. 13 Aug: Kalpana Accept dabati hai, assignedBy = Kalpana. Ab wo review kar hi nahi sakti: reviewTask:391 `awaitingApproval` maangta hai, jo Task.js:50-52 ke hisaab se `requiresApproval && status==='PENDING' && submittedAt` hai — task DONE hai aur submittedAt null hai, to 400 NOT_AWAITING. BOQ kabhi kisi ne nahi dekha. 13/14 Aug ka tick -> rescoreAllDoneAssigned (:1626): status DONE, assignedBy != null, completedAt 11 Aug 45 din ke andar, forwardedFrom null -> onAssignedTaskDone -> taskEligible Kalpana par TRUE -> hasScorableDeadline TRUE -> rawYMD '2026-08-11' vs addDays('2026-08-20', grace 1) = '2026-08-21' -> ON TIME -> Rahul ko assignedTaskOnTime (office ki configured value, 08e ke hisaab se +10) likh diya jaata hai. Bina toote hue duniya me Manish reject kar sakta tha, aur reviewTask ki reject branch (:419-430) EK BHI PointEntry nahi likhti — task wapas Rahul ke paas jaata. Wahi haal Niyam 5 ke doosre hisse ka bhi hai: agar submission delete ke waqt pehle se atki thi (status PENDING + submittedAt), to Rahul setStatus:336 se use withdraw kar sakta hai (submittedAt = null) aur phir Done dabakar :314 skip karwa kar seedha band kar sakta hai — jis submission ko design naye zimmedaar tak pahunchana chahta hai, wo uske pahunchne se pehle hi self-close ho chuki hoti hai.

**Verifier:** Maine ise refute karne ki poori koshish ki — teen escape raaste dhoonde, teenon band nikle. Objection sahi hai.

**Refute karne ki koshish 1: "shayad limbo me assignedBy null hota hi nahi."** Band. `user.service.js:351` aaj bhi `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })` likhta hai, aur design me kahin nahi likha ki ye badlega. Isse zyada — design ka LIMBO freeze **isi null par tika hua hai**: `onAssignedTaskDone` :619 `!task.assignedBy` par return karta hai, `rescoreAllDoneAssigned` :1626 `assignedBy: { $ne: null }` filter karta hai, aur `scanOverdueTasks` :1030 bhi `assignedBy: { $ne: null }` filter karta hai. Yaani "kuch nahi banega, kuch nahi mitega" ki poori guarantee assignedBy=null se hi aa rahi hai. To limbo == assignedBy null — ye strawman nahi, design ka load-bearing mechanism hai.

**Koshish 2: "shayad Rahul task dekh hi nahi paayega / Done daba hi nahi paayega."** Band. `listTasks:946` scope 'mine' = `{ owner: actor._id }` — task Rahul ka apna hai, uski list me hai. `setStatus:269` isOwner=true. :294 no-op guard PENDING→DONE par pass. :303 openChild nahi. Aur :314 ki shart `wantDone && task.requiresApproval && task.assignedBy && isOwner` me **`task.assignedBy` NULL hai → poori submit-branch skip**. Seedha :344-346 → status DONE, completedAt, completedBy=Rahul. `assignerDeleted` field yahan padha hi nahi jaata — maine poore repo me grep kiya, uske sirf 5 hits hain (schema Task.js:14, write user.service.js:351, aur teen `pruneOrphanTaskEntries` ke andar 1691/1692/1709). setStatus use kabhi nahi dekhta.

**Koshish 3: "shayad accept ke baad Kalpana phir bhi review kar legi."** Band. `reviewTask:391` `if (!task.awaitingApproval) throw 400 NOT_AWAITING`, aur `Task.js:50-52` ka virtual `requiresApproval && status==='PENDING' && submittedAt` maangta hai. Task DONE hai aur submittedAt kabhi set hua hi nahi → Kalpana 400 khaati hai. Design use approver banata hai, par code use approve/reject ka **button hi nahi deta**.

**Numbers (grace 1, onTime +10, late mark −5, drip −1):**
Manish Saini (Senior Manager) 3 Aug 2026 → Rahul Yadav, "Andheri electrical BOQ recheck", due 2026-08-20, requiresApproval TRUE. 10 Aug: Manish delete → Niyam 3 → limbo (Kalpana Sharma + Khaan Aamir candidates), assignedBy null.

- **Toote hue duniya me:** 21 Aug Rahul Done dabata hai → seedha DONE, completedAt '2026-08-21'. Limbo me kuch nahi banta (:619 return) — freeze theek dikhta hai. 23 Aug Kalpana Accept → assignedBy=Kalpana. Agle tick par `rescoreAllDoneAssigned` (:1626) use uthata hai (DONE, assignedBy≠null, completedAt 45 din ke andar, forwardedFrom null) → `onAssignedTaskDone` → taskEligible Kalpana par TRUE → hasScorableDeadline TRUE → `late = '2026-08-21' > addDays('2026-08-20',1)='2026-08-21'` → **false → ON TIME → Rahul ko +10**.
- **Bina toote duniya me (Manish reject karta):** 21 Aug submit (:314-318), 22 Aug Manish reject → :419-430 **ek bhi PointEntry nahi likhti**, task PENDING. 22 Aug ko `scanOverdueTasks`: duePlus '2026-08-21' < today → mark `overdueDayFor('2026-08-20',1)` = **'2026-08-22' par −5** (month 2026-08), phir 23 Aug se roz **−1** drip.
- **Bina toote duniya me (Manish 24 Aug ko approve karta):** completedAt '2026-08-24' → `'2026-08-24' > '2026-08-21'` → LATE → −5, filed 2026-08-22.

Yaani ek hi haqeeqat me: design ke saath **+10**, design ke bina **−5 aur roz badhta hua**. **15 point ka swing, poora invented**, aur wo bhi August month me jo accept hone tak band ho chuka ho sakta hai. Aur `rulesSeed.js:20` employees ko likhit me kehta hai "Tasks that need approval count as DONE on the day they are APPROVED, not the day you submit" — limbo me task **submit wale din** DONE ho gaya, bina kisi approval ke. Published rule seedha toota.

**Niyam 5 ka doosra hissa bhi toota:** agar delete ke waqt submission pehle se atki thi (PENDING + submittedAt), to `awaitingApproval` virtual ab bhi TRUE hai (wo assignedBy dekhta hi nahi). Rahul `setStatus(PENDING)` → :336 withdraw branch → `submittedAt = null`, phir `setStatus(DONE)` → :294 pass (status PENDING), :314 skip → DONE. Jis submission ko design "naye zimmedaar tak pahunchayenge" kehta hai, wo uske pahunchne se pehle hi khud band ho chuki hoti hai.

**Bonus (usi jad se):** :276 `const sharedPersonal = !task.assignedBy` — limbo me ye TRUE ho jaata hai, to :277 ke hisaab se ek **collaborator** bhi delegated task ko band kar sakta hai (aur `onAssignedTaskUndone` se PENDING karke uske points mita bhi sakta hai). Wahi galat sawaal, wahi galat jawaab.

Freeze khud salamat hai — mera dava sirf itna hai ki freeze **points** ko rokta hai, **faisle** ko nahi: limbo ke andar liya gaya ek irreversible faisla accept hote hi paise me badal jaata hai.

**Design me kya badle:** Sabse chhota sudhaar: design me **limbo ki paribhasha ko `assignedBy: null` se badal kar `assignedBy: null + assignerDeleted: true` ka JODA** banao, aur ek line jodo — **"delegated hai ya nahi" ka sawaal har jagah is jode se poochha jaayega, akele `assignedBy` se nahi."** Amal me sirf `setStatus` ki do shartein badalti hain:

1. `:314` — `wantDone && task.requiresApproval && (task.assignedBy || task.assignerDeleted) && isOwner && task.status !== 'DONE'` → limbo me Done dabane par task sirf **SUBMIT** hota hai (`submittedAt` set, status PENDING hi rehta hai), band nahi hota. Notification abhi kisi ko nahi jaata (koi assignedBy hai hi nahi) — bas `submittedAt` stamp ho jaata hai.
2. `:276` — `const sharedPersonal = !task.assignedBy && !task.assignerDeleted` → limbo me collaborator delegated task ko band/reopen nahi kar sakta.

Iske baad Niyam 5 ka jo hissa pehle se likha hai ("atki hui submission naye zimmedaar ko re-notify hogi") **apne aap ye case bhi cover kar leta hai** — accept ke waqt `submittedAt` set milta hai to Kalpana ko TASK_APPROVAL notification jaata hai, `awaitingApproval` TRUE hota hai, aur `reviewTask` use asli approve/reject deta hai. Koi naya niyam nahi banta.

Freeze par zero asar: task limbo me PENDING rehta hai aur `assignedBy` null hi rehta hai, to `scanOverdueTasks:1030`, `rescoreAllDoneAssigned:1626` aur `onAssignedTaskDone:619` teenon pehle jaise hi skip karte hain — na kuch banta hai, na mitta hai.

---

## 4. [RED] Accept par kuch chalta hi nahi — 'normal chalu' ka matlab hai agle daily tick ka intezaar, aur wo pass 45 din se purane completion ko chhodta hi nahi

lens: limbo · `backend/src/services/bonus.service.js`:1625

**Scenario:** Manish Saini 10 Aug 2026 ko delete hota hai; uska diya 'Vasai handover file' Rahul Yadav ke paas Niyam 3 ke limbo me chala jaata hai (candidates Kalpana Sharma + Khaan Aamir). Rahul apna kaam karta hai aur 12 Aug ko task DONE kar deta hai (limbo me onAssignedTaskDone :619 par return karta hai, to koi point nahi banta — design ke mutabik sahi). Design ka ekmatra escalation 'roz yaad-dehani' hai; do sabse vyast log roz modal band karte rehte hain. 29 Sep ko Kalpana aakhirkar Accept dabati hai — completion se 48 din baad. Ab kaun score karega? Design kehta hai 'Accept hote hi normal chalu', par accept ke waqt koi hook design me naam se likha hi nahi hai, to bharosa daily passes par hai — aur unme se ek bhi is task tak nahi pahunchta: rescoreAllDoneAssigned ka cutoff :1625 `Date.now() - 45 din` = 15 Aug hai aur filter `completedAt: { $gte: cutoff }` hai, to 12 Aug wala completion load hi nahi hota; scanOverdueTasks :1030 sirf status 'PENDING' uthata hai; backfillMonth ka task block :1428 sirf catchUpHistory se pahunchta hai, jiska watermark `bonus.historyScored` :1476 ek mahina per tick aage badhta hai aur 2026-08 ko kab ka paar kar chuka hai; rescoreAssignedTasks :1652 RESCORE_VERSION se gated hai aur waise bhi sirf forward-chain roots par chalta hai. Nateeja: Rahul ka assignedTaskOnTime (+10) kabhi likha hi nahi jaata, aur na hi kisi ko pata chalta hai. Chhote limbo me bhi award ek din late aata hai, aur us pass ke through aata hai jiska apna comment kehta hai ki wo direct-DB edits ke liye hai.

**Verifier:** CONFIRMED — aur maine severity MEDIUM se RED kar di hai, kyunki objection ne apna hi asli case under-sell kiya. Root cause wahi hai jo objection kehta hai: design "Accept hote hi normal chalu" (08d line 188) likhta hai par accept/transfer ke lamhe par **koi kaam** naam se specify nahi karta. Freeze ek-tarfa hai: lagti khud-b-khud hai, hatti kabhi nahi.

FREEZE APNE AAP LAGTI HAI (design ko lagane ki zaroorat hi nahi):
user.service.js:351 `Task.updateMany({ assignedBy: uid }, { $set: { assignedBy: null, assignerDeleted: true } })`. Limbo me assignedBy null hai, isliye har scorer khud hi ruk jaata hai — onAssignedTaskDone bonus.service.js:619 (`!task.assignedBy`), scanOverdueTasks :1030 (filter `assignedBy: { $ne: null }`), rebuildOverdueForTask :726, rescoreAllDoneAssigned :1626, backfillMonth :1428. Design ka "na kuch mitega, na naya banega" (line 186) is aadhe hisse me pehle se sach hai.

HATTI KABHI NAHI — accept par koi bhi automatic pass task tak nahi pahunchta:
- rescoreAllDoneAssigned :1625 cutoff `Date.now() - 45*24*60*60*1000`, filter :1626 `completedAt: { $gte: cutoff }`
- catchUpHistory :1466 `if (done >= target) return` + :1476 watermark ek mahina per tick aage; mahina ek baar nikla to backfillMonth :1428 us par dobara chalta hi nahi
- scanOverdueTasks :1030 sirf `status: 'PENDING'`
- rescoreAssignedTasks :1652 RESCORE_VERSION-gated aur sirf forward-chain roots (Rule 3 me chain hai hi nahi)
Ek hi manual raasta bacha hai: POST /bonus/backfill (bonus.routes.js:23, manageSettings) — koi jaanta ho tabhi.

CASE A (jo objection ne likha) — sahi hai, par tail:
10 Aug 2026 Manish Saini delete; "Vasai handover file" Rahul Yadav ke paas Rule-3 limbo me. 12 Aug Rahul DONE karta hai → :619 par return, koi entry nahi. 29 Sep Kalpana Sharma Accept dabati hai (completion se 48 din). Us din cutoff = 15 Aug, task ka completedAt 12 Aug → :1626 ke filter se bahar. historyScored ~1 Sep ko hi 2026-08 paar kar chuka. Rahul ka assignedTaskOnTime kabhi likha hi nahi jaata, aur kisi ko pata bhi nahi chalta. (Recoverable sirf manual /bonus/backfill '2026-08' se, kyunki :1428 tab assignedBy=Kalpana dekh lega.)

CASE B (objection ne miss kiya — YAHI RED banata hai) — har chhote limbo par, aur manual backfill se bhi wapas NAHI aata:
Wahi task PENDING reh jaata hai, due 5 Aug 2026, grace 0. Drip rule seeded 1 point/din (seedOverdueDripRule :1603). 6 Aug ko -5 mark, 7-10 Aug ko -1/din likha ja chuka. 10 Aug Manish delete → assignedBy null → scanOverdueTasks :1030 se task gayab. 11-20 Aug (sirf 10 din ka limbo — normal hai, 45 din ka intezaar nahi) me ek bhi drip nahi. 20 Aug Kalpana Accept karti hai; 21 Aug ka scan sirf AAJ ka din likhta hai (:1064-1066, key `auto_overdue:${t._id}:${today}`). 11-20 Aug ke 10 din ke -10 hamesha ke liye maaf. Koi backfiller nahi: backfillOverdueRuleV2 :1083 flag `overdueRuleV2` se already band, rebuildOverdueForTask kisi ne bulaya hi nahi, aur backfillMonth me overdue-drip ka block hai hi nahi (:1385-1435 me sirf late-arrival, overtime, absences, DONE tasks). Yaani Rahul ko apne assigner ke delete hone se seedha +10 ka faayda mil gaya — design ka apna buniyadi asool "kisi ke points hilne nahi chahiye" isi jagah tootta hai, aur ye tail case nahi, har Rule-3 limbo par hota hai.

REFUTE karne ki koshish ki, nahi hui: (a) "normal chalu" ka mechanical matlab sirf assignedBy set hona hai — aur wahi to un-freeze hai, uske aage kuch trigger nahi karta; (b) live hook (task.service.js:366/416) ka mauka completion ke din nikal chuka; (c) forward-chain waale Rule 1/2 me limbo nahi hai, par unme bhi chain ka root badalta hai aur koi re-score nahi hota — wahi gap, chhote paimane par.

**Design me kya badle:** 08d ke "Sabse naazuk hissa" section me freeze ke saath uska ULTA bhi likho — ek line, jo naam se hook bulaati hai:

"Un-freeze = jis lamhe task kisi ke paas LAND karta hai (Niyam 1 ka re-point, Niyam 2 ka tagged transfer, Niyam 3 ka Accept, aur Niyam 3 ka aakhri-candidate auto-transfer), naya `assignedBy` likhne ke TURANT baad, usi request me, us task ke forward-chain ROOT par scoring dobara chalao — agar root DONE hai to `onAssignedTaskDone(root)`, warna `rebuildOverdueForTask(rootId)`. Agle daily tick ka intezaar mat karo."

Kyun yahi sabse chhota fix hai:
- `rebuildOverdueForTask` (bonus.service.js:721-753) pehle se hi poora itihaas due date se dobara banata hai — :731 par purane auto_overdue mita kar, :749 par `addDays(duePlus, 2)` se aaj tak har din likhta hai. Yani limbo ke chhoote hue din apne aap bhar jaate hain; DRIP_FLOOR (:747) aur eligibility gate (:728) bhi wahi rehte hain. Koi naya code likhne ki zaroorat nahi.
- `onAssignedTaskDone` filedYMD `task.completedAt` se nikaalta hai (:647-657), isliye 48 din baad chalne par bhi award SAHI din/mahine me file hota hai — band mahine me galat rakam nahi ghusti, aur awardOnce/replace ki wajah se dobara chalana bhi harmless hai.
- Iske saath 45-din cutoff, catchUpHistory watermark, ya scanOverdueTasks — kisi ko chhedne ki zaroorat nahi.

(Optional, alag faisla: limbo par koi samay-seema — par uski zaroorat is fix ke baad nahi rehti, kyunki lamba limbo ab sirf award ko DER karta hai, khaata nahi.)

---

## 5. [RED] Niyam 3 gate ka jawab NO se YES kar deta hai — band ho chuke mahine me penalty invent hoti hai

lens: gate · `backend/src/services/bonus.service.js`:558

**Scenario:** Owner tier = {Khaan Aamir, Kalpana} (dono CEO_PRESIDENT). Manish Saini MANAGER hai — owner-tier NAHI. 08-Jul-2026: Manish 'Ranchi site measurement sheet' Junior Rahul Kumar ko assign karta hai, dueYMD 2026-07-15, koi CEO tagged nahi, forward nahi. AAJ TAK ye task points system se BAAHAR hai: scanOverdueTasks (:1030) use uthata to hai, par :1038 `chainEligible` → taskEligible(:558) me Manish ownerIds me nahi, collaborators khaali, forwardedFrom null → walk chalta hi nahi → FALSE → `continue`. Rahul par na -5 mark, na drip. July 01-Aug ko roll up ho chuka (runMonthRollup :1187), July leaderboard/report/payout final. 10-Aug: Manish delete. assignedBy=null, assignerDeleted=true (user.service.js:351). Chain nahi, tag nahi → Niyam 3 → dono owner-tier ko request. 12-Aug: Kalpana Accept karti hai → task.assignedBy = Kalpana (assignedBy set karna majboori hai: reviewTask :390, updateTask :643, setStatus :314 aur onAssignedTaskDone :619 sab isi field par khade hain — warna 'zimmedaar koi nahi' wali asli shikayat hi zinda rehti hai). Usi raat maybeRunDaily → scanOverdueTasks: assignedBy≠null ✓, PENDING ✓, dueYMD ✓, forwardedParentIds me nahi ✓, chainEligible ab TRUE (Kalpana ownerIds me hai). `marked` khaali hai (pehle kabhi eligible tha hi nahi) → :1051-1054 awardOnce, overdueDayFor('2026-07-15', grace 1) = 2026-07-17, month '2026-07', points = -assignedTaskLate (audits ki worked value -5). Rahul ke BAND ho chuke July se 5 points kat gaye, aur carryInFor (:92-106) us negative ko August, September... har mahine me compound karta hai. August-due variant aur mehenga hai: due 2026-08-03 par -5 (05-Aug ko filed) + har din -1 drip (:1064-1066, dueYMD ≥ DRIP_FLOOR). Ulti disha bhi utni hi sachi: agar Rahul time par kar deta to acceptance ke baad onAssignedTaskDone use +assignedTaskOnTime de deta — un points ke liye jo us regime me exist hi nahi karte the.

**Verifier:** Objection sahi hai. Design ka central invariant ("gate ka jawab wahi rehta hai jo pehle tha", 08d line 34) Niyam 3 me toot-ta hai, aur nateeja ek BAND ho chuke mahine me filed penalty hai.

## Pehle: kya Niyam 3 sach me `assignedBy` set karta hai? Haan — majboori hai
Design field ka naam nahi leta, par uska apna Niyam 5 (line 159) kehta hai "ab naya zimmedaar approve karega". Approve karne ka gate `task.service.js:389-390` hai — `isAssigner = task.assignedBy === actor._id`, warna 403. Aur approval-submit ka raasta `task.service.js:314` bhi `task.assignedBy` par khada hai (null hote hi Rahul ka "Done" seedha close kar deta hai, review hi nahi hoti). Aur `bonus.service.js:619` — `if (!b.enabled || !task.assignedBy) return`. Yaani agar accept `assignedBy` set NAHI karta to Niyam 5 chalta hi nahi aur "accept hote hi normal chalu" (line 187) bhi jhootha ho jaata hai. Dono taraf se: accept = `assignedBy` = accept karne wala owner-tier insaan. Escape nahi hai.

## Flip ki jagah
`taskEligible` (`bonus.service.js:555-560`) ka pehla arm: `if (task.assignedBy && ownerIds.has(String(task.assignedBy))) return true`. Niyam 3 hamesha ek owner-tier insaan ko assignedBy banata hai → ye arm hamesha TRUE. Aur Niyam 3 ki shart hi ye hai ki chain nahi + owner-tier tag nahi — yaani `chainEligible` (:567-583) pehle FALSE de raha tha (forwardedFrom null → :570 wala loop chalta hi nahi). To Niyam 3 ka bucket = theek wahi tasks jinka gate NO tha. Niyam 1/2 me flip nahi hota (Niyam 1 rishta bahaal karta hai, Niyam 2 me tag pehle se tha) — objection ne yahi kaha, aur ye sahi hai.

## Numbers (jo maine trace kiye)
Owner tier = Khaan Aamir + Kalpana. Manish Saini = MANAGER.
- 08-Jul-2026: Manish → Rahul Kumar, "Ranchi site measurement sheet", `dueYMD='2026-07-15'`, collaborators khaali, forward nahi.
- Aaj tak points se BAAHAR: `scanOverdueTasks` (:1030) task uthata hai, par :1038 `chainEligible` FALSE → `continue`. Na -5, na drip. `backfillOverdueRuleV2` bhi :1095 par wahi gate lagata hai. Rahul ke July me is task ka ek bhi entry nahi.
- 01-Aug: `runMonthRollup` (:1187) → `lastMonthRollup='2026-07'`. July band, report/payout ja chuka.
- 10-Aug: Manish delete → `user.service.js:351` `assignedBy=null, assignerDeleted=true`. **Limbo sach me freeze hai** — `scanOverdueTasks` ka filter `assignedBy: { $ne: null }` (:1030) task ko chhod deta hai, aur `pruneOrphanTaskEntries` ke paas mitane ko koi entry hai hi nahi. Yahan design theek hai.
- 12-Aug: Kalpana Accept → `assignedBy = Kalpana`.
- Usi raat `maybeRunDaily` → `scanOverdueTasks`: `assignedBy≠null` ✓, `PENDING` ✓, `dueYMD` ✓, `forwardedParentIds` me nahi ✓, `duePlus = 2026-07-16 < today` ✓, `chainEligible` ab **TRUE** (:558). `marked = PointEntry.findOne(...)` (:1045) → **null**, kyunki kabhi eligible tha hi nahi. → :1051-1054 `overdueDayFor('2026-07-15', grace 1)` (:1013) = **2026-07-17**, `month = '2026-07'`, `points = -5`.

**Rahul ke band ho chuke July se -5.** Agar uska July +18 tha to ab +13 — rupeesPerPoint 10 par ₹180 ki jagah ₹130, ek aise mahine ka jo pay ho chuka. Agar July +3 tha to ab **-2**, aur `carryInFor` (:92-106, `carry = Math.min(0, month + carry)`) us -2 ko August, September... har mahine ke net se ghataata rahega jab tak clear na ho. `leaderboard` (:428-449) aur `periodPoints` (:476) dono live padhte hain, to July ka leaderboard/report bhi retro badal jaata hai.

## August-due variant zyada mehnga (maine bhi verify kiya)
Wahi task `dueYMD='2026-08-03'`, accept 12-Aug: mark `overdueDayFor` = 2026-08-05 → -5; aur `dueYMD >= DRIP_FLOOR_YMD` (:1008) hone se :1064-1066 har din -1. Aur agar Kalpana due date chhoo bhi de — `task.service.js:792-799` → `onAssignedTaskUndone` → `rebuildOverdueForTask` (:721) — to :728 ka gate ab pass hota hai aur :749-752 **05-Aug se aaj tak ka poora drip backfill** ho jaata hai, sirf "aaj" nahi.

## Ulti disha bhi sach
Due 2026-08-20 wala wahi task, accept 12-Aug, Rahul 18-Aug ko poora karta hai → `onAssignedTaskDone` (:619 ab pass) → `+assignedTaskOnTime`. Pehle ye 0 tha. Yaani us daur ke kaam ke liye points bante hain jo us daur me exist hi nahi karte the.

## Jin raaston se refute karne ki koshish ki, aur wo kyun fail hue
1. **`assignerDeleted` bacha lega?** Nahi. Repo me uske sirf 5 hits hain — `user.service.js:351` (write), `Task.js:14` (schema), aur `bonus.service.js:1691/1692/1709`, teenon `pruneOrphanTaskEntries` ke andar. `scanOverdueTasks` (:1038) aur award path (:632) use padhte hi nahi. Aur prune sirf **mitata** hai, banata nahi — aur :1724 `keep = t.status==='DONE' || e.points < 0` ke chalte ye -5 wahin **bacha bhi rehta** hai.
2. **Mark par koi August floor?** Nahi — :1005-1007 ka comment saaf hai: drip ka floor hai, "-5 mark has NO floor... whatever its due month". `overdueDayFor` sirf `APP_LIVE_YMD='2026-07-01'` (`lib/appLive.js:13`) tak clamp karta hai, 2026-07-17 usse upar hai.
3. **Kya limbo freeze ise cover karta hai?** Nahi — design khud kehta hai "Accept hote hi normal chalu" (line 187). Nuksaan limbo ke BAAD hota hai, uske andar nahi.
4. **Kya Niyam 3 ka bucket asal me khaali hai?** Nahi — koi bhi non-owner manager ka seedha assignment jisme CEO tagged nahi, isi bucket me hai; ye sabse aam shakl hai.

Ek baat objection ki thodi narm karni chahiye: `carryInFor` compounding tabhi hota hai jab July ka net negative ho jaaye; positive July me sirf July ka aankda aur payout badalta hai. Par wo bhi ek band, report ho chuke mahine ka aankda hai — RED bana rehta hai.

**Design me kya badle:** **Sabse chhota fix: delete ke waqt gate ka jawab task par JAMA do, aur gate usi ko maane.**

`deleteUser` me — `assignedBy` null karne se PEHLE aur `Task.deleteMany({ owner: uid })` (user.service.js:337) se pehle (design ka apna Implementation note #1 yahi kehta hai) — har affected task par uska **abhi ka** `chainEligible(...)` jawab stamp karo:

- Task.js me naya tri-state field: `pointsGateFrozen: { type: Boolean, default: null }` (null = purane/anchhue tasks, aaj jaisa behaviour — koi migration nahi).
- `taskEligible` (bonus.service.js:555) ki pehli do line: `if (task.pointsGateFrozen === false) return false; if (task.pointsGateFrozen === true) return true;`
- `chainEligible` (:567) ki pehli line: `if (task.pointsGateFrozen === false) return false;` — taaki koi bhi walk stamp ke around se raasta na nikaal sake. Dono jagah ka select list me field add karna hoga (:575, :591, :725, :1030, :1090, :1692).

Isse: Niyam 3 ka Accept sirf **zimmedaari** deta hai (chase, approve, close — jo asli shikayat thi), gate ka jawab nahi badalta. Jo task pehle points se baahar tha wo baahar hi rehta hai — na retro -5, na retro +5. Aur ye design ke apne governing idea ("gate ka jawab wahi rehta hai jo pehle tha") ko implicit assumption se **explicit invariant** bana deta hai, isliye Niyam 1 (stamp `true` → wahi jawab), Niyam 2 (tag tha → `true`) aur Niyam 4 (tag neeche utaarna) sab isi ke saath consistent rehte hain — koi extra niyam nahi.

Note: ye wo rejected "freeze flag jise sirf prune padhta hai" wala design NAHI hai — ye stamp gate ke andar baithta hai, isliye ise **saare** writers padhte hain: onAssignedTaskDone (:632), rebuildOverdueForTask (:728), scanOverdueTasks (:1038), backfillOverdueRuleV2 (:1095), pruneOrphanTaskEntries (:1709).

---

## 6. [RED] Niyam 1 ka 'upar koi zinda task nahi' fallback: forwardedFrom dangling chhodne se poori bachi hui chain kabhi pay nahi hoti

lens: gate · `backend/src/services/bonus.service.js`:621

**Scenario:** Owner tier = {Khaan Aamir}. 20-Jul-2026: Khaan Aamir 'Ranchi site drawings' (due 2026-08-20, grace 1) Manager Manish Saini ko deta hai → T1 {owner: Manish, assignedBy: Khaan, forwardedFrom: null}. 22-Jul: Manish Junior Rahul ko forward karta hai → T2 {owner: Rahul, assignedBy: Manish, forwardedFrom: T1, originalAssignedBy: Khaan} (task.service.js:529). 10-Aug: Manish delete — user.service.js:337 `Task.deleteMany({owner: uid})` T1 ko uda deta hai. Niyam 1 ka walk: T2.forwardedFrom = T1, T1 mar chuka → koi zinda ancestor nahi → fallback: T2.assignedBy = originalAssignedBy = Khaan Aamir. Design forwardedFrom ke baare me is branch me KUCH NAHI kehta, aur Niyam 1 ki headline hai 'clear mat karo, re-point karo' → implementer T2.forwardedFrom ko mite hue T1 par hi chhod dega. Gate test pass ho jaata hai (taskEligible(T2): Khaan ownerIds me → TRUE) — par paisa gate se nahi nikalta. 18-Aug (on time, cutoff 21-Aug): Rahul Done karta hai → setStatus :344-349 DONE, :366 onAssignedTaskDone(T2) → bonus.service.js:621 `if (task.forwardedFrom) return;` → TURANT return, kuch likha hi nahi jaata. Phir :375 settleParent(T2) → task.service.js:560 `Task.findById(T2.forwardedFrom)` = null → :561 return. Rahul ko ZERO. Delete se pehle yahi delivery Rahul ko +10 (assignedTaskOnTime) aur Manish ko +3 (forwardOnTime) deti — settleParent T1 band karta aur onAssignedTaskDone(T1) poore tree ko pay karta (:659-694). Aur meter ulta chalta rehta hai: T2 par koi child point nahi karta isliye wo forwardedParentIds (:1029) me nahi hai → scanOverdueTasks use uthata hai, chainEligible TRUE, to 21-Aug ke baad -5 mark (:1051-1054) aur roz -1 drip lagte rehte hain — aur onAssignedTaskDone kabhi chalta hi nahi, isliye completion ka `replace: true` result (:685-693) us -5 ko kabhi supersede nahi karta. Recovery ka koi raasta nahi: rescoreAllDoneAssigned :1626 aur backfillMonth :1428 dono `forwardedFrom: null` filter karte hain, rescoreAssignedTasks :1653 sirf forward-chain roots dekhta hai, aur rebuildOverdueForTask :726 `t.forwardedFrom` par early-return karta hai. 3-level me aur bura: CEO → Manish(T1) → A(T2) → Rahul(T3) me Manish delete hone par T2 par yehi fallback lagta hai; Rahul ke finish karne par settleParent T2 ko DONE karta hai aur onAssignedTaskDone(T2) :621 par return — A ka +3 aur Rahul ka +10 dono kabhi nahi likhe jaate.

**Verifier:** CONFIRMED — objection sahi hai, aur maine mechanically verify kiya ki bachne ka koi raasta nahi hai.

**Design me gap asli hai.** `08d-handover-design.md:47-56` ka warning box bina kisi shart ke kehta hai "chain ka link **todo mat**… clear mat karo", aur phir `:61-63` wali no-ancestor fallback lines SIRF `assignedBy` ke baare me baat karti hain — `forwardedFrom` ka zikr us branch me ek baar bhi nahi. Yani likhe hue design ko literally follow karne wala implementer T2.forwardedFrom ko mite hue T1 par hi chhod dega. Ye ambiguity nahi, chook hai: jis branch me definition se koi surviving ancestor hai hi nahi, wahan "re-point karo, clear mat karo" ka koi target hi nahi bachta.

**PointEntry ke saare writers mechanically enumerate kiye** (grep `source: 'auto_task'|'auto_forward'`): positive completion award SIRF ek jagah likha jaata hai — `bonus.service.js:685` `awardOnce(...)` inside `onAssignedTaskDone`. Aur us function ka pehla guard `bonus.service.js:621` `if (task.forwardedFrom) return;` hai. Matlab: **jis task par forwardedFrom truthy hai (chahe wo kisi mit chuke doc ko point kar raha ho), us par kabhi ek bhi reward entry nahi likhi ja sakti.** Baaki chaar writers (`:743`, `:751`, `:1054`, `:1066`, `:1107`) sab penalty hain.

**Scenario (owner-tier = {Khaan Aamir}, assignedTaskOnTime = 10, forwardOnTime = 3 — seeded default `bonus.service.js:1581`):**
- 20-Jul-2026 Khaan → Manish Saini: T1 {owner: Manish, assignedBy: Khaan, forwardedFrom: null}, due 2026-08-20, grace 1.
- 22-Jul Manish → Rahul: `task.service.js:522-532` T2 {owner: Rahul, assignedBy: Manish, forwardedFrom: T1, originalAssignedBy: Khaan (`:529`)}.
- 10-Aug Manish delete: `user.service.js:337` `Task.deleteMany({ owner: uid })` T1 uda deta hai.
- Niyam 1 walk: T2.forwardedFrom → T1 dead → koi zinda ancestor nahi → fallback T2.assignedBy = Khaan, **forwardedFrom dangling**.
- 18-Aug (on time) Rahul Done: `task.service.js:344-349` DONE → `:366` `onAssignedTaskDone(T2)` → `bonus.service.js:621` turant return → `:375` `settleParent(T2)` → `task.service.js:560` `findById(T2.forwardedFrom)` = null → `:561` return.
- **Rahul: 0. Delete se pehle yahi delivery Rahul ko +10 deti** (T1 settle hota, `onAssignedTaskDone(T1)`: copies = [T1, T2], gate `taskEligible(T1)` → Khaan → TRUE, forwarderIds = {T1}, Rahul leaf → assignedTaskOnTime).

**Gate ka jawab preserve, phir bhi zero** — yahi objection ka core hai aur ye bilkul sahi hai. `taskEligible(T2, ownerIds)` `bonus.service.js:558` TRUE deta hai, par paisa gate se nahi, `:621` ke aage se nikalta hai.

**Asymmetry bhi confirm:** agar T2 21-Aug tak pending rahe to `scanOverdueTasks` use uthata hai — `:1030` ka filter `_id: {$nin: forwardedParentIds}` hai (T2 leaf hai, isliye included), aur `:1038` `chainEligible(T2)` apne hi assignedBy=Khaan se TRUE → `:1054` -5 mark + `:1066` roz -1 drip. Penalty poori chalti hai, reward kabhi nahi.

**Recovery kahin nahi:** `rescoreAllDoneAssigned` `:1626` `forwardedFrom: null` filter, `backfillMonth` `:1428` `forwardedFrom: null` filter, `rescoreAssignedTasks` `:1653-1655` sirf `forwardedFrom: null` roots, `rebuildOverdueForTask` `:726` `t.forwardedFrom` par early return. Ek bhi daily/backfill pass is task ko chhoo nahi sakta — **nuksaan permanent hai.**

**3-level bhi confirm:** CEO → Manish(T1 root) → A(T2) → Rahul(T3). Manish delete → T2 ko fallback milta hai (T2.forwardedFrom = dead T1). Rahul T3 finish → `settleParent(T3)` T2 ko DONE karta hai (`task.service.js:595-599`) → `onAssignedTaskDone(T2)` `:621` par return → **A ka +3 aur Rahul ka +10 dono kabhi nahi likhe jaate**, aur `settleParent(T2)` bhi null parent par mar jaata hai.

**Objection ka ek over-claim maine correct kiya** (parent ise copy na kare): "DONE hone ke baad bhi -5 aur drip lagte rehte hain" GALAT hai — `scanOverdueTasks` `:1030` me `status: 'PENDING'` filter hai, DONE task uthta hi nahi. Sahi form ye hai: agar task cutoff par pending raha to -5 lag jaata hai, aur baad me finish hone par `replace: true` (`:693`) us -5 ko kabhi supersede nahi karta kyunki `onAssignedTaskDone` chalta hi nahi. Late-finish me number wahi (-5) rehta hai; **asli, saaf nuksaan on-time finish me hai: +10 → 0 aur +3 → 0.**

Fix se koi naya point invent nahi hota: agar T2 ki eligibility mare hue T1 ke TAG se aa rahi thi to Niyam 4 wo tag pehle hi neeche utaar deta hai; agar T1.assignedBy owner-tier nahi tha to originalAssignedBy bhi wahi non-owner hai → gate ab bhi FALSE. Aur survivors ke numbers delete-se-pehle ke bilkul barabar rehte hain (3-level: A +3, Rahul +10 — sirf Manish ka +3 jaata hai, jiska account hi nahi bacha).

**Design me kya badle:** Niyam 1 ke warning box ko shart ke saath baandho, aur fallback branch me ek line jodo (do jagah, kul teen line ka change):

1. `08d:47-56` warning box me: "**forwardedFrom clear mat karo** — ye niyam SIRF tab lagta hai jab upar ek ZINDA ancestor task mila ho."

2. `08d:61-63` (no-surviving-ancestor branch) ko is tarah likho:
   "Agar upar koi ZINDA task hi na bache, to us copy ke upar chain bachi hi nahi — wo ab khud ROOT hai. Isliye teeno kaam ek saath karo:
   - `forwardedFrom = null` (**yahan clear karna ZAROORI hai** — mit chuke task ki taraf ishara chhod dena `onAssignedTaskDone` ke pehle guard par hamesha return kara dega, yani us branch ka koi reward kabhi nahi milega, jabki penalty chalti rahegi)
   - `assignedBy = originalAssignedBy`
   - Niyam 4 ka owner-tier tag neeche utaaro (gate ka jawab wahi rakhne ke liye)"

3. Implementation notes me ek acceptance test add karo: "2-level (root deleted) aur 3-level (middle deleted) — dono me chain finish hone par survivors ko delete-se-pehle wale bilkul same points milne chahiye (3-level: forwarder +3, doer +10); zero milna = fail."

---

## 7. [RED] Fallback ka originalAssignedBy khud ek mite hue account par point kar sakta hai — approval-gated kaam hamesha ke liye atak jaata hai aur roz drip khaata hai

lens: gate · `backend/src/services/user.service.js`:346

**Scenario:** deleteUser ka detach block (user.service.js:346-358) `Task.updateMany({assignedBy: uid})`, LeaveRequest.decidedBy, Attendance.excusedBy, User.reportsTo/createdBy/taskAssign.users — sab detach karta hai, par `Task.originalAssignedBy` ko KABHI nahi chhoota. Yani ek delete ke baad hi chain par dead id baith jaati hai. Scenario: Owner tier = {Khaan Aamir}. 10-Jun-2026: Director Farah Khan 'Insurance renewal' (due 2026-08-20, requiresApproval) Manager Priyanshi Patel ko deti hai → R {owner: Priyanshi, assignedBy: Farah, collaborators: [Khaan]}. 12-Jun: Priyanshi Rahul ko forward karti hai, approval ON → C {owner: Rahul, assignedBy: Priyanshi, forwardedFrom: R, originalAssignedBy: Farah} (task.service.js:529). 01-Jul: Farah delete — R.assignedBy=null/assignerDeleted (user.service.js:351), par C.originalAssignedBy abhi bhi Farah ki dead id hai. (R khud Niyam 2 se Khaan ko chala jaata hai, wo hissa theek hai.) 05-Aug: Priyanshi delete — :337 R ko uda deta hai. Niyam 1: koi zinda ancestor nahi → fallback → C.assignedBy = C.originalAssignedBy = FARAH KI MIT CHUKI ID. Design me liveness check sirf ancestor-owner wale raaste par likha hai ('agar Manager A khud deactivated ho to aur upar chalo'); fallback par koi check nahi. Nateeja: 20-Aug ko Rahul kaam khatam karke Done dabata hai → setStatus :314 (task.assignedBy truthy hai, bas wo bhoot hai) → submittedAt set, notify(user: dead id) — aisa notification jo kabhi kisi ko nahi dikhta. reviewTask :389-390 `assignedBy === actor._id` maangta hai, aur wo id kisi ke paas nahi hai → task KABHI approve nahi ho sakta. Wo PENDING+submitted pada rehta hai, isliye scanOverdueTasks (:1030, aur :1026-1028 ka comment saaf kehta hai ki approval-gated task approve hone tak unfinished hai) roz -1 drip likhta rehta hai, aur chainEligible TRUE hai (Niyam 4 ne Khaan ka tag C par utaar diya). 30 din = -30, aur ye kabhi rukta nahi. Rahul task delete bhi nahi kar sakta (task.service.js:864 ASSIGNED_TASK), aur screen par 'assigned by' khaali dikhta hai kyunki populated() ka populate dead ref par null deta hai.

**Verifier:** Objection sahi hai, aur code se poori tarah provable — balki objection se thoda ZYADA bura hai (ek hi deletion se bhi ho jaata hai).

**1. `originalAssignedBy` kabhi bhi ek zinda/active insaan hone ki guarantee nahi rakhta.**
- Likha kahan jaata hai: `backend/src/services/task.service.js:529` — `originalAssignedBy: parent.originalAssignedBy || parent.assignedBy || null`. Yaani ye ROOT ka assigner hai — jis kisi ke paas `taskAssign` access hai (Director, Manager, koi bhi), **CEO hona zaroori nahi**. `createTask` (`task.service.js:170-180`) ise set hi nahi karta, to depth-2 chain me ye seedha root-assigner ban jaata hai.
- Design line 61-63 me likha "`originalAssignedBy` pehle se likha hota hai (**= CEO**)" — ye sirf design ke apne 2-level CEO-rooted example me sach hai. General case me galat hai.
- Detach kahin nahi hota: `user.service.js:346-358` ka poora detach block — `Task.assignedBy`, `LeaveRequest.decidedBy`, `Regularization.decidedBy`, `Attendance.excusedBy`, `User.reportsTo/createdBy/taskAssign.users` — **`Task.originalAssignedBy` ko chhoota hi nahi** (grep se confirm: poore repo me use likhne wali sirf ek jagah hai, `task.service.js:529`).
- Deactivate bhi kuch nahi karta: `user.service.js:193-200` sirf `user.isActive` badalta hai, tasks ko haath nahi lagata. Aur `middleware/auth.js:35` inactive user ko 401 deta hai — yaani deactivated assigner **login hi nahi kar sakta**, approve to door ki baat.

**2. Design me fallback par koi liveness check hai hi nahi.** Liveness ka zikr sirf ancestor-owner waale raaste par hai (line 58: "Agar Manager A khud deactivated ho: aur upar chalo"). Line 61-63 ka fallback bina kisi check ke `originalAssignedBy` ko `assignedBy` bana deta hai. Rule 2 ka safe-fallback (line 72-74) sirf TAG target ke liye hai, is raaste ke liye nahi.

**3. Scenario, asli numbers ke saath** (Setting default `graceDays: 1` — `backend/src/models/Setting.js:73`; drip seed 1 point — `bonus.service.js:1603`; mark = `assignedTaskLate`, comments me -5):
- 10-Jun-2026: Director **Farah Khan** → Manager **Priyanshi Patel**, "Insurance renewal", due **2026-08-20**, requiresApproval ON, tagged **Khaan Aamir** (owner-tier). → R {owner: Priyanshi, assignedBy: Farah, collaborators: [Khaan]}.
- 12-Jun: Priyanshi → **Rahul** forward, approval ON. `task.service.js:522-532` → C {owner: Rahul, assignedBy: Priyanshi, forwardedFrom: R, **originalAssignedBy: Farah**}.
- 01-Jul: Farah deactivate + delete. R Rule 2 se Khaan ko chala jaata hai (wo hissa theek hai), par **C.originalAssignedBy ab bhi Farah ki mit chuki id hai** — design me descendants ka `originalAssignedBy` repair karne ka koi niyam nahi.
- 05-Aug: Priyanshi delete. `user.service.js:337` `Task.deleteMany({owner: uid})` R ko uda deta hai. Rule 1: C ka koi zinda ancestor task nahi (R.forwardedFrom = null) → **fallback → C.assignedBy = Farah ki dead id**.
- Sirf ek deletion se bhi wahi: Farah ko sirf **deactivate** kiya jaaye (delete zaroori bhi nahi — `user.service.js:325-327` waise bhi pehle deactivate maangta hai) aur Priyanshi delete ho → fallback ek **deactivated** Farah par baith jaata hai, jo `auth.js:35` ki wajah se kabhi login hi nahi kar sakta. Nateeja bilkul same.

**4. Nateeja — kaam permanently strand, aur points anant tak minus:**
- `setStatus:314` — `task.assignedBy` truthy hai (bhoot id), to 20-Aug ko Rahul "Done" dabaye to sirf `submittedAt` set hota hai; `notify({user: <dead id>})` ek aisi notification banata hai jo kisi ko nahi dikhti (`Notification.js:34-44` koi existence check nahi karta). Task DONE **kabhi nahi** ho sakta.
- `reviewTask:389-390` — `String(task.assignedBy) === String(actor._id)` chahiye; wo id kisi ke paas nahi. Approve **asambhav**.
- `updateTask:642-646` — delegated task sirf assigner edit kar sakta hai → koi `requiresApproval` OFF nahi kar sakta, na due date badal sakta, na reassign. `deleteTask:864-866` — koi delete bhi nahi kar sakta. `routes/tasks.routes.js` me koi leadership/admin override route hai hi nahi.
- Dobara detach bhi nahi hoga: `user.service.js:351` ka `updateMany({assignedBy: uid})` sirf tab chalta hai jab uss uid ko delete kiya jaaye — Farah to already delete ho chuki hai.
- **Drip:** `scanOverdueTasks` (`bonus.service.js:1030`) query `{assignedBy: {$ne: null}, status: 'PENDING', dueYMD non-empty}` — C teeno pass karta hai (:1026-1028 ka comment saaf kehta hai ki approval-gated task approve hone tak unfinished hai). `chainEligible` TRUE hai kyunki Niyam 4 ne Khaan ka tag C par utaar diya → `taskEligible` :559 collaborators arm pass. duePlus = 2026-08-21, mark day = `overdueDayFor` (:1013-1016) = **2026-08-22 → −5, month 2026-08**; drip `today > addDays(duePlus,1)` → **2026-08-23 se −1 roz**. 30-Sep tak 39 drips = **−39**, kul **−44**; 31-Dec tak lagbhag **−135**; aur ye **kabhi rukta nahi**.
- Jabki sahi nateeja **+assignedTaskOnTime** tha — Rahul ne due date par hi (20-Aug) submit kiya tha.
- `pruneOrphanTaskEntries:1716-1725` bhi inhe nahi hataata: entry negative hai aur task PENDING hai → `keep` true.
- Screen par: `populated()` (`task.service.js:234-241`) dead ref par `assignedBy: null` deta hai → Rahul ko "assigned by" khaali dikhega, aur design ka "kisi ko kaam chupchaap nahi milega" wala informational modal **kisi ko nahi** jaayega (receiver hi maujood nahi).

Yaani: LIMBO window theek hai, par uske BAAD design khud ek aisi state bana deti hai jisme kaam hamesha ke liye atak jaata hai aur ek zinda employee ke points anant tak kat-te rehte hain.

**Design me kya badle:** Niyam 1 ka fallback ek "seedhi line" ki jagah ek **ladder** ban jaaye, aur har step par shart ho: *"wo account abhi bhi maujood hai AUR `isActive === true` hai"*. Fallback kabhi bhi ek kachchi id par khatam na ho.

1. Nazdeeki **zinda ancestor task** ka owner (aaj wala niyam, deactivated hone par upar chalne waala walk sameet).
2. **Mit rahe parent ka apna `assignedBy`**, delete se PEHLE padha hua (design ka Implementation-note 1 waise bhi "pehle padho, phir mitao" kehta hai). Upar wale scenario me ye **Khaan Aamir** hai — wahi jise Niyam 2 ne 01-Jul ko R diya tha. Ye design ki apni buniyadi soch hai: *naya insaan mat do, jo rishta pehle se tha wahi wapas jodo*.
3. `originalAssignedBy` — **sirf tab** jab wo account abhi maujood aur active ho.
4. Warna **Niyam 2/3 me gir jao**: owner-tier tag ho to us insaan ko, warna owner-tier request flow. Yahi guarantee deta hai ki ant hamesha ek zinda insaan par ho.

Saath me design se ye do line theek karni hongi:
- Line 61-63 ka "(**= CEO**)" hataana — `originalAssignedBy` root ka assigner hai (`task.service.js:529`), owner-tier hona zaroori nahi.
- Step 2/3/4 par bhi wahi "ye kaam ab aapke paas hain" wala informational modal chale, jo Niyam 1 ke normal raaste par chalta hai.

---

## 8. [RED] Faisle ka intezaar wali halat 'frozen' nahi hai — us dauran task ka apna assignee hi uska maalik ban jaata hai

lens: gate · `backend/src/services/task.service.js`:864

**Scenario:** Niyam 3 me delete se acceptance tak task ki halat wahi hai jo deleteUser chhod kar jaata hai: assignedBy=null, assignerDeleted=true (user.service.js:351). Poora app `assignedBy == null` ko 'ye iska apna personal to-do hai' padhta hai. Scenario: Manish Saini (Manager) ne Rahul ko 'Vendor quotation follow-up', due 2026-08-14, diya. 10-Aug ko Manish delete — Niyam 3, do owner-tier candidates, roz reminder, faisla 5 din latakta hai. Un 5 dino me: (a) DELETE — task.service.js:860-867: `if (task.assignedBy && !isAssigner)` (864) ab fire hi nahi karta kyunki assignedBy null hai, aur 867 par isOwner TRUE hai → Rahul apna assigned task KHUD delete kar sakta hai, uski forward chain samet (:872-886), aur notify sirf `ownerId !== actor` par jaata hai (:883) — yani kisi ko bataya bhi nahi jaata. Jis task par Kalpana aur Khaan Aamir ka faisla maanga ja raha tha, wo modal me ek mari hui id ban jaata hai. (b) DUE DATE — updateTask ka assigner-guard (:642-646) `task.assignedBy` falsy dekh kar skip ho jaata hai aur control :842 wali personal branch me chala jaata hai, jahan dueYMD contentFields me hai → Rahul 2026-08-14 ko 2026-12-31 kar deta hai. 15-Aug ko Kalpana Accept karti hai; ab gate ON ho jaata hai (upar wali finding) aur scanOverdueTasks usi NAYI due date par judge karta hai — -5 mark aur har din ka -1 dono gayab. (c) :843 use collaborators add karne bhi deta hai, aur setStatus ka `sharedPersonal = !task.assignedBy` (:276-277) tab tagged kisi bhi colleague ko task DONE/PENDING toggle karne ki ijazat de deta hai — aur PENDING toggle onAssignedTaskUndone (:367) chala kar us task ke saare auto_task/auto_forward entries hard-delete kar deta hai (bonus.service.js:698), jise rebuildOverdueForTask :726 (`!t.assignedBy`) wapas nahi bana sakta.

**Verifier:** Maine ise refute karne ki teen koshish ki aur teeno fail hui.

**Refute #1 — "design limbo ko define karta hai."** Nahi. `08d-handover-design.md` ka poora "Sabse naazuk hissa" section sirf ek line hai (line 186): "jab tak faisla nahi hota, points ki halat jamee rahegi". Ye sirf PointEntry ke baare me hai; task row ki state, uske edit/delete/close ke haq — kuch bhi define nahi. Niyam 1 (line 47-48) `assignedBy` re-point karta hai, isliye chain case ka null state khatam ho jaata hai; Niyam 2 turant transfer hai. **Sirf Niyam 3 me intezaar hota hai**, aur wahan row wahi rehti hai jo `deleteUser` chhodta hai: `{assignedBy: null, assignerDeleted: true}` (user.service.js:351). `assignerDeleted` ko poore backend me sirf `pruneOrphanTaskEntries` padhta hai (bonus.service.js:1691, 1709) — baaki har gate `task.assignedBy` hi poochta hai.

**Refute #2 — "ye 08e #16 wala purana bug hai, naya design isse bigadta nahi."** Do wajah se nahi chalta. (a) 08d ne 08e #16 ka remedy adopt hi nahi kiya — document me `wasDelegated` jaisa koi predicate nahi hai, "Sthiti" list me sirf Niyam 1 ka sudhaar darj hai. (b) Objection ka load-bearing point sach hai: aaj orphan task hamesha ke liye points system se BAHAR rehta hai (`onAssignedTaskDone` :619 aur `scanOverdueTasks` :1030 dono `assignedBy` maangte hain), isliye window me kiya gaya edit points-neutral hai. Niyam 3 ka Accept `assignedBy` ko ek owner-tier insaan par set karta hai (Niyam 5 ise majboori banata hai — `reviewTask:389-390` ke bina koi approver ho hi nahi sakta), yani `taskEligible` (:558) pehli baar TRUE hota hai. Window ke andar likhi hui state accept ke baad seedha points me convert hoti hai.

**Refute #3 — "ye sirf API-craft se hoga."** Nahi. Frontend wahi predicate padhta hai: `task-board.jsx:987` (`canMgr = t.owner?.id === user?.id && !t.assignedBy`), `:294`, `:82`; aur `task-dialog.jsx:90, 99` body me `dueYMD` + `collaborators` bhejta hai. Yani Edit/Delete button apne aap ug aate hain.

**Code, line by line (sab verify kiya):**
- `deleteTask` task.service.js:864 `if (task.assignedBy && !isAssigner)` — assignedBy null → fire nahi; :867 `if (!isOwner && !isAssigner)` — isOwner TRUE → pass. Assignee apna assigned task delete kar sakta hai, chain samet (:872, :877-886). Task par apne aap koi notification nahi jaata (:883 sirf descendants par, wahan bhi `ownerId !== actor`), to Kalpana/Khaan Aamir ke pending faisle ki id chupchaap mar jaati hai.
- `updateTask` :642-646 — `task.assignedBy` falsy → assigner-guard skip, control :842 wali personal branch me. `contentFields` (:648) me `dueYMD` hai, aur is branch me koi bonus hook nahi (hooks sirf :792-801 me, isAssigner branch me). :843 collaborators add karne bhi deta hai.
- `setStatus` :276-277 `sharedPersonal = !task.assignedBy` → koi bhi tagged colleague DONE/PENDING kar sakta hai; :314 ka approval gate `task.assignedBy` maangta hai → skip; :352 notify bhi skip; :367 `onAssignedTaskUndone` → bonus.service.js:698 bina kisi guard ke `PointEntry.deleteMany({taskRef, source:{$in:['auto_task','auto_forward']}})`, aur `rebuildOverdueForTask` :726 (`!t.assignedBy`) wapas nahi bana sakta.

**Scenario A — approval bypass + invented points (koi exotic assumption nahi):** rates: onTime +5, late −5, drip −1 (seed :1603), graceDays 1 (Setting.js:73). 1 Aug 2026 Manish Saini (Manager) → Rahul Sharma, "Vendor quotation follow-up", due 2026-08-14, requiresApproval TRUE. Gate OFF (Manish owner-tier nahi, koi tag nahi) → 0 entries. 10 Aug Manish delete → Niyam 3, do candidates, limbo. 11 Aug Rahul "Done" dabata hai → :314 skip → :344 seedha DONE, completedBy Rahul, kisi ko notify nahi. 15 Aug Kalpana Accept → assignedBy = Kalpana. Agle daily tick par `rescoreAllDoneAssigned` (:1626 — status DONE, assignedBy≠null, completedAt 45 din ke andar, forwardedFrom null) → `onAssignedTaskDone` → eligible → late? 08-11 vs 08-14+1 → nahi → **+5 Rahul ko, month 2026-08**. Jis kaam par approval maangi gayi thi wo bina kisi review ke band bhi hua aur points bhi de gaya. Niyam 5 window ke andar hi mar chuka hai.

**Scenario B — apni deadline khud likhna (44 points ka swing):** wahi task, approval ke bina. 11 Aug Rahul Edit dialog se dueYMD 2026-08-14 → 2026-12-31. 15 Aug Kalpana Accept. Sachchai ke hisaab se: 2026-08-16 par −5 mark (`overdueDayFor` :1013), 08-17 se roz −1 (:1064); 20 Sep ko done → late (:652) → −5 late result + 34 drips (08-17…09-19) = **−39**, aur Aug ka deficit `carryInFor` (:92) se Sep me compound. Chhedi hui state me: duePlus = 2027-01-01 → :1035 `continue` → na mark na drip; 20 Sep ko on-time → **+5**. Ek task par 44 points ka farq, jise koi bhi baad ka pass theek nahi karta (daily scan sirf AAJ ka drip likhta hai, :1064).

**Scenario C — window ke andar PointEntry ka hard-delete (jitna deserve karta hai utna hi weight):** ye tab bite karta hai jab limbo task par pehle se entries hon. Do reachable shapes: (i) Rahul ne aage forward kiya tha aur child par owner-tier tag hai (`updateTask:736` se child par tag lag sakta hai; `forwardTask` :522-532 collaborators copy nahi karta) — deleteTask ka cascade (:877-886) child ki −5 + drips uda deta hai; (ii) jaane wala khud owner-tier ho — design khud line 72-73 par kehta hai ki aisa hua to Niyam 3 chalega, aur us task par entries pehle se hoti hain. Agar assigner non-owner tha aur koi tag nahi, to entries hoti hi nahi — ye sub-claim wahan vacuous hai, par (a) aur (b) us par nirbhar nahi.

Net: limbo "frozen" nahi hai. Window ke andar task ka apna assignee uska maalik hai — delete kar sakta hai, deadline khud likh sakta hai, approval bypass kar sakta hai, aur naye colleague tag karke unhe DONE/PENDING toggle de sakta hai. Accept ke baad gate ON hone se ye sab points me convert hota hai. Design ki sabse badi declared property isi se toot jaati hai.

**Design me kya badle:** Design me ek predicate define karo aur bas — koi naya field nahi, koi arbitrary successor nahi:

`wasDelegated(task) = !!task.assignedBy || task.assignerDeleted`

Aur likh do ki **har delegation gate isi se poochha jaayega, `assignedBy` se nahi**: task.service.js:271 & :276 (isAssigner / sharedPersonal), :314 (approval gate), :642 aur :843 (updateTask), :864 (deleteTask), :498 (forwardTask), :453 (markSeen), plus frontend mirrors task-board.jsx:82, :294, :987.

Isse limbo sach me freeze ho jaata hai: assignee na dueYMD/title/notes badal sakta hai, na task delete kar sakta hai, na khud approval bypass kar sakta hai, na naye collaborators tag kar sakta hai; aur koi tagged colleague DONE/PENDING toggle nahi kar sakta — yani `onAssignedTaskUndone` (bonus.service.js:698) tak window ke andar koi raasta hi nahi bachta. `deleteTask` ka cascade bhi band ho jaata hai, to pending faisla mari hui id nahi banta.

Ye dono rejected designs se alag hai: `assignedBy` null hi rehta hai (koi arbitrary successor nahi), isliye window ke andar points-gate ka jawab bilkul wahi rehta hai jo aaj hai — `onAssignedTaskDone:619`, `scanOverdueTasks:1030`, `taskEligible:558` sab unchanged. Aur ye "freeze flag jo sirf prune padhta hai" bhi nahi — jo flag pehle se likha ja raha hai (Task.js:14 / user.service.js:351) use har gate padhega, sirf prune (bonus.service.js:1691, 1709) nahi.

Do chhoti supplementary lines design me jodni hongi:
1. **Custodian:** `assignerDeleted` wale task ko window ke andar owner-tier / manageUsers actor edit ya delete kar sakta hai (wahi log to accept kar rahe hain), taaki task frozen-forever na ho jaaye.
2. **Accept ka semantics:** accept ke waqt task ki jo state hai wahi live hoti hai — isliye design me saaf likho ki window ke andar state badalne ka koi raasta bacha nahi hona chahiye, warna Niyam 5 (approval bani rahegi) aur limbo dono window ke andar hi mar jaate hain.

---

## 9. [RED] Ek saath kai logon ko diya gaya batch Niyam 3 me tut jaata hai — 'sab copies par lagao' chupchaap aadhi copies par lagta hai

lens: gate · `backend/src/services/task.service.js`:655

**Scenario:** Manish Saini ek hi kaam 'Site photos — Ranchi' teen logon ko ek saath deta hai: Rahul, Sita, Amit. createTask :160 teen copies banata hai ek shared `assignBatch` B ke saath (batch tabhi banta hai jab 2+ log hon). 10-Aug: Manish delete — teeno copies par assignedBy=null (user.service.js:351). Niyam 3 har TASK par alag request banata hai (design: 'ek hi modal me saare task', har task par apna Accept/Reject), isliye teen alag faisle hote hain. 12-Aug: Kalpana Rahul aur Sita wali copies Accept karti hai; Khaan Aamir Amit wali Accept karta hai. Ab batch B do alag assigners me bat chuka hai. Kalpana jab Rahul wali copy kholti hai aur 'apply to all' karti hai, updateTask :655 `batchQuery = { assignBatch: B, assignedBy: actor._id }` sirf 2 members uthata hai → :763 editSet me Amit ki copy hai hi nahi, aur response me `batchCount: 2` jaata hai (:838) jabki kaam par teen log hain. Aur agar Kalpana reassign karti hai (`data.assignTo`, :666-730), to jo members desired me nahi hain unki copies DELETE ho jaati hain (:703) — par Amit ki copy us set me hai hi nahi, isliye wo chupchaap zinda rehti hai aur Kalpana ko kabhi dikhti bhi nahi. Ulta, assignee ki screen sach bolti hai: listTasks ka siblings block (:1045-1064) sirf assignBatch par query karta hai, assignedBy par nahi — to Rahul ko ab bhi teeno teammates ka progress dikhta hai.

**Verifier:** Objection ka core claim sach hai, aur uska apna "points nahi hilte" wala assurance GALAT hai — split hua batch points ko duplicate kar deta hai. Isliye MEDIUM nahi, RED.

REFUTE karne ki 4 koshishein, chaaron FAIL:
1. "Batch split ho hi nahi sakta" — nahi. `user.service.js:351` sirf `assignedBy: null, assignerDeleted: true` set karta hai; `assignBatch` chhuta tak nahi. Teeno copies batch B me rehti hain.
2. "Rule 3 tak multi-assign copy pahunchti hi nahi" — pahunchti hai. `createTask:160,170-180` ki copies me `forwardedFrom` null hai (Rule 1 out) aur `collaborators` list teeno par IDENTICAL hai (Rule 2 uniform). To jab koi owner-tier tag nahi, teeno Rule 3 me jaati hain, aur design (08d:113,120) har TASK par alag Accept/Reject deta hai. Design me "batch" shabd ek baar bhi nahi hai (grep kiya — 08d aur 08e dono me nadarad).
3. "Aaj bhi ye ho sakta hai, design ka dosh nahi" — nahi. Aaj deletion ke baad teeno copies par `assignedBy=null`, to `updateTask:642-643` sabko 403 deta hai — koi split nahi kar sakta. Split SIRF Rule 3 ki per-copy ownership se paida hota hai. Ye design-introduced hai.
4. "Ye sirf cosmetic batchCount hai" — nahi, ye asli duplicate task banata hai.

ASLI FAILURE (objection se zyada bada):
`listTasks:1045-1064` siblings ko `{ assignBatch: { $in: batchIds } }` se bharta hai — `assignedBy` filter hai hi nahi. Aur `website/components/tasks/task-dialog.jsx:36-40` `currentAssignees` = owner + IN SIBLINGS ke owners banata hai, phir `:56` un sabko pre-checked kar deta hai.

Real numbers:
- 5-Aug-2026: Manish Saini "Site photos — Ranchi", due 2026-08-20, ek saath Rahul + Sita + Amit ko. `createTask:160` batch B banata hai.
- 10-Aug: Manish delete. Teeno par assignedBy=null, batch B zinda.
- 12-Aug: Rule 3 — Kalpana Rahul+Sita wali copies Accept karti hai, Khaan Aamir Amit wali. Ab R,S → assignedBy=Kalpana; A → assignedBy=Khaan Aamir; teeno batch B.
- 14-Aug: Kalpana copy R kholti hai kyunki ab Deepak Kumar ko bhi dena hai. Dialog me Rahul, Sita AUR **Amit** teeno chip already lit (siblings se). Wo sirf Deepak tick karti hai → `:83 reassigned=true` → PATCH assignTo=[Rahul,Sita,Amit,Deepak].
- Server: `:655` members = {assignBatch:B, assignedBy:Kalpana} = [R,S] hi. `:672` currentIds={Rahul,Sita}. `:673` **addedIds=[Amit, Deepak]** — Amit "naya banda" pad liya gaya. `:726` dono ke liye NAYI copy create. Amit ke paas ab DO PENDING copies: A (Khaan Aamir ki) + A2 (Kalpana ki), same title, same due 2026-08-20. Amit ko "New task from Kalpana" notification bhi jaata hai. Koi dedupe check `:725-728` me hai hi nahi.

POINTS (yahi RED hai):
`scanOverdueTasks:1030` PER TASK DOC chalta hai. A aur A2 dono PENDING, dono ka dueYMD=2026-08-20, dono `taskEligible:558` pass karte hain (A.assignedBy=Khaan Aamir owner-tier, A2.assignedBy=Kalpana owner-tier). To 21-Aug ko dono ko apna-apna `auto_task:<id>` mark milta hai (`:1054`) aur 22-Aug se dono ko apna-apna `auto_overdue:<id>:<today>` drip (`:1066`). Code ka apna comment (`:1057`) rate deta hai: -5 mark, -1/din. 31-Aug tak Amit: copy A = -5 -10 = -15, copy A2 = -5 -10 = -15 → **kul -30**, jabki ek hi kaam ki sahi keemat -15 hai. Ulta case: agar Amit dono 19-Aug ko DONE kar de, `onAssignedTaskDone:685-693` `awardOnce` do baar `user: copy.owner` = Amit par chalata hai (keys auto_task:A aur auto_task:A2 alag hain, isliye dedupe nahi lagta) → **ek kaam ka award do baar**. Ye design ki "NOBODY'S POINTS MAY MOVE" wali buniyaadi shart todta hai — limbo ke baad, isliye limbo-freeze isse nahi bachata.

Do aur nateeje usi jad se:
- Kalpana agar Amit ko HATANA chahe (chip off): desired=[Rahul,Sita], members=[R,S], dono desired me → kuch nahi hota, addedIds=[] → copy A zinda. UI "Task updated & reassigned" bolta hai aur refresh par Amit phir se lit dikhta hai. Removal hamesha ke liye chupchaap fail.
- Agar Kalpana ka `taskAssign.mode === 'SELECTED'` aur Amit us list me nahi, to `:678` 403 ("You can only assign to people you're allowed to assign work to") — aur ab wo us batch ko KABHI reassign nahi kar sakti, kyunki `assignTo` me Amit hamesha ghusa aayega. Kaam permanently stuck.

Objection ke `batchCount` wale hisse par ek correction: `task-board.jsx:991-996` batchCount loaded list se ginta hai, to Kalpana ko 2 hi dikhega — wahan UI apne aap se consistent hai. Jhoot `siblings`/`currentAssignees` bol rahe hain, aur wahi phantom-add banata hai.

**Design me kya badle:** Rule 3 (aur har auto-transfer) me ek line jodo: **ek hi `assignBatch` ki saari copies EK unit hain** — modal me ek hi request banegi ("Site photos — Ranchi — 3 logon ko"), aur Accept/auto-transfer par teeno copies ka `assignedBy` ek hi insaan par set hoga. Batch kabhi do assigners me nahi bat sakta. Ye batch ke apne maqsad se bhi mel khata hai (Task.js:20-23) aur `updateTask:655` ka `assignedBy` filter phir se poore batch ko uthaega.

Agar owner per-copy faisla hi chahte hain, to minimum safety-net ye hai: **jo copy accept hoti hai uska `assignBatch` khaali kar do** (`''`). Tab `updateTask:655` `{_id: task._id}` par gir jaata hai, `listTasks:1045-1064` koi sibling nahi jodta, `task-dialog.jsx:36-40` ka `currentAssignees` sirf asli owner rehta hai — phantom-add, duplicate copy aur ghost-removal teeno khatam. Keemat: assignee ki "teammates ka progress" wali view chali jaati hai, isliye pehla vikalp behtar hai.

Dono me se jo bhi ho, ek belt-and-braces guard bhi rakho: `updateTask` ke `:725-728` create loop se pehle check karo ki us owner ke paas usi batch ki koi PENDING copy pehle se to nahi — warna duplicate ban jaati hai.

---

## 10. [RED] Niyam 1 ka fallback forwardedFrom ko dangling chhod deta hai — poori chain kabhi pay hi nahi hoti

lens: chain-mechanics · `backend/src/services/bonus.service.js`:621

**Scenario:** Khaan Aamir (CEO) → Manish Saini (Manager, T_M = root copy) → Priyanshi Patel (T_P: forwardedFrom = T_M, originalAssignedBy = Khaan). Task 'Site survey report', due 2026-08-20, assignedTaskOnTime +5, forwardOnTime +3, grace 1. Delete se pehle: Priyanshi 18 Aug ko DONE → settleParent → T_M DONE → onAssignedTaskDone(T_M) root hai → Manish +3, Priyanshi +5. Ab 12 Aug ko Manish ka account delete: user.service.js:337 `Task.deleteMany({ owner: uid })` T_M mita deta hai. Koi zinda ancestor task nahi bacha (T_M hi root tha), to design ka fallback: T_P.assignedBy = Khaan, par T_P.forwardedFrom abhi bhi mit chuke T_M ki taraf. 18 Aug ko Priyanshi DONE karti hai → onAssignedTaskDone(T_P) line 621 par return → 0 points. settleParent(T_P) → parent null → return. Priyanshi ka +5 hamesha ke liye gaya. Aur agar wo 25 Aug ko karti: 22 Aug ko scanOverdueTasks use uthata hai (assignedBy = Khaan ab non-null, T_P kisi ka forwardedFrom nahi) aur -5 likh deta hai — jo completion result se kabhi replace nahi hoga, kyunki result likhne wala hook line 621 par nikal jaata hai. Sirf penalty, kabhi reward nahi. Bilkul yahi shakl 'root deleted' me bhi banti hai (CEO → A → B, A delete ho jaaye).

**Verifier:** CONFIRMED — RED. Maine ise refute karne ki poori koshish ki (design ka koi clause dhoondha jo fallback me link ko null kare, ya koi reward-path jo non-root copy ko pay kare). Dono nahi mile. Ek correction ke saath objection khada rehta hai, aur asli nuksaan objection ke apne example se BADA hai.

1) DESIGN AS WRITTEN SE DANGLING POINTER HI NIKALTA HAI
08d line 47-48 = "upar wale ZINDA task par jod do". Warning box line 50-56 aur checklist line 209 ("Niyam 1 sudhra: re-point, clear nahi") blanket hain — kahin nahi likha ki ye sirf tab lagu hai jab ancestor zinda ho. Fallback line 61-63 sirf `assignedBy = originalAssignedBy` likhta hai aur `forwardedFrom` ka zikr hi nahi karta, aur jodne ke liye koi zinda ancestor row bachi hi nahi. To literal implementation = `forwardedFrom` mit chuke task ki taraf dangling.
Yeh koi kalpana nahi: pichhli review 08e-design-review.md:50 aur :184 me SAAF likha tha — "Jab upar koi surviving task NAHI hai (2-level case)... forwardedFrom = null, assignedBy = root ka assigner." 08e ki correction ka aadha hissa (splice) 08d me aa gaya, doosra aadha (no-ancestor par root-promote) reh gaya.

2) CODE PROOF — dangling copy har reward-path se invisible hai
- bonus.service.js:621 `if (task.forwardedFrom) return;` — payout ka trigger yahi hai.
- Poore backend me task ke POSITIVE points ka ek hi writer hai: onAssignedTaskDone ka awardOnce (:685). Uske saare callers ya to root pass karte hain ya :621 par nikal jaate hain — task.service.js:366, :416, :599, :795, :825; bonus.service.js:1433 (backfillMonth ka filter `forwardedFrom: null`, :1428), :1632 (rescoreAllDoneAssigned ka filter `forwardedFrom: null`, :1626), :1661 (rescoreAssignedTasks, :1655 me bhi `forwardedFrom: null`).
- settleParent (task.service.js:558-561): `Task.findById(childTask.forwardedFrom)` null → chup-chaap return. Upar bhi kuch nahi.
- rebuildOverdueForTask (:726): `|| t.forwardedFrom` par return.
- PAR scanOverdueTasks (:1029-1030) sirf forwarded PARENTS ko `$nin` karta hai (`_id: { $nin: forwardedParentIds }`) — `forwardedFrom` wale CHILD ko nahi. assignedBy ab Khaan (non-null) hai aur chainEligible (:1038 → taskEligible :558) turant true deta hai. Yaani penalty path zinda, reward path mara hua.
- pruneOrphanTaskEntries (:1724) `e.points < 0` wali entries PENDING task par rakh leta hai. To likhi hui penalty rehti hai.

3) NUMBERS — objection ka 2-level case (verified)
Khaan Aamir (CEO) → Manish Saini T_M {forwardedFrom: null, assignedBy: Khaan, due 2026-08-20} → Priyanshi Patel T_P {forwardedFrom: T_M, originalAssignedBy: Khaan} (forwardTask :522-532). grace 1 (Setting.js:73), assignedTaskOnTime 5, forwardOnTime 3 (:1581).
- Delete se pehle, 18-Aug DONE: settleParent T_M band karta hai → onAssignedTaskDone(T_M) root hai → forwarderIds={T_M} (:645) → Manish auto_forward +3, Priyanshi auto_task +5.
- 12-Aug ko Manish delete (user.service.js:337 `Task.deleteMany({owner: uid})` T_M mita deta hai; :351 assignedBy detach). Design ka fallback: T_P.assignedBy = Khaan, forwardedFrom dangling.
- 18-Aug DONE: setStatus :366 → onAssignedTaskDone(T_P) → :621 return. :375 settleParent(T_P) → parent null → return. Priyanshi: 5 → 0. -5 ka nuksaan, us insaan ka jisne kaam kiya.

4) OBJECTION KA EK HISSA MAINE CORRECT KIYA, AUR EK JAGAH USE BADHAYA
- LATE branch ka claim ("sirf penalty, kabhi reward") numbers me lagbhag wash hai: sahi duniya me bhi late result −assignedTaskLate hota, usi `auto_task:<id>` key par, usi overdueDayFor day/month me (:657, :674, :693 vs :1054). Drips dono duniya me rehte hain (DONE hote hi scanOverdueTasks `status: 'PENDING'` filter se hat jaata hai). To provable loss ON-TIME reward hai, late-penalty asymmetry nahi.
- Par 3-level shape me nuksaan DOGUNA se zyada hai: Khaan → Manish (T_M root) → Priyanshi (T_P) → Junior Rohit (T_J). Manish delete → T_P dangling. Rohit 18-Aug DONE → onAssignedTaskDone(T_J) :621 return (parent T_P) → settleParent(T_J) T_P ko DONE karta hai (:595-599) → onAssignedTaskDone(T_P) → :621 phir return, kyunki T_P ka apna forwardedFrom dangling hai. Nateeja: Rohit +5 gaya, Priyanshi +3 gaya — DO zinda logon ke 8 points sirf isliye ud gaye ki teesra insaan delete hua. Yehi "root deleted" wali shakl hai jo objection ne mention ki.

Design ka apna sabse pehla vaada — "kisi ke points na hilein" — is fallback par toot jaata hai. Design line 63 sirf GATE ka jawab check karta hai ("CEO owner-tier hai → haan"), par payout ka doosra guard (root-ness, :621) address hi nahi karta.

**Design me kya badle:** 08d ke Niyam 1 ke fallback (line 61-63) me do line jodo — implementation ke liye ye hi kaafi hai:

(a) "**Sirf is fallback me** (upar koi ZINDA ancestor task bacha hi nahi) `forwardedFrom = null` bhi karo — copy sach me ROOT ban jaati hai. `assignedBy = originalAssignedBy`. Warning box (line 50-56) ka 'clear mat karo' **sirf tab** lagta hai jab upar zinda ancestor MAUJOOD hai — wahan link RE-POINT hota hai, cleared nahi. Yahan clear karna zaroori hai: `bonus.service.js:621` ka `if (task.forwardedFrom) return;` warna is copy ko hamesha ke liye 'main root nahi hoon' padhta rahega aur poori chain kabhi pay nahi hogi."

(b) Ek guard (warna 08e #8 wapas aa jaayega): "Ye root-promotion **sirf un copies par jo abhi khuli hain** (`status !== 'DONE'`). Jo chain pehle hi settle ho chuki hai aur jiske points likhe ja chuke hain, usko chhedo mat — warna `rescoreAllDoneAssigned` (`bonus.service.js:1626`, filter `forwardedFrom: null`) use roz uthakar on-time/late ka faisla naye root ke `completedAt` se dobara karega aur band mahine ka point hil sakta hai. DONE copy ke points waise hi surakshit hain: `pruneOrphanTaskEntries` (`:1716-1725`) unhe rakhta hai, kyunki `assignedBy` ab CEO hai aur status DONE hai."

Aur checklist line 209 ko badlo: "Niyam 1 sudhra: **ancestor zinda hai → re-point; ancestor nahi bacha → root-promote (link null + assignedBy = originalAssignedBy), sirf khuli copies par**."

---

## 11. [RED] Niyam 3 gate ka jawab BADAL deta hai — band ho chuke mahine me points/penalty back-file ho jaate hain

lens: chain-mechanics · `backend/src/services/bonus.service.js`:558

**Scenario:** Manish Saini (Manager, owner-tier nahi) ne 10 Jul ko Priyanshi Patel ko 'Office inventory update' diya, due 2026-07-20, koi owner-tier tagged nahi. Aaj tak ye task points se poori tarah BAAHAR hai: scanOverdueTasks chainEligible false par skip karta hai (line 1038), aur onAssignedTaskDone `copies.some(taskEligible)` false hone par entries delete karke return karta hai (line 632-635). Priyanshi ne 28 Jul ko late complete kiya → 0 points, na +5 na -5. 11 Aug ko Manish delete. Niyam 3 → request → Kalpana Sharma (CEO tier) 12 Aug ko Accept → T.assignedBy = Kalpana. Agli daily run par `rescoreAllDoneAssigned` (bonus.service.js:1626 — status DONE, assignedBy ≠ null, completedAt >= aaj-45 din, forwardedFrom null; maybeRunDaily se line 1778) onAssignedTaskDone(T) chalata hai. Ab eligible hai. late = 28 Jul > 20 Jul + grace 1 → filedYMD = overdueDayFor('2026-07-20', 1) = 2026-07-22 → month '2026-07'. Priyanshi ke JULY me -5 lag jaata hai — ek band mahina jiska rollup ho chuka hai, ek aise kaam par jo hone ke waqt points system me tha hi nahi. Aur `carryInFor` (line 92-106) July ka ye naya deficit August, September... har aage wale mahine me compound karta hai, to uska aaj ka net bhi girta hai. Ulta bhi utna hi sach hai: agar wo 18 Jul ko on-time karti to +5 invent ho jaata — un logon ke July ke totals badal jaayenge jinhone kuch bhi alag nahi kiya.

**Verifier:** Objection sahi hai, aur maine ise refute karne ki poori koshish ki — teen escape hatch dekhe, teenon band nikle.

**1) Premise verify: Rule-3 wala task sach me points ke BAAHAR hota hai.**
`taskEligible` (backend/src/services/bonus.service.js:555-560) sirf do arm par haan kehta hai: `task.assignedBy` owner-tier ho (line 558) ya `collaborators` me koi owner-tier ho (line 559). Rule 3 ki poori definition hi "chain nahi + owner-tier tag nahi" hai, aur assigner Manish Saini (Manager) owner-tier nahi — to dono arm false. Nateeja aaj: `scanOverdueTasks` `chainEligible` false par `continue` karta hai (bonus.service.js:1038), aur `onAssignedTaskDone` `copies.some(taskEligible)` false hone par entries delete karke return karta hai (632-635). Task ke naam par ek bhi PointEntry nahi.

**2) Escape hatch A — "shayad accept assignedBy nahi badalta".** Nahi badal sakta. `reviewTask` line 389-390 me `isAssigner = task.assignedBy === actor._id`, warna 403 — yaani Niyam 5 (approval nayе zimmedaar ke paas) tabhi kaam karega jab `assignedBy` = accept karne wala ho. Wahi `updateTask` (task.service.js:639-643) aur `deleteTask` (861-866) ke liye bhi sach hai. To Rule 3 ka accept `assignedBy = Kalpana` likhega hi — aur line 558 ka pehla arm turant TRUE ho jaayega. Gate ka jawab NAHI → HAAN badal gaya, jo design ki apni buniyadi soch (08d line 34: "gate ka jawab wahi rehta hai jo pehle tha") ka seedha ullanghan hai.

**3) Escape hatch B — "LIMBO isse rok legi".** Nahi. Design line 186 khud kehta hai: "jab tak faisla nahi hota... **Accept hote hi normal chalu**." Nuksaan accept ke BAAD hota hai, limbo ke andar nahi.

**4) Escape hatch C — "shayad sirf DONE tasks par lagta hai, aur handover to PENDING kaam ke liye hai".** Dono shakl me hota hai; PENDING wali zyada pakki hai:

*PENDING variant (sabse saaf):* T = "Office inventory update", owner Priyanshi Patel, assignedBy Manish Saini, dueYMD 2026-07-20, koi owner-tier collaborator nahi, forwardedFrom null. 22 Jul se aaj tak overdue par ek bhi entry nahi (line 1038 skip). 11 Aug ko Manish delete → `Task.updateMany({assignedBy: uid}, {assignedBy: null, assignerDeleted: true})` (user.service.js:351). 12 Aug ko Kalpana Sharma Accept → assignedBy = Kalpana. 13 Aug ki daily run me `maybeRunDaily` → `scanOverdueTasks` (line 1774): query `{assignedBy: {$ne:null}, status:'PENDING', dueYMD non-empty, _id nin forwardedParentIds}` (1030) ab T ko uthaati hai, `chainEligible` ab TRUE, `marked` null → `overdueDay = overdueDayFor('2026-07-20', grace 1) = '2026-07-22'` (1013-1016, APP_LIVE_YMD = 2026-07-01 to clamp nahi lagta), `month = '2026-07'` → Priyanshi ke **JULY** me `-assignedTaskLate` (−5) likh diya jaata hai (1051-1054). Drip nahi lagega (dueYMD < DRIP_FLOOR '2026-08-01', line 1064), par −5 mark ka koi floor hai hi nahi.

*DONE variant:* Priyanshi ne 28 Jul ko late complete kiya tha (0 points, kyunki 632-635 ne delete kar diya tha). Accept ke baad `rescoreAllDoneAssigned` (1626: status DONE, assignedBy ≠ null, completedAt ≥ aaj−45d = 28 Jun, forwardedFrom null) `onAssignedTaskDone` chalata hai → gate pass (632) → `late = '2026-07-28' > addDays('2026-07-20',1)` → `filedYMD = overdueDayFor(...) = '2026-07-22'` (657) → `awardOnce(..., month: '2026-07', points: -5, replace:true)` (674-693). Ulta bhi utna hi sach: agar 18 Jul ko on-time hota to `filedYMD = completedYMD = '2026-07-18'` → **+5 July me invent** ho jaata.

**5) Nuksaan sirf July tak nahi rukta.** `carryInFor` (92-106) har mahine ka net live ledger se nikaalta hai aur `carry = Math.min(0, month + carry)` (line 103) — July ka naya −5 August, September... har aage wale mahine me compound hota hai, to Priyanshi ka aaj ka net bhi girta hai, bina uske kuch alag kiye. Aur ye codebase ke apne likhe usool ke khilaaf hai: `awardOnce` ka comment (503-504) — "Re-running a scan must never move a July penalty into August's total" — yaani beeta mahina settled maana jaata hai.

**6) Scope:** Niyam 2 me ye bug nahi hai (tagged owner pehle se hi line 559 par TRUE deta tha). Niyam 1 me bhi nahi (chain re-point se ancestor arm wahi rehta hai). Sirf **Niyam 3 ka Accept aur "aakhri candidate → seedha uske paas"** naya jawab paida karte hain — aur wahi do jagah hain jahan ek aisa insaan assigner ban jaata hai jo us task ki history me tha hi nahi. Design me is par ek shabd bhi nahi hai.

**Design me kya badle:** **Sabse chhota fix: handover naya zimmedaar deta hai, naya GATE-ANSWER nahi. Gate hamesha ASLI assigner se poochhe.**

Design me Niyam 3 (aur Niyam 2 ke fallback, aur har wo raasta jahan `assignedBy` badla jaata hai) ke saath ye line jodni hogi: *"assignedBy badalna sirf zimmedari (approve/chase/edit) transfer karta hai — points ka gate purane assigner ke jawab par hi atka rehta hai."* Do jagah:

1. **`deleteUser` me ek boolean stamp karo** — user.service.js:351 wale usi `updateMany` me, jo pehle se `assignerDeleted: true` likhta hai, `assignerWasOwnerTier: <bool>` bhi likho, jo **deletes se PEHLE** `(await ownerTierIds()).has(String(uid))` se nikle. Task.js me ek naya field (`assignerDeleted` ke bagal me, line 14).

2. **`taskEligible` ka assigner-arm us stamp ko padhe** (bonus.service.js:555-560):
   - `if (task.assignerDeleted) → assigner-arm = (task.assignerWasOwnerTier !== false)` — yaani substitute `assignedBy` ko gate ke liye **ignore** karo;
   - `collaborators` arm bilkul live rahe (line 559), taaki Niyam 4 ka tag-neeche-utaarna aur baad me tag lagana/hatana aaj jaisa hi kaam kare.
   - `!== false` jaan-boojh kar: purani deletions ke orphans aur koi bhi missing projection **true** padhein (aaj ke prune ka hi jawab, bonus.service.js:1709), taaki fail-safe direction hamesha "points bachao" ho — wahi usool jo `hasScorableDeadline` ke comment (545-547) me likha hai.

Ye ek badlaav har writer ko theek kar deta hai kyunki saare gate isi function se hokar jaate hain: `onAssignedTaskDone` (632), `scanOverdueTasks` (1038), `rebuildOverdueForTask` (728), `pruneOrphanTaskEntries` (1709), `chainEligible` (568/579). Iske baad Kalpana ka Accept sirf zimmedari uthaata hai — na July me −5 aata hai, na +5, aur Niyam 5 ki approval authority bhi kaam karti hai.

**Do zaroori chetavaniyan:**
- Ye "prune-only freeze flag" (jo pehle reject hua tha) NAHI hai — ye stamp **gate function** khud padhta hai, prune sirf uska ek consumer hai.
- Naya field har `.select(...)` me daalna hoga jo `taskEligible`/`chainEligible` ko feed karta hai — 575, 725, 1030, 1090, 1627, 1656, 1692 — warna undefined padhega. Upar wale `!== false` encoding ki wajah se galti ka nateeja "purana behaviour" hoga, "points ud gaye" nahi, par projection phir bhi jodni chahiye warna owner-tier assigner ke delete hone par gate galat true dega.
- Bonus: yahi stamp `pruneOrphanTaskEntries` ke blanket `t.assignerDeleted ? true` (1709) ko bhi sahi kar deta hai — ab wo asli jawab padhega, andaaza nahi.

---

## 12. [RED] Splice ke baad settleParent dobara nahi chalta — approval par atki chain hamesha PENDING, doer ke points kabhi nahi likhe jaate

lens: chain-mechanics · `backend/src/services/task.service.js`:573

**Scenario:** Khaan Aamir (CEO) → Kalpana Sharma (T_K, root) → Kalpana ne Manish Saini ko forward kiya requiresApproval=true ke saath (T_M) → Manish ne Priyanshi Patel ko forward kiya (T_P). Due 2026-08-20. 14 Aug: Priyanshi DONE → settleParent(T_P) → T_M.requiresApproval && T_M.assignedBy (Kalpana) → T_M.submittedAt = 14 Aug, completedBy = Priyanshi, Kalpana ko TASK_APPROVAL, aur return (line 573-592). T_K abhi bhi PENDING, submittedAt null. 16 Aug: Manish delete → user.service.js:337 T_M mita deta hai. Design ka Niyam 1: T_P.forwardedFrom = T_K, assignedBy = Kalpana. Par T_P pehle se DONE hai — koi transition nahi, settleParent kabhi nahi chalta. Nateeja: T_K hamesha PENDING. Kalpana ki 'My tasks' me bhi nahi dikhta (listTasks passedOn exclusion, line 955-956, kyunki T_P.assignedBy = Kalpana aur T_P.forwardedFrom = T_K), kisi ki approval queue me bhi nahi (submittedAt null, line 978), aur scanOverdueTasks bhi use chhod deta hai (forwardedParentIds, bonus.service.js:1029) — to koi reminder, koi badge, kuch nahi. onAssignedTaskDone(T_K) kabhi nahi chalta → Priyanshi ka +5 (assignedTaskOnTime) aur Kalpana ka +3 (forwardOnTime) kabhi likhe hi nahi jaate. Kaam bhi atka hua, points bhi gaye — aur screen par kahin dikhta bhi nahi.

**Verifier:** Objection sahi hai. Maine har qadam code se verify kiya — design (08d) me splice ke baad chain ko dobara settle karne ka koi step hai hi nahi, aur code me settle ka koi doosra trigger bachta nahi.

MECHANISM (proved):
- `settleParent` private hai aur sirf DO jagah se chalta hai: `task.service.js:374-376` (setStatus, `if (task.status === 'DONE')`) aur `task.service.js:418` (reviewTask, approve branch). Koi teesra caller nahi (poori file grep ki).
- Payout sirf ROOT par hota hai: `bonus.service.js:622` — `if (task.forwardedFrom) return;`. Root DONE nahi hua to kisi ko kuch nahi.
- Nightly passes root ko utha hi nahi sakte: `rescoreAllDoneAssigned` (`bonus.service.js:1626`) query `status:'DONE', forwardedFrom:null` — root PENDING hai, child ka forwardedFrom non-null. `scanOverdueTasks` (`:1030`) `_id: {$nin: forwardedParentIds}` — splice ke baad root khud forwardedParentIds me aa jaata hai (`:1029`), to overdue mark/drip bhi nahi.

SCENARIO (numbers ke saath, code line-by-line):
Khaan Aamir (CEO) → Kalpana (T_K, root, assignedBy=Aamir, requiresApproval=false, due 2026-08-20). Kalpana → Manish, `requiresApproval:true` (validator allow karta hai — `tasks.validators.js:41`) → T_M {owner:Manish, assignedBy:Kalpana, forwardedFrom:K, originalAssignedBy:Aamir}. Manish → Priyanshi → T_P {forwardedFrom:M, requiresApproval:false}.
- 14 Aug: Priyanshi DONE. `setStatus:366` → `onAssignedTaskDone(T_P)` `:622` par return (0 points). `:375` → `settleParent(T_P)` → `:573` parent.requiresApproval && parent.assignedBy → T_M.submittedAt=14 Aug, T_M.completedBy=Priyanshi, Kalpana ko TASK_APPROVAL, `:592` return. T_K abhi bhi PENDING, submittedAt null.
- 16 Aug: Manish delete. `user.service.js:337` `Task.deleteMany({owner: uid})` T_M ko bina kisi status-check ke uda deta hai (awaiting-approval copy bhi). Design Niyam 1: T_P.forwardedFrom=K, T_P.assignedBy=Kalpana.
- Ab T_P pehle se DONE hai. setStatus ka no-op guard (`:294`) DONE→DONE par turant return karta hai, reviewTask (`:391`) `NOT_AWAITING` deta hai (T_K.submittedAt null). Yaani koi transition bacha hi nahi → `settleParent` dobara kabhi nahi chalta → T_K HAMESHA PENDING.

NATEEJA:
1. Kaam permanently stranded. T_K ko sirf uska owner Kalpana close kar sakti hai (`:277-279`), par T_K uski "My tasks" se nikal chuka hai — `listTasks:955-956` ka `passedOn` ab T_P.assignedBy=Kalpana + forwardedFrom=K ki wajah se K ko `$nin` kar deta hai. Approval queue me bhi nahi (`:978` submittedAt null chahiye). *Objection me ek chhoti overstatement hai:* Khaan Aamir ko T_K uske "Assigned by me" tab me PENDING dikhta hai (`listTasks:940`) — par wo use band nahi kar sakta (setStatus owner-only, reviewTask NOT_AWAITING); sirf delete kar sakta hai, jo `deleteTask:872-886` ke cascade se Priyanshi ka DONE record bhi mita dega.
2. Points destroy hote hain. Agar Manish na gaya hota: Kalpana approve karti → `reviewTask:407-418` → `settleParent(T_M)` → T_K DONE → `onAssignedTaskDone(T_K)`: copies=[T_K,T_M,T_P], `:632` gate TRUE (T_K.assignedBy=Aamir owner-tier), `:645` forwarderIds={K,M} → Kalpana forwardOnTime (seeded +3, `:1581`), Manish +3, Priyanshi assignedTaskOnTime (leadership-configured — office me +5/+10; code me koi seeded default nahi, to objection ka "+5" illustrative hai, mechanism value-independent). Design ke baad ye teeno awards kabhi likhe hi nahi jaate.
3. Kalpana ke bell me ek dead TASK_APPROVAL bacha rehta hai: notification `user:Kalpana, entityId:M` hai, aur `Notification.deleteMany({user: uid})` (`user.service.js:338`) sirf Manish ke apne notifications hataata hai. Link `/todo?tab=assigned&task=<mita hua id>` — kholne par kuch nahi.

Niyam 5 ise cover NAHI karta: wo kehta hai "atki hui submission ka notification naye zimmedaar ko jaayega". Yahan atki hui submission KHUD jaane wale ki copy ki thi aur uska approver pehle se Kalpana hi thi — usko dobara notify karne se kuch nahi badalta, kyunki approve karne layak koi row bachi hi nahi (T_M deleted, T_K.requiresApproval=false + submittedAt=null). Aur T_K par zabardasti submittedAt likhna bhi galat hoga — `updateTask:780` khud orphaned submittedAt ko clear karta hai.

Ye design ke apne usool ka ulanghan hai: "jo rishta pehle se tha use wapas jodo, gate wahi jawab de". Splice karne ke baad chain CEO → Kalpana → Priyanshi ban jaati hai, aur us shakl me `settleParent` root ko band karke sabko pay karta — par design us ek qadam ko chhod deta hai.

**Design me kya badle:** Niyam 1 me EK line jodo: "splice ke baad, agar re-point kiya hua bachcha pehle se DONE hai, to chain ko wahin se dobara settle karo."

Concretely (sabse chhota change):
1. Ek surviving ancestor A ke SAARE adopted children re-point ho jaane ke BAAD (taaki `settleParent` ka siblingOpen check `task.service.js:564-568` final set dekhe), agar A ke neeche har child `status === 'DONE'` hai, to un me se kisi ek par `settleParent(child)` chala do. Aage sab automatic hai: agar A ka apna gate ON hai (`A.requiresApproval && A.assignedBy`) to `:573-591` A.submittedAt lagakar A ke ASLI approver ko TASK_APPROVAL bhejta hai; warna `:595-609` A ko DONE karke `onAssignedTaskDone` se poora tree pay karta hai (forwarder/doer split khud sahi nikalta hai kyunki spliced chain me forwarderIds ab {K} hai). Idempotent hai — `settleParent:561` DONE parent par turant return karta hai aur `awardOnce` upsert hai.
2. Design me ye saaf likh do (Niyam 5 ka spashtikaran): **jaane wale ki copy par baitha approval gate uski copy ke saath hi khatam hota hai.** Uska koi ghar nahi bachta (row mit gayi), aur jise wo submission addressed thi wahi ab us kaam ka owner ban raha hai — apni hi copy approve nahi kar sakta. Isliye splice ke baad chain surviving links ke APNE gates par settle hogi, jaane wale ke gate par nahi.
3. Saath me: destroyed copy par lagi hui pending TASK_APPROVAL notification ko clear karo — `clearNotificationsFor('Task', <destroyed task id>, { types: ['TASK_APPROVAL'] })` (helper pehle se maujood hai, `models/Notification.js:56`, `task.service.js:340` par use hota hai), warna surviving approver ke bell me ek aisa item latka rehta hai jo kabhi khulta nahi.

Note: agar bachcha DONE nahi hai to kuch karne ki zaroorat nahi — wo baad me finish hoga to `setStatus:375` khud `settleParent` chala dega aur naya parent sahi mil jaayega.

---

## 13. [RED] Jaane wala agar chain ka aakhri sira tha to upar wale par purani tarikh ka -5 laad diya jaata hai (band mahine me bhi)

lens: chain-mechanics · `backend/src/services/bonus.service.js`:1030

**Scenario:** Khaan Aamir (CEO) → Kalpana Sharma (T_K, due 2026-07-25, grace 1). Kalpana ne 20 Jul ko Manish Saini ko forward kiya (T_M). Manish ne kabhi nahi kiya; 27 Jul ko scan ne MANISH ko -5 diya (earnedYMD 2026-07-27). T_K tab tak scan se bahar tha. 11 Aug ko Manish delete → user.service.js:337 T_M mita deta hai. Ab T_K ka koi child nahi → forwardedParentIds se nikal gaya → agli daily run (bonus.service.js:1774) par scanOverdueTasks use uthata hai: status PENDING, assignedBy = Khaan (non-null), dueYMD set, chainEligible true (assigner CEO hai). Koi purana mark nahi mila, to KALPANA ko -5 milta hai jiska earnedYMD = 2026-07-27, month '2026-07' — ek band mahina jiska rollup ho chuka hai. carryInFor (line 92-106) July ka ye naya deficit August aur uske baad har mahine me compound karta hai. Aur agar kabhi rebuildOverdueForTask us task par chala (misal ke taur par CEO due date theek kare, task.service.js:798-799), to `Task.exists({ forwardedFrom: t._id })` ab false hai (line 727), to duePlus+2 se aaj tak ka HAR din -1 karke Kalpana par bhar diya jaayega — 11 Aug ko delete karne se Kalpana par ek hi jhatke me ~15 din ki penalty. Kalpana ne kuch nahi kiya, sirf uske neeche wale ka account mita.

**Verifier:** CONFIRMED — core claim code se poori tarah sach hai. Maine har link alag-alag verify kiya, aur objection ka ek sub-claim galat hai (neeche), par usse RED ka darja nahi badalta.

**Design ke andar ye kyun nahi pakda gaya:** design ke teeno niyam sirf UN copies par lagte hain jo jaane wale ne aage di thi. Yahan Manish ek **LEAF** hai — usne kisi ko forward nahi kiya. Niyam 1 ko re-point karne ke liye child chahiye (koi nahi), Niyam 2/3 ko ek anaath zinda task chahiye (T_M mit chuka). LIMBO ka freeze bhi handover-limbo par bandha hai, aur yahan koi handover hi nahi — na koi accept event jo freeze kholey. Yaani delete ka poora nuksaan **upar** ki taraf jaata hai, aur design sirf **neeche** ki taraf dekhta hai. 08e ne isi mechanism (`forwardedParentIds` se parent ka nikal jaana) par aitraaz kiya tha, par uska trigger "child detach" tha jise Niyam 1 ne band kar diya; "child DELETE" wala trigger khula hai.

**Line-by-line proof (rules: assignedTaskLate 5, assignedTaskOverdueDaily 1, graceDays 1):**

1. Khaan Aamir (CEO) → Kalpana Sharma, "Ranchi site drawings", dueYMD 2026-07-25 → T_K {owner: Kalpana, assignedBy: Khaan}.
2. 20 Jul: Kalpana forward karti hai Manish Saini ko → T_M {owner: Manish, assignedBy: Kalpana, forwardedFrom: T_K, dueYMD 2026-07-25} (task.service.js:522-532). **T_K ka status PENDING hi rehta hai** — forwardTask parent ka status chhoota hi nahi (task.service.js:487-547 me `parent.status` ko koi assignment nahi).
3. task.service.js:537 `onAssignedTaskUndone(T_K)` → bonus.service.js:698 T_K ki entries mitati hai, phir `rebuildOverdueForTask(T_K)` bonus.service.js:727 par turant return (`Task.exists({forwardedFrom: T_K})` true). Nateeja: **T_K par kabhi koi auto_task entry bani hi nahi**.
4. 27 Jul scan: T_K `forwardedParentIds` me hai (bonus.service.js:1029-1030) → query se bahar. T_M andar; `chainEligible(T_M)` true kyunki parent T_K ka assignedBy CEO hai (bonus.service.js:579,558); `marked` null; `overdueDayFor('2026-07-25',1)` = addDays(due, 2) = **'2026-07-27'** (bonus.service.js:1013-1015; APP_LIVE_YMD '2026-07-01' hai to clamp nahi lagta) → `awardOnce('auto_task:T_M', {user: Manish, month:'2026-07', points: -5, earnedYMD:'2026-07-27'})` (:1051-1054). July band: Manish -5, **Kalpana 0**.
5. 1 Aug: `runMonthRollup` July ko roll up kar deta hai (maybeRunDaily :1763-1764).
6. 11 Aug: Manish delete. user.service.js:337 `Task.deleteMany({ owner: uid })` T_M ko mita deta hai. Design ka koi niyam nahi chalta.
7. 12 Aug ka daily tick — **dono kaam ek hi run me, isi kram me**: pehle `pruneOrphanTaskEntries` (:1773) — T_M gayab → `byId` miss → `keep = t && (...)` false (:1724) → Manish ka -5 delete. Phir `scanOverdueTasks` (:1774) — ab `forwardedParentIds` me T_K nahi hai, aur T_K query ke teeno shart poore karta hai (:1030: assignedBy = Khaan ≠ null, status PENDING, dueYMD set). `duePlus` = '2026-07-26' < today → skip nahi (:1034-1035). `chainEligible` true (:558). `marked` = `PointEntry.findOne({taskRef: T_K, ...})` = **null** (step 3 ki wajah se) → `awardOnce('auto_task:T_K', {user: Kalpana, month: '2026-07', points: -5, earnedYMD: '2026-07-27'})`. `awardOnce` insert-only hai (:510) → **permanent**.

**Nuksaan:** ek hi run me penalty Manish (jo ja chuka) se hat kar **Kalpana par, 2026-07-27 ki tarikh par**, ek band aur roll-up ho chuke mahine me chipak jaati hai. Kalpana ne 11-12 Aug ko kuch nahi kiya — sirf uske neeche wale ka account mita. Ye design ke sabse buniyadi vaade "**NOBODY'S POINTS MAY MOVE as a result**" ka seedha ullanghan hai. Aur agar Kalpana ka July net +2 tha, ab -3 ho jaata hai → `carryInFor` (:92-106) live compute karta hai, to -3 August me carry hota hai aur har agle mahine compound karta rehta hai jab tak clear na ho. Task late complete karne se bhi theek nahi hota: `onAssignedTaskDone` LATE result ko wapas `overdueDayFor` = '2026-07-27' par hi file karta hai (:657).

**Objection ka jo hissa GALAT hai (sudhaar):** "rebuildOverdueForTask se ~15 din ka drip" is July-wale scenario me **nahi** hota — bonus.service.js:747 `if (!dripPts || t.dueYMD < DRIP_FLOOR_YMD) return;` aur DRIP_FLOOR_YMD = '2026-08-01' (:1008), to 25 Jul due task par ek bhi drip nahi likha jaata (scan me bhi wahi gate :1064). Ye amplification sirf **August-due** task par sach hai, aur wahan objection se bhi bura hai: T_K due 2026-08-02, 3 Aug ko forward, 11 Aug ko Manish delete. Ab :727 ka guard `Task.exists({forwardedFrom: T_K})` **false** ho chuka hai, to 20 Aug ko CEO agar due date theek kare (task.service.js:792-799 → onAssignedTaskUndone → rebuildOverdueForTask), to :749-752 ka loop 2026-08-06 se 2026-08-20 tak **15 din ka -1 (= -15)** plus :743 ka -5 mark, kul **-20 ek hi edit me** Kalpana par bhar deta hai. Delete se pehle ye poora raasta :727 par band tha.

**Design me kya badle:** LIMBO wale hisse me ek line jodo, ek naya niyam nahi:

> **"Delete ki wajah se koi bhi copy dobara scoring me aaye, to us par likhi jaane wali kisi bhi penalty ki tarikh DELETE KE DIN se pehle nahi ho sakti."**

Kaam ka daayra: jab jaane wale ki copy mitti hai aur uske PARENT ka aakhri zinda child khatam ho jaata hai, to parent par delete ka din stamp karo — `pointsFloorYMD = '2026-08-11'` (Niyam 6 waise bhi task par naya field jod raha hai, to ye usi ke saath jaayega, aur departed naam bhi wahin hai).

Implementation ka shape pehle se maujood hai — `overdueDayFor` already APP_LIVE_YMD par aage clamp karta hai (bonus.service.js:1015). Bas usi jagah per-task floor bhi lagana hai: mark ki tarikh = `max(overdueDayFor(due, grace), pointsFloorYMD)`, aur drip loop ki shuruaat (`addDays(duePlus, 2)`, :749 aur :1064) bhi usi floor se. Isse July ka -5 July me gir hi nahi sakta, aur ek hi edit se 15 din ka backfill bhi nahi ho sakta.

Owner ko ek chhota faisla dena hoga (dono hi is defect ko band karte hain):
- **(a)** jo deadline kisi AUR ke paas rehte hue nikli, uska mark bilkul na lage (floor se pehle wala mark drop) — design ke "kuch nahi hilna chahiye" se sabse zyada mel khaata hai; ya
- **(b)** mark lage, par delete ke din se — kyunki kaam usi din wapas Kalpana ke paas aaya.

Non-negotiable minimum dono me ek hi hai: **delete ke din se purani tarikh par kuch bhi file na ho.** Yahi wo cheez hai jo design ke apne vaade ko is shakl ke liye sach banati hai.

---

## 14. [RED] Multi-assign batch Niyam 3 me toot jaata hai — ek hi kaam do alag maalikon me bat jaata hai aur dobara kabhi ek saath edit nahi hota

lens: chain-mechanics · `backend/src/services/task.service.js`:655

**Scenario:** Manish Saini ne 'Diwali decoration' ek saath Priyanshi Patel, Rahul aur Sneha ko diya — teen copies, ek hi assignBatch X, assignedBy = Manish, due 2026-08-15, koi owner-tier tagged nahi. Manish delete → Niyam 3 teen alag request banata hai. Kalpana Sharma Priyanshi wali accept karti hai, Khaan Aamir Rahul aur Sneha wali. Ab batch X ke andar do alag assignedBy. Kalpana Priyanshi ki copy kholti hai, due date 25 Aug karti hai aur 'sabhi copies par lagao' (applyToAll) tick karti hai — batchQuery assignedBy = Kalpana par scope hai, to members me sirf ek copy aati hai: changedCount 1, batchCount 1. Rahul aur Sneha ki due date 15 Aug hi rehti hai → 17 Aug ko dono ko -5, aur uske baad roz -1 drip (dueYMD >= 2026-08-01), jabki Priyanshi par kuch nahi. Teeno phir bhi ek doosre ko 'siblings' me dekhte rahenge (line 1047-1063) — screen par ek kaam, andar do deadlines aur do alag scores. Reassign path bhi wahi batch id X naye copies par thop deta hai (line 683, 726), to gadbad aur gehri hoti jaati hai.

**Verifier:** ## Pehle: objection ka jo hissa GALAT hai (refuted)

**applyToAll wala scenario nahi ho sakta.** `showBatchSwitch` ko `batchCount > 1` chahiye (`website/components/tasks/task-dialog.jsx:86`), aur `batchCount` current tab ki **loaded list** se ginta hai — `website/components/tasks/task-board.jsx:991-995`. Kalpana ka "Assigned by me" tab `scope='assigned'` par chalta hai, jiska filter `{ assignedBy: actor._id }` hai (`backend/src/services/task.service.js:940`) — yaani batch X ki sirf **ek** row. To `batchCounts[X] = 1` → switch render hi nahi hoga, `body.applyToAll` bheja hi nahi jaayega (line 94), button "Save" padhega (line 126), toast "Task updated" (line 111). Wo `changedCount 1 / batchCount 1` ka bhram paida hi nahi hota.

**"Batch dobara kabhi ek saath edit nahi hoga" bhi regression nahi hai.** Aaj deletion ke baad `Task.updateMany({assignedBy: uid}, {$set:{assignedBy: null, ...}})` chalta hai (`backend/src/services/user.service.js:351`), to `isAssignedByMe` sab ke liye false ho jaata hai aur batch edit **kisi se bhi** nahi hota. Design 1+2 me baant kar isse behtar hi karta hai.

## Par jo mool baat pakdi wo SAHI hai — aur asar zyada bada hai

Aaj **koi bhi** path ek `assignBatch` me do alag `assignedBy` nahi bana sakta: `createTask` ek batch = ek assigner (`task.service.js:160,175,177`), `updateTask` naye copies par hamesha `assignedBy: actor._id` thopta hai (line 726), aur `forwardTask` `assignBatch` **copy karta hi nahi** (line 522-532, sirf `forwardedFrom`). Niyam 3 ka **per-TASK** faisla pehli baar wo split banata hai. (Niyam 1 batch ko chhoo hi nahi sakta — batch member ka `forwardedFrom` hamesha null hota hai; Niyam 2 me tag har copy par sawaar hota hai, to wo batch poora ek hi jagah bhejta hai. **Sirf Niyam 3 todta hai.**)

Aur `listTasks` ka siblings block **assignedBy se scope nahi** hai — `Task.find({ assignBatch: { $in: batchIds } })` (`task.service.js:1047`). Wahi siblings `task-dialog.jsx:38` me assignee-picker ko **prefill** karta hai:
```js
const ids = [task?.owner?.id, ...((task?.siblings || []).map((s) => s.owner?.id))]
```
→ line 56 `setAssignees(currentAssignees)`. Yaani Kalpana ke picker me **teeno chips jali hui** dikhengi, jabki server par uske members sirf ek hai.

### Concrete: Sneha Yadav ko ek hi kaam par DOGUNA penalty

- **5 Aug 2026** — Manish Saini ne 'Diwali decoration' ek saath Priyanshi Patel, Rahul Verma, Sneha Yadav ko diya. Batch X, `assignedBy = Manish`, `dueYMD = 2026-08-15`, koi collaborator nahi, koi chain nahi.
- **10 Aug** — Manish delete. Chain nahi + owner-tier tag nahi → **Niyam 3**, teen alag request.
- **11 Aug** — Kalpana Sharma ne Priyanshi wali accept ki; Khaan Aamir ne Rahul aur Sneha wali. Batch X me ab do assigner.
- **12 Aug** — Kalpana apni copy kholti hai. Picker me Priyanshi + Rahul + Sneha (siblings se). Wo **Rahul ko hata deti hai** → `assignees = [Priyanshi, Sneha]`, `reassigned = true` (line 83) → `body.assignTo` bheja jaata hai (line 93).

Server, `updateTask` reassign branch:
- `members = Task.find({ assignBatch: X, assignedBy: Kalpana })` = **sirf Priyanshi ki copy** (line 655)
- `currentIds = {Priyanshi}`, `addedIds = desired − currentIds = [Sneha]` (line 672-673)
- line 726 → **Sneha ke liye NAYI copy ban gayi**: `assignedBy: Kalpana`, `assignBatch: X`, `dueYMD: 2026-08-15`
- Rahul `members` me tha hi nahi, to uski copy **delete nahi hoti** — Kalpana ne jo hataana chaha wo **chupchaap kuch nahi karta**, aur use toast milta hai *"Task updated & reassigned"* (`task-dialog.jsx:108`)

**Ab Sneha ke paas 'Diwali decoration' ki DO PENDING copies hain**, dono 15 Aug due.

Points ka hisaab (`bonus.service.js`):
- `scanOverdueTasks` dono ko uthata hai — `{ assignedBy: {$ne:null}, status:'PENDING', dueYMD set, _id $nin forwardedParentIds }` (line 1030); dono ka assigner owner-tier hai to `chainEligible` dono par **haan** (line 1038)
- dedupe key **task-id** par hai: `auto_task:${t._id}` (line 1054) aur `auto_overdue:${t._id}:${today}` (line 1066) — do alag `_id` = do alag key, `PointEntry` ka unique index (`models/PointEntry.js:42-45`) rok nahi sakta
- **16 Aug**: Sneha ko `-5` ke bajaay **`-10`** (do marks)
- **17 Aug se roz**: `-1` ke bajaay **`-2` roz** (do drips) — `dueYMD 2026-08-15 >= DRIP_FLOOR_YMD '2026-08-01'`, line 1008/1064
- **31 Aug tak**: asli hisaab `-5 −14 = -19`; actual `-10 −28 = **-38**` — Sneha ke August par **-19 ka farzi ghata**
- Agar wo dono complete kare to `onAssignedTaskDone` har copy par `auto_task:${copy._id}` likhta hai (line 668) → **ek kaam ka award do baar**

Yaani limbo nahi tootta, par accept ke **baad** ka pehla hi reassign points invent karta hai, aur ek intended removal chupchaap no-op ho jaata hai. Isliye MEDIUM nahi — **RED**.

*(Chhota sa saath wala: detail sheet ka "Team" row bhi wahi unscoped siblings dikhata hai — `task-board.jsx:726-729` — to Kalpana ko Rahul/Sneha "uski team" lagte hain jabki unki copies uske control me nahi.)*

**Design me kya badle:** **Niyam 3 ka faisla TASK par nahi, `assignBatch` par lo.**

Rule 3 me request banate waqt, jis task ka `assignBatch` non-empty hai, uske saare live copies ko **ek hi request** me bandho — modal me ek entry ("Diwali decoration — 3 logon ko"), ek Accept, ek Reject. Accept karne par **poore batch** ke saare copies ka `assignedBy` us ek insaan par set ho. Isse batch me hamesha ek hi assigner rahega — bilkul wahi invariant jo aaj `createTask` (task.service.js:160) aur `updateTask` (line 726) rakhte hain — aur split ka poora rasta band ho jaata hai. Reject bhi poore batch par, aur "aakhri bacha candidate" wala auto-transfer bhi poore batch par.

Niyam 1 aur 2 ko badalne ki zaroorat **nahi**: batch member ka `forwardedFrom` hamesha null hota hai (koi `Task.create` dono field ek saath set nahi karta), aur tag har copy par sawaar hota hai, to wo dono batch ko waise hi poora rakhte hain.

**Belt-and-braces (design me ek line, sasta):** `updateTask` ke reassign branch me `addedIds` se un logon ko nikaal do jinke paas isi `assignBatch` ki pehle se koi live copy hai (chahe kisi aur `assignedBy` ke neeche) — taaki koi bhi purana/split batch bhi duplicate copy na bana sake.

*(Vikalp, agar batch-level request bahut bada lage: deletion ke waqt un copies ka `assignBatch` `''` kar do jo Rule 3 me ja rahi hain. Duplicate aur jhootha picker dono khatam, par "Team" progress ki visibility chali jaayegi — isliye pehla vikalp behtar hai.)*

---

## 15. [RED] Two rejects arriving together empty the candidate set — the auto-transfer only fires inside a reject, so the task is left with NOBODY, permanently

lens: claim-flow · `backend/src/services/user.service.js`:351

**Scenario:** Owner tier = {Aamir, Kalpana} (both CEO & President). Manish Saini (Admin Manager) assigned 'Bokaro site RCC checklist', due 2026-08-20, requiresApproval TRUE, to Junior Sneha -> R {owner: Sneha, assignedBy: Manish, forwardedFrom: null, collaborators: []}. 2026-08-11 Manish is deleted: no chain, no tag -> Rule 3, both Aamir and Kalpana get the request. 2026-08-12 10:04:07 both have the modal open (the ~20s poll gave both the same two-candidate view) and both press Reject inside the same second. Two Lambda invocations: each reads rejectedBy = [], each computes remaining = 2 ('I am not the last one, rejection is allowed'), each writes its own id. Final rejectedBy = [Aamir, Kalpana]; candidates = ownerTier - rejectedBy = EMPTY. Neither invocation ever saw remaining === 1, so the auto-transfer never fires; candidates are computed live, so nothing recomputes them except another reject, and there is nobody left to reject. That concurrent-Lambda read-modify-write is not hypothetical in this deployment — awardOnce's own docstring (bonus.service.js:498-512) records exactly this failure ('Two Lambdas running the same scan at the same instant both used to find nothing and both insert'). Terminal state: R.assignedBy = null, assignerDeleted = true (user.service.js:351), forever. What it costs: Sneha delivers 2026-08-19; setStatus's approval branch requires task.assignedBy (task.service.js:314) so the gate is skipped and R goes straight to DONE; onAssignedTaskDone returns at once on !task.assignedBy (bonus.service.js:619) so her +10 assignedTaskOnTime is never written; and she can delete the whole task herself (task.service.js:864-867 only blocks a non-assigner when assignedBy is non-null), which runs onAssignedTaskUndone (task.service.js:875) and hard-deletes whatever is left. The only escape is promoting a NEW owner-tier person, which nobody knows they need to do because no reminder is addressed to anyone. Second door, no concurrency needed: the design removes the Reject BUTTON for the last candidate, not the endpoint — this codebase already shipped exactly that class of bug in markSeen (task.service.js:443-451, ownership checked only on the client until it was found to be an IDOR).

**Verifier:** CONFIRMED — aur jitna objection keh raha hai, gap usse thoda BADA hai.

MAINE REFUTE karne ki poori koshish ki. Do raaste band karne ki koshish ki, dono band nahi hue:

(1) "Design me rule likha hai, UI affordance nahi." — Nahi. 08d line 84-86 par rule hai ("Aakhri bacha hua reject NAHI kar sakta"), par mechanism sirf UI ki bhasha me hai ("reject ka button hi nahi"). Aur design ne atomicity SIRF accept ke liye maangi hai — line 131-134: "task par ek hi claim chalega (atomic)... Do log ek task kabhi nahi le sakte". Reject ke liye ek shabd nahi. Ye asymmetry design me likhi hui hai, implementer isko literally hi banayega. Is repo ka apna precedent bhi yahi kehta hai: markSeen ka guard client-only tha (task.service.js:447-451 ka comment khud likhta hai "anyone could read any task... just by asking to mark it seen"), aur awardOnce ka docstring (bonus.service.js:493-496) likhta hai "Two Lambdas running the same scan at the same instant both used to find nothing and both insert" — yaani ye read-modify-write race is deployment me pehle ho chuki hai, kaalpanik nahi.

(2) "Candidates LIVE hain, to set khud bhar jaayega." — Nahi. Live hone se set SIRF ghat sakta hai, badh nahi sakta (naya owner-tier account bane bina). Aur auto-transfer ki shart "EXACTLY ek bacha" hai; set 2 se seedha 0 par gaya to wo shart kabhi TRUE hoti hi nahi — chahe usse har poll par evaluate karo. Design me "candidates = 0" ke liye koi niyam hai hi nahi. Rule 2 ke liye fallback likha hai (line 72-74), Rule 3 ke exhaust hone ke liye kuch nahi.

TEESRA DARWAZA jo objection ne miss kiya (aur jo atomic-reject fix ke BAAD bhi khula rehta hai):
Owner-tier `ownerRoleKeys()` se aata hai = min-rank wale roles (roles.js:136-140), aur members `User.find({role: {$in: keys}})` (bonus.service.js:527-534) — yaani membership LIVE hai. Maan lo tier = {Aamir, Kalpana, Rahul}. Aamir reject karta hai (2 bache, rule allow karta hai). Uske baad Kalpana aur Rahul deactivate/role-change ho jaate hain. Ab candidates = {} — bina kisi race ke, bina kisi direct API call ke, aur "aakhri wala reject nahi kar sakta" guard ne kuch galat hone nahi diya. Isliye sirf reject ko atomic bana dena kaafi NAHI hai; empty-set ka apna niyam chahiye.

TERMINAL HAALAT KI ASLI KEEMAT (code se verify ki, Sneha wala scenario):
Task R: owner Sneha, requiresApproval true, due 2026-08-20. Manish delete hote hi user.service.js:351 `assignedBy: null, assignerDeleted: true` likh deta hai (aur uski apni copy line 337 par pehle hi mit chuki hoti hai). Ab agar R hamesha ke liye stranded raha:
- 19 Aug ko Sneha "Done" dabaati hai → setStatus ka approval branch chalta hi nahi, kyunki shart me `task.assignedBy` hai (task.service.js:314) → approval gate BYPASS, task seedha DONE.
- onAssignedTaskDone pehli line par hi return kar deta hai: `if (!b.enabled || !task.assignedBy) return;` (bonus.service.js:619) → Sneha ka assignedTaskOnTime reward (CEO ne jo value set ki, audits me +10) KABHI likha hi nahi jaata. Ye "freeze" ki wajah se nahi — code hi assignedBy maangta hai.
- deleteTask ka guard `if (task.assignedBy && !isAssigner)` (task.service.js:864-867) ab false hai, aur Sneha owner hai → wo delegated task khud DELETE kar sakti hai, jo onAssignedTaskUndone bhi chala deta hai (task.service.js:875).
Yaani stranded task theek wahi haalat wapas le aata hai jo 08d line 23-24 me problem statement ke roop me likhi hai ("koi zimmedaar nahi bachta... jisne kaam kiya uske points ud jaate hain"). Achha hissa: pehle se likhe points nahi mitte — pruneOrphanTaskEntries me `assignerDeleted ? true` (bonus.service.js:1709) unhe bacha leta hai. Nuksaan sirf "jo milna tha wo kabhi likha hi nahi gaya" ka hai, plus approval-gate ka bypass.

Ek imaandar sudhaar objection me: "forever" thoda strong hai — naya owner-tier account banne par wo insaan live candidate ban jaayega. Par reminder candidates ko jaata hai (line 87), candidates khali hain, to kisi ko pata hi nahi chalega ki kuch karna hai. Practically permanent.

Isliye RED: design "strand work" allow karta hai, apne hi likhe invariant (line 89: "Isi rule se task kabhi bina maalik ke nahi reh sakta") ke khilaaf.

**Design me kya badle:** Do line ka addition, dono Niyam 3 me (koi rejected design dobara nahi):

1. **Empty-set backstop (asli fix, teenon darwaze band karta hai).** Design me ek naya vaakya: "Agar kabhi live candidate set KHALI ho jaaye (race, seedha API call, ya owner-tier ka ghat jaana) — to reject-list turant saaf ho jaayegi aur task apne aap sabse senior ACTIVE owner-tier insaan ke paas chala jaayega, aur use 'ye kaam ab aapke paas hain' wale (information-only) hisse me dikhaya jaayega." Ye shart wahin evaluate hogi jahan candidates waise bhi live nikalte hain — modal/poll ka read aur roz wala reminder job. Isse "exactly 1 bacha" wali shart par nirbharta khatam ho jaati hai; 2→0 waali chhalaang bhi cover ho jaati hai.

2. **"Aakhri wala reject nahi kar sakta" SERVER par, ek hi atomic write me.** Design me likho ki reject bhi wahi conditional-claim pattern use karega jo accept ke liye maanga gaya hai aur jo repo me pehle se chal raha hai (dayDigest.service.js:36-43, holiday.service.js:27-28, announcement.service.js:58-65): ek `Task.findOneAndUpdate` jo tabhi match kare jab actor ke `$addToSet` ke baad bhi kam se kam ek candidate bachta ho; match na ho to request wahin uski ACCEPT ban jaati hai ("aapke alawa koi bacha nahi — ye task aapka") aur usko bata diya jaata hai. Button chhupana sirf courtesy hai, guard nahi.

Point 1 akela bhi invariant bacha leta hai; point 2 usse pehle hi race/IDOR ko rok deta hai, aur dono milakar ~10 line ka design text hai.

---

## 16. [RED] A DEACTIVATED owner-tier account is a first-class candidate and can win the auto-transfer — the approval gate then sits with somebody who cannot sign in, while the assignee bleeds a daily drip

lens: claim-flow · `backend/src/services/bonus.service.js`:530

**Scenario:** Owner tier role CEO_PRESIDENT is held by Aamir and Kalpana. Kalpana retires: deactivated 2026-09-01 (she must be, before she can be deleted — user.service.js:325). 2026-09-02 Manish Saini (Admin Manager) is deleted; his task R {owner: Sneha, assignedBy: Manish, dueYMD 2026-09-10, requiresApproval TRUE, no chain, no tag} enters Rule 3. The codebase's own owner-tier resolver is `User.find({ role: { $in: ownerRoleKeys() } })` with no isActive filter (bonus.service.js:528-534), so Kalpana is a candidate. 2026-09-03 Aamir rejects ('vendor kaam Kalpana ka hai') -> exactly one candidate remains -> auto-transfer to Kalpana, who is 'told, not asked'. She can never be told: the auth middleware 401s a deactivated account (backend/src/middleware/auth.js:35), and when she is finally deleted every Notification of hers is dropped anyway (user.service.js:338). Now R.assignedBy = Kalpana. Sneha finishes two days EARLY, 2026-09-08: setStatus:314 fires (assignedBy is non-null), submittedAt = 08 Sep, TASK_APPROVAL goes to Kalpana. reviewTask (task.service.js:389-390) lets only `assignedBy` review, so nobody — not even Aamir — can approve it. And scanOverdueTasks deliberately does NOT skip submitted work (bonus.service.js:1024-1030): status is still PENDING, assignedBy is non-null, and chainEligible is TRUE because ownerTierIds still contains the deactivated Kalpana. So on 2026-09-12 Sneha takes the -5 mark (overdueDayFor('2026-09-10', grace 1)), and because dueYMD >= the 2026-08-01 drip floor she takes -1 EVERY day after that (bonus.service.js:1064-1066): by 31 Oct that is -5 - 49 = -54, and carryInFor (bonus.service.js:92-106) compounds the negative month into every later month's standing. For work she delivered on time. If Kalpana is then deleted, deleteUser clears assignedBy and R re-enters Rule 3 — with Aamir's rejection already on record, which the design never says is reset, giving zero candidates and the terminal state of finding 1.

**Verifier:** CONFIRMED. Maine ise refute karne ki poori koshish ki — do raaste dhoonde (design ka apna "band account" wala vaada, aur reachability) — dono par objection zinda bacha.

**1. Design ke andar hi contradiction hai (yeh sabse mazboot proof hai)**

- Niyam 1, `08d:58` — deactivated ko explicitly SKIP karta hai: "Agar Manager A khud deactivated ho: aur upar chalo".
- Niyam 2, `08d:72-74` — intent bhi likha hai: "code me ek surakshit fallback rahega (aisa hua to Niyam 3), **taaki kaam kabhi kisi band account ko na chala jaaye**".
- Niyam 3, `08d:79` — par jo niyam asli me insaan CHUNTA hai, uski definition sirf role test hai: "Candidates = abhi jo bhi owner-tier me hain". `isActive` ka koi zikr nahi — na request-list me, na `08d:91` ke auto-transfer target me, na `08d:86` ki "sirf ek hi insaan" wali shortcut me.

Yaani Niyam 2 ka fallback **circular** hai: wo Niyam 3 par girta hai taaki band account se bacha jaaye, par Niyam 3 khud band account ko chun sakta hai. Teen me se do niyamo me guard hai, aur jo teesra actually assign karta hai usme nahi. 08b/08c dono isi tarah ki khaali jagah par toote the.

**2. Codebase ka resolver sach me unfiltered hai — aur yeh ambiguity real hai**

`bonus.service.js:527-534` — `User.find({ role: { $in: ownerRoleKeys() } })`, koi `isActive` nahi. Ye ek matra maujooda owner-tier resolver hai.
Uske ulat `leave.service.js:449` — jab owner-tier ko **kaam** bhejna hota hai: `User.find({ isActive: true, role: { $in: roleKeys } })`.
To codebase me dono shakl maujood hain. Design ko batana PADEGA ki Niyam 3 kaun si hai; abhi nahi batata, aur implementer ke haath me sabse paas wala (unfiltered) padega.

**3. Reachability — ye contrived state nahi, guaranteed state hai**

- Deactivation delete ki **hard precondition** hai: `user.service.js:325-327`. Matlab handover code sirf usi duniya me chalta hai jisme kam se kam ek deactivated account maujood hai.
- Do owner-tier users rakhna allowed hai: `permissions.js:127-130` me `tRank >= cRank` — rank-1 wala rank-1 role assign kar sakta hai (comment khud kehta hai "a rank-1 owner role (CEO_PRESIDENT) can create any role including another rank-1 role").
- Ek owner doosre owner ko deactivate/delete kar sakta hai: `user.service.js:198` (canActOnTarget) aur `:322`, dono `canAssignRole` par hain — same tier allowed.

**4. Scenario, numbers ke saath (Aamir + Kalpana, dono CEO_PRESIDENT)**

01 Sep 2026: Kalpana retire — deactivate (delete se pehle majboori). 02 Sep: Manish Saini delete; unka task R {owner: Sneha, assignedBy: Manish, dueYMD 2026-09-10, requiresApproval true, chain nahi, tag nahi} Niyam 3 me jaata hai. 03 Sep: Aamir reject karta hai → ek candidate bacha → `08d:91` ke hisaab se **auto-transfer Kalpana ko**, "bataya jaayega" ke saath.

- **Bataya ja hi nahi sakta**: `auth.js:35` (`!user.isActive` → 401) — Kalpana login nahi kar sakti. Aur baad me delete hui to `user.service.js:338` uski har Notification uda deta hai. Design ka apna vaada "kisi ko kaam chupchaap nahi milega" (`08d:94-107`) yahan **construction se hi** toot jaata hai.
- **Kaam permanently strand**: `task.service.js:389-390` — `if (!isAssigner) throw 403`. Us function me koi admin/owner override nahi hai. assignedBy = Kalpana → R kabhi DONE nahi ho sakta, chahe Aamir khud baithe.
- **Sneha ke points bahte rehte hain, jabki usne kaam JALDI kiya**: 08 Sep ko submit (`setStatus:314-332`, TASK_APPROVAL Kalpana ko jaata hai — dead inbox). `Task.js:50-52` — `awaitingApproval` sirf virtual hai, `status` PENDING hi rehta hai. `scanOverdueTasks:1029-1030` ka filter sirf `status: 'PENDING'` hai aur `:1026-1028` ka comment saaf kehta hai submitted work skip **nahi** hota. Gate: `taskEligible:558` → `ownerIds.has(Kalpana)` = TRUE (kyunki :530 filtered nahi hai).
  - grace 1 (`Setting.js:73`) → duePlus 2026-09-11 → 12 Sep ko `overdueDayFor` = 2026-09-12, mark **-5**, month 2026-09.
  - Drip: `:1064` `today > addDays(duePlus,1)` → 13 Sep se; `dueYMD 2026-09-10 >= DRIP_FLOOR 2026-08-01` ✓. 13–30 Sep = 18 din, 1–31 Oct = 31 din = **-49**. Kul **-54**.
  - `carryInFor:92-106` — har negative month `min(0, net+carry)` bankar aage compound hota hai, to yeh Nov, Dec... har standing me ghusta hai.
- Live approver hota to yeh recover ho jaata (approve karte hi `onAssignedTaskDone` wahi `auto_task:<id>` dedupeKey replace kar deta). Dead approver ke saath **recovery ka koi raasta nahi**.
- LIMBO freeze (`08d:186`) yahan bachata nahi — freeze transfer par khatam ho jaata hai, aur transfer ho chuka hai.

Rubric ke hisaab se yeh RED hai: work stranded + points destroyed, dono, ek reachable path par.

**Design me kya badle:** **Sabse chhota badlav — Niyam 3 ki candidate definition me `isActive` jodo, aur points-gate ko HAATH MAT LAGAO.**

1. `08d:79` badlo: "Candidates = **abhi jo owner-tier me hain AUR jinka account active hai** (`role ∈ ownerRoleKeys() && isActive: true`)". Ye filter teeno jagah lagega, sirf request-list par nahi:
   - request kis-kis ko jaayegi,
   - `08d:91` ka auto-transfer target (aakhri bacha candidate),
   - `08d:86` ki "owner-tier me sirf ek hi insaan" wali shortcut.
   Isse Niyam 2 ka fallback (`08d:72-74`) circular nahi rehta.

2. **Chetavani design me likhni zaroori hai (warna fix khud RED ban jaayega):** ye active-filtered resolver Niyam 3 ke liye **naya** hoga — `bonus.service.js:527` ka `ownerTierIds()` **bilkul waisa hi rahega**. Wo points ka GATE hai, kaam baantne wali list nahi. Agar usme `isActive` laga diya, to deactivated owner ke assign kiye/tag kiye har purane task ka gate "haan" se "nahi" ho jaayega, aur `pruneOrphanTaskEntries` (`:1709`, `:1716`, `:1727`) unke saare PointEntry **hard-delete** kar dega — yaani is poore design ka core vaada ("kisi ke points nahi hilenge") khud tut jaayega. Do alag resolver: **gate = sirf role**, **handover = role + isActive**. (Precedent maujood hai: `leave.service.js:449`.)

3. Ek line aur: agar active owner-tier candidate **ek bhi na bache**, to auto-transfer mat karo — task limbo me hi rahe (points frozen, `08d:186` wali halat) aur handover-pending list me pada rahe, jab tak koi owner-tier account active na ho jaaye. Kisi band account ko dena is se bura hai, kyunki band account par pahunchte hi drip chalu ho jaata hai.

---

## 17. [RED] Rule 3's accept/auto-transfer flips the points gate FALSE -> TRUE whenever the departing assigner was not owner-tier — a penalty is back-filed into a closed month, or an award is invented

lens: claim-flow · `backend/src/services/bonus.service.js`:1054

**Scenario:** Owner tier = {Aamir (CEO & President)}. 2026-07-02 Manish Saini (Admin Manager, NOT owner-tier) assigns 'GST 3B filing - July', due 2026-07-10, to Junior Sneha -> R {owner: Sneha, assignedBy: Manish, forwardedFrom: null, collaborators: []}. She never finishes it. Gate BEFORE: taskEligible(R) — Manish is not in ownerIds, collaborators is empty -> false; chainEligible has no parent to walk -> false; scanOverdueTasks skips it at bonus.service.js:1038, so in six weeks R has never held a single PointEntry. That is the owner-tier rule working as intended: R is fully outside the points system. 2026-08-11 Manish is deleted -> no chain, no tag -> Rule 3, and Aamir is the only owner-tier person, so the design transfers it to him automatically ('bataya jaayega, poocha nahi'). R.assignedBy = Aamir. On the very next scheduler tick scanOverdueTasks now matches R (assignedBy non-null, PENDING, dueYMD set, no forward child — bonus.service.js:1030), chainEligible(R) is TRUE via Aamir, and `marked` finds nothing, so awardOnce writes -5 filed under overdueDayFor('2026-07-10', grace 1) = 2026-07-12, month '2026-07' (bonus.service.js:1051-1054). Sneha's July — rolled up and closed on 1 Aug — drops by 5 on 12 August, and carryInFor (bonus.service.js:92-106) pushes that new July deficit into her August and September net, so her header badge, the leaderboard and any July report already downloaded (periodPoints -> leaderboard, bonus.service.js:476) all disagree with what they said yesterday. Mirror case, same trigger: if R had been finished on 2026-08-05, the transfer puts it inside rescoreAllDoneAssigned's root window ({status DONE, assignedBy non-null, forwardedFrom null, completedAt >= now-45d} — bonus.service.js:1626) and the next nightly pass writes Sneha a +10 assignedTaskOnTime she was never entitled to. Sneha did nothing; the entire cause is that a CEO now sits in the assignedBy field.

**Verifier:** Maine isko refute karne ki poori koshish ki — nahi hua. Objection sahi hai, do chhoti factual corrections ke saath (neeche).

**1. Mechanism confirm hai: Rule 3 ko `assignedBy` hi likhna padega.**
- `reviewTask` approval authority sirf isi field se deta hai: `const isAssigner = task.assignedBy && String(task.assignedBy) === String(actor._id); if (!isAssigner) throw 403` — task.service.js:389-390. Rule 5 ("approval ki shart bani rahegi, ab naya zimmedaar approve karega") sirf tabhi kaam karta hai jab accepter `assignedBy` me baithe.
- Approvals queue bhi wahi: `if (scope === 'assigned') and.push({ assignedBy: actor._id })` (task.service.js:940) + `awaiting` clause (task.service.js:977-978). Kisi doosre field (08c ka `handedOverTo`) me daalne se ye dono toot jaate hain — wahi to revert hua tha.
- Rule 1 ke liye document khud kehta hai "`assignedBy` us task ke owner ka" (08d:47-48), to Rule 3 ka accept bhi wahi field likhega.

**2. Gate ka pehla arm wahi field hai.** `taskEligible`: `if (task.assignedBy && ownerIds.has(String(task.assignedBy))) return true;` — bonus.service.js:558. Yani jis task ka departing assigner owner-tier NAHI tha, uska gate accept ke baad FALSE → TRUE ho jaata hai. Design ka apna governing rule (08d:34, "gate ka jawab wahi rehta hai jo pehle tha") isi jagah toot-ta hai, aur document gate ki baat sirf Niyam 1 (08d:50-63) aur Niyam 4 (08d:138-152) me karta hai — Niyam 3 me ek line bhi nahi.

Ye Rule 1/2 par nahi lagta, isliye ye pattern-matching nahi hai:
- Rule 1: child ka `forwardedFrom` zinda ancestor par jud-ta hai aur `assignedBy` us ancestor ka owner — `chainEligible` (bonus.service.js:567-583) upar chal kar wahi purana jawab deta hai. Fallback `originalAssignedBy` bhi *purana* insaan hai, naya nahi.
- Rule 2: owner-tier tagged hai to `taskEligible` pehle bhi collaborators arm (bonus.service.js:559) se TRUE tha, baad me bhi TRUE. Koi flip nahi.
- Rule 3 hi ek matra rule hai jo zaroori taur par ek NAYE owner-tier insaan ko `assignedBy` banata hai. Aur plain assigned task par `originalAssignedBy` hota hi nahi (sirf `forwardTask` stamp karta hai — task.service.js:529, Task.js:39), isliye Rule 1 wala bachaav yahan available bhi nahi hai.

**3. Scenario, code line-by-line verify kiya (owner tier = {Khaan Aamir}, grace 1, assignedTaskLate 5, assignedTaskOnTime 10):**

BEFORE — 2026-07-02, Manish Saini (Admin Manager, non-owner-tier) Sneha ko "GST 3B filing – July" deta hai, due 2026-07-10, collaborators []. `scanOverdueTasks` ki query me task aata hai (assignedBy non-null, PENDING, dueYMD set, forward-parent nahi — bonus.service.js:1030), `duePlus = 2026-07-11 < today` bhi pass, par `chainEligible` FALSE (Manish ownerIds me nahi, collaborators khaali, forwardedFrom null) → `continue` bonus.service.js:1038. 6 hafte me ek bhi PointEntry nahi. Aaj bhi delete ke baad kuch nahi hota, kyunki `deleteUser` `assignedBy: null` set karta hai (user.service.js:351) aur teenon writers `assignedBy: {$ne: null}` maangte hain (1030, 1626, 619).

AFTER — 2026-08-11 Manish delete, no chain + no tag → Rule 3, aur Aamir akela candidate → auto-transfer, `assignedBy = Aamir`. Agle scheduler tick par:
`chainEligible` TRUE → `marked = null` (bonus.service.js:1045) → `overdueDayFor('2026-07-10', 1) = '2026-07-12'`, `APP_LIVE_YMD = '2026-07-01'` (lib/appLive.js:13) se bada hai to clamp nahi hota → `awardOnce('auto_task:<R>', { user: Sneha, month: '2026-07', points: -5, earnedYMD: '2026-07-12' })` — bonus.service.js:1051-1054. Sneha ka July, jo 1 Aug ko roll ho chuka tha, 12 August ko -5 gir jaata hai. `leaderboard` (bonus.service.js:430-448) aur `periodPoints` monthly (bonus.service.js:471-477) dono live PointEntry se bante hain, koi month-close nahi hai — to 1 Aug ko download ki hui July report aaj ke figure se alag ho jaati hai. Sneha ne kuch nahi kiya; poori wajah sirf itni hai ki `assignedBy` me ab ek CEO baitha hai.

Invented AWARD wali shakl bhi asli hai: Rule-3 se transfer hua PENDING task jab Sneha 2026-08-20 ko band karti hai (due 2026-08-25), `setStatus` → `onAssignedTaskDone` → gate TRUE → +10 `assignedTaskOnTime` — jo delete se pehle 0 tha.

**Do corrections objection me:**
(a) Mirror case jaisa likha hai waisa nahi chalega: usi R ko (due 2026-07-10) 2026-08-05 ko DONE karne par `late` TRUE hota hai (bonus.service.js:652) aur `filedYMD = overdueDayFor(...) = 2026-07-12` → +10 nahi, -5 July me. Invented +10 ke liye due date aage honi chahiye (upar wala 2026-08-25 wala variant), ya `rescoreAllDoneAssigned` (bonus.service.js:1626) wala raasta on-time DONE task par.
(b) "carryInFor August/September me push karega" tabhi hota hai jab naya July net negative ho jaaye — `carry = Math.min(0, month + carry)` (bonus.service.js:103). July leaderboard/report ka badalna unconditional hai; cascade conditional hai. Verdict par koi asar nahi.

**Design me kya badle:** Rule 3 me ek line jodo: **handover se gate ka jawab kabhi nahi badlega.**

Mechanically (sabse chhota change, `assignedBy` ko haath lagaye bina):
1. **Delete se PEHLE** (yani `Task.deleteMany({ owner: uid })` — user.service.js:337 — se pehle, aur `user.deleteOne()` — user.service.js:360 — se pehle, taaki role lookup me jaane wala abhi bhi maujood ho) har affected task ka `chainEligible(task, ownerIds)` ka jawab padh lo.
2. Jin Rule-3 tasks ka jawab **FALSE** tha, sirf unhi par ek naya boolean stamp karo, e.g. `assignerFromHandover: true` (Task.js me naya field, `assignerDeleted` ke bagal me). Jawab TRUE tha to kuch mat likho — stamp sirf "bahar rehne" ka marker hai, andar laane ka kabhi nahi (fail-safe).
3. `taskEligible` (bonus.service.js:555-560) me sirf pehla arm skip karo:
   `if (task.assignedBy && !task.assignerFromHandover && ownerIds.has(String(task.assignedBy))) return true;`
   collaborators wala arm (line 559) waisa hi rahe — matlab aage chal kar CEO khud ko tag kare to gate imaandari se TRUE ho jaayega, kyunki wo ek naya asli fact hai.

Yahi ek jagah kaafi hai: har writer isi function se hokar jaata hai — `chainEligible` (:568, :579) → `scanOverdueTasks` (:1038), `backfillOverdueRuleV2` (:1095), `rebuildOverdueForTask` (:728), `pruneOrphanTaskEntries` (:1709); aur `onAssignedTaskDone` (:632) seedha. Isliye ye "sirf prune padhta hai" wala rejected freeze-flag nahi hai — ye gate ka single chokepoint hai. Approvals (task.service.js:389), Approvals queue (:940/:977), sidebar count, notifications — kisi ko chhua tak nahi jaata, kyunki `assignedBy` accepter ka hi rehta hai.

Nazuk baat: step 1 ka jawab **jaane wale ke User row rehte hue** nikalna hai (`ownerTierIds` 60s cache — bonus.service.js:527-534). Isse departing person agar khud owner-tier tha to jawab TRUE aayega, stamp nahi lagega, aur uska task transfer ke baad theek se score karta rahega — jo sahi hai (pehle bhi TRUE tha).

---

## 18. [RED] LIMBO does not freeze anything one hop down: assignerDeleted is invisible to chainEligible, so the nightly prune hard-deletes the descendants' points on the first night of the request window

lens: claim-flow · `backend/src/services/bonus.service.js`:1709

**Scenario:** Owner tier = {Manish Saini, Aamir}, both CEO & President. 2026-07-05 Manish assigns 'Dhanbad site survey', due 2026-07-25, to Manager Priyanshi -> R {owner: Priyanshi, assignedBy: Manish, collaborators: []}. 2026-07-08 Priyanshi forwards to Junior Rahul -> C {owner: Rahul, assignedBy: Priyanshi, forwardedFrom: R}; forwardTask copies no collaborators (task.service.js:522-532), so C's only route to the gate is the walk up to R. Rahul delivers 2026-07-20, settleParent closes R, onAssignedTaskDone(R) pays Priyanshi auto_forward:R +3 and Rahul auto_task:C +10, both filed 2026-07-20 / month '2026-07'. July closes. 2026-08-11 Manish is deleted: he owns no copy in this chain, so Task.deleteMany({owner: uid}) (user.service.js:337) leaves R standing and the detach sets R.assignedBy = null, R.assignerDeleted = true (user.service.js:351). R has no chain above it and no owner-tier tag -> Rule 3 -> the request goes to Aamir, who is on site and does not open the modal for four days. That same night maybeRunDaily reaches pruneOrphanTaskEntries (bonus.service.js:1773): R's own entry is spared by the assignerDeleted hatch (:1709), but C's is not — C.assignerDeleted is false, so the hatch does not apply and chainEligible(C) is re-derived live: taskEligible(C) false (Priyanshi is not owner-tier, collaborators empty) -> walk to R -> taskEligible(R) false (assignedBy is now null, collaborators empty) -> R.forwardedFrom is null so the walk ends -> FALSE. C's entry is pushed to `dead` at bonus.service.js:1716 and Rahul's +10 is hard-deleted out of a closed July, with no user action at all. Aamir accepting on 2026-08-15 happens to restore it — rescoreAllDoneAssigned re-runs onAssignedTaskDone(R) because R is DONE, assignedBy is non-null again and completedAt is inside the 45-day window (bonus.service.js:1626) — but that is luck, not design: a request left open longer than 45 days from the completion loses the award for good, and on a LATE chain the auto_overdue drip rows deleted by the same pass are never rebuilt by any path the accept touches (only rebuildOverdueForTask writes them back, bonus.service.js:749, and nothing calls it here) — so the assignee is quietly FORGIVEN penalties, which is the invent-points direction of the same hole.

**Verifier:** CONFIRMED — par objection ka scenario ek jagah galat hai, aur usko theek karne ke baad defect aur bhi bura nikalta hai. Maine ise refute karne ki chaar koshishein kin, chaaron fail hueen.

SCENARIO KI GALTI (aur uska sudhaar): objection owner tier = {Manish, Aamir} likhta hai. Us shakl me design KHUD bacha leta hai — Manish delete hote hi Aamir ekmatra candidate bachta hai aur 08d:86,91 kehta hai "sirf ek insaan ho to seedha uske paas", yaani deleteUser ke andar hi assignedBy set ho jaata (koi limbo hi nahi). Window ke liye kam se kam DO surviving owner-tier chahiye — jo design khud maanta hai (08d:84-85 ka owner quote: Kalpana reject kare to Khaan Aamir ko mandatory). To sahi scenario: owner tier = {Manish Saini, Kalpana, Khaan Aamir}, teenon top-rank role par (ownerRoleKeys lib/roles.js:136-140 min-rank role keys deta hai, aur ek hi role par kai users ho sakte hain).

VERIFIED CHAIN (sab padha):
1. 2026-07-05 Manish (owner-tier) 'Dhanbad site survey' (due 2026-07-25) Priyanshi ko deta hai. Assign sirf assignee ki EK copy banata hai — assigner ki apni koi copy nahi (task.service.js:170-180). R {owner: Priyanshi, assignedBy: Manish, collaborators: [], forwardedFrom: null}.
2. 2026-07-08 Priyanshi Rahul ko forward — C {owner: Rahul, assignedBy: Priyanshi, forwardedFrom: R}; forwardTask collaborators copy karta hi nahi (task.service.js:522-532), to C ka gate tak ka ekmatra raasta R hai.
3. 2026-07-20 Rahul deliver, chain settle, onAssignedTaskDone(R) → Priyanshi auto_forward taskRef=R +3, Rahul auto_task taskRef=C +10, dono month '2026-07' (bonus.service.js:659-694, taskRef: copy._id line 691). July band.
4. 2026-08-11 Kalpana, Manish ko delete karti hai. Task.deleteMany({owner: Manish}) R ko chhoota nahi (R.owner = Priyanshi) — user.service.js:337. Detach: R.assignedBy = null, R.assignerDeleted = true (user.service.js:351). R ke upar koi task nahi, koi owner-tier tag nahi → Niyam 3 → Kalpana + Aamir dono ko request. Kalpana 12 Aug ko reject karti hai, Aamir site par hai.
5. Usi raat maybeRunDaily → pruneOrphanTaskEntries (bonus.service.js:1773). Dono entries scan me aati hain (:1679-1692). R: assignerDeleted true → :1709 ka hatch → eligible=true → Priyanshi ka +3 BACH JAATA hai. C: C.assignedBy = Priyanshi (non-null) aur C.assignerDeleted false → hatch lagta hi nahi → chainEligible(C) live derive: taskEligible(C) false (Priyanshi owner-tier nahi, collaborators khaali — :555-560) → parent R load hota hai projection `assignedBy collaborators forwardedFrom` se (:575; assignerDeleted na select hota hai na taskEligible use padhta hai) → R.assignedBy ab null → false → R.forwardedFrom null → walk khatam → FALSE. :1716 par dead.push, :1727 par bina kisi month bound ke deleteMany. Rahul ka +10 band ho chuke July se hard-delete — request window ke PEHLE hi din, bina kisi user action ke.

Yaani freeze ("na kuch mitega") ka koi carrier nahi hai: maujooda ekmatra fact assignerDeleted sirf UNS row par lagta hai jiska assignedBy nulla hua, aur gate ke upar-walk me wo invisible hai. Asymmetry hi proof hai: forward karne wale Priyanshi ke +3 bache, jisne kaam kiya us Rahul ke +10 gaye.

REFUTATION ATTEMPTS (sab fail):
(a) "Niyam 4 cover karta hai" — nahi. Niyam 4 TAG neeche utaarta hai; yahan tag hai hi nahi, mara hua link ASSIGNER hai. 08e ne yahi do-hisso wali sifarish di thi (08e:586-598) aur 08d ne sirf tag wala aadha hissa liya — step 3 ("assignerDeleted ko prune se uthakar taskEligible me lao", 08e:598) design me kahin nahi hai.
(b) "Niyam 1 R ko theek kar dega" — nahi. Manish ki koi copy hi nahi thi, to splice karne ko link nahi; R ka originalAssignedBy bhi null hai (wo sirf forwardTask likhta hai, task.service.js:529).
(c) "Accept sab lauta dega" — sirf ittefaq se. Wapasi ka ekmatra raasta rescoreAllDoneAssigned hai, jiski query `completedAt >= now-45d` AUR `assignedBy: {$ne: null}` hai (:1625-1626). 20 Jul + 15 Aug accept = 26 din, window ke andar, to lautta hai (ek daily tick baad). Par wahi chain agar 2026-05-10 ko DONE hui hoti, to accept ke baad bhi kuch nahi lautta — R us query me aata hi nahi, aur onAssignedTaskDone :619/:621 bhi kahin se call nahi hota. HAMESHA KA nuksaan. Aur design DONE tasks ke baare me chup hai (08d:17-24 sirf "chase/approve/band karne wala" ki baat karta hai) — agar handover sirf OPEN kaam ke liye chala, to DONE chain kabhi Niyam 3 me aayegi hi nahi, koi accept hi nahi hoga, aur nuksaan bina kisi window ke pakka hai.
(d) "Prune sirf positive award maarta hai / drips safe hain" — nahi, ulta direction bhi khula hai. Drips ka source bhi 'auto_task' hai (:751, :1066), yaani TASK_SOURCES ke andar, aur :1716 ka eligibility branch sign check (:1724) se PEHLE chalta hai. To agar chain limbo me PENDING+overdue ho, C ka -5 mark aur saare -1 drips bhi delete ho jaate hain; limbo me scanOverdueTasks :1038 par chainEligible false hone se naye drip likhta bhi nahi; accept ke baad wo sirf AAJ ka drip (:1064-1066) aur mark (:1045-1054) wapas laata hai — beete dinon ke drips koi nahi likhta, kyunki rebuildOverdueForTask :726 par `t.forwardedFrom` dekhte hi return kar deta hai (forwarded child ke liye wo kabhi chalta hi nahi). 10 din overdue = -10 chupchaap maaf. Yaani ek hi chhed se dono taraf — points bhi udte hain aur penalty bhi maaf hoti hai.

KYUN RED: nuksaan ki class bilkul wahi hai jo design maarne aaya tha (B1/B2), aur wo design ki "sabse important property" ke andar dobara ban raha hai — closed month se, silent, ek admin click par, aur purani chain par irreversible. Ye current prod se regression nahi hai (aaj bhi yahi hota hai), par design ka core vaada as-written poora nahi hota, aur shipping ke baad system "deletion-safe" dikhega jabki wahi button abhi bhi doer ke points jala raha hoga.

**Design me kya badle:** SABSE CHHOTA BADLAAV — freeze ko ek NAAM do jo GATE padhe, prune nahi (aur ye 08e:586-598 ki un-adopted aadhi sifarish hi hai):

1. deleteUser me, delete se PEHLE derive karo ki jaane wala us waqt owner-tier tha ya nahi. Agar tha, to har us task par jahan uska link gate satisfy kar raha tha — `{assignedBy: uid}` aur usi tarah `{collaborators: uid}` — Niyam 6 wali departed-persons list me `tier: 'owner'` bhi likho. Naya field nahi chahiye: list design me pehle se hai (08d:167-177).
2. `taskEligible` (bonus.service.js:555-560) me EK line: task par departed owner-tier link maujood hai → true. Isse limbo apne aap freeze ho jaata hai — na kuch mitta hai, na banta hai — kyunki gate ka jawab wahi rehta hai jo delete se pehle tha.
3. `chainEligible` ke parent projection (:575) me wo field zaroor add karo, warna upar ka walk use dekh hi nahi payega — yahi ek line poore descendant ka bachaav hai (chainEligible har hop par :568/:579 se yahi taskEligible bulata hai, to koi alag propagation code nahi chahiye; is se Niyam 4 ka tag-carry-down points ke liye redundant bhi ho jaata hai).
4. Accept par ye fact MAT mitao. Niyam 1 me naya assignedBy ek non-owner manager ho sakta hai; mitane par gate ulta palat jaayega. Fact "is task ka gate-link ek owner-tier insaan tha jo ja chuka hai" hamesha sach rahega — isliye ye kabhi invent nahi karta, sirf sanjoye rakhta hai.
5. Consistency: prune ka blanket `t.assignerDeleted ? true` (:1709) isi owner-tier qualifier par narrow karo. Warna (i) prune aur award path (:632) alag jawab denge — wahi split-brain jisne (b) ko dubaya, aur (ii) non-owner-tier assigner ke delete hone par blanket-true out-of-scope task ko andar khheench lega = points invent.
6. Design doc me ek line saaf likho: ye fact DONE tasks par bhi lagta hai, chahe handover request sirf open kaam ke liye chale — warna band ho chuki chain ka nuksaan kabhi kisi accept se lautega hi nahi (rescore :1626 ki 45-din window bahar).

Ye rejected (a) nahi hai — assignedBy kisi arbitrary successor par nahi jaata, "kisne diya tha" aur access control dono nahi badalte. Ye rejected (b) bhi nahi hai — (b) ka flag sirf prune padhti thi aur chain me neeche nahi jaata tha; yahan fact `taskEligible` me baithta hai, jo award path (:632), prune (:1709) aur poore chain-walk (:568/:579) ka single choke point hai.

---

## 19. [RED] Limbo freezes PointEntry but not the TASK: with assignedBy null the assignee can delete the task, self-close an approval-gated one, or tag a colleague who reopens it — each of which deletes point entries inside the window

lens: claim-flow · `backend/src/services/task.service.js`:864

**Scenario:** Sneha is 13 days overdue on 'Bokaro RCC checklist' (due 2026-07-10, grace 1): the -5 mark filed 2026-07-12 plus 8 drip days = -13 sitting in her ledger. 2026-08-11 Manish Saini, who assigned it, is deleted; Rule 3 opens a request to Aamir and Kalpana. Before either opens the modal, Sneha opens the task in her own To-Do and deletes it: deleteTask's first guard `if (task.assignedBy && !isAssigner)` does not fire because assignedBy is null, the second passes because she is the owner, the row is removed at :874 and onAssignedTaskUndone at :875 runs PointEntry.deleteMany({taskRef, source: ['auto_task','auto_forward']}) — her -13 is gone, inside the window the design calls 'sabse naazuk hissa', where nothing is supposed to be created or deleted. The work also vanishes from the candidates' modal, so the handover request silently evaporates. Variants of the same hole: she marks it Done and the approval branch at :314 is skipped (assignedBy null), so an approval-gated task closes with no reviewer and pays nobody (bonus.service.js:619); or she adds a colleague at :843 and that colleague reopens it via setStatus's sharedPersonal path, firing onAssignedTaskUndone at :367.

**Verifier:** Maine ise teen tarah se refute karne ki koshish ki — (1) shayad Rule 3 wale task par points hote hi nahi, (2) shayad UI assignee ko delete/undo ka rasta deti hi nahi, (3) shayad limbo itna chhota hai ki window practical nahi. Teenon band nikle. Objection sahi hai, aur maine ise MEDIUM se RED kiya hai (wajah neeche).

REACHABILITY — Rule 3 wale task par points HOTE hain. Gate ke do arm hain: `taskEligible` = owner-tier assigner YA owner-tier tag (bonus.service.js:555-560). Rule 3 ki definition hi "chain nahi + tag nahi" hai, to jo Rule 3 task points system me hai uska assigner KHUD owner-tier tha. `ownerTierIds()` (bonus.service.js:527-534) `isActive` filter nahi karta, aur `deleteUser` sirf inactive + `canAssignRole` maangta hai (user.service.js:317-326) — yaani ek owner-tier account ka delete hona blocked nahi hai. To "owner-tier assigner gaya, do owner-tier bache, Rule 3 request khuli" bilkul reachable hai.

SCENARIO (numbers code se derive kiye, objection ke approximate numbers thoda fix karke). Owner tier = {Manish Saini (President), Khaan Aamir (CEO), Kalpana Sahu (President)}. graceDays 1, assignedTaskLate 5, assignedTaskOverdueDaily 1.
- 29 Jul 2026: Manish "Bokaro RCC checklist" Sneha Kumari ko deta hai, due 2026-08-02, koi forward nahi, koi tag nahi.
- duePlus = 2026-08-03. Mark = overdueDayFor = due+grace+1 = 2026-08-04, -5, month 2026-08 (bonus.service.js:1051-1054). Drip due>=DRIP_FLOOR (2026-08-01) hai (:1064), to 2026-08-05 se roz -1: 08-05..08-10 = 6 din.
- 11 Aug 2026 subah: Sneha ke ledger me 7 PointEntry rows, total -11, sabhi `source: 'auto_task'`, `taskRef` = ye task.
- 11 Aug: Manish delete. user.service.js:337 uski apni copies udaata hai; :351 Sneha ki copy par `{assignedBy: null, assignerDeleted: true}`. Design: forwardedFrom null → Rule 1 nahi; collaborators khali → Rule 2 nahi → Rule 3 → Aamir aur Kalpana ko request. LIMBO shuru, points "frozen at -11".
- 11 Aug 14:10, dono me se koi modal khole us se pehle: Sneha apni To-Do kholti hai. `t.assignedBy` falsy hone se row uske PERSONAL section me chali jaati hai (task-board.jsx:910-916), `canMgr = owner is me && !t.assignedBy` = true (:987), isliye row par pencil + trash render hote hain (:294, :363-372) aur detail dialog me bhi Delete (:580-582). Ye API-only exploit nahi, default UI hai.
- Trash → DELETE /tasks/:id (tasks.routes.js, controller me koi extra guard nahi, tasks.controller.js:156-159) → deleteTask: :864 `if (task.assignedBy && !isAssigner)` fire nahi hota kyunki assignedBy null hai; :867 pass (isOwner). :874 deleteOne → :875 `onAssignedTaskUndone(task._id)` → bonus.service.js:698 `PointEntry.deleteMany({ taskRef, source: { $in: ['auto_task','auto_forward'] } })` → saatoN rows (-5 mark + 6 drips) HARD DELETE. Uske baad :701 `rebuildOverdueForTask` → :725-726 `Task.findById` null → return, kuch wapas nahi banta. Aage bhi koi recovery nahi: `scanOverdueTasks` sirf live Tasks query karta hai (:1030), aur `pruneOrphanTaskEntries` to ulta aur mitata hai.
- Nateeja: jis window ko design "sabse naazuk hissa — na kuch mitega, na naya banega" kehta hai, usi ke andar Sneha ka August ledger -11 se 0 ho gaya (₹10/point par ₹110), aur handover request ka task hi nahi bacha — Aamir/Kalpana ke modal se row agle ~20s poll par chup-chaap gayab, na notification, na koi record ki Manish ka kaam kabhi tha.

DO AUR VARIANT (same root cause: limbo me `assignedBy: null` app ka universal "personal to-do" signature hai):
- requiresApproval wala: setStatus:314 me `task.assignedBy` chahiye → branch skip → :344-349 par task seedha DONE, koi reviewer nahi; `onAssignedTaskDone` :619 par `!task.assignedBy` se bail — koi award likha hi nahi jaata. Jab tak koi accept karega, approve karne ko kuch bacha hi nahi hoga → Rule 5 ka vaada khaali ho jaata hai.
- updateTask:843 (`isOwner && !task.assignedBy`) Sneha ko colleague tag karne deta hai; phir setStatus:276 ka `sharedPersonal = !task.assignedBy` us colleague ko close/reopen karne deta hai → :368 `onAssignedTaskUndone` → wahi deleteMany. Aur agar copy pehle se DONE thi (late completion ka -5 filed), to undo par UI ka confirmation dialog bhi nahi aata — task-board.jsx:1081 `t.assignedBy` maangta hai — ek tap me penalty gayab, aur :726 ki wajah se rebuild bhi nahi hoti.

OBJECTION KA "task-document par marker bhi bekaar" wala point bhi sach hai: row delete hote hi marker bhi gaya, aur pruneOrphanTaskEntries me `t` undefined → `keep = t && (...)` falsy → dead.push (bonus.service.js:1712-1727) → entries waise bhi reap ho jaate.

RED KYUN, MEDIUM KYUN NAHI: 08e ne apni analogous finding (#5, line 219) ko MEDIUM rakha tha is tark par ki "ye shape design ne banayi nahi, aaj bhi prod me yahi hai". Yahan wo tark nahi chalta, do wajah se — (i) design ka HEADLINE invariant yahi hai ("limbo me na kuch mitega na banega... ye is poore kaam ka sabse pehla test hoga"), aur likhe hue design ko implement karte hi wo test pehli koshish me fail hota hai; (ii) design ek NAYI cheez banata hai — pending handover request — jise assignee ek tap me destroy kar deta hai, aur wo request aaj prod me hai hi nahi. Yaani points loss + work destroyed, dono rubric ke RED arms.

**Design me kya badle:** Ek line design me jodni hai: LIMBO sirf PointEntry par nahi, TASK par bhi lagega.

Design ko handover-pending state ka naam waise bhi chahiye (modal, sidebar count, atomic claim sab usi par khade hain). Use Task document par likho — `handoverPending: true`, `assignerDeleted` ke saath usi write me set, aur accept/auto-transfer par clear. Phir har wo jagah jo "kya ye delegated kaam hai?" ka jawab `assignedBy` se leti hai, wo `assignedBy || handoverPending` padhe:

1. deleteTask (task.service.js:864) — mana karo: "iska assigner ja chuka hai, ye handover ka intezaar kar raha hai". Isi se points aur request dono bach jaate hain. Ye check row delete hone se PEHLE hona zaroori hai, kyunki row ke saath marker bhi mit jaata hai aur pruneOrphanTaskEntries (bonus.service.js:1712-1727) entries ko orphan padh kar reap kar deta hai.
2. updateTask (task.service.js:642) — assignee ka content edit mana; :843 ka collaborator-add bhi band (`!task.assignedBy && !task.handoverPending`).
3. setStatus (task.service.js:276) — `sharedPersonal` false rahe, taaki koi tagged colleague na band kar sake na reopen.
4. setStatus (task.service.js:314) — approval branch fire kare: `wantDone && requiresApproval && (task.assignedBy || task.handoverPending) && isOwner` → `submittedAt` stamp ho, notify skip (abhi koi assigner hai hi nahi). Rule 5 pehle se kehta hai ki atki hui submission naye zimmedaar ko re-notify hogi — accept hote hi wahi notification chali jaayegi.

Ye rejected design (a) NAHI hai: `assignedBy` me koi successor nahi likha ja raha, access control, "assigned by" display aur gate ka jawab teenon jyon ke tyon. Ye rejected design (b) bhi NAHI hai: flag POINTS gate ka jawab kabhi nahi deta — `taskEligible`/`chainEligible` (bonus.service.js:555-583) use padhte hi nahi, na koi point invent hota hai na bachta hai. Wo sirf "kya ye delegated kaam hai" ka jawab deta hai — theek wahi sawaal jo ye chaar guard aaj `assignedBy` se poochh rahe hain.

Saath me invariant likh do: jab tak handover pending hai, task ko koi delete, reopen, edit ya bina reviewer close nahi kar sakta.

---

## 20. [RED] Niyam 3 ka accept points-gate ON kar deta hai — band ho chuke mahine me −5 ghusa deta hai

lens: authority-ui · `backend/src/services/bonus.service.js`:555

**Scenario:** Priyanshi Patel (Senior Manager, owner-tier NAHI) 8 Jun 2026 ko Rahul Verma ko "GST reconciliation — June" deti hai, due 2026-06-20. Na koi forward, na koi CEO tagged. Aaj tak ye task points system se BAAHAR hai: taskEligible (bonus.service.js:555-560) — assignedBy owner-tier nahi, collaborators khaali — false; forwardedFrom null, to chainEligible bhi false; scanOverdueTasks line 1038 `continue` kar deta hai. Rahul ka June total (maan lo 34) chhua bhi nahi gaya, aur June ki leaderboard/report/Rewards page 1 Jul ko band ho gaye.

11 Aug 2026: Priyanshi ka account permanently delete. user.service.js:351 `assignedBy: null, assignerDeleted: true` likh deta hai. Chain nahi, tag nahi → Niyam 3 → Khaan Aamir + Kalpana Sharma ko request. 13 Aug ko Kalpana ACCEPT karti hai — Niyam 5 ke liye assignedBy = Kalpana (CEO_PRESIDENT) set karna hi padega, warna reviewTask (task.service.js:389-390) unhe approve nahi karne dega.

14 Aug, agla scheduler tick: scanOverdueTasks task ko uthata hai (assignedBy≠null, PENDING, dueYMD set), ab chainEligible → taskEligible → ownerIds.has(Kalpana) → TRUE. `marked` koi nahi. line 1051-1054: overdueDay = addDays('2026-06-20', 1+1) = '2026-06-22', month = '2026-06', points = −5, reason "Overdue: GST reconciliation — June".

Rahul ka June 34 se 29 ho jaata hai — chhe hafte pehle band hue mahine me. carryInFor (line 92-106) sirf negative carry karta hai, to agar June net negative ho gaya to July aur August dono neeche khisak jaate hain. periodPoints({type:'monthly'}) leaderboard se net leta hai, to June ki jo report PDF nikal chuki hai wo ab galat hai.

**Verifier:** ## Nateeja: CONFIRMED (RED) — par objection ka ek number galat hai

Mechanism poora sach hai. Sirf mahina galat bataya gaya hai (June nahi, July) — nuksaan bilkul wahi.

### 1. Gate ka jawab pehle: NAHI

`taskEligible` (bonus.service.js:555-560) ka pehla clause **live `assignedBy`** padhta hai:
```js
if (task.assignedBy && ownerIds.has(String(task.assignedBy))) return true;
return (task.collaborators || []).some((c) => ownerIds.has(String(c)));
```
Priyanshi (Senior Manager) ne diya, koi tag nahi, `forwardedFrom = null` → `chainEligible` ka loop (line 570) chalta hi nahi → **false**. `scanOverdueTasks` line 1038 `continue` kar deta hai. Task points system se poori tarah BAAHAR.

### 2. Design ko `assignedBy` set karna PADEGA — koi bachne ka raasta nahi

Ye maine specially check kiya, kyunki agar Niyam 3 ka accept `assignedBy` chhoo hi na paata to objection gir jaata. Do jagah band hai:
- `reviewTask` task.service.js:389-390 — `String(task.assignedBy) === String(actor._id)` warna 403. Niyam 5 (approval bani rahegi) iske bina chal hi nahi sakta.
- `setStatus` task.service.js:314 — `wantDone && task.requiresApproval && task.assignedBy` — agar `assignedBy` null chhod diya to approval gate **chupchaap bypass** ho jaata hai aur task seedha DONE.

Yaani Niyam 3 + Niyam 5 milkar `assignedBy = Kalpana` majboor karte hain. Aur gate ke paanchon call-site (632, 728, 1038, 1095, 1709) live `assignedBy` hi padhte hain.

### 3. false → true flip, aur band mahine me −5

**Sahi scenario (June wala clamp me phans jaata hai):** Priyanshi 8 Jun ko Rahul ko task deti hai, due **2026-07-15**, grace 1.
- 17 Jul ko overdue hua — par gate false tha, koi entry nahi. Rahul ka July net **34**. 1 Aug ko July band, report PDF nikal chuki.
- 11 Aug: Priyanshi delete → user.service.js:351 `assignedBy: null, assignerDeleted: true`. Limbo saaf hai (line 1030 ki query `assignedBy: { $ne: null }` maangti hai, `onAssignedTaskDone` line 619 `!task.assignedBy` par return) — **limbo me kuch nahi tootta**.
- 13 Aug: Kalpana (CEO) accept → `assignedBy = Kalpana`.
- 14 Aug scan: query match (assignedBy≠null, PENDING, dueYMD set, `forwardedParentIds` me nahi), `duePlus = 2026-07-16 < today`, `chainEligible → taskEligible → ownerIds.has(Kalpana) → TRUE`, `marked` koi nahi → line 1051-1054: `overdueDayFor('2026-07-15', 1) = '2026-07-17'`, month **'2026-07'**, points **−5**.
- Rahul ka July **34 → 29**. July negative hua to `carryInFor` (line 92-106) Aug aur Sep dono neeche khisakta hai; `periodPoints({type:'monthly'})` line 476 leaderboard ka NET leta hai, to July ki nikli hui report ab jhooth hai.

**Objection ka number galat kahan:** due `2026-06-20` par `overdueDayFor` (line 1013-1016) `APP_LIVE_YMD = '2026-07-01'` (lib/appLive.js:13) par clamp kar deta hai → month `'2026-07'`, `'2026-06'` nahi. June bacha rehta hai, July (jo utna hi band hai) pitta hai. Severity par koi asar nahi.

**Ulta case bhi sach:** due 2026-08-25 wala task Kalpana ke accept ke baad on-time complete ho to `onAssignedTaskDone` line 632 pehle `deleteMany` karke return karta tha, ab `assignedTaskOnTime` **AWARD** karega — points jo pehle the hi nahi.

**Prune bhi nahi bachata,** par 1709 wale short-circuit ki wajah se nahi: accept ke baad `chainEligible` khud `true` deta hai (Kalpana owner-tier hai), to `assignerDeleted` clause bemaani hai. Entry rahegi hi.

### 4. Design ka apna vaada tootta hai — aur sirf Niyam 3 par

Line 34: "Is design me gate ka jawab **wahi rehta hai jo pehle tha**." Line 186-187: "jab tak faisla nahi hota points ki halat jamee rahegi... **Accept hote hi normal chalu**." — yahi wo pal hai.
- **Niyam 1 sahi hai:** rishta wapas jodta hai, gate ka jawab nahi badalta.
- **Niyam 2 sahi hai:** tagged owner already `collaborators` clause (line 559) se gate pass kar raha tha — flip hai hi nahi.
- **Niyam 3 hi tootta hai**, kyunki wahan definition se koi purana rishta hai hi nahi. Aur single-candidate case me to koi button bhi nahi dabata — **poori tarah automatic** −5.

**Design me kya badle:** **Sabse chhota fix — sirf false→true direction rokni hai (ek field + ek clause).**

Niyam 3 (aur Niyam 2 ka fallback-to-3 raasta) me, jab kaam handover hota hai, **delete ke waqt** — `assignedBy` clear karne se PEHLE (user.service.js:351) — dekho ki jaane wala assigner owner-tier tha ya nahi. Agar **nahi** tha aur koi owner-tier tagged bhi nahi tha, to task par `pointsOutOfScheme: true` stamp kar do (Task.js me naya boolean, `assignerDeleted` ke bagal me).

Phir `taskEligible` (bonus.service.js:555) ki pehli line:
```js
if (task.pointsOutOfScheme) return false;
```
Aur `chainEligible` (line 567) me bhi: stamp mile to seedha `false` — ancestors mat chalo.

Kyun ye sabse chhota hai:
- **Sirf ek direction** guard karni padti hai. Agar jaane wala owner-tier THA (aur chain/tag nahi tha), gate pehle bhi true tha aur doosre owner-tier ke paas jaane par bhi true rahega — koi flip nahi, koi stamp nahi.
- Ye gate **khud** padhta hai (paanchon writer — 632, 728, 1038, 1095, 1709 — isi ke through jaate hain), sirf prune nahi. Isliye ye wo reject ho chuka "freeze flag jo sirf prune padhta hai" wala design NAHI hai.
- `assignedBy = Kalpana` set hota rahega, to Niyam 5 (reviewTask:389, setStatus:314), "assigned by" display, Approvals page, sab waise hi chalte hain. Sirf **points ka gate** ko nayi authority nahi dikhti.

Ek zaroori shart: jab koi insaan **jaan-boojh kar** baad me `collaborators` badle ya task dobara assign kare (`updateTask`), tab stamp hat jaana chahiye — warna CEO ka apne aap ko tag karna kaam nahi karega. Wo ek line hai `updateTask` me.

---

## 21. [RED] Limbo me assignedBy null hai — poori authority assignee ke haath me chali jaati hai (Niyam 5 pehle hi haar jaata hai)

lens: authority-ui · `backend/src/services/task.service.js`:314

**Scenario:** Priyanshi Patel 3 Aug 2026 ko Rahul Verma ko "Client onboarding pack — Sharma Traders" deti hai, due 2026-08-14, **"require my approval" ON**. Na chain, na tag → Niyam 3.

11 Aug: Priyanshi delete. user.service.js:351 → `assignedBy: null`. Khaan Aamir aur Kalpana Sharma dono ke "faisla chahiye" section me task aa gaya; dono chaar din kuch nahi karte. Design kehta hai limbo me points ki halat jamee rahegi — par AUTHORITY ke baare me ek line nahi hai. Aur task.service.js ka har guard assignedBy hi padhta hai:

12 Aug, Rahul task kholta hai aur Done dabata hai:
- setStatus line 314 — `task.requiresApproval && task.assignedBy && isOwner` — assignedBy null hai to **approval branch skip**; line 344-349 seedha status='DONE', completedBy=Rahul.
- line 352 `if (task.assignedBy && !isAssigner)` false → **kisi ko TASK_DONE notification bhi nahi**. Priyanshi ne jis kaam par sign-off maanga tha, wo chupchaap khud doer ne band kar diya.

Usi khidki me Rahul ye bhi kar sakta tha:
- updateTask line 642-646: assignedBy null → `else if (!isOwner)` par pahunchta hai, Rahul owner hai → wo **dueYMD 2026-08-14 se 2026-09-30** kar sakta hai; personal branch (line 842-853) me koi bonus re-score hook hai hi nahi.
- line 843 `data.collaborators !== undefined && isOwner && !task.assignedBy` → wo **khud Khaan Aamir ko tag** kar sakta hai (resolveCollaborators line 127-137 kisi bhi active user ko allow karta hai) — CEO ke Tagged tab me kachra, aur accept ke baad points gate ON.
- deleteTask line 864-867: assignedBy null + isOwner → wo task ko **poori forward chain samet delete** kar sakta hai. Jo cheez rokne ke liye ye design bana hai, wahi limbo me ek button ki doori par hai.
- setStatus line 276-279 `sharedPersonal = !task.assignedBy` → koi bhi **tagged colleague** us task ko Done kar sakta hai.

15 Aug: Kalpana accept karti hai → assignedBy = Kalpana. Agla tick: rescoreAllDoneAssigned (line 1626-1632: DONE, assignedBy≠null, completedAt 45 din ke andar, forwardedFrom null) → onAssignedTaskDone → ab eligible → 12 Aug ≤ 14 Aug + grace → **Rahul ko assignedTaskOnTime ka poora reward**, us kaam par jise kisi ne dekha tak nahi.

**Verifier:** CONFIRMED, par ek narrowing ke saath: Niyam 1 aur Niyam 2 me limbo hai hi nahi (dono turant `assignedBy` set karte hain), to Rule 5 wahan nahi haarta. Yeh sirf **Niyam 3 ke limbo** par lagta hai — aur wahan objection poori tarah sach hai, code se line-by-line provable.

WHY assignedBy limbo me null hi rehta hai (design ka apna mechanism): freeze khud isi par tika hai. `bonus.service.js:619` (`!task.assignedBy` → return), `:1030` (scanOverdueTasks ka `assignedBy: { $ne: null }`), `:1626` (rescoreAllDoneAssigned ka same filter) — teeno assignedBy null hone se hi chup rehte hain, aur `:1709` `assignerDeleted ? true` se purani entries bachi rehti hain. Yaani "points jamee rahenge" ka implementation HI assignedBy=null hai. Design isliye is line ko nahi chhoo sakta, aur uska seedha nateeja yeh hai ki authority gir jaati hai.

SAARE PAANCH GUARD gir jaate hain (verify kiye):
1. `task.service.js:314` — `wantDone && task.requiresApproval && task.assignedBy && isOwner` → assignedBy null → branch skip → `:344-349` seedha status='DONE', completedBy=doer. Niyam 5 ka gate gayab.
2. `task.service.js:352` — `if (task.assignedBy && !isAssigner)` false → **kisi ko TASK_DONE notification nahi**.
3. `task.service.js:642-646` → assignedBy null → `else if (!isOwner)` → doer owner hai → pass → `:842` personal branch me `dueYMD` badal jaata hai, aur us branch me **koi bonus re-score hook hai hi nahi** (assigner branch `:792-801` me hai).
4. `task.service.js:843` — `data.collaborators !== undefined && isOwner && !task.assignedBy` → doer khud kisi ko tag kar sakta hai (`resolveCollaborators:127-137` kisi bhi active user ko allow karta hai). Uske baad `:276` `sharedPersonal = !task.assignedBy` → wo tagged bystander bhi task DONE/PENDING kar sakta hai (`eodDigest:57` credit bhi usi ko de dega).
5. `task.service.js:864-867` — `if (task.assignedBy && !isAssigner)` skip, `if (!isOwner && !isAssigner)` pass → doer task DELETE kar sakta hai, aur `:872-886` uski **poori forward chain cascade-delete** ho jaati hai. Jo cheez bachane ke liye ye design bana hai, wahi ek button ki doori par hai.

YEH API-ONLY EXPLOIT NAHI HAI — UI khud button dikha deti hai: `website/components/tasks/task-board.jsx:294` (`canManage = assignerView || (task.owner?.id === myId && !task.assignedBy)`) aur `:987` (`canMgr`) orphan task par Edit + Delete render karte hain; `:82` (`canCompleteTask = iOwnTask || !t?.assignedBy`) tagged bystander ko Done toggle deta hai.

GATE-NEUTRAL NUMBERS (jaan-boojh kar aisa case chuna hai jahan points-gate ka jawab pehle bhi HAAN tha aur baad me bhi HAAN — taaki swing sirf authority-gap se aaye, Rule 3 ke kisi aur side-effect se nahi). Config: assignedTaskOnTime +5, assignedTaskLate −5, assignedTaskOverdueDaily −1, graceDays 1 (`Setting.js:73` default).

- 3 Aug 2026: **Priyanshi Patel (President, owner-tier)** → **Rahul Verma** ko "Client onboarding pack — Sharma Traders", dueYMD **2026-08-14**, requiresApproval **ON**. Root (forwardedFrom null), koi tag nahi.
- 11 Aug: Khaan Aamir (CEO) Priyanshi ka account delete karta hai — same-tier delete allowed hai (`permissions.js:127-130` → `tRank >= cRank`). `user.service.js:351` → `{assignedBy:null, assignerDeleted:true}`. Chain nahi, tag nahi → **Niyam 3**: Khaan Aamir + Kalpana Sharma dono ke "faisla chahiye" me. Limbo shuru; design me koi timeout nahi, sirf roz reminder.

Counterfactual (Priyanshi zinda hoti):
- Rahul dueYMD chhoo hi nahi sakta — `updateTask:643` `ASSIGNED_TASK` throw karta.
- 16 Aug: `scanOverdueTasks:1051-1054` → overdueDayFor('2026-08-14', 1) = **2026-08-16** → **−5**, month 2026-08.
- 17-20 Aug drip `:1064-1066` → **−4**.
- 20 Aug Rahul Done dabata → `:314` submittedAt; 21 Aug Priyanshi approve → `reviewTask:406-416` → completedAt 21 Aug > 14+1 → LATE → filedYMD = 2026-08-16 → main entry `replace: true` se **−5** hi rehta hai. **Rahul ka net ≈ −9.**

Design as written:
- 12 Aug (limbo me): Rahul apne hi task par Edit kholta hai (UI `:294` deti hai) aur dueYMD **2026-08-14 → 2026-09-30**. `updateTask:842` personal branch, koi hook nahi. Ab `scanOverdueTasks:1034-1035` par `duePlus = 2026-10-01 >= today` → `continue` → **−5 mark aur saare drip kabhi bane hi nahi**.
- 20 Aug: Rahul Done dabata → `:314` skip → seedha DONE, completedAt 2026-08-20, completedBy Rahul. `:352` → **kisi ko notification nahi**. Priyanshi ne jis kaam par sign-off maanga tha, wo bina kisi review ke band.
- 25 Aug: Kalpana accept karti hai → assignedBy = Kalpana. Agla daily tick: `rescoreAllDoneAssigned:1626` (DONE ✓, assignedBy≠null ✓, completedAt 45 din ke andar ✓, forwardedFrom null ✓) → `onAssignedTaskDone` → `taskEligible:558` Kalpana owner-tier → haan; `hasScorableDeadline` haan; `late = '2026-08-20' > addDays('2026-09-30',1)` → **false** → **+5 assignedTaskOnTime, month 2026-08**.

**Swing: −9 → +5 = 14 points**, us kaam par jise kisi ne dekha tak nahi, aur jiski deadline khud doer ne badli. Design ka core wada — "delete se kisi ke points nahi hilne chahiye" — yahin toot jaata hai. Aur agar Rahul Edit ke bajaye **Delete** dabata (`:864-867`), to task + poori forward chain gayab, aur Khaan Aamir/Kalpana ke modal me pada request row ek aise task id par ishara karta reh jaata jo ab exist hi nahi karta — kisi ko kabhi pata nahi chalta ki kaam tha.

Limbo unbounded hai: Niyam 3 me sirf roz reminder hai, koi deadline nahi; agar 2+ owner-tier log kuch na karein to yeh khidki anant hai.

**Design me kya badle:** Design me LIMBO ki paribhasha ek line se badlo: **"limbo me points AUR authority — dono jamee rahengi"** (abhi sirf points likha hai).

Concretely, ek hi cheez badalni hai: har wo jagah jo "kya ye delegated task hai?" ka jawab `assignedBy` se nikalti hai, ab `assignedBy || assignerDeleted` se nikale. Flag pehle se model par hai (`Task.js:14`) aur pehle se likha ja raha hai (`user.service.js:351`), to koi naya concept nahi:

- `task.service.js:276` — `sharedPersonal = !task.assignedBy && !task.assignerDeleted` (tagged bystander orphan ko close na kar sake)
- `task.service.js:314` — approval branch ki shart `task.requiresApproval && (task.assignedBy || task.assignerDeleted) && isOwner`. assignedBy null ho to submittedAt lagega aur TASK_APPROVAL notification **un hi owner-tier candidates ko** jaayega jinke paas request pending hai. Yahi Niyam 5 ka doosra hissa bhi cover karta hai ("atki padi submission naye zimmedaar ko"), aur accept karne wala turant approve/reject kar sakta hai.
- `task.service.js:642` — `if (task.assignedBy || task.assignerDeleted) { if (!isAssigner) throw ASSIGNED_TASK }` → doer dueYMD/title/notes nahi badal sakta
- `task.service.js:843` — `&& !task.assignerDeleted` jodo → doer khud tag nahi laga sakta
- `task.service.js:864` — `if ((task.assignedBy || task.assignerDeleted) && !isAssigner) throw` → doer orphan aur uski chain delete nahi kar sakta
- UI: `task-board.jsx:82, :294, :987` me bhi `!t.assignedBy` ki jagah `!t.assignedBy && !t.assignerDeleted`, warna server 403 dega aur button phir bhi dikhega

Zaroori rider: **Niyam 1/2/3 jab bhi naya `assignedBy` set karein, usi update me `assignerDeleted` false kar dein** — warna `pruneOrphanTaskEntries:1709` (`t.assignerDeleted ? true : chainEligible(...)`) hamesha "eligible" short-circuit karta rahega aur asli gate kabhi nahi poochha jaayega.

Yeh dono rejected designs se alag hai: (a) `assignedBy` kisi arbitrary successor ko nahi diya ja raha — limbo me wo null hi rehta hai, freeze waise ka waisa; (b) flag sirf prune nahi padhta — yahi to point hai, use paanchon authority guard padhenge.

---

## 22. [LOW] Virasat me mili approval kahin dikhti nahi — sidebar dot chup, Approvals page band — aur doer ko roz −1 lagta rehta hai

lens: authority-ui · `backend/src/services/badges.service.js`:46

**Scenario:** Chain: Khaan Aamir (CEO) → Faizan (Manager A) → Manish Saini → Rahul Verma. Due 2026-08-05, grace 1. Rahul ne 4 Aug ko submit kiya (Manish ne "require my approval" laga rakha tha) — setStatus:314-333, submittedAt = 2026-08-04, task PENDING+submitted.

8 Aug se scanOverdueTasks Rahul par chalu ho jaata hai: line 1028 ka comment saaf hai — submitted-for-approval task SKIP nahi hote. dueYMD 2026-08-05 ≥ DRIP_FLOOR, chainEligible TRUE (Rahul → Faizan ki copy → assignedBy Khaan = owner). To 7 Aug ko −5 mark, phir 8 Aug se roz −1.

11 Aug: Manish delete. Niyam 1 → Rahul ki copy Faizan ki copy par re-point, assignedBy = Faizan. Niyam 5 → atki hui submission ka notification Faizan ko.

Ab Faizan ki screen:
- **Sidebar dot:** badges.service.js:46 `awaitingMyApproval = latest(Task, {assignedBy: Faizan, ...}, 'submittedAt')` → **2026-08-04** lautata hai (purani submit date, handover ki nahi). badges.js:91-95 `isNew` = `new Date(latestAt) > new Date(last)`; Faizan ne 10 Aug ko /todo khola tha, to `om_seen_todo` = 2026-08-10. 04 > 10 false → **koi dot nahi**.
- **Approvals page:** Faizan ke paas approveLeave/approveRegularization nahi hai → canUseApprovals false (approvals.service.js:36-38) → sectionsFor:45-53 me `tasks: false`, pendingFor:81-88 khaali array, pendingCount:191-193 → 0, aur badges.service.js:69-72 `approvals: null`. Page khud "This page isn't for your role" dikhata hai (approvals/page.jsx:164-170).

To design ke teen vaadon ("Approvals page me bhi, sidebar par ginti, aur notification") me se do kaam hi nahi karte — sirf bell ka ek notification bachta hai, aur ek baar ka modal. 20 Aug tak Rahul par −5 + 13×−1 = **−18**, us kaam ke liye jo usne 4 Aug ko time par de diya tha.

**Verifier:** Objection ke teen dawe hain. Do REFUTED, teesra sach hai par RED nahi.

**(1) Points ka dawa — REFUTED. Design ne yahan kuch toda hi nahi.**
Rahul ki copy par gate ka jawab delete se pehle aur baad me BILKUL EK hai:
- Pehle: `taskEligible(Rahul copy)` false (assignedBy = Manish, koi collaborator nahi) → `chainEligible` upar chala → parent = Manish ki copy (assignedBy = Faizan, false) → uski parent = Faizan ki copy (assignedBy = Khaan Aamir, owner-tier) → **TRUE** (bonus.service.js:555-583).
- Niyam 1 ke baad: Rahul ki copy ka `forwardedFrom` = Faizan ki copy, `assignedBy` = Faizan → `taskEligible` false → ek hi hop upar → Faizan ki copy → assignedBy = Khaan → **TRUE**.

Ek hi jawab, sirf raasta ek kadi chhota. `scanOverdueTasks` ka filter (`assignedBy: {$ne:null}`, status PENDING, dueYMD set, forwardedParent nahi — bonus.service.js:1030-1031) dono halat me match karta hai. Matlab delete se **ek bhi PointEntry na bani, na miti** — yehi to limbo-invariant ka poora maqsad tha; objection ka apna scenario design ko PASS karta hua dikha raha hai.

Aur wo −18? Wo pehle se hai. bonus.service.js:1022-1028 ka comment shabd-ba-shabd kehta hai: "Submitted-for-approval tasks are NOT skipped (owner's rule, 2026-08-08)". Agar Manish delete hone ki jagah sirf 2 hafte chhutti par chale jaate, Rahul par wahi −5 (07 Aug, `overdueDayFor` = due+grace+1) + 08→20 Aug ke 13×−1 = **−18** utna hi banta. Ye owner ka liya hua rule hai, handover-design ka side-effect nahi. Design ne isko na badla, na badalne ka daawa kiya.

**(2) "Approvals page band" — REFUTED, naam liye gaye actor par.**
permissionCatalog.js:102 — seeded **MANAGER role me `approveLeave` hai**. To Faizan par `canUseApprovals` = TRUE (approvals.service.js:36-38), `sectionsFor().tasks` = TRUE (line 51), aur `pendingFor`/`pendingCount` ka tasks query poora `{assignedBy: user._id, requiresApproval:true, submittedAt:{$ne:null}, status:{$ne:'DONE'}}` hai — **koi timestamp nahi, sirf ownership** (lines 82, 192). Re-point hote hi Work tab par **(1)** aa jaata hai. `forwardTask` child par `requiresApproval: !!requiresApproval` likhta hai (task.service.js:522), to Rahul ki copy match karti hai.

Aur design ka "Approvals page me bhi, sidebar par ginti" wala vaada (08d:125) **Niyam 3 ke section ke andar** hai — uske recipients hamesha owner-tier hain, aur LEADERSHIP_PERMS me approveLeave + approveRegularization dono hain (permissionCatalog.js:83-85, 92). Yaani wo vaada apne dayre me by-construction pura hota hai. Niyam 1 ne Approvals page ka vaada kiya hi nahi — approvals.service.js:27-38 ka comment jaan-boojh kar likha hai ki delegated-task approval To-Do par rehti hai.

**(3) Kaam "strand" bhi nahi hota.**
`listTasks` me scope=assigned sirf `{assignedBy: actor._id}` par matlab rakhta hai, aur `passedOn` wala exclusion sirf `mine` scope me lagta hai (task.service.js:940, 955-956) — to Rahul ki copy Faizan ke assigned scope me hai. `awaiting` branch date-filter ko **jaan-boojh kar ignore** karta hai (lines 977-978). Nateeja: Faizan ke "Assigned by me" tab me sabse upar **"Awaiting your approval (1)"** panel (task-board.jsx:1040-1047, 1372-1379) aur Approve/Reject (line 557) maujood hain.

**Jo sach nikla (LOW):** badges.service.js:46 `submittedAt` lautata hai, isliye To-Do dot ka aadhaar purani submit-date (2026-08-04) hai; jisne 10 Aug ko /todo khola tha uske liye `isNew` false (badges.js:91-95). Ye mechanically sahi hai. Par ye **teesra, redundant** channel hai — pehle do chalte hain: (a) Niyam 5 ka naya TASK_APPROVAL notification bell me **persistent unread count** deta hai (notifications-bell.jsx:29, 53-58) aur uska link `todoLink(id, true)` = tab=assigned par seedha deep-link karta hai (task.service.js:28, 328; tab honour task-board.jsx:766-771); (b) Niyam 1 ka jaankari-modal har hand-over par chalta hai (08d:100-114). "Sirf ek bell ping" wali baat isliye sahi nahi.

Ek chhota sa asli gap jise objection ne miss kiya: gair-MANAGER waaris (ADMIN_MANAGER, ya `User.taskAssign` wala EMPLOYEE — permissionCatalog.js:70 kehta hai delegation role-permission nahi, per-person hai) ke liye Approvals page sach me band rehta hai — par ye pehle se aisa hi hai aur jaan-boojh kar, aur To-Do usko cover karta hai.

**Design me kya badle:** Sabse chhota badlav (sirf LOW wale hisse ke liye, ek field + ek call):

1. Niyam 6 pehle se har task par "jaane walon ki list (naam + tarikh)" rakh raha hai. Usi ke saath task par ek `handedOverAt` (Date) stamp kar do — jab bhi Niyam 1/2/3 ke tehat task kisi naye zimmedaar ke paas jaaye, ye field us pal ki date par set ho jaaye. Koi naya rule nahi, Niyam 6 ka hi ek derived field.

2. backend/src/services/badges.service.js:46 ka `latest(...)` `submittedAt` ke bajaye dono me se NAYA lautaaye — yaani us query ke result par `newest(submittedAt, handedOverAt)`. (Sabse saaf tareeka: usi filter par `handedOverAt` ke liye ek doosra `latest()` chala kar `newest()` me mila do — file me `newest()` already line 8-11 par maujood hai.)

Nateeja: 11 Aug ki virasat 11 Aug padhegi, 4 Aug nahi, to Faizan ke sidebar par To-Do dot jal jaayega. Baaki design me kahin haath lagane ki zaroorat nahi — Approvals page, count, notification aur modal pehle se sahi kaam karte hain.

---

## 23. [MEDIUM] "Ye kaam aapke paas hain" modal ka seen-state kahin define nahi — localStorage pattern isse ya to roz-roz nagg banata hai ya chupchaap gum

lens: authority-ui · `website/components/tasks/eod-digest-popup.jsx`:12

**Scenario:** Design kehta hai: modal ka pehla hissa sirf jaankari hai, "Koi Accept/Reject nahi — bas 'Theek hai'". Par ye "Theek hai" kahan likha jaayega, ye kahin nahi likha. Codebase me do alag pattern maujood hain aur wo alag-alag natije dete hain:

(a) **localStorage, YMD key** — birthday-popup.jsx:13,65 (`om_birthday_seen`) aur eod-digest-popup.jsx:12,58 (`om_eod_seen`). Agar handover modal isi ka anusaran kare: Khaan Aamir 12 Aug ko laptop par chhe virasat-tasks dekhkar "Theek hai" dabate hain → `om_handover_seen = '2026-08-12'`. Usi shaam phone par app kholte hain → alag localStorage → wahi chhe tasks phir se poore screen par. Aur 13 Aug ko laptop par bhi phir se, kyunki tasks abhi bhi unke hain aur unhe "acknowledged" kisi ne mark nahi kiya. Ulta agar key plain boolean rakha jaaye, to 20 Aug ko doosre delete se aaye naye tasks ka modal **kabhi nahi** khulega — yaani "kisi ko kaam chupchaap nahi milega" ka niyam theek ulta ho jaayega.

(b) **server-side per-item read** — announcement-popup.jsx:39,52 + `POST /announcements/:id/read` + AnnouncementRead model (user.service.js:341 ise delete bhi karta hai). Yahi sahi shakl hai, par design isko naam se nahi kehta.

Aur "agar wo insaan site khole hi na" wala sawaal: Niyam 3 ki roz ki yaad-dehani sirf faisla waale hisse par hai; Niyam 1/2/aakhri-candidate ka jaankari-modal ek baar ka hai. Kisi bhi soorat me server par koi record nahi bachta ki us insaan ko BATAYA gaya tha — na audit ho sakta hai, na browser clear ke baad dobara bheja ja sakta hai.

**Verifier:** Objection sahi hai, par uski wajah objection se thodi alag aur zyada pakki hai.

**Gap wakai khula hai.** 08d:112 sirf itna kehta hai "Koi Accept/Reject nahi — bas *Theek hai*", aur 08d:124 storage ke liye jo ekmatra ishara deta hai wo hai "birthday/EOD digest jaise popup ka pattern pehle se hai". Design khud un do popups ko naam se pattern bata raha hai, aur dono per-device localStorage YMD key hain — `om_birthday_seen` (birthday-popup.jsx:13, 52, 65) aur `om_eod_seen` (eod-digest-popup.jsx:12, 42, 58). badges.js:14 me likha bhi hai ki "last opened is stored per device" jaan-boojh kar hai, kyunki wo sirf ek nudge hai. Maine 08e bhi grep kiya — wahan ye sawaal utha hi nahi, to ye naya gap hai, purana settled faisla nahi.

**Faisal-kun farq (jo objection ne theek pakda):** birthday aur EOD dono ka underlying set roz apne aap khatam ho jaata hai — birthday-popup.jsx:42 sirf `h.startYMD <= today && h.endYMD >= today` filter karta hai, aur EOD `data.ready` + us din ke DONE tasks par chalta hai. Handover set aisa nahi hai: Niyam 6 (08d:167-176) task par departed-naamon ki **permanent** list stamp karta hai, to "ye kaam mujhe kisi jaane wale ke through mila" hamesha sach rehta hai.

Numbers ke saath: Manish Saini 12 Aug 2026 ko delete hue, Niyam 2 se 6 task Khaan Aamir ke paas gaye, jisme 3 long-running hain (due 31 Oct 2026). YMD key ke saath wo full-screen modal 13 Aug se 31 Oct tak **har subah** khulega — ~80 subah — aur laptop/phone alag localStorage hone ki wajah se dono device par alag-alag. Isi modal ke doosre hisse me Niyam 3 ke Accept/Reject baithe hain, to log poore modal ko reflex me band karna seekh jaate hain — yaani nag decision-half ki bhi keemat khaata hai. Ulta boolean key rakho to 20 Aug ko Priyanshi Patel ke delete se aaye 2 naye task ka modal kabhi khulega hi nahi, jo 08d:97-98 ke apne maqsad ("atleast usko ye to pta chale") ka theek ulta hai.

**Objection ki ek baat galat hai** — "sahi shakl = AnnouncementRead jaisa alag model" zaroori nahi. Codebase me isse kareeb ek cheez pehle se hai: `Task.seenAt` (Task.js:42) + `markSeen`/`markSeenBulk` (task.service.js:443-476), jo per-user-per-task server-side receipt hai aur `updateTask` me tab clear hota hai jab kaam owner ke neeche dobara likha jaata hai (task.service.js:774 aur :819 — "rewritten under them → earn a fresh receipt"). Yani sahi semantics already maujood hai.

**Par `seenAt` ko jyon-ka-tyon reuse karna do jagah tootega, aur yahi is finding ka asli daant hai:**
1. **Niyam 1 me jise batana hai wo owner hai hi nahi.** CEO → Manager A → Manager B → Junior, Manager B gaya: Junior ki copy ka owner Junior hi rehta hai, sirf `assignedBy` Manager A ban jaata hai. Jise "ye ab aapke paas hai" bolna hai (08d:105) wo Manager A hai. `seenAt` owner ka receipt hai (markSeen task.service.js:446-451 owner-only enforce karta hai), to Manager A ke liye wo bit exist hi nahi karta.
2. **Auto-stamp modal ko maar dega.** task-board.jsx:1116 + 1135-1138 list render hote hi har unseen assigned task par `PATCH /tasks/seen` maar deta hai, aur popup app-shell.jsx:61-64 me har page par mounted hai. Agar modal `seenAt` par chale, aur banda /todo par land kare, to receipt modal ke render hone se pehle stamp ho jaayega — modal kabhi dikhega hi nahi.

**Notification bhi record nahi ban sakta:** Notification.js:24 par 30-din ka TTL index hai, to 31 din baad koi saboot nahi bachta ki bataya gaya tha.

Ye RED nahi hai — is se koi point nahi banta na mitta, koi task bina maalik ke nahi rehta, koi access control nahi tootta. Ye ek khula design faisla hai jiska default galat hai.

**Design me kya badle:** 08d me ek chhota hissa jodo (naya model nahi chahiye):

1. **Ack task par rakho, user ke saath.** Niyam 6 wali departed-list ke bagal me hi ek field: `handoverNotice: { toUser, at, ackAt }` (ya notice-entries ka array agar ek hi task do baar hath badle). `toUser` isliye zaroori hai ki Niyam 1 me batane wala banda naya **assigner** (Manager A) hai, owner nahi — to `Task.seenAt` is kaam nahi aa sakta. Task par hone ki wajah se user delete par alag cleanup bhi nahi chahiye (AnnouncementRead ko user.service.js:341 me alag se mitana padta hai).

2. **Ack ek bulk call se.** Modal ka "Theek hai" ek `POST /tasks/handover-ack { ids }` maare, guard filter-me — `markSeenBulk` (task.service.js:468-476) wala hi shape: `{ _id: { $in: ids }, 'handoverNotice.toUser': actor._id, 'handoverNotice.ackAt': null }`. Modal ka section-1 query = wahi filter. Isse cross-device aur browser-clear dono theek ho jaate hain, aur server par ye record bacha rehta hai ki kis ko, kab bataya gaya.

3. **Design me saaf likho: `Task.seenAt` reuse mat karna.** Wo owner ka read-receipt hai aur task-board.jsx:1135-1138 use list render par apne aap stamp kar deta hai — us par modal chalaya to /todo par land karne wale ko modal dikhega hi nahi.

4. **08d:124 ki line badlo:** "birthday/EOD digest jaise popup ka pattern" sirf *kahan/kab dikhega* ke liye rahe; storage ke liye announcement wala pattern likho (`POST /announcements/:id/read`, announcement-popup.jsx:39 + announcement.service.js:157), warna implementer localStorage hi utha lega.

---

## 24. [LOW] Niyam 4 ka tag neeche utarna band ho chuki report ke "tagged" column ko badal deta hai

lens: authority-ui · `backend/src/services/report.service.js`:421

**Scenario:** 12 Jul 2026: Manish Saini apni copy Rahul Verma ko forward karta hai — child task createdAt = 2026-07-12. Manish ki apni copy par Khaan Aamir (CEO) tagged the (unke assigner ne updateTask ki (a2) branch se tag kiya tha, task.service.js:736-758). forwardTask collaborators copy nahi karta (line 522-532), to child ke paas apna koi tag nahi.

1 Aug 2026: July ki company report nikli. report.service.js:421 `taggedTasks` ko **task ke createdAt** se chunta hai (1–31 Jul), aur line 444-448 har collaborator ka `tagged` count badhata hai. Khaan Aamir ka July "tagged" column: maan lo 9. PDF issue ho chuka.

11 Aug 2026: Manish delete. Niyam 4 → uski mit rahi copy ka owner-tier tag NEECHE child par utar jaata hai → 12-July waale task par ab `collaborators: [Khaan Aamir]`.

Ab koi bhi July ki report dobara kholta hai: wahi query, wahi window (createdAt 1–31 Jul), par ab wo child task bhi match karta hai → Khaan Aamir ka July "tagged" **9 se 10** ho gaya, aur `tasks.totals.tagged` (line 464-467) bhi. Yahi unke personal report me bhi hai — line 586 `Task.find({collaborators: user._id, owner: {$ne: user._id}, createdAt: {...}})`, phir bhi createdAt par. Turant asar: task.service.js:1155-1158 ka `tagged` stat box aur listTasks scope='tagged' (line 944) me row aa jaana — jise design ne maan liya hai ("wo dekh hi rahe the"), par report waala hissa design me kahin nahi hai.

**Verifier:** **Mechanism sach hai, par objection ka apna scenario jo number claim karta hai (9→10) wo us scenario me nikalta hi nahi — aur jo case sach me +1 deta hai wo ek informational column ka ±1 hai, jise wahi deletion aaj do doosri jagah isse zyada bigaadti hai.**

**Jo CONFIRM hota hai.** Reports live compute hoti hain, koi snapshot nahi (`report.service.js:138` `buildReport`, `:559` `buildSelfReport`). Company tagged query `report.service.js:421` — `Task.find({ collaborators: { $ne: [] }, createdAt: {from..to} })` — sach me task ke `createdAt` par window karti hai, tag ki tarikh par nahi; `:444-448` har collaborator ka `tagged` +1 karti hai; `:464-467` totals. Personal wali `:586` bhi wahi. `forwardTask` sach me collaborators copy nahi karta (`task.service.js:522-532`), aur gate ka poora sahaara `bonus.service.js:559` + `:567-583` ka parent-walk hai. Yahan tak sab theek.

**Par objection ka scenario galat number deta hai.** Us scenario me T_A (Manish ki copy, `collaborators:[Khaan]`) kab bani, ye likha hi nahi. Agar wo bhi July me bani (12 Jul ko forward hua — sabse natural reading), to:
- Pehle: T_A khud `:421` me match karta hai → Khaan ka July tagged = **9** (T_A un 9 me se ek hai).
- Sirf deletion (aaj ka code, koi design nahi): `user.service.js:337` `Task.deleteMany({owner: uid})` T_A mita deta hai → July **9 → 8**. Band mahina aaj bhi girta hai.
- Niyam 4 ke saath: tag T_B (createdAt 12 Jul, wahi window) par utar jaata hai → wapas **9**.

Yaani same-window case me Niyam 4 hi wo cheez hai jo July ka number **sthir rakhti hai**; uske bina deletion use chupchaap 1 se ghata deti hai. Niyam 4 corrupting nahi, **corrective** hai.

**+1 sirf do sanko me aata hai (objection ne dono me se koi nahi likha):**
1. **Cross-window:** T_A createdAt 20 Jun, T_B createdAt 12 Jul. July me T_A tha hi nahi (0 contribute), delete + Niyam 4 ke baad T_B match karta hai → Khaan July tagged **9 → 10**, `totals.tagged` bhi +1. Ye reachable hai.
2. **Fan-out (isse mazboot):** `forwardTask:519` ka guard sirf *usi target* ko dobara forward karne se rokta hai, isliye ek parent ke N children ho sakte hain. Manish ne 12 Jul ko Rahul **aur** Sneha dono ko forward kiya, T_A 5 Jul ki: pehle 9 → deletion −1 → Niyam 4 se +2 → **10**. Ek tag-rishta N rows ban jaata hai. (Aur agar child par pehle se Khaan tagged ho, bina `$addToSet` ke array me duplicate → `:445` ka loop use do baar ginega.)

**Phir bhi LOW kyun, MEDIUM nahi:**
- `tagged` explicitly ek aside hai — `:420` ka apna comment: doosre ke task hain, "reported beside the figures above, never inside them". Wo `done/onTime/late` (`:430-443`) me nahi jaata, `rewards`/`points`/`rupees` (`:471-508`) me nahi jaata. Na pay, na points, na access badalta hai.
- Niyam 4 sirf **owner-tier** tag neeche utaarta hai, to zyada se zyada CEO aur President ke apne cell hilte hain — wahi do log jo usi kaam ke parent par pehle se tagged the.
- Retroactive mutability pehle se maujood hai aur is design ki wajah se nahi: `updateTask` (a2) `task.service.js:736-758` kisi bhi umar ke task par `collaborators` overwrite karta hai, koi date guard nahi — aaj bhi band mahine ka tagged badal deta hai.
- **Wahi deletion aaj isse bada nuksaan karti hai:** `user.service.js:351` `Task.updateMany({assignedBy: uid}, {$set:{assignedBy:null}})`, aur `report.service.js:414` ka `doneTasks` `assignedBy: { $ne: null }` maangta hai — to Manish ke diye har complete ho chuke task ki row har band mahine ke `done/onTime/late` se **gayab** ho jaati hai. Niyam 1/2/3 assignedBy ko null ki jagah ek zinda insaan par point karke isi ko **rokte** hain. Poora design closed-month reports ko aaj se **zyada sthir** banata hai; tagged ka ±1 uska chhota bacha-khucha hissa hai.

Isliye: faisla maangta hai — haan, par LOW polish ke taur par, "closed month back-file wali beemari" ke taur par nahi.

**Design me kya badle:** Niyam 4 me tag ko `collaborators` me **mat** daalo. Task par ek alag field rakho (jaise `inheritedOwnerTags: [ObjectId]`) jise **sirf points ka gate** padhe. Poore codebase me gate ke liye collaborators sirf ek jagah padha jaata hai — `bonus.service.js:559` `taskEligible` — wo ban jaata hai: `return [...(task.collaborators||[]), ...(task.inheritedOwnerTags||[])].some((c) => ownerIds.has(String(c)))`; aur naya field un 9 `.select()` projections me jod do jo pehle se collaborators fetch karti hain (`bonus.service.js:575, 591, 725, 1030, 1090, 1428, 1627, 1656, 1692`). Baaki sab (`chainEligible` ka walk `:567-583`) bina badle chalta rahega.

Isse: (a) `report.service.js:421` aur `:586` chhue bina hi dono report figures sthir ho jaati hain — dono report queries me tag-date guard lagane se ye change chhota hai; (b) fan-out ka N-guna inflation aur array-duplicate dono khatam; (c) design ne jo side-effect pehle hi maan liya tha — "wo task ab CEO ke tagged tab me dikhega" (`task.service.js:944` listTasks scope='tagged', `:1155-1158` stat box) — wo bhi apne aap khatam, jo waise bhi theek hi hai: CEO parent par tagged the, is copy par nahi, aur unke apne "tagged" box ka number bina kisi ke tag kiye badalna galat hi padha jaata.

---
