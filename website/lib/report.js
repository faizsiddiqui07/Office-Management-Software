export const REPORT_TYPES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

// Company-wide report sections (filtered per role by the server's allowedSections).
export const REPORT_SECTIONS = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'leaves', label: 'Leaves' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'roster', label: 'Roster' },
  { value: 'dues', label: 'Dues' },
];

// Self-service report sections (a user's own data).
export const SELF_REPORT_SECTIONS = [
  { value: 'attendance', label: 'Attendance' },
  { value: 'leaves', label: 'Leave' },
  { value: 'dues', label: 'Dues' },
];

// Any of these permissions unlocks the company report builder.
export const COMPANY_REPORT_PERMS = ['downloadReports', 'viewEveryone', 'viewExpenses', 'manageDues'];
