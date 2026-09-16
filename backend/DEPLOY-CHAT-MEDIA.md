# Chat me file bhejna (S3) — AWS console me setup

Iske bina chat **chalta rahega**, bas attachment ka button nahi dikhega (server saaf-saaf
`enabled: false` batata hai). Setup ke baad photo, video, PDF aur document bhejne lagenge.

**Kharcha:** 15 users par ~₹8/mahina, 100 users par ~₹51/mahina (Mumbai).

~6 minute ka kaam, sab console se. **Naya bucket nahi banana** — wahi purana istemal hoga.

Chaar step zaroori hain (1, 3, 4, 5). **Step 2 aaj ke liye nahi hai** — wo chhoda ja sakta
hai, wajah wahin likhi hai.

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

**Ab tak wo box khaali kyun tha** — ye galti nahi thi. CORS sirf tab lagta hai jab
**browser ka JavaScript** doosre domain se baat kare. Aaj tak hua hi nahi:

| Kaam | Kaise hota hai | CORS? |
| --- | --- | --- |
| Logo dikhna | `<img src="…s3…/branding/logo.png">` | Nahi — `<img>` CORS poochta hi nahi |
| Logo chadhana | Browser → **Lambda** → S3 (server-side `PutObject`) | Nahi — browser S3 ko chhoota hi nahi |
| Chat ki file bhejna | `xhr.open('POST', url)` — browser **seedha** S3 ko | **Haan** ← pehli baar |

**Isme asal zaroorat sirf `POST` ki hai.** `GET` aur `ExposeHeaders` aaj kahin istemal
nahi hote — download `<img src>` / `<video src>` / `<a href>` se hota hai (teeno par CORS
nahi lagta), aur upload sirf `xhr.status` padhta hai, koi header nahi. Wo isliye rakhe
hain ki kal download ka tareeka badle to phir console na kholna pade — aur ye **kuch widen
karte hi nahi**.

> **CORS koi taala nahi hai.** Wo kisi ko file khol kar nahi deta — bucket private hi
> rehta hai, signature ab bhi chahiye. CORS sirf browser ko ijazat deta hai ki jo jawab
> usne pehle hi maanga tha, use padh bhi le. Isliye ye lagane se aaj jo chal raha hai wo
> waise ka waisa chalta rahega.

### `AllowedOrigins` me kya likhna hai — dhyan se

**Wahi likhna hai jo browser ke address bar me dikhta hai**, poora `https://` ke saath aur
bina aakhri slash ke.

- Agar site **Amplify ke default domain** se bhi khulti hai
  (`https://main.dxxxxxxxx.amplifyapp.com`), to **wo bhi** is list me jodiye — warna wahan
  se upload chupchap fail hoga.
- **Demo site (`demo.architectusbureau.com`) yahan mat jodiye.** Uska backend alag hai aur
  bucket bhi alag. Kabhi demo par bhi file bhejna chaalu karein to **us** bucket ki CORS me
  daaliyega, is wale me nahi.

**Galat/adhoora origin hone par kya dikhega:** user ko sirf **"Upload nahi ho paaya"**
milega. Server ke kisi log me kuch nahi aayega — kyunki bytes server ko chhoote hi nahi.
Pakka karne ka tareeka: **F12 → Console**, wahan CORS wali laal line dikhegi jisme wahi
origin likha hoga jo aapko list me daalna tha.

> **Branding par iska koi asar nahi.** CORS sirf **deta** hai, chheenta nahi — aur logo
> `<img src>` se load hota hai, jispar CORS lagta hi nahi. Site ka asli pata
> `team.architectusbureau.com` hai (jaancha gaya — `app.` exist nahi karta, aur
> `architectusbureau.com` alag marketing site hai).

## 2) Adhoore upload apne aap saaf hon — **AAJ ZAROORI NAHI, CHHOD SAKTE HAIN**

**Pehle ye padh lijiye, warna waqt barbaad hoga.** Ye step is doc me ek galatfehmi se aaya
tha. Aaj iska koi kaam nahi hai.

S3 ka **"Multipart Upload"** badi file ko tukdon me chadhane ka API hai — tukde ek-ek
karke jaate hain, aakhir me "jod do" kaha jaata hai. Beech me cancel/crash ho to chadhe
hue tukde S3 par pade reh jaate hain: listing me **dikhte tak nahi**, par **bill me poora
storage** lagta hai. Ye rule unhi ko 1 din me hataati hai.

