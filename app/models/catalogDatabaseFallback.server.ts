import { Prisma, type Product } from "@prisma/client";
import prisma from "../db.server";
import { CatalogUnavailableError } from "../utils/catalogAvailability.server";
import { reportDependencyFailure } from "../utils/dependencyFailure.server";

/**
 * Catalog reads may use their durable source when Redis is down. This is only
 * a cache-fill guard, never a substitute for billing or delivery reservations.
 * Transaction locks work across instances and transaction-pooled connections.
 */
export async function readCatalogDuringCacheOutage(shop: string) {
  try {
    // Submit the transaction as a batch, avoiding callback round trips while
    // holding the lock. The server statement timeout still bounds SQL work.
    const [, , rows] = await prisma.$transaction([
      prisma.$executeRaw`SET TRANSACTION READ ONLY`,
      prisma.$executeRaw`SET LOCAL statement_timeout = '2500ms'`,
      prisma.$queryRaw<
        Array<
          Product & {
            acquired: boolean;
            orderStats: { orderCount: number };
            catalogCount: number;
          }
        >
      >(catalogFallbackQuery(shop)),
    ]);
    if (!rows[0]?.acquired) throw new CatalogUnavailableError();
    return {
      products: rows.filter((row) => row.id !== null),
      productCount: rows[0]?.catalogCount || 0,
    };
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError))
      reportDependencyFailure("catalog_database_fallback", error);
    throw new CatalogUnavailableError({ cause: error });
  }
}

export function catalogFallbackQuery(shop: string) {
  return Prisma.sql`WITH guard AS MATERIALIZED (
      SELECT pg_try_advisory_xact_lock(
        hashtext('aovboost:catalog-fallback'), hashtext(${shop})
      ) AS acquired
    )
    SELECT candidates.*, guard.acquired FROM guard
    LEFT JOIN LATERAL (
      SELECT p.*, jsonb_build_object('orderCount', COALESCE(s."orderCount", 0)) AS "orderStats",
        (COUNT(*) OVER())::int AS "catalogCount"
      FROM "Product" p LEFT JOIN "ProductOrderStat" s
        ON s.shop = p.shop AND s."productId" = p.id
      WHERE p.shop = ${shop} AND guard.acquired
      ORDER BY COALESCE(s."orderCount", 0) DESC, p."updatedAt" DESC, p.id ASC
      LIMIT 500
    ) candidates ON true`;
}
