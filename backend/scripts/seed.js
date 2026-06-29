import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { hashPassword } from '../src/lib/password.js';
import { User } from '../src/models/User.js';
import { Setting } from '../src/models/Setting.js';
import { LeaveBalance } from '../src/models/LeaveBalance.js';

const SEED_PASSWORD = 'Password@123';

const seedUsers = [
  { name: 'Zia Khan', email: 'zia@office.com', role: 'CEO', employeeId: 'EMP-0001', department: 'Leadership', designation: 'Chief Executive Officer' },
  { name: 'Vikram Singh', email: 'boss@office.com', role: 'DIRECTOR', employeeId: 'EMP-0002', department: 'Leadership', designation: 'Director' },
  { name: 'Amir Raza', email: 'admin@office.com', role: 'ADMIN_MANAGER', employeeId: 'EMP-0003', department: 'Operations', designation: 'Admin Manager' },
  { name: 'Pooja Verma', email: 'accountant@office.com', role: 'EMPLOYEE', employeeId: 'EMP-2001', department: 'Finance', designation: 'Accounts Executive' },
  { name: 'Sara Ali', email: 'manager@office.com', role: 'MANAGER', employeeId: 'EMP-0004', department: 'Engineering', designation: 'Team Manager' },
  { name: 'Imran Sheikh', email: 'employee@office.com', role: 'EMPLOYEE', employeeId: 'EMP-0005', department: 'Engineering', designation: 'Software Engineer' },
  { name: 'Ravi Kumar', email: 'officeboy@office.com', role: 'OFFICE_BOY', employeeId: 'EMP-0006', department: 'Facilities', designation: 'Office Assistant' },
  { name: 'Ramesh Yadav', email: 'security@office.com', role: 'SECURITY', employeeId: 'EMP-2002', department: 'Security', designation: 'Security Guard' },
  { name: 'Neha Gupta', email: 'neha@office.com', role: 'EMPLOYEE', employeeId: 'EMP-0007', department: 'Design', designation: 'Product Designer' },
  { name: 'Arjun Mehta', email: 'arjun@office.com', role: 'EMPLOYEE', employeeId: 'EMP-0008', department: 'Engineering', designation: 'Backend Engineer' },
];

async function seed() {
  await connectDB();

  // Migrate any legacy 'BOSS' accounts (renamed to DIRECTOR).
  const migrated = await User.updateMany({ role: 'BOSS' }, { $set: { role: 'DIRECTOR' } });
  if (migrated.modifiedCount) console.log(`↻ Migrated ${migrated.modifiedCount} BOSS → DIRECTOR`);

  const settings = await Setting.getSingleton();
  console.log(
    `⚙️  Settings: "${settings.companyName}" · hours ${settings.workStart}-${settings.workEnd} · TZ ${settings.timezone} · quota ${settings.annualLeaveQuota} · ${settings.currency}`,
  );

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const year = new Date().getFullYear();

  for (const u of seedUsers) {
    const doc = await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          name: u.name,
          role: u.role,
          employeeId: u.employeeId,
          department: u.department,
          designation: u.designation,
          passwordHash,
          mustChangePassword: false, // seeded demo users are ready to use
          isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await LeaveBalance.findOneAndUpdate(
      { user: doc._id, year },
      {
        $setOnInsert: {
          user: doc._id,
          year,
          totalQuota: settings.annualLeaveQuota,
          used: 0,
          remaining: settings.annualLeaveQuota,
          overtimeMinutes: 0,
        },
      },
      { upsert: true, new: true },
    );
  }

  // Wire reporting lines: everyone non-leadership reports to the Manager.
  const manager = await User.findOne({ email: 'manager@office.com' });
  if (manager) {
    await User.updateMany(
      { role: { $in: ['EMPLOYEE', 'OFFICE_BOY', 'SECURITY'] } },
      { $set: { reportsTo: manager._id } },
    );
  }

  console.log(`\n✅ Seeded ${seedUsers.length} users.`);
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  Password for ALL seeded accounts:  ${SEED_PASSWORD}`);
  console.log('────────────────────────────────────────────────────────────');
  for (const u of seedUsers) {
    console.log(`  ${u.role.padEnd(14)} ${u.email}`);
  }
  console.log('────────────────────────────────────────────────────────────\n');

  await disconnectDB();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
