import mongoose from 'mongoose';

function isNoTransactionSupport(err) {
  const msg = String(err?.message || '');
  return (
    [20, 251, 263].includes(err?.code) ||
    /Transaction numbers are only allowed on a replica set|replica set member or mongos|Transactions are not supported/i.test(msg)
  );
}

/**
 * Runs `fn(session)` inside a transaction when the deployment supports it
 * (replica set / Atlas), otherwise falls back to running `fn(null)` without a
 * session (careful sequencing). All DB ops should accept and pass the session.
 */
export async function runTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (isNoTransactionSupport(err)) {
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
