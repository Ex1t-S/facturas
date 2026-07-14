import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { ingestEngineeringDrawings } from '../src/services/engineering/drawingLibrary.js';

const rootPath = process.argv[2] || config.ENGINEERING_DRAWINGS_ROOT || config.ENGINEERING_KNOWLEDGE_ROOT || config.HISTORICAL_DOCUMENT_ROOT;
const company = await prisma.company.findFirst();
if (!company) throw new Error('No hay una empresa configurada.');
console.log(JSON.stringify(await ingestEngineeringDrawings({ companyId: company.id, rootPath }), null, 2));
await prisma.$disconnect();
