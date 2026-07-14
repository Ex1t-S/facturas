import type { SectionCandidate } from './sectionCandidates.js';

export type TakeoffLine = {
  description: string;
  specification?: string;
  quantity: number;
  lengthM?: number;
  totalLengthM?: number;
  kgPerM?: number;
  estimatedWeightKg?: number;
  source: 'CALCULATED' | 'USER' | 'HISTORICAL' | 'ESTIMATED';
  candidateId?: string;
};

export type SiloTakeoffInput = {
  supportCount: number;
  freeHeightM: number;
  diameterM?: number;
  legCandidate?: SectionCandidate;
  braceCandidate?: SectionCandidate;
  beamCandidate?: SectionCandidate;
  braceCountPerSupport?: number;
  beamCount?: number;
  braceLengthM?: number;
  beamLengthM?: number;
  basePlateWeightKg?: number;
};

function line(input: Omit<TakeoffLine, 'totalLengthM' | 'estimatedWeightKg'>): TakeoffLine {
  const totalLengthM = input.lengthM === undefined ? undefined : input.quantity * input.lengthM;
  const estimatedWeightKg = totalLengthM === undefined || input.kgPerM === undefined ? undefined : totalLengthM * input.kgPerM;
  return { ...input, totalLengthM, estimatedWeightKg };
}

export function buildSiloSupportTakeoff(input: SiloTakeoffInput) {
  const chordM = input.diameterM && input.supportCount > 1 ? input.diameterM * Math.sin(Math.PI / input.supportCount) : undefined;
  const braceLengthM = input.braceLengthM ?? (chordM ? Math.sqrt(input.freeHeightM ** 2 + chordM ** 2) : undefined);
  const braceCount = input.braceCountPerSupport === undefined ? input.supportCount * 2 : input.supportCount * input.braceCountPerSupport;
  const beamCount = input.beamCount ?? input.supportCount;
  const beamLengthM = input.beamLengthM ?? chordM;
  const lines: TakeoffLine[] = [
    line({ description: 'Patas de soporte', specification: input.legCandidate?.designation, quantity: input.supportCount, lengthM: input.freeHeightM, kgPerM: input.legCandidate?.kgPerM, source: input.legCandidate ? 'CALCULATED' : 'ESTIMATED', candidateId: input.legCandidate?.id }),
    line({ description: 'Arriostramientos diagonales', specification: input.braceCandidate?.designation, quantity: braceCount, lengthM: braceLengthM, kgPerM: input.braceCandidate?.kgPerM, source: input.braceCandidate ? 'CALCULATED' : 'ESTIMATED', candidateId: input.braceCandidate?.id }),
    line({ description: 'Vigas/anillo de vinculacion', specification: input.beamCandidate?.designation, quantity: beamCount, lengthM: beamLengthM, kgPerM: input.beamCandidate?.kgPerM, source: input.beamCandidate ? 'CALCULATED' : 'ESTIMATED', candidateId: input.beamCandidate?.id })
  ];
  if (input.basePlateWeightKg !== undefined) lines.push(line({ description: 'Placas base', quantity: input.supportCount, lengthM: undefined, kgPerM: undefined, source: 'USER' }));
  if (input.basePlateWeightKg !== undefined) lines[3].estimatedWeightKg = input.supportCount * input.basePlateWeightKg;
  return { lines, assumptions: ['Las patas se estiman con longitud igual a la altura libre.', 'Los arriostramientos se representan como dos diagonales por apoyo cuando no se informó otra cantidad.', 'La geometría de vinculación se aproxima con la cuerda entre apoyos; requiere revisión técnica.'] };
}

export function aggregateTakeoff(lines: TakeoffLine[]) {
  const grouped = new Map<string, TakeoffLine>();
  for (const item of lines) {
    const key = `${item.specification || item.description}|${item.kgPerM ?? ''}`;
    const current = grouped.get(key);
    if (!current) grouped.set(key, { ...item });
    else {
      current.quantity += item.quantity;
      current.totalLengthM = (current.totalLengthM || 0) + (item.totalLengthM || 0) || undefined;
      current.estimatedWeightKg = (current.estimatedWeightKg || 0) + (item.estimatedWeightKg || 0) || undefined;
    }
  }
  return [...grouped.values()];
}
