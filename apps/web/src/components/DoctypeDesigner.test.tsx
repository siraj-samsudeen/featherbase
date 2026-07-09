import { expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test } from "../../convex/test.setup";
import { api } from "../../convex/_generated/api";
import { createBookDoctype, renderApp } from "../test.fixtures";

// Matrix rows N1–N6 (docs/capabilities/3-auto-ui/2_spec.md)

test("creates a doctype and opens its empty grid", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/doctypes/new");

  await user.type(await screen.findByLabelText("Name"), "book");
  await user.type(screen.getByLabelText("Label"), "Book");
  await user.type(screen.getByLabelText("Field name"), "title");
  await user.type(screen.getByLabelText("Field label"), "Title");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.type(screen.getAllByLabelText("Field name")[1]!, "genre");
  await user.selectOptions(
    screen.getAllByLabelText("Field type")[1]!,
    "select",
  );
  await user.type(screen.getByLabelText("Options"), "fiction, science");
  await user.click(screen.getByRole("button", { name: "Create DocType" }));

  expect(await screen.findByText("No records yet")).toBeInTheDocument();
  const stored = await client.query(api.doctypes.get, { name: "book" });
  expect(stored).toEqual({
    name: "book",
    label: "Book",
    source: "site",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "genre", type: "select", options: ["fiction", "science"] },
    ],
  });
});

test("adds and removes field rows", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/doctypes/new");

  await user.click(await screen.findByRole("button", { name: "Add field" }));
  expect(screen.getAllByLabelText("Field name")).toHaveLength(2);

  await user.click(screen.getAllByRole("button", { name: "Remove field" })[0]!);
  expect(screen.getAllByLabelText("Field name")).toHaveLength(1);
});

test("shows options input only for select fields", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/doctypes/new");

  const type = await screen.findByLabelText("Field type");
  expect(screen.queryByLabelText("Options")).not.toBeInTheDocument();

  await user.selectOptions(type, "select");
  expect(screen.getByLabelText("Options")).toBeInTheDocument();

  await user.selectOptions(type, "text");
  expect(screen.queryByLabelText("Options")).not.toBeInTheDocument();
});

test("submits required and filterable flags", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/doctypes/new");

  await user.type(await screen.findByLabelText("Name"), "book");
  await user.type(screen.getByLabelText("Field name"), "title");
  await user.click(screen.getByLabelText("Required"));
  await user.click(screen.getByLabelText("Filterable"));
  await user.click(screen.getByRole("button", { name: "Create DocType" }));
  await screen.findByText("No records yet");

  const stored = await client.query(api.doctypes.get, { name: "book" });
  expect(stored.fields[0]).toEqual({
    name: "title",
    type: "text",
    required: true,
    filterable: true,
  });
});

test("omits empty optional inputs", async ({ client }) => {
  const user = userEvent.setup();
  renderApp(client, "/doctypes/new");

  await user.type(await screen.findByLabelText("Name"), "book");
  await user.type(screen.getByLabelText("Field name"), "title");
  await user.click(screen.getByRole("button", { name: "Create DocType" }));
  await screen.findByText("No records yet");

  const stored = await client.query(api.doctypes.get, { name: "book" });
  expect(stored).toEqual({
    name: "book",
    source: "site",
    fields: [{ name: "title", type: "text" }],
  });
});

test("shows server error for invalid definition", async ({ client }) => {
  const user = userEvent.setup();
  await createBookDoctype(client);
  renderApp(client, "/doctypes/new");

  await user.type(await screen.findByLabelText("Name"), "book");
  await user.type(screen.getByLabelText("Field name"), "title");
  await user.click(screen.getByRole("button", { name: "Create DocType" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    'doctype "book" already exists',
  );
  expect(screen.getByLabelText("Name")).toHaveValue("book");
});
