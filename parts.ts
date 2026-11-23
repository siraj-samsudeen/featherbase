import { type View, asText, bar, chip, homeCrumb } from "./page.ts";
import type { StoredTable } from "./features/foundations/database/store.ts";
import { tableOf } from "./features/managing-data/browsing/browsing.ts";
import { recordForm } from "./features/managing-data/changing/changing.ts";

type Kind = "" | " primary" | " danger" | " danger sure" | " optional";

export function button(words: string, kind: Kind = "", more = 'type="submit"') {
  return `<button ${more} class="btn${kind}">${asText(words)}</button>`;
}

export function linkButton(words: string, address: string, kind: Kind = "") {
  return `<a class="btn${kind}" href="${address}">${asText(words)}</a>`;
}

export function tag(words: string) {
  return `<span class="tag">${asText(words)}</span>`;
}

const sampleTable: StoredTable = {
  name: "Stock",
  fileName: "stock.csv",
  addressName: "stock",
  place: "stock",
  changed: "today",
  rowCount: 2,
  columns: [
    { name: "Code", type: "Text", key: true, choices: [], place: "code" },
    { name: "Item", type: "Text", key: false, choices: [], place: "item" },
    { name: "Shelf", type: "Choice", key: false, choices: ["A", "B"], place: "shelf" },
    { name: "Counted On", type: "Date", key: false, choices: [], place: "counted_on" },
    { name: "In Stock", type: "Yes/No", key: false, choices: [], place: "in_stock" },
    { name: "Quantity", type: "Number", key: false, choices: [], place: "quantity" },
  ],
};
const sampleRows = [
  { cells: ["S1", "Steel Bolt", "A", "2026-02-01", "true", "12"], address: "#" },
  { cells: ["S2", "Brass Hinge", "B", "", "false", "7.5"], address: "#" },
];
const sampleRecord = { title: "Steel Bolt", cells: sampleRows[0].cells, uploadRow: 2 };

const parts = [
  ["Button", "parts.ts", () => `${button("Save", " primary")} ${button("Cancel")} ${button("Delete", " danger")}`],
  ["Link that looks like a button", "parts.ts", () => `${linkButton("New Item", "#", " primary")} ${linkButton("Import", "#")}`],
  ["Tag", "parts.ts", () => tag("main")],
  ["Chip", "page.ts", () => ["Accounts", "Billing", "Sales"].map(chip).join(" ")],
  ["Bar with the way back", "page.ts", () => bar("stock.csv", [homeCrumb, { name: "stock.csv" }])],
  ["Table", "features/managing-data/browsing/browsing.ts", () => `<div class="tbox">${tableOf(sampleTable.columns, sampleRows)}</div>`],
  ["Record", "features/managing-data/changing/changing.ts", () => recordForm(sampleTable, "#", sampleRecord)],
] as const;

export const partsView: View = {
  title: "Parts",
  html: `
    <section class="view">
      ${bar("Parts", [homeCrumb, { name: "Parts" }])}
      <div class="page wide">
        <p class="lead">Every page is put together from these. Each one is drawn here by the same code the pages use.</p>
        ${parts.map(([name, livesIn, sample]) => part(name, livesIn, sample())).join("")}
      </div>
    </section>`,
};

function part(name: string, livesIn: string, sample: string) {
  return `
    <section class="sect part">
      <h2>${name}</h2>
      <p class="mono">${livesIn}</p>
      <div class="sample">${sample}</div>
    </section>`;
}
