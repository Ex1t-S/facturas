import PDFDocument from 'pdfkit';
import type { DrawingEntity, DrawingLayer, DrawingScene, DrawingStyle } from './drawingScene.js';

const pt = (millimetres: number) => millimetres * 72 / 25.4;

function styleFor(entity: DrawingEntity, layer: DrawingLayer): DrawingStyle {
  return { stroke: '#172630', fill: 'none', strokeWidth: 0.25, fontSize: 2.7, fontFamily: 'Helvetica', fontWeight: 'normal', textAnchor: 'start', opacity: 1, ...layer.style, ...entity.style };
}

function applyStroke(doc: PDFKit.PDFDocument, style: DrawingStyle) {
  doc.strokeColor(style.stroke || '#172630').lineWidth(pt(style.strokeWidth || 0.25)).opacity(style.opacity ?? 1);
  if (style.dash?.length) doc.dash(pt(style.dash[0]), { space: pt(style.dash[1] || style.dash[0]) });
  else doc.undash();
}

function drawLine(doc: PDFKit.PDFDocument, start: { x: number; y: number }, end: { x: number; y: number }, style: DrawingStyle) {
  applyStroke(doc, style);
  doc.moveTo(pt(start.x), pt(start.y)).lineTo(pt(end.x), pt(end.y)).stroke();
}

function drawText(doc: PDFKit.PDFDocument, x: number, y: number, value: string, style: DrawingStyle, options: {
  width?: number;
  align?: 'left' | 'center' | 'right';
  rotate?: number;
} = {}) {
  doc.save();
  if (options.rotate) doc.rotate(options.rotate, { origin: [pt(x), pt(y)] });
  doc.fillColor(style.fill && style.fill !== 'none' ? style.fill : style.stroke || '#172630');
  doc.font(style.fontWeight === 'bold' ? 'Helvetica-Bold' : 'Helvetica').fontSize(pt(style.fontSize || 2.7));
  doc.text(value, pt(x), pt(y - (style.fontSize || 2.7) * 0.8), {
    width: options.width ? pt(options.width) : undefined,
    align: options.align,
    lineBreak: false
  });
  doc.restore();
}

function drawArrow(doc: PDFKit.PDFDocument, point: { x: number; y: number }, angle: number, style: DrawingStyle) {
  const length = 1.8;
  const spread = 0.55;
  doc.save().fillColor(style.stroke || '#172630');
  doc.moveTo(pt(point.x), pt(point.y))
    .lineTo(pt(point.x - Math.cos(angle - spread) * length), pt(point.y - Math.sin(angle - spread) * length))
    .lineTo(pt(point.x - Math.cos(angle + spread) * length), pt(point.y - Math.sin(angle + spread) * length))
    .closePath().fill().restore();
}

function drawArc(doc: PDFKit.PDFDocument, input: { cx: number; cy: number; radius: number; startAngleDeg: number; endAngleDeg: number }, style: DrawingStyle) {
  const startAngle = input.startAngleDeg * Math.PI / 180;
  const endAngle = input.endAngleDeg * Math.PI / 180;
  const start = { x: input.cx + Math.cos(startAngle) * input.radius, y: input.cy + Math.sin(startAngle) * input.radius };
  const end = { x: input.cx + Math.cos(endAngle) * input.radius, y: input.cy + Math.sin(endAngle) * input.radius };
  const large = Math.abs(input.endAngleDeg - input.startAngleDeg) > 180 ? 1 : 0;
  applyStroke(doc, style);
  doc.path(`M ${pt(start.x)} ${pt(start.y)} A ${pt(input.radius)} ${pt(input.radius)} 0 ${large} 1 ${pt(end.x)} ${pt(end.y)}`).stroke();
}

