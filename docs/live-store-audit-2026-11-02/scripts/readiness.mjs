import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
const db = new PrismaClient({log: []});
try {
  const result = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
    const shops = await tx.shop.findMany({select:{shopDomain:true, installedAt:true, scope:true},take:25});
    const rows = [];
    for (const shop of shops) {
      const domain = shop.shopDomain;
      const products = await tx.product.count({where:{shop:domain}});
      const newestProduct = await tx.product.findFirst({where:{shop:domain},orderBy:{updatedAt:'desc'},select:{updatedAt:true}});
      const offline = await tx.session.findFirst({where:{shop:domain,isOnline:false},select:{expires:true,scope:true,refreshTokenExpires:true}});
      const settings = await tx.appSettings.findUnique({where:{shop:domain},select:{chatEnabled:true,bundlesEnabled:true,upsellEnabled:true,analyticsEnabled:true,proactiveMessagesEnabled:true,discountPermission:true,storeKnowledge:true,brandVoice:true,updatedAt:true}});
      const sync = await tx.catalogSyncJob.findUnique({where:{shop:domain},select:{phase:true,syncedCount:true,error:true,updatedAt:true}});
      const lastActivity = await tx.shopperSession.findFirst({where:{shop:domain},orderBy:{lastActivityAt:'desc'},select:{lastActivityAt:true}});
      rows.push({...shop,products,newestProductUpdatedAt:newestProduct?.updatedAt||null,offlineSession:offline,settings:settings?{...settings,storeKnowledge:undefined,brandVoice:undefined,hasStoreKnowledge:!!settings.storeKnowledge?.trim(),hasBrandVoice:!!settings.brandVoice?.trim()}:null,sync,lastShopperActivity:lastActivity?.lastActivityAt||null});
    }
    const migrations = await tx.$queryRawUnsafe('SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 4');
    return {recordedAt:new Date().toISOString(),shops:rows,migrations};
  },{timeout:25000});
  await writeFile('tmp/live-store-audit/results/readiness.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
