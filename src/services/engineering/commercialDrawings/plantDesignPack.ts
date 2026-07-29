import { drawA3CommercialSheet } from './a3Sheet.js';
import { drawingId, type DrawingEntity, type DrawingScene } from './drawingScene.js';
import { technicalValue, type CommercialDrawingTitleBlock, type EngineeringDesignRequestV2, type EngineeringDesignResultV2 } from './types.js';

const PACK_ID = 'grain-handling-plant-commercial';
const PACK_VERSION = '1.0.0';

export function buildGrainHandlingPlantCommercialDesign(request: EngineeringDesignRequestV2): EngineeringDesignResultV2 {
  const siteWidth = request.requestedDimensions.siteWidth || 40000;
  const siteLength = request.requestedDimensions.siteLength || 60000;
  const elevatorHeight = request.requestedDimensions.elevatorHeight || 25000;
  const siloCount = request.requestedDimensions.siloCount || 4;
  const siloCapacity = request.requestedDimensions.siloCapacity || 400;
  const notes = [
    `Predio orientativo: ${siteWidth / 1000} x ${siteLength / 1000} m.`,
    `Configuración base: ${siloCount} silos de ${siloCapacity} t; dos de recepción y dos de almacenamiento.`,
    `Noria representada con altura comercial orientativa de ${elevatorHeight / 1000} m.`,
    'Sinfines, limpiadora, pasarelas y conexiones son representaciones esquemáticas.',
    'Separaciones, fundaciones, estructuras, accionamientos y protecciones quedan pendientes de ingeniería.'
  ];
  const assumed = (value: number, unit: string, source: string, note: string) => technicalValue(value, unit, 'ILLUSTRATIVE_ASSUMPTION', source, note);
  return {
    schemaVersion: '2.0', designPackId: PACK_ID, designPackVersion: PACK_VERSION,
    normalizedInputs: { productOrMaterial: technicalValue(request.productOrMaterial, '-', 'USER_INPUT', 'user-request', 'Material indicado por el usuario.') },
    calculatedValues: {
      totalNominalCapacity: technicalValue(siloCount * siloCapacity, 't', 'CALCULATED', 'plant-capacity', 'Suma de capacidades nominales.'),
      flowEquipmentHeight: request.requestedDimensions.elevatorHeight ? technicalValue(elevatorHeight, 'mm', 'USER_INPUT', 'elevator-height', notes[2]) : assumed(elevatorHeight, 'mm', 'elevator-height', notes[2])
    },
    assumedValues: { siteWidth: assumed(siteWidth, 'mm', 'plant-site-width', notes[0]), siteLength: assumed(siteLength, 'mm', 'plant-site-length', notes[0]), siloCount: assumed(siloCount, 'un', 'plant-defaults', notes[1]), siloCapacity: assumed(siloCapacity, 't', 'plant-defaults', notes[1]) },
    selectedConfiguration: { configuration: technicalValue('RECEPCIÓN + LIMPIEZA + ALMACENAMIENTO', '-', 'DESIGN_PACK', PACK_ID, 'Secuencia comercial orientativa.') },
    equipmentGeometry: { siteWidth: technicalValue(siteWidth, 'mm', 'CALCULATED', 'plant-site-width', notes[0]), siteLength: technicalValue(siteLength, 'mm', 'CALCULATED', 'plant-site-length', notes[0]) },
    components: [
      ...[1, 2].map((i) => ({ id: `silo-reception-${i}`, type: 'SILO', name: `Silo recepción ${i}`, values: { capacity: assumed(siloCapacity, 't', 'plant-defaults', 'Capacidad referencial.') }, status: 'REPRESENTATIVE' as const })),
      ...[1, 2].map((i) => ({ id: `silo-storage-${i}`, type: 'SILO', name: `Silo almacenamiento ${i}`, values: { capacity: assumed(siloCapacity, 't', 'plant-defaults', 'Capacidad referencial.') }, status: 'REPRESENTATIVE' as const })),
      { id: 'screw-main', type: 'SCREW_CONVEYOR', name: 'Sinfín colector', values: {}, status: 'PENDING_SELECTION' as const },
      { id: 'bucket-elevator-main', type: 'BUCKET_ELEVATOR', name: 'Noria principal', values: { height: assumed(elevatorHeight, 'mm', 'elevator-height', notes[2]) }, status: 'REPRESENTATIVE' as const },
      { id: 'cleaner-main', type: 'CLEANER', name: 'Limpiadora', values: {}, status: 'PENDING_SELECTION' as const }
    ],
    warnings: ['Plano de planta comercial preliminar. No define fundaciones, estructuras ni equipos para fabricación.', ...notes.slice(3)],
    missingData: request.requestedDimensions.siteWidth ? [] : ['dimensiones definitivas del terreno', 'cotas y niveles', 'capacidades reales', 'tránsito y mantenimiento'],
    sourceReferences: [{ id: PACK_ID, title: 'Regla interna de composición de planta comercial', type: 'DESIGN_PACK', url: null, accessedAt: null, note: 'Configuración reproducible; requiere revisión técnica.' }],
    commercialDescription: `Planta de manejo de ${request.productOrMaterial}: recepción, transporte, limpieza y almacenamiento.`,
    drawingSpec: { schemaVersion: '2.0', sheetSize: 'A3', orientation: 'LANDSCAPE', scale: 100, scaleMode: 'AUTO', drawingName: 'Planta general de silos - propuesta comercial', drawingNumber: `FMH-PLANTA-${siloCount}S-${Math.round(siteWidth / 1000)}X${Math.round(siteLength / 1000)}`, revision: 'A', quoteNumber: request.sourceBudgetId || 'PENDIENTE', drawnBy: 'FMH', reviewedBy: 'Ingeniero Civil German Arroyo ID 03136/5', approvedBy: 'Ingeniero Civil German Arroyo ID 03136/5', selectedViews: ['PLANTA GENERAL', 'FLUJO DE PRODUCTO'], notes },
    verificationStatus: 'REFERENCE_ONLY', generatedAt: new Date().toISOString()
  };
}

