# Design — kisi ke jaane par uska kaam kis ko milega

**Owner ka design · 11 Aug 2026 · abhi tak ek line code nahi likhi gayi**

> Isse pehle do design try ho chuke hain aur **dono revert** hue — `08b-handover-review.md` (4 RED) aur
> `08c-handover-review-2.md` (5 RED). Dono baar galti ek hi thi: **design aur build ek saath**, aur pata
> baad me chala.
>
> Isliye is baar kram ye hai: **design likho → design ko hi adversarial review par daalo → sudhaaro →
> owner ki haan → tab code.** Pehli review ho chuki (`08e-design-review.md`, 23 objections) aur usne
> Niyam 1 badal diya. Ye document uske baad ka final design hai.

---

## Asli problem

Jab koi account **permanently delete** hota hai, uska diya hua kaam toot jaata hai:

- uski apni copy delete ho jaati hai (`Task.deleteMany({ owner: uid })`)
- jo tasks usne doosron ko diye, un par se `assignedBy` hat jaata hai
- forwarded chain me neeche wali copy ka `forwardedFrom` ek **mit chuke task** ki taraf ishara karta reh jaata hai

Nateeja: **koi us kaam ka zimmedaar nahi bachta** — na chase karne wala, na approve karne wala, na band
karne wala. Aur points ka gate fail ho jaata hai, jisse **jisne kaam kiya uske points ud jaate hain**.

---

## Buniyadi soch (yahi sab kuch tay karti hai)

> **Kaam kisi NAYE insaan ko mat do. Jo rishta pehle se tha, use wapas jodo.**

Pichhle dono design isliye toote ki wo task ko kisi aise ke paas bhej rahe the jo us task ki history me
tha hi nahi — jisse points ka gate **naya jawab** deta tha (kabhi points mitte, kabhi jhoothi penalty
banti). Is design me gate ka jawab **wahi rehta hai jo pehle tha**.

---

## Niyam 1 — chain hai to: jaane wale ko chain se **kaat kar nikalo**

```
CEO  →  Manager A  →  Manager B  →  Junior
                        ↑ ye gaya
```

Junior ka task **Manager A** ke paas jaayega — seedha CEO ke paas nahi.

**Kaise:** chain ka link **todo mat — upar wale ZINDA task par jod do**, aur `assignedBy` us task ke
owner ka. Beech ki kadi nikaal kar upar-neeche wali kadiyaan jod dena.

> ⚠️ **Pehli review ne yahi sudhara.** Pehle likha tha "chain break karke seedha assign kar do" —
> yaani link **clear** kar do. Wo hi sab kuch todta hai: points ka gate **usi link ke sahaare** upar chal
> kar CEO tak pahunchta hai. Link kaat do → raasta khatam → gate "nahi" kehta → **Junior ke points mit
> jaate hain**. 3-level chain par ye pakka hota hai, aur **aaj se ULTA hai** (aaj wo points bache rehte hain).
>
> Screen par fark kuch nahi — Junior ko phir bhi "Manager A se" hi dikhega. Fark sirf andar ka hai.
> Aur ye bilkul wahi shakl hai jo `forwardTask` khud likhta hai, to koi naya niyam nahi banta.

**Agar Manager A khud deactivated ho:** aur upar chalo — CEO & President tak.
> *Owner:* "aur upar chalo (CEO & President tak), last me ye to mil hi jaenge — confirm hai ye"

**Agar upar koi ZINDA task hi na bache** (owner ke 2-level example me yahi hota hai — Manager ki apni copy
uske saath mit jaati hai): task par `originalAssignedBy` pehle se likha hota hai (= CEO). Wahi
`assignedBy` ban jaayega. Gate: CEO owner-tier hai → **haan**.

---

## Niyam 2 — chain nahi, par CEO & President tagged hai

Task seedha **us tagged insaan** ke paas. Koi request nahi, koi poochh nahi.

> *Owner:* "ye dono to hamesha rahenge" — tagged owner ka deactivate/delete hona owner ke hisaab se
> hoga hi nahi. Phir bhi code me ek surakshit fallback rahega (aisa hua to Niyam 3), taaki kaam kabhi
> kisi **band account** ko na chala jaaye.

---

## Niyam 3 — chain bhi nahi, tag bhi nahi → CEO & President tier ko request

- **Candidates = abhi jo bhi owner-tier me hain** (delete ke waqt ki jamee hui list nahi)
  > *Owner:* "abhi jo hai"
- **Accept** — task uske paas
- **Reject** = *"main nahi lunga"* — sirf **apni** list se hatta hai, baakiyon ke paas rehta hai
- **Aakhri bacha hua reject NAHI kar sakta**
  > *Owner:* "agar kalpana ne reject kr dia to khaan aamir reject na kr sake, unke lea wo task mandatory
  > ho jae accept krna"
- **Owner-tier me sirf ek hi insaan ho** → reject ka button hi nahi, seedha uske paas
- **Koi kai din tak kuch na kare** → roz yaad-dehani

**Isi rule se task kabhi bina maalik ke nahi reh sakta.**

