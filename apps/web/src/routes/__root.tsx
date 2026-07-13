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
  // Stays disabled after signIn resolves too: each anonymous signIn mints a
  // fresh user, and the button remains mounted until the WebSocket confirms
  // the token — a double-click there would create a second orphaned user.
  const [pending, setPending] = useState(false);
  return (
    <section>
      <p>Build working apps from metadata — no account needed.</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void signIn("anonymous").catch((signInError: unknown) => {
            setError(String(signInError));
            setPending(false);
          });
        }}
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
