import { createFeatherbase } from "./featherbase.ts";

const featherbase = await createFeatherbase(process.env.DATABASE_URL as string);
featherbase.listen(Number(process.env.PORT ?? 3000));
