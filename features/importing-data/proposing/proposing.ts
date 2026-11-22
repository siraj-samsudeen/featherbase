import { asText, bar, homeCrumb, importDataCrumb } from "../../../page.ts";
import { tableOf } from "../../managing-data/browsing/browsing.ts";
import { whatFeatherbaseSawIn } from "./what-featherbase-saw.ts";

const whatFits: Record<string, (filledCells: string[]) => boolean> = {
  Text: () => true,
  Number: (filled) => filled.every(isANumber),
  Date: (filled) => filled.every(isARealDate),
  "Yes/No": (filled) => filled.every(isYesOrNo),
  Choice: mostlyRepeat,
};
const types = Object.keys(whatFits);
const typesInTheOrderTheyAreProposed = ["Yes/No", "Number", "Date", "Choice", "Text"];

type Column = {
  name: string;
  type: string;
  typesThatFit: string[];
  key: boolean;
  canBeTheKey: boolean;
  saw: string;
};

export function tableProposedFrom(fileName: string, text: string) {
  const [header, ...rows] = linesOf(text).map(cellsOf);
  const cellsOfEachColumn = header.map((_, index) => cellsUnder(index, rows));
  const keyIndex = cellsOfEachColumn.findIndex(canBeTheKey);
  const columns = header.map((name, index) => columnFrom(name, cellsOfEachColumn[index], index === keyIndex));
  return { name: tableNameFrom(fileName), columns, rows, fileName, text };
}

function columnFrom(name: string, cells: string[], key: boolean): Column {
  const typesThatFit = typesThatFitThe(cells.filter(isFilled));
  const type = typesInTheOrderTheyAreProposed.find((type) => typesThatFit.includes(type)) as string;
  return { name, type, typesThatFit, key, canBeTheKey: canBeTheKey(cells), saw: whatFeatherbaseSawIn({ type, key, cells }) };
}

function typesThatFitThe(filledCells: string[]) {
  if (filledCells.length === 0) return ["Text"];
  return types.filter((type) => whatFits[type](filledCells));
}

export type Table = ReturnType<typeof tableProposedFrom>;

export function proposalView(proposed: Table) {
  return {
    title: proposed.fileName,
    html: `
      <form class="view" method="post" action="/tables">
        ${bar(proposed.fileName, [homeCrumb, importDataCrumb, { name: proposed.fileName }])}
        <div class="page wide">
          <p class="lead">
            Featherbase read <b>${proposed.rows.length} rows</b> and <b>${proposed.columns.length} columns</b>.
            This is the Table it would make.
          </p>
          <div class="namerow">
            <div class="f">
              <label for="table-name">Table name</label>
              <input type="text" id="table-name" value="${asText(proposed.name)}" readonly>
            </div>
          </div>
          <section class="sect" aria-labelledby="columns">
            <h2 id="columns">Columns</h2>
            <div class="tbox cols">
              <table>
                <thead><tr><th>Column</th><th>Type</th><th>What Featherbase saw</th><th class="keyc">Key</th></tr></thead>
                <tbody>${proposed.columns.map(columnRow).join("")}</tbody>
              </table>
            </div>
          </section>
          <section class="sect" aria-labelledby="first-rows">
            <h2 id="first-rows">How The First Rows Will Look</h2>
            <div class="tbox">${tableOf(proposed, proposed.rows.slice(0, 5))}</div>
          </section>
        </div>
        <div class="footbar">
          <input type="hidden" name="fileName" value="${asText(proposed.fileName)}">
          <input type="hidden" name="text" value="${asText(proposed.text)}">
          <button type="submit" class="btn primary">Create Table</button>
          <a class="btn" href="${importDataCrumb.address}">Cancel</a>
          <span class="hint">Nothing is created until you press Create.</span>
        </div>
      </form>`,
  };
}

function columnRow(column: Column, index: number) {
  const name = asText(column.name);
  return `
    <tr>
      <td>${name}</td>
      <td>
        <select name="type-${index}" aria-label="Type of ${name}">
          ${types.map((type) => typeOption(type, column)).join("")}
        </select>
      </td>
      <td class="saw">${column.saw}</td>
      <td class="keyc">
        <input type="radio" name="key" value="${name}" aria-label="${name} is the key"
          ${column.key ? "checked" : ""} ${column.canBeTheKey ? "" : "disabled"}>
      </td>
    </tr>`;
}

function typeOption(type: string, column: Column) {
  const chosen = type === column.type ? " selected" : "";
  const fits = column.typesThatFit.includes(type) ? "" : " disabled";
  return `<option${chosen}${fits}>${type}</option>`;
}

function tableNameFrom(fileName: string) {
  const withoutEnding = fileName.replace(/\.[^.]*$/, "");
  return withoutEnding[0].toUpperCase() + withoutEnding.slice(1);
}

function linesOf(text: string) {
  return text.split(/\r?\n/).filter((line) => line !== "");
}

function cellsOf(line: string) {
  return line.split(",");
}

function cellsUnder(columnIndex: number, rows: string[][]) {
  return rows.map((row) => row[columnIndex]);
}

function canBeTheKey(cells: string[]) {
  return cells.every(isFilled) && new Set(cells).size === cells.length;
}

function mostlyRepeat(filled: string[]) {
  const repeating = filled.filter((cell) => filled.indexOf(cell) !== filled.lastIndexOf(cell));
  return repeating.length >= 0.9 * filled.length;
}

function isFilled(cell: string) {
  return cell !== "";
}

function isYesOrNo(cell: string) {
  return cell === "true" || cell === "false";
}

function isANumber(cell: string) {
  return /^-?\d+(\.\d+)?$/.test(cell);
}

function isARealDate(cell: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cell) && isOnTheCalendar(cell);
}

function isOnTheCalendar(yearMonthDay: string) {
  return new Date(yearMonthDay).toJSON()?.startsWith(yearMonthDay) ?? false;
}
