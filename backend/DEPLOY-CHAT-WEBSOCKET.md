# Chat ka live connection (WebSocket) — AWS console me setup

Chat **abhi bhi chalega** agar ye setup na karein — wo chupchap polling par chalta rahega
(naya message ~5 second me dikhega, sirf khuli chat par). Ye setup usse **turant** (<200ms)
banata hai, aur saath me database ka bojh bhi kam karta hai.

**Kharcha:** 15 users par ~₹10/mahina, 100 users par ~₹66–89/mahina (Mumbai).
Iske bina 3-second polling 100 users par ~₹3,233/mahina padti aur free database tier
~81 users par hi toot jaata.

Sab kuch **console** se hai — koi CLI nahi. ~15 minute ka kaam.

---

## 1) WebSocket API banao

1. AWS Console → **API Gateway** → **Create API** → **WebSocket API** → **Build**
2. API name: `office-chat-ws`
3. **Route selection expression**: `$request.body.action` (default hi rehne do)
4. **Next** → **Add routes**: teeno jodo — `$connect`, `$disconnect`, `$default`
5. **Next** → har route ke liye:
   - Integration type: **Lambda**
   - Lambda function: `office-management-api` (wahi jo pehle se hai)
6. **Next** → **Add stage**: naam `production` → **Next** → **Create and deploy**

## 2) Do URL copy karo

Deploy hone ke baad API ke page par:

- **WebSocket URL** — `wss://abc123.execute-api.ap-south-1.amazonaws.com/production`
- **Connection URL** — `https://abc123.execute-api.ap-south-1.amazonaws.com/production`

Dono ek jaise dikhte hain — pehla `wss://`, doosra `https://`. Dono chahiye.

## 3) Lambda me do env var lagao

Lambda → `office-management-api` → **Configuration** → **Environment variables** → **Edit**:

| Key | Value |
| --- | --- |
| `CHAT_WS_URL` | `wss://…/production` (browser isse judta hai) |
| `CHAT_WS_ENDPOINT` | `https://…/production` (server isse message bhejta hai) |

> **Zip me daal dene se ye kaam NAHI karega** — env var console me hi set hote hain.
> (`JWT_EXPIRES_IN` ke waqt yahi galti ho chuki hai.)

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

Ye na ho to server message to save karega par live nahi bhej payega (CloudWatch me
`AccessDeniedException` dikhega).

## 5) Nayi zip upload karo

`npm run package:lambda` → Lambda → **Code** → **Upload from** → `.zip` → **Save**.

## 6) Chal raha hai ya nahi, ऐसे dekho

1. Website kholo → browser ka **DevTools → Network → WS** tab
2. Ek connection `wss://…/production?ticket=…` par **101 Switching Protocols** dikhna chahiye
3. Do alag browser me do users se login karke ek dusre ko message bhejo — **turant** dikhna chahiye
4. Nahi chal raha to CloudWatch → `/aws/lambda/office-management-api` me dekho

Agar kuch bhi galat ho to sirf env var hata do — app wapas polling par chalne lagegi,
kuch toot-ta nahi.

---

## Do baatein jo yaad rakhni hain

- **Connection 2 ghante se zyada zinda nahi rehta**, aur 10 minute khaali rehne par kat
  jaata hai — ye AWS ki hard limit hai, badhai nahi ja sakti. App ise sambhalta hai:
  toot-ne par apne aap dobara judta hai aur beech ke chhoote hue message
  `?after=<seq>` se wapas le aata hai. Isliye message kabhi gayab nahi hote.
- **Har khula tab ek alag connection hai.** Do tab khole hue bande ko message dono me
  dikhega. Mare hue connection 410 milte hi apne aap hat jaate hain, aur TTL 2 ghante
  me baaki safai kar deti hai.
