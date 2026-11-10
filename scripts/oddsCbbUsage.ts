// npm run odds-cbb-usage
//
// Free (0-credit) check of the CBB Odds API key: confirms the key works,
// prints this month's used/remaining credits, and saves the reading so
// /admin's "Odds API (CBB)" bar is current. Run it right after pasting a
// new or rotated ODDS_API_KEY_CBB into .env.

import { PrismaClient } from "@prisma/client";
import { checkOddsCbbBalance, getOddsCbbKey } from "../lib/oddsCbb";
import { recordOddsCbbUsage } from "../lib/apiUsage";

async function main() {
  if (!getOddsCbbKey()) {
    console.log("ODDS_API_KEY_CBB is empty in .env — paste the new key there first.");
    process.exit(1);
  }
  const b = await checkOddsCbbBalance();
  const total = b.used != null && b.remaining != null ? b.used + b.remaining : null;
  console.log("CBB Odds key works ✓ (this check cost 0 credits)");
  console.log(`  used this month:  ${b.used ?? "?"}`);
  console.log(`  remaining:        ${b.remaining ?? "?"}`);
  console.log(`  monthly plan:     ${total ?? "?"}`);

  const prisma = new PrismaClient();
  try {
    await recordOddsCbbUsage(prisma, b);
    console.log("Saved — /admin shows it now.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
