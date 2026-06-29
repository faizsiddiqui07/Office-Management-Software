/**
 * Roles, role groups, and the `can()` permission helper (MASTER CONTEXT §4).
 * Authorization is now DB-driven (per-role permission sets, cached in roles.js);
 * the hardcoded groups below are the seed defaults + a safe fallback used until
 * the role cache is loaded.
 */
import { getRolePermissionSet } from './roles.js';

export const ROLES = [
  'CEO',
  'DIRECTOR',
  'ADMIN_MANAGER',
  'MANAGER',
  'EMPLOYEE',
  'OFFICE_BOY',
  'SECURITY',
];

/** Top leadership tier — full access + leadership-only features. */
export const LEADERSHIP = ['CEO', 'DIRECTOR'];

/** Calendar editing + user creation + reset-credentials tier. */
export const ADMINS = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER'];

/** Roles that may view everyone's attendance/leave data. */
export const CAN_VIEW_EVERYONE = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER', 'MANAGER'];

/** Finance: who may ADD/EDIT expenses (Admin Manager buys supplies for the office). */
export const CAN_MANAGE_EXPENSES = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER'];

/** Who may VIEW the expense register (managers get read-only oversight too). */
export const CAN_VIEW_EXPENSES = ['CEO', 'DIRECTOR', 'ADMIN_MANAGER', 'MANAGER'];

/** Who may preview/download the company reports (leadership). */
export const CAN_VIEW_REPORTS = ['CEO', 'DIRECTOR'];

/** Leave approvers — leadership + managers. */
export const APPROVERS = ['CEO', 'DIRECTOR', 'MANAGER'];

export function isLeadership(role) {
  return LEADERSHIP.includes(role);
}
export function isAdmin(role) {
  return ADMINS.includes(role);
}
export function canViewEveryone(role) {
  return CAN_VIEW_EVERYONE.includes(role);
}

function userId(user) {
  return String(user?.id ?? user?._id ?? '');
}

// Implicit permissions every signed-in user has.
const BASE = new Set(['viewOwn', 'viewAnnouncements', 'viewCalendar']);
// Action aliases → canonical permission key.
const ALIAS = { viewUserData: 'viewEveryone' };

/**
 * Central authorization check. Reads the DB-backed permission set for the user's
 * role (cached); falls back to the hardcoded defaults until the cache is loaded.
 * @param {{role:string, id?:string, _id?:any}} user
 * @param {string} action
 * @param {object} [resource]  optional resource (e.g. { userId } for ownership)
 */
export function can(user, action, resource = {}) {
  if (!user || !user.role) return false;
  if (BASE.has(action)) return true;

  // Ownership shortcut: a user may always read their own data.
  if (action === 'viewUserData' && resource.userId && userId(user) === String(resource.userId)) return true;

  const perm = ALIAS[action] || action;
  const set = getRolePermissionSet(user.role);
  if (set) return set.has(perm);

  return canHardcoded(user.role, perm);
}

/** Original hardcoded rules — the seed defaults + fallback before the cache loads. */
function canHardcoded(role, perm) {
  switch (perm) {
    case 'markAttendance':
    case 'applyLeave':
      // Self-service for everyone except leadership (they don't self-track).
      return !LEADERSHIP.includes(role);
    case 'viewEveryone':
      return CAN_VIEW_EVERYONE.includes(role);
    case 'approveLeave':
      return APPROVERS.includes(role);
    case 'createUsers':
    case 'editCalendar':
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

/** Only CEO/Director may create or assign CEO/Director accounts; admins handle the rest. */
export function canAssignRole(creatorRole, targetRole) {
  if (LEADERSHIP.includes(targetRole)) return LEADERSHIP.includes(creatorRole);
  return ADMINS.includes(creatorRole);
}
