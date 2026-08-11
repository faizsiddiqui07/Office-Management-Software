# Audit 09 — Expenses register + Dues ledger (11 Aug 2026)

> Process: 5 specialist agents (money, dates, security, consistency, ux-perf) → har RED/MEDIUM adversarial verification se guzri → **39 confirmed, 0 refuted**.
>
> 39 me bahut overlap tha — **paanch alag agents ne ek hi bug pakda** (do baar). Dedupe ke baad **5 RED + 9 MEDIUM + 1 LOW**.
>
> **STATUS: kuch bhi fix NAHI hua.** Har bug owner ko samjha ke, approval ke baad hi ([[explain-bugs-before-fixing]]).

Ye module baaki sab se alag hai: **yahan seedha paisa hai.** Baaki pages me galat number ka matlab tha "report galat dikhi"; yahan matlab hai **"kisi ka paisa galat gina gaya"**.

**Maine teen sabse bade khud verify kiye** — comma wala bug to Node me chala kar dekha.

---

# 🔴 RED — 5

## 🔴 E1 — Amount me **comma** likho to paisa **1000 guna kam** store hota hai

**Kahan:** `website/lib/expense.js:38-41` (`rupeesToPaise`)
**Kis-kis ne pakda:** **paanchon agents ne** — money, dates, security, consistency, ux-perf

### Kya galat hai

Aap bill dekh kar amount likhte ho — jaise `12,500.50`. App usme se **sirf `12`** padhti hai. Register me **₹12.00** likha jaata hai. **₹12,488.50 gayab** — bina kisi warning ke.

### Maine khud chala kar dekha

```
aap likhte ho          →  store hota hai
12500.50               →  ₹12,500.50    ✅ (bina comma ke theek)
12,500.50              →  ₹12.00        ❌
1,200                  →  ₹1.00         ❌
2,50,000               →  ₹2.00         ❌
1,00,000               →  ₹1.00         ❌  ← ek lakh ka ek rupya
```

### Ye hota kaise hai

```js
export function rupeesToPaise(str) {
  const n = parseFloat(str);            // ← yahin
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
```

`parseFloat` ek purani JavaScript cheez hai jo **pehle gair-number akshar par ruk jaati hai** aur usse aage sab chhod deti hai. Comma dekha → wahin ruk gaya. `"1,00,000"` me se use sirf `1` mila.

**Aur koi bhi pehra ise nahi rokta:**
- Client ka check `amount <= 0` hai → 100 paise > 0, **pass**
- Server ka validator "poora number, 0 se bada" maangta hai → 100 ek valid number hai, **pass**
- Kahin koi error nahi

### ⚠️ Sabse chubhne wali baat — sahi tareeka **isi app me pehle se maujood hai**

| Box | Kaun bharta hai | Surakshit? |
|---|---|---|
| Employee ka UPI advance (`dues-personal.jsx:214`) | employee, apne liye | ✅ **`type="number"`** — browser khud comma rok deta hai |
| **Add expense ka amount** | admin, poori company ka kharcha | ❌ sirf `inputMode="decimal"` (wo bas mobile keyboard ka ishara hai, koi rok nahi) |
| **Add due / payment ka amount** | admin, sabka paisa | ❌ wahi |

Yaani jo box **employee apne liye** bharta hai wo bacha hua hai, aur jin **do box se poori company ka paisa** likha jaata hai wo khule hain.

### Nuksaan kitna

- **Paisa chupchaap gayab.** Register, CSV, PDF, company report — sab wahi galat figure padhte hain
- **Edit kholo to bhi galat dikhega** (`₹12.00`), to admin ko lagega usne 12 hi likha tha
- **Audit log bhi jhooth bolega** — usme bhi truncated figure hi jaata hai, to baad me jaanch me bhi nishaan nahi milega
- **Employee ko notification jaata hai "₹1.00 add hua"** — wo khush hai, koi shikayat nahi karta, to galti mahino tak pakdi nahi jaati
- **Dues me edit karne par cash record bhi mit jaata hai** (E3 dekho)

### Aaj tak dikha kyun nahi

Kyunki jab aap **bina comma ke** likhte ho (`12500.50`) to sab bilkul theek chalta hai. Bug **sirf tab** hai jab comma ho — aur comma tab aata hai jab aap bill se **copy** karo, ya aadat se `1,00,000` type karo.

### Fix se kya badlega

Do line: dono admin box par wahi `type="number"` jo employee wale par pehle se hai, **aur** `rupeesToPaise` me comma/space hata kar padhna.

