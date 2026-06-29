import { redirect } from 'next/navigation';

export default function RootPage() {
  // Phase 2 will branch on auth; for now send visitors to the login screen.
  redirect('/login');
}
