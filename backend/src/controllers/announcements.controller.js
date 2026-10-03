import { ok, fail } from '../lib/apiResponse.js';
import { createAnnouncementSchema, updateAnnouncementSchema } from '../validators/announcements.validators.js';
import * as svc from '../services/announcement.service.js';
import { audit } from '../models/AuditLog.js';
import { describeRule } from '../lib/recurrence.js';

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
      meta: { title: announcement.title, priority: announcement.priority, ...(describeRule(announcement.recurrence) ? { repeats: describeRule(announcement.recurrence) } : {}) },
    });
    res.status(201).json(ok({ announcement }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

/** The people a poster can address an announcement to — for the audience picker. */
export async function audiencePeople(_req, res, next) {
  try {
    return res.json(ok(await svc.audiencePeople()));
  } catch (err) {
    return next(err);
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

/** Author-only: who has / hasn't seen this announcement yet. */
export async function reads(req, res, next) {
  try {
    res.json(ok(await svc.readReceipts(req.params.id)));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function update(req, res, next) {
  try {
    const body = updateAnnouncementSchema.parse(req.body);
    const announcement = await svc.updateAnnouncement(req.params.id, body);
    await audit({
      actor: req.user._id,
      action: 'announcement.update',
      entityType: 'Announcement',
      entityId: req.params.id,
      meta: { title: announcement.title, fields: Object.keys(body), ...(body.recurrence ? { repeats: describeRule(announcement.recurrence) || 'stopped' } : {}) },
    });
    res.json(ok({ announcement }));
  } catch (err) {
    handleErr(res, err, next);
  }
}

export async function retire(req, res, next) {
  try {
    const result = await svc.deleteAnnouncement(req.params.id);
    // The row is gone for good, so what it was lives here instead — the Activity log is now
    // the only place that remembers this announcement existed.
    await audit({
      actor: req.user._id,
      action: 'announcement.delete',
      entityType: 'Announcement',
      entityId: req.params.id,
      meta: { title: result.title, readsRemoved: result.readsRemoved },
    });
    res.json(ok({ success: true }));
  } catch (err) {
    handleErr(res, err, next);
  }
}
