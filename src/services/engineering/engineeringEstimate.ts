import { buildEngineeringBom } from './bom.js';
import { calculatePurchase } from './purchasing.js';
import { searchEngineeringSectionCandidates, type SectionCandidate } from './sectionCandidates.js';
import { aggregateTakeoff, buildSiloSupportTakeoff, type TakeoffLine } from './takeoff.js';

type StateLike = { projectType?: string; knownInputs: Array<{ key: string; value: unknown; unit?: string; status: string }> };
type Estimate = { materials: Array<Record<string, unknown>>; purchase: Array<Record<string, unknown>>; assumptions: string[]; candidateSections: SectionCandidate[]; totalWeightKg: number; costKnown: number; missingPrices: string[] };

function valueOf(state: StateLike, key: string) { return state.knownInputs.find((item) => item.key === key && item.status === 'ACTIVE')?.value; }
function numberOf(value: unknown) { const result = Number(value); return Number.isFinite(result) && result > 0 ? result : undefined; }

export function buildSiloMaterialEstimate(input: { supportCount: number; freeHeightM: number; diameterM?: number; candidates: SectionCandidate[] }): Estimate {
  const { supportCount, freeHeightM, diameterM, candidates } = input;
  const weighted = candidates.filter((candidate) => candidate.kgPerM !== undefined);
  const legCandidate = weighted[0];
  const braceCandidate = weighted[1] || legCandidate;
  const beamCandidate = weighted[2] || legCandidate;
  const takeoff = buildSiloSupportTakeoff({ supportCount, freeHeightM, diameterM, legCandidate, braceCandidate, beamCandidate });
  const grouped = aggregateTakeoff(takeoff.lines);
  const bom = buildEngineeringBom(grouped);
  const materials = bom.map((line) => ({ description: line.description, specification: line.specification, quantity: line.quantity, unit: line.lengthM ? 'pieza' : 'unidad', totalLengthM: line.totalLengthM, estimatedWeightKg: line.estimatedWeightKg, source: line.source, candidateId: line.candidateId }));
  const purchase = bom.filter((line) => line.totalLengthM !== undefined).map((line) => {
    const candidate = candidates.find((item) => item.id === line.candidateId);
    const hasLinearData = candidate?.stockUnit === 'm' || candidate?.stockUnit === 'metro' || candidate?.stockUnit === 'metros';
    return calculatePurchase({ description: line.specification || line.description, needM: line.totalLengthM!, commercialLengthM: 12, stockM: hasLinearData ? candidate?.stockQuantity : 0, pricePerM: hasLinearData ? candidate?.currentPrice : undefined, priceStatus: hasLinearData && candidate?.currentPrice !== undefined ? 'CURRENT' : 'NO_PRICE', pieces: line.lengthM ? [{ lengthM: line.lengthM, quantity: line.quantity }] : undefined });
  });
  const totalWeightKg = materials.reduce((sum, line) => sum + Number(line.estimatedWeightKg || 0), 0);
  return { materials, purchase, assumptions: takeoff.assumptions, candidateSections: weighted.slice(0, 6), totalWeightKg, costKnown: purchase.reduce((sum, line) => sum + Number(line.subtotal || 0), 0), missingPrices: purchase.filter((line) => line.priceStatus === 'NO_PRICE').map((line) => String(line.description)) };
}

export async function buildEngineeringMaterialEstimate(companyId: string, state: StateLike): Promise<Estimate | null> {
  if (state.projectType !== 'SILO') return null;
  const freeHeightM = numberOf(valueOf(state, 'freeHeight'));
  const diameterM = numberOf(valueOf(state, 'diameter'));
  const alternatives = (valueOf(state, 'supportAlternatives') as unknown[] | undefined)?.map(Number).filter((value) => Number.isInteger(value) && value > 0) || [];
  const supportCount = alternatives[alternatives.length - 1] || numberOf(valueOf(state, 'supportCount'));
  if (!freeHeightM || !supportCount) return null;
  const candidates = await searchEngineeringSectionCandidates(companyId, 'caño perfil tubo estructural', 12);
  return buildSiloMaterialEstimate({ supportCount, freeHeightM, diameterM, candidates });
}
