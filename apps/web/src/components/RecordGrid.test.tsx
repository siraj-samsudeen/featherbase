import { expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../../convex/test.setup";
import {
  createBookDoctype,
  renderApp,
  renderFailing,
  renderPending,
  seedBooks,
  seedManyBooks,
  storedBook,
} from "../test.fixtures";

// Matrix rows G1–G16 (docs/capabilities/3-auto-ui/2_spec.md)
// + E2, E3 (docs/capabilities/4-sign-in/research-spec-plan.md)

function dataRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

function firstCellTexts(): string[] {
  return dataRows().map(
    (row) => within(row).getAllByRole("cell")[0]!.textContent ?? "",
  );
}

test("shows empty state when no records", async ({ client }) => {
  await createBookDoctype(client);

  renderApp(client, "/doctypes/book");

  expect(await screen.findByText("No records yet")).toBeInTheDocument();
});

test("renders a column per field and a row per record", async ({ client }) => {
  await seedBooks(client, [
    { title: "Dune", pages: 412, genre: "fiction" },
    { title: "Cosmos", pages: 365, genre: "science" },
  ]);

  renderApp(client, "/doctypes/book");

  await screen.findByText("Dune");
  for (const header of ["Title", "Pages", "Signed", "Genre", "remarks"]) {
    expect(
      screen.getByRole("columnheader", { name: header }),
    ).toBeInTheDocument();
  }
  expect(dataRows()).toHaveLength(2);
  expect(screen.getByText("Cosmos")).toBeInTheDocument();
});

test("renders booleans as Yes and missing values blank", async ({ client }) => {
  await seedBooks(client, [
    { title: "Dune", pages: 412, signed: true },
    { title: "Micro" },
  ]);

  renderApp(client, "/doctypes/book");

  await screen.findByText("Dune");
  expect(screen.getByText("Yes")).toBeInTheDocument();
  const microRow = screen.getByText("Micro").closest("tr");
  const cells = within(microRow as HTMLElement).getAllByRole("cell");
  expect(cells[1]).toBeEmptyDOMElement();
  expect(cells[2]).toBeEmptyDOMElement();
});

test("sorts ascending when a sortable header is clicked", async ({
  client,
}) => {
  const user = userEvent.setup();
  await seedBooks(client, [
    { title: "Dune", pages: 412 },
    { title: "Flat", pages: 100 },
    { title: "Cosmos", pages: 365 },
  ]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Dune");

  await user.click(screen.getByRole("button", { name: "Pages" }));

  await waitFor(() =>
    expect(firstCellTexts()).toEqual(["Flat", "Cosmos", "Dune"]),
  );
});

test("toggles descending on second click", async ({ client }) => {
  const user = userEvent.setup();
  await seedBooks(client, [
    { title: "Dune", pages: 412 },
    { title: "Flat", pages: 100 },
    { title: "Cosmos", pages: 365 },
  ]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Dune");

  await user.click(screen.getByRole("button", { name: "Pages" }));
  await waitFor(() =>
    expect(firstCellTexts()).toEqual(["Flat", "Cosmos", "Dune"]),
  );
  await user.click(screen.getByRole("button", { name: "Pages" }));

  await waitFor(() =>
    expect(firstCellTexts()).toEqual(["Dune", "Cosmos", "Flat"]),
  );
});

test("offers sorting only on filterable fields", async ({ client }) => {
  await seedBooks(client, [{ title: "Dune" }]);

  renderApp(client, "/doctypes/book");

  await screen.findByText("Dune");
  const remarksHeader = screen.getByRole("columnheader", { name: "remarks" });
  expect(within(remarksHeader).queryByRole("button")).not.toBeInTheDocument();
  const pagesHeader = screen.getByRole("columnheader", { name: "Pages" });
  expect(within(pagesHeader).getByRole("button")).toBeInTheDocument();
});

test("filters by select field option", async ({ client }) => {
  const user = userEvent.setup();
  await seedBooks(client, [
    { title: "Dune", genre: "fiction" },
    { title: "Cosmos", genre: "science" },
  ]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Cosmos");

  await user.selectOptions(screen.getByLabelText("Filter by"), "genre");
  await user.selectOptions(screen.getByLabelText("Value"), "fiction");

  await waitFor(() =>
    expect(screen.queryByText("Cosmos")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Dune")).toBeInTheDocument();
});

test("filters by number field value", async ({ client }) => {
  const user = userEvent.setup();
  await seedBooks(client, [
    { title: "Dune", pages: 412 },
    { title: "Cosmos", pages: 365 },
  ]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Cosmos");

  await user.selectOptions(screen.getByLabelText("Filter by"), "pages");
  const value = screen.getByLabelText("Value");
  expect(value).toHaveAttribute("type", "number");
  await user.type(value, "365");

  // Each keystroke refetches (3 → 36 → 365); wait for the final state.
  await waitFor(() => {
    expect(screen.getByText("Cosmos")).toBeInTheDocument();
    expect(screen.queryByText("Dune")).not.toBeInTheDocument();
  });
});

test("filters by boolean field value", async ({ client }) => {
  const user = userEvent.setup();
  await seedBooks(client, [
    { title: "Dune", signed: true },
    { title: "Cosmos" },
  ]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Cosmos");

  await user.selectOptions(screen.getByLabelText("Filter by"), "signed");
  await user.selectOptions(screen.getByLabelText("Value"), "yes");

  await waitFor(() =>
    expect(screen.queryByText("Cosmos")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Dune")).toBeInTheDocument();
});

test("clears the filter to show all records", async ({ client }) => {
  const user = userEvent.setup();
  await seedBooks(client, [
    { title: "Dune", genre: "fiction" },
    { title: "Cosmos", genre: "science" },
  ]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Cosmos");

  await user.selectOptions(screen.getByLabelText("Filter by"), "genre");
  await user.selectOptions(screen.getByLabelText("Value"), "fiction");
  await waitFor(() =>
    expect(screen.queryByText("Cosmos")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "Clear" }));

  expect(await screen.findByText("Cosmos")).toBeInTheDocument();
});

test("navigates to detail when a row is clicked", async ({ client }) => {
  const user = userEvent.setup();
  await seedBooks(client, [{ title: "Dune", pages: 412 }]);
  renderApp(client, "/doctypes/book");

  await user.click(await screen.findByText("Dune"));

  expect(
    await screen.findByRole("heading", { name: "Book record" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Dune");
});

test("shows message for unknown doctype", async ({ client }) => {
  renderApp(client, "/doctypes/ghost");

  expect(await screen.findByText(/Unknown DocType/)).toBeInTheDocument();
});

test("shows loading state while the definition pends", async () => {
  renderPending("/doctypes/book");

  expect(await screen.findByText("Loading…")).toBeInTheDocument();
});

test("shows loading state while records pend", async () => {
  renderPending("/doctypes/book", { "doctypes:get": storedBook });

  expect(await screen.findByText("Loading records…")).toBeInTheDocument();
});

test("renders 200 records filtered and sorted", async ({
  client,
  testClient,
}) => {
  const user = userEvent.setup();
  await createBookDoctype(client);
  await seedManyBooks(testClient, 200);
  renderApp(client, "/doctypes/book");
  await screen.findByText("b000");
  expect(dataRows()).toHaveLength(200);

  await user.selectOptions(screen.getByLabelText("Filter by"), "genre");
  await user.selectOptions(screen.getByLabelText("Value"), "fiction");
  await waitFor(() => expect(dataRows()).toHaveLength(100));
  await user.click(screen.getByRole("button", { name: "Pages" }));
  await waitFor(() => expect(firstCellTexts()[0]).toBe("b000"));
  await user.click(screen.getByRole("button", { name: "Pages" }));

  await waitFor(() => expect(firstCellTexts()[0]).toBe("b198"));
  const titles = firstCellTexts();
  expect(titles).toHaveLength(100);
  expect(titles[99]).toBe("b000");
});

test("clears sorting on third click, restoring unset-field records", async ({
  client,
}) => {
  const user = userEvent.setup();
  await seedBooks(client, [{ title: "Dune", pages: 412 }, { title: "Micro" }]);
  renderApp(client, "/doctypes/book");
  await screen.findByText("Micro");
  expect(dataRows()).toHaveLength(2);

  // Active sort hides the record with no `pages` (no sidecar row — capability
  // 2 semantics); the third click clears the sort and restores it.
  await user.click(screen.getByRole("button", { name: "Pages" }));
  await waitFor(() =>
    expect(screen.queryByText("Micro")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "Pages" }));
  await user.click(screen.getByRole("button", { name: "Pages" }));

  expect(await screen.findByText("Micro")).toBeInTheDocument();
  expect(dataRows()).toHaveLength(2);
});

// The gate's error state (#13): a real unauthenticated client — the
// definition query itself rejects.
test("shows error when the definition fails", async ({ testClient }) => {
  renderApp(testClient, "/doctypes/book");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Not authenticated",
  );
});

// Records failing after the definition resolved is only reachable through
// server states the UI can't produce (#12's stale sort) — mocked.
test("shows error when the records query fails", async () => {
  renderFailing("/doctypes/book", { "doctypes:get": storedBook });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "records:list failed",
  );
});
