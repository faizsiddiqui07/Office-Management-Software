import { ok } from '../lib/apiResponse.js';
import { userWithPermissions } from './auth.controller.js';
import { settingsPayload, brandingPayload } from './settings.controller.js';
import { eodDigestPayload } from './tasks.controller.js';
import { getBadges } from '../services/badges.service.js';
import { Notification } from '../models/Notification.js';
import { unreadTotal } from '../services/chat.service.js';
import { issueTicket, TICKET_TTL_SECONDS } from '../lib/chatTicket.js';
import { realtimeEnabled } from '../services/chatRealtime.service.js';
import * as bonus from '../services/bonus.service.js';
import * as holidays from '../services/holiday.service.js';
import * as announcements from '../services/announcement.service.js';
import { listHolidaysQuerySchema } from '../validators/holidays.validators.js';
import { ymdInTz } from '../lib/time.js';
import { isOwnerRole } from '../lib/roles.js';

/**
 * GET /api/bootstrap — app khulte hi jo 11 alag-alag requests jaati thiN, wo sab EK me.
 *
 * Kyun: Lambda ka ek container ek waqt me ek hi request leta hai. App khulte hi 11
 * requests ek saath nikalti thiN → API Gateway 11 container uthata tha → subah (jab sab
 * thande hote hain) har ek apna 3-4 second ka cold start karta tha. Ek request = ek
 * container = ek cold start. Baaki sab andar Promise.all se parallel, ek hi DB connection.
 *
 * Har hissa THEEK wahi shape lautata hai jo uska apna endpoint lautata hai — frontend
 * bas react-query ke cache me har key par bitha deta hai, hooks ko pata bhi nahi chalta.
 * Koi ek hissa gire to sirf wo `null` (client us key ko phir apne endpoint se maang leta
 * hai); poori response nahi girti. `user` zaroori hai — wo requireAuth se aa hi chuka hai.
 *
 * Purane endpoints jyon ke tyon hain: polling, invalidate, aur purana client sab unhi
 * par chalte rehte hain.
 */
export async function bootstrap(req, res, next) {
  try {
    const user = req.user;
    const today = ymdInTz(new Date());

    // Ek hissa gire to `null`; error log me, response me nahi.
    const part = (name, fn) =>
      Promise.resolve()
        .then(fn)
        .catch((err) => {
          console.error(`bootstrap: ${name} failed`, err?.message || err);
          return null;
        });

    const [
      settings,
      branding,
      badges,
      notifications,
      chatUnread,
      bonusMe,
      holidaysToday,
      announcementsUnseen,
      eodDigest,
    ] = await Promise.all([
      part('settings', async () => ({ settings: await settingsPayload() })),
      part('branding', async () => ({ branding: await brandingPayload() })),
      part('badges', () => getBadges(user)),
      part('notifications', async () => {
        const rows = await Notification.find({ user: user._id }).sort({ createdAt: -1 }).limit(50);
        const unread = await Notification.countDocuments({ user: user._id, isRead: false });
        return { notifications: rows.map((n) => n.toJSON()), unread };
      }),
      part('chatUnread', async () => ({ unread: await unreadTotal(user._id) })),
      part('bonusMe', () => bonus.mySummary(user, {})),
      part('holidaysToday', async () => ({
        holidays: await holidays.listHolidays(listHolidaysQuerySchema.parse({ from: today, to: today })),
      })),
      part('announcementsUnseen', async () => ({ announcements: await announcements.activeUnseen(user) })),
      // Sirf malik (CEO & President) ke liye — baaki ke liye hissa hai hi nahi.
      isOwnerRole(user.role) ? part('eodDigest', () => eodDigestPayload()) : Promise.resolve(undefined),
    ]);

    // Ticket sasta hai (HMAC, koi DB nahi) — sync, Promise.all ke bahar.
    const wsTicket = {
      ticket: issueTicket(user._id),
      expiresIn: TICKET_TTL_SECONDS,
      url: process.env.CHAT_WS_URL || '',
      enabled: !!process.env.CHAT_WS_URL && realtimeEnabled(),
    };

    return res.json(
      ok({
        user: userWithPermissions(user),
        today, // client isi din ke liye holidays/eod-digest ko cache karta hai
        settings,
        branding,
        badges,
        notifications,
        chatUnread,
        wsTicket,
        bonusMe,
        holidaysToday,
        announcementsUnseen,
        ...(eodDigest !== undefined ? { eodDigest } : {}),
      }),
    );
  } catch (err) {
    return next(err);
  }
}
