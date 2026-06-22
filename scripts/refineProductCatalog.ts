import { PrismaClient } from '@prisma/client';
import { normalizeName } from '../src/services/normalize.js';

const prisma = new PrismaClient();
const companyIdArg = process.argv[2];

const replacements: Record<string, { name: string; category: string; unit?: string; aliases?: string[] }> = {
  noria: { name: 'Noria elevadora de granos', category: 'Equipo', aliases: ['noria', 'noria elevadora'] },
  sinfines: { name: 'Transportador a sinfin', category: 'Equipo', aliases: ['sinfin', 'sinfines', 'transportador a sinfin'] },
  'sinfín': { name: 'Transportador a sinfin', category: 'Equipo', aliases: ['sinfin', 'sinfín'] },
  chapa: { name: 'Chapa de acero', category: 'Material', aliases: ['chapa'] },
  motor: { name: 'Motor electrico trifasico', category: 'Componente', aliases: ['motor', 'motores'] },
  motores: { name: 'Motor electrico trifasico', category: 'Componente', aliases: ['motor', 'motores'] },
  'chapa galvanizada': { name: 'Chapa galvanizada', category: 'Material', aliases: ['chapa galvanizada'] },
  'chapa 1/8': { name: 'Chapa de acero 1/8"', category: 'Material', aliases: ['chapa 1/8'] },
  distribuidor: { name: 'Distribuidor de granos', category: 'Equipo', aliases: ['distribuidor'] },
  extractores: { name: 'Extractor a sinfin', category: 'Equipo', aliases: ['extractor', 'extractores'] },
  guillotina: { name: 'Guillotina con cierre a cremallera', category: 'Componente', aliases: ['guillotina'] },
  'metal desplegado': { name: 'Metal desplegado', category: 'Material' },
  cangilones: { name: 'Cangilones para noria', category: 'Componente', aliases: ['cangilon', 'cangilones'] },
  'chapa estampada': { name: 'Chapa estampada', category: 'Material' },
  'upn 80': { name: 'Perfil UPN 80', category: 'Material', aliases: ['upn 80'] },
  'upn 60': { name: 'Perfil UPN 60', category: 'Material', aliases: ['upn 60'] },
  'ipn 200': { name: 'Perfil IPN 200', category: 'Material', aliases: ['ipn 200'] },
  'chapa acanalada': { name: 'Chapa acanalada cincalum', category: 'Material', aliases: ['chapa acanalada'] },
  barredor: { name: 'Barredor de silo', category: 'Equipo', aliases: ['barredor'] },
  'chapa negra': { name: 'Chapa negra de acero', category: 'Material', aliases: ['chapa negra'] },
  'montaje de noria': { name: 'Servicio de montaje de noria', category: 'Trabajo', unit: 'trabajo' },
  'montaje de silo': { name: 'Servicio de montaje de silo', category: 'Trabajo', unit: 'trabajo' },
  'montaje de estructura': { name: 'Servicio de montaje de estructura metalica', category: 'Trabajo', unit: 'trabajo' },
  'chapa 3/16': { name: 'Chapa de acero 3/16"', category: 'Material', aliases: ['chapa 3/16'] },
  'cinta noria': { name: 'Cinta para noria', category: 'Componente', aliases: ['cinta noria'] },
  'caño 250 mm': { name: 'Cano diametro 250 mm', category: 'Material', aliases: ['caño 250 mm', 'cano 250 mm'] },
  'caño 320 mm': { name: 'Cano diametro 320 mm', category: 'Material', aliases: ['caño 320 mm', 'cano 320 mm'] },
  'caño schedulle 40': { name: 'Cano schedule 40', category: 'Material', aliases: ['caño schedule 40', 'cano schedule 40'] },
  'motor de 15 hp': { name: 'Motor electrico trifasico 15 hp', category: 'Componente', aliases: ['motor 15 hp'] },
  'motor 10 hp': { name: 'Motor electrico trifasico 10 hp', category: 'Componente', aliases: ['motor 10 hp'] },
  'cinta transportadora': { name: 'Cinta transportadora', category: 'Componente' },
  'cambio de rodamientos': { name: 'Servicio de cambio de rodamientos', category: 'Trabajo', unit: 'trabajo' },
  'fabricación de extractor': { name: 'Fabricacion de extractor a sinfin', category: 'Trabajo', unit: 'trabajo' },
  'fabricación de estructura': { name: 'Fabricacion de estructura metalica', category: 'Trabajo', unit: 'trabajo' },
  'fabricación de silo': { name: 'Fabricacion de silo', category: 'Trabajo', unit: 'trabajo' },
  'reparación silo': { name: 'Servicio de reparacion de silo', category: 'Trabajo', unit: 'trabajo' },
  'montaje de extractor': { name: 'Servicio de montaje de extractor', category: 'Trabajo', unit: 'trabajo' }
};

function productType(category: string) {
  if (category === 'Trabajo') return 'SERVICE';
  if (category === 'Material') return 'MATERIAL';
  return 'PRODUCT';
}

async function main() {
  const company =
    companyIdArg
      ? await prisma.company.findUnique({ where: { id: companyIdArg } })
      : await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) throw new Error('No company found.');

  const products = await prisma.product.findMany({ where: { companyId: company.id } });
  const updates = [];
  for (const product of products) {
    const key = normalizeName(product.name);
    const replacement = replacements[key];
    if (!replacement) continue;
    const aliases = Array.from(new Set([...(replacement.aliases ?? []), product.name]));
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: {
        name: replacement.name,
        normalizedName: normalizeName(replacement.name),
        category: replacement.category,
        unit: replacement.unit ?? product.unit,
        type: productType(replacement.category),
        aliasesJson: JSON.stringify(aliases),
        metadataJson: JSON.stringify({
          ...(product.metadataJson ? JSON.parse(product.metadataJson) : {}),
          refinedFrom: product.name,
          refinedAt: new Date().toISOString()
        })
      }
    });
    updates.push({ from: product.name, to: updated.name });
  }

  console.log(JSON.stringify({ company: company.legalName, updated: updates.length, sample: updates.slice(0, 40) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

