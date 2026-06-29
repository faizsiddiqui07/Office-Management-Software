import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';

// On AWS Lambda the task dir (/var/task) is read-only — only /tmp is writable
// (and ephemeral). Locally we use ./uploads. Never throw at import time, so a
// read-only filesystem can't crash the whole function on startup.
const UPLOAD_DIR = process.env.AWS_LAMBDA_FUNCTION_NAME
  ? path.join(os.tmpdir(), 'uploads')
  : path.resolve(process.cwd(), 'uploads');
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch {
  // read-only filesystem (e.g. Lambda) — disk uploads simply won't be available here
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-z0-9_-]/gi, '_')
      .slice(0, 40);
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

/** Multer instance for optional expense receipts (used in the Expenses phase). */
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  },
});
