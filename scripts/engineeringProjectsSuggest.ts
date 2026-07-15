import { prisma } from '../src/db.js';
import { suggestEngineeringProjects } from '../src/services/engineering/engineeringCuration.js';

const companyId = process.argv[2];
if (!companyId) throw new Error('Uso: npm run engineering:projects:suggest -- <companyId>');
const suggestions = await suggestEngineeringProjects(companyId);
console.log(JSON.stringify({ suggested: suggestions.length, suggestions }, null, 2));
await prisma.$disconnect();
