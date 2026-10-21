import { Elysia } from "elysia";

export function createApp(_dbFile: string) {
  return new Elysia();
}
