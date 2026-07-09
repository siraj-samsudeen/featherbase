import { useState } from "react";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";

export const Route = createRootRoute({
  component: RootLayout,
});

// Unauthenticated visitors get the sign-in state, never a hang (#22): no nav,
// no data-querying children mounted until Convex confirms the identity.
function RootLayout() {
  return (
    <main>
      <h1>Featherbase</h1>
      <AuthLoading>
        <p>Loading…</p>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <nav>
          <Link to="/">Tasks</Link> <Link to="/doctypes">DocTypes</Link>{" "}
          <SignOutButton />
        </nav>
        <Outlet />
      </Authenticated>
    </main>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [error, setError] = useState<string | null>(null);
  return (
    <section>
      <p>Build working apps from metadata — no account needed.</p>
      <button
        type="button"
        onClick={() =>
          void signIn("anonymous").catch((signInError: unknown) =>
            setError(String(signInError)),
          )
        }
      >
        Get started
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </section>
  );
}

function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <button type="button" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}
