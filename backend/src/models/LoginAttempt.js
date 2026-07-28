import mongoose from 'mongoose';

/**
 * Failed sign-in attempts per account.
 *
 * The IP limiter in front of this can't carry the load on its own: every instance
 * keeps its own counter (so the cap is multiplied by however many are warm, and a cold
 * start clears it), the whole office shares one public IP behind the same bucket, and
 * an attacker changing address gets a fresh allowance each time. Counting per ACCOUNT
 * in the database fixes all three — it's shared across instances, it can't be dodged
 * by moving IP, and one person mistyping their password can't lock out the office.
 *
 * Rows are keyed by email so an attempt against an address that doesn't exist is
 * counted the same way, and nothing here reveals whether the account is real.
 */
const loginAttemptSchema = new mongoose.Schema(
  {
    // "<email>|<address>" — a run is counted per account AND per source, so a stranger
    // guessing at somebody's address can never lock that person out of their own.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    fails: { type: Number, default: 0 },
    firstFailAt: { type: Date, default: Date.now },
    lockedUntil: { type: Date, default: null },
    lastIp: { type: String, default: '' },
  },
  { timestamps: true },
);

// Housekeeping: a row nobody has touched for a day is spent and can go.
loginAttemptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86400 });

export const LoginAttempt =
  mongoose.models.LoginAttempt || mongoose.model('LoginAttempt', loginAttemptSchema);
