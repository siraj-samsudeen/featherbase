import { type Frame, type TableLink, type UploadLink, asText, bar } from "../../../page.ts";
import { tag } from "../../../parts.ts";
import { dayMonthYear } from "../../managing-data/browsing/showing.ts";

const importPicture =
  '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 12V3M5.5 6.5L9 3l3.5 3.5M3 12v3h12v-3" fill="none" ' +
  'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function homeView({ tables, uploads }: Frame) {
  return {
    title: "Featherbase",
    html: `
      <section class="view">
        ${bar("Home")}
        <div class="page">
          ${tables.length > 0 ? "" : welcome}
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

const welcome = `
  <div class="hello">
    <h2>Welcome To Featherbase</h2>
    <p>There is nothing here yet. Bring in a spreadsheet and it becomes a Table you can browse and edit.</p>
  </div>`;

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
      <b>${asText(table.name)}</b>${tag("main")}
      <span class="dim">${table.columns} Columns${keyedBy}</span>
      <span class="grow"></span><span class="cnt">${table.rows} rows</span>
      <span class="dim">changed ${table.changed}</span>
    </a>`;
}
