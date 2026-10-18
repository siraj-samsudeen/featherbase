import { Database } from "bun:sqlite";
import { createApp } from "./app";

const db = new Database(`${import.meta.dir}/../todos.sqlite`);
const port = Number(Bun.env.PORT ?? 3000);

createApp(db).listen(port);
console.log(`🦊 API on http://localhost:${port}`);
