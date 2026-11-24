import { asText, chip } from "../../../page.ts";

type Seen = { type: string; key: boolean; cells: string[] };

export function whatFeatherbaseSawIn({ type, key, cells }: Seen) {
  const filled = cells.filter((cell) => cell !== "");
  const blank = cells.length - filled.length;
  const different = [...new Set(filled)];
  if (key) return `Never blank, never repeats. ${examples(different, 3)}`;
  if (filled.length === 0) return "Every cell is blank.";
  if (type === "Choice") return `${counted(different.length, "value")}, each used several times: ${chips(different)}`;
  if (type === "Yes/No") return blank ? `${filled.length} cells are ${trueOrFalse}, ${blank} blank` : `Every cell is ${trueOrFalse}`;
  if (type === "Number") return sentence("number", filled.length, blank, examples(different, blank ? 1 : 3));
  if (type === "Date") return sentence("date", filled.length, blank, examples(different, blank ? 1 : 2));
  return `${different.length} different values${blank ? `, ${blank} blank` : ""}. ${examples(different, blank ? 1 : 2)}`;
}

const trueOrFalse = "<code>true</code> or <code>false</code>";

function sentence(kind: string, filled: number, blank: number, someExamples: string) {
  return blank
    ? `${counted(filled, kind)}, ${blank} blank. ${someExamples}`
    : `Every cell is a ${kind}. ${someExamples}`;
}

function counted(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function examples(different: string[], howMany: number) {
  return different
    .slice(0, howMany)
    .map((value) => `<code>${asText(value)}</code>`)
    .join(", ");
}

function chips(different: string[]) {
  return [...different]
    .sort()
    .map((value, index) => chip(value, index))
    .join(" ");
}
