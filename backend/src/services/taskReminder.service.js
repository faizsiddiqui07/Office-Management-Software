import { formatInTimeZone } from 'date-fns-tz';
import { Setting } from '../models/Setting.js';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { claimNudge } from '../models/NudgeLog.js';
import { COMPANY_TZ, ymdInTz, dayInWords } from '../lib/time.js';
import { approverIdsFor, chainOwnersOf } from '../lib/taskApprovers.js';
import { addDays, graceDaysOn, overdueDayFor, taskBonusPreview } from './bonus.service.js';
import { taskNews, todoLink, taggedLink } from './task.service.js';

/**
 * DEADLINE KI GHANTI — kaam karne wale ko, aur kaam dene wale ko (idea I139, owner ka
 * faisla 19 Nov 2026).
 *
 * Pehle task ke liye EK BHI reminder nahi tha — scheduler me task ka koi job hi nahi tha.
 * Due date nikal jaati, aadhi raat ka scan −5 ka mark lagata, phir har working day −1
 * chupchaap jodta rehta. Audit 13 (F1) me ek task akela −29 tak pahuncha tha, aur bande ko
 * mahine ke aakhir me Rewards kholne par pata chalta tha. Dene wale ko bhi pata nahi
 * chalta ki kaam latak gaya hai.
 *
 * TEEN MOKE (owner ne points ke number ke saath chuna):
 *   1. Due se EK DIN PEHLE, shaam 17:00 — karne wale ko: "Due tomorrow · +10 if done on time"
 *   2. Jis din overdue hota hai, subah 10:00 —
 *        karne wale ko: "−5 applied · −1 each working day until it's done"
 *        dene wale ko + tagged logon ko: "<naam>: overdue since yesterday"
 *   3. Phir HAR TEESRE din, dene wale ko jodi hui keemat: "still not done · −7 so far"
 *
 * KYUN 10:00, aadhi raat nahi: −5 ka mark `maybeRunDaily` ke daily block me din ke PEHLE
 * tick par likha jaata hai, yaani ~00:05 par. Us waqt push bhejna matlab sote hue bande ko
 * jagaana. Isliye reminder ka apna time-gate hai; mark aur ghanti ka waqt alag hai.
 *
 * GINTI KAHAN SE: har number `taskBonusPreview()` se aata hai, jo LEDGER padhta hai — na
 * andaza, na dobara likha hua hisaab. Aur eligibility ka sawaal wahi hai jo penalty poochhti
 * hai (chainEligible, bonus.service se). Natija: jis task par points lagte hi nahi (personal
 * kaam, ya owner-tier ka tag nahi, ya due date nahi) uspar sirf YAAD jaati hai — points ki
 * line nahi, kyunki wahan kuch kat raha hi nahi.
 *
 * SUBMIT KAR CHUKE BANDE KO "submit karo" NAHI: approval wale task me owner ka niyam hai ki
 * drip APPROVAL tak chalta rehta hai (audit F2 — deri approver ki, minus karne wale ka).
 * To aise task par karne wale ko sach bataya jaata hai ("waiting for approval — the daily
 * cut continues") aur ASLI kaam approvers ko bheja jaata hai. Use "submit now" bolna jhooth
 * hota, kyunki wo apna hissa kar chuka hai.
 *
 * PUSH TAG 'TaskDue:<id>' — 'Task:<id>' NAHI. notify() tag entityType:entityId se banata
 * hai, aur 'Task:<id>' pehle se TASK_APPROVAL aur TASK_BATCH_PENDING use karte hain. Wahi
 * tag dobara use karte to reminder dene wale ke phone se "approve this" wala banner HATA
 * deta. Alag entityType rakhne se dono saath rehte hain, aur isi task ki agli yaad pichhli
 * yaad ko badal deti hai — phone par dher nahi lagta.
 *
 * EK YAAD EK BAAR: NudgeLog ka unique-key claim (dekho models/NudgeLog.js). Scheduler har
 * kuch minute chalta hai aur do Lambda container saath jaag sakte hain; padh-kar-bhejne wala
 * tareeka wahan do push bhej deta hai. Key me due date bhi hai, to due date aage badhne par
 * nayi yaad jaati hai.
 *
 * Best-effort: ye job kabhi throw nahi karta — scheduler ke baaki kaam isse nahi rukte.
 */

