# Audit 11 — Visitors · Announcements · Calendar · Approvals · Activity · Profile (11 Aug 2026)

> Process: 5 specialist agents (security, correctness, consistency, perf, ux) → har RED/MEDIUM adversarial verification se guzri → **21 confirmed, 0 refuted**.
>
> **Is baar koi RED nahi.** Ye chhe page money/points/settings jitne nazuk nahi — sabse bura ek **privacy leak** (birth year) hai, jo MEDIUM hai. Dedupe ke baad **~15 MEDIUM + 4 LOW**.
>
> **STATUS (11 Aug 2026): V6 FIXED** (`20ddaed`, 10/10 isolated-DB suite + pre-fix proof). Isne ek chhupa hua **garbage-key bug** bhi khola aur theek kiya — correction par absence/late penalty `reg.user` (populated) ke garbage dedupeKey ki wajah se **kabhi clear hi nahi hoti thi**. Baaki parked — owner ka faisla. Push/zip nahi ([[no-auto-push]]).

Ye programme ka **aakhri bada scan** hai — ye chhe page ab tak ek baar bhi audit nahi hue the (plan me chhoot gaye the).

---

# 🔐 Security / Privacy — 4

## V1 — Calendar har employee ka **birth YEAR** sabko dikha deta hai *(privacy)*

**Kahan:** `backend/src/services/holiday.service.js:180-187`

Profile me date-of-birth daalte waqt likha hota hai *"shows on the company calendar as your birthday"* — yaani **din/mahina**. Par `GET /api/holidays` (jo har logged-in user ko khula hai) har birthday row ke saath `anchorStartYMD` bhejta hai jisme **poora saal** hota hai — `"1990-04-02"`.

> Ravi (Office Boy, koi special permission nahi) calendar kholta hai. Screen par sirf "Mohd Faiz · 2 April" dikhta hai. Par JSON me `anchorStartYMD: "1990-04-02"` aur `startDate: "1990-04-01T18:30Z"` — dono 1990 bolte hain. Browser ka Network tab kholo → **har colleague ki exact umar** mil jaati hai.

**⚠️ Verifier ki zaroori correction:** sirf `anchorStartYMD` hataana **kaafi nahi** — `startDate`/`endDate` bhi anchor-year ke saath serialize hote hain aur akele hi saal leak karte hain. Fix me **dono** mask karne padenge (birthday rows ke liye sirf month/day).

---

## V2 — Announcement ka audience picker **custom/owner roles** offer karta hai, phir server **mana** kar deta hai

**Kahan:** `backend/src/validators/announcements.validators.js:9` vs `create-announcement-dialog.jsx:124`

Dialog audience ke chips **live DB roles** se banata hai (custom `CEO_PRESIDENT` samet). Par validator ek **purani hardcoded 7-role list** se check karta hai. Koi bhi custom role chun kar Post dabao → **422, announcement banti hi nahi**.

**Do nuksaan:**
- Custom role ko **kabhi** announcement target nahi kar sakte
- Aur **owner khud** (jinka role `CEO_PRESIDENT` hai) **har role-scoped announcement se chupchaap bahar** reh jaata hai — kyunki uska key list me hai hi nahi

