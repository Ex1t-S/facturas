import { prisma } from '../../db.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';

export type SectionCandidate = {
  id: string;
  designation: string;
  material?: string;
  kgPerM?: number;
  areaMm2?: number;
  ixMm4?: number;
  iyMm4?: number;
  source: 'INVENTORY' | 'HISTORICAL' | 'USER';
  sourceTitle: string;
  verified: boolean;
  stockQuantity?: number;
  stockUnit?: string;
  currentPrice?: number;
  currency?: string;
  priceObservedAt?: string;
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

export async function searchEngineeringSectionCandidates(companyId: string, query: string, take = 12) {
  const products = await prisma.product.findMany({
    where: { companyId, active: true, OR: [{ name: { contains: query } }, { category: { contains: query } }, { description: { contains: query } }, { name: { contains: 'caño' } }, { name: { contains: 'perfil' } }, { name: { contains: 'tubo' } }] },
    include: { stocks: true, supplierPrices: { orderBy: { observedAt: 'desc' }, take: 1 } },
    take
  });
  const inventory = products.map((product) => {
    const metadata = parseMetadata(product.metadataJson);
    const stock = product.stocks.reduce((sum, item) => sum + Number(item.quantity) - Number(item.reserved), 0);
    const price = product.supplierPrices[0];
    return {
      id: product.id,
      designation: product.name,
      material: String(metadata.material || 'acero al carbono'),
      kgPerM: metadataValue(metadata, ['kgPerM', 'weightPerM', 'unitWeightKgM', 'kg_m']),
      areaMm2: metadataValue(metadata, ['areaMm2', 'area']),
      ixMm4: metadataValue(metadata, ['ixMm4', 'ix']),
      iyMm4: metadataValue(metadata, ['iyMm4', 'iy']),
      source: 'INVENTORY' as const,
      sourceTitle: 'Producto/inventario FMH',
      verified: Boolean(metadata.verified),
      stockQuantity: stock,
      stockUnit: product.unit,
      currentPrice: price ? Number(price.price) : Number(product.price) || undefined,
      currency: price?.currency || 'ARS',
      priceObservedAt: price?.observedAt?.toISOString()
    } satisfies SectionCandidate;
  });
  const historical = await searchEngineeringKnowledge({ companyId, q: `${query} caño perfil tubo estructura`, take: Math.max(3, Math.floor(take / 2)) });
  const references = historical.sources.map((source) => ({ id: source.id, designation: source.title, source: 'HISTORICAL' as const, sourceTitle: source.title, verified: false } satisfies SectionCandidate));
  return [...inventory, ...references] as SectionCandidate[];
}
