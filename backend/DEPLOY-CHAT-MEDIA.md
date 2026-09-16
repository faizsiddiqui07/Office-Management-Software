# Chat me file bhejna (S3) — AWS console me setup

Iske bina chat **chalta rahega**, bas attachment ka button nahi dikhega (server saaf-saaf
`enabled: false` batata hai). Setup ke baad photo, video, PDF aur document bhejne lagenge.

**Kharcha:** 15 users par ~₹8/mahina, 100 users par ~₹51/mahina (Mumbai).

~8 minute ka kaam, sab console se. **Naya bucket nahi banana** — wahi purana istemal hoga.

---

## 0) Pehle ye samajh lijiye — bucket naya kyun nahi

Shuru me is doc me likha tha "naya bucket banao, purana mat chhuo". Wo ab **galat** hai,
aur kyun galat hai ye likh dena zaroori hai — warna 6 mahine baad koi phir se yahi sawaal
uthayega.

Purane bucket (`architectus-bureau-office-assets`) ki policy **jaanchi gayi**, aur wo
theek se seemit nikli:

```json
{
  "Sid": "PublicReadBranding",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::architectus-bureau-office-assets/branding/*"
}
```

`/branding/*` par khatam — `/*` par nahi. Bahar se jaanch kar ke bhi dekha gaya
(bina login, bina signature):

| Kya maanga | Jawab |
| --- | --- |
| `branding/logo-dark-….png` | **200**, asli 23 KB ki PNG — logo public hai (aur hona hi chahiye, login page bina login ke dikhta hai) |
| `chat/probe.b` | **403** |
| `probe.txt` (bucket ki jad me) | **403** |
| poori listing (`/`) | **AccessDenied** — kaun si file hai, ye bhi nahi pata chalta |

Uske baad bucket par **Block public access ke teen switch ON** kar diye gaye:

- ☑ …through **new** ACLs
- ☑ …through **any** ACLs
- ☑ …through **new** public bucket or access point policies
- ☐ …through **any** public bucket policies — **ye OFF hi rahega** (ON karte hi logo gayab)

Teesre switch ka matlab: maujooda branding policy chalti rahegi, par koi use badal kar
`/*` **nahi** kar sakta — S3 aisi koshish ko hi reject kar dega.

Yaani ab chat ki file par **do taale** hain: policy bhi (`chat/` public hai hi nahi), aur
BPA bhi (policy widen ho hi nahi sakti). Itni hi suraksha naye bucket se milti — bina naya
bucket banaye mil gayi, aur ek kam cheez sambhalni padegi.

> **Do cheezein jinhe haath nahi lagana:**
> 1. Chautha BPA switch (*any* public bucket policies) — ON karte hi login page ka logo
>    gayab.
> 2. `PublicReadBranding` policy — ab wo teesre switch ki wajah se **jam** hai. Badalni ho
>    to: switch OFF → policy badlo → switch wapas ON. Upar wali JSON hi uska backup hai.

---

## 1) CORS lagao

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

> **Branding par iska koi asar nahi.** CORS sirf **deta** hai, chheenta nahi — aur logo
> `<img src>` se load hota hai, jispar CORS lagta hi nahi. Site ka asli pata
> `team.architectusbureau.com` hai (jaancha gaya — `app.` exist nahi karta, aur
> `architectusbureau.com` alag marketing site hai).

## 2) Adhoore upload apne aap saaf hon

Bucket → **Management** → **Create lifecycle rule**

- Rule name: `chat-abort-incomplete-uploads`
- Scope: **Limit the scope with prefix** → prefix: `chat/`
- Tick: **Delete expired object delete markers or incomplete multipart uploads** →
  **Delete incomplete multipart uploads** → **1 day**
- **Create rule**

Cancel ya crash hue upload S3 par adhoore tukde chhod jaate hain — wo console me dikhte
tak nahi par bill me aate hain.

