/**
 * Chat ka UI haath se dekhne ke liye ek THROWAWAY database bhar deta hai.
 *
 * Asli data ko chhuta nahi — apna alag DB (office_ui_demo) banata hai. Backend ko isi DB
 * par chalao (MONGODB_DB=office_ui_demo) aur neeche diye logins se ghus jao.
 *
 * Run (backend folder se):  node scripts/seed-chat-ui-demo.js
 */
import 'dotenv/config';
process.env.MONGODB_DB = 'office_ui_demo'; // throwaway

import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Role } from '../src/models/Role.js';
import { Setting } from '../src/models/Setting.js';
import { hashPassword } from '../src/lib/password.js';
import { loadRoles } from '../src/lib/roles.js';
import * as chat from '../src/services/chat.service.js';
import { SYSTEM_ROLES } from '../src/lib/permissionCatalog.js';

const PASSWORD = 'Chat@12345';

async function main() {
  await connectDB();
  if (!/demo|test/i.test(mongoose.connection.name)) throw new Error('refusing: not a throwaway DB');
  await mongoose.connection.dropDatabase();
  console.log(`\n🧪 DB: ${mongoose.connection.name}\n`);

  await Role.insertMany(SYSTEM_ROLES.map((r) => ({ ...r, isSystem: true })));
  await loadRoles();
  await Setting.create({ key: 'global', companyName: 'Architectus Bureau', weekendDays: [0] });
  Setting.invalidateCache();

  const hash = await hashPassword(PASSWORD);
  const mk = (name, email, role, designation, id) =>
    User.create({ name, email, passwordHash: hash, role, employeeId: id, designation, isActive: true, mustChangePassword: false });

  const asha = await mk('Asha Verma', 'asha@demo.co', 'CEO', 'CEO & President', 'AB-001');
  const brij = await mk('Brij Mehta', 'brij@demo.co', 'MANAGER', 'Project Manager', 'AB-002');
  const chhaya = await mk('Chhaya Rao', 'chhaya@demo.co', 'EMPLOYEE', 'Architect', 'AB-003');
  await mk('Dev Sharma', 'dev@demo.co', 'EMPLOYEE', 'Site Engineer', 'AB-004');
  await mk('Ekta Nair', 'ekta@demo.co', 'EMPLOYEE', '3D Visualiser', 'AB-005');

  // Asha ↔ Brij: ek chalti hui baat-cheet (kuch padhi hui, kuch nayi)
  const ab = await chat.openDirect(asha, brij._id);
  const script = [
    [asha, 'Brij, Sector 45 wale site ka revised layout bhej diya hai'],
    [brij, 'Mil gaya. Client ne parking ke liye kuch bola tha?'],
    [asha, 'Haan — basement me 12 car ki jagah chahiye, unhone kal confirm kiya'],
    [brij, 'Theek hai, main structural team ko aaj hi bata deta hoon'],
    [asha, 'Aur elevation ka render Friday tak chahiye, presentation usi din hai'],
  ];
  for (const [who, text] of script) await chat.sendMessage(who, ab.id, { text });
  await chat.markRead(brij, ab.id);
  await chat.sendMessage(asha, ab.id, { text: 'Ek aur baat — invoice bhi bhejna hai is hafte' });

  // Asha ↔ Chhaya: do naye unread
  const ac = await chat.openDirect(asha, chhaya._id);
  await chat.sendMessage(chhaya, ac.id, { text: 'Ma\'am, drawing set ka final print nikal doon?' });
  await chat.sendMessage(chhaya, ac.id, { text: 'Aur Dev ko site visit ke liye bhej rahe hain kal' });

  console.log('Log in karne ke liye (password sabka same):');
  console.log(`  asha@demo.co    ${PASSWORD}   (CEO & President — 2 unread)`);
  console.log(`  brij@demo.co    ${PASSWORD}   (Manager — 1 unread)`);
  console.log(`  chhaya@demo.co  ${PASSWORD}   (Employee)`);
  console.log('\nBackend chalao:  MONGODB_DB=office_ui_demo npm run dev\n');
  await disconnectDB();
}

main().catch((e) => { console.error(e); process.exit(1); });
