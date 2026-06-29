import { Role } from '../models/Role.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { SYSTEM_ROLES, ALL_PERMISSION_KEYS } from './permissionCatalog.js';

// In-memory cache: roleKey -> Set(permissionKeys). Kept in sync on every mutation.
let cache = new Map();
// roleKey -> human label, kept in sync alongside the permission cache.
let labels = new Map();

/** Upsert the built-in roles if they don't exist yet (never overwrites edits). */
export async function ensureSystemRoles() {
  for (const r of SYSTEM_ROLES) {
    await Role.updateOne(
      { key: r.key },
      { $setOnInsert: { key: r.key, label: r.label, permissions: r.permissions, isSystem: true, rank: r.rank } },
      { upsert: true },
    );
  }
}

/** (Re)load all roles into the in-memory cache. */
export async function loadRoles() {
  const docs = await Role.find();
  const map = new Map();
  const lbl = new Map();
  for (const r of docs) {
    map.set(r.key, new Set(r.permissions));
    lbl.set(r.key, r.label);
  }
  cache = map;
  labels = lbl;
  return cache.size;
}

export function getRolePermissionSet(roleKey) {
  return cache.get(roleKey) || null;
}

/** Human label for a role key (falls back to the key itself). */
export function roleLabel(roleKey) {
  return labels.get(roleKey) || roleKey;
}

/** Effective permission keys for a role (granted toggles only; base is implicit). */
export function permissionsForRole(roleKey) {
  const set = cache.get(roleKey);
  return set ? [...set] : [];
}

/** Role keys whose permission set includes `perm` (for notification routing). */
export function rolesWithPermission(perm) {
  const out = [];
  for (const [key, set] of cache) if (set.has(perm)) out.push(key);
  return out;
}

export function sanitizePermissions(perms) {
  if (!Array.isArray(perms)) return [];
  const valid = new Set(ALL_PERMISSION_KEYS);
  return [...new Set(perms.filter((p) => valid.has(p)))];
}

/**
 * One-time, idempotent data migrations for roles already seeded in the DB.
 * Guarded by Setting.rolesSchemaVersion so it runs once and respects later
 * admin edits. Call after ensureSystemRoles(), before loadRoles().
 */
export async function runRoleMigrations() {
  const setting = await Setting.getSingleton();
  const version = setting.rolesSchemaVersion || 1;
  if (version >= 2) return 0;

  // ── v2: self-service split + drop the Accountant role ──────────────
  // Leadership no longer self-tracks attendance/leave.
  await Role.updateMany(
    { key: { $in: ['CEO', 'DIRECTOR'] } },
    { $pull: { permissions: { $in: ['markAttendance', 'applyLeave'] } } },
  );
  // Everyone else explicitly gets self-service (it used to be implicit/base).
  await Role.updateMany(
    { key: { $nin: ['CEO', 'DIRECTOR', 'ACCOUNTANT'] } },
    { $addToSet: { permissions: { $each: ['markAttendance', 'applyLeave'] } } },
  );
  // Remove the Accountant role — move any holders to Employee first.
  const accountant = await Role.findOne({ key: 'ACCOUNTANT' });
  if (accountant) {
    await User.updateMany({ role: 'ACCOUNTANT' }, { $set: { role: 'EMPLOYEE' } });
    await accountant.deleteOne();
  }

  setting.rolesSchemaVersion = 2;
  await setting.save();
  return 1;
}
