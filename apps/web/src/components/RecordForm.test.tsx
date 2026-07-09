import { expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../../convex/test.setup";
import { api } from "../../convex/_generated/api";
import { createBookDoctype, renderApp } from "../test.fixtures";

// Matrix rows F1–F5 (docs/capabilities/3-auto-ui/2_spec.md)

test("renders an input matching each field type", async ({ client }) => {
  await createBookDoctype(client);

  renderApp(client, "/doctypes/book/new");

  expect(await screen.findByLabelText("Title")).toHaveAttribute("type", "text");
  expect(screen.getByLabelText("Pages")).toHaveAttribute("type", "number");
  expect(screen.getByLabelText("Signed")).toHaveAttribute("type", "checkbox");
  const genre = screen.getByLabelText("Genre");
  expect(
    within(genre).getByRole("option", { name: "fiction" }),
  ).toBeInTheDocument();
  expect(
    within(genre).getByRole("option", { name: "science" }),
  ).toBeInTheDocument();
});

test("marks required fields as required", async ({ client }) => {
  await createBookDoctype(client);

  renderApp(client, "/doctypes/book/new");

  expect(await screen.findByLabelText("Title")).toBeRequired();
  expect(screen.getByLabelText("Pages")).not.toBeRequired();
});

test("creates a record and returns to the grid", async ({ client }) => {
  const user = userEvent.setup();
  await createBookDoctype(client);
  renderApp(client, "/doctypes/book");

  await user.click(await screen.findByRole("link", { name: "New Book" }));
  await user.type(await screen.findByLabelText("Title"), "Dune");
  await user.type(screen.getByLabelText("Pages"), "412");
  await user.click(screen.getByLabelText("Signed"));
  await user.selectOptions(screen.getByLabelText("Genre"), "fiction");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Dune")).toBeInTheDocument();
  expect(screen.getByText("412")).toBeInTheDocument();
  expect(screen.getByText("Yes")).toBeInTheDocument();
  expect(screen.getByText("fiction")).toBeInTheDocument();
});

test("omits unset optional fields", async ({ client }) => {
  const user = userEvent.setup();
  await createBookDoctype(client);
  renderApp(client, "/doctypes/book/new");

  await user.type(await screen.findByLabelText("Title"), "Solo");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Solo");

  const records = await client.query(api.records.list, { doctype: "book" });
  expect(records).toHaveLength(1);
  expect(records[0]).not.toHaveProperty("pages");
  expect(records[0]).not.toHaveProperty("signed");
  expect(records[0]).not.toHaveProperty("genre");
  expect(records[0]).not.toHaveProperty("remarks");
});

test("shows server error and stays on the form", async ({ client }) => {
  const user = userEvent.setup();
  await client.mutation(api.doctypes.sync, {});
  renderApp(client, "/doctypes/invoice/new");

  await user.type(await screen.findByLabelText("Customer"), "Acme");
  await user.type(screen.getByLabelText("amount"), "-5");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "amount must be positive",
  );
  expect(screen.getByLabelText("Customer")).toHaveValue("Acme");
});
