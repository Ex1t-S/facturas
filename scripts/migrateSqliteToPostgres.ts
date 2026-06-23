import { PrismaClient as TargetPrisma } from '../src/generated/postgres-client/index.js';
import { PrismaClient as SourcePrisma } from '../src/generated/sqlite-client/index.js';

const source = new SourcePrisma();
const target = new TargetPrisma();

function chunk<T>(items: T[], size = 200) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function insertMany<T>(label: string, runner: (rows: T[]) => Promise<unknown>, rows: T[]) {
  if (!rows.length) {
    console.log(`${label}: 0`);
    return;
  }
  for (const batch of chunk(rows)) await runner(batch);
  console.log(`${label}: ${rows.length}`);
}

async function main() {
  console.log('Leyendo datos desde SQLite...');

  const [
    users,
    companies,
    customers,
    products,
    suppliers,
    documents,
    supplierPriceLists,
    supplierPrices,
    quotes,
    quoteItems,
    documentExtractions,
    documentItemCandidates,
    customerCandidates,
    inventoryStocks,
    invoices,
    invoiceItems,
    stockMovements,
    whatsappMessages,
    auditLogs
  ] = await Promise.all([
    source.user.findMany(),
    source.company.findMany(),
    source.customer.findMany(),
    source.product.findMany(),
    source.supplier.findMany(),
    source.document.findMany(),
    source.supplierPriceList.findMany(),
    source.supplierProductPrice.findMany(),
    source.quote.findMany(),
    source.quoteItem.findMany(),
    source.documentExtraction.findMany(),
    source.documentItemCandidate.findMany(),
    source.customerCandidate.findMany(),
    source.inventoryStock.findMany(),
    source.invoice.findMany(),
    source.invoiceItem.findMany(),
    source.stockMovement.findMany(),
    source.whatsAppMessage.findMany(),
    source.auditLog.findMany()
  ]);

  console.log('Limpiando Neon...');
  await target.$transaction([
    target.auditLog.deleteMany(),
    target.whatsAppMessage.deleteMany(),
    target.stockMovement.deleteMany(),
    target.invoiceItem.deleteMany(),
    target.invoice.deleteMany(),
    target.inventoryStock.deleteMany(),
    target.customerCandidate.deleteMany(),
    target.documentItemCandidate.deleteMany(),
    target.documentExtraction.deleteMany(),
    target.quoteItem.deleteMany(),
    target.quote.deleteMany(),
    target.supplierProductPrice.deleteMany(),
    target.supplierPriceList.deleteMany(),
    target.document.deleteMany(),
    target.supplier.deleteMany(),
    target.product.deleteMany(),
    target.customer.deleteMany(),
    target.company.deleteMany(),
    target.user.deleteMany()
  ]);

  console.log('Copiando datos a Neon...');
  await insertMany('users', (rows) => target.user.createMany({ data: rows, skipDuplicates: true }), users);
  await insertMany('companies', (rows) => target.company.createMany({ data: rows, skipDuplicates: true }), companies);
  await insertMany('customers', (rows) => target.customer.createMany({ data: rows, skipDuplicates: true }), customers);
  await insertMany('products', (rows) => target.product.createMany({ data: rows, skipDuplicates: true }), products);
  await insertMany('suppliers', (rows) => target.supplier.createMany({ data: rows, skipDuplicates: true }), suppliers);
  await insertMany('documents', (rows) => target.document.createMany({ data: rows, skipDuplicates: true }), documents);
  await insertMany(
    'supplierPriceLists',
    (rows) => target.supplierPriceList.createMany({ data: rows, skipDuplicates: true }),
    supplierPriceLists
  );
  await insertMany(
    'supplierPrices',
    (rows) => target.supplierProductPrice.createMany({ data: rows, skipDuplicates: true }),
    supplierPrices
  );
  await insertMany('quotes', (rows) => target.quote.createMany({ data: rows, skipDuplicates: true }), quotes);
  await insertMany('quoteItems', (rows) => target.quoteItem.createMany({ data: rows, skipDuplicates: true }), quoteItems);
  await insertMany(
    'documentExtractions',
    (rows) => target.documentExtraction.createMany({ data: rows, skipDuplicates: true }),
    documentExtractions
  );
  await insertMany(
    'documentItemCandidates',
    (rows) => target.documentItemCandidate.createMany({ data: rows, skipDuplicates: true }),
    documentItemCandidates
  );
  await insertMany(
    'customerCandidates',
    (rows) => target.customerCandidate.createMany({ data: rows, skipDuplicates: true }),
    customerCandidates
  );
  await insertMany(
    'inventoryStocks',
    (rows) => target.inventoryStock.createMany({ data: rows, skipDuplicates: true }),
    inventoryStocks
  );
  await insertMany('invoices', (rows) => target.invoice.createMany({ data: rows, skipDuplicates: true }), invoices);
  await insertMany(
    'invoiceItems',
    (rows) => target.invoiceItem.createMany({ data: rows, skipDuplicates: true }),
    invoiceItems
  );
  await insertMany(
    'stockMovements',
    (rows) => target.stockMovement.createMany({ data: rows, skipDuplicates: true }),
    stockMovements
  );
  await insertMany(
    'whatsappMessages',
    (rows) => target.whatsAppMessage.createMany({ data: rows, skipDuplicates: true }),
    whatsappMessages
  );
  await insertMany('auditLogs', (rows) => target.auditLog.createMany({ data: rows, skipDuplicates: true }), auditLogs);

  console.log('Migracion completada.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
