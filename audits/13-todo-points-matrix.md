# Audit 13 — To-Do page: points ka poora permutation audit

**Date:** 8 September 2026
**Kaise check kiya:** asli service code (`bonus.service.js`, `task.service.js`) ko ek throwaway DB par
har permutation me chala kar. Padh kar andaza nahi lagaya — chala kar nateeja nikala.
Script: `backend/scripts/audit-todo-points-matrix.js` (jab chahe dobara chala lein).
Prod ke numbers alag se read-only query se liye — asli DB me kuch bhi likha NAHI gaya.

**Rates (prod se, 8 Sep 2026):** on-time **+10** | late **−5** | har extra din **−1** |
forward **+3 / −2** | assign-done **+3** | grace **0 din**

---

## 1. Aapke do sawaalon ka seedha jawab

### Sawaal 1 — "task ek ko assign hua aur doosre ko TAG kiya, to kiske points katenge?"

**Sirf jisko ASSIGN hua uske. Tag kiye hue bande ke kabhi nahi — na katte hain, na milte hain.**

Ye 12 alag-alag combinations me check kiya (assigner CEO/Manager × tag Observer/CEO ×
due-date haan/na × nateeja on-time/late/pending). **Baarah ke baarah me tagged bande ka
hisaab theek 0 raha.** Code me bhi points hamesha `task.owner` (copy ka maalik) ya
`assignedBy` (jisne kaam diya) par hi likhe jaate hain — collaborator par kabhi nahi.

Par ek baat jo dikhti nahi hai aur zaroori hai:

> **CEO/President ko tag karne se unke points nahi katte — par jisko kaam mila hai uske
> points katna SHURU ho jaata hai.**

Kyunki niyam ye hai: jo kaam CEO & President ko dikhta hi nahi (na unhone diya, na koi
tag hai) wo points ke hisaab se bahar hai. Table dekhiye — Manager ne bina tag ke kaam
diya to sab kuch 0; wahi kaam CEO ko tag karte hi +10 / −5 chalu ho gaya.

### Sawaal 2 — "do logon ko assign hua, to kab kiske katenge?"

**Dono ki apni-apni alag copy hoti hai, aur har koi sirf apni copy ka hisaab bharta hai.**
Ek ne kar diya to doosre ka kaam khatam nahi hota — uski copy khuli rehti hai aur uspar
roz ki penalty chalti rehti hai.

Assigner ko **ek hi baar +3** milta hai, chahe kaam 5 logon ko diya ho — aur wo +3 usi
waqt mil jaata hai jab **pehla** banda khatam karta hai.

---

## 2. Poori table — ek bande ko assign (24 combos)

`DOER` = jisko kaam mila · `ASSIGNER` = jisne diya · `TAGGED` = jise sirf tag kiya

| assigner | tag kisko | due date | nateeja | **DOER** | **ASSIGNER** | **TAGGED** |
|---|---|---|---|---|---|---|
| CEO | — | haan | on-time | **+10** | +3 | 0 |
| CEO | — | haan | late | **−5** | +3 | 0 |
| CEO | — | haan | pending | **−8** | 0 | 0 |
| CEO | — | nahi | pending | 0 | 0 | 0 |
| CEO | Observer | haan | on-time | **+10** | +3 | **0** |
| CEO | Observer | haan | late | **−5** | +3 | **0** |
| CEO | Observer | haan | pending | **−8** | 0 | **0** |
| CEO | Observer | nahi | pending | 0 | 0 | 0 |
| CEO | CEO (khud) | haan | on-time | **+10** | +3 | (wahi +3) |
| CEO | CEO (khud) | haan | late | **−5** | +3 | (wahi +3) |
| CEO | CEO (khud) | haan | pending | **−8** | 0 | 0 |
| CEO | CEO (khud) | nahi | pending | 0 | 0 | 0 |
| Manager | — | haan | on-time | 0 | 0 | 0 |
| Manager | — | haan | late | **0** | 0 | 0 |
| Manager | — | haan | pending | **0** | 0 | 0 |
| Manager | — | nahi | pending | 0 | 0 | 0 |
| Manager | Observer | haan | on-time | 0 | 0 | **0** |
| Manager | Observer | haan | late | 0 | 0 | **0** |
| Manager | Observer | haan | pending | 0 | 0 | **0** |
| Manager | Observer | nahi | pending | 0 | 0 | 0 |
| Manager | **CEO** | haan | on-time | **+10** | +3 | **0** |
| Manager | **CEO** | haan | late | **−5** | +3 | **0** |
| Manager | **CEO** | haan | pending | **−8** | 0 | **0** |
| Manager | **CEO** | nahi | pending | 0 | 0 | 0 |

