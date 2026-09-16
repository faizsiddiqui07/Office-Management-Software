# Chat ka live connection (WebSocket) — AWS console me setup

Chat **abhi bhi chalega** agar ye setup na karein — wo chupchap polling par chalta rahega
(naya message ~5 second me dikhega, sirf khuli chat par). Ye setup usse **turant** (<200ms)
banata hai, aur saath me database ka bojh bhi kam karta hai.

**Kharcha:** 15 users par ~₹10/mahina, 100 users par ~₹66–89/mahina (Mumbai).
Iske bina 3-second polling 100 users par ~₹3,233/mahina padti aur free database tier
~81 users par hi toot jaata.

Sab kuch **console** se hai — koi CLI nahi. ~15 minute ka kaam.

> **Ek baat pehle hi jaan lijiye, warna ghanta barbaad hoga:** is setup me kuch galat hone
> par **CloudWatch me kuch nahi dikhega** — na error, na warning. Wajah aur pehchan ka
> asli tareeka neeche "Kuch kaam na kare to" section me hai. Wahan se shuru kijiye, logs
> se nahi.

---

## 1) WebSocket API banao

1. AWS Console → **API Gateway** → **Create API** → **WebSocket API** → **Build**
2. **Region upar dayin taraf `Asia Pacific (Mumbai) ap-south-1` hona chahiye** — wahi
   jahan Lambda hai. Galat region me banane par step 4 ki IAM policy match nahi karegi
   aur kuch kaam nahi karega.
3. API name: `office-chat-ws`
4. **Route selection expression**: `$request.body.action` (default hi rehne do)
5. **Next** → **Add routes**: teeno jodo — `$connect`, `$disconnect`, `$default`
6. **Next** → har route ke liye:
   - Integration type: **Lambda**
   - Lambda function: `office-management-api` (wahi jo pehle se hai)
7. **Next** → **Add stage**: naam `production` → **Next** → **Create and deploy**

> **Stage ka naam `production` hi rakhein.** Step 4 ki IAM policy me wahi naam likha hai.
> Kuch aur rakhna ho to policy me bhi wahi badalna padega.

> **Route selection expression kya karta hai:** kuch khaas nahi, hamare case me. App apne
> message me `action` naam ka field bhejta hi nahi, isliye har message `$default` par hi
> jaata hai — aur wahi chahiye. Default value bina soche rehne dijiye.

> **Console beech me "IP address type" bhi puch sakta hai** — `IPv4` (default) theek hai.

## 2) Do URL copy karo

Deploy hone ke baad API ke page par (**Stages** → `production`):

- **WebSocket URL** — `wss://abc123.execute-api.ap-south-1.amazonaws.com/production`
- **Connection URL** — `https://abc123.execute-api.ap-south-1.amazonaws.com/production`

Dono ek jaise dikhte hain — pehla `wss://`, doosra `https://`. Dono chahiye.

> **Do copy-paste ki galtiyan jo chupchap sab tod deti hain:**
> 1. Console **Connection URL** ko kabhi-kabhi `…/production/@connections` ke saath
>    dikhata hai. **`/@connections` wala hissa hata dijiye** — sirf `…/production` tak.
>    SDK wo khud jodta hai; do baar jud gaya to har message fail hoga, chupchap.
> 2. Dono URL aapas me mat badal dijiye. `CHAT_WS_URL` **hamesha `wss://`** se shuru hota
>    hai, `CHAT_WS_ENDPOINT` **hamesha `https://`** se. Ulta hua to koi error nahi aayega —
>    bas kaam nahi karega.
> 3. Aakhir me **slash mat chhodiye** (`…/production/` galat, `…/production` sahi). Code
>    ise saaf nahi karta, jaisa likha hai waisa hi istemal karta hai.

## 3) Lambda me do env var lagao

Lambda → `office-management-api` → **Configuration** → **Environment variables** → **Edit**:

| Key | Value | Kaun istemal karta hai |
| --- | --- | --- |
| `CHAT_WS_URL` | `wss://…/production` | Browser isse judta hai |
| `CHAT_WS_ENDPOINT` | `https://…/production` | Server isse message bhejta hai |

> **Dono var SIRF Lambda par lagte hain.** Amplify (website) me kuch nahi jodna, kuch nahi
> badalna, rebuild bhi nahi karna. Browser ko `wss://` ka pata **server se** milta hai
> (`/api/chat/ws-ticket` ke jawab me), apne build se nahi. Isliye kal ko URL badla to sirf
> yahan value badal kar **Save** karna kaafi hai.
>
> (`NEXT_PUBLIC_CHAT_WS_URL` naam ka koi var app me hai hi nahi — Amplify me banane se
> kuch nahi hoga.)

> **Zip me daal dene se ye kaam NAHI karega** — env var console me hi set hote hain.
> (`JWT_EXPIRES_IN` ke waqt yahi galti ho chuki hai.)

**Do me se ek bhi chhoot gaya to chat chupchap polling par chalti rahegi** — kahin koi
error nahi aayega. Isliye step 6 ki jaanch zaroori hai.

## 4) Lambda ko bhejne ki ijazat do

