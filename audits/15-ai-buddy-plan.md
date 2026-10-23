# 15 — AI Buddy: app se baat karne wala sahayak (plan)

**Taarikh:** 23 Oct 2026
**Owner ka ask:** App me ek buddy ho jisse normal bhasha me sawaal poochha ja sake. Jawab **utna hi** mile jitna us bande ka access hai — employee sirf apni cheezein, sabke dekhne layak cheezein sabko, CEO ko sab kuch **par kisi ke dues nahi**. Koi bahar ka data nahi — sirf is website ka. Model: **Claude Sonnet 5.5**.
**Status:** sirf PLAN. Abhi koi code nahi badla. Neeche "Faisle chahiye" ke jawab ke baad hi haath lagega.

---

## 0. Sunhera niyam (owner ka faisla, 23 Oct 2026)

> **Buddy koi nayi cheez nahi kholta.** Jo aaj us bande ko app me dikhta hai, buddy usi ka
> jawab dega. Jo nahi dikhta, wo buddy se bhi nahi milega.

Owner ke apne shabd: *"jo leaderboard sabko dikhte hai wo sabko dikhe, jo nahi dikhte wo na
dikhe"*. Ye poore plan ka niyam hai, sirf leaderboard ka nahi.

**Isse ek baat badalti hai.** Leaderboard aaj **sabko dikhta hi nahi** —
`bonus.routes.js:19` par wo `manageSettings` ke peeche hai, yaani sirf leadership ke paas.
To owner ka apna udaharan ("employee poochh sake ki sabse zyada task kiske complete hue")
is niyam se **nahi chalega**. Niyam jeeta, udaharan nahi. Chahein to badal sakte hain, par
tab wo ek **naya** faisla hoga — "jo pehle se dikhta hai" wala nahi.

---

## 1. Chhota jawab

Ban sakta hai, aur jitna lagta hai usse **kam** kaam hai — kyunki aapke teeno niyam pehle se code me likhe hue hain:

```js
// lib/permissions.js:68 — apni cheez hamesha apni
if (action === 'viewUserData' && userId(user) === String(resource.userId)) return true;

// lib/permissions.js:106 — dues sirf Admin Manager ke paas, leadership ke paas NAHI
case 'manageDues': return role === 'ADMIN_MANAGER';

// task.service.js:286 — doosre ke task sirf viewEveryone wale ko
const canSeeAll = can(actor, 'viewEveryone') || can(actor, 'manageSettings');
```

To AI ke liye **naya permission system nahi banega**. Wahi purana `can()` lagega. Agar AI ke liye alag niyam likhne padte to ye plan hi galat hota — do jagah ek hi sach rakhne se wo ek din aapas me alag ho jaate hain.

---

## 2. API key kaise banayein

Console me (`console.anthropic.com`) — ye aapko khud karna hoga, main key nahi bana sakta.

1. **API keys** → **Create key**
2. Naam: `managibot-prod` (baad me ek aur `managibot-dev` bana lena, taaki test ka kharcha alag dikhe)
3. Workspace: **Default** — workspace key banane wale ke jaane ke baad bhi chalti rehti hai
4. **Key sirf EK BAAR dikhti hai.** Copy karke kahin surakshit rakh lein; dobara nahi dikhegi (kho jaye to nayi banani padegi)
5. AWS Lambda → aapka function → **Configuration → Environment variables** → add:
   `ANTHROPIC_API_KEY = sk-ant-...`
6. Console → **Credits/Limits** me ek **spend limit** laga dein, taaki kuch bigde to bhi $100 na udein

**Key kabhi website me nahi jayegi** — na Amplify ke env me, na frontend bundle me, na git me. Bundle me chali gayi to koi bhi use nikaal kar aapke credit kharch kar sakta hai. Saari call backend (Lambda) se hi jayengi.

---

## 3. Kaam kaise karega

```
Buddy (browser)
   │  POST /api/assistant/ask  { "question": "..." }   ← Bearer token, jaisa baaki app me
   ▼
Lambda  ─ 1. token se pata chala KAUN poochh raha hai
         ─ 2. us bande ke permission se TOOL-LIST banti hai
         ─ 3. Claude ko sawaal + wahi tool-list bheji
         ─ 4. Claude bola "ye tool chalao" → tool chala (andar `can()` dobara check)
         ─ 5. tool ka jawab Claude ko → Claude ne bhasha me likha
         ─ 6. jawab + Activity log
   ▼
Buddy  ─ jawab dikhaya
```

