import { ok } from '../lib/apiResponse.js';
import * as svc from '../services/approvals.service.js';

/**
 * The approvals inbox is READ-ONLY on purpose. Deciding still goes to the endpoint
 * that owns each kind — see approvals.service.js — so there is exactly one place
 * where a leave is approved, and this page is not it.
 */

export async function pending(req, res, next) {
  try {
    res.json(ok(await svc.pendingFor(req.user)));
  } catch (err) {
    next(err);
  }
}

export async function history(req, res, next) {
  try {
    const days = Number(req.query.days) || 30;
    res.json(ok(await svc.historyFor(req.user, days)));
  } catch (err) {
    next(err);
  }
}

export async function count(req, res, next) {
  try {
    res.json(ok(await svc.pendingCount(req.user)));
  } catch (err) {
    next(err);
  }
}
