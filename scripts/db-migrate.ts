import { connectRaw, ensureSchema } from "../src/lib/mongo";

async function main() {
  const { db } = await connectRaw();
  await ensureSchema(db);
  console.log("db-migrate: schema + indexes ensured");
  process.exit(0);
}

main().catch((e) => {
  console.error("db-migrate failed:", e);
  process.exit(1);
});
