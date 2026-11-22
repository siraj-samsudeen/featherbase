import { asText, chip } from "../../../page.ts";

type Shown = { type: string; key: boolean; choices: string[] };

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const blank = '<span class="empty">—</span>';

const classOfAType: Record<string, string> = { Date: "date", "Yes/No": "muted", Number: "num" };

export function cellWriterFor(column: Shown, isTheName: boolean) {
  const mark = classesOf(column, isTheName);
  const write = valueWriterFor(column);
  return (cell: string, address?: string) => `<td${mark}>${linked(cell === "" ? blank : write(cell), address)}</td>`;
}

function classesOf({ type, key }: Shown, isTheName: boolean) {
  const classes = [key ? "code" : classOfAType[type], isTheName ? "name" : undefined].filter(Boolean);
  return classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
}

function linked(shown: string, address?: string) {
  return address ? `<a href="${address}">${shown}</a>` : shown;
}

function valueWriterFor({ type, key, choices }: Shown) {
  if (key) return asText;
  if (type === "Date") return (cell: string) => `<time datetime="${cell}">${dayMonthYear(cell)}</time>`;
  if (type === "Yes/No") return (cell: string) => (cell === "true" ? "Yes" : "No");
  if (type === "Number") return (cell: string) => cell;
  if (type === "Choice") return (cell: string) => chip(cell, choices.indexOf(cell));
  return asText;
}

export function dayMonthYear(yearMonthDay: string) {
  const [year, month, day] = yearMonthDay.split("-");
  return `${day}-${months[Number(month) - 1]}-${year}`;
}

export function headingFor(column: { name: string; type: string }) {
  return `<th${column.type === "Number" ? ' class="num"' : ""}>${asText(column.name)}</th>`;
}

export function indexOfTheName(columns: Shown[]) {
  const firstPlainText = columns.findIndex((column) => column.type === "Text" && !column.key);
  const theKey = columns.findIndex((column) => column.key);
  return [firstPlainText, theKey, 0].find((index) => index >= 0) as number;
}
