import { readFileSync } from "node:fs";
import postgres from "postgres";

function loadEnv() {
  const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
  }
}

loadEnv();

if (process.env.AGENTGUARD_USE_FIXTURES === "1") {
  console.error("AGENTGUARD_USE_FIXTURES=1 is refused.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL_ADMIN, { max: 1 });
try {
  const rows = await sql`select count(*)::int as total from organizations`;
  if (rows[0].total < 2) {
    console.error("Expected the Harbor and Northline organizations.");
    process.exit(1);
  }
  console.log(`Ready. ${rows[0].total} organizations.`);
} finally {
  await sql.end();
}
