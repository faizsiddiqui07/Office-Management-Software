import { isValidRule, nextOccurrenceYMD, nextDay } from './recurrence.js';

/**
 * TASK KA REPEAT — kaam kin dinon lautega (owner ka faisla, 19 Nov 2026, idea I43).
 *
 * Teen type ka hisaab lib/recurrence.js karta hai, jo announcements ke liye likha gaya tha
 * aur tested hai — 31 tareekh wale mahine ka clamp (30/28) wahin se aata hai. DAILY YAHAN
 * hai, wahan nahi: wo file announcements ke saath saajha hai, aur usme DAILY jodne se
 * announcements me bhi ek naya option aa jaata jo owner ne maanga hi nahi.
 *
 * Reminder ke waqt (Task.remindTimes) is file ka hissa nahi hain — wo "kis WAQT" hain, ye
 * "kis DIN" hai. Dono alag isliye hain ki owner ne dono alag maange the: kai din chuno,
 * aur un dinon kai waqt (19 Nov 2026).
 */

export const TASK_REPEAT_TYPES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'DATES'];

const isYMD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Kya is task par repeat laga hua hai? */
export function isRepeating(repeat) {
  return !!repeat && !!repeat.type && repeat.type !== 'NONE' && TASK_REPEAT_TYPES.includes(repeat.type);
}

/** Task ke repeat ko recurrence.js ke rule ki shakl me. `time` chhoda hua hai — wahan ka
 *  isValidRule use optional maanta hai, aur din ka waqt yahan remindTimes tay karte hain. */
function asRule(repeat) {
  return {
    type: repeat.type,
    weekdays: Array.isArray(repeat.weekdays) ? repeat.weekdays : [],
    daysOfMonth: Array.isArray(repeat.daysOfMonth) ? repeat.daysOfMonth : [],
    dates: Array.isArray(repeat.dates) ? repeat.dates : [],
  };
}

/** Kya ye repeat sach me chal sakta hai (zaroori din bhare hue hain)? */
export function isValidTaskRepeat(repeat) {
  if (!isRepeating(repeat)) return false;
  if (repeat.type === 'DAILY') return true;
  return isValidRule(asRule(repeat));
}

/**
 * Agli baar ye kaam kis din aayega — maujooda due date ke BAAD ka pehla din.
 *
 * `nextDay` zaroori hai: recurrence.js ka nextOccurrenceYMD "is din YA uske baad" deta
 * hai, to seedha dueYMD bhejte to MONTHLY/WEEKLY par wahi din laut aata aur naya copy usi
 * taarikh ka ban kar turant phir poora hota — ek na rukne wala chakkar.
 *
 * `null` ka matlab: aage koi din hai hi nahi (jaise DATES ki saari taarikhein guzar gayi).
 * Us soorat me kaam bas khatam ho jaata hai, jo theek hai.
 */
export function nextTaskDueYMD(repeat, fromDueYMD) {
  if (!isValidTaskRepeat(repeat) || !isYMD(fromDueYMD)) return null;
  const after = nextDay(fromDueYMD);
  if (repeat.type === 'DAILY') return after;
  return nextOccurrenceYMD(asRule(repeat), after);
}

/** Chip par dikhane layak chhota text: "Every day", "Every Mon, Wed", "Monthly on 5, 20". */
export function describeTaskRepeat(repeat) {
  if (!isValidTaskRepeat(repeat)) return '';
  const r = asRule(repeat);
  switch (repeat.type) {
    case 'DAILY':
      return 'Every day';
    case 'WEEKLY':
      return `Every ${[...r.weekdays].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ')}`;
    case 'MONTHLY':
      return `Monthly on ${[...r.daysOfMonth].sort((a, b) => a - b).join(', ')}`;
    case 'DATES':
      return r.dates.length === 1 ? `On ${r.dates[0]}` : `On ${r.dates.length} dates`;
    default:
      return '';
  }
}

/**
 * Kya is copy se agla copy banna chahiye? Khaali string = haan, warna wajah.
 *
 * Yahan sirf wo shartein hain jo task ke APNE field se pata chal jaati hain. "Dene wale ka
 * account bacha hai kya" aur "karne wala abhi active hai kya" DB se poochhna padta hai,
 * wo service me hota hai.
 */
export function repeatBlockedReason(task) {
  if (!isValidTaskRepeat(task?.repeat)) return 'no-repeat';
  // Ek copy, ek baar. Done → undo → phir done karne par doosra copy nahi banega.
  if (task.repeatSpawned) return 'already-spawned';
  // Aage pass ki hui copy apne aap band hoti hai jab neeche wala khatam karta hai — usse
  // naya kaam paida karna galat hai. Repeat sirf asli (root) copy se chalta hai.
  if (task.forwardedFrom) return 'forwarded-copy';
  // Jisne kaam diya tha uska account hi nahi raha. Aisa task "personal jaisa" dikhne lagta
  // hai (audit B2), aur uska chalte rehna kisi ki nazar me nahi aata.
  if (task.assignerDeleted) return 'assigner-deleted';
  // Agli taarikh kis se ginein? Bina due date ke repeat ka koi matlab nahi.
  if (!isYMD(task.dueYMD)) return 'no-due-date';
  return '';
}
