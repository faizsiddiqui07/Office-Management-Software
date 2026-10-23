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

### Leaderboard — teen hain, do khule aur ek band (24 Oct, code padh kar theek kiya)

Pehle maine likha tha ki "leaderboard sabko dikhta hi nahi" — **wo galat tha**. Maine
sirf points wala dekha tha. Asliyat:

| Leaderboard | Kisko | Kahan se |
|---|---|---|
| **Task leaders** — on-time khatam hue delegated task ki ginti | **sabko** | `GET /dashboard/leaders` — sirf `requireAuth`, koi gate nahi |
| **Overtime leaders** — kisne kitna overtime kiya | **sabko** | wahi |
| **Points leaderboard** — kiske kitne points | **leadership** | `GET /bonus/leaderboard` → `manageSettings` |

`components/dashboard/leaderboards.jsx` me khud likha hai: *"The two public leaderboards,
shown to everyone."* Owner ne yahi kaha tha, aur code bhi yahi kehta hai.

**Ek baareeki jo buddy me rakhni hai:** task leaderboard **har** task nahi ginta — sirf wo
delegated kaam jo **on-time** khatam hua **aur jisme CEO & President shaamil** hai (card
par bhi yahi likha hai). Buddy ko wahi ginti bolni hai jo dashboard bolta hai, isliye wo
`leadersForPeriod()` ko hi bulayega — apna hisaab nahi karega.

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
| `task_leaders(period)` | sabko — `GET /dashboard/leaders` par koi gate nahi | on-time delegated task ki ginti |
| `overtime_leaders(period)` | wahi | kisne kitna overtime kiya |

> `period` wahi teen roop jo dashboard ke MonthPicker me hain: **is mahine / koi purana
> mahina / all time**. Dono tools `leadersForPeriod()` hi bulate hain — wahi function jo
> dashboard ka card bharta hai. Isliye buddy ka number aur card ka number kabhi alag nahi
> honge.
>
> **Points wala leaderboard yahan NAHI hai** — wo `manageSettings` ke peeche hai, to wo
> §4c me gaya. "Aaj kaun chhutti par hai" bhi wahin (`viewEveryone`).

### 4c. Doosron ki cheezein — sirf jab `can()` haan kahe

| Tool | Gate | Kiske paas |
|---|---|---|
| `kisi_ki_attendance(naam, from, to)` | `viewEveryone` | CEO, Director, Admin Manager, Manager |
| `kisi_ki_leaves(naam, from, to)` | `viewEveryone` | wahi |
| `aaj_ka_roster(date)` | `viewEveryone` | wahi |
| `kisi_ke_tasks(naam, status)` | `viewEveryone` ya `manageSettings` | task.service.js ka hi niyam |
| `team_points(month)` | `viewEveryone` | wahi |
| `points_leaderboard(month)` | `manageSettings` | aaj ka hi gate — leadership |
| `aaj_kaun_chhutti_par(date)` | `viewEveryone` | aaj ka hi gate (owner: "leadership ko hi dikhe") |
| `pending_approvals()` | `approveLeave` / `approveRegularization` | approvers |
| `kharche(from, to)` | `viewExpenses` | CEO, Director, Admin Manager, Manager |
| `dues(naam)` | `manageDues` | **sirf Admin Manager — CEO ko bhi nahi** |

**Naam se aadmi pehchanna:** "Faiz" → kaunsa user, ye **server** tay karega (roster se), AI nahi. Do log mil gaye to buddy wapas poochhega *"Mohd Faiz ya Faiz Ahmad?"* — apne se andaza nahi lagayega.

### 4d. AI khud kuch nahi karta — tajweez deta hai (Phase 3, `8077492`)

Padhne me galti ka matlab galat jawab hai; likhne me galti ka matlab **galat record**.
Isliye model ko likhne ka haq diya hi nahi gaya: har `propose_*` tool sirf tajweez banata
hai, aur asli kaam `POST /assistant/confirm` se hota hai — yaani user ke Confirm dabane
par. Tajweez **server par** rakhi jaati hai (`AssistantAction`), client ko sirf uska `id`
milta hai, to beech me taarikh/aadmi/raqam badalne ka raasta hi nahi bachta.

