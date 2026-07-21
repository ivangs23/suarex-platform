import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const raw = execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" });
const status = JSON.parse(raw);

const lines = [
  `SUPABASE_URL=${status.API_URL}`,
  `SUPABASE_ANON_KEY=${status.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  `SUPABASE_DB_URL=${status.DB_URL}`,
  "TENANT_ROOT_DOMAINS=localhost,suarex.app",
  "",
].join("\n");

writeFileSync(".env.test", lines);
console.log(".env.test escrito");
