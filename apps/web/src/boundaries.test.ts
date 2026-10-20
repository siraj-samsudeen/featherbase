import { expect, it } from "bun:test";
import apiPkg from "../../api/package.json";

const browserOnly = ["react", "react-dom", "vite"];

it("the API does not depend on browser-only libraries", () => {
  const deps = Object.keys({ ...apiPkg.dependencies, ...apiPkg.devDependencies });
  expect(deps.filter((dep) => browserOnly.includes(dep))).toEqual([]);
});
