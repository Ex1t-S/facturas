import type { DrawingEntity, DrawingLayer, DrawingScene, DrawingStyle } from './drawingScene.js';

const esc = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const n = (value: number) => Number(value.toFixed(3));

function styleFor(entity: DrawingEntity, layer: DrawingLayer): Required<Pick<DrawingStyle, 'stroke' | 'fill' | 'strokeWidth' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'textAnchor' | 'opacity'>> & Pick<DrawingStyle, 'dash'> {
  const style = { ...layer.style, ...entity.style };
  return {
    stroke: style.stroke ?? '#172630',
    fill: style.fill ?? 'none',
    strokeWidth: style.strokeWidth ?? 0.25,
    fontSize: style.fontSize ?? 2.7,
    fontFamily: style.fontFamily ?? 'Arial, sans-serif',
    fontWeight: style.fontWeight ?? 'normal',
    textAnchor: style.textAnchor ?? 'start',
    opacity: style.opacity ?? 1,
    dash: style.dash
  };
}

function attrs(style: ReturnType<typeof styleFor>) {
  return `stroke="${style.stroke}" fill="${style.fill}" stroke-width="${n(style.strokeWidth)}" opacity="${style.opacity}"${style.dash?.length ? ` stroke-dasharray="${style.dash.join(' ')}"` : ''}`;
}

function line(x1: number, y1: number, x2: number, y2: number, style: ReturnType<typeof styleFor>) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${attrs(style)}/>`;
}

function text(entity: Extract<DrawingEntity, { type: 'Text' }>, style: ReturnType<typeof styleFor>) {
  const transform = entity.rotateDeg ? ` transform="rotate(${entity.rotateDeg} ${n(entity.x)} ${n(entity.y)})"` : '';
  return `<text x="${n(entity.x)}" y="${n(entity.y)}" font-family="${esc(style.fontFamily)}" font-size="${n(style.fontSize)}" font-weight="${style.fontWeight}" text-anchor="${style.textAnchor}" fill="${style.fill === 'none' ? style.stroke : style.fill}"${transform}>${esc(entity.text)}</text>`;
}

function arrow(pointX: number, pointY: number, angle: number, style: ReturnType<typeof styleFor>) {
  const length = 1.8;
  const spread = 0.55;
  const x1 = pointX - Math.cos(angle - spread) * length;
  const y1 = pointY - Math.sin(angle - spread) * length;
  const x2 = pointX - Math.cos(angle + spread) * length;
  const y2 = pointY - Math.sin(angle + spread) * length;
  return `<path d="M ${n(pointX)} ${n(pointY)} L ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)} Z" fill="${style.stroke}" stroke="none"/>`;
}

function titleBlock(entity: Extract<DrawingEntity, { type: 'TitleBlock' }>, style: ReturnType<typeof styleFor>) {
  const { x, y, width, height, fields } = entity;
  const brandWidth = 28;
  const row = height / 5;
  const label = (value: string, px: number, py: number, size = 1.65) => `<text x="${n(px)}" y="${n(py)}" font-family="Arial,sans-serif" font-size="${size}" font-weight="bold" fill="#64716b">${esc(value)}</text>`;
  const value = (content: string, px: number, py: number, size = 2.35, anchor = 'start') => `<text x="${n(px)}" y="${n(py)}" font-family="Arial,sans-serif" font-size="${size}" font-weight="bold" text-anchor="${anchor}" fill="#172630">${esc(content || 'PENDIENTE')}</text>`;
  return [
    `<g ${attrs(style)}>`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff"/>`,
    `<rect x="${x}" y="${y}" width="${brandWidth}" height="${height}" fill="#1f5e45"/>`,
    value(fields.EMPRESA || 'FMH', x + brandWidth / 2, y + 20, 6.2, 'middle').replace('fill="#172630"', 'fill="#ffffff"'),
    value('INGENIERÍA', x + brandWidth / 2, y + 26, 2.1, 'middle').replace('fill="#172630"', 'fill="#ffffff"'),
    ...Array.from({ length: 4 }, (_, index) => line(x + brandWidth, y + row * (index + 1), x + width, y + row * (index + 1), style)),
    line(x + brandWidth + 88, y, x + brandWidth + 88, y + height, style),
    line(x + brandWidth + 132, y + row * 2, x + brandWidth + 132, y + height, style),
    label('PROYECTO', x + brandWidth + 2, y + 2.4),
    value(fields.PROYECTO, x + brandWidth + 2, y + 6.2),
    label('PLANO', x + brandWidth + 2, y + row + 2.4),
    value(fields.PLANO, x + brandWidth + 2, y + row + 6.2),
    label('CLIENTE', x + brandWidth + 90, y + 2.4),
    value(fields.CLIENTE, x + brandWidth + 90, y + 6.2, 2),
    label('EQUIPO / CAPACIDAD', x + brandWidth + 90, y + row + 2.4),
    value(`${fields.EQUIPO} · ${fields.CAPACIDAD}`, x + brandWidth + 90, y + row + 6.2, 2),
    label('DIBUJÓ', x + brandWidth + 2, y + row * 2 + 2.4),
    value(fields.DIBUJO, x + brandWidth + 2, y + row * 2 + 6.2, 1.9),
    label('REVISÓ', x + brandWidth + 2, y + row * 3 + 2.4),
    value(fields.REVISO, x + brandWidth + 2, y + row * 3 + 6.2, 1.75),
    label('OBSERVACIONES', x + brandWidth + 2, y + row * 4 + 2.4),
    value(fields.OBSERVACIONES, x + brandWidth + 2, y + row * 4 + 6.2, 1.65),
    label('NÚMERO', x + brandWidth + 90, y + row * 2 + 2.4),
    value(fields.NUMERO, x + brandWidth + 90, y + row * 2 + 6.2, 2),
    label('PRESUPUESTO', x + brandWidth + 90, y + row * 3 + 2.4),
    value(fields.PRESUPUESTO, x + brandWidth + 90, y + row * 3 + 6.2, 2),
    label('FECHA / ESCALA', x + brandWidth + 90, y + row * 4 + 2.4),
    value(`${fields.FECHA} · ${fields.ESCALA}`, x + brandWidth + 90, y + row * 4 + 6.2, 1.9),
    label('REV.', x + brandWidth + 134, y + row * 2 + 2.4),
    value(fields.REVISION, x + brandWidth + 141, y + row * 2 + 6.2, 3.2, 'middle'),
    label('APROBÓ', x + brandWidth + 134, y + row * 3 + 2.4),
    value(fields.APROBO, x + brandWidth + 134, y + row * 3 + 6.2, 1.7),
    '</g>'
  ].join('');
}

