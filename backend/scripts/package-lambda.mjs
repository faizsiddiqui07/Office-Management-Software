/**
 * Builds `backend/lambda.zip` — a deployment package you upload in the AWS
 * Lambda console (Code → Upload from → .zip file). No AWS CLI needed.
 *
 * Run:  npm run package:lambda
 * Handler to set in Lambda:  src/lambda.handler   (badla nahi — neeche dekho)
 *
 * ── Cold start ke liye BUNDLE ────────────────────────────────────────────────
 * Pehle zip me poora src/ + poora node_modules jaata tha: ~1,500 file-reads har cold
 * start par (akela date-fns 865!). Naapa gaya: init ka 90% waqt sirf files dhoondhne-
 * padhne me. Ab esbuild se sab ek bundle me (dist/), tree-shaken — local par 1,400 ms →
 * 280 ms. Lambda par Init Duration ~3 s se seedha girna chahiye.
 *
 * Bahar (node_modules me) sirf wo jo bundle nahi hote: @react-pdf/renderer (+react) aur
 * AWS SDK — ye dono waise bhi lazy hain, sirf PDF/upload par load hote hain. Unka
 * node_modules ek alag staging me `npm install` se banta hai (sirf unki apni dependencies,
 * poora 22 MB nahi).
 *
 * Handler wahi `src/lambda.handler` — zip ke src/lambda.js me ek shim hai jo dist/ se
 * re-export karta hai. Console me kuch nahi badalna. src/ me sirf shim + assets +
 * build-info jaata hai; baaki code dist/ ke bundle me.
 *
 * Excludes .env (set those as Lambda environment variables in the console).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'lambda.zip');
const stage = path.join(root, 'build', 'lambda');

// Ye packages bundle NAHI hote (node_modules se aate hain). Baaki sab bundle me.
const EXTERNAL = ['@react-pdf/renderer', 'react', '@aws-sdk/*'];
const EXTERNAL_PKGS = ['@react-pdf/renderer', 'react', '@aws-sdk/client-s3', '@aws-sdk/client-apigatewaymanagementapi', '@aws-sdk/s3-presigned-post', '@aws-sdk/s3-request-presigner'];

if (fs.existsSync(out)) fs.unlinkSync(out);

/**
 * Stamp the commit being packaged into src/build-info.json, which /api/health then
 * reports. Doing it here rather than by hand is the whole point: after an upload you
 * can tell in one request whether the running function is this build or the last one.
 */
function stampBuild() {
  const git = (cmd) => {
    try { return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return ''; }
  };
  const commit = git('git rev-parse --short HEAD') || 'unknown';
  const dirty = git('git status --porcelain') !== '';
  const info = {
    commit: dirty ? `${commit}+local` : commit,
    subject: git('git log -1 --pretty=%s').slice(0, 120),
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'src', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
  console.log(`   Build stamp:     ${info.commit}  (${info.builtAt})`);
  if (dirty) console.log('   ⚠️  Working tree has uncommitted changes — stamped as +local.');
  return info;
}

async function bundle() {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, 'src', 'assets'), { recursive: true });
  const t = Date.now();
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'lambda.js')],
    bundle: true,
    splitting: true, // PDF services / demo seed alag chunk — lazy hi rehte hain
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outdir: path.join(stage, 'dist'),
    external: EXTERNAL,
    // Bundle ke andar CJS packages `require` maangte hain — ESM output me ye shim zaroori.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
    metafile: true,
  });
  const files = Object.keys(result.metafile.outputs);
  const total = files.reduce((n, f) => n + result.metafile.outputs[f].bytes, 0);
  console.log(`   Bundle:          ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB  (${Date.now() - t} ms)`);

  // Shim — handler naam wahi rahe.
  fs.writeFileSync(path.join(stage, 'src', 'lambda.js'),
    "// Shim: asli code dist/ ke bundle me hai (dekho scripts/package-lambda.mjs).\nexport { handler } from '../dist/lambda.js';\n");
  fs.copyFileSync(path.join(root, 'src', 'build-info.json'), path.join(stage, 'src', 'build-info.json'));
  for (const f of fs.readdirSync(path.join(root, 'src', 'assets'))) {
    fs.copyFileSync(path.join(root, 'src', 'assets', f), path.join(stage, 'src', 'assets', f));
  }
}

/** Sirf external packages (aur unki dependencies) ka node_modules — poora 22 MB nahi. */
function installExternals() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const deps = {};
  for (const name of EXTERNAL_PKGS) {
    if (!pkg.dependencies[name]) throw new Error(`external ${name} package.json ki dependencies me nahi`);
    deps[name] = pkg.dependencies[name];
  }
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'lambda-bundle', private: true, type: 'module', dependencies: deps }, null, 2));
  const t = Date.now();
  execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock --loglevel=error', { cwd: stage, stdio: 'inherit' });
  const count = fs.readdirSync(path.join(stage, 'node_modules')).filter((d) => !d.startsWith('.')).length;
  console.log(`   node_modules:    ${count} top-level packages (externals only)  (${Date.now() - t} ms)`);
}

stampBuild();
await bundle();
installExternals();

const output = fs.createWriteStream(out);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const mb = archive.pointer() / 1024 / 1024;
  console.log(`\n✅ Created ${path.relative(process.cwd(), out)} — ${mb.toFixed(1)} MB`);
  console.log('   Lambda handler:  src/lambda.handler  (wahi purana)');
  if (mb > 50) {
    console.log('\n⚠️  Larger than 50 MB — upload via S3 instead of the console.');
  } else {
    console.log('   Under 50 MB — upload it directly in the Lambda console.');
  }
});
archive.on('warning', (err) => { if (err.code !== 'ENOENT') throw err; });
archive.on('error', (err) => { throw err; });
archive.pipe(output);

archive.directory(path.join(stage, 'src'), 'src');
archive.directory(path.join(stage, 'dist'), 'dist');
archive.directory(path.join(stage, 'node_modules'), 'node_modules');
archive.file(path.join(stage, 'package.json'), { name: 'package.json' });
archive.finalize();
