import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../src/generated/postgres-client/index.js';
import { normalizeName } from '../src/services/normalize.js';

type InventoryCandidate = {
  name: string;
  category: string;
  count: number;
};

type Summary = {
  inventoryCandidates: InventoryCandidate[];
};

const prisma = new PrismaClient();
const summaryPath = process.argv[2] || path.resolve('analysis/historical-summary.json');
const companyIdArg = process.argv[3];
const limit = Number(process.argv[4] || 100);

function productType(category: string) {
  if (category === 'Trabajo') return 'SERVICE';
  if (category === 'Material') return 'MATERIAL';
  return 'PRODUCT';
}

function cleanName(name: string) {
  return name
    .replace(/\s+-$/g, '')
    .replace(/\bextractore$/i, 'extractor')
    .replace(/\bcangilone$/i, 'cangilon')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8')) as Summary;
  const company =
    companyIdArg
      ? await prisma.company.findUnique({ where: { id: companyIdArg } })
      : await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!company) throw new Error('No company found. Create a company before importing inventory candidates.');

  const selected = summary.inventoryCandidates
    .map((candidate) => ({ ...candidate, name: cleanName(candidate.name) }))
    .filter((candidate) => candidate.name.length >= 4 && candidate.count >= 2)
    .slice(0, limit);

  const imported = [];
  const skipped = [];
  for (const candidate of selected) {
    const normalizedName = normalizeName(candidate.name);
    const existing = await prisma.product.findFirst({
      where: { companyId: company.id, OR: [{ normalizedName }, { name: { equals: candidate.name } }] }
    });
    if (existing) {
      skipped.push({ id: existing.id, name: existing.name });
      continue;
    }
    const product = await prisma.product.create({
      data: {
        companyId: company.id,
        name: candidate.name,
        normalizedName,
        type: productType(candidate.category),
        unit: candidate.category === 'Trabajo' ? 'trabajo' : 'unidad',
        category: candidate.category,
        price: 0,
        baseCost: 0,
        taxRate: 21,
        stockTracked: candidate.category === 'Material' || candidate.category === 'Componente',
        metadataJson: JSON.stringify({ source: 'historical-analysis', appearances: candidate.count })
      }
    });
    imported.push({ id: product.id, name: product.name, category: product.category, appearances: candidate.count });
  }

  console.log(JSON.stringify({ company: company.legalName, imported: imported.length, skipped: skipped.length, sample: imported.slice(0, 20) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