function renderEntity(entity: DrawingEntity, layer: DrawingLayer): string {
  const style = styleFor(entity, layer);
  if (entity.type === 'Line' || entity.type === 'CenterLine' || entity.type === 'HiddenLine' || entity.type === 'SectionLine') {
    const specific = entity.type === 'CenterLine' && !style.dash ? { ...style, dash: [5, 1.5, 1, 1.5] } : entity.type === 'HiddenLine' && !style.dash ? { ...style, dash: [2, 1.2] } : style;
    return line(entity.start.x, entity.start.y, entity.end.x, entity.end.y, specific);
  }
  if (entity.type === 'Polyline') return `<polyline points="${entity.points.map((point) => `${n(point.x)},${n(point.y)}`).join(' ')}" ${attrs(style)}${entity.closed ? ' data-closed="true"' : ''}/>${entity.closed ? `<line x1="${n(entity.points.at(-1)?.x || 0)}" y1="${n(entity.points.at(-1)?.y || 0)}" x2="${n(entity.points[0]?.x || 0)}" y2="${n(entity.points[0]?.y || 0)}" ${attrs(style)}/>` : ''}`;
  if (entity.type === 'Rectangle') return `<rect x="${n(entity.x)}" y="${n(entity.y)}" width="${n(entity.width)}" height="${n(entity.height)}" rx="${n(entity.radius || 0)}" ${attrs(style)}/>`;
  if (entity.type === 'Circle') return `<circle cx="${n(entity.cx)}" cy="${n(entity.cy)}" r="${n(entity.radius)}" ${attrs(style)}/>`;
  if (entity.type === 'Ellipse') return `<ellipse cx="${n(entity.cx)}" cy="${n(entity.cy)}" rx="${n(entity.radiusX)}" ry="${n(entity.radiusY)}" ${attrs(style)}/>`;
  if (entity.type === 'Arc') {
    const start = { x: entity.cx + Math.cos(entity.startAngleDeg * Math.PI / 180) * entity.radius, y: entity.cy + Math.sin(entity.startAngleDeg * Math.PI / 180) * entity.radius };
    const end = { x: entity.cx + Math.cos(entity.endAngleDeg * Math.PI / 180) * entity.radius, y: entity.cy + Math.sin(entity.endAngleDeg * Math.PI / 180) * entity.radius };
    return `<path d="M ${n(start.x)} ${n(start.y)} A ${n(entity.radius)} ${n(entity.radius)} 0 ${Math.abs(entity.endAngleDeg - entity.startAngleDeg) > 180 ? 1 : 0} 1 ${n(end.x)} ${n(end.y)}" ${attrs(style)}/>`;
  }
  if (entity.type === 'Path') return `<path d="${esc(entity.d)}" ${attrs(style)}/>`;
  if (entity.type === 'Text') return text(entity, style);
  if (entity.type === 'LinearDimension') {
    const horizontal = Math.abs(entity.end.x - entity.start.x) >= Math.abs(entity.end.y - entity.start.y);
    const start = horizontal ? { x: entity.start.x, y: entity.start.y + entity.offset } : { x: entity.start.x + entity.offset, y: entity.start.y };
    const end = horizontal ? { x: entity.end.x, y: entity.end.y + entity.offset } : { x: entity.end.x + entity.offset, y: entity.end.y };
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const tx = (start.x + end.x) / 2 + (horizontal ? 0 : 1.5);
    const ty = (start.y + end.y) / 2 + (horizontal ? -1.2 : 0);
    return [
      line(entity.start.x, entity.start.y, start.x, start.y, style),
      line(entity.end.x, entity.end.y, end.x, end.y, style),
      line(start.x, start.y, end.x, end.y, style),
      arrow(start.x, start.y, angle + Math.PI, style),
      arrow(end.x, end.y, angle, style),
      text({ ...entity, type: 'Text', x: tx, y: ty, text: entity.text, rotateDeg: horizontal ? 0 : -90 }, { ...style, textAnchor: 'middle', fill: style.stroke })
    ].join('');
  }
  if (entity.type === 'Leader') return `${line(entity.start.x, entity.start.y, entity.elbow.x, entity.elbow.y, style)}${line(entity.elbow.x, entity.elbow.y, entity.end.x, entity.end.y, style)}${arrow(entity.start.x, entity.start.y, Math.atan2(entity.start.y - entity.elbow.y, entity.start.x - entity.elbow.x), style)}${text({ ...entity, type: 'Text', x: entity.end.x, y: entity.end.y - 1, text: entity.text }, { ...style, fill: style.stroke })}`;
  if (entity.type === 'DiameterDimension' || entity.type === 'RadiusDimension') return `${line(entity.center.x, entity.center.y, entity.edge.x, entity.edge.y, style)}${arrow(entity.edge.x, entity.edge.y, Math.atan2(entity.edge.y - entity.center.y, entity.edge.x - entity.center.x), style)}${text({ ...entity, type: 'Text', x: entity.center.x, y: entity.center.y - 1.3, text: entity.text }, { ...style, textAnchor: 'middle', fill: style.stroke })}`;
  if (entity.type === 'AngularDimension') {
    const end = { x: entity.center.x + Math.cos(entity.endAngleDeg * Math.PI / 180) * entity.radius, y: entity.center.y + Math.sin(entity.endAngleDeg * Math.PI / 180) * entity.radius };
    return `${renderEntity({ ...entity, type: 'Arc', cx: entity.center.x, cy: entity.center.y }, layer)}${text({ ...entity, type: 'Text', x: end.x, y: end.y, text: entity.text }, { ...style, fill: style.stroke })}`;
  }
  if (entity.type === 'Hatch') return `<polygon points="${entity.boundary.map((point) => `${n(point.x)},${n(point.y)}`).join(' ')}" fill="url(#hatch)" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/>`;
  if (entity.type === 'LevelMarker') return `<path d="M ${n(entity.point.x)} ${n(entity.point.y)} l 3 -1.8 v 3.6 Z" fill="${style.stroke}"/>${text({ ...entity, type: 'Text', x: entity.point.x + 4, y: entity.point.y + 0.8, text: entity.text }, { ...style, fill: style.stroke })}`;
  if (entity.type === 'DetailCallout') return `<circle cx="${n(entity.center.x)}" cy="${n(entity.center.y)}" r="${n(entity.radius)}" ${attrs(style)}/>${text({ ...entity, type: 'Text', x: entity.center.x, y: entity.center.y + 1, text: entity.text }, { ...style, textAnchor: 'middle', fill: style.stroke })}`;
  if (entity.type === 'Table') {
    let py = entity.y;
    return entity.rows.map((row, rowIndex) => {
      let px = entity.x;
      const height = entity.rowHeights[rowIndex] || 5;
      const cells = row.map((cell, columnIndex) => {
        const width = entity.columnWidths[columnIndex] || 20;
        const rendered = `<rect x="${n(px)}" y="${n(py)}" width="${n(width)}" height="${n(height)}" fill="#fff" stroke="${style.stroke}" stroke-width="${style.strokeWidth}"/><text x="${n(px + 1.2)}" y="${n(py + height * .68)}" font-family="${esc(style.fontFamily)}" font-size="${style.fontSize}" fill="${style.fill === 'none' ? style.stroke : style.fill}">${esc(cell)}</text>`;
        px += width;
        return rendered;
      }).join('');
      py += height;
      return cells;
    }).join('');
  }
  if (entity.type === 'TitleBlock') return titleBlock(entity, style);
  return '';
}

export function renderSceneToSvg(scene: DrawingScene) {
  const sheet = scene.sheets[0];
  if (!sheet) throw new Error('DrawingScene no contiene hojas.');
  const layers = new Map(sheet.layers.map((layer) => [layer.id, layer]));
  const content = sheet.entities.map((entity) => {
    const layer = layers.get(entity.layerId);
    return layer?.visible && layer.printable ? renderEntity(entity, layer) : '';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" viewBox="0 0 ${sheet.widthMm} ${sheet.heightMm}" data-scene-version="${scene.schemaVersion}" data-sheet-size="A3" data-orientation="landscape"><defs><pattern id="hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#aab4af" stroke-width=".2"/></pattern></defs><rect width="420" height="297" fill="#fff"/>${content}</svg>`;
}
