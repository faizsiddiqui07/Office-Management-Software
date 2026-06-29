# Deploy the backend to AWS Lambda + API Gateway (console only, no CLI)

The Express backend now runs **both** ways with no code changes:

- **Local** — `npm run dev` / `npm start` (uses `src/index.js`). Unchanged.
- **AWS Lambda** — uses `src/lambda.js` (handler `src/lambda.handler`), wrapped with
  `serverless-http`. The shared app lives in `src/app.js`.

You only use the **AWS website (console)** below — no AWS CLI / CloudShell.

---

## 0) Prerequisite — let Lambda reach MongoDB Atlas

Lambda IPs are dynamic, so Atlas must accept connections from anywhere (or a VPC, advanced).

1. MongoDB Atlas → your project → **Network Access** → **Add IP Address**
2. Choose **Allow access from anywhere** (`0.0.0.0/0`) → Confirm.

(Your `MONGODB_URI` already works locally — we reuse it.)

---

## 1) Build the upload package (on your PC)

```bash
cd backend
npm install        # if you haven't lately
npm run package:lambda
```

This creates **`backend/lambda.zip`** (~19 MB). It prints the handler to use:
`src/lambda.handler`. Under 50 MB → you can upload it directly in the console.

---

## 2) Create the Lambda function

1. AWS Console → **Lambda** → **Create function**
2. **Author from scratch**
   - Function name: `office-management-api`
   - Runtime: **Node.js 20.x** (or 22.x)
   - Architecture: x86_64
3. **Create function**

## 3) Upload the code + set the handler

1. On the function page → **Code** tab → **Upload from** → **.zip file** → choose `backend/lambda.zip` → **Save**.
2. **Runtime settings** (just below the code) → **Edit** → set **Handler** to:
   ```
   src/lambda.handler
   ```
   → **Save**.

## 4) Configure runtime (PDF reports need memory + time)

**Configuration** tab → **General configuration** → **Edit**:
- **Memory**: `1024` MB
- **Timeout**: `0 min 30 sec`
- **Save**

## 5) Environment variables

**Configuration** → **Environment variables** → **Edit** → add these (copy the values
from your local `backend/.env`):

| Key | Value | Notes |
| --- | --- | --- |
| `MONGODB_URI` | *(your Atlas URI)* | **required** |
| `JWT_SECRET` | *(your secret)* | **required** — same as local so existing logins work |
| `CLIENT_URL` | `https://your-frontend-domain` | the site that calls the API (comma-separate multiple) |
| `NODE_ENV` | `production` | |
| `COOKIE_SAMESITE` | `none` | needed so the login cookie works cross-domain |
| `COOKIE_SECURE` | `true` | required when SameSite=None |
| `MONGODB_DB` | `office_management` | optional (this is the default) |
| `JWT_EXPIRES_IN` | *(from .env, optional)* | |
| `COMPANY_TZ` | `Asia/Kolkata` | optional |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | *(from .env)* | only if you use push notifications |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | *(from .env)* | only for password-reset emails |

Do **not** set `PORT` (ignored on Lambda) or `AWS_LAMBDA_FUNCTION_NAME` (AWS sets it).
→ **Save**.

## 6) Put API Gateway in front

1. AWS Console → **API Gateway** → **Create API** → **HTTP API** → **Build**
2. **Add integration** → **Lambda** → pick `office-management-api`
3. API name: `office-management-api` → **Next**
4. **Routes**: set
   - Method: **ANY**
   - Resource path: **/{proxy+}**
   - Integration: the Lambda
   (Add a second route **ANY** `/` → same Lambda if you want the root reachable.)
5. **Next** → **Stages**: keep **`$default`** (Auto-deploy on) → **Next** → **Create**.
6. Copy the **Invoke URL**, e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com`

> **Don't enable CORS on the API Gateway** — the Express app already sends the
> correct CORS + credentials headers (based on `CLIENT_URL`). Double CORS breaks logins.

## 7) Test the API

Open in a browser:
```
https://abc123.execute-api.ap-south-1.amazonaws.com/api/health
```
You should see `{"ok":true,"data":{"status":"up",...}}`. 🎉

## 8) Point the frontend at it

In the **website** deployment, set:
```
NEXT_PUBLIC_API_URL = https://abc123.execute-api.ap-south-1.amazonaws.com
```
(No trailing `/api` — the frontend adds `/api` itself.) Rebuild/redeploy the frontend.
Also make sure the Lambda's `CLIENT_URL` equals the frontend's exact origin (scheme + host, no trailing slash).

---

## Re-deploying after code changes

1. `npm run package:lambda` again
2. Lambda → **Code** → **Upload from** → **.zip file** → pick the new `lambda.zip` → **Save**

(API Gateway, env vars, handler all stay — only the code is replaced.)

---

## Known limitations on Lambda (by design)

- **Logo / background uploads** (Settings) won't work on Lambda — its disk is
  read-only. The API returns a clear "needs S3" message instead of crashing. Set
  your logo/background while running the backend locally (it writes into the
  website's `public/brand` folder), or later wire up S3. The web UI still *shows*
  logos/backgrounds (served by the frontend); only **uploading** and **PDF logo
  embedding** are affected on Lambda.
- **Cross-site cookies**: with the frontend and API on different domains, the
  login cookie uses `SameSite=None; Secure`. This works in most browsers; for
  maximum reliability put both behind the **same custom domain** (e.g. site at
  `app.example.com`, API at `api.example.com`) later.
- **Cold starts**: the first request after idle is a few seconds slower.

---

## How local stays working

`src/index.js` still does `app.listen(...)` exactly as before — Lambda never runs
it (Lambda calls `src/lambda.handler`). Both import the same `src/app.js`. So
`npm run dev` locally is unchanged.
