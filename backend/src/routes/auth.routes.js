import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';
import {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  ackReleasesSchema,
} from '../validators/auth.validators.js';
import {
  login,
  logout,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
  updateProfile,
  ackReleases,
} from '../controllers/auth.controller.js';

export const authRouter = express.Router();

authRouter.post('/login', authLimiter, validate(loginSchema), login);
authRouter.post('/logout', logout);
authRouter.get('/me', requireAuth, me);
authRouter.patch('/profile', requireAuth, validate(updateProfileSchema), updateProfile);
// "What's new" padh liya — koi permission nahi, har banda apne hi liye likhta hai.
authRouter.post('/releases/ack', requireAuth, validate(ackReleasesSchema), ackReleases);
authRouter.post('/change-password', requireAuth, validate(changePasswordSchema), changePassword);
// Both of these send or consume a reset mail — kept on the tighter ceiling.
authRouter.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema), forgotPassword);
authRouter.post('/reset-password', passwordResetLimiter, validate(resetPasswordSchema), resetPassword);
