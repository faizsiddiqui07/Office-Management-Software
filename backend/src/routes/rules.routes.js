import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { list, createSection, updateSection, removeSection, addRule, updateRule, removeRule, requireOwner } from '../controllers/rules.controller.js';

export const rulesRouter = express.Router();

rulesRouter.use(requireAuth);

rulesRouter.get('/', list); // everyone reads the rule book
// Changing it is the owner tier's alone (CEO & President).
rulesRouter.post('/sections', requireOwner, createSection);
rulesRouter.patch('/sections/:id', requireOwner, updateSection);
rulesRouter.delete('/sections/:id', requireOwner, removeSection);
rulesRouter.post('/sections/:id/rules', requireOwner, addRule);
rulesRouter.patch('/sections/:id/rules/:ruleId', requireOwner, updateRule);
rulesRouter.delete('/sections/:id/rules/:ruleId', requireOwner, removeRule);
