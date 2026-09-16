# Chat ko live karna — poora checklist, sahi kram me

Ye **ek hi** kaagaz hai jise kholkar shuru se aakhir tak chalna hai. Do doc
(`DEPLOY-CHAT-WEBSOCKET.md`, `DEPLOY-CHAT-MEDIA.md`) me tafseel hai — yahan **kram** hai
aur wo baatein jo un dono ke beech me aati hain.

**Kul waqt:** ~35–40 minute. Beech me ruk sakte hain — har hissa apne aap me poora hai.

---

## Abhi kya haalat hai

| Cheez | Haalat |
| --- | --- |
| Chat ka code (backend + website) | ✅ Bana, 188 automated check pass, **local commit** |
| Live site par chat | ❌ Abhi nahi — push nahi hua |
| Lambda par chat ka code | ❌ Abhi nahi — nayi zip upload nahi hui |
| S3 bucket ka faisla | ✅ Wahi purana (`architectus-bureau-office-assets`), `chat/` prefix |
| Bucket ki suraksha | ✅ Policy `/branding/*` tak seemit + 3 BPA switch ON |
| Bucket ki CORS | ⬜ Baaki |
| Bucket ki IAM policy | ⬜ Baaki |
| `CHAT_MEDIA_BUCKET` env var | ⬜ Baaki |
| WebSocket API | ⬜ Poora baaki |

---

## Hissa A — File bhejna (S3) · ~5 minute

Tafseel: [DEPLOY-CHAT-MEDIA.md](DEPLOY-CHAT-MEDIA.md)

- [ ] **A1.** S3 → `architectus-bureau-office-assets` → **Permissions** → **CORS** → Edit →
      JSON paste karein (doc me hai). Origin wahi jo address bar me dikhta hai.
- [ ] **A2.** Lambda → `office-management-api` → Configuration → **Permissions** → role →
      **Create inline policy** → JSON paste → naam `ChatMediaAccess`
- [ ] **A3.** Lambda → Configuration → **Environment variables** → Edit → jodein:
      `CHAT_MEDIA_BUCKET` = `architectus-bureau-office-assets`

> Lifecycle rule wala step **chhod dijiye** — wo aaj kuch nahi karta. Wajah doc me hai.

---

## Hissa B — Message turant aana (WebSocket) · ~15 minute

Tafseel: [DEPLOY-CHAT-WEBSOCKET.md](DEPLOY-CHAT-WEBSOCKET.md)

- [ ] **B1.** API Gateway → **Create API** → **WebSocket API**.
      **Region `ap-south-1` (Mumbai) hona chahiye.** Naam `office-chat-ws`
- [ ] **B2.** Teen route jodein: `$connect`, `$disconnect`, `$default` —
      teeno ka integration **Lambda → `office-management-api`**
- [ ] **B3.** Stage `production` → **Create and deploy**
- [ ] **B4.** Do URL copy karein — `wss://…/production` aur `https://…/production`
      ⚠️ `/@connections` wala hissa **hata dijiye**, aakhir me slash **mat** chhodiye
- [ ] **B5.** Lambda → **Environment variables** → do jodein:
      `CHAT_WS_URL` = `wss://…` · `CHAT_WS_ENDPOINT` = `https://…`
      ⚠️ Aapas me badal mat jaiye — `wss` wala `URL` me, `https` wala `ENDPOINT` me
- [ ] **B6.** Lambda role → **Create inline policy** → JSON paste → naam
      `ChatWebSocketPostToConnection`

> Amplify (website) me **kuch nahi karna** — dono var sirf Lambda par lagte hain.

---

## Hissa C — Deploy · ~10 minute

### ⚠️ Kram ulta mat kijiye — yahi sabse zaroori baat hai

Push karte hi Amplify website ko **turant** live kar deta hai. Agar website pehle chali
gayi aur Lambda purani rahi, to chat ka button aur page **dikhne lagega** par backend me
chat ki koi route hogi hi nahi — **har click par 404**, aur 15 logon ko tooti hui cheez
dikhegi.

