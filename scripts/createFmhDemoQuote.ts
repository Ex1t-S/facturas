import { PrismaClient } from '../src/generated/postgres-client/index.js';
import { calculateQuoteTotals } from '../src/domain/money.js';
import { normalizeName } from '../src/services/normalize.js';

const prisma = new PrismaClient();
const companyIdArg = process.argv[2];

const demoCustomer = {
  legalName: 'CEREALES PASMAN S. A.',
  cuit: '30707823085',
  address: 'Pinelli 0 - Pasman, Buenos Aires',
  taxCondition: 'Pendiente de confirmar'
};

const demoItems = [
  {
    description:
      'Fabricar y montar extractor a sinfin de 90 ton/h, 10 m de largo y 300 mm de diametro. Incluye espira sinfin 60-110, eje en cano schedule 40 de 2", cabezal con reduccion marca Rattini de 15 hp, guillotina con cierre a cremallera y base de motor en chapa 1/4 con varillas roscadas de 1".',
    quantity: 1,
    unit: 'trabajo',
    unitPrice: 29178,
    taxRate: 21
  },
  {
    description:
      'Fabricar pie de noria en chapa 1/8 y hierro UPN 80, medidas estandar para noria de 90 ton/h. Incluye montaje de pie nuevo, corte de noria, sosten con patas de cano y adaptacion de pie.',
    quantity: 1,
    unit: 'trabajo',
    unitPrice: 23650,
    taxRate: 21
  },
  {
    description:
      'Proveer tres motores trifasicos nuevos de 15 hp x 1500 rpm para accionamiento de extractores, con base y preparacion para montaje.',
    quantity: 3,
    unit: 'unidad',
    unitPrice: 740,
    taxRate: 21
  }
];

async function ensureProduct(companyId: string, name: string, category: string, unit: string) {
  const normalizedName = normalizeName(name);
  const existing = await prisma.product.findFirst({ where: { companyId, normalizedName } });
  if (existing) return existing;
  return prisma.product.create({
    data: {
      companyId,
      name,
      normalizedName,
      category,
      type: category === 'Trabajo' ? 'SERVICE' : category === 'Material' ? 'MATERIAL' : 'PRODUCT',
      unit,
      price: 0,
      baseCost: 0,
      taxRate: 21,
      stockTracked: category !== 'Trabajo'
    }
  });
}

async function main() {
  const company =
    companyIdArg
      ? await prisma.company.findUnique({ where: { id: companyIdArg } })
      : await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) throw new Error('No company found.');

  const customer =
    (await prisma.customer.findFirst({ where: { companyId: company.id, cuit: demoCustomer.cuit } })) ??
    (await prisma.customer.create({ data: { companyId: company.id, ...demoCustomer } }));

  const products = await Promise.all([
    ensureProduct(company.id, 'Extractor a sinfin 90 ton/h diametro 300 mm', 'Equipo', 'unidad'),
    ensureProduct(company.id, 'Pie de noria para 90 ton/h en chapa 1/8 y UPN 80', 'Equipo', 'unidad'),
    ensureProduct(company.id, 'Motor trifasico 15 hp 1500 rpm', 'Componente', 'unidad')
  ]);

  const totals = calculateQuoteTotals(demoItems);
  const last = await prisma.quote.findFirst({ where: { companyId: company.id }, orderBy: { number: 'desc' } });
  const number = (last?.number ?? 0) + 1;

  const quote = await prisma.quote.create({
    data: {
      companyId: company.id,
      customerId: customer.id,
      number,
      status: 'DRAFT',
      currency: 'USD',
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      notes:
        'Presupuesto demo generado desde formatos historicos FMH. Revisar medidas finales, disponibilidad de materiales, plazo de entrega y condiciones de pago antes de enviar.',
      items: {
        create: demoItems.map((item, index) => ({
          productId: products[index]?.id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          total: totals.lines[index]?.total ?? 0
        }))
      }
    },
    include: { customer: true, items: true }
  });

  console.log(JSON.stringify({ quoteId: quote.id, number: quote.number, pdf: `/api/quotes/${quote.id}/pdf`, total: quote.total }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
