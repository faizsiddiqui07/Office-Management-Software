/**
 * Builds `backend/lambda.zip` — a deployment package you upload in the AWS
 * Lambda console (Code → Upload from → .zip file). No AWS CLI needed.
 *
 * Run:  npm run package:lambda
 * Handler to set in Lambda:  src/lambda.handler
 *
 * Excludes .env (set those as Lambda environment variables in the console) and
 * the zip itself. Uses `archiver` so entry paths use forward slashes (required
 * by Lambda — Windows' Compress-Archive can produce backslashes that break it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'lambda.zip');

if (fs.existsSync(out)) fs.unlinkSync(out);

const output = fs.createWriteStream(out);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const mb = archive.pointer() / 1024 / 1024;
  console.log(`\n✅ Created ${path.relative(process.cwd(), out)} — ${mb.toFixed(1)} MB`);
  console.log('   Lambda handler:  src/lambda.handler');
  if (mb > 50) {
    console.log('\n⚠️  Larger than 50 MB — the console’s direct upload won’t accept it.');
    console.log('   Upload lambda.zip to an S3 bucket (S3 console → Upload), then in');
    console.log('   Lambda → Code → Upload from → Amazon S3 location, paste the object URL.');
  } else {
    console.log('   Under 50 MB — upload it directly in the Lambda console.');
  }
});

archive.on('warning', (err) => {
  if (err.code !== 'ENOENT') throw err;
});
archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Exactly what the function needs at the zip root (forward-slash entries).
archive.directory(path.join(root, 'src'), 'src');
archive.directory(path.join(root, 'node_modules'), 'node_modules');
archive.file(path.join(root, 'package.json'), { name: 'package.json' });
const lock = path.join(root, 'package-lock.json');
if (fs.existsSync(lock)) archive.file(lock, { name: 'package-lock.json' });

archive.finalize();