Ulta kram surakshit hai: nayi routes Lambda par padi rahengi, purani website unhe bulaegi
hi nahi, kuch nahi toot-ega.

- [ ] **C1.** Mujhse kahiye: *"zip bana do"* → main `npm install` + `npm run package:lambda`
      chalaunga
- [ ] **C2.** Lambda → **Code** → **Upload from** → `.zip` → **Save** ← **pehle ye**
- [ ] **C3.** Mujhse kahiye: *"ab push kar do"* → website live ho jayegi ← **phir ye**

---

## Hissa D — Jaanch · ~5 minute

**Isi kram se.** Har step agle ki shart hai.

- [ ] **D1.** Login page kholein — **logo dikhna chahiye**
      (nahi dikhe → BPA ka chautha switch galti se ON ho gaya hai)
- [ ] **D2.** F12 → **Network** → filter `ws-ticket` → refresh → Response dekhein.
      `"enabled": true` aur `url` `wss://` se shuru — tabhi aage badhein
- [ ] **D3.** F12 → **Network → WS** tab → ek entry **101 Switching Protocols**
- [ ] **D4.** Do alag browser, do users → message **turant** aana chahiye
- [ ] **D5.** Chat me **📎 paperclip** dikhna chahiye (na dikhe to **page refresh**)
- [ ] **D6.** Ek photo bhejein — progress bar, phir jhalak
- [ ] **D7.** Ek PDF bhejein — naam, size, download

---

## Kuch kaam na kare to

**🚨 Sabse pehle ye jaan lijiye: CloudWatch me kuch nahi dikhega.**

Live bhejne wala code sirf "connection mar chuka" (410) wala error sambhalta hai aur
**baaki har error — IAM wala bhi — bina nishaan ke gira deta hai**. Log bilkul saaf
dikhenge, jaise sab theek ho. Isliye **D2 → D3 → D4** wali seedhi hi asli tareeka hai.

| Jo dikh raha hai | Kahan galti hai |
| --- | --- |
| `ws-ticket` me `"url": ""` | **B5** — `CHAT_WS_URL` set nahi hua |
| `url` hai par `"enabled": false` | **B5** ka `CHAT_WS_ENDPOINT`, **ya** C2 ki zip upload nahi hui |
| `url` `https://` se shuru | **B5** — dono value aapas me badal gayi |
| WS tab bilkul khaali | URL hi galat hai — wapas D2 par |
| **101 dikhta hai par message turant nahi aata** (refresh par aa jaata hai) | **B6** — IAM policy. Sirf wahi dekhiye |
| Paperclip nahi dikha | **A3**, ya sirf page refresh chahiye |
| "Upload nahi ho paaya" | **A1** — CORS ka origin. F12 → Console me laal line me sahi origin likha hoga |

**Route/integration baad me badla?** Stage dobara **Deploy** karna padta hai — iska bhi
koi error nahi aata.

---

## Wapas lautna ho to (rollback)

Kuch bhi ulta-pulta lage to **env var hata dijiye** — code badalne ki zaroorat nahi:

- `CHAT_WS_URL` + `CHAT_WS_ENDPOINT` hataye → chat wapas polling par (~5 second), kisi ko
  pata bhi nahi chalega
- `CHAT_MEDIA_BUCKET` hataya → paperclip gayab, text wali chat chalti rahegi
  - ⚠️ pehle se bheji hui file par **hamesha ghoomta spinner** rahega (error nahi) — env
    var wapas lagate hi theek

Branding/logo par in me se kisi ka koi asar nahi.

---

## Baad ke liye (abhi nahi)

- **S3 ki file kabhi delete nahi hoti.** `deleteObjects()` code me hai par kahin se bulaya
  nahi jaata. Aaj nuksan nahi (message delete hote hi nahi, retention bhi band hai), par
  **retention chaalu karne se pehle** theek karna hai — warna DB se row hategi aur bytes
  S3 par anaath pade rah jayenge. `audits/00-open-bugs.md` me darj hai.
- **Adversarial review** — poore chat feature ko todne ki niyat se jaanchna. Maine offer
  kiya tha, abhi hua nahi.
- **Call / video call** — plan se hata diya gaya tha.