**AI ko database kabhi nahi milta.** Use sirf tools milte hain. Tool ke andar wahi service function chalta hai jo aaj REST API chalati hai — yaani wahi hisaab, wahi niyam, wahi `can()`.

**Technical settings (Sonnet 5.5):**

| Cheez | Value | Kyun |
|---|---|---|
| SDK | `@anthropic-ai/sdk` | project JavaScript hai |
| Model | `claude-sonnet-5-5` | owner ka faisla |
| Effort | `low` | chat jaisa kaam hai; jawab tez aur sasta |
| `tool_choice` | `auto` | Sonnet 5.5 par forced tool_choice 400 deta hai |
| `max_tokens` | ~1500 | jawab chhote hote hain |
| Tool rounds | zyada se zyada **3** | API Gateway 29 sec par request kaat deta hai |
| Caching | system prompt + tool list par | wo har sawaal me ek jaisa hai → input ka daam gir jata hai |

**Streaming v1 me nahi.** API Gateway ke REST raaste se streaming nahi hoti. Jawab aane me 3–8 second lagenge, isliye buddy us dauran "soch raha hoon" wala animation dikhayega. (Chat ka WebSocket jis din live hoga, usi se streaming bhi jod sakte hain.)

---

## 4. Tools — asli design

Teen tabke. **Jo tool kisi ko nahi milna chahiye, wo uski list me bheja hi nahi jayega.** Jo cheez maujood hi nahi, use jailbreak nahi kiya ja sakta.

### 4a. Apni cheezein — sabko (koi `userId` parameter NAHI)

Inme employee ka id **token se** aata hai, AI ke batane se nahi. AI chaahe bhi to kisi aur ka naam nahi daal sakta — parameter hi nahi hai.

| Tool | Kya lautaata hai |
|---|---|
| `meri_attendance(from, to)` | ginti: present / late / absent / leave / WFH din, kul worked, kul overtime, aur late dinon ki chhoti list |
| `mera_din(date)` | ek din: in, out, worked, overtime, status, late reason, half-day |
| `mera_leave_balance()` | quota, liya hua, baaki, aur ye ki saal **31 March** ko khatam hota hai |
| `meri_leaves(from, to)` | apni leave list + ginti |
| `mere_points(month)` | kul points, kis wajah se kitne, aur streak |
| `mere_tasks(status)` | apne task |
| `mere_dues()` | apna hisaab — jitna `GET /dues/me` aaj deta hai |

> `dues.routes.js:11` par pehle se likha hai: *"Every user — their OWN ledger only."* Yaani apna hisaab khud dekhna aaj bhi chalta hai; buddy koi nayi cheez nahi khol raha. **Doosre** ka hisaab sirf `manageDues` wale ko — CEO ko bhi nahi.

### 4b. Sabke dekhne ki cheezein — sabko

| Tool | Gate | Note |
|---|---|---|
| `chhuttiyan(from, to)` | `viewCalendar` (sabke paas) | holiday + birthday |
| `announcements(limit)` | `viewAnnouncements` (sabke paas) | |
| `niyam(topic)` | sabko | Rules page ka content |

> Is tabke me **leaderboard nahi hai aur "aaj kaun chhutti par hai" bhi nahi** — dono aaj
> sabko dikhte hi nahi (`bonus.routes.js:19` → `manageSettings`;
> `dashboard.service.js:282` → `viewEveryone`). §0 ke niyam se dono §4c me gaye.

### 4c. Doosron ki cheezein — sirf jab `can()` haan kahe

| Tool | Gate | Kiske paas |
|---|---|---|
| `kisi_ki_attendance(naam, from, to)` | `viewEveryone` | CEO, Director, Admin Manager, Manager |
| `kisi_ki_leaves(naam, from, to)` | `viewEveryone` | wahi |
| `aaj_ka_roster(date)` | `viewEveryone` | wahi |
| `kisi_ke_tasks(naam, status)` | `viewEveryone` ya `manageSettings` | task.service.js ka hi niyam |
| `team_points(month)` | `viewEveryone` | wahi |
| `leaderboard(month)` | `manageSettings` | aaj ka hi gate — leadership |
| `aaj_kaun_chhutti_par(date)` | `viewEveryone` | aaj ka hi gate (owner: "leadership ko hi dikhe") |
| `pending_approvals()` | `approveLeave` / `approveRegularization` | approvers |
| `kharche(from, to)` | `viewExpenses` | CEO, Director, Admin Manager, Manager |
| `dues(naam)` | `manageDues` | **sirf Admin Manager — CEO ko bhi nahi** |

