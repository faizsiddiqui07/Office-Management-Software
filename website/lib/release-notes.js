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
 * ── SIRF KUCH LOGON KO DIKHANA HO TO: `needs` ────────────────────────────────────
 * `needs: 'viewEveryone'` — ye card SIRF unhe dikhega jinke paas wo ijaazat hai; baaki
 * sabke liye wo hai hi nahi (owner ka faisla, 24 Nov 2026).
 *
 * KAB LAGAO: jab update ek aise page ya button ka ho jo har kisi ke liye khulta hi nahi.
 * Office Boy ko ye padhwana ki "ab poori team ka mahina ek jaali me dikhta hai" do tarah se
 * galat hai — wo page uske liye khulta nahi, aur usse ye pata chal jaata hai ki leadership
 * kya-kya dekh sakti hai.
 *
 * KAB NA LAGAO: aam update par. Default SABKO dikhana hi hai, aur wahi theek hai.
 *
 * Naam wahi likho jo lib/permissions.js janta hai (jaise viewEveryone, approveLeave,
 * manageSettings) — wahi `can()` page ko khulne dene ke liye bhi istemaal hota hai, to
 * modal aur page kabhi alag nahi bolenge. Galat naam likhne par card KISI ko nahi dikhega,
 * isliye naam dekh kar likhna.
 *
 * CHHANTA HUA CARD "PADH LIYA" ME NAHI JAATA — baad me kisi ko wo ijaazat mile to update
 * usi din uske saamne aa jaayega.
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
    id: '2026-11-26-selfie-location-map',
    ymd: '2026-11-26',
    // Gate nahi lagaya: selfie apni hi row par har kisi ko dikhti hai (site par kaam karne
    // walon ko apni), to ye baat unke liye bhi sach hai, sirf leadership ke liye nahi.
    title: 'See where a selfie was taken, without copying anything',
    points: [
      'Opening an attendance selfie now shows the location it was taken from, right under the photo.',
      'An \u201cOpen in Maps\u201d button takes you straight there \u2014 on a phone it opens the Maps app.',
      'Until now the only copy of those coordinates was the text printed on the photo itself, so checking a place meant reading them off the picture and typing them into a map by hand, one selfie at a time.',
      'It also shows how sure the phone was about the location \u2014 for example \u00b112 m \u2014 so a rough reading is easy to spot.',
    ],
  },
  {
    id: '2026-11-25-timeline-selfie-label',
    ymd: '2026-11-25',
    // Timeline Attendance ke Everyone tab me hai, to card bhi usi ijaazat ke peeche.
    needs: 'viewEveryone',
    title: 'A selfie check-out no longer reads as a check-in',
    points: [
      'On Attendance \u2192 Everyone \u2192 Timeline, resting on a row shows that person\u2019s whole day in one line.',
      'When someone marked attendance with a selfie, that line always said \u201cSelfie check-in\u201d \u2014 even on the days the selfie was taken while checking OUT.',
      'It now says which one it actually was: check-in, check-out, or both.',
      'Of the 42 selfie days so far, 12 were being described wrongly.',
    ],
  },
  {
    id: '2026-11-25-phone-task-room',
    ymd: '2026-11-25',
    title: 'More room for a task\u2019s name on your phone',
    points: [
      'On a phone, the edit and delete buttons on a to-do sat side by side and took a wide strip at the end of the row.',
      'They now sit one above the other, so the task\u2019s name gets that width instead.',
      'A long task name that used to wrap over five lines now fits in four.',
      'On a laptop nothing changes \u2014 the two buttons stay side by side, as before.',
    ],
  },
  {
    id: '2026-11-25-phone-admin-pages',
    ymd: '2026-11-25',
    // Ye paanchon panne leadership ke hain. `needs` ek hi naam leta hai, aur inme sabse
    // zyada log manageUsers wale hain — isliye card usi ke peeche hai.
    needs: 'manageUsers',
    title: 'Pages that did not fit a phone now do',
    points: [
      'Users: each person\u2019s card now ends with a \u201cManage user\u201d button instead of a bare three-dot icon, so it is clear what it opens.',
      'Roles: the role cards ran past the edge of the screen and the whole page slid sideways. They now fit, and a long role name is shortened with a \u2026 instead.',
      'Expenses: the \u201cAdd expense\u201d button was cut off at the right edge. It now sits fully on screen.',
      'Reports: the attendance figures were squeezed into three and four lines each. They now read in one or two.',
      'Rules: with the edit and delete buttons stacked, a rule\u2019s text gets more width \u2014 the whole rule book is about 30 lines shorter on a phone.',
    ],
  },
  {
    id: '2026-11-24-attendance-day-timeline',
    ymd: '2026-11-24',
    // Attendance ka Everyone tab isi ijaazat ke peeche hai, to card bhi.
    needs: 'viewEveryone',
    title: 'See the whole day at a glance on Attendance',
    points: [
      'Attendance \u2192 Everyone now has a Table / Timeline switch. The table is still what opens.',
      'Timeline draws each person as a bar from when they came in to when they left, so you can see at a glance who was here when, who came late and by how much, and who stayed on.',
      'Each bar sits on that person\u2019s own shift, so someone who starts at 11 is not read as late at 10:30.',
      'A day with no check-out fades out instead of ending, because nobody knows when that person left.',
      'Tapping a row opens the same details box as the table, so you can still fix times from there.',
    ],
  },
  {
    id: '2026-11-24-attendance-team-month',
    ymd: '2026-11-24',
    needs: 'viewEveryone',
    title: 'A whole month of the team on one screen',
    points: [
      'The same page now has a Day / Month switch. Day is still what opens.',
      'Month shows every person as a row and every date as a square, so a habit shows up straight away \u2014 one person late again and again reads across a row, and a morning the whole office was late reads down a column.',
      'It opens with the answers already written out: who was late most, who forgot to check out most, and which day had the fewest people in.',
      'Tap Late, Absent, On leave, From home or No check-out to keep only those days and sort the list by who has the most.',
      'Tap any square for that day\u2019s times, or a name for that person\u2019s page.',
    ],
  },
  {
    id: '2026-11-23-chat-box-grows',
    ymd: '2026-11-23',
    title: 'The chat box grows as you type',
    points: [
      'Writing a longer message on your phone used to push the beginning out of sight — the box stayed one line tall and scrolled inside itself.',
      'It now grows with you, up to three lines, so you can read the whole message before you send it.',
      'Longer than that and it scrolls, as before. Enter still sends; Shift and Enter still start a new line.',
    ],
  },
  {
    id: '2026-11-23-theme-fade',
    ymd: '2026-11-23',
    title: 'Light and dark now fade into each other',
    points: [
      'Switching between light and dark used to snap over in one jarring step.',
      'The colours now fade across, which is easier on the eyes at night.',
      'If you have Lite mode on, or your phone is set to reduce motion, the switch stays instant as before.',
    ],
  },
  {
    id: '2026-11-22-due-today',
    ymd: '2026-11-22',
    title: 'A task due today now says so',
    points: [
      'A task due today used to look exactly like one due in three weeks — the same grey date on the row.',
      'It now reads “Due today” in amber, so the one day that still counts stands out from the rest of the list.',
      'Overdue work stays red, and anything further out stays as it was.',
      'Open the task and the due date says “Today” there too.',
    ],
  },
  {
    id: '2026-11-22-team-tap-to-call',
    ymd: '2026-11-22',
    title: 'Call or email someone straight from Team',
    points: [
      'On the Team page, tap a phone number to open your dialer with it already filled in — no more copying it across by hand.',
      'Tap an email address to start a new mail to that person.',
      'Tapping anywhere else on the card still opens their full profile, exactly as before.',
    ],
  },
  {
    id: '2026-11-21-rewards-month-chart',
    ymd: '2026-11-21',
    title: 'See your points month by month',
    points: [
      'Your Rewards page now opens with a chart of the whole financial year — one column per month.',
      'Each column shows what you earned above the line and what you lost below it, so a month that earned 90 and lost 90 no longer looks like a month where nothing happened.',
      'Tap any month to open its full list of points underneath.',
      'The chart starts fresh every 1 April with a single column and fills up to twelve by 31 March.',
    ],
  },
  {
    id: '2026-11-21-dashboard-leader-bars',
    ymd: '2026-11-21',
    title: 'Leaders on your home screen are now a chart',
    points: [
      'The task and overtime leaders on your home screen are drawn as bars instead of a plain list.',
      'Only the top five appear, so you can see who is ahead at a glance.',
    ],
  },
  {
    id: '2026-11-21-dashboard-pending-tasks',
    ymd: '2026-11-21',
    title: 'Pending tasks on your home screen',
    points: [
      'Your home screen now shows how many of your tasks are still pending, in place of the pending-leaves count.',
      'Your pending leave requests have not gone anywhere — they are still listed further down the same page.',
    ],
  },
  {
    id: '2026-11-21-member-attendance-grid',
    ymd: '2026-11-21',
    title: 'A month of someone’s attendance at a glance',
    points: [
      'A team member’s page can now show their attendance as a calendar of coloured days instead of a table — use the Table / Grid switch above it.',
      'Present, from home, on leave, absent and days off each have their own colour, and a late arrival carries a small amber dot.',
      'Because every weekday sits in its own column, a habit shows up straight away — three late Mondays line up one under the other.',
      'Tap any day to see that day’s times. The table is still what opens by default.',
    ],
  },
  {
    id: '2026-11-21-cards-two-up',
    ymd: '2026-11-21',
    title: 'More of your figures fit on one screen',
    points: [
      'On a phone, the cards at the top of My Summary, Reports and Leaves now sit two to a row.',
      'Nothing changes on a laptop — the cards stay full size there.',
    ],
  },
  {
    id: '2026-11-20-checkin-button',
    ymd: '2026-11-20',
    title: 'The check-in button now carries your whole day',
    points: [
      'The check-in button is full width now, so it is easy to tap.',
      'After you check in, that same button counts down the 30 minutes before check-out opens, so you know exactly when it does.',
      'After you check out, it shows how long you worked and your overtime for the day.',
    ],
  },
  {
    id: '2026-11-20-home-cards-two-up',
    ymd: '2026-11-20',
    title: 'A tidier home screen on your phone',
    points: [
      'The cards on your home screen now sit two to a row on a phone, so you can see your day without scrolling.',
      'Nothing changes on a laptop — the cards stay full size there.',
    ],
  },
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
