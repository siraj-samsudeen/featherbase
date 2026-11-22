import { html } from "@elysiajs/html";
import { Elysia } from "elysia";
import { type Table, proposalPage, tableProposedFrom } from "./features/importing-data/proposing/proposing.ts";
import { listPage } from "./features/managing-data/browsing/browsing.ts";
import { page } from "./page.ts";

const welcomePage = page("Featherbase", '<h1>Welcome to Featherbase</h1><a href="/import">Import data</a>');
const importDataPage = page(
  "Import data",
  "<h1>Import data</h1>" +
    '<form method="post" enctype="multipart/form-data">' +
    '<input type="file" name="file" onchange="this.form.submit()"></form>',
);
const notFoundPage = page("Page not found", "<h1>Page not found</h1>");

export function createFeatherbase() {
  const tables = new Map<string, Table>();
  return new Elysia()
    .use(html())
    .get("/", () => welcomePage)
    .get("/import", () => importDataPage)
    .post("/import", async ({ body }) => {
      const { file } = body as { file: File };
      return proposalPage(tableProposedFrom(file.name, await file.text()));
    })
    .post("/tables", ({ body, redirect }) => {
      const { fileName, text } = body as { fileName: string; text: string };
      const table = tableProposedFrom(fileName, text);
      tables.set(addressNameOf(table), table);
      return redirect(`/tables/${addressNameOf(table)}`);
    })
    .get("/tables/:name", ({ params, query }) => listPage(tables.get(params.name) as Table, Number(query.page ?? 1)))
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return notFoundPage;
    });
}

function addressNameOf(table: Table) {
  return table.name.toLowerCase();
}
