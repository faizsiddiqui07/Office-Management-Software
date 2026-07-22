'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSettings } from '@/lib/settings';

// Keep in step with NAV_ITEMS in lib/permissions.js — a page missing from here shows
// only the company name in the tab, which makes several open tabs impossible to tell
// apart on a desktop.
const TITLES = {
  '/dashboard': 'Dashboard',
  '/todo': 'To-Do',
  '/approvals': 'Approvals',
  '/my-summary': 'My Summary',
  '/attendance': 'Attendance',
  '/leaves': 'Leaves',
  '/dues': 'Dues',
  '/announcements': 'Announcements',
  '/calendar': 'Calendar',
  '/rewards': 'Rewards',
  '/team': 'Team',
  '/expenses': 'Expenses',
  '/visitors': 'Visitors',
  '/users': 'Users',
  '/reports': 'Reports',
  '/activity': 'Activity',
  '/roles': 'Roles',
  '/settings': 'Settings',
  '/profile': 'Profile',
};

/** Keeps the document title in sync as "<Page> | <Company>". */
export function DocumentTitle() {
  const pathname = usePathname();
  const { data: settings } = useSettings();
  const company = settings?.companyName?.trim() || 'Architectus Bureau';

  useEffect(() => {
    const key = Object.keys(TITLES).find((k) => pathname === k || pathname.startsWith(`${k}/`));
    const label = key ? TITLES[key] : '';
    document.title = label ? `${label} | ${company}` : company;
  }, [pathname, company]);

  return null;
}
