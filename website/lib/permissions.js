import {
  Activity,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  FileText,
  HandCoins,
  LayoutDashboard,
  Megaphone,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Client-side permission helper. The server is the source of truth; this only
 * hides/shows UI. It prefers the user's live permission set (from /auth/me) and
 * falls back to the built-in role groups when that isn't available yet.
 */
export const ROLES = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER', 'MANAGER', 'EMPLOYEE', 'OFFICE_BOY', 'SECURITY'];

export const ROLE_LABELS = {
  CEO: 'CEO',
  DIRECTOR: 'Director',
  ADMIN_MANAGER: 'Admin Manager',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
  OFFICE_BOY: 'Office Boy',
  SECURITY: 'Security Guard',
};

/** Human label for any role key (built-in or custom). */
export function prettyRole(key) {
  if (!key) return '';
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  return key
    .split('_')
    .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// Built-in role groups — only used as a fallback before /auth/me loads permissions.
export const LEADERSHIP = ['CEO', 'DIRECTOR'];
export const ADMINS = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER'];
export const VIEW_EVERYONE = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER', 'MANAGER'];
export const APPROVERS = ['CEO', 'DIRECTOR', 'MANAGER'];
export const CAN_MANAGE_EXPENSES = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER'];
export const CAN_VIEW_EXPENSES = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER', 'MANAGER'];
export const CAN_VIEW_REPORTS = ['CEO', 'DIRECTOR'];

const BASE = new Set(['viewOwn', 'viewAnnouncements', 'viewCalendar']);
const ALIAS = { viewUserData: 'viewEveryone' };

export const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Attendance', href: '/attendance', icon: CalendarClock },
  { label: 'Leaves', href: '/leaves', icon: CalendarDays },
  { label: 'Dues', href: '/dues', icon: HandCoins },
  { label: 'Announcements', href: '/announcements', icon: Megaphone },
  { label: 'Calendar', href: '/calendar', icon: CalendarRange },
  { label: 'Team', href: '/attendance?tab=everyone', icon: Users, permission: 'viewEveryone' },
  { label: 'Expenses', href: '/expenses', icon: Wallet, permission: 'viewExpenses' },
  { label: 'Users', href: '/users', icon: UserPlus, permission: 'createUsers' },
  { label: 'Reports', href: '/reports', icon: FileText },
  { label: 'Activity', href: '/activity', icon: Activity, permission: 'viewAudit' },
  { label: 'Roles', href: '/roles', icon: ShieldCheck, permission: 'manageRoles' },
  { label: 'Settings', href: '/settings', icon: Settings, permission: 'manageSettings' },
];

export function navItemsFor(user) {
  return NAV_ITEMS.filter((item) => !item.permission || can(user, item.permission));
}

/**
 * Cosmetic only — never rely on this for security. Accepts a user object
 * (preferred — uses its live `permissions`) or a bare role string.
 */
export function can(userOrRole, action) {
  const user = userOrRole && typeof userOrRole === 'object' ? userOrRole : null;
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  if (!role) return false;
  if (BASE.has(action)) return true;

  const perm = ALIAS[action] || action;
  if (user && Array.isArray(user.permissions)) return user.permissions.includes(perm);

  return canFallback(role, perm);
}

function canFallback(role, perm) {
  switch (perm) {
    case 'markAttendance':
    case 'applyLeave':
      return !LEADERSHIP.includes(role);
    case 'viewEveryone':
      return VIEW_EVERYONE.includes(role);
    case 'approveLeave':
      return APPROVERS.includes(role);
    case 'editCalendar':
    case 'createUsers':
    case 'resetCredentials':
      return ADMINS.includes(role);
    case 'manageExpenses':
      return CAN_MANAGE_EXPENSES.includes(role);
    case 'viewExpenses':
      return CAN_VIEW_EXPENSES.includes(role);
    case 'downloadReports':
      return CAN_VIEW_REPORTS.includes(role);
    case 'manageDues':
      return role === 'ADMIN_MANAGER';
    case 'manageUsers':
    case 'deactivateUsers':
    case 'changeRoles':
    case 'postAnnouncements':
    case 'leadershipDashboard':
    case 'manageSettings':
    case 'viewAudit':
    case 'approveRegularization':
    case 'manageRoles':
      return LEADERSHIP.includes(role);
    default:
      return false;
  }
}
