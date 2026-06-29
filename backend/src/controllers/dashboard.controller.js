import { ok } from '../lib/apiResponse.js';
import { buildDashboard } from '../services/dashboard.service.js';

export async function dashboard(req, res, next) {
  try {
    res.json(ok(await buildDashboard(req.user)));
  } catch (err) {
    next(err);
  }
}
