import { expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../../convex/test.setup";
import { api } from "../../convex/_generated/api";
import { createBookDoctype, renderApp, renderPending } from "../test.fixtures";

// Matrix rows S1, L1–L4 (docs/capabilities/3-auto-ui/2_spec.md)
// + E1 (docs/capabilities/4-sign-in/research-spec-plan.md)

test("links from home to the DocType list", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/");

  await user.click(await screen.findByRole("link", { name: "DocTypes" }));

  expect(await screen.findByText("No DocTypes yet")).toBeInTheDocument();
});

test("shows empty state when no doctypes", async ({ client }) => {
  renderApp(client, "/doctypes");

  expect(await screen.findByText("No DocTypes yet")).toBeInTheDocument();
});

test("lists doctypes with their labels", async ({ client }) => {
  await createBookDoctype(client);
  await client.mutation(api.doctypes.sync, {});

  renderApp(client, "/doctypes");

  expect(await screen.findByRole("link", { name: "Book" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Invoice" })).toBeInTheDocument();
});

test("navigates to a doctype grid when clicked", async ({ client }) => {
  const user = userEvent.setup();
  await createBookDoctype(client);
  renderApp(client, "/doctypes");

  await user.click(await screen.findByRole("link", { name: "Book" }));

  expect(await screen.findByText("No records yet")).toBeInTheDocument();
});

test("shows loading state while doctypes pend", async () => {
  renderPending("/doctypes");

  expect(await screen.findByText("Loading…")).toBeInTheDocument();
});

// The production failure this capability exists for (#13): a real client
// whose token went away mid-session — the query rejects, no mock needed.
test("shows error when the doctype list fails", async ({ testClient }) => {
  renderApp(testClient, "/doctypes");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Not authenticated",
  );
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});
