import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <main>
      <h1>Featherbase</h1>
      <nav>
        <Link to="/">Tasks</Link> <Link to="/doctypes">DocTypes</Link>
      </nav>
      <Outlet />
    </main>
  );
}
