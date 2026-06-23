import { PrismaClient } from '../src/generated/postgres-client/index.js';
import { calculateQuoteTotals } from '../src/domain/money.js';

const prisma = new PrismaClient();

const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');

async function main() {
  const company = await prisma.company.upsert({
    where: { cuit: '30700000001' },
    update: {},
    create: {
      legalName: 'Metalúrgica Demo SRL',
      tradeName: 'Metalúrgica Demo',
      cuit: '30700000001',
      taxCondition: 'Responsable Inscripto',
      address: 'Parque industrial',
      phone: '+54 9 11 0000-0000',
      email: 'admin@metalurgica-demo.local'
    }
  });

  const customer = await prisma.customer.upsert({
    where: { id: 'demo-customer' },
    update: { companyId: company.id },
    create: {
      id: 'demo-customer',
      companyId: company.id,
      legalName: 'Cliente Industrial Demo SA',
      cuit: '30711111118',
      taxCondition: 'Responsable Inscripto',
      contactName: 'Compras',
      phone: '+54 9 11 1111-1111'
    }
  });

  const products = [
    { sku: 'MAT-CH-18', name: 'Chapa 1/8 1.22x2.44', category: 'Material', unit: 'unidad', price: 42000, type: 'MATERIAL' },
    { sku: 'SRV-PLEG', name: 'Servicio de plegado', category: 'Servicio', unit: 'hora', price: 18000, type: 'SERVICE' },
    { sku: 'FAB-PIEZA', name: 'Fabricación de pieza según plano', category: 'Producto', unit: 'unidad', price: 65000, type: 'PRODUCT' }
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: `demo-${product.sku}` },
      update: {
        companyId: company.id,
        normalizedName: normalizedName(product.name)
      },
      create: {
        id: `demo-${product.sku}`,
        companyId: company.id,
        sku: product.sku,
        name: product.name,
        normalizedName: normalizedName(product.name),
        category: product.category,
        unit: product.unit,
        price: product.price,
        type: product.type,
        stockTracked: product.type !== 'SERVICE'
      }
    });
  }

  const existingQuote = await prisma.quote.findFirst({ where: { companyId: company.id, number: 1 } });
  if (!existingQuote) {
    const items = [
      { description: 'Fabricación de pieza según plano', quantity: 2, unitPrice: 65000, taxRate: 21 },
      { description: 'Servicio de plegado', quantity: 3, unitPrice: 18000, taxRate: 21 }
    ];
    const totals = calculateQuoteTotals(items);
    await prisma.quote.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        number: 1,
        status: 'SENT',
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        notes: 'Presupuesto demo para validar el flujo operativo.',
        items: {
          create: items.map((item, index) => ({
            ...item,
            total: totals.lines[index]?.total ?? 0
          }))
        }
      }
    });
  }

  const suppliers = [
    { name: 'Codimat', website: 'https://codimat.com.ar/', phone: '(0291) 459-2400' },
    { name: 'Rattini', website: 'https://rattini.com.ar/', phone: '+54 9 3585 483 356' },
    { name: 'Proveedor Local Demo', website: 'https://example.local/' }
  ];

  const supplierRecords = new Map<string, string>();
  for (const supplier of suppliers) {
    const record = await prisma.supplier.upsert({
      where: { companyId_name: { companyId: company.id, name: supplier.name } },
      update: supplier,
      create: { companyId: company.id, ...supplier }
    });
    supplierRecords.set(supplier.name, record.id);
  }

  const priceLists = [
    {
      supplier: 'Codimat',
      name: 'Lista Codimat demo',
      items: [
        { productId: 'demo-MAT-CH-18', rawName: 'Chapa 1/8 1.22x2.44', unit: 'unidad', price: 40500 },
        { productId: 'demo-FAB-PIEZA', rawName: 'Fabricación de pieza según plano', unit: 'unidad', price: 62000 }
      ]
    },
    {
      supplier: 'Rattini',
      name: 'Lista Rattini demo',
      items: [
        { rawName: 'Reductor rosca transportadora', unit: 'unidad', price: 285000 },
        { rawName: 'Caja inversora diametro 25', unit: 'unidad', price: 198000 }
      ]
    },
    {
      supplier: 'Proveedor Local Demo',
      name: 'Lista local demo',
      items: [
        { productId: 'demo-MAT-CH-18', rawName: 'Chapa 1/8 1.22 x 2.44', unit: 'unidad', price: 39750 },
        { productId: 'demo-SRV-PLEG', rawName: 'Servicio plegado', unit: 'hora', price: 17000 }
      ]
    }
  ];

  for (const list of priceLists) {
    const supplierId = supplierRecords.get(list.supplier);
    if (!supplierId) continue;
    const exists = await prisma.supplierPriceList.findFirst({ where: { companyId: company.id, supplierId, name: list.name } });
    if (exists) continue;
    await prisma.supplierPriceList.create({
      data: {
        companyId: company.id,
        supplierId,
        name: list.name,
        sourceType: 'demo',
        prices: {
          create: list.items.map((item) => ({
            companyId: company.id,
            supplierId,
            productId: item.productId,
            rawName: item.rawName,
            normalizedName: normalizedName(item.rawName),
            unit: item.unit,
            price: item.price,
            currency: 'ARS',
            taxIncluded: true
          }))
        }
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
