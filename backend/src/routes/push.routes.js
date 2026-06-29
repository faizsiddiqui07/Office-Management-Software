import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { publicKey, subscribe, unsubscribe } from '../controllers/push.controller.js';

export const pushRouter = express.Router();

pushRouter.use(requireAuth);
pushRouter.get('/public-key', publicKey);
pushRouter.post('/subscribe', subscribe);
pushRouter.post('/unsubscribe', unsubscribe);
