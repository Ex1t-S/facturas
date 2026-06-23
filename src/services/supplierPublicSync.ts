import { prisma } from '../db.js';
import { bestTechnicalSimilarity, normalizeName, similarity } from './normalize.js';

type PublicSupplierSource = {
  name: string;
  website: string;
  method: 'scrape' | 'catalog' | 'manual_quote';
  notes: string;
  pages: string[];
  keywords: string[];
};

type ScrapedPrice = {
  name: string;
  sku?: string;
  price: number;
  url: string;
};

const sources: PublicSupplierSource[] = [
  {
    name: 'Sidercon',
    website: 'https://www.sidercon.com/',
    method: 'scrape',
    notes: 'Precios públicos visibles para perfiles y retazos. Scraping liviano cada 4 h.',
    pages: [
      'https://www.sidercon.com/productos/categoria/04-perfiles-upn-x-12-m/',
      'https://www.sidercon.com/productos/categoria/03-perfiles-ipn-x-12-m/'
    ],
    keywords: ['upn', 'ipn', 'perfil', 'retazo']
  },
  {
    name: 'Chapaferro',
    website: 'https://chapaferro.com.ar/',
    method: 'scrape',
    notes: 'Ecommerce con precios públicos en algunos perfiles/chapa. Usar como referencia, no costo definitivo.',
    pages: [
      'https://chapaferro.com.ar/productos/hierros-y-perfiles/ipn/',
      'https://chapaferro.com.ar/productos/hierros-y-perfiles/upn/'
    ],
    keywords: ['perfil', 'ipn', 'upn', 'chapa']
  },
  {
    name: 'Codimat',
    website: 'https://catalogocodimat.mitiendanube.com/',
    method: 'catalog',
    notes: 'Catálogo Tiendanube útil para metalúrgica/materiales, pero los precios públicos aparecen en $0 o por presupuesto. Pedir lista/API autorizada.',
    pages: ['https://catalogocodimat.mitiendanube.com/productos/'],
    keywords: ['metalurgica', 'chapa', 'hierro', 'perfil', 'agro']
  },
  {
    name: 'Rattini',
    website: 'https://rattini.com.ar/',
    method: 'manual_quote',
    notes: 'Reductores y transmisión para agroindustria. No expone precios públicos; integrar por cotización.',
    pages: ['https://rattini.com.ar/'],
    keywords: ['reductor', 'agroindustria', 'transmision']
  }
];

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
  );
}

function parsePrice(value: string) {
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const price = Number(normalized);
  return Number.isFinite(price) ? price : 0;
}

function parsePublicPrices(html: string, source: PublicSupplierSource, url: string): ScrapedPrice[] {
  const lines = htmlToText(html)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const prices: ScrapedPrice[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\$\s*[\d.]+,\d{2}/.test(line)) continue;
    const price = parsePrice(line);
    if (price <= 0) continue;

    const context = lines.slice(Math.max(0, index - 6), index).join(' ');
    const hasKeyword = source.keywords.some((keyword) => normalizeName(context).includes(keyword));
    if (!hasKeyword) continue;

    const sku = context.match(/\b\d{6,}\b/)?.[0];
    const cleaned = context
      .replace(/\b(stock|agregar|precio|oferta|envio gratis|0% off)\b/gi, ' ')
      .replace(/\b\d{6,}\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const name = cleaned.split(' ').slice(-18).join(' ');
    if (name.length < 5) continue;
    prices.push({ name, sku, price, url });
  }

  const seen = new Set<string>();
  return prices.filter((item) => {
    const key = `${normalizeName(item.name)}-${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'FMH-cost-sync/1.0 (+internal price reference; contact owner for removal)',
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function matchProduct(products: Awaited<ReturnType<typeof prisma.product.findMany>>, rawName: string) {
  const normalized = normalizeName(rawName);
  return products
    .map((product) => ({
      product,
      score: Math.max(
        similarity(product.name, rawName),
        similarity(product.normalizedName || product.name, normalized),
        bestTechnicalSimilarity(rawName, [
          product.name,
          product.normalizedName || '',
          product.aliasesJson || '',
          product.metadataJson || ''
        ])
      )
    }))
    .filter((item) => item.score >= 0.52)
    .sort((a, b) => b.score - a.score)[0]?.product;
}

export async function syncPublicSupplierPrices(companyId: string) {
  const products = await prisma.product.findMany({
    where: { companyId, active: true, type: 'MATERIAL' },
    take: 1000
  });
  const result = {
    startedAt: new Date(),
    sources: [] as Array<{ supplier: string; method: string; imported: number; skipped: number; errors: string[] }>
  };

  for (const source of sources) {
    const supplier = await prisma.supplier.upsert({
      where: { companyId_name: { companyId, name: source.name } },
      update: { website: source.website, notes: source.notes, active: true },
      create: { companyId, name: source.name, website: source.website, notes: source.notes, active: true }
    });
    const sourceResult = { supplier: source.name, method: source.method, imported: 0, skipped: 0, errors: [] as string[] };

    if (source.method !== 'scrape') {
      result.sources.push(sourceResult);
      continue;
    }

    const priceList = await prisma.supplierPriceList.create({
      data: {
        companyId,
        supplierId: supplier.id,
        name: `Scraping público ${new Date().toLocaleString('es-AR')}`,
        sourceType: 'public_scrape',
        currency: 'ARS',
        notes: source.notes
      }
    });

    for (const page of source.pages) {
      try {
        const html = await fetchHtml(page);
        const prices = parsePublicPrices(html, source, page).slice(0, 80);
        for (const item of prices) {
          const product = await matchProduct(products, item.name);
          const duplicate = await prisma.supplierProductPrice.findFirst({
            where: {
              companyId,
              supplierId: supplier.id,
              supplierSku: item.sku ?? null,
              normalizedName: normalizeName(item.name),
              price: item.price,
              observedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2) }
            }
          });
          if (duplicate) {
            sourceResult.skipped += 1;
            continue;
          }
          await prisma.supplierProductPrice.create({
            data: {
              companyId,
              supplierId: supplier.id,
              priceListId: priceList.id,
              productId: product?.id,
              supplierSku: item.sku,
              rawName: item.name,
              normalizedName: normalizeName(item.name),
              unit: 'unidad',
              currency: 'ARS',
              price: item.price,
              taxIncluded: true,
              available: true,
              notes: `Fuente pública: ${item.url}`
            }
          });
          sourceResult.imported += 1;
        }
      } catch (error) {
        sourceResult.errors.push(`${page}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    result.sources.push(sourceResult);
  }

  return result;
}

export function publicSupplierSources() {
  return sources.map(({ name, website, method, notes, pages }) => ({ name, website, method, notes, pages }));
}
