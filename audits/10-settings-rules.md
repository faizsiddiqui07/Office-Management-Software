# Audit 10 — Settings + Rules (11 Aug 2026)

> Process: 5 specialist agents (blast-radius, validation, security-perf, rules-page, ux) → har RED/MEDIUM adversarial verification se guzri → **35 confirmed, 1 refuted**.
>
> Bahut overlap tha — **paanch agents ne ek hi cheez pakdi** (do baar), **chaar ne** (teen baar). Dedupe ke baad **7 RED + 8 MEDIUM**.
>
> **STATUS (11 Aug 2026): S1, S3, S5, S7 FIXED** (`dcbbd1a`, 12/12 isolated-DB suite + pre-fix proof). Baaki (S2/S4/S6 + 8 MEDIUM) parked — owner ka faisla baaki. Push/zip nahi ([[no-auto-push]]).

## Is audit ka ek hi bada sabak

Settings me kuch bhi **dikhne ke liye** nahi hai. Ye wo numbers hain **jinse baaki poora app hisaab lagata hai**. Aur audit ne ye nikala:

> **Settings me lagbhag har cheez badalne se BEETA HUA waqt dobara likha jaata hai.**

Rewards audit (R2) me hum ne yahi bimari pakdi thi aur `rateHistory` banaya tha — taaki rate badalne se band mahina dobara price na ho. **Wo fix aadha tha.** Point ki keemat to effective-dated ho gayi, par ye sab **abhi bhi** peeche jaakar sab kuch badal dete hain:

| Setting | Badalne par |
|---|---|
| **₹ per point** | har band mahine ka **payout** dobara ginta hai |
| **grace minutes / workStart** | purani LATE rows aur late-penalty **dobara derive** hote hain |
| **workEnd / overtime buffer** | **har attendance record** dobara naapa jaata hai, band mahine ke overtime points dobara likhe jaate hain |
| **weekendDays** | band mahine ki attendance sheet **peeche se badal** jaati hai |
| **annualLeaveQuota** | Rules page turant naya number bolta hai, par **kisi ka balance nahi badalta** |

---

# 🔴 RED — 7

## 🔴 S1 — `reconcilePerfectMonth` chalte hi **crash** karta hai — aur **ye maine hi toda tha**

**Kahan:** `backend/src/services/bonus.service.js:864`

### Kya galat hai

Line **864** par `monthEnd` use hota hai. Wo variable line **873** par declare hota hai — **9 line neeche**. JavaScript me ye chalta hi nahi:

```
ReferenceError: Cannot access 'monthEnd' before initialization
```

Maine ye khud chala kar dekha. Function ka **poora baaki hissa dead code hai** — control 865 tak pahunchta hi nahi.

### Ye maine kab daala

`git log` se exact commit mil gaya — **`33ee465`, "effective-dated point values + a per-period rate table (fixes R2)"** — yaani **Rewards audit ka R2 fix jo maine banaya tha**:

```diff
-  const pts = rulePoints(b, 'perfectAttendanceMonth');
+  const pts = rulePoints(b, 'perfectAttendanceMonth', monthEnd);
```

Maine teesra argument joda taaki us mahine ka sahi rate lage — **par declaration upar khiskana bhool gaya.** Ek din pehle (`5cd2bb5`) ye function theek chal raha tha.

### Nuksaan

Ye function tab chalta hai jab **backdated leave approve ya cancel** hoti hai:

> Ravi 15 July ko bina leave ke absent tha → July ka perfect-attendance award **deny** hua (sahi).
> 5 Aug ko leadership backdated SICK leave approve karti hai. Attendance sheet par din ABSENT se ON_LEAVE ho jaata hai, **absent ki penalty hat bhi jaati hai** — par perfect-attendance ka award **kabhi nahi milta**, kyunki wo function crash kar jaata hai.

Ulta bhi utna hi kharab: jisko award mil chuka tha, uski leave **cancel** hone par din wapas ABSENT ho jaata hai par **award ledger par pada rehta hai**.

Matlab **aadha reconciliation hota hai, aadha nahi** — penalty side sudhar jaati hai, award side nahi.

### Kyun kisi ko pata nahi chala

Dono call sites `try/catch` me hain jo sirf `console.error` karte hain. **App me kahin nahi dikhta** — logs me dikhta hai.

### ⚠️ Verifier ki corrections

- **"Hamesha se toota"** galat hai — ye **do din purana regression** hai (8 Aug ko theek tha, 9 Aug ko toota)
- Fix sirf line khiskana **nahi** hai — `monthEndOf(month)` helper pehle se maujood hai (`:144`) aur `runMonthRollup` bilkul wahi use karta hai. Ek hi cheez do jagah do tarah se nikalna wahi pattern hai jo pehle bhi problem bana hai
- Ek **teesra** dead path bhi hai: agar CEO perfect-attendance rule **OFF** kar de, to purane award delete karne wali line bhi throw ke peeche hai — rule band hone ke baad bhi **purana award ledger par pada rahega**

---

## 🔴 S2 — **₹ per point** effective-dated nahi hai — band mahine ka **payout** badal jaata hai

**Kis-kis ne pakda:** chaar agents

R2 fix me point ki **ginti** effective-dated ho gayi (July ka task July ke rate se). Par **₹/point** wahi ek live number hai — aur payout usi se banta hai.

> July me Ravi ke 40 points bane, ₹10/point → payout **₹400**.
> Aap 20 Aug ko ₹/point badal kar **₹12** karte ho.
> **July ki wahi report ab ₹480 bolti hai.** Points 40 hi hain, rupaye badal gaye.

