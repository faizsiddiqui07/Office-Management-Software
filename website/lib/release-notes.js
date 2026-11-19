/**
 * "WHAT'S NEW" — jo bhi bada update live ho, uske points yahan likhe jaate hain.
 *
 * Kaise chalta hai: app khulte hi, jiske paas koi un-padha update hai use ek modal
 * dikhta hai (components/shell/whats-new-dialog.jsx). Har update ka apna card hota hai
 * taaki do updates aapas me na milein. Neeche ek checkbox — tick karke hi band hota hai,
 * aur "padh liya" server par us bande ke naam darj ho jaata hai (User.seenReleases), to
 * phone par padh liya to laptop par dobara nahi tangta.
 *
 * NAYA UPDATE LIKHNE KA TAREEKA (owner ka faisla, 19 Nov 2026 — "code me ek file"):
 *   1. Naya object SABSE UPAR jodo (list naye se purane ke kram me rehti hai).
 *   2. `id` ek baar tay hui to KABHI na badlo — isi se yaad rehta hai ki kisne padh liya.
 *      Badal di to poore office ko wahi update dobara dikhega.
 *   3. `ymd` wo din jis din ye live hua. Isse do kaam hote hain: card par tareekh, aur
 *      ye ki us din ke BAAD joining wale naye bande ko purani updates na dikhein.
 *   4. `points` English me, chhote waaky, ek line me ek baat — modal me yahi bullet
 *      ban kar dikhte hain. Code ka naam ya file ka naam nahi; ye poore office ke liye hai.
 *
 * Yahan jo likha hai wahi sabko dikhega, isliye jo sach me badla ho wahi likho.
 *
 * ── BAAD ME DIKHANA HO TO: `liveAt` ───────────────────────────────────────────────
 * `liveAt: '2026-11-19 23:00'` (company time, 'YYYY-MM-DD HH:mm') — us waqt se PEHLE
 * ye update kisi ko nahi dikhta. Bina `liveAt` ke update turant dikhta hai.
 *
 * YE AAM NIYAM NAHI HAI — MAUKE KI CHEEZ HAI (owner, 19 Nov 2026: "bas is baar
 * chahiye, hamesha ke liye nahi bol rahe"). Saadha update par `liveAt` MAT lagao:
 * bina iske turant dikhna hi default hai, aur wahi theek hai. Ye sirf tab uthao jab
 * ek saath itne update ja rahe hon ki ek modal me padhna bhaari ho jaye.
 *
 * KIS KAAM KA: ek saath chhe update push karne par bande ko ek hi modal me 35 points
 * padhne padte the — phone par saat screen scroll (naapa gaya). `liveAt` se unhe do
 * batch me baanta ja sakta hai: kuch aaj, baaki raat ko — taaki agli subah doosri
 * list mile, pehli padhi ja chuki ho.
 *
 * NEECHE JO TEEN `liveAt` LAGE HAIN wo SIRF 19 Nov 2026 wale push ke liye hain. Un par
 * poori tareekh likhi hai, to us raat 11 ke baad wo apne aap bemaani ho jaate hain —
 * koi aage ka update unse nahi rukta. Chaaho to baad me saaf bhi kar sakte ho.
 *
 * TEEN BAATEIN JO YAAD RAKHNI HAIN:
 *   • Code us waqt se PEHLE deploy hona chahiye. `liveAt` sirf CHHUPATA hai; wo khud
 *     kuch publish nahi karta. Bina deploy ke 11 baje kuch nahi hoga.
 *   • Jo banda pehli baar 11 baje ke BAAD hi app khole, use dono batch EK SAATH
 *     milenge — ye theek hai, uske liye sab kuch naya hi hai.
 *   • Waqt device ki ghadi se naapa jaata hai (company timezone me dikha kar) — wahi
 *     tareeka jo poore app me hai. Jiska phone ka waqt bahut galat ho, wo thoda jaldi
 *     ya der se dekhega.
 */
