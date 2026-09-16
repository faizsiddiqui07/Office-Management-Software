# Chat me file bhejna (S3) — AWS console me setup

Iske bina chat **chalta rahega**, bas attachment ka button nahi dikhega (server saaf-saaf
`enabled: false` batata hai). Setup ke baad photo, video, PDF aur document bhejne lagenge.

**Kharcha:** 15 users par ~₹8/mahina, 100 users par ~₹51/mahina (Mumbai).

~10 minute ka kaam, sab console se.

---

## 1) Naya bucket banao

**S3** → **Create bucket**

- Name: `architectus-bureau-chat-media`
- Region: **Asia Pacific (Mumbai) ap-south-1** — Lambda ke saath hi, warna har file
  do region ke beech ghoomegi (dheemi aur mehngi)
- **Block all public access: ON (chaaron)** — ye sabse zaroori setting hai
- **Bucket Versioning: Disable**
- **Default encryption: SSE-S3** (Amazon S3 managed keys)
- **Create bucket**

> **Purana bucket (`architectus-bureau-office-assets`) istemal MAT karna.** Uske
> `branding/` par public-read policy hai (logo sabko dikhna chahiye). Chat ki file wahan
> rakhna ek galat policy-edit ki doori par leak hai.

## 2) CORS lagao

Bucket → **Permissions** → **Cross-origin resource sharing (CORS)** → **Edit**:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["POST", "GET"],
    "AllowedOrigins": [
      "https://team.architectusbureau.com",
      "http://localhost:3000"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Iske bina browser upload ko hi mana kar dega. (`localhost` wali line development ke liye
hai — chahein to prod me hata dein.)

## 3) Adhoore upload apne aap saaf hon

Bucket → **Management** → **Create lifecycle rule**

- Rule name: `abort-incomplete-uploads`
- Scope: **whole bucket**
- Tick: **Delete expired object delete markers or incomplete multipart uploads** →
  **Delete incomplete multipart uploads** → **1 day**
- **Create rule**

Cancel ya crash hue upload S3 par adhoore tukde chhod jaate hain — wo console me dikhte
tak nahi par bill me aate hain.

## 4) Lambda ko ijazat do

Lambda → `office-management-api` → **Configuration** → **Permissions** → role kholo →
**Add permissions** → **Create inline policy** → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::architectus-bureau-chat-media/chat/*"
    }
  ]
}
```

Policy name: `ChatMediaAccess` → **Create policy**.

## 5) Env var lagao

Lambda → **Configuration** → **Environment variables** → **Edit**:

| Key | Value |
| --- | --- |
| `CHAT_MEDIA_BUCKET` | `architectus-bureau-chat-media` |

> Zip me daalne se kaam nahi chalta — env var console me hi set hote hain.

## 6) Nayi zip upload karo, phir jaanch lo

1. `npm run package:lambda` → Lambda → **Code** → upload
2. Chat kholo → composer me **📎 (paperclip)** ka button dikhna chahiye
3. Ek photo bhejo — progress bar chalega, phir jhalak dikhegi
4. Ek PDF bhejo — naam, size aur download ka button dikhna chahiye

Kuch galat ho to sirf `CHAT_MEDIA_BUCKET` hata do — attachment ka button gayab ho jayega
aur baaki chat waise ka waisa chalta rahega.

---

## Design ki teen baatein (jaan-bujh kar aisi hain)

- **Bytes hamare server se guzarte hi nahi.** Browser seedha S3 par daalta hai (presigned
  POST). API Gateway ka ~6 MB cap aur 30-second timeout isi tarah bypass hote hain —
  warna ek chhoti video bhi na jaati.
- **Bucket me kuch bhi padhne layak nahi hai.** Har file ka naam `chat/2026/09/<random>.b`
  hai — na kiski hai, na kis chat ki, na asli filename, na extension. Har object ka
  Content-Type `application/octet-stream`. Asli naam message ke document me **encrypted**
  rakha hai. Yaani bucket ki listing se bhi "kisne kisko kya bheja" pata nahi chalta.
- **Download hamesha 5-minute wale signed link se.** Public URL kabhi nahi, aur link
  banne se pehle har baar wahi jaanch chalti hai — "ye chat aapki hai?"

**Abhi ki seemaayein:** ek file **25 MB** tak, aur ek banda ek din me **200 MB**. Isse
badi file bhejne ke liye multipart + chunking chahiye — wo baad ka kaam hai.
