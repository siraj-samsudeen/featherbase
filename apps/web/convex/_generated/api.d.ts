/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as doctype_auth from "../doctype/auth.js";
import type * as doctype_codegen from "../doctype/codegen.js";
import type * as doctype_definition from "../doctype/definition.js";
import type * as doctype_repository from "../doctype/repository.js";
import type * as doctypes from "../doctypes.js";
import type * as hooks_invoice from "../hooks/invoice.js";
import type * as http from "../http.js";
import type * as records from "../records.js";
import type * as tasks from "../tasks.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "doctype/auth": typeof doctype_auth;
  "doctype/codegen": typeof doctype_codegen;
  "doctype/definition": typeof doctype_definition;
  "doctype/repository": typeof doctype_repository;
  doctypes: typeof doctypes;
  "hooks/invoice": typeof hooks_invoice;
  http: typeof http;
  records: typeof records;
  tasks: typeof tasks;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
