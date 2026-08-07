import { ok, fail } from '../lib/apiResponse.js';
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
    // A shaped-but-nonsense month ('9999-99') used to sail through into NaN date math and
    // return a 200 with a garbage window — reject it before the service sees it.
    const { month } = req.query;
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
      return res.status(400).json(fail('BAD_MONTH', 'month must be YYYY-MM'));
    }
    res.json(ok(await leadersForPeriod({ scope: req.query.scope, month })));
  } catch (err) {
    next(err);
  }
}
