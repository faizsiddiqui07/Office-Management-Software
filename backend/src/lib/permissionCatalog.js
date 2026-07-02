/**
 * The full catalog of granular permissions, grouped by module — the source of
 * truth for the role editor. Each `key` is exactly the `action` string used in
 * `can(user, action)` / `requirePermission(action)` across the app.
 */

// Implicit permissions every role has (not shown as toggles).
export const BASE_PERMISSIONS = ['viewOwn', 'viewAnnouncements', 'viewCalendar'];

// Action aliases → canonical permission key.
export const PERMISSION_ALIASES = { viewUserData: 'viewEveryone' };

export const PERMISSION_CATALOG = [
  {
    module: 'Attendance',
    permissions: [
      { key: 'markAttendance', label: 'Mark their own attendance' },
      { key: 'viewEveryone', label: "View everyone's attendance & data" },
      { key: 'approveRegularization', label: 'Approve attendance corrections' },
    ],
  },
  {
    module: 'Leaves',
    permissions: [
      { key: 'applyLeave', label: 'Apply for their own leave' },
      { key: 'approveLeave', label: 'Approve / reject leave requests' },
    ],
  },
  {
    module: 'Expenses',
    permissions: [
      { key: 'viewExpenses', label: 'View the expense register' },
      { key: 'manageExpenses', label: 'Add / edit / delete expenses' },
    ],
  },
  {
    module: 'Dues',
    permissions: [{ key: 'manageDues', label: 'Manage the dues ledger' }],
  },
  {
    module: 'Announcements',
    permissions: [{ key: 'postAnnouncements', label: 'Post announcements' }],
  },
  {
    module: 'Calendar',
    permissions: [{ key: 'editCalendar', label: 'Add / edit holidays' }],
  },
  {
    module: 'Users',
    permissions: [
      { key: 'createUsers', label: 'Create users' },
      { key: 'manageUsers', label: 'Edit users' },
      { key: 'deactivateUsers', label: 'Deactivate users' },
      { key: 'changeRoles', label: 'Change a user’s role' },
      { key: 'resetCredentials', label: 'Reset user passwords' },
    ],
  },
  {
    module: 'Reports',
    permissions: [{ key: 'downloadReports', label: 'View / download reports' }],
  },
  {
    module: 'Dashboard',
    permissions: [{ key: 'leadershipDashboard', label: 'Leadership dashboard & analytics' }],
  },
  {
    module: 'Visitors',
    permissions: [{ key: 'manageVisitors', label: 'Visitor register — log, view & export entries' }],
  },
  // (Task delegation is per-person — User.taskAssign, set in Users → Edit — not a role permission.)
  {
    module: 'Admin',
    permissions: [
      { key: 'manageSettings', label: 'Company settings' },
      { key: 'viewAudit', label: 'View activity log' },
      { key: 'manageRoles', label: 'Manage roles & permissions' },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_CATALOG.flatMap((g) => g.permissions.map((p) => p.key));

// Leadership runs the company — full control, but they don't self-track their
// own attendance/leave and don't manage the personal dues ledger.
const LEADERSHIP_PERMS = ALL_PERMISSION_KEYS.filter(
  (k) => !['manageDues', 'markAttendance', 'applyLeave'].includes(k),
);

/** Default permission sets for the built-in roles. */
export const SYSTEM_ROLES = [
  { key: 'CEO', label: 'CEO', rank: 1, permissions: LEADERSHIP_PERMS },
  { key: 'DIRECTOR', label: 'Director', rank: 2, permissions: LEADERSHIP_PERMS },
  {
    key: 'ADMIN_MANAGER',
    label: 'Admin Manager',
    rank: 3,
    permissions: ['markAttendance', 'applyLeave', 'viewEveryone', 'createUsers', 'editCalendar', 'resetCredentials', 'manageExpenses', 'viewExpenses', 'manageDues'],
  },
  { key: 'MANAGER', label: 'Manager', rank: 5, permissions: ['markAttendance', 'applyLeave', 'viewEveryone', 'approveLeave', 'viewExpenses'] },
  { key: 'EMPLOYEE', label: 'Employee', rank: 6, permissions: ['markAttendance', 'applyLeave'] },
  { key: 'OFFICE_BOY', label: 'Office Boy', rank: 7, permissions: ['markAttendance', 'applyLeave'] },
  { key: 'SECURITY', label: 'Security Guard', rank: 8, permissions: ['markAttendance', 'applyLeave'] },
];
