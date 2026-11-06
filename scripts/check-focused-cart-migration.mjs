import { PrismaClient } from "@prisma/client";
import {
  inspectFocusedCartMigration,
  focusedCartRecoveryMessage,
} from "./focused-cart-migration-check.mjs";

// The intended database must be supplied by the trusted shell/CI environment.
// Do not load, print or request a credential file here.
const target = process.env.DATABASE_DIRECT_URL;
if (!target) {
  console.error(
    "Set DATABASE_DIRECT_URL in this trusted environment before running the read-only check. Do not paste its value into chat.",
  );
  process.exitCode = 1;
} else {
  let prisma;
  try {
    prisma = new PrismaClient({ datasourceUrl: target, log: [] });
    const result = await inspectFocusedCartMigration(prisma);
    console.log(focusedCartRecoveryMessage(result));
    process.exitCode = result.status === "needs_review" ? 1 : 0;
  } catch {
    console.error(
      "Read-only migration inspection failed. Check the database connection and permissions privately; no history was changed.",
    );
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect();
  }
}
