import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import prisma from "../db.server";
import { getAppSettings } from "../models/settings.server";
import { catalogHash, normalizePairingMode } from "../models/pairingAutopilot";
import {
  generatePairingSuggestions,
  pairingProductSelect,
} from "./pairingSuggestions.server";
import {
  rollupPairingEvents,
  evaluatePairingPerformance,
} from "../models/pairingLearning.server";
import { claimExpiringKey } from "../redis.server";
export const PAIRING_LEASE_MS = 90_000;
export const PAIRING_DRAIN_SIZE = 3;
export const PAIRING_SEED_LIMIT = 50;
export async function markPairingDirty(shop: string, productIds: string[]) {
  const settings = await getAppSettings(shop);
  const products = await prisma.product.findMany({
    where: { shop, id: { in: [...new Set(productIds)].slice(0, 100) } },
    select: pairingProductSelect,
    take: 100,
  });
  for (const product of products) {
    const state = await prisma.productPairingState.findUnique({
      where: { shop_productId: { shop, productId: product.id } },
    });
    if (
      state?.status === "done" &&
      state.catalogHash === catalogHash(product, settings)
    )
      continue;
    await prisma.productPairingState.upsert({
      where: { shop_productId: { shop, productId: product.id } },
      create: { shop, productId: product.id },
      update: { status: "dirty", revision: { increment: 1 } },
    });
  }
}
export async function markPairingPolicyDirty(shop: string) {
  await prisma.productPairingState.updateMany({
    where: { shop },
    data: { status: "dirty", revision: { increment: 1 } },
  });
  schedulePairingDrain(shop, { seed: true });
}
export async function markPairingDeletionDirty(
  shop: string,
  targetProductId: string,
) {
  const rows = await prisma.productRelationship.findMany({
    where: { shop, targetProductId, kind: "complement" },
    select: { sourceProductId: true },
    take: 100,
  });
  await markPairingDirty(
    shop,
    rows.map((row) => row.sourceProductId),
  );
  // Deleting the target cascades its own state; affected source rows must retry even if their own catalog hash is unchanged.
  if (rows.length)
    await prisma.productPairingState.updateMany({
      where: {
        shop,
        productId: { in: rows.map((row) => row.sourceProductId) },
      },
      data: { status: "dirty", catalogHash: "", revision: { increment: 1 } },
    });
}
export async function seedPairingStates(shop: string) {
  // Only seed a bounded top-products set; never scan or rebuild the catalog cache.
  const ordered = await prisma.productOrderStat.findMany({
    where: { shop, orderCount: { gt: 0 } },
    select: { productId: true },
    orderBy: [{ orderCount: "desc" }, { productId: "asc" }],
    take: PAIRING_SEED_LIMIT,
  });
  const fill = await prisma.product.findMany({
    where: { shop, id: { notIn: ordered.map((row) => row.productId) } },
    select: { id: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: PAIRING_SEED_LIMIT - ordered.length,
  });
  const ids = [
    ...ordered.map((row) => row.productId),
    ...fill.map((row) => row.id),
  ];
  if (ids.length)
    await prisma.productPairingState.createMany({
      data: ids.map((productId, index) => ({
        shop,
        productId,
        priority: PAIRING_SEED_LIMIT - index,
      })),
      skipDuplicates: true,
    });
}
export async function drainPairings(
  shop: string,
  options: { seed?: boolean } = {},
) {
  const settings = await getAppSettings(shop);
  await rollupPairingEvents(shop);
  if (normalizePairingMode(settings.pairingMode) === "off")
    return { processed: 0 };
  if (
    options.seed ||
    !(await prisma.productPairingState.findFirst({
      where: { shop },
      select: { productId: true },
    }))
  )
    await seedPairingStates(shop);
  await evaluatePairingPerformance(shop, settings);
  const states = await prisma.productPairingState.findMany({
    where: {
      shop,
      status: "dirty",
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    orderBy: [{ priority: "desc" }, { productId: "asc" }],
    take: PAIRING_DRAIN_SIZE,
  });
  const token = randomUUID();
  const claimed: Array<{
    productId: string;
    revision: number;
    leaseToken: string;
  }> = [];
  for (const state of states) {
    const product = await prisma.product.findFirst({
      where: { shop, id: state.productId },
      select: pairingProductSelect,
    });
    if (product && state.catalogHash === catalogHash(product, settings)) {
      await prisma.productPairingState.updateMany({
        where: { shop, productId: state.productId, revision: state.revision },
        data: { status: "done" },
      });
      continue;
    }
    const result = await prisma.productPairingState.updateMany({
      where: {
        shop,
        productId: state.productId,
        status: "dirty",
        revision: state.revision,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + PAIRING_LEASE_MS),
      },
    });
    if (result.count)
      claimed.push({
        productId: state.productId,
        revision: state.revision,
        leaseToken: token,
      });
  }
  if (!claimed.length) return { processed: 0 };
  try {
    return await generatePairingSuggestions(
      shop,
      claimed.map((state) => state.productId),
      undefined,
      claimed,
    );
  } finally {
    await prisma.productPairingState.updateMany({
      where: { shop, leaseToken: token },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
}
export function schedulePairingDrain(
  shop: string,
  options: { seed?: boolean } = {},
) {
  // Do not start a detached promise on production hosts without a lifecycle hook.
  if (process.env.NODE_ENV === "production" && process.env.VERCEL !== "1")
    return false;
  const task = Promise.resolve()
    .then(async () => {
      if (
        !options.seed &&
        !(await claimExpiringKey(`pairing-drain:${shop}`, 15))
      )
        return;
      await drainPairings(shop, options);
    })
    .catch(() => {
      console.error(
        "AOVBoost bounded pairing drain failed; dirty state retained",
        { shop },
      );
    });
  try {
    waitUntil(task);
    return true;
  } catch {
    console.error("AOVBoost pairing lifecycle hook unavailable", { shop });
    return false;
  }
}
