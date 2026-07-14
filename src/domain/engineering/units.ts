export type Unit = 'mm' | 'cm' | 'm' | 'kg' | 't' | 'kg/m' | 't/m' | 'N' | 'kN' | 'Pa' | 'kPa' | 'MPa';

const factors: Record<Unit, number> = {
  mm: 0.001, cm: 0.01, m: 1, kg: 1, t: 1000, 'kg/m': 1, 't/m': 1000, N: 1, kN: 1000, Pa: 1, kPa: 1000, MPa: 1_000_000
};
const groups: Record<Unit, string> = { mm: 'length', cm: 'length', m: 'length', kg: 'mass', t: 'mass', 'kg/m': 'linearMass', 't/m': 'linearMass', N: 'force', kN: 'force', Pa: 'pressure', kPa: 'pressure', MPa: 'pressure' };

export function convertUnit(value: number, from: Unit, to: Unit) {
  if (!Number.isFinite(value)) throw new Error('El valor debe ser numérico.');
  if (groups[from] !== groups[to]) throw new Error(`No se puede convertir ${from} a ${to}.`);
  return value * factors[from] / factors[to];
}

export function assertUnit(value: number, unit: Unit) {
  if (!Number.isFinite(value)) throw new Error(`Valor inválido para ${unit}.`);
  return { value, unit };
}
