import { asText, chip } from "../../../page.ts";

type Shown = { type: string; key: boolean };

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const blank = '<span class="empty">—</span>';

export function cellWriterFor(column: Shown, cells: string[]) {
  const write = writerFor(column, cells);
  return (cell: string) => (cell === "" ? `<td>${blank}</td>` : write(cell));
}

function writerFor({ type, key }: Shown, cells: string[]) {
  if (key) return (cell: string) => `<td class="code">${asText(cell)}</td>`;
  if (type === "Date") return (cell: string) => `<td class="date"><time datetime="${cell}">${dayMonthYear(cell)}</time></td>`;
  if (type === "Yes/No") return (cell: string) => `<td class="muted">${cell === "true" ? "Yes" : "No"}</td>`;
  if (type === "Number") return (cell: string) => `<td class="num">${cell}</td>`;
  if (type === "Choice") return choiceWriter(valuesInOrder(cells));
  return (cell: string) => `<td>${asText(cell)}</td>`;
}

function choiceWriter(values: string[]) {
  return (cell: string) => `<td>${chip(cell, values.indexOf(cell))}</td>`;
}

export function valuesInOrder(cells: string[]) {
  return [...new Set(cells.filter((cell) => cell !== ""))].sort();
}

function dayMonthYear(yearMonthDay: string) {
  const [year, month, day] = yearMonthDay.split("-");
  return `${day}-${months[Number(month) - 1]}-${year}`;
}

export function headingFor(column: { name: string; type: string }) {
  return `<th${column.type === "Number" ? ' class="num"' : ""}>${asText(column.name)}</th>`;
}
