import { createFeatherbase } from "./featherbase.ts";

createFeatherbase().listen(Number(process.env.PORT ?? 3000));
