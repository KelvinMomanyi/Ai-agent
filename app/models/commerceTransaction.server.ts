import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

/** PostgreSQL transaction-scoped locks serialize only this shop/entity, not the store. */
export function withCommerceTransaction<T>(
  namespace: string,
  key: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${key}))::text`;
      return operation(tx);
    },
    { maxWait: 5_000, timeout: 10_000 },
  );
}