Lambda → `office-management-api` → **Configuration** → **Permissions** → role ka naam
kholo (IAM khulega) → **Add permissions** → **Create inline policy** → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:ManageConnections",
      "Resource": "arn:aws:execute-api:ap-south-1:*:*/production/POST/@connections/*"
    }
  ]
}
```

Policy name: `ChatWebSocketPostToConnection` → **Create policy**.

> Is JSON me **do cheezein step 1 se milni chahiye**: `ap-south-1` (API ka region) aur
> `production` (stage ka naam). Inme se kuch alag rakha ho to yahan bhi wahi likhiye.

Ye na ho to server message **database me save to kar lega**, par live nahi bhej payega.
Pehchan ka tareeka step 6 me hai — **CloudWatch me mat dhoondhiye, wahan kuch nahi hoga**.

## 5) Nayi zip banao aur upload karo

```
cd backend
npm install
npm run package:lambda
```

→ Lambda → **Code** → **Upload from** → `.zip` → **Save**

> `npm install` isliye ki chat ke liye naye packages jude hain
> (`@aws-sdk/client-apigatewaymanagementapi` samet). Zip banane wali script jo bhi
> `node_modules` me mila hai use waise hi utha leti hai — package missing hua to zip
> banegi to sahi, par Lambda chalte hi module-not-found par mar jayega.

## 6) Chal raha hai ya nahi — **isi kram se** dekho

### 6.1 Pehle server se poochho (sabse sasta aur sabse kaam ka)

Website kholo → login karo → **F12** → **Network** tab → filter box me `ws-ticket` likho →
page **refresh** → us request par click → **Response** tab.

Jawab aisa hona chahiye:

```json
{"ok":true,"data":{"ticket":"v1...","expiresIn":60,
 "url":"wss://abc123.execute-api.ap-south-1.amazonaws.com/production","enabled":true}}
```

(`url` aur `enabled` `data` ke **andar** hain.)

| Jo dikhe | Matlab |
| --- | --- |
| `"url": ""` khaali | Step 3 ka **`CHAT_WS_URL`** set nahi hua |
| `url` bhara, par `"enabled": false` | **`CHAT_WS_ENDPOINT`** set nahi hua, **ya** step 5 ki nayi zip upload nahi hui |
| `url` `https://` se shuru | Step 3 me dono value **aapas me badal gayi** hain |
| `"enabled": true` aur `url` `wss://` se | Yahan tak sab theek — 6.2 par jaiye |

**Jab tak `enabled: true` na ho, aage dekhna bekaar hai.**

> Is URL ko **address bar me seedha mat kholiye** — wahan se `401` hi aayega. Login ka
> token browser sirf app ke andar se bhejta hai.

### 6.2 Connection jud raha hai?

**F12 → Network → WS** tab → page refresh.

- Ek entry `wss://…/production?ticket=…` par **101 Switching Protocols** — connection zinda
- **Bilkul khaali WS tab** → URL hi galat hai (wapas 6.1 par)
- Entry dikhe par **red / status 403** → ticket ya `$connect` route ki dikkat
- Entry aaye aur turant band ho jaye → `$connect` route ka Lambda integration nahi laga

### 6.3 Message sach me turant aa raha hai?

Do alag browser me do users se login karke ek dusre ko message bhejo — **turant** dikhna
chahiye.

**Agar 6.2 me 101 dikhta hai lekin message turant nahi aata** — aur page **refresh** karte
hi aa jaata hai — to galti sirf **step 4 ki IAM policy** me hai. Bas wahi dekhiye, kahin
aur mat dhoondhiye.

---

## Kuch kaam na kare to — pehle ye padhiye

**CloudWatch me kuch nahi milega.** Ye is app ki ek jaani-pehchani kami hai: live bhejne
wala code sirf "connection mar chuka hai" (410) wale error ko sambhalta hai, aur **baaki har
error — IAM wala bhi — bina kisi nishaan ke gira deta hai**. Isliye log bilkul saaf
dikhenge, jaise sab theek ho.

Yahi wajah hai ki upar wali 6.1 → 6.2 → 6.3 wali seedhi hi asli tareeka hai.

**Route ya integration baad me badla?** Stage ko **dobara Deploy** karna padta hai
(API → **Deploy API** → stage `production`). Bina deploy kiye badlav live nahi hote — aur
iska bhi koi error nahi aata.

**Sab ulta-pulta lage to:** dono env var hata do — app wapas polling par chalne lagegi,
kuch toot-ta nahi, kisi user ko pata bhi nahi chalega.

---

## Do baatein jo yaad rakhni hain

- **Connection 2 ghante se zyada zinda nahi rehta**, aur 10 minute khaali rehne par kat
  jaata hai — ye AWS ki hard limit hai, badhai nahi ja sakti. App ise sambhalta hai:
  toot-ne par apne aap dobara judta hai, aur judte hi **chat dobara load kar leta hai**
  (list + khuli chat ke message). Isliye beech ke message gayab nahi hote — wo wapas aa
  jaate hain.
- **Har khula tab ek alag connection hai.** Do tab khole hue bande ko message dono me
  dikhega. Mare hue connection 410 milte hi apne aap hat jaate hain, aur TTL 2 ghante
  me baaki safai kar deti hai.