> **Prefix `chat/` jaan-bujh kar hai.** Bucket saajha hai, isliye har rule seemit honi
> chahiye — taaki koi kabhi ye na soche ki ye rule branding ko bhi chhoo sakti hai. (Ye
> rule waise bhi koi object delete nahi karti, sirf adhoore tukde.)

## 3) Lambda ko ijazat do

Lambda → `office-management-api` → **Configuration** → **Permissions** → role kholo →
**Add permissions** → **Create inline policy** → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::architectus-bureau-office-assets/chat/*"
    }
  ]
}
```

Policy name: `ChatMediaAccess` → **Create policy**.

Branding wali maujooda permission **alag** hai — use chhedna nahi, ye nayi policy uske
saath-saath lagegi.

Teeno action kyun chahiye, seedha code se:

| Action | Kahan lagta hai |
| --- | --- |
| `s3:PutObject` | `signUpload()` ki presigned POST — browser isi se file chadhata hai |
| `s3:GetObject` | `headObject()` (asli size naapna) aur `signDownload()` (5-min link) |
| `s3:DeleteObject` | `deleteObjects()` — message hatne par bytes bhi hatte hain |

`/chat/*` sab kuch cover karta hai: asli file `chat/2026/09/<random>.b` hai aur thumbnail
`chat/2026/09/<random>.t` — dono isi ke andar.

## 4) Env var lagao

Lambda → **Configuration** → **Environment variables** → **Edit**:

| Key | Value |
| --- | --- |
| `CHAT_MEDIA_BUCKET` | `architectus-bureau-office-assets` |

> Zip me daalne se kaam nahi chalta — env var console me hi set hote hain.
> (`JWT_EXPIRES_IN` ke waqt yahi galti ho chuki hai.)

Region alag se batane ki zaroorat nahi: code `ASSETS_REGION || AWS_REGION || ap-south-1`
padhta hai, aur wahi bucket branding bhi istemal karta hai — to region apne aap mil jaata
hai. (Yahi ek bucket rakhne ka chhota sa bonus hai.)

## 5) Nayi zip upload karo, phir jaanch lo

1. `npm run package:lambda` → Lambda → **Code** → **Upload from** → `.zip` → **Save**
2. **Sabse pehle login page kholo** — logo dikhna chahiye. Nahi dikhe to BPA ka chautha
   switch galti se ON ho gaya hai.
3. Chat kholo → composer me **📎 (paperclip)** ka button dikhna chahiye
4. Ek photo bhejo — progress bar chalega, phir jhalak dikhegi
5. Ek PDF bhejo — naam, size aur download ka button dikhna chahiye

Kuch galat ho to sirf `CHAT_MEDIA_BUCKET` hata do — attachment ka button gayab ho jayega
aur baaki chat waise ka waisa chalta rahega. Branding par koi asar nahi.

---

## Design ki teen baatein (jaan-bujh kar aisi hain)

- **Bytes hamare server se guzarte hi nahi.** Browser seedha S3 par daalta hai (presigned
  POST). API Gateway ka ~6 MB cap aur 30-second timeout isi tarah bypass hote hain —
  warna ek chhoti video bhi na jaati.
- **`chat/` me kuch bhi padhne layak nahi hai.** Har file ka naam `chat/2026/09/<random>.b`
  hai — na kiski hai, na kis chat ki, na asli filename, na extension. Har object ka
  Content-Type `application/octet-stream`. Asli naam message ke document me **encrypted**
  rakha hai. Yaani listing mil bhi jaye to "kisne kisko kya bheja" pata nahi chalta.
- **Download hamesha 5-minute wale signed link se.** Public URL kabhi nahi, aur link
  banne se pehle har baar wahi jaanch chalti hai — "ye chat aapki hai?"

**Abhi ki seemaayein:** ek file **25 MB** tak, aur ek banda ek din me **200 MB**. Isse
badi file bhejne ke liye multipart + chunking chahiye — wo baad ka kaam hai.
