import type { CalculationTrace } from './geometry.js';

export const materialDensities: Record<string, number> = { 'acero carbono': 7850, 'acero al carbono': 7850, 'acero inoxidable': 8000, aluminio: 2700 };

export function sheetMass(areaM2: number, thicknessMm: number, material: string): CalculationTrace {
  const density = materialDensities[material.toLowerCase()];
  if (!density) throw new Error(`No hay densidad configurada para ${material}.`);
  const volume = areaM2 * thicknessMm / 1000;
  const result = volume * density;
  return { title: 'Masa aproximada de chapa', formula: 'm = superficie × espesor × densidad', inputs: [{ name: 'superficie', value: areaM2, unit: 'm²' }, { name: 'espesor', value: thicknessMm, unit: 'mm' }, { name: 'densidad', value: density, unit: 'kg/m³' }], result: { value: result, unit: 'kg' }, explanation: 'Estimación geométrica sin considerar recortes, solapes, refuerzos ni tolerancias.' };
}
export function linearMass(lengthM: number, massPerMeterKg: number): CalculationTrace { return { title: 'Masa de barras o perfiles', formula: 'm = longitud × kg/m', inputs: [{ name: 'longitud', value: lengthM, unit: 'm' }, { name: 'masa lineal', value: massPerMeterKg, unit: 'kg/m' }], result: { value: lengthM * massPerMeterKg, unit: 'kg' } }; }
