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
 */
export const RELEASES = [
  {
    id: '2026-11-19-deadline-reminders',
    ymd: '2026-11-19',
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
