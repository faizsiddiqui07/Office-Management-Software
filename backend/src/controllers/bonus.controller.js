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
    // NOTE: the daily jobs (overdue penalties, re-score, rollups) run on the EventBridge
    // schedule (runScheduledJobs → maybeRunDaily), NOT here. This endpoint is hit by the
    // header points-badge on EVERY page, so running maybeRunDaily inline made every page
    // wait for it — and once the re-score got heavy that stalled the whole app. Keep this
    // path to just reading the user's points.
    const { month, from, to } = req.query || {};
    res.json(ok(await svc.mySummary(req.user, { month, from, to })));
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
    const before = await svc.getConfig();
    const cfg = await svc.updateConfig(req.body || {}, req.user._id);
    // Rule values decide what people are paid, so the change itself is the record —
    // "config was edited" alone left no way to see what moved.
    await audit({
      actor: req.user._id,
      action: 'bonus.config',
      entityType: 'Bonus',
      entityId: 'config',
      meta: {
        before: { graceDays: before.graceDays, rules: before.autoRules },
        after: { graceDays: cfg.graceDays, rules: cfg.autoRules },
      },
    });
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

/**
 * Score a past month on purpose — for a month that had already gone by when the point
 * values were entered, so the automatic scans never touched it.
 */
export async function backfill(req, res, next) {
  try {
    const result = await svc.backfillMonth(req.body?.month);
    await audit({ actor: req.user._id, action: 'bonus.backfill', entityType: 'Bonus', entityId: result.month, meta: result });
    res.json(ok(result));
  } catch (err) {
    handleErr(res, err, next);
  }
}

/**
 * Force a full re-score now — the same work the nightly scheduler does, but on demand
 * and bypassing the once-a-day throttle. Idempotent: it re-syncs points with the task /
 * attendance tables, it does not double-count. Leadership-only (manageSettings).
 */
export async function recalculate(req, res, next) {
  try {
    await svc.maybeRunDaily(true);
    await audit({ actor: req.user._id, action: 'bonus.recalculate', entityType: 'Bonus', entityId: 'manual' });
    return res.json(ok({ done: true }));
  } catch (err) {
    return next(err);
  }
}

/**
 * What a full recalculation WOULD change, per person — a pure read, nothing is written.
 * The owner sees this before they confirm, so the Apply that follows holds no surprises.
 */
export async function rebuildPreview(req, res, next) {
  try {
    return res.json(ok(await svc.previewRebuild(req.user)));
  } catch (err) {
    return handleErr(res, err, next);
  }
}

/**
 * Apply it. `planHash` comes from the preview the owner actually looked at: if anything has
 * changed since (somebody checked in, a leave was approved), this refuses with 409 rather
 * than quietly applying a different set of numbers from the ones that were approved.
 */
export async function rebuildApply(req, res, next) {
  try {
    const result = await svc.runRebuild(req.user, { planHash: req.body?.planHash || null });
    await audit({
      actor: req.user._id,
      action: 'bonus.rebuild',
      entityType: 'Bonus',
      entityId: 'rebuild',
      // The whole diff, so the Activity log answers "who moved whose points, and why"
      // months later without anyone having to re-derive it.
      meta: {
        movedCount: result.movedCount,
        datesOnlyCount: result.datesOnlyCount,
        totalDelta: result.totalDelta,
        verified: result.verified,
        months: result.months,
        people: result.rows.map((r) => ({ name: r.name, before: r.before, after: r.after, delta: r.delta, changes: r.changes })),
      },
    });
    return res.json(ok(result));
  } catch (err) {
    return handleErr(res, err, next);
  }
}

export async function leaderboard(req, res, next) {
  try {
    const { month, from, to } = req.query || {};
    res.json(ok({ month: month || svc.currentMonth(), from, to, rows: await svc.leaderboard({ month, from, to }) }));
  } catch (err) {
    next(err);
  }
}

/** One person's breakdown for a period — the leadership drill-down from the leaderboard. */
export async function userSummary(req, res, next) {
  try {
    const { month, from, to } = req.query || {};
    res.json(ok(await svc.userSummary(req.params.id, { month, from, to })));
  } catch (err) {
    handleErr(res, err, next);
  }
}
