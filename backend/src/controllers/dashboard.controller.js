import { ok } from '../lib/apiResponse.js';
import { buildDashboard, leadersForPeriod } from '../services/dashboard.service.js';

export async function dashboard(req, res, next) {
  try {
    res.json(ok(await buildDashboard(req.user)));
  } catch (err) {
    next(err);
  }
}

/** Task + overtime leaders for a chosen period (this month / a past month / all time). */
export async function leaders(req, res, next) {
  try {
    res.json(ok(await leadersForPeriod({ scope: req.query.scope, month: req.query.month })));
  } catch (err) {
    next(err);
  }
}
