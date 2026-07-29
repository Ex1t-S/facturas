import { drawA3CommercialSheet } from './a3Sheet.js';
import { drawingId, modelToPaper, selectDrawingScale, type DrawingEntity, type DrawingScene, type DrawingView } from './drawingScene.js';
import type { CommercialDrawingTitleBlock, EngineeringDesignResultV2 } from './types.js';

const value = (result: EngineeringDesignResultV2, key: string) => Number(result.equipmentGeometry[key]?.value || 0);
const formatM = (millimetres: number) => `${Number((millimetres / 1000).toFixed(2)).toLocaleString('es-AR')} m`;
const drawingNoteLabels: Record<string, string> = {
  diameter: 'Diámetro',
  cylindricalHeight: 'Altura cilíndrica',
  roofHeight: 'Altura de techo',
  hopperHeight: 'Altura de cono',
  dischargeClearance: 'Altura libre',
  outletDiameter: 'Diámetro de descarga',
  supportPitchDiameter: 'Diámetro entre ejes de apoyos',
  supportCount: 'Cantidad de apoyos'
};

function addEntity(scene: DrawingScene, view: DrawingView | null, entity: DrawingEntity) {
  const sheet = scene.sheets[0];
  if (!sheet) throw new Error('La escena A3 no contiene una hoja.');
  sheet.entities.push(entity);
  if (view) view.entityIds.push(entity.id);
}

function viewTitle(scene: DrawingScene, view: DrawingView, x: number, y: number, title: string) {
  addEntity(scene, view, {
    id: drawingId('view-title'),
    type: 'Text',
    layerId: 'annotations',
    x,
    y,
    text: title,
    style: { fontSize: 3.2, fontWeight: 'bold', fill: '#172630' }
  });
}

