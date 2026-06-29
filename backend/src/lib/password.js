import bcrypt from 'bcryptjs';

const ROUNDS = 12; // cost >= 10 per security baseline

export async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}
