import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <main>
      <h1>Featherbase</h1>
      <Outlet />
    </main>
  );
}
