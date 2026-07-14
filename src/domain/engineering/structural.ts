import type { CalculationTrace } from './geometry.js';

const gravity = 9.80665;
const makeTrace = (title: string, formula: string, inputs: CalculationTrace['inputs'], result: number, unit: string, explanation: string): CalculationTrace => ({ title, formula, inputs, result: { value: result, unit }, explanation });

export function calculateVerticalLoad(input: { storedMassT: number; selfWeightKN?: number; additionalLoadKN?: number }) {
  const storedWeightKN = input.storedMassT * gravity;
  const result = storedWeightKN + (input.selfWeightKN ?? 0) + (input.additionalLoadKN ?? 0);
  return makeTrace('Carga vertical total preliminar', 'W = masa almacenada × g + peso propio + cargas adicionales', [{ name: 'masa almacenada', value: input.storedMassT, unit: 't' }, { name: 'gravedad', value: gravity, unit: 'm/s²' }, { name: 'peso propio', value: input.selfWeightKN ?? 0, unit: 'kN' }, { name: 'cargas adicionales', value: input.additionalLoadKN ?? 0, unit: 'kN' }], result, 'kN', 'No incluye combinaciones normativas ni acciones horizontales.');
}

export function calculateNominalLoadPerSupport(totalLoadKN: number, supportCount: number) {
  if (!Number.isInteger(supportCount) || supportCount < 1) throw new Error('La cantidad de apoyos debe ser un entero positivo.');
  return makeTrace('Carga vertical nominal por apoyo', 'P = Wtotal / n', [{ name: 'carga total', value: totalLoadKN, unit: 'kN' }, { name: 'cantidad de apoyos', value: supportCount, unit: 'un'},], totalLoadKN / supportCount, 'kN', 'Distribución ideal uniforme; no contempla excentricidades, viento, arriostramiento ni redistribución.');
}

export function calculateSimpleAxialStress(forceKN: number, areaMm2: number) {
  if (areaMm2 <= 0) throw new Error('El área debe ser positiva.');
  return makeTrace('Tensión axial básica', 'σ = N / A', [{ name: 'fuerza axial', value: forceKN, unit: 'kN' }, { name: 'área', value: areaMm2, unit: 'mm²' }], forceKN * 1000 / areaMm2, 'MPa', 'Referencia de compresión/tracción centrada; no es una verificación de estabilidad.');
}

export function calculateSlendernessRatio(lengthMm: number, radiusGyrationMm: number, effectiveLengthFactor = 1) {
  if (lengthMm <= 0 || radiusGyrationMm <= 0) throw new Error('Longitud y radio de giro deben ser positivos.');
  return makeTrace('Relación de esbeltez geométrica', 'λ = K × L / r', [{ name: 'factor K', value: effectiveLengthFactor, unit: '-' }, { name: 'longitud', value: lengthMm, unit: 'mm' }, { name: 'radio de giro', value: radiusGyrationMm, unit: 'mm' }], effectiveLengthFactor * lengthMm / radiusGyrationMm, '-', 'Indicador preliminar; la clasificación normativa depende del elemento y reglamento aplicado.');
}

export function calculateEulerBucklingReference(input: { elasticModulusMPa: number; inertiaMm4: number; effectiveLengthMm: number }) {
  if (input.elasticModulusMPa <= 0 || input.inertiaMm4 <= 0 || input.effectiveLengthMm <= 0) throw new Error('Los inputs de pandeo deben ser positivos.');
  const result = Math.PI ** 2 * input.elasticModulusMPa * input.inertiaMm4 / input.effectiveLengthMm ** 2 / 1000;
  return makeTrace('Referencia de carga crítica de Euler', 'Pcr = π² × E × I / Le²', [{ name: 'módulo elástico', value: input.elasticModulusMPa, unit: 'MPa' }, { name: 'inercia', value: input.inertiaMm4, unit: 'mm⁴' }, { name: 'longitud efectiva', value: input.effectiveLengthMm, unit: 'mm' }], result, 'kN', 'Referencia elástica ideal; no sustituye una verificación normativa de pandeo ni considera imperfecciones.');
}

export function calculateSectionUtilizationBasic(appliedStressMPa: number, allowableStressMPa: number) {
  if (allowableStressMPa <= 0) throw new Error('La tensión admisible debe ser positiva.');
  const utilization = appliedStressMPa / allowableStressMPa;
  return makeTrace('Utilización axial básica', 'η = σ / σadm', [{ name: 'tensión aplicada', value: appliedStressMPa, unit: 'MPa' }, { name: 'tensión admisible ingresada', value: allowableStressMPa, unit: 'MPa' }], utilization, '-', 'Solo compara los valores ingresados; no verifica acero, pandeo, combinación de acciones ni normativa.');
}
