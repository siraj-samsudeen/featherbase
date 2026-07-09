import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { api } from "../../convex/_generated/api";
import type {
  DocTypeDefinition,
  FieldDefinition,
} from "../../convex/doctype/definition";
import type { RecordDoc } from "../../convex/doctype/repository";

// Cells render whatever the repository stored; unset optional fields are
// blank (they have no sidecar row either — same absence semantics).
function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

// The filter control mirrors the records.list contract: single-field
// equality, value typed per the field's definition.
function buildFilter(field: FieldDefinition | undefined, raw: string) {
  if (field === undefined || raw === "") return undefined;
  if (field.type === "number") return { field: field.name, value: Number(raw) };
  if (field.type === "boolean") {
    return { field: field.name, value: raw === "yes" };
  }
  return { field: field.name, value: raw };
}

function FilterValueControl({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field?.type === "boolean") {
    return (
      <select
        id="filter-value"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (field?.type === "select") {
    return (
      <select
        id="filter-value"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Any</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      id="filter-value"
      type={field?.type === "number" ? "number" : "text"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const columnHelper = createColumnHelper<RecordDoc>();

export function RecordGrid({ definition }: { definition: DocTypeDefinition }) {
  const filterable = definition.fields.filter((field) => field.filterable);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filterField, setFilterField] = useState(filterable[0]?.name ?? "");
  const [filterValue, setFilterValue] = useState("");
  const navigate = useNavigate();

  const currentField = filterable.find((field) => field.name === filterField);
  const sort =
    sorting[0] === undefined
      ? undefined
      : {
          field: sorting[0].id,
          direction: sorting[0].desc ? ("desc" as const) : ("asc" as const),
        };
  // Filter/sort changes change the query key; keeping the previous rows on
  // screen while the new ones load stops the grid (and the filter controls)
  // from unmounting mid-interaction.
  const { data: records } = useQuery({
    ...convexQuery(api.records.list, {
      doctype: definition.name,
      filter: buildFilter(currentField, filterValue),
      sort,
    }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(
    () =>
      definition.fields.map((field) =>
        columnHelper.accessor((row) => row[field.name], {
          id: field.name,
          header: field.label ?? field.name,
          enableSorting: field.filterable === true,
        }),
      ),
    [definition],
  );

  const table = useReactTable({
    data: records ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    // Sort removal stays enabled: sorting hides records with the field unset
    // (no sidecar row), so the cycle's third click is the recovery path (G16).
    // Numeric columns would otherwise sort descending on first click.
    sortDescFirst: false,
    getCoreRowModel: getCoreRowModel(),
  });

  if (records === undefined) return <p>Loading records…</p>;

  return (
    <section>
      <h2>{definition.label ?? definition.name}</h2>
      <div>
        <label htmlFor="filter-field">Filter by</label>
        <select
          id="filter-field"
          value={filterField}
          onChange={(event) => {
            setFilterField(event.target.value);
            setFilterValue("");
          }}
        >
          {filterable.map((field) => (
            <option key={field.name} value={field.name}>
              {field.label ?? field.name}
            </option>
          ))}
        </select>
        <label htmlFor="filter-value">Value</label>
        <FilterValueControl
          field={currentField}
          value={filterValue}
          onChange={setFilterValue}
        />
        <button type="button" onClick={() => setFilterValue("")}>
          Clear
        </button>
      </div>
      {records.length === 0 ? (
        <p>No records yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              {table.getFlatHeaders().map((header) => (
                <th key={header.id}>
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() =>
                  void navigate({
                    to: "/doctypes/$doctype/$id",
                    params: { doctype: definition.name, id: row.original._id },
                  })
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{formatValue(cell.getValue())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Link to="/doctypes/$doctype/new" params={{ doctype: definition.name }}>
        New {definition.label ?? definition.name}
      </Link>
    </section>
  );
}
