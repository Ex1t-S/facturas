import path from 'node:path';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { ingestEngineeringKnowledge } from '../src/services/engineering/engineeringIngestion.js';
import { syncEngineeringSources, syncEngineeringSourcesOffline } from '../src/services/engineering/engineeringSourceImporter.js';

const offline = process.argv.includes('--offline') || !/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '');
const result = offline ? await syncEngineeringSourcesOffline(process.argv.find((arg) => arg.endsWith('.json'))) : await syncEngineeringSources(process.argv[2]);
const downloaded = result.results.filter((item) => item.localFilePath && item.fileHash);
const storageRoot = path.resolve(config.ENGINEERING_SOURCE_STORAGE_ROOT);
let extracted = 0;
if (!offline && downloaded.length) {
  await ingestEngineeringKnowledge({ rootPath: storageRoot });
  for (const item of downloaded) {
    if (!item.fileHash) continue;
    const source = await prisma.engineeringSource.findUnique({ where: { id: item.id } });
    const document = await prisma.engineeringKnowledgeDocument.findFirst({ where: { sha256: item.fileHash, companyId: null } });
    if (source && document) {
      await prisma.engineeringKnowledgeDocument.update({ where: { id: document.id }, data: { sourceId: source.id } });
      await prisma.engineeringSource.update({ where: { id: source.id }, data: { documentId: document.id } });
      extracted += 1;
    }
  }
}
if (offline) await (await import('node:fs/promises')).writeFile('docs/engineering-source-sync-report.json', JSON.stringify({ ...result, mode: 'OFFLINE_NO_DATABASE', generatedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ ...result, mode: offline ? 'OFFLINE_NO_DATABASE' : 'DATABASE', documentsLinked: extracted }, null, 2));
await prisma.$disconnect();