function drawTitleBlock(doc: PDFKit.PDFDocument, entity: Extract<DrawingEntity, { type: 'TitleBlock' }>, style: DrawingStyle) {
  const { x, y, width, height, fields } = entity;
  const brandWidth = 28;
  const row = height / 5;
  applyStroke(doc, style);
  doc.rect(pt(x), pt(y), pt(width), pt(height)).fillAndStroke('#ffffff', style.stroke || '#172630');
  doc.rect(pt(x), pt(y), pt(brandWidth), pt(height)).fill('#1f5e45');
  drawText(doc, x + 1, y + 17, fields.EMPRESA || 'FMH', { ...style, fontSize: 6.2, fontWeight: 'bold', fill: '#ffffff' }, { width: brandWidth - 2, align: 'center' });
  drawText(doc, x + 1, y + 24, 'INGENIERÍA', { ...style, fontSize: 2.1, fontWeight: 'bold', fill: '#ffffff' }, { width: brandWidth - 2, align: 'center' });
  for (let index = 1; index < 5; index += 1) drawLine(doc, { x: x + brandWidth, y: y + row * index }, { x: x + width, y: y + row * index }, style);
  drawLine(doc, { x: x + brandWidth + 88, y }, { x: x + brandWidth + 88, y: y + height }, style);
  drawLine(doc, { x: x + brandWidth + 132, y: y + row * 2 }, { x: x + brandWidth + 132, y: y + height }, style);
  const pair = (label: string, value: string, px: number, py: number, valueSize = 2.2, maxWidth = 84) => {
    drawText(doc, px, py + 2.2, label, { ...style, fontSize: 1.6, fontWeight: 'bold', fill: '#64716b' });
    drawText(doc, px, py + 6.1, value || 'PENDIENTE', { ...style, fontSize: valueSize, fontWeight: 'bold', fill: '#172630' }, { width: maxWidth });
  };
  pair('PROYECTO', fields.PROYECTO, x + brandWidth + 2, y);
  pair('PLANO', fields.PLANO, x + brandWidth + 2, y + row);
  pair('CLIENTE', fields.CLIENTE, x + brandWidth + 90, y, 1.9, 58);
  pair('EQUIPO / CAPACIDAD', `${fields.EQUIPO} · ${fields.CAPACIDAD}`, x + brandWidth + 90, y + row, 1.85, 58);
  pair('DIBUJÓ', fields.DIBUJO, x + brandWidth + 2, y + row * 2, 1.75);
  pair('REVISÓ', fields.REVISO, x + brandWidth + 2, y + row * 3, 1.6);
  pair('OBSERVACIONES', fields.OBSERVACIONES, x + brandWidth + 2, y + row * 4, 1.55);
  pair('NÚMERO', fields.NUMERO, x + brandWidth + 90, y + row * 2, 1.9, 40);
  pair('PRESUPUESTO', fields.PRESUPUESTO, x + brandWidth + 90, y + row * 3, 1.9, 40);
  pair('FECHA / ESCALA', `${fields.FECHA} · ${fields.ESCALA}`, x + brandWidth + 90, y + row * 4, 1.75, 40);
  pair('REV.', fields.REVISION, x + brandWidth + 134, y + row * 2, 2.8, 14);
  pair('APROBÓ', fields.APROBO, x + brandWidth + 134, y + row * 3, 1.5, 14);
}