Aur report me likha hota hai ki wo us period ke rate se bana hai — jo ab jhooth ho jaata hai.

---

## 🔴 S3 — Leave quota badlo: **Rules turant naya number** bolta hai, par **kisi ka balance nahi badalta**

**Kis-kis ne pakda:** chaar agents

> Aap `annualLeaveQuota` 18 se **20** karte ho.
> Rules page **usi pal** har employee ko *"aapko saal me 20 chhutti milti hain"* bolne lagta hai.
> Par **kisi ki bhi maujooda balance row nahi badalti** — sabke paas abhi bhi 18 hain.

Employee rule book padh kar 20 maangega, system 18 dega. **Do jagah do jawab, aur employee ke paas likhit sabooot hai.**

*(Aur post-go-live joiner ka to pro-rata quota hota hai — unhe Rules company ka poora number dikhata hai, jo unke liye kabhi sach tha hi nahi.)*

---

## 🔴 S4 — Office hours / grace / overtime buffer badlo → **poora ateet dobara likha jaata hai**

**Kis-kis ne pakda:** chaar agents

- **grace ya workStart** badlo → purani LATE rows aur late-penalty points **dobara derive** hote hain
- **workEnd ya overtime buffer** badlo → **har attendance record** dobara naapa jaata hai, aur band mahine ke overtime points dobara likh diye jaate hain
- Aur **`workEnd < workStart` kahin bhi block nahi hai** — ek AM/PM ki galti poore office ki saari purani overtime aur bonus ek jhatke me badal degi

---

## 🔴 S5 — Rules page **overtime ka galat niyam** batata hai *(ye wahi purani flagged gadbad hai — ab confirm)*

**Kis-kis ne pakda:** **paanchon agents**

Rules page har bande ko **office ka** overtime buffer batata hai. Par points ka scorer **har bande ka apna** buffer use karta hai.

Jiske paas apni alag timing hai, uske liye **rule book jo kehta hai aur system jo karta hai wo alag hai** — aur rule book wo cheez hai jo staff ko dikhayi jaati hai.

*(Yahi wo discrepancy hai jo Rules module ke notes me pehle se flagged thi. Ab pata hai ki **likha hua galat hai**, code nahi.)*

---

## 🔴 S6 — Ek setting save karo, doosri **chupchaap purani ho jaati hai**

**Kahan:** 5-minute ka full-settings cache + poora-form PUT

Page poora form ek saath bhejta hai. Aur cache 5 minute purana doc de sakta hai. Nateeja: **ek setting save karne se doosri wapas purani ho jaati hai** — bina kuch bataye.

Aur **save fail hone par** wo cached doc **un values ko dikhata rehta hai jo kabhi DB me gayi hi nahi** — aapko lagega save ho gaya.

Isi se juda: **logo upload ya SMTP save karte hi main form ke saare unsaved edits chupchaap wapas purane** ho jaate hain.

---

## 🔴 S7 — Koi number field **khaali** chhod kar Save → chupchaap **0** store

Grace khaali chhoda → **0 minute grace**. Quota khaali → **0 chhutti**. Koi warning nahi.

---

# ⚠️ MEDIUM — 8

| # | Bug | Ek line me |
|---|---|---|
| **S8** | `GET /settings` par **koi permission gate nahi** | Har logged-in employee ko poora document milta hai — bonus ka andar ka hisaab, `rateHistory`, aur **sabke streak counters** |
| **S9** | Reports **aaj ke** grace se on-time/late judge karte hain | Jabki usi report ka points ledger **us din ke** grace se bana tha — ek hi document, do niyam |
| **S10** | `weekendDays` badalne se **band mahine ki attendance sheet peeche se badal** jaati hai | Par uske points nahi — sheet aur ledger alag ho jaate hain |
| **S11** | Har settings save `eodDigest` ka watermark **mita deta hai** | Leadership ko day-close digest **dobara** aa jaata hai |
| **S12** | Time validator `'25:00'` / `'99:99'` **pass** kar deta hai | Invalid Date se poore office ka hisaab bigad sakta hai |
| **S13** | Rules ka **seed-once flag insert se pehle** set hota hai | Insert fail ho jaaye to rules **hamesha ke liye khaali** reh jaate hain |
| **S14** | Rules quota **post-go-live joiner** ke liye galat | Unka pro-rata hota hai, Rules company ka poora number dikhata hai |
| **S15** | 743-line form par har validation failure ek bare **"Invalid request"** | Kaunsa field galat hai, kabhi nahi pata chalta *(yahi T13 aur E12 me bhi tha)* |

**REFUTED (1):** *"app shell har page par poora settings doc kheenchta hai"* — verifier ne is dawe ko **galat** sabit kiya.

---

## 🔗 CROSS-CONNECTIONS

| Ye bug | Kis se juda |
|---|---|
| **S1** | **Maine hi daala**, Rewards R2 fix (`33ee465`) me |
| **S2, S4, S10** | **R2 ka fix aadha tha** — point ki keemat effective-dated hui, baaki sab nahi |
| **S9** | R2 ka hi doosra sira — report aur ledger ek hi cheez do tarah se judge karte hain |
| **S8** | Wahi pattern jo **E4** (dashboard leak) aur **T14** (dossier audit log) me tha — gated data ka doosra darwaza |
| **S15** | **T13** aur **E12** — teesri jagah |
| **S7, S12** | Validator ka nahi rokna — audit 09 ke **E1** (comma) ke saath ek hi parivaar |

---

## 💡 FEATURE IDEAS → **[00-features.md](00-features.md)**