export const RELEASES = [
  {
    id: '2026-11-19-attendance-full-calendar',
    ymd: '2026-11-19',
    title: 'Your attendance history now shows every day',
    points: [
      'Sundays, company holidays and days you were absent now appear in your own attendance history — until now it only listed days you had checked in or were on leave.',
      'A day that is still running shows a dash, not "Absent" — you are only marked absent once your own shift has ended.',
      'Your history now matches the Team-member page and the PDF report exactly, because all three are built from the same calendar.',
      'The "Fix" button next to a day you forgot to check out now opens the correction form with that date already filled in — it used to say "Invalid Date".',
      'That button no longer appears on today\'s shift while it is still open.',
      'Days with no work show a dash instead of "0m", and every status now reads in plain words instead of shouting capitals.',
      'The check-in card no longer gets squeezed into a thin strip on a laptop screen.',
      'On a laptop the card now lays itself out side by side — clock, times and the check-in button on one line — so your history is visible without scrolling. On a phone it looks exactly as before.',
    ],
  },
  {
    id: '2026-11-19-task-reminders-repeat',
    ymd: '2026-11-19',
    liveAt: '2026-11-19 23:00',
    title: 'Set your own reminder times on a task',
    points: [
      'A task with a due date can now carry up to three reminder times — tap 9:30, 1 PM or 5 PM, or pick your own.',
      'The reminder always goes out on the due day, and the form now shows you that date next to every time you pick.',
      'You can also ask for the same reminders the day before, and it shows you that date too.',
      'When you give someone a task, you can set those reminder times for them right there — the phone that rings is theirs, not yours.',
      'If you were given a task, you can change its reminder times to suit you — the rest of the task still belongs to whoever gave it to you.',
    ],
  },
  {
    id: '2026-11-19-slide-to-complete',
    ymd: '2026-11-19',
    liveAt: '2026-11-19 23:00',
    title: 'Finish a task by sliding, on your phone',
    points: [
      'On a phone or tablet, every task now has a slider under it — slide it to the right to finish the task, the way you answer a call.',
      'After you slide, the task stays on screen for five seconds with a countdown before it moves to History.',
      'During that countdown you can take back your own personal task if you slid by mistake.',
      'A task that needs approval says "Slide to submit", and one already waiting says "Slide to withdraw".',
      'In History, the same slider puts a finished task back on your list.',
      'On a laptop or desktop nothing changes — the round tick works exactly as before.',
    ],
  },
  {
    id: '2026-11-19-deadline-reminders',
    ymd: '2026-11-19',
    liveAt: '2026-11-19 23:00',
    title: 'Task deadline reminders',
    points: [
      'The day before a task is due, you now get a reminder at 5 PM — with the points you earn for finishing on time.',
      'The morning a task goes overdue, you get told what it has cost you, and that it keeps costing a little every working day until it is done.',
      'Whoever gave you the task is told the same day, so a stuck job is not a surprise at the end of the month.',
      'If the task is still not done, they are reminded every third day with the running total.',
      'If you have already submitted a task and are waiting for approval, the reminder goes to whoever has to approve it — not to you.',
    ],
  },
  {
    id: '2026-11-19-record-change-alerts',
    ymd: '2026-11-19',
    title: 'You are told when your record changes',
    points: [
      'If someone edits your attendance — a time changed, or a day cleared — you get a notification showing the old value, the new value and who changed it.',
      'The same for a late arrival being marked On duty, or that mark being removed.',
      'You are also told when your leave balance, your shift, your working days or your joining date is changed.',
      'Points added or deducted by hand now reach you straight away, with the reason.',
      'If leadership records a leave for you, the message now says it was recorded for you, and by whom.',
      'Nothing is sent when you change your own record, or when a save does not actually change anything.',
    ],
  },
  {
    id: '2026-11-18-correction-alerts',
    ymd: '2026-11-18',
    title: 'Attendance correction requests reach approvers',
    points: [
      'When you ask for an attendance correction, everyone who can approve it now gets a notification and a phone alert.',
      'Until now that request reached nobody — approvers only found it if they happened to open the Approvals page.',
      'The request no longer pings you about your own correction, and the alert clears from everyone once it is approved, rejected or withdrawn.',
    ],
  },
];
