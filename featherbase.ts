import { html } from "@elysiajs/html";
import { Elysia, NotFoundError } from "elysia";
import { type StoredTable, type Upload, addressNameOf, openStore } from "./features/foundations/database/store.ts";
import { proposalView, tableProposedFrom, withChoices } from "./features/importing-data/proposing/proposing.ts";
import { type OpenRecord, listView } from "./features/managing-data/browsing/browsing.ts";
import { recordForm } from "./features/managing-data/changing/changing.ts";
import { type View, bar, page, stylesheetAddress, stylesheetFile } from "./page.ts";
import { homeView } from "./features/foundations/home/home.ts";
import { importDataView } from "./features/importing-data/uploading/uploading.ts";

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

  async function tableAt(addressName: string) {
    const table = await store.tableAt(addressName);
    if (!table) throw new NotFoundError();
    return table;
  }

  async function rowAt(table: StoredTable, id: string) {
    const row = await store.rowAt(table, id);
    if (!row) throw new NotFoundError();
    return row;
  }

  async function showList(table: StoredTable, open?: OpenRecord) {
    return show(listView(table, addressOf(table), await store.rowsOf(table), open), addressOf(table));
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
    .get("/tables/:name", async ({ params }) => showList(await tableAt(params.name)))
    .get("/tables/:name/rows/:id", async ({ params }) => {
      const table = await tableAt(params.name);
      const row = await rowAt(table, params.id);
      return showList(table, { form: recordForm(table, addressOf(table), row), rowId: row.id });
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
