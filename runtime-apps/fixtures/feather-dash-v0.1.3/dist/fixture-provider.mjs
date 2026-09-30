import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateReport, publishedDefinition, validateSnapshot } from "./report-definition.mjs";

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}

export async function createFixtureProvider({ statePath, fixture }) {
  if (!statePath) throw new Error("FEATHER_DASH_PROVIDER_STATE is required");
  let state;
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { publication: publishedDefinition, source: fixture, active: null, demand: {}, history: [{ event: "Publish", actor: "local-fixture-bootstrap", at: now(), revision: publishedDefinition.revision }] };
    await atomicWrite(statePath, state);
  }
  if (state.publication?.sourceUrl !== publishedDefinition.sourceUrl || state.publication?.sourceKind !== "disposable_fixture") {
    throw new Error("Fixture provider refuses unsupported or arbitrary MotherDuck Dive URLs");
  }
  const inflight = new Map();
  let writes = Promise.resolve();
  const save = (value = state) => {
    const snapshot = clone(value);
    const operation = writes.catch(() => {}).then(() => atomicWrite(statePath, snapshot));
    writes = operation;
    return operation;
  };
  const compatible = () => state.active?.definitionRevision === state.publication.revision;

  async function refresh(reportId = publishedDefinition.reportId) {
    if (reportId !== publishedDefinition.reportId) throw new Error("Unknown Feather Dash report");
    if (inflight.has(reportId)) return inflight.get(reportId);
    const work = (async () => {
      const candidate = clone(state.source);
      validateSnapshot(candidate);
      const active = { definitionRevision: state.publication.revision, refreshedAt: now(), snapshot: candidate };
      const next = clone(state);
      next.active = active;
      next.demand[reportId] = { requestedAt: next.demand[reportId]?.requestedAt ?? now(), active: true };
      await save(next);
      state = next;
      return state.active;
    })().finally(() => inflight.delete(reportId));
    inflight.set(reportId, work);
    return work;
  }

  return {
    async catalog() {
      return { demo: true, publicationAvailable: false, publicationLimitation: "Publisher operations require a host operation-role gate not present in Featherbase c7a47b2.", reports: [{ id: publishedDefinition.reportId, title: "Sales Target vs Actual", description: "Disposable synthetic data · not live MotherDuck", revision: state.publication.revision }] };
    },
    async read(request, pairs) {
      const useCache = compatible();
      const snapshot = useCache ? state.active.snapshot : state.source;
      const result = evaluateReport(clone(snapshot), request, pairs);
      if (!useCache) {
        const next = clone(state);
        next.demand[publishedDefinition.reportId] = { requestedAt: now(), active: false };
        await save(next);
        state = next;
        void refresh().catch(() => {});
      }
      return { ...result, delivery: useCache ? "cache" : "live", sourceDate: snapshot.anchor, cacheRefreshedAt: useCache ? state.active.refreshedAt : null, demo: true };
    },
    refresh,
    async scheduledRefresh(at = new Date()) {
      if (!state.demand[publishedDefinition.reportId] && !state.active) return { refreshed: [] };
      await refresh();
      return { refreshed: [publishedDefinition.reportId], at: at.toISOString() };
    },
    async inspectForTest() { return clone(state); },
    async replaceSourceForTest(snapshot) { const next = clone(state); next.source = clone(snapshot); await save(next); state = next; },
  };
}