function titleBlock(result: EngineeringDesignResultV2, request: EngineeringDesignRequestV2, overrides: Partial<CommercialDrawingTitleBlock>): CommercialDrawingTitleBlock {
  return { company: 'FMH', project: request.projectName, customer: request.customerName, drawingName: result.drawingSpec.drawingName, equipment: 'PLANTA DE SILOS', capacity: `${result.calculatedValues.totalNominalCapacity.value} t nominales`, date: new Date().toLocaleDateString('es-AR'), scale: '1:100', drawnBy: 'FMH', reviewedBy: 'Ingeniero Civil German Arroyo ID 03136/5', approvedBy: 'Ingeniero Civil German Arroyo ID 03136/5', drawingNumber: result.drawingSpec.drawingNumber, revision: 'A', quoteNumber: request.sourceBudgetId || 'PENDIENTE', observations: 'Composición comercial orientativa. Ingeniería pendiente.', ...overrides };
}

export function buildGrainHandlingPlantA3Scene(result: EngineeringDesignResultV2, request: EngineeringDesignRequestV2, overrides: Partial<CommercialDrawingTitleBlock> = {}): DrawingScene {
  const scene = drawA3CommercialSheet({ designPackId: PACK_ID, designPackVersion: PACK_VERSION, scale: 100, titleBlock: titleBlock(result, request, overrides), notes: result.drawingSpec.notes });
  const sheet = scene.sheets[0];
  const entities: DrawingEntity[] = [];
  const geom = { stroke: '#172630', strokeWidth: 0.45, fill: '#eef5f1' };
  const center = { stroke: '#7d8984', strokeWidth: 0.18, dash: [3, 1] };
  const conveyor = { stroke: '#1f5e45', strokeWidth: 1.1 };
  const silo = (id: string, cx: number, cy: number, label: string) => {
    entities.push({ id: drawingId(id), type: 'Circle', layerId: 'geometry', cx, cy, radius: 14, style: geom }, { id: drawingId(`${id}-x`), type: 'CenterLine', layerId: 'center', start: { x: cx - 16, y: cy }, end: { x: cx + 16, y: cy }, style: center }, { id: drawingId(`${id}-y`), type: 'CenterLine', layerId: 'center', start: { x: cx, y: cy - 16 }, end: { x: cx, y: cy + 16 }, style: center }, { id: drawingId(`${id}-label`), type: 'Text', layerId: 'annotations', x: cx, y: cy + 1, text: label, style: { fontSize: 2.6, textAnchor: 'middle', fontWeight: 'bold', fill: '#172630' } });
  };
  entities.push({ id: drawingId('site'), type: 'Rectangle', layerId: 'geometry', x: 28, y: 29, width: 180, height: 178, style: { stroke: '#52615b', strokeWidth: 0.35, dash: [2, 1], fill: 'none' } }, { id: drawingId('site-title'), type: 'Text', layerId: 'annotations', x: 28, y: 26, text: 'PREDIO ORIENTATIVO 40 x 60 m', style: { fontSize: 3.2, fontWeight: 'bold', fill: '#172630' } });
  silo('reception-1', 62, 68, 'S1'); silo('reception-2', 102, 68, 'S2'); silo('storage-1', 62, 157, 'S3'); silo('storage-2', 102, 157, 'S4');
  entities.push({ id: drawingId('screw-reception'), type: 'Line', layerId: 'geometry', start: { x: 62, y: 82 }, end: { x: 102, y: 82 }, style: conveyor }, { id: drawingId('screw-storage'), type: 'Line', layerId: 'geometry', start: { x: 62, y: 143 }, end: { x: 102, y: 143 }, style: conveyor }, { id: drawingId('screw-label'), type: 'Text', layerId: 'annotations', x: 82, y: 78, text: 'SINFÍN COLECTOR', style: { fontSize: 2.5, textAnchor: 'middle', fill: '#1f5e45' } });
  entities.push({ id: drawingId('cleaner'), type: 'Rectangle', layerId: 'geometry', x: 132, y: 95, width: 25, height: 24, style: { stroke: '#172630', strokeWidth: 0.5, fill: '#fffdf4' } }, { id: drawingId('cleaner-label'), type: 'Text', layerId: 'annotations', x: 144.5, y: 108, text: 'LIMPIADORA', style: { fontSize: 2.5, textAnchor: 'middle', fontWeight: 'bold', fill: '#172630' } }, { id: drawingId('elevator'), type: 'Rectangle', layerId: 'geometry', x: 173, y: 75, width: 14, height: 72, style: { stroke: '#172630', strokeWidth: 0.55, fill: '#e8f0ed' } }, { id: drawingId('elevator-label'), type: 'Text', layerId: 'annotations', x: 180, y: 112, text: 'NORIA\n25 m', rotateDeg: -90, style: { fontSize: 2.7, textAnchor: 'middle', fontWeight: 'bold', fill: '#172630' } });
  entities.push({ id: drawingId('flow-1'), type: 'Leader', layerId: 'dimensions', start: { x: 116, y: 82 }, elbow: { x: 125, y: 82 }, end: { x: 132, y: 101 }, text: 'flujo recepción' }, { id: drawingId('flow-2'), type: 'Leader', layerId: 'dimensions', start: { x: 157, y: 108 }, elbow: { x: 165, y: 108 }, end: { x: 173, y: 108 }, text: 'elevación' }, { id: drawingId('flow-3'), type: 'Leader', layerId: 'dimensions', start: { x: 173, y: 75 }, elbow: { x: 160, y: 65 }, end: { x: 110, y: 65 }, text: 'descarga a almacenamiento' }, { id: drawingId('width'), type: 'LinearDimension', layerId: 'dimensions', start: { x: 28, y: 213 }, end: { x: 208, y: 213 }, offset: 5, text: '40 m aprox.' }, { id: drawingId('length'), type: 'LinearDimension', layerId: 'dimensions', start: { x: 214, y: 29 }, end: { x: 214, y: 207 }, offset: 5, text: '60 m aprox.' }, { id: drawingId('north'), type: 'Text', layerId: 'annotations', x: 199, y: 38, text: 'N ↑', style: { fontSize: 3.5, fontWeight: 'bold', textAnchor: 'middle' } });
  entities.push({ id: drawingId('equipment-table'), type: 'Table', layerId: 'annotations', x: 230, y: 28, columnWidths: [25, 70], rowHeights: [6, 6, 6, 6, 6, 6, 6], rows: [['TAG', 'EQUIPO'], ['S1-S2', 'Silos recepción 400 t'], ['S3-S4', 'Silos almacenamiento 400 t'], ['SC-01', 'Sinfín colector'], ['NE-01', 'Noria 25 m'], ['L-01', 'Limpiadora'], ['FLUJO', 'Recepción → limpieza → almacenamiento']], style: { fontSize: 2.6, stroke: '#b7c3be', strokeWidth: 0.2, fill: '#172630' } });
  sheet.entities.push(...entities); sheet.views.push({ id: 'plant-view', name: 'Planta general', scale: 100, bounds: { x: 28, y: 29, width: 180, height: 178 }, entityIds: entities.map((entity) => entity.id) });
  return scene;
}
