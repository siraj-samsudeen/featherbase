import { registerProvider } from "./provider-registry.mjs";
import { createMotherDuckProvider, createMotherDuckQuery } from "./motherduck-provider.mjs";

const statePath = process.env.FEATHER_DASH_MOTHERDUCK_STATE;
const token = process.env.MOTHERDUCK_TOKEN;
const expectedPrincipal = process.env.FEATHER_DASH_MOTHERDUCK_PRINCIPAL;
if (!statePath || !token || !expectedPrincipal) {
  throw new Error("Feather Dash MotherDuck bootstrap requires FEATHER_DASH_MOTHERDUCK_STATE, MOTHERDUCK_TOKEN, and FEATHER_DASH_MOTHERDUCK_PRINCIPAL");
}
registerProvider(await createMotherDuckProvider({
  statePath,
  query: createMotherDuckQuery({ token, expectedPrincipal }),
}));
