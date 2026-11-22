import { html } from "@elysiajs/html";
import { Elysia, NotFoundError } from "elysia";
import { type Row, type StoredTable, type Upload, addressNameOf, openStore } from "./features/foundations/database/store.ts";
import { proposalView, tableProposedFrom, withChoices } from "./features/importing-data/proposing/proposing.ts";
import { type OpenRecord, listView } from "./features/managing-data/browsing/browsing.ts";
import { aNewRecordFor, cellsTypedInto, nameOf, recordForm, refusalsOf } from "./features/managing-data/changing/changing.ts";
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

  async function show(view: View, here?: string, said?: string) {
    return page(view, { ...(await frame()), said }, here);
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

  async function showList(table: StoredTable, said: Said, open?: OpenRecord) {
    const view = listView(table, addressOf(table), await store.rowsOf(table), open);
    return show(view, addressOf(table), whatWasSaid(said));
  }

  async function showRecord(table: StoredTable, row: Row, said: Said, typed = {}) {
    const record = { ...row, title: nameOf(table, row.cells), deleteAt: `${addressOf(table)}/rows/${row.id}/delete`, ...typed };
    return showList(table, said, { form: recordForm(table, addressOf(table), record), rowId: row.id });
  }

  async function showNewRecord(table: StoredTable, said: Said, typed = {}) {
    const record = { ...aNewRecordFor(table), ...typed };
    return showList(table, said, { form: recordForm(table, addressOf(table), record) });
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
    .post("/tables", async ({ body, cookie, redirect }) => {
      const choices = body as Record<string, string>;
      const chosen = withChoices(await proposalFor(choices.upload), choices);
      const refusal = (await store.tableAt(addressNameOf(chosen))) ? `${chosen.name} is already used.` : "";
      if (refusal) return show(proposalView(chosen, choices.upload, refusal));
      const made = await store.make(chosen, chosen.rows, choices.upload);
      say(cookie.said, `Created ${made.name} with ${made.rowCount} rows`);
      return redirect(addressOf(made));
    })
    .get("/tables/:name", async ({ params, cookie }) => showList(await tableAt(params.name), cookie.said))
    .get("/tables/:name/rows/:id", async ({ params, cookie }) => {
      const table = await tableAt(params.name);
      return showRecord(table, await rowAt(table, params.id), cookie.said);
    })
    .post("/tables/:name/rows/:id", async ({ params, body, cookie, redirect }) => {
      const table = await tableAt(params.name);
      const row = await rowAt(table, params.id);
      const cells = cellsTypedInto(table, body as Typed);
      const refusals = await refusalsOf(table, cells, (key) => store.keyIsUsed(table, key, row.id));
      if (refusals.some(Boolean)) return showRecord(table, row, cookie.said, { cells, refusals });
      await store.changeRow(table, row.id, cells);
      say(cookie.said, "Saved");
      return redirect(addressOf(table));
    })
    .post("/tables/:name/rows/:id/delete", async ({ params, cookie, redirect }) => {
      const table = await tableAt(params.name);
      const row = await rowAt(table, params.id);
      await store.takeOutRow(table, row.id);
      say(cookie.said, `Deleted ${nameOf(table, row.cells)}`);
      return redirect(addressOf(table));
    })
    .get("/tables/:name/new", async ({ params, cookie }) => showNewRecord(await tableAt(params.name), cookie.said))
    .post("/tables/:name/new", async ({ params, body, cookie, redirect }) => {
      const table = await tableAt(params.name);
      const cells = cellsTypedInto(table, body as Typed);
      const refusals = await refusalsOf(table, cells, (key) => store.keyIsUsed(table, key, "0"));
      if (refusals.some(Boolean)) return showNewRecord(table, cookie.said, { cells, refusals });
      await store.addRow(table, cells);
      say(cookie.said, "Saved");
      return redirect(addressOf(table));
    });
}

type Typed = { [field: string]: string | undefined };
type Said = { value: unknown; set(to: { value: string; path: string }): unknown; remove(): unknown };

function say(said: Said, words: string) {
  said.set({ value: words, path: "/" });
}

function whatWasSaid(said: Said) {
  const words = said.value as string | undefined;
  if (words) said.remove();
  return words;
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
    changed: table.changed,
    key: table.columns.find((column) => column.key)?.name,
  };
}

function addressOf(table: StoredTable) {
  return `/tables/${encodeURIComponent(table.addressName)}`;
}
