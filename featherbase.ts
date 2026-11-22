import { html } from "@elysiajs/html";
import { Elysia, NotFoundError } from "elysia";
import { type Table, proposalView, tableProposedFrom } from "./features/importing-data/proposing/proposing.ts";
import { listView } from "./features/managing-data/browsing/browsing.ts";
import { type TableLink, type View, asText, bar, homeCrumb, page, stylesheetAddress, stylesheetFile } from "./page.ts";

const importPicture =
  '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 12V3M5.5 6.5L9 3l3.5 3.5M3 12v3h12v-3" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function homeView(tables: TableLink[]) {
  return {
    title: "Featherbase",
    html: `
      <section class="view">
        ${bar("Home")}
        <div class="page">
          <div class="hello">
            <h2>Welcome To Featherbase</h2>
            <p>Bring in a spreadsheet and it becomes a Table you can browse.</p>
          </div>
          <div class="sect">
            <h2>Start</h2>
            <div class="acts">
              <a class="act" href="/import">${importPicture}<b>Import Data</b><span>Turn a CSV file into a Table.</span></a>
            </div>
          </div>
          <section class="sect" aria-labelledby="your-tables">
            <h2 id="your-tables">Your Tables</h2>
            ${tables.length > 0 ? `<div class="items">${tables.map(tableItem).join("")}</div>` : noTablesYet}
          </section>
        </div>
      </section>`,
  };
}

const noTablesYet = '<p class="none">No Tables yet. Your first one will appear here.</p>';

function tableItem(table: TableLink) {
  return `
    <a class="item" href="${table.address}">
      <b>${asText(table.name)}</b><span class="grow"></span><span class="cnt">${table.rows} rows</span>
    </a>`;
}

const importDataView = {
  title: "Import Data",
  html: `
    <section class="view">
      ${bar("Import Data", [homeCrumb, { name: "Import Data" }])}
      <div class="page">
        <form class="drop" method="post" enctype="multipart/form-data">
          <strong>Choose a CSV file</strong>
          <p>The first row must hold the column names.</p>
          <div class="btns">
            <label class="btn primary">Choose a file
              <input type="file" name="file" accept=".csv,text/csv" hidden onchange="this.form.submit()">
            </label>
          </div>
        </form>
        <ol class="steps">
          <li><b>Featherbase proposes a Table</b>A name, a type for each Column, and a key.</li>
          <li><b>You decide</b>Nothing is created until you press Create.</li>
        </ol>
      </div>
    </section>`,
};

const notFoundView = {
  title: "Page not found",
  html: `
    <section class="view">
      ${bar("Page not found")}
      <div class="page"><p class="none">Featherbase has no page at this address. <a href="/">Go to Home</a></p></div>
    </section>`,
};

export function createFeatherbase() {
  const tables = new Map<string, Table>();

  function tableLinks() {
    return [...tables].map(linkToTable);
  }

  function show(view: View, here?: string) {
    return page(view, tableLinks(), here);
  }

  return new Elysia()
    .use(html())
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return show(notFoundView);
    })
    .get(stylesheetAddress, () => Bun.file(stylesheetFile))
    .get("/", () => show(homeView(tableLinks())))
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
    .get("/tables/:name", ({ params }) => {
      const table = tables.get(params.name);
      if (!table) throw new NotFoundError();
      return show(listView(table), addressOf(params.name));
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
