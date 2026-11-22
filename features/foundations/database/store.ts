import { SQL } from "bun";

export type Column = { name: string; type: string; key: boolean };
export type Table = { name: string; fileName: string; columns: Column[] };
export type StoredTable = Table & { addressName: string; rowCount: number; place: string; columns: StoredColumn[] };
type StoredColumn = Column & { place: string };

export type Upload = { id: string; fileName: string; rowCount: number; arrivedOn: string };

export type Store = Awaited<ReturnType<typeof openStore>>;

const featherbaseOwnTables = `
  create schema if not exists featherbase;
  create schema if not exists main;
  create table if not exists featherbase.uploads (
    _id bigint generated always as identity primary key,
    file_name text not null,
    content bytea not null,
    row_count int not null,
    _created_at timestamptz not null default now()
  );
  create table if not exists featherbase.tables (
    _id bigint generated always as identity primary key,
    address_name text not null unique,
    name text not null,
    file_name text not null,
    place text not null unique,
    columns jsonb not null,
    upload_id bigint not null references featherbase.uploads (_id),
    _created_at timestamptz not null default now(),
    _updated_at timestamptz not null default now()
  );`;

const postgresType: Record<string, string> = {
  Text: "text",
  Choice: "text",
  Number: "numeric",
  Date: "date",
  "Yes/No": "boolean",
};

export async function openStore(databaseAddress: string) {
  const sql = new SQL(databaseAddress);
  await sql.unsafe(featherbaseOwnTables);

  async function allTables() {
    const found = await sql.unsafe("select * from featherbase.tables order by _id");
    return Promise.all(found.map(storedTableFrom));
  }

  async function tableAt(addressName: string) {
    const found = await sql.unsafe("select * from featherbase.tables where address_name = $1", [addressName]);
    return found.length > 0 ? storedTableFrom(found[0]) : undefined;
  }

  async function storedTableFrom(found: Record<string, string>): Promise<StoredTable> {
    const [{ count }] = await sql.unsafe(`select count(*)::int as count from main."${found.place}"`);
    return {
      name: found.name,
      fileName: found.file_name,
      addressName: found.address_name,
      place: found.place,
      columns: typeof found.columns === "string" ? JSON.parse(found.columns) : found.columns,
      rowCount: count,
    };
  }

  async function rowsOf(table: StoredTable): Promise<string[][]> {
    const cells = table.columns.map((column, index) => `"${column.place}"::text as c${index}`);
    const found = await sql.unsafe(`select ${cells.join(", ")} from main."${table.place}" order by _id`);
    return found.map((row: Record<string, string | null>) => table.columns.map((_, index) => row[`c${index}`] ?? ""));
  }

  async function keepUpload(fileName: string, content: Uint8Array, rowCount: number): Promise<string> {
    const [{ _id }] = await sql.unsafe(
      "insert into featherbase.uploads (file_name, content, row_count) values ($1, $2, $3) returning _id",
      [fileName, content, rowCount],
    );
    return _id;
  }

  async function allUploads(): Promise<Upload[]> {
    const found = await sql.unsafe(`select ${uploadFields} from featherbase.uploads order by _id desc`);
    return found.map(uploadFrom);
  }

  async function uploadAt(id: string) {
    if (!/^\d+$/.test(id)) return undefined;
    const found = await sql.unsafe(
      `select ${uploadFields}, convert_from(content, 'UTF8') as text from featherbase.uploads where _id = $1`,
      [id],
    );
    return found.length > 0 ? { ...uploadFrom(found[0]), text: found[0].text as string } : undefined;
  }

  async function make(table: Table, rows: string[][], uploadId: string) {
    const place = freePlaceFor(table.name, await placesTaken());
    const columns = withPlaces(table.columns);
    await sql.begin(async (step) => {
      await step.unsafe(`create table main."${place}" (${[...ownColumns, ...columns.map(columnDefinition)].join(", ")})`);
      await step.unsafe(
        "insert into featherbase.tables (address_name, name, file_name, place, columns, upload_id) values ($1, $2, $3, $4, $5::jsonb, $6)",
        [addressNameOf(table), table.name, table.fileName, place, JSON.stringify(columns), uploadId],
      );
      for (const row of rows) await step.unsafe(insertInto(place, columns), row.map(blankAsNull));
    });
    return (await tableAt(addressNameOf(table))) as StoredTable;
  }

  async function placesTaken() {
    const found = await sql.unsafe("select place from featherbase.tables");
    return found.map((row: { place: string }) => row.place);
  }

  function close() {
    return sql.close();
  }

  return { allTables, tableAt, rowsOf, make, keepUpload, allUploads, uploadAt, close };
}

const uploadFields = "_id, file_name, row_count, to_char(_created_at, 'YYYY-MM-DD') as arrived_on";

function uploadFrom(found: Record<string, string>): Upload {
  return { id: String(found._id), fileName: found.file_name, rowCount: Number(found.row_count), arrivedOn: found.arrived_on };
}

const ownColumns = [
  "_id bigint generated always as identity primary key",
  "_created_at timestamptz not null default now()",
  "_updated_at timestamptz not null default now()",
];

function columnDefinition(column: StoredColumn) {
  return `"${column.place}" ${postgresType[column.type]}${column.key ? " not null unique" : ""}`;
}

function insertInto(place: string, columns: StoredColumn[]) {
  const names = columns.map((column) => `"${column.place}"`);
  const values = columns.map((column, index) => `$${index + 1}::${postgresType[column.type]}`);
  return `insert into main."${place}" (${names.join(", ")}) values (${values.join(", ")})`;
}

function blankAsNull(cell: string) {
  return cell === "" ? null : cell;
}

function withPlaces(columns: Column[]) {
  const taken: string[] = [];
  return columns.map((column) => {
    const place = freePlaceFor(column.name, taken);
    taken.push(place);
    return { ...column, place };
  });
}

function freePlaceFor(name: string, taken: string[]) {
  const wanted = plainName(name);
  let place = wanted;
  for (let number = 2; taken.includes(place); number++) place = `${wanted}_${number}`;
  return place;
}

function plainName(name: string) {
  const plain = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return plain || "unnamed";
}

export function addressNameOf(table: { name: string }) {
  return table.name.toLowerCase();
}
