import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { evaluateReport, publishedDefinition } from "./report-definition.mjs";
import { loadPublishedSnapshot, publishedSource, validatePublishedSnapshot } from "./motherduck-source.mjs";

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();

export function verifyAttachedResources(rows) {
  const attached = new Map(rows.map((row) => [row.alias, row]));
  for (const expected of publishedSource.resources) {
    const actual = attached.get(expected.alias);
    if (actual?.is_attached !== true || actual?.fully_qualified_name !== expected.url) {
      throw new Error("Feather Dash MotherDuck resources do not match the published Dive");
    }
  }
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}

export function createMotherDuckQuery({
  token,
  expectedPrincipal,
  createInstance = (database, options) => DuckDBInstance.create(database, options),
}) {
  // @spec source_credentials_and_definition_remain_server_owned
  if (!token) throw new Error("MOTHERDUCK_TOKEN is required");
  if (!expectedPrincipal) throw new Error("FEATHER_DASH_MOTHERDUCK_PRINCIPAL is required");
  let connectionPromise;
  const connection = async () => {
    if (!connectionPromise) {
      connectionPromise = (async () => {
        let instance;
        let value;
        try {
          instance = await createInstance("md:", { motherduck_token: token });
          value = await instance.connect();
          const identity = await value.runAndReadAll("select current_user() as principal");
          if (identity.getRowObjectsJson()[0]?.principal !== expectedPrincipal) {
            throw new Error("Feather Dash MotherDuck principal does not match configured identity");
          }
          const resources = await value.runAndReadAll(
            "select alias, is_attached, fully_qualified_name from MD_ALL_DATABASES()",
          );
          verifyAttachedResources(resources.getRowObjectsJson());
          return value;
        } catch (error) {
          value?.closeSync();
          instance?.closeSync();
          throw error;
        }
      })().catch((error) => { connectionPromise = undefined; throw error; });
    }
    return connectionPromise;
  };
  return async (_name, sql, parameters) => {
    const reader = await (await connection()).runAndReadAll(sql, parameters);
    return reader.getRowObjectsJson();
  };
}

function initialState() {
  return { sourceRevision: publishedSource.revision, active: null, demand: {} };
}

export async function createMotherDuckProvider({ statePath, query, clock = now, writeState = atomicWrite }) {
  if (!statePath) throw new Error("FEATHER_DASH_PROVIDER_STATE is required");
  if (typeof query !== "function") throw new Error("Feather Dash MotherDuck query boundary is required");
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = initialState();
  }
  if (state.sourceRevision !== publishedSource.revision) state = initialState();
  if (state.active) {
    if (state.active.definitionRevision !== publishedDefinition.revision) state.active = null;
    else validatePublishedSnapshot(state.active.snapshot);
  }
  const inflight = new Map();
  let writes = Promise.resolve();
  const save = (value) => {
    const snapshot = clone(value);
    const operation = writes.catch(() => {}).then(() => writeState(statePath, snapshot));
    writes = operation;
    return operation;
  };
  const compatible = () => state.active?.definitionRevision === publishedDefinition.revision;

  async function activate(candidate) {
    validatePublishedSnapshot(candidate);
    const next = clone(state);
    next.active = { definitionRevision: publishedDefinition.revision, refreshedAt: clock(), snapshot: clone(candidate) };
    next.demand[publishedDefinition.reportId] = { requestedAt: next.demand[publishedDefinition.reportId]?.requestedAt ?? clock(), active: true };
    await save(next);
    state = next;
    return clone(state.active);
  }

  async function refresh(reportId = publishedDefinition.reportId, candidate) {
    // @spec private_last_good_cache_preserves_source_identity
    if (reportId !== publishedDefinition.reportId) throw new Error("Unknown Feather Dash report");
    if (inflight.has(reportId)) return inflight.get(reportId);
    const work = (async () => activate(candidate ?? await loadPublishedSnapshot(query)))()
      .finally(() => inflight.delete(reportId));
    inflight.set(reportId, work);
    return work;
  }

  return {
    async catalog() {
      return {
        demo: false,
        publicationAvailable: false,
        publicationLimitation: "Publisher operations remain outside this private Dev source proof.",
        reports: [{ id: publishedDefinition.reportId, title: "Sales Target vs Actual", description: "Live MotherDuck · bounded Kattakada Dev preview", revision: publishedDefinition.revision }],
      };
    },
    async read(request, pairs) {
      // Validate browser-owned report parameters before any source work.
      if (!compatible()) evaluateReport({ anchor: "2000-01-01", stores: [], hierarchy: [], daily: [{ date: "2000-01-01", storeCode: "~", code: "~", targetValue: 0, actualValue: 0, targetQuantity: 0, actualQuantity: 0 }], items: [], priceBands: [] }, request, pairs);
      if (compatible()) {
        const snapshot = state.active.snapshot;
        // @spec delivery_reports_honest_source_and_cache_state
        return { ...evaluateReport(clone(snapshot), request, pairs), delivery: "cache", sourceDate: snapshot.anchor, cacheRefreshedAt: state.active.refreshedAt, demo: false };
      }
      const active = await refresh();
      const snapshot = active.snapshot;
      const result = evaluateReport(clone(snapshot), request, pairs);
      return { ...result, delivery: "live", sourceDate: snapshot.anchor, cacheRefreshedAt: null, demo: false };
    },
    refresh,
    // Featherbase has no runtime-package job ABI; this compatible hook runs only when explicitly invoked.
    async scheduledRefresh(at = new Date()) {
      if (!state.demand[publishedDefinition.reportId] && !state.active) return { refreshed: [] };
      await refresh();
      return { refreshed: [publishedDefinition.reportId], at: at.toISOString() };
    },
    async inspectForTest() { return clone(state); },
  };
}