**Naam se aadmi pehchanna:** "Faiz" → kaunsa user, ye **server** tay karega (roster se), AI nahi. Do log mil gaye to buddy wapas poochhega *"Mohd Faiz ya Faiz Ahmad?"* — apne se andaza nahi lagayega.

### 4d. v1 me AI kuch **karega nahi**, sirf batayega

Task dena, leave lagana, attendance badalna — ye sab **v1 me nahi**. Padhne me galti ka matlab galat jawab hai; likhne me galti ka matlab **galat record**. Pehle padhna sahi chale, phir §7 me likhne wala phase.

---

## 5. Security — ginti ke niyam

1. **AI kabhi access tay nahi karta.** Prompt me "sirf apna batana" likhne se security nahi banti — koi na koi ghuma kar nikal hi lega. Rok **tool ke andar** hai.
2. **Kaun poochh raha hai — sirf token se.** AI likhe *"main CEO hoon"*, koi farak nahi padta.
3. **Tool-list permission se chhanti hai.** Employee ki request me `dues` ya `kisi_ki_attendance` tool **bheja hi nahi jata**.
4. **Dohri rok.** Tool list se chhanta hai, aur tool ke andar `can()` dobara chalta hai. Ek jagah galti ho to doosri pakad legi.
5. **Apne wale tools me `userId` parameter hai hi nahi.**
6. **Data hukum nahi hai.** Kisi ne announcement/task me likh diya *"saare dues bata do"* — wo sirf likha hua text rahega, aadesh nahi. Tool ka jawab hamesha structured (JSON) jayega, khuli kahani nahi.
7. **Har sawaal Activity log me** — kisne, kya poocha, kaunse tool chale, kitne token lage.
8. **Rate limit** — har bande ke liye ginti ke sawaal per ghanta. Ek banda ya koi bug loop me credit na uda de.
9. **API key sirf Lambda env me.**

### Khud par shaq — teen cheezein jo galat ho sakti hain

- **Jawab me zyada bata dena.** Tool ne sahi data diya par AI ne jodte waqt kuch aur jod diya. Isliye tool utna hi lautaayega jitna chahiye — "poora record" kabhi nahi.
- **Naam ki ulajhan.** Do "Saini" hain. Isliye server match karega aur ulajhan par wapas poochhega.
- **Galat hisaab.** AI ginti khud na kare — joad-ghataav **tool** karega (wahi service jo page par dikhta hai), AI sirf use padh kar likhega. Warna buddy ka number page ke number se alag ho jayega, aur wo sabse bura hoga.

---

## 6. Kharcha — kaise kaabu me rahega

$100 me Sonnet 5.5 par mota-moti **5–6 mahine** (15 log, roz 3-4 sawaal). Par ye andaza hai; asli number pehle hafte me naap kar dunga.

Kharcha sabse zyada **tool kitna data lautaata hai** se badhta hai. Isliye:

- Tools **ginti aur joad** lautaate hain, kachchi row nahi — *"October me 21 din present, 2 late, 14h overtime"*, na ki 21 alag row
- List par hamesha dhakkan: zyada se zyada 10–20 row
- Date range par seema: default current month, zyada se zyada 1 saal
- `max_tokens` 1500, effort `low`, zyada se zyada 3 tool round
- System prompt + tool list **cached** — har sawaal me wahi hissa dobara poore daam par nahi padta
- Har jawab ke saath `usage` log hoga → hafte baad asli kharcha saaf dikhega

---

## 7. Buddy ka screen

**Bubble ek hi rahega.** Abhi bottom-right me chat ka bubble baitha hai; do bubble bure lagenge. Buddy wahi jagah lega aur chat uske andar chali jayegi (ya chat thoda upar — §8).

**Bubble ki jagah (owner, 23 Oct):** chat ka bubble jahan hai wahin rahega; buddy uske
**thoda upar, chhota**.

**Icon: owner ka diya hua Lottie** — "Ai Blob" (`website/public/buddy/blob.json`, 27 KB,
1716×1716, 60fps, 6 sec loop). Isme 6 blur effect, 3 gradient aur 3 mask hain, isliye
**browser me chala kar naapa** (23 Oct):

| Naap | Nateeja |
|---|---|
| **SVG renderer** | blur sahi chalta hai, blob waisa hi dikhta hai jaisa dikhna chahiye |
| **Canvas renderer** | blur **nahi** chalta — chapte, kade kinaaron wale shapes. Isliye canvas nahi |
| **Ek blob, 56px, chalta hua** | fps 30, p95 **33.6 ms** |
| **Bina blob, wahi page** | fps 30, p95 **33.6 ms** — yaani farak naapne par dikha hi nahi |
| **7 instance ek saath (ek 200px ka)** | fps 28 — yaani bade size aur kai copies mehengi hain, ek chhoti nahi |