| Kaam | Gate |
|---|---|
| Apna to-do banana | sabko |
| Apna to-do done karna | sabko |
| Chhutti ki arzi | `applyLeave` — aur arzi PENDING banti hai, approver ab bhi ek rok hai |
| **Kisi aur ko task dena** (owner ki ijaazat, 24 Oct) | `canAssignAny` — `can()` nahi, kyunki delegation har bande ke apne `taskAssign` se chalti hai |

Ab bhi **nahi**: kuch approve karna, attendance badalna, paise se juda kuch bhi.

Assign wale par teen taale, teeno naape gaye: naam sirf `assignableUsers()` me se chunta
hai (band bande ka naam AI ke haath me aata hi nahi), `run()` par `canAssignTo` dobara
chalta hai, aur `createTask` apne andar teesri baar. Tajweez banne ke **baad** ijaazat
chhin jaye to Confirm bhi ruk jaata hai.

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

## 5b. Buddy kis cheez ka jawab dega (owner, 24 Oct)

**Niyam:** buddy sirf **salaam-dua** karega aur **app se judi** baatein batayega. Office ke
bahar ka kuch bhi — general knowledge, homework, ghar ki baat, "ye email likh do", cricket
ka score — par wo **majakiya andaz me taal dega**, lambi bahas nahi karega.

Udaharan jo system prompt me jayenge:

| Sawaal | Buddy |
|---|---|
| "Hi / Good morning" | jawab de, aur ek-do kaam ke sujhav de |
| "Mera overtime kitna hua?" | tool se jawab |
| "Chhutti kaise apply karein?" | app ka tareeka bataye |
| "Aaj ka cricket score?" | hans kar taal de |
| "Mere liye ek shayari likh do" | wahi |
| "Mera beta beemar hai, kya karun" | narmi se taal de, aur HR/leadership se baat karne ko kahe |

Wo aakhri line jaan-bujh kar hai — mazak har baat par theek nahi hota. Jahan koi sach me
pareshaani me ho, buddy ka mazak karna galat hoga; wahan wo narmi se insaan ki taraf
bhejega.

### Ye rok KITNI pakki hai — saaf baat

Do alag cheezein hain, aur inki taakat alag hai:

| | Kaise ruka hai | Kitna pakka |
|---|---|---|
| **Kisi aur ka data** | tool hi nahi diya jata | **pakka.** Jo cheez maujood nahi, wo nikaali nahi ja sakti — chahe kuch bhi likh kar poochho |
| **Bahar ki baatein** | system prompt + chhota `max_tokens` | **pakka nahi.** Koi zidd kare to shayad ek-do line nikaal le |

Ye farak chhupana nahi chahta. Scope ko tool se nahi roka ja sakta — "ye sawaal app ka hai
ya nahi" koi permission check nahi hai, wo samajh ki baat hai. **Par nuksaan bhi alag hai:**
kisi ka data lik jana **gambhir** hai; buddy ka kisi ko joke suna dena **sirf bekaar** hai.
Isliye yahan prompt-level rok kaafi hai, aur data par kabhi nahi hogi.

Saath me teen sahare:

1. **`max_tokens` chhota** (~500) — drift bhi ho jaye to nibandh nahi likh sakta
2. **Per-user rate limit** — bahar ki baaton me paisa na bahe
3. **Log** — jab buddy ne bina kisi tool ke jawab diya ho, wo nishaan lag jayega. Hafte baad
   saaf dikhega ki log kitna bhatak rahe hain; zyada ho to prompt kasa jayega

### Bhasha — ek faisla chahiye

App ka UI **English** me hai, par log aapas me **Hinglish** bolte hain. Buddy kis bhasha me
jawab de?

