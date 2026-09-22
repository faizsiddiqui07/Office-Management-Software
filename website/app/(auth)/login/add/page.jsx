import { LoginScreen } from '@/components/auth/login-screen';

/** "Add another account" — the sign-in form without the signed-in redirect. */
export default function AddAccountPage() {
  return <LoginScreen adding />;
}
