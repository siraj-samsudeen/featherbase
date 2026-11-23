import { html } from "@elysiajs/html";
import { Elysia, NotFoundError } from "elysia";
import { type Row, type StoredTable, type Upload, addressNameOf, openStore } from "./features/foundations/database/store.ts";
import { proposalView, tableProposedFrom, withChoices } from "./features/importing-data/proposing/proposing.ts";
import { type Layout, type OpenRecord, listView } from "./features/managing-data/browsing/browsing.ts";
import { aNewRecordFor, cellsTypedInto, nameOf, recordForm, refusalsOf } from "./features/managing-data/changing/changing.ts";
import { partsView } from "./parts.ts";
import { type View, bar, page, stylesheetAddress, stylesheetFile } from "./page.ts";
import { homeView } from "./features/foundations/home/home.ts";
import { importDataView, sampleAddress, sampleFile, sampleName } from "./features/importing-data/uploading/uploading.ts";

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

  async function show(view: View, here?: string, said?: string, compact = false) {
    return page(view, { ...(await frame()), said, compact }, here);
  }

  async function frame() {
    return { tables: (await store.allTables()).map(linkTo), uploads: (await store.allUploads()).map(linkToUpload) };
  }

  async function proposalFor(uploadId: string) {
    const upload = await store.uploadAt(uploadId);
    if (!upload) throw new NotFoundError();
    return tableProposedFrom(upload.fileName, upload.text);
  }

  async function keptAt(fileName: string, file: Blob) {
    const rowCount = tableProposedFrom(fileName, await file.text()).rows.length;
    return `/uploads/${await store.keepUpload(fileName, await file.bytes(), rowCount)}`;
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

  async function showList(table: StoredTable, cookie: Cookies, open?: OpenRecord) {
    const layout = layoutKeptIn(cookie);
    const view = listView(table, addressOf(table), await store.rowsOf(table), layout, open);
    return show(view, addressOf(table), whatWasSaid(cookie.said), layout.density === "compact");
  }

  async function showRecord(table: StoredTable, row: Row, cookie: Cookies, typed = {}) {
    const record = { ...row, title: nameOf(table, row.cells), deleteAt: `${addressOf(table)}/rows/${row.id}/delete`, ...typed };
    return showList(table, cookie, { form: recordForm(table, addressOf(table), record), rowId: row.id });
  }

  async function showNewRecord(table: StoredTable, cookie: Cookies, typed = {}) {
    const record = { ...aNewRecordFor(table), ...typed };
    return showList(table, cookie, { form: recordForm(table, addressOf(table), record) });
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
    .get("/parts", () => show(partsView))
    .post("/import", async ({ body, redirect }) => {
      const { file } = body as { file: File };
      return redirect(await keptAt(file.name, file));
    })
    .post(sampleAddress, async ({ redirect }) => redirect(await keptAt(sampleName, Bun.file(sampleFile))))
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
    .post("/view", ({ body, cookie, request, redirect }) => {
      keepLayout(cookie, body as Typed);
      return redirect(new URL(request.headers.get("referer") as string).pathname);
    })
    .get("/tables/:name", async ({ params, cookie }) => showList(await tableAt(params.name), cookie))
    .get("/tables/:name/rows/:id", async ({ params, cookie }) => {
      const table = await tableAt(params.name);
      return showRecord(table, await rowAt(table, params.id), cookie);
    })
    .post("/tables/:name/rows/:id", async ({ params, body, cookie, redirect }) => {
      const table = await tableAt(params.name);
      const row = await rowAt(table, params.id);
      const cells = cellsTypedInto(table, body as Typed);
      const refusals = await refusalsOf(table, cells, (key) => store.keyIsUsed(table, key, row.id));
      if (refusals.some(Boolean)) return showRecord(table, row, cookie, { cells, refusals });
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
    .get("/tables/:name/new", async ({ params, cookie }) => showNewRecord(await tableAt(params.name), cookie))
    .post("/tables/:name/new", async ({ params, body, cookie, redirect }) => {
      const table = await tableAt(params.name);
      const cells = cellsTypedInto(table, body as Typed);
      const refusals = await refusalsOf(table, cells, (key) => store.keyIsUsed(table, key, "0"));
      if (refusals.some(Boolean)) return showNewRecord(table, cookie, { cells, refusals });
      await store.addRow(table, cells);
      say(cookie.said, "Saved");
      return redirect(addressOf(table));
    });
}

type Typed = { [field: string]: string | undefined };
type Said = { value: unknown; set(to: { value: string; path: string; maxAge?: number }): unknown; remove(): unknown };
type Cookies = { [name: string]: Said };

const aYear = 365 * 24 * 60 * 60;

function keepLayout(cookie: Cookies, chosen: Typed) {
  cookie.density.set({ value: chosen.density === "compact" ? "compact" : "comfortable", path: "/", maxAge: aYear });
  cookie.record.set({ value: chosen.record === "page" ? "page" : "panel", path: "/", maxAge: aYear });
}

function layoutKeptIn(cookie: Cookies): Layout {
  return {
    density: cookie.density.value === "compact" ? "compact" : "comfortable",
    record: cookie.record.value === "page" ? "page" : "panel",
  };
}

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
