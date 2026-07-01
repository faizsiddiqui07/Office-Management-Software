import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { PasswordResetToken } from '../models/PasswordResetToken.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { setAuthCookie, clearAuthCookie } from '../lib/cookies.js';
import { ok, fail } from '../lib/apiResponse.js';
import { sendPasswordResetEmail } from '../lib/mailer.js';
import { audit } from '../models/AuditLog.js';
import { permissionsForRole, roleLabel } from '../lib/roles.js';

/** User JSON + their effective permission keys (for the cosmetic client `can()`). */
function userWithPermissions(user) {
  return { ...user.toJSON(), permissions: permissionsForRole(user.role), roleLabel: roleLabel(user.role) };
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

    const invalid = () => res.status(401).json(fail('INVALID_CREDENTIALS', 'Invalid email or password'));
    if (!user || !user.isActive) return invalid();

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) return invalid();

    const token = signToken({ sub: user._id.toString(), role: user.role });
    setAuthCookie(res, token); // local/same-origin still uses the cookie
    await audit({ actor: user._id, action: 'auth.login', entityType: 'User', entityId: user._id.toString() });

    // `token` is also returned so cross-domain clients (frontend ↔ Lambda) can
    // store it and send it as `Authorization: Bearer <token>`.
    return res.json(ok({ user: userWithPermissions(user), token }));
  } catch (err) {
    return next(err);
  }
}

export function logout(_req, res) {
  clearAuthCookie(res);
  res.json(ok({ success: true }));
}

export function me(req, res) {
  res.json(ok({ user: userWithPermissions(req.user) }));
}

export async function updateProfile(req, res, next) {
  try {
    const { name, phone, avatarUrl } = req.body;
    const user = await User.findById(req.user._id);
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
    await user.save();
    await audit({ actor: user._id, action: 'auth.update_profile', entityType: 'User', entityId: user._id.toString() });
    return res.json(ok({ user: user.toJSON() }));
  } catch (err) {
    return next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select('+passwordHash');
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json(fail('INVALID_CURRENT_PASSWORD', 'Your current password is incorrect'));
    }
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();
    await audit({ actor: user._id, action: 'auth.change_password', entityType: 'User', entityId: user._id.toString() });
    return res.json(ok({ user: user.toJSON() }));
  } catch (err) {
    return next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    // Always respond success — never reveal whether an email exists.
    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // ~30 minutes

      await PasswordResetToken.updateMany({ user: user._id, usedAt: null }, { usedAt: new Date() });
      await PasswordResetToken.create({ user: user._id, tokenHash, expiresAt });

      const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
      const resetUrl = `${clientUrl}/reset-password/${rawToken}`;
      const settings = await Setting.getSingleton().catch(() => null);
      await sendPasswordResetEmail(user.email, resetUrl, settings?.companyName);
      await audit({ actor: user._id, action: 'auth.forgot_password', entityType: 'User', entityId: user._id.toString() });
    }

    return res.json(ok({ message: 'If that email exists, a reset link has been sent.' }));
  } catch (err) {
    return next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await PasswordResetToken.findOne({ tokenHash, usedAt: null });

    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json(fail('INVALID_TOKEN', 'This reset link is invalid or has expired'));
    }

    const user = await User.findById(record.user).select('+passwordHash');
    if (!user) return res.status(400).json(fail('INVALID_TOKEN', 'This reset link is invalid'));

    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await user.save();

    record.usedAt = new Date();
    await record.save();

    await audit({ actor: user._id, action: 'auth.reset_password', entityType: 'User', entityId: user._id.toString() });
    return res.json(ok({ message: 'Password reset. You can now sign in.' }));
  } catch (err) {
    return next(err);
  }
}