*(Ye #18 UX finding ka bhi jad hai — UI wo cheez offer karta hai jo server refuse karta hai.)*

---

## V3 — `postAnnouncements` wala **doosre ki announcement** edit/delete/read-receipts kar sakta hai

**Kahan:** `backend/src/routes/announcements.routes.js:14-16`

Comment kehta hai *"author-only"* — par code me **kahin author check nahi**. Sirf `postAnnouncements` ka pehra hai.

> Agar `postAnnouncements` do role ke paas hai (jaise leadership + ek HR role), to HR wala **CEO ki announcement ka body badal sakta hai**, use **delete kar sakta hai**, aur uske **poore seen/unseen naam-list** padh sakta hai — jise usne banaya hi nahi.

*(Aapki default setup me sirf leadership ke paas hai, to abhi limited — par jis din kisi aur ko diya, khul jaayega.)*

---

## V4 — Push unsubscribe **kisi ki bhi** notification band kar sakta hai *(IDOR)*

**Kahan:** `backend/src/controllers/push.controller.js:19`

`POST /api/push/unsubscribe` sirf `endpoint` leta hai, `req.user._id` nahi — jabki bagal wala `subscribe()` user id use karta hai. Koi bhi authenticated user kisi doosre ka endpoint deke uski **web-push notifications chupchaap band** kar sakta hai (leave decision, visitor arrival, sab).

*(Exploit seemit hai — endpoint URL kisi API se milta nahi, out-of-band chahiye. Par owner-guard jo baaki har per-user write me hai, yahan gayab.)*

**+ V5 (already known):** Per-user audit log `viewAudit` ke bina dossier ke raste khulta hai — **ye audit 08 ka T14 hai**, pehle se parked.

---

# 🧮 Correctness — 4

## V6 — Attendance correction approve karo → absence penalty hat ti hai, par **perfect-month bonus wapas nahi aata**

**Kahan:** `backend/src/services/regularization.service.js:129-179`

> 20 July ko employee check-in bhool gaya → absent → July ka "perfect attendance" +10 nahi mila.
> 15 Aug ko director us din ko regularize (present) kar deta hai → absent penalty **hat jaati hai**, par **+10 kabhi nahi milta**.

Correction ke baad 3 bonus-hooks chalte hain (overtime, absence penalty, late penalty), par **`reconcilePerfectMonth` nahi**. Perfect-month award mahine ke end par ek baar tay hota hai aur wo dobara nahi dekha jaata.

**🔗 Ye abhi maine jo S1 fix kiya usse juda hai:** S1 me `reconcilePerfectMonth` ka crash theek kiya — par **regularization ise call hi nahi karta**. Yaani leave-path se to ab reconcile hoga, correction-path se abhi bhi nahi. **Dono ek saath sochne wali cheez.**

## V7 — Half-day-leave wale din ka bhoola hua check-in **regularize nahi ho sakta**

**Kahan:** regularization guard. Us din live check-in to allowed hai, par correction reject ho jaati hai — ek asymmetry.

## V8 — Approver ki bell **decision commit hone se pehle** clear ho jaati hai

**Kahan:** `regularization.service.js:193`, aur leave `decideLeave`

> Employee ke 2 casual din bache, 3 apply karta hai. Approver A "Approve" dabata hai → pehle **sabki bell clear** hoti hai, phir transaction **INSUFFICIENT_BALANCE** se fail ho jaati hai. Leave abhi bhi PENDING hai — par ab **B aur C ke paas us request ki bell nahi rahi**. Ek failed attempt ne sabki bell uda di.

## V9 — Linked birthday **delete** karo → employee ki profile DOB **chupchaap mit** jaati hai

**Kahan:** `holiday-dialog.jsx` delete → `holiday.service.js`

> Admin calendar par kisi ka birthday dekh kar "stray entry" samajh kar delete karta hai. Confirm sirf *"removed for everyone"* bolta hai. **Uske baad us bande ki profile ki Date of birth blank ho jaati hai** — admin ko pata bhi nahi. Ek profile field ud gaya.

---

# 🔁 Consistency — 5

| # | Bug | Ek line me |
|---|---|---|
| **V10** | Apna khud ka pending leave/correction **apni hi Approvals queue** aur count me dikhta hai | Aap apni request approve karne ka option dekh sakte ho |
| **V11** | WFH request **har** approveLeave-holder ki queue/count me, par **notification sirf owner** ko | Queue aur bell alag audience dekhte hain |
| **V12** | Announcements ka **sidebar dot** `audience`/`publishAt`/`isActive` ignore karta hai | Feed/popup me na dikhne wali announcement ka bhi dot chamak jaata hai |
| **V13** | Announcement feed **load fail** hone par error ki jagah *"You're all caught up"* | Server down hai aur user samjhega koi announcement hai hi nahi |
| **V14** | **In-use category** remove karna **silent no-op** — chip turant wapas | Toast *"Category removed"* bolta hai, par kaam nahi hota (kyunki purane records use kar rahe hain) |

---

# ⚡ Performance — 2 MEDIUM + 2 LOW

| # | Bug | Asar |
|---|---|---|
| **V15** | Announcement read-receipts **N+1** — leader ke feed me har announcement apni alag `/reads` request | Feed jitni badi, utni requests |
| **V16** | Visitor PDF export **10,000 rows tak** `@react-pdf` se render, bina date filter | Bada export Lambda ko timeout kar sakta hai (6MB / 30s) |
| **V17** *(perf/correctness)* | Task-history window `updatedAt` par keyed, `decidedAt` par nahi | Decision galat mahine me gin sakti hai |
| **V18** *(LOW)* | Activity log `action`/`entityType` par **unindexed** filter + har load par `countDocuments` | **T18 wala pattern** — abhi ~3,000 docs, headcount×dino se badhega |
| **V19** *(LOW)* | Visitors list har open par **500 docs** fetch (populate, non-lean) sirf 15/page dikhane ko | Chhota abhi, badhega |

---

## 🔗 CROSS-CONNECTIONS

| Ye | Kis se juda |
|---|---|
| **V6** (correction → perfect-month) | Abhi wale **S1 fix** se — reconcile ka crash theek hua par correction-path use call hi nahi karta |
| **V2, V3** | Frontend **hardcoded role list** vs DB roles — wahi **T9/T10** wali jad |
| **V5** | audit 08 ka **T14** (dossier audit-log leak) — wahi cheez |
| **V18** | audit 08 ka **T18** + audit 10 — AuditLog par index gap |
| **V13, V14** | *"UI jhooth bolti hai"* — E12/S15 wale "Invalid request" parivaar ke bhai |

---

## 💡 FEATURE IDEAS → **[00-features.md](00-features.md)**