function renderEntity(doc: PDFKit.PDFDocument, entity: DrawingEntity, layer: DrawingLayer) {
  let style = styleFor(entity, layer);
  if (entity.type === 'CenterLine' && !style.dash) style = { ...style, dash: [5, 1.5] };
  if (entity.type === 'HiddenLine' && !style.dash) style = { ...style, dash: [2, 1.2] };
  if (entity.type === 'Line' || entity.type === 'CenterLine' || entity.type === 'HiddenLine' || entity.type === 'SectionLine') return drawLine(doc, entity.start, entity.end, style);
  if (entity.type === 'Polyline') {
    applyStroke(doc, style);
    const first = entity.points[0];
    if (!first) return;
    doc.moveTo(pt(first.x), pt(first.y));
    for (const point of entity.points.slice(1)) doc.lineTo(pt(point.x), pt(point.y));
    if (entity.closed) doc.closePath();
    if (style.fill && style.fill !== 'none') doc.fillAndStroke(style.fill, style.stroke || '#172630');
    else doc.stroke();
    return;
  }
  if (entity.type === 'Rectangle') {
    applyStroke(doc, style);
    doc.roundedRect(pt(entity.x), pt(entity.y), pt(entity.width), pt(entity.height), pt(entity.radius || 0));
    if (style.fill && style.fill !== 'none') doc.fillAndStroke(style.fill, style.stroke || '#172630');
    else doc.stroke();
    return;
  }
  if (entity.type === 'Circle') {
    applyStroke(doc, style);
    doc.circle(pt(entity.cx), pt(entity.cy), pt(entity.radius));
    if (style.fill && style.fill !== 'none') doc.fillAndStroke(style.fill, style.stroke || '#172630');
    else doc.stroke();
    return;
  }
  if (entity.type === 'Ellipse') {
    applyStroke(doc, style);
    doc.ellipse(pt(entity.cx), pt(entity.cy), pt(entity.radiusX), pt(entity.radiusY));
    if (style.fill && style.fill !== 'none') doc.fillAndStroke(style.fill, style.stroke || '#172630');
    else doc.stroke();
    return;
  }
  if (entity.type === 'Arc') {
    drawArc(doc, entity, style);
    return;
  }
  if (entity.type === 'Path') {
    applyStroke(doc, style);
    doc.path(entity.d);
    if (style.fill && style.fill !== 'none') doc.fillAndStroke(style.fill, style.stroke || '#172630');
    else doc.stroke();
    return;
  }
  if (entity.type === 'Text') return drawText(doc, entity.x, entity.y, entity.text, style, { width: entity.maxWidth, align: style.textAnchor === 'middle' ? 'center' : style.textAnchor === 'end' ? 'right' : 'left', rotate: entity.rotateDeg });
  if (entity.type === 'LinearDimension') {
    const horizontal = Math.abs(entity.end.x - entity.start.x) >= Math.abs(entity.end.y - entity.start.y);
    const start = horizontal ? { x: entity.start.x, y: entity.start.y + entity.offset } : { x: entity.start.x + entity.offset, y: entity.start.y };
    const end = horizontal ? { x: entity.end.x, y: entity.end.y + entity.offset } : { x: entity.end.x + entity.offset, y: entity.end.y };
    drawLine(doc, entity.start, start, style);
    drawLine(doc, entity.end, end, style);
    drawLine(doc, start, end, style);
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    drawArrow(doc, start, angle + Math.PI, style);
    drawArrow(doc, end, angle, style);
    const tx = (start.x + end.x) / 2;
    const ty = (start.y + end.y) / 2;
    drawText(doc, tx - (horizontal ? 12 : 0), ty - (horizontal ? 1.2 : -8), entity.text, { ...style, fill: style.stroke, fontWeight: 'bold' }, { width: horizontal ? 24 : 16, align: 'center', rotate: horizontal ? 0 : -90 });
    return;
  }
  if (entity.type === 'Leader') {
    drawLine(doc, entity.start, entity.elbow, style);
    drawLine(doc, entity.elbow, entity.end, style);
    drawArrow(doc, entity.start, Math.atan2(entity.start.y - entity.elbow.y, entity.start.x - entity.elbow.x), style);
    drawText(doc, entity.end.x, entity.end.y, entity.text, { ...style, fill: style.stroke });
    return;
  }
  if (entity.type === 'DiameterDimension' || entity.type === 'RadiusDimension') {
    drawLine(doc, entity.center, entity.edge, style);
    drawArrow(doc, entity.edge, Math.atan2(entity.edge.y - entity.center.y, entity.edge.x - entity.center.x), style);
    drawText(doc, entity.center.x - 10, entity.center.y - 1, entity.text, { ...style, fill: style.stroke, fontWeight: 'bold' }, { width: 20, align: 'center' });
    return;
  }
  if (entity.type === 'AngularDimension') {
    drawArc(doc, { cx: entity.center.x, cy: entity.center.y, radius: entity.radius, startAngleDeg: entity.startAngleDeg, endAngleDeg: entity.endAngleDeg }, style);
    drawText(doc, entity.center.x + entity.radius, entity.center.y, entity.text, { ...style, fill: style.stroke });
    return;
  }
  if (entity.type === 'Hatch') {
    const points = entity.boundary;
    const first = points[0];
    if (!first) return;
    applyStroke(doc, { ...style, stroke: '#aab4af', strokeWidth: 0.15 });
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    doc.save();
    doc.moveTo(pt(first.x), pt(first.y));
    for (const point of points.slice(1)) doc.lineTo(pt(point.x), pt(point.y));
    doc.closePath().clip();
    for (let x = minX - (maxY - minY); x <= maxX; x += entity.spacing) drawLine(doc, { x, y: maxY }, { x: x + maxY - minY, y: minY }, style);
    doc.restore();
    return;
  }
  if (entity.type === 'LevelMarker') {
    doc.save().fillColor(style.stroke || '#172630').moveTo(pt(entity.point.x), pt(entity.point.y)).lineTo(pt(entity.point.x + 3), pt(entity.point.y - 1.8)).lineTo(pt(entity.point.x + 3), pt(entity.point.y + 1.8)).closePath().fill().restore();
    drawText(doc, entity.point.x + 4, entity.point.y + 1, entity.text, { ...style, fill: style.stroke });
    return;
  }
  if (entity.type === 'DetailCallout') {
    applyStroke(doc, style);
    doc.circle(pt(entity.center.x), pt(entity.center.y), pt(entity.radius)).stroke();
    drawText(doc, entity.center.x - entity.radius, entity.center.y + 1, entity.text, { ...style, fill: style.stroke, fontWeight: 'bold' }, { width: entity.radius * 2, align: 'center' });
    return;
  }
  if (entity.type === 'Table') {
    let py = entity.y;
    entity.rows.forEach((row, rowIndex) => {
      let px = entity.x;
      const height = entity.rowHeights[rowIndex] || 5;
      row.forEach((cell, columnIndex) => {
        const width = entity.columnWidths[columnIndex] || 20;
        applyStroke(doc, style);
        doc.rect(pt(px), pt(py), pt(width), pt(height)).stroke();
        drawText(doc, px + 1.2, py + height * .68, cell, style, { width: width - 2 });
        px += width;
      });
      py += height;
    });
    return;
  }
  if (entity.type === 'TitleBlock') drawTitleBlock(doc, entity, style);
}

export async function renderSceneToPdf(scene: DrawingScene) {
  const sheet = scene.sheets[0];
  if (!sheet) throw new Error('DrawingScene no contiene hojas.');
  const doc = new PDFDocument({ size: [pt(sheet.widthMm), pt(sheet.heightMm)], margin: 0, autoFirstPage: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.info.Title = 'Plano comercial preliminar FMH';
  doc.info.Subject = 'Diseño y dimensiones orientativas para cotización';
  const layers = new Map(sheet.layers.map((layer) => [layer.id, layer]));
  for (const entity of sheet.entities) {
    const layer = layers.get(entity.layerId);
    if (layer?.visible && layer.printable) renderEntity(doc, entity, layer);
  }
  doc.end();
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