function elevationEntities(scene: DrawingScene, view: DrawingView, result: EngineeringDesignResultV2, centerX: number, groundY: number, mode: 'FRONT' | 'SIDE' | 'SECTION') {
  const scale = view.scale;
  const diameterMm = value(result, 'diameter');
  const bodyHeightMm = value(result, 'cylindricalHeight');
  const roofHeightMm = value(result, 'roofHeight');
  const hopperHeightMm = value(result, 'hopperHeight');
  const clearanceMm = value(result, 'dischargeClearance');
  const outletMm = value(result, 'outletDiameter');
  const totalHeightMm = value(result, 'totalHeight');
  const supportPitchMm = value(result, 'supportPitchDiameter');
  const rings = Math.max(1, Math.floor(value(result, 'visualRings')));
  const diameter = modelToPaper(diameterMm, scale);
  const bodyHeight = modelToPaper(bodyHeightMm, scale);
  const roofHeight = modelToPaper(roofHeightMm, scale);
  const hopperHeight = modelToPaper(hopperHeightMm, scale);
  const clearance = modelToPaper(clearanceMm, scale);
  const outlet = Math.max(2.5, modelToPaper(outletMm, scale));
  const supportPitch = modelToPaper(supportPitchMm, scale);
  const apexY = groundY - clearance;
  const bodyBottomY = apexY - hopperHeight;
  const bodyTopY = bodyBottomY - bodyHeight;
  const roofTopY = bodyTopY - roofHeight;
  const left = centerX - diameter / 2;
  const right = centerX + diameter / 2;
  const supportLeft = centerX - supportPitch / 2;
  const supportRight = centerX + supportPitch / 2;
  const geometry = (entity: DrawingEntity) => addEntity(scene, view, entity);
  geometry({ id: drawingId('center-line'), type: 'CenterLine', layerId: 'center', start: { x: centerX, y: roofTopY - 4 }, end: { x: centerX, y: groundY + 3 } });
  geometry({ id: drawingId('roof'), type: 'Polyline', layerId: 'geometry', points: [{ x: left, y: bodyTopY }, { x: centerX, y: roofTopY }, { x: right, y: bodyTopY }] });
  geometry({ id: drawingId('body'), type: 'Rectangle', layerId: 'geometry', x: left, y: bodyTopY, width: diameter, height: bodyHeight, style: { fill: mode === 'SECTION' ? '#f8faf9' : '#ffffff' } });
  geometry({ id: drawingId('hopper'), type: 'Polyline', layerId: 'geometry', points: [{ x: left, y: bodyBottomY }, { x: centerX - outlet / 2, y: apexY }, { x: centerX + outlet / 2, y: apexY }, { x: right, y: bodyBottomY }], closed: true, style: { fill: mode === 'SECTION' ? '#f8faf9' : '#ffffff' } });
  geometry({ id: drawingId('outlet'), type: 'Rectangle', layerId: 'geometry', x: centerX - outlet / 2, y: apexY, width: outlet, height: 4, style: { fill: '#ffffff' } });
  geometry({ id: drawingId('support-left'), type: 'Line', layerId: 'geometry', start: { x: supportLeft, y: bodyBottomY + 1 }, end: { x: supportLeft, y: groundY } });
  geometry({ id: drawingId('support-right'), type: 'Line', layerId: 'geometry', start: { x: supportRight, y: bodyBottomY + 1 }, end: { x: supportRight, y: groundY } });
  geometry({ id: drawingId('brace-a'), type: 'Line', layerId: 'hidden', start: { x: supportLeft, y: bodyBottomY + 5 }, end: { x: supportRight, y: groundY - 5 } });
  geometry({ id: drawingId('brace-b'), type: 'Line', layerId: 'hidden', start: { x: supportRight, y: bodyBottomY + 5 }, end: { x: supportLeft, y: groundY - 5 } });
  geometry({ id: drawingId('ground'), type: 'Line', layerId: 'geometry', start: { x: left - 6, y: groundY }, end: { x: right + 6, y: groundY }, style: { strokeWidth: 0.6 } });
  for (let index = 1; index < rings; index += 1) {
    const y = bodyTopY + bodyHeight * index / rings;
    geometry({ id: drawingId('visual-ring'), type: 'Line', layerId: 'geometry', start: { x: left, y }, end: { x: right, y }, style: { strokeWidth: 0.18, stroke: '#718079' } });
  }
  if (mode === 'SIDE') {
    const ladderX = right + 4;
    geometry({ id: drawingId('ladder-left'), type: 'Line', layerId: 'geometry', start: { x: ladderX, y: groundY }, end: { x: ladderX, y: bodyTopY - 1 } });
    geometry({ id: drawingId('ladder-right'), type: 'Line', layerId: 'geometry', start: { x: ladderX + 3, y: groundY }, end: { x: ladderX + 3, y: bodyTopY - 1 } });
    for (let y = bodyTopY + 2; y < groundY; y += 4) geometry({ id: drawingId('ladder-rung'), type: 'Line', layerId: 'geometry', start: { x: ladderX, y }, end: { x: ladderX + 3, y }, style: { strokeWidth: 0.18 } });
    geometry({ id: drawingId('platform'), type: 'Rectangle', layerId: 'geometry', x: right - 2, y: bodyTopY - 5, width: 15, height: 3, style: { fill: '#ffffff' } });
  }
  if (mode === 'SECTION') {
    geometry({ id: drawingId('grain-hatch'), type: 'Hatch', layerId: 'hidden', boundary: [{ x: left + 1, y: bodyTopY + 7 }, { x: right - 1, y: bodyTopY + 7 }, { x: right - 1, y: bodyBottomY - 1 }, { x: centerX + outlet / 2, y: apexY - 1 }, { x: centerX - outlet / 2, y: apexY - 1 }, { x: left + 1, y: bodyBottomY - 1 }], spacing: 3.5, angleDeg: 45 });
    geometry({ id: drawingId('grain-label'), type: 'Leader', layerId: 'annotations', start: { x: centerX + 5, y: bodyTopY + bodyHeight * .45 }, elbow: { x: right + 3, y: bodyTopY + bodyHeight * .35 }, end: { x: right + 8, y: bodyTopY + bodyHeight * .35 }, text: 'VOLUMEN ÚTIL ORIENTATIVO' });
  }
  geometry({ id: drawingId('diameter-dimension'), type: 'LinearDimension', layerId: 'dimensions', start: { x: left, y: bodyBottomY }, end: { x: right, y: bodyBottomY }, offset: mode === 'FRONT' ? 8 : 6, text: `Ø ${formatM(diameterMm)}` });
  if (mode === 'FRONT') {
    geometry({ id: drawingId('total-height-dimension'), type: 'LinearDimension', layerId: 'dimensions', start: { x: right, y: roofTopY }, end: { x: right, y: groundY }, offset: 8, text: `TOTAL ${formatM(totalHeightMm)}` });
    geometry({ id: drawingId('clearance-dimension'), type: 'LinearDimension', layerId: 'dimensions', start: { x: left, y: apexY }, end: { x: left, y: groundY }, offset: -7, text: `LIBRE ${formatM(clearanceMm)}` });
  }
  geometry({ id: drawingId('floor-level'), type: 'LevelMarker', layerId: 'annotations', point: { x: left - 5, y: groundY }, text: 'NPT ±0,00' });
}