**Table se teen baatein saaf hain:**

1. **Tagged bande ka column har jagah 0 hai.** (CEO-tags-khud wali row me jo +3 dikh raha
   hai wo assigner wala hi +3 hai — ek hi aadmi, ek hi entry, do baar ginti hui.)
2. **Manager ka bina-tag wala kaam poori tarah points ke bahar hai** — na inaam, na
   penalty. CEO ko tag karte hi wahi kaam points me aa jaata hai.
3. **Bina due date ke kuch bhi nahi** — na +10, na −5, na assigner ka +3.

---

## 3. Do logon ko ek hi kaam (E1 + E2), dono ki copy alag

| E1 ka haal | E2 ka haal | **E1** | **E2** | **ASSIGNER** | assigner ki entry |
|---|---|---|---|---|---|
| on-time | on-time | +10 | +10 | +3 | 1 |
| on-time | late | +10 | −5 | +3 | 1 |
| **on-time** | **pending** | **+10** | **−8** | **+3** | 1 |
| late | pending | −5 | −8 | +3 | 1 |
| pending | pending | −8 | −8 | **0** | 0 |
| late | late | −5 | −5 | +3 | 1 |

Teesri row wahi haal hai jo aapne pakda tha: **ek ne kar diya, doosre ka chalta raha aur
uske points katte rahe.** Ye niyam se hi aisa hai (har banda apni copy karta hai), par
pehle ye **chupchaap** hota tha — screen par kahin nahi dikhta tha ki "ek ne kar liya,
tumhari abhi baaki hai". Wahi aaj theek kiya gaya hai (neeche section 9).

**Assigner ko double payment nahi hoti** — chhah ke chhah combos me theek 1 entry.
Anchor copy delete ya undo ho jaaye to bhi agle re-score par wapas ek hi entry banti hai
(test kiya).

---

## 4. Ek pending task roz kitna kaat raha hai (din-ba-din)

Task due **3 Sep**, aaj **8 Sep**, kaam abhi bhi baaki:

| din | points | kya |
|---|---|---|
| 4 Sep | **−5** | due nikal gayi — ek baar ka nishaan |
| 5 Sep | −1 | abhi bhi baaki |
| 6 Sep | — | **ITWAAR — chhoda gaya** |
| 7 Sep | −1 | abhi bhi baaki |
| 8 Sep | −1 | abhi bhi baaki |
| | **−8** | **kul** |

Chhutti aur itwaar ka niyam sahi chal raha hai. **Prod me abhi 113 din-wali entries hain
aur unme se ek bhi itwaar ya chhutti par nahi lagi** — ye maine asli DB par check kiya.

---

## 5. Mahina badalne par (aapke purane niyam ka verification)

Task due **5 Aug**, aaj tak nahi hua:

| mahina | points | kitni entry |
|---|---|---|
| 2026-08 | **−26** | 22 |
| 2026-09 | **−7** | 7 |
| | **−33** | kul |

Wahi task agar **7 Sep ko late complete** ho jaaye:

| mahina | points | kitni entry |
|---|---|---|
| 2026-08 | **−26** | 22 |
| 2026-09 | **−5** | 5 |
| | **−31** | kul |

→ **−5 ka nishaan August me hi rehta hai** (6 Aug ko file hua), September me khiskta
nahi — bilkul jaisa aapne kaha tha.
→ **Roz ki penalty agle mahine bhi chalti rehti hai** jab tak kaam poora na ho — ye bhi
jaisa aapne kaha tha.
→ **Assigner ka +3 September me** aata hai, kyunki kaam ab poora hua.

Ek baat gaur karne layak: 34 din ke late task ko aaj complete karke sirf **2 points** ka
farak pada (−33 se −31). Iski wajah section 7 ka pehla point hai.

---

## 6. Baaki conditions

**Forward chain (Manager → E1 → E2):**

| chain ka nateeja | E1 (jisne aage diya) | E2 (jisne kiya) | ASSIGNER |
|---|---|---|---|
| on-time | +3 | +10 | +3 |
| late | −2 | −5 | +3 |
| **pending** | **0** | **−9** | 0 |

Pending haalat me penalty **sirf us bande par** girti hai jiske haath me kaam abhi hai.
Jisne aage de diya uspar kuch nahi — ye bilkul theek hai.

**Approval wala task:** E1 ne **2 Sep** ko submit kiya (due 3 Sep), aaj 8 Sep tak manager
ne approve nahi kiya → **E1: −8**, manager: 0. Kaam waqt par ho gaya tha, deri approve
karne me hui, par poora nuksan employee ka. Ye section 7 me finding hai.

