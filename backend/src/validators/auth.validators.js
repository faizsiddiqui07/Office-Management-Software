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
  // Accepts a normal URL or a small base64 data-URL (photos are downscaled
  // client-side to ~256px, same store-in-Mongo pattern as the company logos).
  avatarUrl: z.string().max(200000).optional().or(z.literal('')),
});