function planView(scene: DrawingScene, view: DrawingView, result: EngineeringDesignResultV2, center: { x: number; y: number }, supportsOnly: boolean) {
  const diameterMm = value(result, 'diameter');
  const supportPitchMm = value(result, 'supportPitchDiameter');
  const supportCount = Math.max(3, Math.round(value(result, 'supportCount')));
  const radius = modelToPaper(supportsOnly ? supportPitchMm : diameterMm, view.scale) / 2;
  const entityIds = view.entityIds;
  const add = (entity: DrawingEntity) => addEntity(scene, view, entity);
  add({ id: drawingId('plan-outline'), type: 'Circle', layerId: 'geometry', cx: center.x, cy: center.y, radius: supportsOnly ? radius + modelToPaper((diameterMm - supportPitchMm) / 2, view.scale) : radius });
  add({ id: drawingId('plan-center-x'), type: 'CenterLine', layerId: 'center', start: { x: center.x - radius - 5, y: center.y }, end: { x: center.x + radius + 5, y: center.y } });
  add({ id: drawingId('plan-center-y'), type: 'CenterLine', layerId: 'center', start: { x: center.x, y: center.y - radius - 5 }, end: { x: center.x, y: center.y + radius + 5 } });
  if (supportsOnly) {
    add({ id: drawingId('support-pitch'), type: 'Circle', layerId: 'hidden', cx: center.x, cy: center.y, radius });
    for (let index = 0; index < supportCount; index += 1) {
      const angle = Math.PI * 2 * index / supportCount - Math.PI / 2;
      add({ id: drawingId('support-point'), type: 'Circle', layerId: 'geometry', cx: center.x + Math.cos(angle) * radius, cy: center.y + Math.sin(angle) * radius, radius: 1.35, style: { fill: '#1f5e45' } });
    }
    add({ id: drawingId('support-note'), type: 'Text', layerId: 'annotations', x: center.x, y: center.y + radius + 8, text: `${supportCount} APOYOS REPRESENTATIVOS`, style: { textAnchor: 'middle', fontSize: 2.6, fontWeight: 'bold', fill: '#1f5e45' } });
  } else {
    add({ id: drawingId('outlet-plan'), type: 'Circle', layerId: 'geometry', cx: center.x, cy: center.y, radius: Math.max(2, modelToPaper(value(result, 'outletDiameter'), view.scale) / 2) });
    add({ id: drawingId('platform-plan'), type: 'Rectangle', layerId: 'geometry', x: center.x + radius - 2, y: center.y - 8, width: 12, height: 16, style: { fill: '#ffffff' } });
  }
  add({ id: drawingId('plan-diameter'), type: 'DiameterDimension', layerId: 'dimensions', center, edge: { x: center.x + radius, y: center.y }, text: supportsOnly ? `EJES Ø ${formatM(supportPitchMm)}` : `Ø ${formatM(diameterMm)}` });
  return entityIds;
}

