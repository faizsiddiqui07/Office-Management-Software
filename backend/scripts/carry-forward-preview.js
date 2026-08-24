/**
 * READ-ONLY preview: dikhata hai ki agar "negative carry-forward" hata dein to kis-kis ka
 * ABHI ka month total kaise badlega. Ye script kuch bhi LIKHTA/BADALTA NAHI — sirf padhta hai.
 *
 * Chalane ka tareeka (backend folder se):
 *   node scripts/carry-forward-preview.js
 *
 * Ye wahi office DB padhta hai jo .env me set hai (MONGODB_DB). Neeche company ka naam bhi
 * print karta hai taaki pukka ho jaaye ki ye asli office data hai, demo nahi.
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Setting } from '../src/models/Setting.js';
import { User } from '../src/models/User.js';
import { PointEntry } from '../src/models/PointEntry.js';
import { carryInFor, currentMonth, getConfig } from '../src/services/bonus.service.js';

const money = (n) => (n || 0).toLocaleString('en-IN');

async function main() {
  await connectDB();

  const s = await Setting.getSingleton();
  const cfg = await getConfig();
  const month = currentMonth();

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  DB          : ${process.env.MONGODB_DB || 'office_management'}`);
  console.log(`  Company     : ${s.companyName || '(naam set nahi)'}   <-- asli office hona chahiye`);
  console.log(`  Bonus system: ${cfg.enabled ? 'ON' : 'OFF'}   |   rupees/point: ${cfg.rupeesPerPoint || 0}`);
  console.log(`  Month       : ${month}  (abhi ka mahina)`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // Sirf un users ko dekho jinke bonus points ka koi record hai (kahin bhi).
  const userIds = await PointEntry.distinct('user');
  const users = await User.find({ _id: { $in: userIds } }).select('name role employeeId isActive');
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const rows = [];
  for (const uid of userIds) {
    const u = byId.get(String(uid));
    if (!u) continue;
    // earned = is mahine ka apna (sirf iss month ke entries ka sum)
    const [agg] = await PointEntry.aggregate([
      { $match: { user: uid, month } },
      { $group: { _id: null, points: { $sum: '$points' } } },
    ]);
    const earned = agg?.points || 0;
    // carriedOver = pichhle mahino se aaya deficit (<= 0) — jo abhi carry ho raha hai
    const carriedOver = await carryInFor(uid, month);
    const nowNet = earned + carriedOver;   // ABHI jo dikhta hai (header/leaderboard/rewards)
    const afterNet = earned;               // FIX ke baad (har mahina apne aap me)
    if (carriedOver < 0) {
      rows.push({ name: u.name, role: u.role, isActive: u.isActive, earned, carriedOver, nowNet, afterNet });
    }
  }

  rows.sort((a, b) => a.carriedOver - b.carriedOver); // sabse zyada affected pehle

  if (!rows.length) {
    console.log('  Kisi ke bhi points abhi carry-forward NAHI ho rahe (koi negative carry nahi mila).');
    console.log('  Matlab abhi is mahina koi affected nahi — change karne pe kisi ka total nahi hilega.\n');
    await disconnectDB();
    return;
  }

  const rate = cfg.rupeesPerPoint || 0;
  console.log(`  ${rows.length} log affected hain (inke ${month} ke total me pichhle mahine ka negative jud raha hai):\n`);
  console.log('  Naam                         | Iss mah earned | Carry(-) | ABHI net | FIX baad net' + (rate ? ' | ABHI ₹ | FIX ₹' : ''));
  console.log('  ' + '-'.repeat(rate ? 96 : 74));
  for (const r of rows) {
    const nowRs = rate && r.nowNet > 0 ? Math.round(r.nowNet * rate) : 0;
    const afterRs = rate && r.afterNet > 0 ? Math.round(r.afterNet * rate) : 0;
    const tag = r.isActive === false ? ' (inactive)' : '';
    const line =
      `  ${(r.name + tag).padEnd(28)} | ${String(r.earned).padStart(14)} | ${String(r.carriedOver).padStart(8)} | ${String(r.nowNet).padStart(8)} | ${String(r.afterNet).padStart(12)}` +
      (rate ? ` | ${String(money(nowRs)).padStart(6)} | ${String(money(afterRs)).padStart(6)}` : '');
    console.log(line);
  }

  const totalCarry = rows.reduce((sum, r) => sum + r.carriedOver, 0);
  console.log('\n  ──────────────────────────────────────────────────────────────────');
  console.log(`  Kul ${rows.length} logon ke upar milaake ${totalCarry} points ka "drag" hai jo hat jayega.`);
  console.log('  (Purane mahino ke andar ke records NAHI badlenge — sirf abhi ka total upar aayega.)\n');

  await disconnectDB();
}

main().then(() => process.exit(0)).catch((err) => { console.error('Preview failed:', err); process.exit(1); });
