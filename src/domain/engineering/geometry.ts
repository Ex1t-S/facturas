export type CalculationTrace = { title: string; formula: string; inputs: Array<{ name: string; value: number; unit: string }>; result: { value: number; unit: string }; explanation?: string };
const trace = (title: string, formula: string, inputs: CalculationTrace['inputs'], value: number, unit: string, explanation?: string): CalculationTrace => ({ title, formula, inputs, result: { value, unit }, explanation });

export function rectangularPrism(length: number, width: number, height: number): CalculationTrace {
  const value = length * width * height;
  return trace('Volumen de prisma rectangular', 'V = largo × ancho × alto', [{ name: 'largo', value: length, unit: 'm' }, { name: 'ancho', value: width, unit: 'm' }, { name: 'alto', value: height, unit: 'm' }], value, 'm³');
}
export function cylinderVolume(radius: number, height: number): CalculationTrace {
  const value = Math.PI * radius ** 2 * height;
  return trace('Volumen de cilindro', 'V = π × r² × h', [{ name: 'radio', value: radius, unit: 'm' }, { name: 'alto', value: height, unit: 'm' }], value, 'm³');
}
export function coneVolume(radius: number, height: number): CalculationTrace {
  const value = Math.PI * radius ** 2 * height / 3;
  return trace('Volumen de cono', 'V = π × r² × h / 3', [{ name: 'radio', value: radius, unit: 'm' }, { name: 'alto', value: height, unit: 'm' }], value, 'm³');
}
export function frustumOfConeVolume(topRadius: number, bottomRadius: number, height: number): CalculationTrace {
  const value = Math.PI * height * (topRadius ** 2 + topRadius * bottomRadius + bottomRadius ** 2) / 3;
  return trace('Volumen de tronco de cono', 'V = π × h × (R² + Rr + r²) / 3', [{ name: 'radio superior', value: topRadius, unit: 'm' }, { name: 'radio inferior', value: bottomRadius, unit: 'm' }, { name: 'alto', value: height, unit: 'm' }], value, 'm³');
}
export function frustumOfPyramidVolume(topArea: number, bottomArea: number, height: number): CalculationTrace {
  const value = height * (topArea + Math.sqrt(topArea * bottomArea) + bottomArea) / 3;
  return trace('Volumen de tronco de pirámide', 'V = h × (A1 + √(A1A2) + A2) / 3', [{ name: 'área superior', value: topArea, unit: 'm²' }, { name: 'área inferior', value: bottomArea, unit: 'm²' }, { name: 'alto', value: height, unit: 'm' }], value, 'm³');
}
export function rectangleArea(length: number, width: number): CalculationTrace { return trace('Superficie rectangular', 'A = largo × ancho', [{ name: 'largo', value: length, unit: 'm' }, { name: 'ancho', value: width, unit: 'm' }], length * width, 'm²'); }
export function cylinderLateralArea(radius: number, height: number): CalculationTrace { return trace('Superficie lateral de cilindro', 'A = 2 × π × r × h', [{ name: 'radio', value: radius, unit: 'm' }, { name: 'alto', value: height, unit: 'm' }], 2 * Math.PI * radius * height, 'm²'); }
