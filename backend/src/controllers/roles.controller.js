import { z } from 'zod';
import { ok, fail } from '../lib/apiResponse.js';
import { Role } from '../models/Role.js';
import { User } from '../models/User.js';
import { PERMISSION_CATALOG, BASE_PERMISSIONS } from '../lib/permissionCatalog.js';
import { loadRoles, sanitizePermissions } from '../lib/roles.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

function slugify(label) {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

const createSchema = z.object({
  label: z.string().min(1).max(40),
  permissions: z.array(z.string()).optional().default([]),
});
const updateSchema = z.object({
  label: z.string().min(1).max(40).optional(),
  permissions: z.array(z.string()).optional(),
});

/** The permission catalog (for the editor UI). */
export function catalog(_req, res) {
  res.json(ok({ catalog: PERMISSION_CATALOG, base: BASE_PERMISSIONS }));
}

/** Lightweight role list (key + label) — for the user role dropdown. */
export async function options(_req, res, next) {
  try {
    const roles = await Role.find().select('key label rank').sort({ rank: 1, label: 1 });
    res.json(ok({ roles: roles.map((r) => ({ key: r.key, label: r.label })) }));
  } catch (err) {
    next(err);
  }
}

/** Full role list with permissions + how many users hold each. */
export async function list(_req, res, next) {
  try {
    const roles = await Role.find().sort({ rank: 1, label: 1 });
    const counts = await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
    const countMap = new Map(counts.map((c) => [c._id, c.n]));
    res.json(ok({ roles: roles.map((r) => ({ ...r.toJSON(), userCount: countMap.get(r.key) || 0 })) }));
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body);
    const key = slugify(body.label);
    if (!key) return res.status(400).json(fail('INVALID', 'Enter a valid role name'));
    if (await Role.findOne({ key })) return res.status(409).json(fail('DUPLICATE', 'A role with that name already exists'));

    const role = await Role.create({
      key,
      label: body.label.trim(),
      permissions: sanitizePermissions(body.permissions),
      isSystem: false,
      rank: 100,
    });
    await loadRoles();
    await audit({ actor: req.user._id, action: 'role.create', entityType: 'Role', entityId: role.id, meta: { key } });
    res.status(201).json(ok({ role: role.toJSON() }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body);
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json(fail('NOT_FOUND', 'Role not found'));

    if (body.permissions !== undefined) {
      const next = sanitizePermissions(body.permissions);
      // Safety: never leave the system with no role that can manage roles.
      if (role.permissions.includes('manageRoles') && !next.includes('manageRoles')) {
        const others = await Role.countDocuments({ _id: { $ne: role._id }, permissions: 'manageRoles' });
        if (others === 0) return res.status(400).json(fail('LOCKOUT', 'At least one role must keep “Manage roles & permissions”'));
      }
      role.permissions = next;
    }
    if (body.label !== undefined && !role.isSystem) role.label = body.label.trim();

    await role.save();
    await loadRoles();
    await audit({ actor: req.user._id, action: 'role.update', entityType: 'Role', entityId: role.id });
    res.json(ok({ role: role.toJSON() }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function remove(req, res, next) {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json(fail('NOT_FOUND', 'Role not found'));
    if (role.isSystem) return res.status(400).json(fail('SYSTEM_ROLE', 'Built-in roles can’t be deleted'));
    const inUse = await User.countDocuments({ role: role.key });
    if (inUse > 0) return res.status(409).json(fail('IN_USE', `${inUse} user(s) still have this role — reassign them first`));

    await role.deleteOne();
    await loadRoles();
    await audit({ actor: req.user._id, action: 'role.delete', entityType: 'Role', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
