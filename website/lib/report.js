export const REPORT_TYPES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom range' },
];

// Company-wide report sections (filtered per role by the server's allowedSections).
export const REPORT_SECTIONS = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'leaves', label: 'Leaves' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'roster', label: 'Roster' },
];

// Self-service report sections (a user's own data).
export const SELF_REPORT_SECTIONS = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'leaves', label: 'Leave' },
  { value: 'dues', label: 'Dues' },
];
