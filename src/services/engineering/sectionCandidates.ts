import { prisma } from '../../db.js';
import { normalizeEngineeringText, parseEngineeringNumber } from './engineeringIntelligence.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';

export type SectionCandidate = {
  id: string;
  designation: string;
  material?: string;
  kgPerM?: number;
  areaMm2?: number;
  ixMm4?: number;
  iyMm4?: number;
  source: 'STRUCTURAL_CATALOG' | 'INVENTORY' | 'HISTORICAL' | 'USER';
  sourceTitle: string;
  verified: boolean;
  stockQuantity?: number;
  stockUnit?: string;
  currentPrice?: number;
  currency?: string;
  priceObservedAt?: string;
  propertyMissing?: string[];
};

function metadataValue(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(metadata[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function parseMetadata(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

export function parseRectangularHollowDesignation(value: string) {
  const match = normalizeEngineeringText(value).match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*mm?\b/i);
  if (!match) return {};
  const width = Number(match[1]);
  const height = Number(match[2]);
  const thickness = parseEngineeringNumber(match[3]);
  if (width <= 2 * thickness || height <= 2 * thickness) return {};
  const innerWidth = width - 2 * thickness;
  const innerHeight = height - 2 * thickness;
  const areaMm2 = width * height - innerWidth * innerHeight;
  const ixMm4 = (width * height ** 3 - innerWidth * innerHeight ** 3) / 12;
  const iyMm4 = (height * width ** 3 - innerHeight * innerWidth ** 3) / 12;
  return { areaMm2, ixMm4, iyMm4, kgPerM: areaMm2 * 0.00785, designation: `${width}x${height}x${String(thickness).replace('.', ',')} mm` };
}

export async function searchEngineeringSectionCandidates(companyId: string, query: string, take = 12) {
  const terms = ['caño', 'cano', 'tubo', 'perfil', 'estructural', 'upn', 'ipn', 'ipe', 'hea', 'heb'];
  const queryTerms = normalizeEngineeringText(query).split(/\s+/).map((term) => term.trim()).filter((term) => term.length >= 2).slice(0, 8);
  const [catalogRows, products] = await Promise.all([prisma.structuralSection.findMany({
    where: { companyId, ...(queryTerms.length ? { OR: queryTerms.flatMap((term) => [{ designation: { contains: term } }, { type: { contains: term } }, { material: { contains: term } }]) } : {}) },
    orderBy: [{ verified: 'desc' }, { massPerMeter: 'asc' }],
    take: Math.max(take * 2, 24)
  }), prisma.product.findMany({
    where: { companyId, active: true, type: 'MATERIAL', OR: terms.flatMap((term) => [{ name: { contains: term } }, { category: { contains: term } }, { description: { contains: term } }]) },
    include: { stocks: true, supplierPrices: { orderBy: { observedAt: 'desc' }, take: 1 } },
    take: Math.max(take * 4, 24)
  })]);
  const catalog = catalogRows.map((row) => ({
    id: row.id,
    designation: row.designation,
    material: row.material || undefined,
    kgPerM: row.massPerMeter || undefined,
    areaMm2: row.area || undefined,
    ixMm4: row.ix || undefined,
    iyMm4: row.iy || undefined,
    source: 'STRUCTURAL_CATALOG' as const,
    sourceTitle: row.source,
    verified: row.verified,
    propertyMissing: ['area', 'massPerMeter', 'ix', 'iy', 'rx', 'ry'].filter((property) => row[property as keyof typeof row] === null || row[property as keyof typeof row] === undefined)
  } satisfies SectionCandidate));
  const inventory = products.map((product) => {
    const metadata = parseMetadata(product.metadataJson);
    const parsed = parseRectangularHollowDesignation(product.name);
    const stock = product.stocks.reduce((sum, item) => sum + Number(item.quantity) - Number(item.reserved), 0);
    const price = product.supplierPrices[0];
    return {
      id: product.id,
      designation: product.name,
      material: String(metadata.material || 'acero al carbono'),
      kgPerM: metadataValue(metadata, ['kgPerM', 'weightPerM', 'unitWeightKgM', 'kg_m']) || parsed.kgPerM,
      areaMm2: metadataValue(metadata, ['areaMm2', 'area']) || parsed.areaMm2,
      ixMm4: metadataValue(metadata, ['ixMm4', 'ix']) || parsed.ixMm4,
      iyMm4: metadataValue(metadata, ['iyMm4', 'iy']) || parsed.iyMm4,
      source: 'INVENTORY' as const,
      sourceTitle: 'Producto/inventario FMH',
      verified: Boolean(metadata.verified),
      stockQuantity: stock,
      stockUnit: product.unit,
      currentPrice: price && Number(price.price) > 0 ? Number(price.price) : Number(product.price) > 0 ? Number(product.price) : undefined,
      currency: price?.currency || 'ARS',
      priceObservedAt: price?.observedAt?.toISOString()
    } satisfies SectionCandidate;
  });
  const historical = await searchEngineeringKnowledge({ companyId, q: `${query} caño perfil tubo estructura`, take: Math.max(3, Math.floor(take / 2)) });
  const references = historical.sources.map((source) => ({ id: source.id, designation: source.title, source: 'HISTORICAL' as const, sourceTitle: source.title, verified: false } satisfies SectionCandidate));
  return [...catalog, ...inventory.filter((item) => item.areaMm2 && item.ixMm4 && item.iyMm4), ...references].slice(0, take) as SectionCandidate[];
}
