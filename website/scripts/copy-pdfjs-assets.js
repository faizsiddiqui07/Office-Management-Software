/**
 * pdf.js ke static assets ko `public/` me laata hai — postinstall par chalta hai.
 *
 * Kyun: pdf.js ka worker aur uske decoder (wasm), font-maps (cmaps) aur standard fonts
 * runtime par alag file se load hote hain. Webpack se bundle karne par Terser worker ko
 * todta hai, isliye ye seedha `public/` se serve hote hain. Version installed pdfjs-dist
 * ke saath hamesha match rahe — isliye copy, haath se nahi.
 *
 * Ye files git me bhi commit hain (taaki install ke bina bhi dev chale, aur Amplify
 * postinstall par nirbhar na rahe). Dono ek hi cheez hain.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist');
const pub = path.join(__dirname, '..', 'public');
if (!fs.existsSync(src)) {
  console.log('[pdfjs] pdfjs-dist installed nahi hai — skip');
  process.exit(0);
}

fs.copyFileSync(path.join(src, 'build', 'pdf.worker.min.mjs'), path.join(pub, 'pdf.worker.min.mjs'));
for (const dir of ['wasm', 'cmaps', 'standard_fonts']) {
  fs.cpSync(path.join(src, dir), path.join(pub, 'pdfjs', dir), { recursive: true });
}
console.log('[pdfjs] worker + wasm + cmaps + standard_fonts → public/');
