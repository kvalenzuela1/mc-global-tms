import { LoginForm } from './login-form';

/**
 * Login screen. FR-AUTH-01: Supabase email/password (magic-link ready).
 * FR-AUTH-03: authentication proves identity only; the portal resolves the
 * user's authorized workspaces server-side after sign-in.
 */
export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="panel w-full max-w-md p-8">
        <p className="text-copper-400 font-semibold text-sm uppercase tracking-wide">
          MC Global Freight
        </p>
        <h1 className="mt-2 text-2xl font-bold">Sign in to your workspace</h1>
        <p className="mt-1 text-sm text-muted">
          Access is limited to the organizations and roles assigned to you.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
