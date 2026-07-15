import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { ingestEngineeringDrawings } from '../src/services/engineering/drawingLibrary.js';

const [companyId, rootPath] = process.argv.slice(2);
if (!companyId) throw new Error('Uso: npm run engineering:drawings:process -- <companyId> [rootPath]');
const result = await ingestEngineeringDrawings({ companyId, rootPath: rootPath || config.ENGINEERING_DRAWINGS_ROOT || config.ENGINEERING_KNOWLEDGE_ROOT || config.HISTORICAL_DOCUMENT_ROOT });
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
