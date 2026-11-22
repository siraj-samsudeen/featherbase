import { asText, bar, homeCrumb, importDataCrumb } from "../../../page.ts";

type Column = { name: string; type: string; key: string };

export function tableProposedFrom(fileName: string, text: string) {
  const [header, ...rows] = linesOf(text).map(cellsOf);
  const cellsOfEachColumn = header.map((_, index) => cellsUnder(index, rows));
  const keyIndex = cellsOfEachColumn.findIndex(canBeTheKey);
  const columns = header.map((name, index) => ({
    name,
    type: typeOf(cellsOfEachColumn[index]),
    key: index === keyIndex ? "suggested" : "",
  }));
  return { name: tableNameFrom(fileName), columns, rows, fileName, text };
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
            Featherbase read <b>${proposed.rows.length} rows, ${proposed.columns.length} Columns</b>.
            This is the Table it would make.
          </p>
          <div class="namerow">
            <div class="f">
              <label for="table-name">Table name</label>
              <input type="text" id="table-name" value="${asText(proposed.name)}" readonly>
            </div>
          </div>
          <div class="sect">
            <h2>Columns</h2>
            <div class="tbox cols">
              <table>
                <thead><tr><th>Column</th><th>Type</th><th class="keyc">Key</th></tr></thead>
                <tbody>${proposed.columns.map(columnRow).join("")}</tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="footbar">
          <input type="hidden" name="fileName" value="${asText(proposed.fileName)}">
          <input type="hidden" name="text" value="${asText(proposed.text)}">
          <button type="submit" class="btn primary">Create</button>
          <a class="btn" href="${importDataCrumb.address}">Cancel</a>
          <span class="hint">Nothing is created until you press Create.</span>
        </div>
      </form>`,
  };
}

function columnRow(column: Column) {
  return `<tr><td>${asText(column.name)}</td><td>${column.type}</td><td class="keyc">${column.key}</td></tr>`;
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

function typeOf(cells: string[]) {
  const filled = cells.filter(isFilled);
  if (filled.length === 0) return "Text";
  if (filled.every(isYesOrNo)) return "Yes/No";
  if (filled.every(isANumber)) return "Number";
  if (filled.every(isARealDate)) return "Date";
  if (mostlyRepeat(filled)) return `Choice (${new Set(filled).size} values)`;
  return "Text";
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
