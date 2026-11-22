import { html } from "@elysiajs/html";
import { Elysia, NotFoundError } from "elysia";
import { type Table, proposalView, tableProposedFrom } from "./features/importing-data/proposing/proposing.ts";
import { listView } from "./features/managing-data/browsing/browsing.ts";
import { type View, page } from "./page.ts";

const welcomeView = {
  title: "Featherbase",
  html: '<h1>Welcome to Featherbase</h1><a href="/import">Import data</a>',
};
const importDataView = {
  title: "Import data",
  html:
    "<h1>Import data</h1>" +
    '<form method="post" enctype="multipart/form-data">' +
    '<input type="file" name="file" onchange="this.form.submit()"></form>',
};
const notFoundView = { title: "Page not found", html: "<h1>Page not found</h1>" };

export function createFeatherbase() {
  const tables = new Map<string, Table>();

  function show(view: View) {
    return page(view, [...tables].map(linkToTable));
  }

  return new Elysia()
    .use(html())
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return show(notFoundView);
    })
    .get("/", () => show(welcomeView))
    .get("/import", () => show(importDataView))
    .post("/import", async ({ body }) => {
      const { file } = body as { file: File };
      return show(proposalView(tableProposedFrom(file.name, await file.text())));
    })
    .post("/tables", ({ body, redirect }) => {
      const { fileName, text } = body as { fileName: string; text: string };
      const table = tableProposedFrom(fileName, text);
      tables.set(addressNameOf(table), table);
      return redirect(addressOf(addressNameOf(table)));
    })
    .get("/tables/:name", ({ params, query }) => {
      const table = tables.get(params.name);
      if (!table) throw new NotFoundError();
      return show(listView(table, Number(query.page ?? 1)));
    });
}

function linkToTable([addressName, table]: [string, Table]) {
  return { name: table.name, address: addressOf(addressName), rows: table.rows.length };
}

function addressOf(addressName: string) {
  return `/tables/${encodeURIComponent(addressName)}`;
}

function addressNameOf(table: Table) {
  return table.name.toLowerCase();
}
