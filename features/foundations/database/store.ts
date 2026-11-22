export type Column = { name: string; type: string; key: boolean };
export type Table = { name: string; fileName: string; columns: Column[] };
export type StoredTable = Table & { addressName: string; rowCount: number };

export type Store = ReturnType<typeof openStore>;

export function openStore() {
  const tables = new Map<string, { table: Table; rows: string[][] }>();

  async function allTables(): Promise<StoredTable[]> {
    return [...tables.keys()].map((addressName) => stored(addressName));
  }

  async function tableAt(addressName: string): Promise<StoredTable | undefined> {
    return tables.has(addressName) ? stored(addressName) : undefined;
  }

  async function rowsOf(table: StoredTable) {
    return tables.get(table.addressName)?.rows as string[][];
  }

  async function make(table: Table, rows: string[][]) {
    tables.set(addressNameOf(table), { table, rows });
    return stored(addressNameOf(table));
  }

  function stored(addressName: string) {
    const { table, rows } = tables.get(addressName) as { table: Table; rows: string[][] };
    return { ...table, addressName, rowCount: rows.length };
  }

  return { allTables, tableAt, rowsOf, make };
}

export function addressNameOf(table: { name: string }) {
  return table.name.toLowerCase();
}
