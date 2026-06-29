import { ok, fail } from '../lib/apiResponse.js';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../validators/announcements.validators.js';
import * as svc from '../services/announcement.service.js';
import { audit } from '../models/AuditLog.js';

function handleErr(res, err, next) {
  if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
  return next(err);
}

export async function list(req, res, next) {
  try {
    res.json(ok({ announcements: await svc.listVisible(req.user) }));
  } catch (err) {
    next(err);
  }
}

export async function activeUnseen(req, res, next) {
  try {
    res.json(ok({ announcements: await svc.activeUnseen(req.user) }));
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const body = createAnnouncementSchema.parse(req.body);
    const announcement = await svc.createAnnouncement(req.user, body);
    await audit({
      actor: req.user._id,
      action: 'announcement.create',
      entityType: 'Announcement',
      entityId: announcement.id,
      meta: { priority: announcement.priority },
    });
    res.status(201).json(ok({ announcement }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function read(req, res, next) {
  try {
    await svc.markRead(req.user, req.params.id);
    res.json(ok({ success: true }));
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateAnnouncementSchema.parse(req.body);
    const announcement = await svc.updateAnnouncement(req.params.id, body);
    await audit({ actor: req.user._id, action: 'announcement.update', entityType: 'Announcement', entityId: req.params.id });
    res.json(ok({ announcement }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function retire(req, res, next) {
  try {
    await svc.retireAnnouncement(req.params.id);
    await audit({ actor: req.user._id, action: 'announcement.retire', entityType: 'Announcement', entityId: req.params.id });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
