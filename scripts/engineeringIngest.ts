import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { ingestEngineeringKnowledge } from '../src/services/engineering/engineeringIngestion.js';

const rootPath = process.argv[2] || config.ENGINEERING_KNOWLEDGE_ROOT || config.HISTORICAL_DOCUMENT_ROOT;
const company = await prisma.company.findFirst();
if (!company) throw new Error('No hay empresa cargada. Ejecutá primero el seed o cargá una empresa.');
const result = await ingestEngineeringKnowledge({ rootPath, companyId: company.id });
console.log(JSON.stringify(result, null, 2));
await prisma.$disconnect();