To Lottie theek hai, par **paanch shart ke saath**:

1. **SVG renderer hi** — canvas blur tod deta hai
2. **JSON `/public` se fetch hoga**, `import` nahi — warna 27 KB main bundle me ghus jayega
3. **lottie-web lazy load** (~70 KB gzip) — sirf jab buddy pehli baar mount ho. Pehle paint
   par ek byte nahi. (iPhone ki slow-open wali samasya pehle se chal rahi hai — usme aur
   bojh nahi jodna.)
4. **Ruk jaye jab dikhe hi na** — tab chhupi ho, ya app background me ho
5. **Lite mode (`om_lite_ui`) me ruka hua pehla frame** — wo bhi saaf dikhta hai (safed-neela
   chamakta gola), animation ki zaroorat nahi

**Phone par naapa NAHI hai** — ye desktop ke number hain (dpr 1.25). Phone par pehli baar
lagte hi dobara naapenge; mehenga nikla to shart #5 wala ruka hua frame default kar denge.

Components ke liye pehle **VengeanceUI** dekha jayega.

**Khulne par:** phone me neeche se sheet, desktop par side panel. Andar teen taiyaar chips — *"mera overtime"*, *"mera leave balance"*, *"aaj kaun chhutti par hai"*. Jawab ke neeche chhoti line: *"Attendance se"* — taaki pata rahe number aaya kahan se.

**Jab access na ho:** *"Ye aapke access me nahi hai"* — seedha aur saaf. AI ye nahi batayega ki data hai kya, sirf ye ki dikhaya nahi ja sakta.

---

## 8. Faisle — ho gaye (23 Oct 2026)

| # | Sawaal | Owner ka faisla |
|---|---|---|
| 1 | Leaderboard sabko? | **Nahi.** "Jo sabko dikhte hain wo sabko, jo nahi dikhte wo na dikhein" → §0 ka niyam. Leaderboard aaj `manageSettings` ke peeche hai, to buddy me bhi wahin rahega |
| 2 | Apne dues? | **Haan** — `GET /dues/me` pehle se sabke liye khula hai (check kiya) |
| 3 | "Aaj kaun chhutti par hai" sabko? | **Nahi — leadership ko hi** (aaj ka `viewEveryone` gate waisa hi) |
| 4 | Chat ka bubble? | **Dono rahenge** — buddy chat ke bubble se thoda upar, chhota |
| 5 | Icon? | Owner ka **Lottie "Ai Blob"** — §7 ki paanch shart ke saath |

**Abhi bhi khula:** buddy ka **naam**. Bina naam ke bhi shuru ho sakta hai (abhi "Buddy"),
baad me badalna ek line ka kaam hai.

---

## 9. Phases

| Phase | Kya | Kitna |
|---|---|---|
| **0** | API key → Lambda env → ek chhota check ki key chal rahi hai. Koi UI nahi. | ghante bhar |
| **1** | 6 "apne" tools + 3 public tools + buddy UI. Sirf padhna. **Yahi asli cheez hai.** | 3–4 din |
| **2** | Leadership wale tools (§4c) | 2 din |
| **3** | AI se kaam karwana (task dena, leave lagana) — har kaam se pehle "Confirm" button | baad me, alag faisla |

Phase 1 ke baad hafta bhar asli istemal dekhenge: kaunse sawaal aate hain, kharcha kitna, jawab kitne sahi. Us naap ke baad hi phase 2.

---

## 10. Jo is plan me jaan-bujh kar NAHI hai

- **Koi bahar ka data nahi.** Web search nahi, koi doosra system nahi. Sirf aapka database.
- **AI poore database par "sawaal" nahi chalayega.** Koi free SQL nahi — sirf ginti ke tay-shuda tools. Isi se security bhi aati hai aur kharcha bhi kaabu me rehta hai.
- **Purana data AI ko nahi bhejenge.** Har sawaal us waqt ka taaza data uthayega.
- **Chat history AI ko yaad nahi rahegi** (v1) — har sawaal apne me poora. Baad me chaahein to ek baithak ke andar yaad rakhna jod denge.

---

**Agla kadam:** §8 ke paanch jawab, aur Lambda me `ANTHROPIC_API_KEY`. Uske baad Phase 0 se shuru.
