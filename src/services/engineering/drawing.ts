import PDFDocument from 'pdfkit';

export type EngineeringDrawingSpec = {
  drawingType: 'SILO' | 'HOPPER' | 'WAREHOUSE' | 'SUPPORT_STRUCTURE';
  width?: number;
  length?: number;
  diameter?: number;
  height?: number;
  bodyHeight?: number;
  coneHeight?: number;
  freeHeight?: number;
  lowerOpening?: number;
  roofSlope?: number;
  capacityT?: number;
  supportCount?: number;
  customerName?: string;
  projectName?: string;
  quoteNumber?: string;
  notes?: string[];
};

function number(value: number | undefined, fallback: number) { return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback; }
function esc(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

export function renderPreliminaryEngineeringSvg(spec: EngineeringDrawingSpec) {
  const width = number(spec.width, 20);
  const length = number(spec.length, 40);
  const diameter = number(spec.diameter, 8);
  const bodyHeight = number(spec.bodyHeight, number(spec.height, 8));
  const coneHeight = number(spec.coneHeight, 2);
  const freeHeight = number(spec.freeHeight, 4);
  const supportCount = Math.max(3, Math.floor(number(spec.supportCount, 6)));
  const canvasWidth = 1200;
  const canvasHeight = 820;
  const title = 'PLANO PRELIMINAR PARA PRESUPUESTO';
  const warning = 'NO APTO PARA FABRICACION - DIMENSIONES SUJETAS A INGENIERIA FINAL';
  let elements = '';
  if (spec.drawingType === 'SILO') {
    const bodyWidth = 250;
    const x = 220;
    const y = 150;
    const body = 230;
    const cone = 90;
    const supportY = y + body + cone;
    const topViewCx = 820;
    const topViewCy = 300;
    const topRadius = 120;
    const legs = Array.from({ length: supportCount }, (_, index) => { const angle = (Math.PI * 2 * index) / supportCount - Math.PI / 2; return `<circle cx="${topViewCx + Math.cos(angle) * topRadius}" cy="${topViewCy + Math.sin(angle) * topRadius}" r="8" class="supportPoint"/>`; }).join('');
    elements = `<text x="${x}" y="115" class="subTitle">VISTA FRONTAL</text><ellipse cx="${x + bodyWidth / 2}" cy="${y}" rx="${bodyWidth / 2}" ry="22" class="shape"/><rect x="${x}" y="${y}" width="${bodyWidth}" height="${body}" class="shape"/><path d="M ${x} ${y + body} L ${x + bodyWidth / 2} ${supportY} L ${x + bodyWidth} ${y + body} Z" class="shape"/><line x1="${x + 38}" y1="${supportY}" x2="${x + 38}" y2="650" class="support"/><line x1="${x + bodyWidth - 38}" y1="${supportY}" x2="${x + bodyWidth - 38}" y2="650" class="support"/><line x1="${x - 10}" y1="650" x2="${x + bodyWidth + 10}" y2="650" class="dimension"/><text x="${x}" y="700" class="label">Diametro: ${diameter} m</text><text x="${x + bodyWidth + 20}" y="${y + body / 2}" class="label">Cuerpo: ${bodyHeight} m</text><text x="${x + bodyWidth + 20}" y="${y + body + 44}" class="label">Cono: ${coneHeight} m</text><text x="${x + bodyWidth + 20}" y="${supportY + 45}" class="label">Libre: ${freeHeight} m</text><text x="700" y="115" class="subTitle">VISTA SUPERIOR</text><circle cx="${topViewCx}" cy="${topViewCy}" r="${topRadius}" class="shape"/>${legs}<circle cx="${topViewCx}" cy="${topViewCy}" r="28" class="shape"/><text x="710" y="470" class="label">${supportCount} apoyos</text>`;
  } else if (spec.drawingType === 'HOPPER') {
    elements = `<text x="220" y="115" class="subTitle">VISTA FRONTAL</text><path d="M 220 160 L 650 160 L 510 480 L 360 480 Z" class="shape"/><text x="220" y="140" class="label">Boca superior: ${width} m</text><text x="360" y="525" class="label">Boca inferior: ${number(spec.lowerOpening, 0.5)} m</text><text x="680" y="320" class="label">Altura: ${bodyHeight} m</text>`;
  } else {
    const w = Math.min(610, width * 18);
    const l = Math.min(460, length * 10);
    elements = `<text x="220" y="115" class="subTitle">VISTA GENERAL</text><rect x="${(canvasWidth - w) / 2 - 170}" y="180" width="${w}" height="${l / 2}" class="shape"/><path d="M ${(canvasWidth - w) / 2 - 170} 180 L ${(canvasWidth - w) / 2 - 170 + w / 2} 110 L ${(canvasWidth + w) / 2 - 170} 180" class="shape"/><text x="220" y="${220 + l / 2}" class="label">Ancho: ${width} m - Largo: ${length} m - Altura: ${bodyHeight} m</text>`;
  }
  const notes = (spec.notes || []).map((note, index) => `<text x="40" y="${710 + index * 18}" class="note">${esc(note)}</text>`).join('');
  const titleBlock = `<g class="titleBlock"><rect x="760" y="650" width="390" height="115" class="border"/><text x="780" y="680" class="company">F.M.H.</text><text x="780" y="702" class="small">FABRICA METALURGICA HUANGUELEN</text><text x="780" y="724" class="small">Cliente: ${esc(spec.customerName || 'A confirmar')}</text><text x="780" y="744" class="small">Proyecto: ${esc(spec.projectName || 'Predimensionamiento')}</text><text x="1000" y="724" class="small">Presupuesto: ${esc(spec.quoteNumber || 'Pendiente')}</text><text x="1000" y="744" class="small">Capacidad: ${spec.capacityT ? `${spec.capacityT} t` : 'A confirmar'}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}"><style>.shape{fill:#f8fafc;stroke:#111827;stroke-width:3}.support{stroke:#111827;stroke-width:8}.supportPoint{fill:#2563eb;stroke:#111827;stroke-width:2}.dimension{stroke:#dc2626;stroke-width:2;stroke-dasharray:8 5}.border{fill:white;stroke:#111827;stroke-width:2}.label{font:16px Arial;fill:#111827}.subTitle{font:bold 18px Arial;fill:#111827}.note{font:14px Arial;fill:#374151}.company{font:bold 28px Arial;fill:#111827}.small{font:12px Arial;fill:#111827}</style><rect width="100%" height="100%" fill="white"/><rect x="18" y="18" width="1164" height="784" class="border"/><text x="40" y="52" class="subTitle">${title}</text><text x="40" y="76" class="note">${warning}</text>${elements}${notes}${titleBlock}</svg>`;
}

export async function renderPreliminaryEngineeringPdf(spec: EngineeringDrawingSpec) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'landscape' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.font('Helvetica-Bold').fontSize(16).text('PLANO PRELIMINAR PARA PRESUPUESTO', { align: 'left' });
  doc.font('Helvetica').fontSize(9).text('F.M.H. - FABRICA METALURGICA HUANGUELEN');
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(11).text('ESQUEMA PRELIMINAR - NO APTO PARA FABRICACION');
  doc.font('Helvetica').fontSize(10).text(`Proyecto: ${spec.projectName || 'Predimensionamiento'} | Cliente: ${spec.customerName || 'A confirmar'} | Presupuesto: ${spec.quoteNumber || 'Pendiente'}`);
  doc.moveDown(1);
  doc.rect(36, 130, 720, 370).stroke();
  doc.fontSize(12).text(`Tipo: ${spec.drawingType}` , 55, 155);
  doc.fontSize(11).text(spec.drawingType === 'SILO' ? `Silo: diametro ${number(spec.diameter, 8)} m | cuerpo ${number(spec.bodyHeight, number(spec.height, 8))} m | cono ${number(spec.coneHeight, 2)} m | libre ${number(spec.freeHeight, 4)} m | apoyos ${number(spec.supportCount, 6)}` : 'Geometria preliminar sujeta a confirmacion.', 55, 185, { width: 670 });
  doc.fontSize(9).text('Vistas y cotas generales representadas en el SVG asociado. No utilizar para fabricar.', 55, 460);
  doc.rect(780, 400, 350, 100).stroke();
  doc.font('Helvetica-Bold').fontSize(18).text('F.M.H.', 800, 420);
  doc.font('Helvetica').fontSize(9).text('PLANO PRELIMINAR PARA PRESUPUESTO', 800, 450, { width: 300 });
  doc.text('DIMENSIONES SUJETAS A INGENIERIA FINAL', 800, 470, { width: 300 });
  doc.end();
  return new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}
