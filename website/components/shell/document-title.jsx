'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSettings } from '@/lib/settings';

const TITLES = {
  '/dashboard': 'Dashboard',
  '/attendance': 'Attendance',
  '/leaves': 'Leaves',
  '/dues': 'Dues',
  '/announcements': 'Announcements',
  '/calendar': 'Calendar',
  '/expenses': 'Expenses',
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
