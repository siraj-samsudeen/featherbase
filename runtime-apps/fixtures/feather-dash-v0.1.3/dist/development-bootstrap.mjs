import { readFile } from "node:fs/promises";
import { registerProvider } from "./provider-registry.mjs";
import { createFixtureProvider } from "./fixture-provider.mjs";

const statePath = process.env.FEATHER_DASH_PROVIDER_STATE;
const fixturePath = process.env.FEATHER_DASH_FIXTURE;
if (!statePath || !fixturePath) throw new Error("Feather Dash fixture bootstrap requires FEATHER_DASH_PROVIDER_STATE and FEATHER_DASH_FIXTURE");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
registerProvider(await createFixtureProvider({ statePath, fixture }));
