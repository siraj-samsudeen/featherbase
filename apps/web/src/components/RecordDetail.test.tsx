import { expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../../convex/test.setup";
import { api } from "../../convex/_generated/api";
import {
  renderApp,
  renderFailing,
  renderPending,
  seedBooks,
  storedBook,
} from "../test.fixtures";

// Matrix rows D1–D6 (docs/capabilities/3-auto-ui/2_spec.md)
// + E4, E5 (docs/capabilities/4-sign-in/research-spec-plan.md)

test("shows record values prefilled for editing", async ({ client }) => {
  const [id] = await seedBooks(client, [
    { title: "Dune", pages: 412, signed: true, genre: "fiction" },
  ]);

  renderApp(client, `/doctypes/book/${id}`);

  expect(await screen.findByLabelText("Title")).toHaveValue("Dune");
  expect(screen.getByLabelText("Pages")).toHaveValue(412);
  expect(screen.getByLabelText("Signed")).toBeChecked();
  expect(screen.getByLabelText("Genre")).toHaveValue("fiction");
});

test("shows system fields", async ({ client }) => {
  const [id] = await seedBooks(client, [{ title: "Dune" }]);

  renderApp(client, `/doctypes/book/${id}`);

  expect(await screen.findByText("Owner")).toBeInTheDocument();
  expect(screen.getByText("Created")).toBeInTheDocument();
  expect(screen.getByText("Modified")).toBeInTheDocument();
  expect(screen.getAllByText(/\d{4}-\d{2}-\d{2}T/)).toHaveLength(2);
});

test("saves edits and reflects them in the grid", async ({ client }) => {
  const user = userEvent.setup();
  const [id] = await seedBooks(client, [{ title: "Dune", pages: 412 }]);
  renderApp(client, `/doctypes/book/${id}`);

  const pages = await screen.findByLabelText("Pages");
  await user.clear(pages);
  await user.type(pages, "500");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("500")).toBeInTheDocument();
  expect(screen.getByText("Dune")).toBeInTheDocument();
});

test("deletes the record and returns to the grid", async ({ client }) => {
  const user = userEvent.setup();
  const [id] = await seedBooks(client, [{ title: "Dune" }]);
  renderApp(client, `/doctypes/book/${id}`);

  await user.click(await screen.findByRole("button", { name: "Delete" }));

  expect(await screen.findByText("No records yet")).toBeInTheDocument();
  const record = await client.query(api.records.get, {
    doctype: "book",
    id,
  });
  expect(record).toBeNull();
});

test("shows message for unknown record", async ({ client }) => {
  const [id] = await seedBooks(client, [{ title: "Dune" }]);
  await client.mutation(api.records.remove, { doctype: "book", id });

  renderApp(client, `/doctypes/book/${id}`);

  expect(await screen.findByText("Record not found")).toBeInTheDocument();
});

test("shows loading state while the record pends", async () => {
  renderPending("/doctypes/book/some-id", { "doctypes:get": storedBook });

  expect(await screen.findByText("Loading record…")).toBeInTheDocument();
});

// The record failing after the definition resolved is only reachable
// through server states the UI can't produce — mocked (#13).
test("shows error when the record query fails", async () => {
  renderFailing("/doctypes/book/some-id", { "doctypes:get": storedBook });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "records:get failed",
  );
});

test("shows error when delete fails", async ({ client }) => {
  const user = userEvent.setup();
  const [id] = await seedBooks(client, [{ title: "Dune" }]);
  renderApp(client, `/doctypes/book/${id}`);
  await screen.findByRole("button", { name: "Delete" });
  // The record vanishes out from under the open detail view (another tab,
  // another user) — the direct backend delete doesn't refresh the UI.
  await client.mutation(api.records.remove, { doctype: "book", id });

  await user.click(screen.getByRole("button", { name: "Delete" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "record not found",
  );
  expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
});