**Purane data par asar:** jo entries **pehle se galat** ban chuki hain wo apne aap theek **nahi** hongi. Main aapko **list dunga** — kaunsi entries shak-wali lagti hain (bahut chhoti figure, jaise ₹1.00 / ₹12.00) — aap dekh kar batayenge asli figure kya tha.

---

## 🔴 E2 — Kisi ko **deactivate** karte hi uska bakaya paisa **ledger se gayab** ho jaata hai

**Kahan:** `backend/src/services/dues.service.js:103` — `User.find({ isActive: true })`
**Kis-kis ne pakda:** **paanchon agents ne**

### Kya galat hai

Ramesh par **₹4,500** bakaya hai. Wo naukri chhod deta hai, aap use deactivate karte ho.

Agle hi pal:
- Dues page ka **"Total pending" ₹18,750 se girkar ₹14,250** ho jaata hai
- "7 owing" se **"6 owing"**
- **Ramesh list me hai hi nahi** — na uska ledger khul sakta hai, na settle ho sakta hai

**Aur kahin nahi likha ki ₹4,500 ka kya hua.** Wo bas gayab ho gaya.

### Sabse buri baat — CSV ab bhi bolta hai

Usi page ke **Export** button se jo CSV nikalta hai, usme **Ramesh ki chaaron rows "Pending"** likhi hui aati hain.

Yaani **do surface ₹4,500 par ladte hain**, aur **screen wala figure galat hai**.

### Nuksaan kitna

- Aapko **pata hi nahi chalega** ki kis-kis se paisa lena baaki hai
- Jo aadmi ja raha hai, theek us waqt uska hisaab **screen se gayab** ho jaata hai
- Company ka total **kam dikhta hai** — matlab jitna paisa aana hai, usse kam

*(Mazedaar baat: deactivate karte waqt Edit dialog me ek amber box aata hai jo **saaf likhta hai** "Unsettled dues ₹4,500". Aap wo dekh kar sochte ho "baad me settle kara lenge" — aur uske baad wo aankhon se hi gayab ho jaata hai.)*

---

## 🔴 E3 — Due ka amount **kam karne** par pehle mila hua **cash chupchaap mit jaata hai**

**Kahan:** `backend/src/services/dues.service.js:251` — `if (entry.paid > entry.amount) entry.paid = entry.amount;`

### Kya galat hai

Galti sudhaarne par **paisa gum ho jaata hai**, advance nahi banta.

### Din-ba-din

| Kab | Kya hua |
|---|---|
| **3 Aug** | Admin Ramesh ke liye due likhta hai: *Lunch thali · Sharma Dhaba* — **₹500** |
| **3 Aug shaam** | Ramesh **₹500 cash** deta hai. Admin "Settle ₹500" dabaata hai. Ramesh ko notification: *"₹500 settled — All settled"*. **Yahan tak sab sach hai** |
| **5 Aug** | Bill dekha to thali **₹300** ki thi. Admin entry edit karke amount **₹300** kar deta hai |
| **Us pal** | System: *"paid (₹500) amount (₹300) se zyada hai — to paid ko bhi ₹300 kar do"*. **₹200 ka record mit gaya** |
| **Nateeja** | Ramesh ki screen: **"All settled"**. Pending ₹0, Advance ₹0. **Ramesh ke ₹200 gayab** |

**Sahi kya hona chahiye tha:** advance **₹200** — kyunki wo paisa sach me diya gaya tha.

Aur audit log me bhi sirf naya amount (₹300) jaata hai — **purana paid (₹500) kahin record nahi hota**, to baad me pata bhi nahi chalega.

---

## 🔴 E4 — Dashboard **company ka poora kharcha leak** kar deta hai, `viewExpenses` ke bina

**Kahan:** dashboard ka "Spend this month" chart

### Kya galat hai

Aap ek role banate ho — *"Leadership dashboard & analytics"* **ON**, aur Expenses ke **dono toggle OFF**. Aapki niyat saaf hai: **ye banda analytics dekhe, paisa nahi.**

Aap check bhi karte ho, aur sab theek lagta hai:
- Sidebar me **Expenses hai hi nahi**
- URL type kare to **"No access"**
- Company report download kare to **expenses ka section hi nahi**

**Phir wo Dashboard kholta hai** — aur wahan *"Spend this month · August 2026"* ka graph hai, jisme **1 se 11 Aug tak har din ka company kharcha** hai. Points jodo to poora mahine ka total mil jaata hai.

### Nuksaan kitna

