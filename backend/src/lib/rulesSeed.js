/**
 * The office Rules & Regulations the page starts with — written once, then owned by the
 * CEO & President through the page's add/edit/delete controls (this seed never runs again
 * after the first time; see ensureSeeded in rules.controller).
 *
 * {placeholders} are resolved LIVE per viewer when served: timings come from the viewer's
 * OWN shift (a part-timer sees their hours, not the office default) and every point value
 * comes from the current bonus settings — so leadership changing a value in Settings
 * updates this page by itself, and the text never goes stale.
 */
export const DEFAULT_RULE_SECTIONS = [
  {
    title: 'To-Do & Tasks',
    icon: 'ListTodo',
    rules: [
      { text: 'Everyone has a To-Do page. Add your own tasks with a due date and tick them off as you finish — this is your personal work list.' },
      { text: 'Seniors can assign tasks to their team. Only ASSIGNED tasks earn or cut points — your personal to-dos never affect points.' },
      { text: 'POINTS ELIGIBILITY: a task counts for points ONLY when the CEO & President can see it — either they assigned it themselves, or at least one of them is TAGGED on the task. Without that, the task is fully outside the points system: no rewards, no penalties, and it never appears on the leaderboard.' },
      { text: 'Every assigned task has a due date. Finish the work and submit it on or before that date.' },
      { text: 'Tasks that need approval count as DONE on the day they are APPROVED, not the day you submit — so submit early enough for your senior to review.' },
      { text: 'Assigned task done on time: +{onTimePoints} points.' },
      { text: 'Assigned task NOT done by the due date: −{latePoints} points are cut the very next day.' },
      { text: 'After that, −{overdueDailyPoints} point more is cut EVERY day until the task is done and approved. The longer it sits, the more it costs.' },
      { text: 'Finishing an assigned task late gives −{latePoints} instead of the on-time reward.' },
      { text: 'Forwarding: you can pass an assigned task down to a junior. If the work finishes on time, the forwarder earns +{forwardOnTimePoints} points; if it finishes late, the forwarder loses {forwardLatePoints} points. Nobody is paid until the task is approved at the top of the chain.' },
      { text: 'You can tag colleagues on a task to keep them informed — tagged people only stay in the loop; the task is not their responsibility.' },
    ],
  },
  {
    title: 'Attendance & Timing',
    icon: 'CalendarClock',
    rules: [
      { text: 'Your office hours: {workStart} to {workEnd}. This shows YOUR OWN shift — if your timing differs from the office default, your timing is what counts.' },
      { text: 'Check in when you arrive and check out when you leave, every working day, from the Attendance page.' },
      { text: 'Checking in after your start time{graceNote} counts as LATE. Each late arrival cuts −{lateArrivalPoints} point(s).' },
      { text: 'A fully punctual week — Monday to Saturday, no unexcused late and no unexplained absence — earns +{streakPoints} points. Sundays, holidays, approved leave and WFH never break the week.' },
      { text: 'Perfect attendance for the WHOLE month (no absents, no lates) earns +{perfectMonthPoints} bonus points when the month ends.' },
      { text: 'A working day with no attendance and no approved leave counts as ABSENT and cuts −{absentPoints} point(s). If you cannot come, apply for leave — never just skip.' },
    ],
  },
  {
    title: 'Overtime',
    icon: 'Clock',
    rules: [
      { text: 'Overtime means working past your own office end time ({workEnd}). It follows YOUR shift — if your hours differ, overtime counts after YOUR end time, not the office default.' },
      { text: 'Overtime is counted from the moment you work past your end time ({workEnd}) — there is no waiting period.' },
      { text: 'Every full hour of overtime earns +{overtimeHourPoints} point(s). It is totalled once for the WHOLE month, not day by day: full hours pay in full, a leftover of MORE than 30 minutes pays half the rate, and 30 minutes or less adds nothing — so a few extra minutes here and there only start paying once they add up.' },
    ],
  },
  {
    title: 'Leaves',
    icon: 'CalendarDays',
    rules: [
      { text: 'You get {annualLeaveQuota} paid leaves per financial year (1 April – 31 March).' },
      { text: 'Out of these, use up to 12 freely through the year.' },
      { text: 'The leaves above 12 — normally 6 — are your savings: whatever you do NOT use out of them by year end is paid back as a separate incentive, for exactly that many days (6 left = 6 days of incentive, 5 left = 5, and so on).' },
      { text: 'Apply for leave IN ADVANCE from the Leaves page. Leave is deducted only when it is approved.' },
      { text: 'A half-day leave costs half a day from your balance.' },
      { text: 'Take no leave in a whole month and you earn +{noLeavePoints} bonus points when that month ends.' },
    ],
  },
  {
    title: 'Work From Home',
    icon: 'Home',
    rules: [
      { text: 'WFH is for genuine need only — when coming to office is truly not possible.' },
      { text: 'You can take up to {wfhCap} work-from-home days per year (1 April – 31 March).' },
      { text: 'A WFH request needs approval like a leave. An approved WFH day counts as a WORKED day — it is neither absent nor leave.' },
    ],
  },
  {
    title: 'Birthday',
    icon: 'Cake',
    rules: [
      { text: 'Your birthday is an OPTIONAL holiday: come to office if you like, or take the day off — your choice.' },
      { text: 'A birthday day off does not touch your leave balance and never counts as absent.' },
    ],
  },
  {
    title: 'Points & Rewards',
    icon: 'Award',
    rules: [
      { text: 'Leadership sets what every action is worth in Settings. All point values on this page are LIVE — when leadership changes a value, this page updates by itself.' },
      { text: 'Points reset every month. A POSITIVE balance is paid out and does not roll over to the next month.' },
      { text: 'A NEGATIVE balance follows you: it carries into the next month and keeps carrying until you clear it. A negative month pays ₹0 — pay is never cut, the deficit just waits.' },
      { text: 'Each point is worth ₹{rupeesPerPoint} right now. The per-point rate can change from month to month — the current rate always shows here and on the Rewards page.' },
      { text: 'See the Rewards page for your live balance, the full price list and your point-by-point breakdown.' },
    ],
  },
];
