import { Role } from '../models/Role.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { SYSTEM_ROLES, ALL_PERMISSION_KEYS } from './permissionCatalog.js';

// In-memory cache: roleKey -> Set(permissionKeys). Kept in sync on every mutation.
let cache = new Map();
// roleKey -> human label, kept in sync alongside the permission cache.
let labels = new Map();
// roleKey -> rank (lower = more authority). Used for role-assignment hierarchy.
let ranks = new Map();
// roleKey -> [roleKeys] this role may delegate tasks to ([] = rank-hierarchy default).
let assignTargets = new Map();

/**
 * Seed the built-in roles — but ONLY when the roles collection is completely
 * empty (a brand-new database, or a full wipe). Once the admin has any role at
 * all, we never re-create previously-deleted built-ins, so a custom role setup
 * (e.g. a single owner role) sticks and deletions are respected. Never overwrites
 * an existing role's edits. Returns the number of roles seeded.
 */
export async function ensureSystemRoles() {
  const count = await Role.countDocuments();
  if (count > 0) return 0;

  for (const r of SYSTEM_ROLES) {
    await Role.updateOne(
      { key: r.key },
      { $setOnInsert: { key: r.key, label: r.label, permissions: r.permissions, isSystem: true, rank: r.rank } },
      { upsert: true },
    );
  }
  return SYSTEM_ROLES.length;
}

/**
 * Failsafe against a permanent admin lockout. Creating or editing roles itself
 * requires the `manageRoles` permission — so if the top-tier (owner) role is ever
 * left without it (a manual DB edit, or a hand-built leadership role that forgot
 * to tick it), that owner can NEVER fix it through the app again, because the role
 * editor is itself gated on `manageRoles`.
 *
 * On every boot we guarantee that every role in the highest-authority tier (the
 * lowest `rank` value present) holds `manageRoles`, restoring the canonical
 * leadership permission set (includes manageRoles, excludes self-service) onto any
 * top-tier role missing it. Re-seeds the built-ins if the collection is empty. It
 * only rewrites a role that is already in the broken state, so in normal operation
 * it's a no-op. Returns 1 if it had to repair, 0 otherwise.
 */
export async function ensureRoleManagerExists() {
  const roles = await Role.find();
  if (roles.length === 0) {
    // Empty collection — re-seed the built-ins (the CEO role includes manageRoles).
    await ensureSystemRoles();
    console.warn('🛟 No roles found — re-seeded the built-in roles so an admin can manage roles.');
    return 1;
  }

  const minRank = Math.min(...roles.map((r) => (typeof r.rank === 'number' ? r.rank : 100)));
  const leadershipPerms = SYSTEM_ROLES.find((r) => r.key === 'CEO')?.permissions ?? ALL_PERMISSION_KEYS;
  let repaired = 0;
  for (const r of roles) {
    if (r.rank === minRank && !r.permissions.includes('manageRoles')) {
      r.permissions = [...new Set(leadershipPerms)];
      await r.save();
      console.warn(`🛟 Top-tier role "${r.key}" (${r.label}) could not manage roles — restored the leadership permission set.`);
      repaired = 1;
    }
  }
  return repaired;
}

/** (Re)load all roles into the in-memory cache. */
export async function loadRoles() {
  const docs = await Role.find();
  const map = new Map();
  const lbl = new Map();
  const rnk = new Map();
  const tgt = new Map();
  for (const r of docs) {
    map.set(r.key, new Set(r.permissions));
    lbl.set(r.key, r.label);
    rnk.set(r.key, typeof r.rank === 'number' ? r.rank : 100);
    tgt.set(r.key, Array.isArray(r.taskAssignRoles) ? [...r.taskAssignRoles] : []);
  }
  cache = map;
  labels = lbl;
  ranks = rnk;
  assignTargets = tgt;
  return cache.size;
}

/**
 * Role keys this role may delegate tasks to. An EMPTY array means "not
 * configured" → callers fall back to the rank hierarchy (anyone strictly below).
 */
export function getTaskAssignRoles(roleKey) {
  return assignTargets.get(roleKey) || [];
}

export function getRolePermissionSet(roleKey) {
  return cache.get(roleKey) || null;
}

/** Rank of a role (lower = more authority), or null if the role isn't cached. */
export function getRoleRank(roleKey) {
  return ranks.has(roleKey) ? ranks.get(roleKey) : null;
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
