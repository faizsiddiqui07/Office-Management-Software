/**
 * Working-days math for leave. Counts only working days in [fromYMD, toYMD]:
 * excludes configured weekend day-numbers and any holiday yyyy-MM-dd in
 * `holidays` (holiday calendar wires in at Phase 6). A single-day half-day
 * counts as 0.5.
 */
function enumerateDays(fromYMD, toYMD) {
  const days = [];
  let d = new Date(`${fromYMD}T00:00:00Z`);
  const end = new Date(`${toYMD}T00:00:00Z`);
  while (d.getTime() <= end.getTime()) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

export function computeWorkingDays({ fromYMD, toYMD, halfDay = false, weekendDays = [0], holidays = new Set() }) {
  const days = enumerateDays(fromYMD, toYMD);
  const workingDates = days.filter((ymd) => {
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat (calendar weekday)
    if (weekendDays.includes(dow)) return false;
    if (holidays.has(ymd)) return false;
    return true;
  });

  let count = workingDates.length;
  if (halfDay && days.length === 1 && workingDates.length === 1) count = 0.5;

  return { count, workingDates };
}
