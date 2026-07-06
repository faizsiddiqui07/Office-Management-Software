import { ok, fail } from '../lib/apiResponse.js';
import * as svc from '../services/bonus.service.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

/** The signed-in user's own points (header badge + their rewards page). */
export async function me(req, res, next) {
  try {
    // Opportunistic: apply any overdue-task penalties (throttled to once a day).
    try { await svc.maybeRunDaily(); } catch { /* non-blocking */ }
    res.json(ok(await svc.mySummary(req.user, req.query.month)));
  } catch (err) {
    next(err);
  }
}

/** Recent manual awards, so leadership can review and (CEO/President) undo them. */
export async function awards(_req, res, next) {
  try {
    res.json(ok({ awards: await svc.recentAwards() }));
  } catch (err) {
    next(err);
  }
}

/** The public "price list" — what each action is worth + ₹/point. */
export async function guide(_req, res, next) {
  try {
    res.json(ok(await svc.guide()));
  } catch (err) {
    next(err);
  }
}

/** Full config for the leadership editor. */
export async function getConfig(_req, res, next) {
  try {
    res.json(ok(await svc.getConfig()));
  } catch (err) {
    next(err);
  }
}

export async function updateConfig(req, res, next) {
  try {
    const cfg = await svc.updateConfig(req.body || {});
    await audit({ actor: req.user._id, action: 'bonus.config', entityType: 'Bonus', entityId: 'config' });
    res.json(ok(cfg));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function award(req, res, next) {
  try {
    const entry = await svc.awardManual(req.user, req.body || {});
    await audit({ actor: req.user._id, action: 'bonus.award', entityType: 'User', entityId: String(req.body?.userId), meta: { points: entry.points, reason: entry.reason } });
    res.status(201).json(ok({ entry }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function removeEntry(req, res, next) {
  try {
    await svc.removeEntry(req.user, req.params.id);
    await audit({ actor: req.user._id, action: 'bonus.entry_delete', entityType: 'Bonus', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function leaderboard(req, res, next) {
  try {
    res.json(ok({ month: req.query.month || svc.currentMonth(), rows: await svc.leaderboard(req.query.month) }));
  } catch (err) {
    next(err);
  }
}
