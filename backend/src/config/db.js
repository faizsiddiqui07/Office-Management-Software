import mongoose from 'mongoose';

/**
 * Cached Mongoose connection. Survives dev hot-reloads (node --watch) by
 * stashing the connection on the global object so we never open duplicate pools.
 */
const globalForMongoose = globalThis;
const cached =
  globalForMongoose._mongoose ?? (globalForMongoose._mongoose = { conn: null, promise: null });

export async function connectDB() {
  if (cached.conn) return cached.conn;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  if (!cached.promise) {
    mongoose.set('strictQuery', true);
    cached.promise = mongoose
      .connect(uri, { dbName: process.env.MONGODB_DB || 'office_management' })
      .then((m) => {
        console.log('🍃 MongoDB connected');
        return m;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export async function disconnectDB() {
  if (cached.conn) {
    await cached.conn.disconnect();
    cached.conn = null;
    cached.promise = null;
  }
}