Mera sujhav: **jis bhasha me sawaal aaya, usi me jawab** — "mera overtime?" ka jawab
Hinglish me, "my overtime?" ka English me. Sabse swabhavik lagta hai. Par agar aap chaahte
hain ki hamesha English hi bole (app ke baaki hisse jaisa), wo bhi theek hai — ek line ka
farak hai.

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
| 1 | Leaderboard sabko? | **Niyam:** jo aaj sabko dikhte hain wo sabko, jo nahi dikhte wo nahi. Code padhne par: **task leaders aur overtime leaders sabko** (`/dashboard/leaders`, koi gate nahi), **points wala leadership ko** (`manageSettings`). Teeno waise hi rahenge |
| 2 | Apne dues? | **Haan** — `GET /dues/me` pehle se sabke liye khula hai (check kiya) |
| 3 | "Aaj kaun chhutti par hai" sabko? | **Nahi — leadership ko hi** (aaj ka `viewEveryone` gate waisa hi) |
| 4 | Chat ka bubble? | **Dono rahenge** — buddy chat ke bubble se thoda upar, chhota |
| 5 | Icon? | Owner ka **Lottie "Ai Blob"** — §7 ki paanch shart ke saath |

| 6 | Buddy kis cheez ka jawab de? | Sirf **greet + app ki baatein**. Bahar ka kuch bhi → majakiya andaz me taal de. Poora §5b |

**Abhi bhi khula (dono rokne wale nahi):**

- Buddy ka **naam** — abhi "Buddy" se shuru, badalna ek line ka kaam
- **Bhasha** — sawaal ki bhasha me jawab (mera sujhav), ya hamesha English? (§5b)

---

## 9. Phases

| Phase | Kya | Kitna |
|---|---|---|
| **0** | API key → Lambda env → ek chhota check ki key chal rahi hai. Koi UI nahi. | ghante bhar |
| **1** | 6 "apne" tools + 3 public tools + buddy UI. Sirf padhna. **Yahi asli cheez hai.** | 3–4 din |
| **2** | Leadership wale tools (§4c) | 2 din |
| **3** | AI se kaam karwana — har kaam se pehle "Confirm" | ✅ `8077492` |
| **4** | Baatcheet save (encrypted, 90 din), scroll-upar paging, Activity log se sawaal hataya | ✅ 24 Oct |

Phase 1 ke baad hafta bhar asli istemal dekhenge: kaunse sawaal aate hain, kharcha kitna, jawab kitne sahi. Us naap ke baad hi phase 2.

---

## 10. Jo is plan me jaan-bujh kar NAHI hai

- **Koi bahar ka data nahi.** Web search nahi, koi doosra system nahi. Sirf aapka database.
- **AI poore database par "sawaal" nahi chalayega.** Koi free SQL nahi — sirf ginti ke tay-shuda tools. Isi se security bhi aati hai aur kharcha bhi kaabu me rehta hai.
- **Purana data AI ko nahi bhejenge.** Har sawaal us waqt ka taaza data uthayega.
- ~~Chat history AI ko yaad nahi rahegi~~ — **Phase 4 me jud gaya** (24 Oct, owner ka
  faisla). Baatcheet `AssistantMessage` me **encrypted** rehti hai (wahi `secretBox` jo
  chat ke messages par laga hai), **90 din** baad apne aap mitti hai, panel khulte hi
  aakhri 20 aati hain aur upar scroll par 20-20 aur. AI ko pichhle **6 turn** yaad
  rehte hain — poori history kabhi nahi, warna har sawaal mehenga hota jaata.
  - **Chaabi kabhi mat badalna:** `APP_ENC_KEY` / `JWT_SECRET` badla to 90 din ki saari
    baatein hamesha ke liye band. Yahi khatra SMTP password aur chat par pehle se hai.
  - **Encrypted matn me search nahi ho sakta** — ye keemat jaan-bujh kar di gayi.
  - **Activity log me ab sawaal ka MATN nahi jaata** (owner ka faisla): sirf kisne, kab,
    kaunse tool, kitna kharcha. Baatcheet ek taraf encrypted rakhna aur doosri taraf
    wahi matn khule log me chhodna taala lagane ka natak hota.

---

**Agla kadam:** §8 ke paanch jawab, aur Lambda me `ANTHROPIC_API_KEY`. Uske baad Phase 0 se shuru.