/** Due se ek din pehle ki yaad is waqt ke baad (company time). Shaam, taaki kal ka din haath me ho. */
const DUE_SOON_AT = '17:00';
/** Overdue wali yaad is waqt ke baad — aadhi raat ko mark lagta hai, ghanti subah jaati hai. */
const OVERDUE_AT = '10:00';
/** Pehle din ke baad, dene wale ko har itne din par yaad. */
const ESCALATE_EVERY = 3;
/** Ek tick me itne se zyada task nahi — aur agar zyada mile to log me saaf likho (chup-chaap na katein). */
const MAX_TASKS = 300;
/**
 * Ek tick me itni se zyada "apni yaad" nahi bhejenge (idea I43).
 *
 * Kyun hadd: har notify() push ke liye 3 second tak rukta hai, aur is tick ke saare kaam
 * (points, announcements, digest, ye dono reminder) EK hi Lambda invocation me chalte
 * hain jiski hadd 30 second hai. "Subah 10 baje" jaisa aam waqt bahut saare task par ek
 * saath aata hai. Jo is tick me chhoot gaye wo agle tick par chale jaayenge (kuch minute
 * baad) — der se jaana chalega, aadhe raaste me tick ka mar jaana nahi.
 */
const MAX_OWN_REMINDERS = 40;