### Request kaisi dikhegi

- **Ek hi modal me saare task** — har task ke liye alag popup **nahi**
  > *Owner:* "ek hi modal me sare task show ho or wahi pe usko accept or reject krne ka option ho full
  > detail ke sath"
- Har task ki poori detail — kaam kya hai, kis ka hai, deadline, kitna overdue, kis ke through aaya tha
- Website kholte hi saamne (birthday/EOD digest jaise popup ka pattern pehle se hai)
- **Sirf popup par nahi** — Approvals page me bhi, sidebar par ginti, aur notification

### "Live" ka matlab

Lambda par sach me instant connection nahi banta. App pehle se **har 20 second** me refresh karti hai
(task board) — wahi lagega, to ~15-20 second me doosre ke screen se task hat jaayega.

**Asli suraksha server se aayegi:** task par ek hi claim chalega (atomic). Do log theek ek hi pal me
dabaayein to server ek ko haan, doosre ko *"ye task Khaan Aamir le chuke hain"* kahega. **Do log ek task
kabhi nahi le sakte**, chahe screen kitni bhi purani ho.

---

## Niyam 4 (B1) — mitne wale ka **owner-tier tag neeche utaaro**

> *Owner:* **B1**

Points ka gate do tarah se "haan" kehta hai — *"owner ne khud diya"* ya *"owner usme tagged hai"*.
Aur **forward karte waqt tag saath nahi jaata** (maine `forwardTask` me dekha — `collaborators` copy
hota hi nahi). Neeche wale ko tag ka faayda **chain ke sahaare udhaar** me milta hai.

To jab tag wali copy mitti hai, tag bhi mit jaata hai → gate "nahi" → **points ud jaate hain**.

**Isliye:** mitne wale task par jo owner-tier tag tha, wo **neeche wale task par utar jaayega.**

*Side-effect jo owner ko pata hona chahiye:* wo task ab CEO ke **"tagged" tab me dikhega** (pehle nahi
dikhta tha). Ye theek hai — wo dekh hi rahe the.

---

## Niyam 5 (C1) — approval ki shart **bani rahegi**

> *Owner:* **C1**

- Jaane wale ne jo approval ki shart lagayi thi, wo **bani rahegi** — ab naya zimmedaar approve karega
- Aur jo submission **pehle se atki padi hai** (kaam ho chuka, approval ka intezaar tha, aur usi beech
  wo insaan chala gaya) — uska **notification naye zimmedaar ko jaayega**

Warna Junior ka kiya hua kaam chupchaap latka rahega aur kisi ko pata bhi nahi chalega.

---

## Niyam 6 (D2) — note me **saare naam**, tarikh ke saath

> *Owner:* **D2**

Task ke neeche: *"ye kaam pehle **Manish Saini** (gaye 10 Aug) ke through aaya tha, phir **Priyanshi
Patel** (gayi 3 Feb) ke through — dono ab nahi hain"*

- Naam **task par save** karna padega (account mit jaata hai, naam nahi bachta) — model me naya field
- **List**, taaki chain me kai log jaayein to poora raasta bacha rahe
- Tarikh ke saath

---

## Sabse naazuk hissa — beech ka waqt

**Delete se lekar kisi ke accept karne tak**, task kisi ka nahi hota. Aur **theek isi halat me** raat ki
job use *"points ke layak nahi"* padh kar **jisne kaam kiya uske points mita deti hai** — yahi wo bug hai
jo abhi prod me zinda hai (B1/B2 → `00-open-bugs.md`).

**Niyam:** jab tak faisla nahi hota, **points ki halat jamee rahegi** — na kuch mitega, na naya banega.
Accept hote hi normal chalu.

Ye is poore kaam ka sabse pehla test hoga.

---

## Implementation ke do note (owner ka faisla nahi, meri chetavani)

1. **Pehle padho, phir mitao.** Re-point ke liye upar wali copy padhni hoti hai, par code use **pehle hi
   mita deta hai**. Ye theek wahi galti hai jo maine pichhli baar ki thi (validation mitaane ke baad
   rakh di thi, aur mera apna test us par pass ho gaya tha kyunki wo "account bacha hai?" dekh raha tha,
   "uska data bacha hai?" nahi).
2. **Purane orphans.** Jo tasks pehle ki do deletions se already anaath pade hain, ye design unhe theek
   **nahi** karta — unke liye alag se ek baar ki safai chahiye hogi.

---

## Sthiti

- [x] Owner ka design likhit
- [x] Pehli design review — 23 objections, 1 refuted → `08e-design-review.md`
- [x] Niyam 1 sudhra: **re-point, clear nahi**
- [x] Owner ke saare faisle: reject-rule, ek modal, B1, C1, D2, candidates=abhi wale, ek hi owner ho to seedha, roz reminder
- [ ] **Ek confusion owner se** — aakhri bache hue candidate ko auto mile ya "sirf Accept" wala button?
- [ ] Poore (badle hue) design par **aakhri review**
- [ ] Owner ki haan
- [ ] **Tab code**
