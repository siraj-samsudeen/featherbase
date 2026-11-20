/** Text copied from a spreadsheet as rows of trimmed cells, without blank rows. */
export function pastedCells(text: string): string[][] {
  return text.split(/\r?\n/).map(row => row.split('\t').map(cell => cell.trim())).filter(row => row.some(cell => cell))
}
