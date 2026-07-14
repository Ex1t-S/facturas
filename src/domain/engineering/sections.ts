export function rectangularSection(widthMm: number, heightMm: number) {
  const area = widthMm * heightMm;
  const ix = widthMm * heightMm ** 3 / 12;
  const iy = heightMm * widthMm ** 3 / 12;
  return { areaMm2: area, ixMm4: ix, iyMm4: iy, wxMm3: ix / (heightMm / 2), wyMm3: iy / (widthMm / 2) };
}
export function rectangularHollowSection(widthMm: number, heightMm: number, thicknessMm: number) {
  if (widthMm <= 2 * thicknessMm || heightMm <= 2 * thicknessMm) throw new Error('El espesor no puede cerrar la sección hueca.');
  const outer = rectangularSection(widthMm, heightMm);
  const inner = rectangularSection(widthMm - 2 * thicknessMm, heightMm - 2 * thicknessMm);
  return { areaMm2: outer.areaMm2 - inner.areaMm2, ixMm4: outer.ixMm4 - inner.ixMm4, iyMm4: outer.iyMm4 - inner.iyMm4, wxMm3: (outer.ixMm4 - inner.ixMm4) / (heightMm / 2), wyMm3: (outer.iyMm4 - inner.iyMm4) / (widthMm / 2) };
}
export function circularTubeSection(outerDiameterMm: number, thicknessMm: number) {
  const inner = outerDiameterMm - 2 * thicknessMm;
  if (inner <= 0) throw new Error('El espesor no puede cerrar el tubo.');
  const area = Math.PI * (outerDiameterMm ** 2 - inner ** 2) / 4;
  const inertia = Math.PI * (outerDiameterMm ** 4 - inner ** 4) / 64;
  return { areaMm2: area, ixMm4: inertia, iyMm4: inertia, wxMm3: inertia / (outerDiameterMm / 2), wyMm3: inertia / (outerDiameterMm / 2) };
}