**Par hum multipart istemal karte hi nahi.** Poora code jaancha gaya — `CreateMultipartUpload`,
`UploadPart`, `lib-storage`: kahin nahi. S3 par likhne ke sirf do raaste hain, aur dono
single-shot hain:

| Raasta | Kya karta hai |
| --- | --- |
| `createPresignedPost` (chat ki file) | Browser ek hi `POST` me poori file bhejta hai |
| `PutObjectCommand` (logo) | Lambda ek hi request me bhejta hai |

> **Naam ka dhokha:** `multipart/form-data` (browser ka form bhejne ka tareeka, jo hum
> istemal karte hain) aur **S3 Multipart Upload** (badi file ke tukdon wala API, jo hum
> nahi karte) — do bilkul alag cheezein hain. Ye doc pehle isi par phisla tha.

Aaj upload beech me cancel ho ya net kat jaye to POST bas mar jaata hai — S3 adhoora
object banata hi nahi, kuch peeche nahi chhoot-ta. **Safai ki zaroorat hi nahi.**

**To karein ya na karein?** 30 second lagte hain, khatra shoonya hai, aur jis din
**25 MB se badi file** ka kaam hoga us din chunking aayegi, multipart aayega — aur tab ye
rule pehle se lagi hogi. Ye wo cheez hai jo baad me yaad nahi rehti aur chup-chaap bill
khaati hai. Isliye laga dena theek hai, par **jaan kar ki ye aaj ke liye nahi, kal ke liye
hai**. Chhodna bhi utna hi theek hai.

Bucket → **Management** → **Create lifecycle rule**

- Rule name: `chat-abort-incomplete-uploads`
- Scope: **Limit the scope with prefix** → prefix: `chat/`
- Tick: **Delete expired object delete markers or incomplete multipart uploads** →
  **Delete incomplete multipart uploads** → **1 day**
- **Create rule**

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
| `s3:DeleteObject` | `deleteObjects()` — **aaj kahin se bulaya nahi jaata** (neeche dekhein) |

`/chat/*` sab kuch cover karta hai: asli file `chat/2026/09/<random>.b` hai aur thumbnail
`chat/2026/09/<random>.t` — dono isi ke andar.

> **`s3:DeleteObject` ke baare me saaf baat.** `deleteObjects()` function code me **hai**,
> par abhi use **kahin se bulaya nahi jaata** — jaancha gaya, `src/` me ek bhi call nahi.
> Matlab: jo file ek baar chadh gayi, wo S3 par **hamesha** rahegi.
>
> Aaj isse koi nuksan nahi, kyunki message delete hote hi nahi — "delete" sirf apni nazar
> se hataata hai (`deleteForMe`), doosre ko dikhta rehta hai. Aur retention **"hamesha
> rakho"** par hai, to purani chat bhi nahi hataai jaati.
>
> **Par jis din retention chaalu karenge**, us din `pruneOldChats()` database se message ki
> row hata dega aur **S3 ki file peeche chhoot jayegi** — aur uska key sirf usi row me tha,
> to wo bytes phir kabhi koi dhoondh bhi nahi payega. Chup-chaap storage ka bill.
>
> Permission ab bhi de dijiye (tab kaam aayegi, aur akele se kuch hota nahi). Ye kaam
> `audits/00-open-bugs.md` me darj hai — retention chaalu karne se **pehle** theek karna
> hai.

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

> **Paperclip turant na dikhe to ghabrahat nahi** — pehle se khule hue tab me purana jawab
> yaad pada rehta hai. **Page refresh kijiye** (ya tab band karke naya kholiye), phir
> dikhega.

> **Photo bhejte waqt jhalak na bane par bhi file chali jayegi** — thumbnail alag se
> chadhta hai aur uska fail hona upload ko nahi rokta. Yaani "jhalak nahi bani" ka matlab
> CORS ki galti ho, ye zaroori nahi. CORS galat hone par to poora upload hi fail hota hai
> ("Upload nahi ho paaya").

Kuch galat ho to sirf `CHAT_MEDIA_BUCKET` hata do — attachment ka button gayab ho jayega
aur **text wali chat** waise ki waisi chalti rahegi. Branding par koi asar nahi.

> **Dhyan rahe:** pehle se bheji hui file ki jhalak aur download tab tak kaam nahi karenge
> — bubble to dikhega, par uspar **hamesha ghoomta hua spinner** rahega, koi error message
> nahi aayega. Env var wapas lagate hi wo apne aap theek ho jayenge.

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