**Kinare ke case — sab theek nikle:**

| # | haalat | nateeja |
|---|---|---|
| 7a | apna personal task, due nikal gayi | 0 — sahi, apne task par points nahi |
| 7b | Manager ne khud ko assign kiya | +10 sirf; **+3 nahi mila** — double payment nahi |
| 7c | CEO ne khud ko assign kiya | +10 sirf |
| 7d | 20 Jul ko assign, ab complete | doer −5, assigner **0** — purana kaam grandfathered |
| 7e | bina due date, complete | dono 0 |
| 7f | chhutti + itwaar wala drip | dono din chhode gaye |
| 7i | jisko kaam mila wahi tag me bhi hai | **1 hi entry** — double nahi |
| 7k | due date abhi door (31 Dec) | 0 |
| 7m | batch ki pehli copy delete ho gayi | assigner ka +3 dobara ban gaya — sahi |
| 7n | pending task ka tag hata-laga kar dekha | purani penalty nahi badli (−33 → −33 → −33) |

---

## 7. Jo cheezein dhyaan dene layak hain

Inme se kuch **bug** hain aur kuch **niyam ka faisla** — koi bhi bina aapki haan ke
badla NAHI gaya hai.

### F1 · Roz ki penalty ki koi seema nahi hai — **sabse bada**

Ek bhoola hua task poora mahina kha sakta hai, kyunki −1 roz lagta rehta hai aur ruk-ne
ka koi point hi nahi hai. Prod ki asli haalat aaj:

| kaam | ab tak sirf roz-wali penalty |
|---|---|
| Banquet hall model | **−29** (aur roz badh raha hai) |
| Himalayan symphony drawings | −12 |
| Wardrobe himalayan symphony | −11 |
| Amir rehman — Slab electrical | −9 |

Banda-war (sirf roz wali drip, ek-baar ka −5 iske alawa):
Mariya Khan **−39**, Priyanshi Patel **−30**, Anjali Singh **−25**, Manish Saini −10,
Ankur Saini −6, Ankit −2, Kalpana −1.

Aur section 5 ka nateeja: 34 din purana kaam aaj nipta do ya na nipta o — sirf 2 points
ka farak. Yaani ek had ke baad **kaam poora karne ka koi faayda hi nahi bachta**.

**Ho sakta hai:** (a) ek task par zyada se zyada −10 / −15 ki seema, (b) sirf pehle
7 ya 14 din tak roz katna, (c) jaisa hai waisa hi rehne dena.

### F2 · Approval me deri manager ki, penalty employee ki

Employee ne waqt par submit kar diya, manager ne 5 din approve nahi kiya → employee ke
**−8**. Abhi ka niyam ye hai ki approval-wala task tab tak "adhoora" hai jab tak approve
na ho (ye aapne khud 8 Aug ko tay kiya tha) — par nateeja ye hai ki intezaar karne wale
par nuksan girta hai.

**Ho sakta hai:** submit hote hi penalty rok dena, ya submit ke baad ke din chhod dena.

### F3 · CEO ka tag hatate hi purani penalty maaf ho jaati hai

Due date ab lock hai (assign hone ke baad badali nahi ja sakti) — par **tag hatana khula
hai**. Jo task **late complete** ho chuka hai, uspar se CEO ka tag hatate hi uska −5
poora mit jaata hai. (Pending task par purani penalty nahi mitti, par aage badhna ruk
jaata hai — maine dono alag-alag check kiye.) Jo darwaza due-date lock ne band kiya tha,
ye uska doosra darwaza hai, aur ise koi bhi assigner khol sakta hai.

**Ho sakta hai:** tag hatane ko owner-tier tak seemit karna, ya ek baar points me aa gaye
task ko bahar na jaane dena.

### F4 · Assigner ko +3 tab hi mil jaata hai jab pehla banda khatam kare

5 logon ko kaam diya, ek ne kiya → assigner ko +3 mil gaya, chahe baaki 4 abhi baaki hon.
Niyam "ek kaam = ek +3" ke hisaab se ye theek hai, par "kaam poora hua" ka matlab yahan
"kisi ek ne kar diya" hai. Faisla aapka.

### F5 · Task delete karne par uske points ledger me bache reh jaate hain

Test me task delete karne ke baad bhi 2 entry ledger me thi. Ye `pruneOrphanTaskEntries`
chalne par hi hatti hain. Jab tak nahi chalti, banda kisi mite hue task ke points dho
raha hota hai.

### F6 · 243 tasks ka `assignBatch` khaali string hai (sirf jaankari)