Aapne jaan-boojh kar jise paisa dekhne se roka, wo **poora mahine ka kharcha din-ba-din** dekh raha hai. Aur aapko lagta hai ki aapne rok diya hai — kyunki teen jagah check karke aap santusht ho chuke ho.

---

## 🔴 E5 — Date picker **device ki ghadi** se chalta hai, company (IST) time se nahi

**Kahan:** Expense aur Dues dono dialogs ka date field

### Kya galat hai

Poore app me tarikh **India ke time** se tay hoti hai — Lambda UTC par chalta hai, isliye ye fix jaan-boojh kar lagaya gaya tha. **In do modules par wo lagaya hi nahi gaya.**

### Misaal — "₹6,400 ka September ka bill August me chala gaya"

> Admin travel par hai, laptop **US time** par. Ya office ka ek laptop galti se UTC par pada hai.
>
> **1 September 2026, subah 3:00 IST** — us waqt UTC me abhi **31 August** hai.
>
> Admin *Add expense* kholta hai, ₹6,400 ka grocery bill. Date ka khana khud-b-khud **"31 Aug 2026"** bhar leta hai.
>
> Admin ko shak hota hai, calendar kholta hai — **1 September grey hai, dabta hi nahi.** "Today" button bhi grey. Agle mahine ka teer bhi band.
>
> Majboori me **31 Aug** par hi Add dabaana padta hai.

**Nateeja:** September ka bill August me. September ka "This month" **₹6,400 kam**, August **₹6,400 zyada**. Aur usi waqt Dashboard September dikha raha hoga — **do screen do alag mahina**.

---

# ⚠️ MEDIUM — 9

| # | Bug | Ek line me |
|---|---|---|
| **E6** | "Biggest category" aur "How it was paid" **filter ko ignore** karte hain | Headline total filtered hai, uske **theek neeche** ka figure unfiltered — to card apne hi total se **bada number** chhaap sakta hai |
| **E7** | "Last 12 months" chart chune hue period ke **end par** anchored hai | "Last month" chunne par wo **pichhle 12 mahine** nahi rehta. Aur "This year" par chupke se **fiscal year** ban jaata hai — 7 mahine dikhaata hai |
| **E8** | **Adhoora chalu mahina** poore pichhle mahine se compare hota hai | "This month" hamesha "X% less than July" dikhayega — 11 tarikh ko 31 din se tulna |
| **E9** | Dues CSV ka Paid/Partial/Pending status ek **truncated 10,000-row list** se nikalta hai | Wahi truncation jo `ledgerFor` me theek ki ja chuki hai, yahan reh gayi |
| **E10** | `ledgerFor` ka **300-entry display cap** self-report me leak hota hai | Purane period ki dues table **adhoori** dikhti hai — balance poore data se, list 300 me se |
| **E11** | `manageDues` wala **apna khud ka ledger dekh hi nahi sakta**, par uska balance "Total pending" me ginta hai | Total me hai, roster me row nahi — figure kabhi milta hi nahi |
| **E12** | Har validation failure sirf **"Invalid request"** | Asli wajah kabhi nahi dikhti *(yahi audit 08 ke T13 me bhi tha)* |
| **E13** | **Settle-all** wapas nahi ho sakta, koi PAYMENT row nahi banata, aur confirm ki likhawat **jhooth** bolti hai | Cash aane ka koi record hi nahi bachta |
| **E14** | Dashboard **"Add expense"** un roles ko bhi offer karta hai jinhe `/expenses` khud refuse karta hai | Wahi pattern jo audit 08 ke T10 me tha |

**LOW:** Dues overview har page load aur har badlaav par **poori LedgerEntry collection** uthata hai (bina `lean`) — abhi chhota hai, headcount × mahino ke saath badhega.

---

## 🔗 CROSS-CONNECTIONS

| Ye bug | Kis purane audit se juda |
|---|---|
| **E5** (device clock) | Wahi bimari jo **T5** (joining date) me thi — browser me date ka galat padha jaana. Teesri jagah |
| **E9, E10** | **"`.limit(N)` wali list se figure banana"** — cross-page pattern #14 (My Summary S2). Ab teen jagah |
| **E2** | **"deactivated user ek figure se gayab, doosre se nahi"** — cross-page pattern #2 |
| **E12** | audit 08 ka **T13** — wahi "Invalid request" |
| **E14** | audit 08 ka **T10** — UI wo cheez offer karta hai jo server mana kar deta hai |
| **E6, E7, E8** | **"ek hi number do tarah se"** — har audit me mila hai |

---

## 💡 FEATURE IDEAS → **[00-features.md](00-features.md)**
