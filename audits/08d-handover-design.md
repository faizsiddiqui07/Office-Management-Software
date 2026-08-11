# Design — kisi ke jaane par uska kaam kis ko milega (11 Aug 2026)

> **Ye kya hai:** owner ka apna design, likhit shakl me. **Abhi tak koi code nahi likha gaya.**
>
> Isse pehle do design try ho chuke hain aur **dono revert** hue — `08b-handover-review.md` (4 RED) aur
> `08c-handover-review-2.md` (5 RED). Isliye is baar niyam ye hai: **pehle design likho, phir design ko
> hi adversarial review par daalo, phir owner ki haan, tab code.**

---

## Asli problem

Jab koi account **permanently delete** hota hai, uska diya hua kaam toot jaata hai:

- uski apni copy delete ho jaati hai (`Task.deleteMany({ owner: uid })`)
- jo tasks usne doosron ko diye, un par se `assignedBy` hat jaata hai
- forwarded chain me neeche wali copy ka `forwardedFrom` ek **mit chuke task** ki taraf ishara karta reh jaata hai

Nateeja: **koi us kaam ka zimmedaar nahi bachta** — na chase karne wala, na approve karne wala, na band
karne wala. Aur points ka gate fail ho jaata hai, jisse **jisne kaam kiya uske points ud jaate hain**.

---

## Owner ka design

### Niyam 1 — chain hai to sabse nazdeek zinda link ko

```
CEO  →  Manager A  →  Manager B  →  Junior
                        ↑ ye gaya
```
Junior ka task **Manager A** ke paas jaayega — seedha CEO ke paas nahi.

> *Owner ke shabdon me:* "isme task CEO ko nhi balki manager A ke pas transfer ho jae"

**Kyun ye surakshit hai:** A pehle se is task ki chain me tha. Points ka gate pehle bhi *"haan"* kehta tha
(chain upar chal kar CEO tak jaati thi) aur A se judne ke baad bhi *"haan"* hi kahega. **Jawab badalta hi
nahi** — isliye na koi point mitega, na koi naya banega. *(Pichhle dono design isliye toote the ki wo gate
ka jawab **badal** dete the.)*

### Niyam 2 — chain nahi, par CEO & President tagged hai

Task seedha **us tagged insaan** ke paas chala jaayega. Koi request nahi, koi poochh nahi.

### Niyam 3 — chain bhi nahi, tag bhi nahi

**CEO & President role ke har insaan ko request jaayegi.**

- Wo aapas me baat karke tay karenge kaun kaunsa kaam lega
- **Accept** — task uske paas chala gaya
- **Reject** — *"main nahi lunga"*. Sirf **uski** list se hatega, baakiyon ke paas rahega
- **Aakhri bacha hua insaan reject NAHI kar sakta** — uske liye accept karna **majboori** hai

> *Owner ke shabdon me:* "agar kalpana ne reject kr dia to khaan aamir reject na kr sake, unke lea wo task
> mandatory ho jae accept krna"

**Isi rule ki wajah se task kabhi bhi bina maalik ke nahi reh sakta.** Ye is design ki sabse achhi baat hai.

### Request kaisi dikhegi

- **Ek hi modal me saare task** — har task ke liye alag popup **nahi**
  > *Owner ke shabdon me:* "alag alag task ke lea alag alag modal na open ho, ek hi modal me sare task show
  > ho or wahi pe usko accept or reject krne ka option ho full detail ke sath"
- Har task ki **poori detail** — kaam kya hai, kis ka hai, deadline, kitna overdue, kis ke through aaya tha
- Har task par apna **Accept / Reject**
- Website kholte hi saamne (jaise birthday aur EOD digest popup aate hain)
- **Sirf popup par nahi** — Approvals page me bhi, sidebar par ginti ke saath, aur notification. Popup ek
  baar band ho gaya to kaam gum nahi hona chahiye

### Note

Task ke neeche likha aayega: *"ye kaam pehle **Manish Saini** ke through aaya tha, wo ab nahi hain"*

Iske liye **jaane wale ka naam task par save karna padega** — account to mit jaayega, naam nahi bachega.

### "Live" ka matlab

Backend AWS Lambda par hai; usme sach me instant wala connection nahi banta. Par app pehle se **har 20
second me** refresh karti hai (task board), 60 second me badge. Wahi lagega — **~15-20 second** me doosre
ke screen se task hat jaayega.

**Asli suraksha screen se nahi, server se aayegi:** task par ek hi claim chalega (atomic). Do log theek ek
hi pal me button dabaayein to server **ek ko haan, doosre ko** *"ye task Khaan Aamir le chuke hain"* kahega.
**Do log ek task kabhi nahi le sakte**, chahe screen kitni bhi purani ho.

---

## Sabse naazuk hissa — beech ka waqt

**Delete hone se lekar kisi ke accept karne tak**, task kisi ka nahi hota. Aur **theek isi halat me** raat ki
job use *"points ke layak nahi"* padh kar **jisne kaam kiya uske points mita deti hai** — yahi wo bug hai jo
abhi prod me zinda hai (B1/B2).

**Niyam:** jab tak faisla nahi hota, **points ki halat jamee rahegi** — na kuch mitega, na naya banega.
Accept hote hi normal chalu.

Agar ye theek nahi hua to **request aane se pehle hi points ud chuke honge.** Ye sabse pehle test hoga.

---

## Khule sawaal — owner ke faisle ka intezaar

| # | Sawaal | Mera sujhaav |
|---|---|---|
| 1 | Niyam 1 me **Manager A deactivated** ho to? | Aur upar chalo (CEO tak). Koi na mile to Niyam 3 (request) |
| 2 | Niyam 2 me **tagged insaan hi deactivated/deleted** ho to? | Niyam 3 par gir jaao |
| 3 | Candidates ki list **kab tay hogi** — delete ke waqt, ya "abhi jo bhi owner-tier hai"? | **Abhi jo hai** — taaki naya CEO aaye to wo bhi madad kar sake |
| 4 | Owner-tier me **sirf ek hi insaan** ho to? | Reject ka button hi nahi — seedha uske paas |
| 5 | Kisi ne kai din tak kuch na kiya to? | Roz yaad-dehani (badge to rahega hi) |

---

## Ye design pichhle dono se alag kyun hai

| | Pichhle do design | Ye design |
|---|---|---|
| Naya assigner kaun | koi **naya** insaan, jo us task ki history me tha hi nahi | jo **pehle se** us task se juda tha |
| Points ka gate | jawab **badal** jaata tha (dono direction me galat) | jawab **wahi rehta** hai |
| Task bina maalik | reh sakta tha | "aakhri wala reject nahi kar sakta" — **kabhi nahi** |

---

## Sthiti

- [x] Owner ka design likhit
- [ ] Design par adversarial review *(pehla hissa chal raha hai)*
- [ ] Khule sawaalon ke jawab
- [ ] Poore design par doosri review
- [ ] Owner ki haan
- [ ] **Tab code**
