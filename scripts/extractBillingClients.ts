import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { PrismaClient } from '@prisma/client';

type BillingClient = {
  legalName: string;
  address: string;
  cuit: string;
  cuitFormatted: string;
  validCuitChecksum: boolean;
  source: string;
};

const prisma = new PrismaClient();
const sourcePath = process.argv[2] || 'C:\\Users\\German\\Documents\\Adalberto\\DATOS FACTURACION.docx';
const companyIdArg = process.argv[3];
const OUT_DIR = path.resolve('analysis');

function cleanName(value: string) {
  return value.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
}

function cleanAddress(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function formatCuit(cuit: string) {
  const digits = cuit.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : cuit;
}

function validateCuit(cuit: string) {
  const digits = cuit.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = multipliers.reduce((acc, multiplier, index) => acc + Number(digits[index]) * multiplier, 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(digits[10]);
}

async function parseClients(filePath: string): Promise<BillingClient[]> {
  const result = await mammoth.extractRawText({ path: filePath });
  const lines = result.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !['APELLIDO Y NOMBRE/ RAZON SOCIAL', 'DOMICILIO COMERCIAL', 'CUIT'].includes(line.toUpperCase()));

  const clients: BillingClient[] = [];
  for (let index = 0; index < lines.length; index += 3) {
    const legalName = lines[index];
    const address = lines[index + 1];
    const cuit = lines[index + 2]?.replace(/\D/g, '');
    if (!legalName || !address || !cuit || !/^\d{11}$/.test(cuit)) continue;
    clients.push({
      legalName: cleanName(legalName),
      address: cleanAddress(address),
      cuit,
      cuitFormatted: formatCuit(cuit),
      validCuitChecksum: validateCuit(cuit),
      source: path.basename(filePath)
    });
  }
  return clients;
}

function toCsv(clients: BillingClient[]) {
  const headers = ['razon_social', 'domicilio_comercial', 'cuit', 'cuit_formateado', 'cuit_valido', 'fuente'];
  const rows = clients.map((client) => [
    client.legalName,
    client.address,
    client.cuit,
    client.cuitFormatted,
    client.validCuitChecksum ? 'SI' : 'NO',
    client.source
  ]);
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function toMarkdown(clients: BillingClient[]) {
  return [
    '# Clientes para facturacion',
    '',
    `Fuente: \`${sourcePath}\``,
    `Total: ${clients.length}`,
    '',
    '| Razon social | Domicilio comercial | CUIT | Valido |',
    '|---|---|---:|---:|',
    ...clients.map((client) =>
      `| ${client.legalName.replace(/\|/g, '/')} | ${client.address.replace(/\|/g, '/')} | ${client.cuitFormatted} | ${client.validCuitChecksum ? 'SI' : 'NO'} |`
    )
  ].join('\n');
}

async function importClients(clients: BillingClient[]) {
  const company =
    companyIdArg
      ? await prisma.company.findUnique({ where: { id: companyIdArg } })
      : await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) return { imported: 0, updated: 0, skipped: clients.length, company: null };

  let imported = 0;
  let updated = 0;
  for (const client of clients) {
    const existing = await prisma.customer.findFirst({ where: { companyId: company.id, cuit: client.cuit } });
    if (existing) {
      await prisma.customer.update({
        where: { id: existing.id },
        data: {
          legalName: client.legalName,
          address: client.address,
          notes: [existing.notes, `Datos de facturacion verificados desde ${client.source}. CUIT checksum: ${client.validCuitChecksum ? 'OK' : 'REVISAR'}`]
            .filter(Boolean)
            .join('\n')
        }
      });
      updated += 1;
      continue;
    }
    await prisma.customer.create({
      data: {
        companyId: company.id,
        legalName: client.legalName,
        cuit: client.cuit,
        address: client.address,
        taxCondition: 'Pendiente de confirmar',
        notes: `Importado desde ${client.source}. CUIT checksum: ${client.validCuitChecksum ? 'OK' : 'REVISAR'}`
      }
    });
    imported += 1;
  }
  return { imported, updated, skipped: 0, company: company.legalName };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const clients = await parseClients(sourcePath);
  await fs.writeFile(path.join(OUT_DIR, 'clientes-facturacion.json'), JSON.stringify(clients, null, 2), 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'clientes-facturacion.csv'), toCsv(clients), 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'clientes-facturacion.md'), toMarkdown(clients), 'utf8');
  const imported = await importClients(clients);
  console.log(JSON.stringify({ total: clients.length, imported, files: ['analysis/clientes-facturacion.json', 'analysis/clientes-facturacion.csv', 'analysis/clientes-facturacion.md'] }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

