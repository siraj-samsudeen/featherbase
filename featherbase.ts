import { html } from "@elysiajs/html";
import { Elysia, NotFoundError } from "elysia";
import { type StoredTable, type Upload, addressNameOf, openStore } from "./features/foundations/database/store.ts";
import { proposalView, tableProposedFrom, withChoices } from "./features/importing-data/proposing/proposing.ts";
import { listView } from "./features/managing-data/browsing/browsing.ts";
import { dayMonthYear } from "./features/managing-data/browsing/showing.ts";
import { type Frame, type TableLink, type UploadLink, type View, asText, bar, homeCrumb, page, stylesheetAddress, stylesheetFile } from "./page.ts";

const importPicture =
  '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 12V3M5.5 6.5L9 3l3.5 3.5M3 12v3h12v-3" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function homeView({ tables, uploads }: Frame) {
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
          ${uploads.length > 0 ? recentUploads(uploads) : ""}
        </div>
      </section>`,
  };
}

function recentUploads(uploads: UploadLink[]) {
  return `
    <section class="sect" aria-labelledby="recent-uploads">
      <h2 id="recent-uploads">Recent Uploads</h2>
      <div class="items">${uploads.map(uploadItem).join("")}</div>
    </section>`;
}

function uploadItem(upload: UploadLink) {
  return `
    <a class="item" href="${upload.address}">
      <b>${asText(upload.name)}</b><span class="grow"></span>
      <span class="dim">${upload.rows} rows</span><span class="dim">${dayMonthYear(upload.arrivedOn)}</span>
    </a>`;
}

const noTablesYet = '<p class="none">No Tables yet. Your first one will appear here.</p>';

function tableItem(table: TableLink) {
  const keyedBy = table.key ? `, keyed by ${asText(table.key)}` : "";
  return `
    <a class="item" href="${table.address}">
      <b>${asText(table.name)}</b><span class="tag">main</span>
      <span class="dim">${table.columns} Columns${keyedBy}</span>
      <span class="grow"></span><span class="cnt">${table.rows} rows</span>
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

export async function createFeatherbase(databaseAddress: string) {
  const store = await openStore(databaseAddress);

  async function show(view: View, here?: string) {
    return page(view, await frame(), here);
  }

  async function frame() {
    return { tables: (await store.allTables()).map(linkTo), uploads: (await store.allUploads()).map(linkToUpload) };
  }

  async function proposalFor(uploadId: string) {
    const upload = await store.uploadAt(uploadId);
    if (!upload) throw new NotFoundError();
    return tableProposedFrom(upload.fileName, upload.text);
  }

  return new Elysia()
    .use(html())
    .onStop(() => store.close())
    .onError(({ code }) => {
      if (code === "NOT_FOUND") return show(notFoundView);
    })
    .get(stylesheetAddress, () => Bun.file(stylesheetFile))
    .get("/", async () => show(homeView(await frame())))
    .get("/import", () => show(importDataView))
    .post("/import", async ({ body, redirect }) => {
      const { file } = body as { file: File };
      const rowCount = tableProposedFrom(file.name, await file.text()).rows.length;
      return redirect(`/uploads/${await store.keepUpload(file.name, await file.bytes(), rowCount)}`);
    })
    .get("/uploads/:id", async ({ params }) => show(proposalView(await proposalFor(params.id), params.id)))
    .post("/tables", async ({ body, redirect }) => {
      const choices = body as Record<string, string>;
      const chosen = withChoices(await proposalFor(choices.upload), choices);
      const refusal = (await store.tableAt(addressNameOf(chosen))) ? `${chosen.name} is already used.` : "";
      if (refusal) return show(proposalView(chosen, choices.upload, refusal));
      return redirect(addressOf(await store.make(chosen, chosen.rows, choices.upload)));
    })
    .get("/tables/:name", async ({ params }) => {
      const table = await store.tableAt(params.name);
      if (!table) throw new NotFoundError();
      return show(listView(table, await store.rowsOf(table)), addressOf(table));
    });
}

function linkToUpload(upload: Upload) {
  return { name: upload.fileName, address: `/uploads/${upload.id}`, rows: upload.rowCount, arrivedOn: upload.arrivedOn };
}

function linkTo(table: StoredTable) {
  return {
    name: table.name,
    address: addressOf(table),
    rows: table.rowCount,
    columns: table.columns.length,
    key: table.columns.find((column) => column.key)?.name,
  };
}

function addressOf(table: StoredTable) {
  return `/tables/${encodeURIComponent(table.addressName)}`;
}
