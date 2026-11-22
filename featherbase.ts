import { html } from "@elysiajs/html";
import { Elysia } from "elysia";
import { proposalPage, tableProposedFrom } from "./features/importing-data/proposing/proposing.ts";
import { page } from "./page.ts";

const welcomePage = page("Featherbase", '<h1>Welcome to Featherbase</h1><a href="/import">Import data</a>');
const importDataPage = page(
  "Import data",
  "<h1>Import data</h1>" +
    '<form method="post" enctype="multipart/form-data">' +
    '<input type="file" name="file" onchange="this.form.submit()"></form>',
);
const notFoundPage = page("Page not found", "<h1>Page not found</h1>");

type Table = ReturnType<typeof tableProposedFrom>;

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
    .get("/tables/:name", ({ params }) => listPage(tables.get(params.name) as Table))
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return notFoundPage;
    });
}

function addressNameOf(table: Table) {
  return table.name.toLowerCase();
}

function listPage(table: Table) {
  return page(
    table.name,
    `<h1>${table.name}</h1><table><thead>${rowOf("th", table.columns.map((column) => column.name))}</thead>` +
      `<tbody>${table.rows.map((row) => rowOf("td", row)).join("")}</tbody></table>`,
  );
}

function rowOf(cellTag: string, cells: string[]) {
  return `<tr>${cells.map((cell) => `<${cellTag}>${cell}</${cellTag}>`).join("")}</tr>`;
}
