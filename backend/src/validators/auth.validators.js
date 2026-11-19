import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Invalid token'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional().or(z.literal('')),
  // Date of birth (YYYY-MM-DD, company TZ); '' clears it. Kept in sync with the person's
  // BIRTHDAY calendar entry. Not-in-the-future is checked in the controller.
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').optional().or(z.literal('')),
  // Accepts a normal URL or a small base64 data-URL (photos are downscaled
  // client-side to ~256px, same store-in-Mongo pattern as the company logos).
  avatarUrl: z.string().max(200000).optional().or(z.literal('')),
  // Profile-photo modal par "Skip for now" — server par tareekh darj hoti hai.
  skipAvatarPrompt: z.boolean().optional(),
});

/** "What's new" ka modal band karte waqt: kaun-kaun si update padh li. */
export const ackReleasesSchema = z.object({
  // 20 se zyada ek baar me kabhi nahi — modal sirf un-padhi updates dikhata hai. Id ka
  // roop frontend tay karta hai (`2026-11-19-reminders`), isliye yahan sirf hadd hai.
  ids: z.array(z.string().min(1).max(80)).min(1).max(20),
});
