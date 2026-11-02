import { Prisma } from "@prisma/client";
import prisma from "../db.server";

/** Uses the canonical-variant GIN index; never transfers all product metadata. */
export async function findProductIdsByVariants(
  shop: string,
  variants: string[],
): Promise<string[]> {
  const ids = [
    ...new Set(
      variants.map((id) =>
        id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`,
      ),
    ),
  ].slice(0, 100);
  if (!ids.length) return [];
  const predicates = ids.map(
    (id) =>
      Prisma.sql`(metafields->'aovboost.variants') @> ${JSON.stringify([{ id }])}::jsonb`,
  );
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Product" WHERE shop = ${shop} AND (${Prisma.join(predicates, " OR ")}) LIMIT 100
  `);
  return rows.map((row) => row.id);
}
