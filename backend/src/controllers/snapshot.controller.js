import { ok, fail } from '../lib/apiResponse.js';
import { mySnapshot } from '../services/snapshot.service.js';

const TYPES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
const isYMD = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Your own standing, for a period you pick. Always your own — never anybody else's. */
export async function mine(req, res, next) {
  try {
    const type = TYPES.includes(req.query.type) ? req.query.type : 'monthly';
    const dateYMD = isYMD(req.query.date) ? req.query.date : undefined;
    const range = { from: isYMD(req.query.from) ? req.query.from : undefined, to: isYMD(req.query.to) ? req.query.to : undefined };
    if (type === 'custom' && !range.from && !range.to) {
      return res.status(400).json(fail('BAD_RANGE', 'A custom period needs a date range'));
    }
    res.json(ok(await mySnapshot(req.user, { type, dateYMD, range })));
  } catch (err) {
    next(err);
  }
}
