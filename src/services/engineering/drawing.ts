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
  const title = 'PLANO ORIENTATIVO PARA ANÁLISIS Y PRESUPUESTO';
  const warning = 'NO APTO PARA FABRICACION - DIMENSIONES SUJETAS A INGENIERIA FINAL';
  let elements = '';
  if (spec.drawingType === 'SILO') {
    const bodyWidth = 260;
    const x = 145;
    const roofTop = 140;
    const bodyTop = 195;
    const body = 205;
    const cone = 82;
    const supportTop = bodyTop + body + cone;
    const groundY = 615;
    const bodyCenter = x + bodyWidth / 2;
    const topViewCx = 810;
    const topViewCy = 320;
    const topRadius = 125;
    const supports = Array.from({ length: supportCount }, (_, index) => {
      const angle = (Math.PI * 2 * index) / supportCount - Math.PI / 2;
      const cx = topViewCx + Math.cos(angle) * topRadius;
      const cy = topViewCy + Math.sin(angle) * topRadius;
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="8" class="supportPoint"/><line x1="${topViewCx}" y1="${topViewCy}" x2="${cx.toFixed(2)}" y2="${cy.toFixed(2)}" class="axis"/>`;
    }).join('');
    const projectedLegs = [x + 34, x + 86, x + bodyWidth - 86, x + bodyWidth - 34].map((legX, index) =>
      `<line x1="${legX}" y1="${supportTop - (index === 1 || index === 2 ? 12 : 0)}" x2="${legX}" y2="${groundY}" class="${index === 1 || index === 2 ? 'support hidden' : 'support'}"/>`
    ).join('');
    elements = `
      <g>
        <text x="70" y="125" class="viewTitle">ELEVACIÓN GENERAL</text>
        <line x1="${bodyCenter}" y1="125" x2="${bodyCenter}" y2="${groundY + 15}" class="centerLine"/>
        <path d="M ${x} ${bodyTop} L ${bodyCenter} ${roofTop} L ${x + bodyWidth} ${bodyTop}" class="shape"/>
        <ellipse cx="${bodyCenter}" cy="${bodyTop}" rx="${bodyWidth / 2}" ry="18" class="shape"/>
        <path d="M ${x} ${bodyTop} L ${x} ${bodyTop + body} M ${x + bodyWidth} ${bodyTop} L ${x + bodyWidth} ${bodyTop + body}" class="shape"/>
        <ellipse cx="${bodyCenter}" cy="${bodyTop + body}" rx="${bodyWidth / 2}" ry="18" class="shape"/>
        <path d="M ${x} ${bodyTop + body} L ${bodyCenter} ${supportTop} L ${x + bodyWidth} ${bodyTop + body}" class="shape"/>
        ${projectedLegs}
        <path d="M ${x + 34} ${supportTop + 25} L ${x + bodyWidth - 34} ${groundY - 30} M ${x + bodyWidth - 34} ${supportTop + 25} L ${x + 34} ${groundY - 30}" class="brace"/>
        <line x1="${x - 25}" y1="${groundY}" x2="${x + bodyWidth + 25}" y2="${groundY}" class="ground"/>
        <line x1="${x}" y1="${groundY + 28}" x2="${x + bodyWidth}" y2="${groundY + 28}" class="dimension" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <line x1="${x}" y1="${groundY + 12}" x2="${x}" y2="${groundY + 38}" class="extension"/>
        <line x1="${x + bodyWidth}" y1="${groundY + 12}" x2="${x + bodyWidth}" y2="${groundY + 38}" class="extension"/>
        <text x="${bodyCenter}" y="${groundY + 50}" class="dimText" text-anchor="middle">Ø ${diameter} m</text>
        <line x1="${x + bodyWidth + 40}" y1="${bodyTop}" x2="${x + bodyWidth + 40}" y2="${bodyTop + body}" class="dimension" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <text x="${x + bodyWidth + 55}" y="${bodyTop + body / 2}" class="dimText">CUERPO ${bodyHeight} m</text>
        <line x1="${x + bodyWidth + 40}" y1="${bodyTop + body}" x2="${x + bodyWidth + 40}" y2="${supportTop}" class="dimension" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <text x="${x + bodyWidth + 55}" y="${bodyTop + body + cone / 2}" class="dimText">CONO ${coneHeight} m</text>
        <line x1="${x - 35}" y1="${supportTop}" x2="${x - 35}" y2="${groundY}" class="dimension" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <text x="${x - 48}" y="${supportTop + (groundY - supportTop) / 2}" class="dimText" text-anchor="end">LIBRE ${freeHeight} m</text>
      </g>
      <g>
        <text x="635" y="125" class="viewTitle">PLANTA DE APOYOS</text>
        <circle cx="${topViewCx}" cy="${topViewCy}" r="${topRadius}" class="shape"/>
        <circle cx="${topViewCx}" cy="${topViewCy}" r="31" class="shape"/>
        ${supports}
        <line x1="${topViewCx - topRadius}" y1="${topViewCy + topRadius + 38}" x2="${topViewCx + topRadius}" y2="${topViewCy + topRadius + 38}" class="dimension" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
        <text x="${topViewCx}" y="${topViewCy + topRadius + 61}" class="dimText" text-anchor="middle">Ø ${diameter} m · ${supportCount} APOYOS</text>
        <rect x="650" y="520" width="320" height="86" rx="4" class="infoBox"/>
        <text x="670" y="547" class="infoLabel">CAPACIDAD DE REFERENCIA</text>
        <text x="670" y="580" class="infoValue">${spec.capacityT ? `${spec.capacityT} t` : 'A confirmar'}</text>
        <text x="800" y="547" class="infoLabel">ESCALA</text>
        <text x="800" y="580" class="infoValue">S / E</text>
      </g>`;
  } else if (spec.drawingType === 'HOPPER') {
    elements = `<text x="90" y="135" class="viewTitle">ELEVACIÓN GENERAL</text><path d="M 150 180 L 650 180 L 520 520 L 280 520 Z" class="shape"/><line x1="150" y1="155" x2="650" y2="155" class="dimension" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="400" y="145" class="dimText" text-anchor="middle">BOCA SUPERIOR ${width} m</text><text x="400" y="555" class="dimText" text-anchor="middle">BOCA INFERIOR ${number(spec.lowerOpening, 0.5)} m</text><text x="690" y="340" class="dimText">ALTURA ${bodyHeight} m</text>`;
  } else {
    const w = Math.min(610, width * 18);
    const l = Math.min(460, length * 10);
    elements = `<text x="90" y="135" class="viewTitle">VISTA GENERAL</text><rect x="${(canvasWidth - w) / 2 - 170}" y="200" width="${w}" height="${l / 2}" class="shape"/><path d="M ${(canvasWidth - w) / 2 - 170} 200 L ${(canvasWidth - w) / 2 - 170 + w / 2} 125 L ${(canvasWidth + w) / 2 - 170} 200" class="shape"/><text x="220" y="${240 + l / 2}" class="dimText">ANCHO ${width} m · LARGO ${length} m · ALTURA ${bodyHeight} m</text>`;
  }
  const notes = (spec.notes || []).slice(0, 4).map((note, index) => `<text x="48" y="${690 + index * 20}" class="note">${index + 1}. ${esc(note)}</text>`).join('');
  const titleBlock = `<g class="titleBlock"><rect x="720" y="652" width="442" height="130" class="border"/><rect x="720" y="652" width="112" height="130" class="brandBox"/><text x="776" y="718" class="company" text-anchor="middle">FMH</text><text x="848" y="680" class="smallLabel">PROYECTO</text><text x="848" y="699" class="small">${esc(spec.projectName || 'Predimensionamiento')}</text><text x="848" y="725" class="smallLabel">CLIENTE</text><text x="848" y="744" class="small">${esc(spec.customerName || 'A confirmar')}</text><text x="1040" y="680" class="smallLabel">DOCUMENTO</text><text x="1040" y="699" class="small">ORIENTATIVO</text><text x="1040" y="725" class="smallLabel">CAPACIDAD</text><text x="1040" y="744" class="small">${spec.capacityT ? `${spec.capacityT} t` : 'A confirmar'}</text><text x="848" y="770" class="warningSmall">NO UTILIZAR PARA FABRICAR</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#1f5e45"/></marker></defs>
    <style>
      .shape{fill:#fbfcfc;stroke:#172630;stroke-width:2.2}
      .support{stroke:#172630;stroke-width:7}.support.hidden{stroke:#7f8a91;stroke-dasharray:6 5;stroke-width:4}
      .brace{fill:none;stroke:#63717a;stroke-width:3}.supportPoint{fill:#1f5e45;stroke:#172630;stroke-width:1.5}
      .axis{stroke:#cbd2d6;stroke-width:1}.centerLine{stroke:#aeb8be;stroke-width:1;stroke-dasharray:12 5 2 5}
      .ground{stroke:#172630;stroke-width:3}.extension{stroke:#6b777f;stroke-width:1}
      .dimension{stroke:#1f5e45;stroke-width:1.5}.border{fill:white;stroke:#172630;stroke-width:1.5}
      .headerBar{fill:#1f5e45}.brandBox{fill:#1f5e45}
      .viewTitle{font:700 15px Arial,sans-serif;letter-spacing:1.2px;fill:#172630}
      .dimText{font:600 12px Arial,sans-serif;fill:#1f5e45}.note{font:11px Arial,sans-serif;fill:#4d5963}
      .title{font:700 18px Arial,sans-serif;letter-spacing:.5px;fill:#172630}.headerWarning{font:700 11px Arial,sans-serif;letter-spacing:.7px;fill:#9c3d35}
      .company{font:800 27px Arial,sans-serif;fill:white}.small{font:11px Arial,sans-serif;fill:#172630}
      .smallLabel{font:700 8px Arial,sans-serif;letter-spacing:.8px;fill:#68747e}.warningSmall{font:700 9px Arial,sans-serif;fill:#9c3d35}
      .infoBox{fill:#f4f7f5;stroke:#c7d2cc;stroke-width:1}.infoLabel{font:700 9px Arial,sans-serif;letter-spacing:.7px;fill:#68747e}.infoValue{font:700 20px Arial,sans-serif;fill:#1f5e45}
    </style>
    <rect width="100%" height="100%" fill="white"/>
    <rect x="18" y="18" width="1164" height="784" class="border"/>
    <rect x="18" y="18" width="12" height="74" class="headerBar"/>
    <text x="48" y="50" class="title">${title}</text>
    <text x="48" y="75" class="headerWarning">${warning}</text>
    <line x1="30" y1="92" x2="1170" y2="92" class="axis"/>
    ${elements}
    <rect x="30" y="652" width="670" height="130" class="border"/>
    <text x="48" y="674" class="smallLabel">NOTAS E HIPÓTESIS</text>
    ${notes || '<text x="48" y="700" class="note">1. Sin notas adicionales.</text>'}
    ${titleBlock}
  </svg>`;
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