export function buildSiloA3DrawingScene(
  result: EngineeringDesignResultV2,
  titleBlockOverrides: Partial<CommercialDrawingTitleBlock> = {},
  additionalNotes: string[] = []
) {
  const diameterMm = value(result, 'diameter');
  const totalHeightMm = value(result, 'totalHeight');
  const scale = result.drawingSpec.scaleMode === 'MANUAL'
    ? result.drawingSpec.scale
    : selectDrawingScale(diameterMm, totalHeightMm, 82, 194);
  result.drawingSpec.scale = scale;
  const titleBlock: CommercialDrawingTitleBlock = {
    company: 'FMH',
    project: 'Propuesta comercial orientativa',
    customer: 'Cliente a confirmar',
    drawingName: result.drawingSpec.drawingName,
    equipment: 'SILO METÁLICO',
    capacity: `${result.normalizedInputs.capacity.value} ${result.normalizedInputs.capacity.unit}`,
    date: new Date(result.generatedAt).toLocaleDateString('es-AR'),
    scale: `1:${scale}`,
    drawnBy: result.drawingSpec.drawnBy,
    reviewedBy: result.drawingSpec.reviewedBy,
    approvedBy: result.drawingSpec.approvedBy,
    drawingNumber: result.drawingSpec.drawingNumber,
    revision: result.drawingSpec.revision,
    quoteNumber: result.drawingSpec.quoteNumber,
    observations: 'Representación orientativa; ingeniería pendiente.',
    ...titleBlockOverrides
  };
  const assumptionNotes = Object.entries(result.assumedValues).map(([key, item]) => `${drawingNoteLabels[key] || key}: ${item.value} ${item.unit} — ASUMIDO. ${item.note}`);
  const scene = drawA3CommercialSheet({
    designPackId: result.designPackId,
    designPackVersion: result.designPackVersion,
    scale,
    titleBlock,
    notes: [
      ...additionalNotes,
      ...assumptionNotes.slice(0, 3),
      `Capacidad geométrica aproximada: ${result.calculatedValues.estimatedCapacity.value} t.`,
      'Apoyos, espesores, uniones y fundaciones: representación orientativa.',
      'Validación técnica y normativa pendiente.'
    ]
  });
  const sheet = scene.sheets[0];
  if (!sheet) throw new Error('No se pudo crear la hoja A3.');
  const views: DrawingView[] = [
    { id: 'front-elevation', name: 'ELEVACIÓN GENERAL', scale, bounds: { x: 22, y: 20, width: 82, height: 200 }, entityIds: [] },
    { id: 'side-elevation', name: 'ELEVACIÓN LATERAL', scale, bounds: { x: 112, y: 20, width: 82, height: 200 }, entityIds: [] },
    { id: 'longitudinal-section', name: 'CORTE LONGITUDINAL A-A', scale, bounds: { x: 202, y: 20, width: 92, height: 200 }, entityIds: [] },
    { id: 'top-view', name: 'VISTA SUPERIOR', scale, bounds: { x: 302, y: 20, width: 103, height: 91 }, entityIds: [] },
    { id: 'support-plan', name: 'PLANTA DE APOYOS', scale, bounds: { x: 302, y: 117, width: 103, height: 94 }, entityIds: [] }
  ];
  sheet.views.push(...views);
  const groundY = 217;
  viewTitle(scene, views[0], 23, 18, 'ELEVACIÓN GENERAL');
  elevationEntities(scene, views[0], result, 63, groundY, 'FRONT');
  viewTitle(scene, views[1], 113, 18, 'ELEVACIÓN LATERAL');
  elevationEntities(scene, views[1], result, 153, groundY, 'SIDE');
  viewTitle(scene, views[2], 203, 18, 'CORTE LONGITUDINAL A-A');
  elevationEntities(scene, views[2], result, 245, groundY, 'SECTION');
  viewTitle(scene, views[3], 303, 18, 'VISTA SUPERIOR');
  planView(scene, views[3], result, { x: 354, y: 67 }, false);
  viewTitle(scene, views[4], 303, 115, 'PLANTA DE APOYOS');
  planView(scene, views[4], result, { x: 354, y: 164 }, true);
  addEntity(scene, views[4], {
    id: drawingId('discharge-detail'),
    type: 'DetailCallout',
    layerId: 'annotations',
    center: { x: 397, y: 204 },
    radius: 5,
    text: 'D1'
  });
  addEntity(scene, views[4], {
    id: drawingId('discharge-leader'),
    type: 'Leader',
    layerId: 'annotations',
    start: { x: 397, y: 204 },
    elbow: { x: 378, y: 205 },
    end: { x: 365, y: 212 },
    text: `DESCARGA Ø ${formatM(value(result, 'outletDiameter'))} · REPRESENTATIVA`
  });
  return scene;
}
