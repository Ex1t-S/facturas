export type EngineeringDrawingSpec = {
  drawingType: 'SILO' | 'HOPPER' | 'WAREHOUSE' | 'SUPPORT_STRUCTURE';
  width?: number;
  length?: number;
  diameter?: number;
  height?: number;
  freeHeight?: number;
  lowerOpening?: number;
  roofSlope?: number;
  notes?: string[];
};

function number(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function esc(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function renderPreliminaryEngineeringSvg(spec: EngineeringDrawingSpec) {
  const width = number(spec.width, 20);
  const length = number(spec.length, 40);
  const diameter = number(spec.diameter, 8);
  const height = number(spec.height, 12);
  const freeHeight = number(spec.freeHeight, 4);
  const scale = 22;
  const canvasWidth = 900;
  const canvasHeight = 620;
  const title = 'ESQUEMA PRELIMINAR - NO APTO PARA FABRICACIÓN';
  const notes = (spec.notes || []).map((note) => `<text x="40" y="${canvasHeight - 46 - (spec.notes || []).indexOf(note) * 18}" class="note">${esc(note)}</text>`).join('');
  let elements = '';
  if (spec.drawingType === 'SILO') {
    const bodyWidth = Math.min(260, diameter * scale);
    const bodyHeight = Math.min(210, height * scale);
    const x = 330;
    const y = 120;
    const legY = y + bodyHeight + 90;
    elements = `<ellipse cx="${x + bodyWidth / 2}" cy="${y}" rx="${bodyWidth / 2}" ry="24" class="shape"/><rect x="${x}" y="${y}" width="${bodyWidth}" height="${bodyHeight}" class="shape"/><path d="M ${x} ${y + bodyHeight} L ${x + bodyWidth / 2} ${y + bodyHeight + 78} L ${x + bodyWidth} ${y + bodyHeight} Z" class="shape"/><line x1="${x + 38}" y1="${legY}" x2="${x + 38}" y2="${canvasHeight - 100}" class="support"/><line x1="${x + bodyWidth - 38}" y1="${legY}" x2="${x + bodyWidth - 38}" y2="${canvasHeight - 100}" class="support"/><line x1="${x - 35}" y1="${canvasHeight - 100}" x2="${x + bodyWidth + 35}" y2="${canvasHeight - 100}" class="dimension"/><text x="${x}" y="${y - 38}" class="label">Diámetro: ${diameter} m</text><text x="${x + bodyWidth + 18}" y="${y + bodyHeight / 2}" class="label">Altura: ${height} m</text><text x="${x + bodyWidth + 18}" y="${legY + 25}" class="label">Libre: ${freeHeight} m</text>`;
  } else if (spec.drawingType === 'HOPPER') {
    const top = 300;
    const bottom = 100;
    elements = `<path d="M 220 150 L 680 150 L 520 430 L 380 430 Z" class="shape"/><line x1="${top - bottom / 2}" y1="150" x2="${top + bottom / 2}" y2="150" class="dimension"/><line x1="380" y1="470" x2="520" y2="470" class="dimension"/><text x="220" y="125" class="label">Boca superior: ${width} m</text><text x="380" y="500" class="label">Boca inferior: ${number(spec.lowerOpening, 0.5)} m</text><text x="700" y="300" class="label">Altura: ${height} m</text>`;
  } else {
    const w = Math.min(600, width * scale);
    const l = Math.min(420, length * scale);
    elements = `<rect x="${(canvasWidth - w) / 2}" y="180" width="${w}" height="${l / 2}" class="shape"/><path d="M ${(canvasWidth - w) / 2} 180 L ${canvasWidth / 2} ${110 - number(spec.roofSlope, 10)} L ${(canvasWidth + w) / 2} 180" class="shape"/><text x="${(canvasWidth - w) / 2}" y="165" class="label">Ancho: ${width} m</text><text x="${canvasWidth / 2}" y="${205 + l / 2}" class="label">Largo: ${length} m</text><text x="${canvasWidth / 2 - 100}" y="95" class="label">Altura: ${height} m</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}"><style>.shape{fill:#e8eef7;stroke:#111827;stroke-width:3}.support{stroke:#111827;stroke-width:8}.dimension{stroke:#2563eb;stroke-width:2;stroke-dasharray:8 5}.label{font:16px Arial;fill:#111827}.note{font:14px Arial;fill:#374151}</style><rect width="100%" height="100%" fill="white"/><text x="40" y="42" class="label" font-weight="bold">${title}</text>${elements}${notes}</svg>`;
}
