// Reads the app package (doctypes/*.json + materializations.json) and writes
// the generated artifacts. Run via `npm run gen:doctypes` (tsx). Input
// validation lives here so the pure generators in convex/doctype/codegen.ts
// stay total.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDefinition } from "../convex/doctype/definition";
import {
  generateDoctypesModule,
  generateHookStub,
  generateHooksModule,
} from "../convex/doctype/codegen";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doctypesDir = join(root, "doctypes");

const files = readdirSync(doctypesDir)
  .filter((file) => file.endsWith(".json") && file !== "materializations.json")
  .sort();

const definitions = files.map((file) => {
  const definition = parseDefinition(
    readFileSync(join(doctypesDir, file), "utf8"),
  );
  if (`${definition.name}.json` !== file) {
    throw new Error(`${file}: name "${definition.name}" must match filename`);
  }
  return definition;
});

const materializations = JSON.parse(
  readFileSync(join(doctypesDir, "materializations.json"), "utf8"),
) as Record<string, string[]>;

for (const name of Object.keys(materializations)) {
  if (definitions.some((definition) => definition.name === name)) {
    throw new Error(
      `materializations.json: "${name}" is already a package doctype (its indexes come from codegen)`,
    );
  }
}

writeFileSync(
  join(root, "convex", "doctypes.gen.ts"),
  generateDoctypesModule(definitions, materializations),
);
writeFileSync(
  join(root, "convex", "hooks.gen.ts"),
  generateHooksModule(definitions),
);

mkdirSync(join(root, "convex", "hooks"), { recursive: true });
for (const definition of definitions) {
  const stubPath = join(root, "convex", "hooks", `${definition.name}.ts`);
  if (!existsSync(stubPath)) {
    writeFileSync(stubPath, generateHookStub(definition));
  }
}

console.log(
  `Generated doctypes.gen.ts + hooks.gen.ts (${definitions.length} package doctype(s), ${Object.keys(materializations).length} materialization(s))`,
);