Schema ka default `''` hai, `null` nahi. Poora code truthiness se guard karta hai
(`if (task.assignBatch)`) isliye **koi nuksan nahi ho raha** — par koi bhi analytics
query inhe ek jhoothe "243-copy wale batch" me jod deti hai. Meri pehli ginti isi wajah
se kharab hui thi.

---

## 8. Prod ki asli haalat — adhoore multi-assign batch

Asli multi-assign batch: **28**. Inme se **4** aise hain jahan koi kar chuka hai aur koi
baaki hai:

| kaam | diya | due | kar diya | baaki | ab tak kata |
|---|---|---|---|---|---|
| Ledger to CHLPL | Khaan Aamir | 19 Jul | Ankur Saini | **Naimish Saini** | Naimish **−5** |
| Ledger to crest view / BUILDIFIE | Khaan Aamir | 19 Jul | Ankur Saini | **Naimish Saini** | Naimish **−5** |
| Residence Drafting — Mau | Khaan Aamir | 15 Sep | Priyanshi, Kalpana, Anjali | Manish Saini | kuch nahi (due abhi baaki) |
| Himalayan symphony drawings | Kalpana Saini | 19 Aug | Anjali Singh | Priyanshi Patel | kuch nahi* |

\* Priyanshi ne apni copy **Mariya Khan ko forward** kar di hai, isliye uspar penalty nahi
chalti — Mariya ke uspar **−17** chal rahe hain, jo bilkul theek hai (kaam ab unke haath
me hai).

**Ek sudhaar:** pehle maine kaha tha "5 batch, Ankur aur Manish". Sahi ginti **4** hai,
aur jo banda sach me penalty bhar raha hai wo **Naimish Saini** (−10, do batch me −5 −5)
hai. Ankur Saini dono me **kar chuke** hain — unpar kuch nahi. Manish Saini ki copy abhi
overdue hui hi nahi (due 15 Sep), to unpar bhi abhi kuch nahi. Jo purane 5 wali ginti
thi, wo khaali-string wale batch ki wajah se galat thi (F6).

---

## 9. Aaj kya theek kiya gaya

1. **Tag kiye hue bande ko doosre ke points dikhna band.** Points ka preview har kisi ko
   dikh raha tha, to tag kiya hua banda assignee ka −5 dekh kar samajhta tha ki uske
   points kat rahe hain. **Kisi ke points kabhi galat kate nahi the** — ledger me ek bhi
   aisi entry nahi mili — par dikhta darawna tha. Ab tag wale ko ye dikhta hi nahi, aur
   jahan kisi aur ki copy ka preview dikhta hai wahan naam likha hota hai ki kiska hai.

2. **Adhoore multi-assign ka chupchaap chalna band.** Ab har row par "2 of 3 done" likha
   aata hai, jiski copy khuli hai aur baaki kar chuke hain uspar saaf nishaan lagta hai,
   detail me naam ke saath likha aata hai ki kisne kar liya aur ye abhi bhi chal raha hai,
   aur jo abhi baaki hain unhe notification jaata hai — unki **apni** copy ke link ke
   saath. Ek copy ke liye ek hi baar, aur copy band karte hi notification khud hat jaata
   hai. Jisne apni copy aage forward kar di ya jo approval ka intezaar kar raha hai, use
   nahi bheja jaata.

   Test: `backend/scripts/test-batch-nudge.js` — **24/24 pass**, controls samet.

3. Audit ke dauraan **isi naye code ka ek defect** pakda gaya aur wahin theek kiya: jisne
   apni copy aage forward kar di thi (jaise Priyanshi → Mariya), use "tumhari abhi baaki
   hai, points kat rahe hain" dikh raha tha — jabki forward ki hui copy par ek bhi point
   nahi katta.

---

## 10. Kya bilkul theek nikla (koi kaam nahi chahiye)

- Tag kiye hue bande ke points **12/12 combos me theek 0**
- Multi-assign me assigner ko **theek ek** +3, har haalat me
- Chhutti aur itwaar par drip nahi — **prod me 113 me se 0 galat**
- Late ka −5 **apne hi mahine** me rehta hai, agle mahine nahi khiskta
- Roz ki penalty **agle mahine bhi chalti hai** jab tak kaam na ho
- 1 Aug se pehle wala kaam grandfathered — purane kaam par naya +3 nahi
- Bina due date ke kuch bhi nahi — na inaam na penalty
- Khud ko assign karke double payment nahi
- Jisko kaam mila wo agar tag me bhi ho to bhi ek hi baar points
- Due-date lock kaam kar raha hai
- Forward chain me pending ka bojh sirf jiske haath me kaam hai uspar
- Task ka preview aur asli ledger ek hi baat kehte hain
