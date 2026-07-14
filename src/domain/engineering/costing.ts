export type CostLine = { description: string; quantity: number; unit: string; unitPrice?: number; currency?: string; source: 'CURRENT_PRICE' | 'HISTORICAL_PRICE' | 'ESTIMATE' | 'NO_PRICE' };
export function calculateBomCost(lines: CostLine[]) {
  const known = lines.filter((line) => line.unitPrice !== undefined && line.source !== 'NO_PRICE');
  const total = known.reduce((sum, line) => sum + line.quantity * (line.unitPrice ?? 0), 0);
  return { total, currency: known[0]?.currency ?? 'ARS', knownLines: known, withoutPrice: lines.filter((line) => line.unitPrice === undefined || line.source === 'NO_PRICE'), trace: { formula: 'subtotal = Σ cantidad × precio unitario', inputs: known.map((line) => ({ name: line.description, value: line.quantity, unit: line.unit })), result: { value: total, unit: known[0]?.currency ?? 'ARS' } } };
}
