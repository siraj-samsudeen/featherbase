import { expect, type Page } from "@playwright/test";

// The backend's data outlives a test (and a run) — every spec works on
// DocTypes it created under a unique machine name, and no spec asserts a
// global empty state (those rows belong to the vitest integration matrix).
let counter = 0;
export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter}`;
}

// Each Playwright test gets a fresh browser context (no stored session), so
// every journey starts at the real gate: this mints a real anonymous user
// with a real JWT from the local deployment.
export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("link", { name: "DocTypes" })).toBeVisible();
}

export interface FieldSpec {
  name: string;
  label?: string;
  type?: "text" | "number" | "boolean" | "select";
  required?: boolean;
  filterable?: boolean;
  options?: string;
}

// Drives the designer UI end to end and lands on the new DocType's grid.
export async function createDoctype(
  page: Page,
  name: string,
  label: string,
  fields: FieldSpec[],
): Promise<void> {
  await page.goto("/doctypes/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Label", { exact: true }).fill(label);
  for (const [index, field] of fields.entries()) {
    if (index > 0) {
      await page.getByRole("button", { name: "Add field" }).click();
    }
    await page.getByLabel("Field name").nth(index).fill(field.name);
    if (field.label !== undefined) {
      await page.getByLabel("Field label").nth(index).fill(field.label);
    }
    if (field.type !== undefined) {
      await page.getByLabel("Field type").nth(index).selectOption(field.type);
    }
    if (field.required === true) {
      await page.getByLabel("Required").nth(index).check();
    }
    if (field.filterable === true) {
      await page.getByLabel("Filterable").nth(index).check();
    }
    if (field.options !== undefined) {
      await page.getByLabel("Options").fill(field.options);
    }
  }
  await page.getByRole("button", { name: "Create DocType" }).click();
  await expect(page.getByText("No records yet")).toBeVisible();
}

// A `book`-shaped DocType exercising every field type, like the vitest
// fixture — but uniquely named per test against the shared backend.
export async function createBookDoctype(page: Page): Promise<string> {
  const name = uniqueName("book");
  await createDoctype(page, name, `Book ${name}`, [
    { name: "title", label: "Title", required: true, filterable: true },
    { name: "pages", label: "Pages", type: "number", filterable: true },
    { name: "signed", label: "Signed", type: "boolean", filterable: true },
    {
      name: "genre",
      label: "Genre",
      type: "select",
      filterable: true,
      options: "fiction, science",
    },
    { name: "remarks" },
  ]);
  return name;
}

export interface BookInput {
  title: string;
  pages?: string;
  signed?: boolean;
  genre?: string;
}

// Creates a record through the generated form, starting from the grid.
export async function createBook(page: Page, book: BookInput): Promise<void> {
  await page.getByRole("link", { name: /^New Book/ }).click();
  await page.getByLabel("Title").fill(book.title);
  if (book.pages !== undefined) {
    await page.getByLabel("Pages").fill(book.pages);
  }
  if (book.signed === true) {
    await page.getByLabel("Signed").check();
  }
  if (book.genre !== undefined) {
    await page.getByLabel("Genre").selectOption(book.genre);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: book.title })).toBeVisible();
}