const idOf = (v) => String(v?._id ?? v ?? '');
/** b − a, dinon me. Dono 'YYYY-MM-DD'. */
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * "YAAD DILANA" — jo waqt bande ne KHUD chune (Task.remindTimes, idea I43, 19 Nov 2026).
 *
 * Upar wali ghanti (due se ek din pehle / overdue) app apne hisaab se bhejti hai. Ye
 * uske ulta hai: ye banda khud tay karta hai, aur SIRF use jaati hai jiska kaam hai —
 * dene wale ko nahi (owner ka faisla; use overdue wali alag ghanti pehle se milti hai).
 *
 * KIS DIN: DUE WALE DIN. Aur `remindDayBefore` ho to ek din pehle bhi, unhi waqton par.
 * (Yahi baat UI par bhi saaf likhi hai — owner ne 19 Nov 2026 ko batayi: "9 baje chuna
 * to kis din ka 9 baje, ye dikh hi nahi raha tha".)
 *
 * KIS WAQT: `remindTimes` me jo likha ho (zyada se zyada 3). Waqt "us waqt YA uske baad"
 * ka pehla tick hai — scheduler har kuch minute jaagta hai, to 10:00 ka matlab 10:00 se
 * 10:05 hai. Isse sateek nahi ho sakta aur owner ko ye bataya gaya hai.
 *
 * EK YAAD EK BAAR: NudgeLog ka unique-key claim — `own:<task>:<din>:<waqt>`. Din aur waqt
 * dono key me hain, to 10:00 wali aur 17:00 wali alag ginti jaati hain, aur kal phir se
 * jaayengi.
 */
export async function runOwnReminders(now = new Date()) {
  try {
    const today = ymdInTz(now);
    const tomorrow = addDays(today, 1);
    const hhmm = formatInTimeZone(now, COMPANY_TZ, 'HH:mm');

    // Aaj sirf do tarah ke task maayne rakhte hain: jinki due AAJ hai, aur jinki due KAL
    // hai par "ek din pehle" chaalu hai. Dono haalat me ghanti AAJ bajti hai.
    const rows = await Task.find({
      status: 'PENDING',
      'remindTimes.0': { $exists: true },
      dueYMD: { $in: [today, tomorrow] },
    }).select('title owner dueYMD remindTimes remindDayBefore requiresApproval submittedAt status').limit(MAX_TASKS);

    const jobs = [];
    for (const t of rows) {
      const dayBefore = t.dueYMD === tomorrow;
      if (dayBefore && !t.remindDayBefore) continue;
      // Submit kar chuke bande ko "yaad hai na" bolna galat hai — uska hissa ho chuka.
      if (t.requiresApproval && t.submittedAt) continue;
      for (const time of t.remindTimes || []) {
        if (hhmm < time) continue; // abhi waqt nahi aaya
        jobs.push({ t, time, dayBefore });
      }
    }

    const sending = jobs.slice(0, MAX_OWN_REMINDERS);
    if (jobs.length > sending.length) {
      console.warn(`own reminders: ${jobs.length - sending.length} is tick me chhoot gaye — agle tick par jaayenge`);
    }

    let sent = 0;
    // Claim PEHLE, phir bhejna — par ek-ek karke, taaki ek ka fail hona baaki ko na roke.
    await Promise.all(sending.map(async ({ t, time, dayBefore }) => {
      if (!(await claimNudge(`own:${idOf(t)}:${today}:${time}`))) return;
      await notify({
        user: t.owner,
        type: 'TASK_REMINDER',
        ...taskNews(t.title, 'Reminder', { due: t.dueYMD, note: dayBefore ? 'due tomorrow — a day to go' : '' }),
        link: todoLink(t._id),
        // Wahi tag jo deadline wali ghanti ka hai: ek hi task ki agli khabar pichhli ko
        // badal de, phone par dher na lage.
        entityType: 'TaskDue',
        entityId: t._id,
      });
      sent += 1;
    }));

    return { considered: rows.length, due: jobs.length, sent };
  } catch (err) {
    console.error('own reminders failed:', err?.message);
    return { error: err?.message || 'error' };
  }
}

export async function runTaskReminders(now = new Date()) {
  try {
    const s = await Setting.getSingleton();
    const b = s.bonus || {};
    const today = ymdInTz(now);
    const tomorrow = addDays(today, 1);
    const hhmm = formatInTimeZone(now, COMPANY_TZ, 'HH:mm');
    const dueSoonWindow = hhmm >= DUE_SOON_AT;
    const overdueWindow = hhmm >= OVERDUE_AT;
    if (!dueSoonWindow && !overdueWindow) return { skipped: 'too-early' };

    // Jo copy neeche pass kar di gayi, wo ab uske haath me nahi hai — neeche wala khatam
    // karega to apne aap band ho jaayegi. Penalty scan bhi inhe isi tarah chhodta hai.
    const forwardedParentIds = await Task.distinct('forwardedFrom', { forwardedFrom: { $ne: null } });
    const rows = await Task.find({
      assignedBy: { $ne: null },
      status: 'PENDING',
      dueYMD: { $nin: ['', null] },
      _id: { $nin: forwardedParentIds },
      // Sirf do tarah ke task matlab rakhte hain: kal due, ya due nikal chuki.
      $or: [{ dueYMD: tomorrow }, { dueYMD: { $lt: today } }],
    })
      .select('title owner assignedBy collaborators dueYMD requiresApproval submittedAt status completedBy')
      .limit(MAX_TASKS + 1);

    const capped = rows.length > MAX_TASKS;
    const tasks = capped ? rows.slice(0, MAX_TASKS) : rows;
    if (capped) console.warn(`task reminders: ${MAX_TASKS} se zyada task mile — is tick me baaki chhoot gaye`);

    // Saare naam ek query me (message me "Anjali Singh: overdue since yesterday" likhna hai).
    const ids = new Set();
    for (const t of tasks) { ids.add(idOf(t.owner)); ids.add(idOf(t.assignedBy)); }
    const people = await User.find({ _id: { $in: [...ids].filter(Boolean) } }).select('name').lean();
    const nameById = new Map(people.map((u) => [String(u._id), u.name]));

    const out = { dueSoon: 0, overdue: 0, escalated: 0, skipped: 0 };

    for (const t of tasks) {
      try {
        const grace = graceDaysOn(b, t.dueYMD);
        const deadline = addDays(t.dueYMD, grace);
        // `awaitingApproval` virtual .lean() par nahi aata — yahan rows poore doc hain, par
        // teen field se khud hi nikaal lete hain taaki aage .lean() karne par chup-chaap
        // `undefined` ko "nahi" na padh liya jaaye (wahi galti canReviewTask me likhi hai).
        const awaiting = !!t.requiresApproval && t.status === 'PENDING' && !!t.submittedAt;
        const doerName = nameById.get(idOf(t.owner)) || 'Somebody';

        // ── 1. Kal due hai ────────────────────────────────────────────────────
        if (dueSoonWindow && t.dueYMD === tomorrow) {
          // Submit kar chuke bande ko "kal due hai" bolna bekaar hai — uska hissa ho gaya.
          if (awaiting) { out.skipped += 1; continue; }
          if (!(await claimNudge(`due:${idOf(t)}:${t.dueYMD}`))) { out.skipped += 1; continue; }
          const p = await taskBonusPreview(t._id);
          const ok = p?.enabled && p?.eligible;
          await notify({
            user: t.owner,
            type: 'TASK_DUE_SOON',
            ...taskNews(t.title, 'Due tomorrow', { note: ok && p.onTimePoints ? `+${p.onTimePoints} if you finish on time` : '' }),
            link: todoLink(t._id),
            entityType: 'TaskDue',
            entityId: t._id,
          });
          out.dueSoon += 1;
          continue;
        }

        if (!overdueWindow || deadline >= today) { out.skipped += 1; continue; }

        const overdueDay = overdueDayFor(t.dueYMD, grace);
        const n = daysBetween(overdueDay, today); // 0 = aaj hi overdue hua
        if (n < 0) { out.skipped += 1; continue; }

        // ── 2. Aaj overdue hua ────────────────────────────────────────────────
        if (n === 0) {
          if (!(await claimNudge(`over:${idOf(t)}:${overdueDay}`))) { out.skipped += 1; continue; }
          const p = await taskBonusPreview(t._id);
          const ok = p?.enabled && p?.eligible;
          const cut = ok && p.latePoints ? `−${p.latePoints} applied` : '';
          const drip = ok && p.overdueDailyPoints ? `−${p.overdueDailyPoints} more each working day until it's done` : '';
          // Ek banda, ek ghanti. Approval ke intezaar wale task me dene wala DONO list me
          // hota hai — approver bhi aur watcher bhi — aur pehle use do ghanti jaati thiN
          // ("your approval is overdue" + "overdue since yesterday"), jo ek hi baat do
          // tareeke se kehti hain. Tagged banda bhi approver ho sakta hai (owner ka 8 Sep
          // ka niyam), to ye sirf assigner ka mamla nahi hai.
          const told = new Set([idOf(t.owner)]);

          if (awaiting) {
            // Karne wale ne apna kaam kar diya hai; keemat phir bhi uspar chal rahi hai.
            await notify({
              user: t.owner,
              type: 'TASK_OVERDUE',
              ...taskNews(t.title, 'Overdue — waiting for approval', { note: [cut, drip].filter(Boolean).join(' · ') }),
              link: todoLink(t._id),
              entityType: 'TaskDue',
              entityId: t._id,
            });
            // Asli kaam ab approvers ka hai. Chain sweep zaroori: kaam usi tagged bande ko
            // forward ho sakta hai jise approve karna tha, aur use "approve karo" bhejna
            // use us button par le jaata jo usi ko mana karta hai.
            const chain = await chainOwnersOf(t._id);
            for (const uid of approverIdsFor(t, chain)) {
              told.add(String(uid));
              await notify({
                user: uid,
                type: 'TASK_OVERDUE',
                ...taskNews(t.title, `${doerName} submitted this — your approval is overdue`, { note: drip ? `${doerName} loses ${p.overdueDailyPoints} a working day until you sign it off` : '' }),
                link: String(uid) === idOf(t.assignedBy) ? todoLink(t._id, true) : taggedLink(t._id),
                entityType: 'TaskDue',
                entityId: t._id,
              });
            }
          } else {
            await notify({
              user: t.owner,
              type: 'TASK_OVERDUE',
              ...taskNews(t.title, cut ? `Overdue — ${cut}` : 'Overdue — the due date has passed', { note: drip ? `${drip}. Finish it now.` : 'Finish it now.' }),
              link: todoLink(t._id),
              entityType: 'TaskDue',
              entityId: t._id,
            });
          }

          // Dene wale ko, aur tagged logon ko — unka kaam latka hua hai.
          const watchers = [idOf(t.assignedBy), ...(t.collaborators || []).map(idOf)]
            .filter((u) => u && !told.has(u));
          for (const uid of [...new Set(watchers)]) {
            await notify({
              user: uid,
              type: 'TASK_OVERDUE',
              ...taskNews(t.title, `${doerName}: overdue since ${dayInWords(t.dueYMD, now)}`, { note: cut }),
              link: uid === idOf(t.assignedBy) ? todoLink(t._id, true) : taggedLink(t._id),
              entityType: 'TaskDue',
              entityId: t._id,
            });
          }
          out.overdue += 1;
          continue;
        }

        // ── 3. Har teesre din: dene wale ko jodi hui keemat ───────────────────
        if (n % ESCALATE_EVERY !== 0) { out.skipped += 1; continue; }
        if (!idOf(t.assignedBy)) { out.skipped += 1; continue; }
        if (!(await claimNudge(`esc:${idOf(t)}:${today}`))) { out.skipped += 1; continue; }
        const p = await taskBonusPreview(t._id);
        const ok = p?.enabled && p?.eligible;
        await notify({
          user: t.assignedBy,
          type: 'TASK_OVERDUE',
          ...taskNews(t.title, `${doerName}: still not done — ${n} day${n === 1 ? '' : 's'} overdue`, {
            // Ledger ka asli jod, andaza nahi — isi liye "so far" keh sakte hain.
            note: ok && p.deductedSoFar ? `−${p.deductedSoFar} so far` : '',
          }),
          link: todoLink(t._id, true),
          entityType: 'TaskDue',
          entityId: t._id,
        });
        out.escalated += 1;
      } catch (e) {
        // Ek task ki gadbad poore tick ko nahi girati.
        console.error('task reminder failed for', idOf(t), e?.message);
      }
    }

    return { ...out, considered: tasks.length, capped };
  } catch (err) {
    console.error('task reminders failed:', err?.message);
    return { error: err?.message || 'error' };
  }
}
