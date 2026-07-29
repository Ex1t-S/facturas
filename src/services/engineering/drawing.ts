import { drawA3CommercialSheet } from './commercialDrawings/a3Sheet.js';
import { drawingId, type DrawingScene } from './commercialDrawings/drawingScene.js';
import { renderSceneToPdf } from './commercialDrawings/pdfRenderer.js';
import { buildSiloCommercialDesign } from './commercialDrawings/siloDesignPack.js';
import { buildSiloA3DrawingScene } from './commercialDrawings/siloDrawing.js';
import { renderSceneToSvg } from './commercialDrawings/svgRenderer.js';
import { proposePreliminarySiloGeometry, type PreliminarySiloGeometry } from './siloGeometry.js';

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

export function resolvePreliminaryEngineeringDrawing(spec: EngineeringDrawingSpec): {
  spec: EngineeringDrawingSpec;
  proposal?: PreliminarySiloGeometry;
} {
  if (spec.drawingType !== 'SILO' || !spec.capacityT) return { spec };
  const proposal = proposePreliminarySiloGeometry(spec.capacityT);
  const assumed = {
    diameter: spec.diameter || proposal.diameter,
    bodyHeight: spec.bodyHeight || proposal.bodyHeight,
    coneHeight: spec.coneHeight || proposal.coneHeight,
    lowerOpening: spec.lowerOpening || proposal.lowerOpening,
    freeHeight: spec.freeHeight || proposal.freeHeight,
    supportCount: spec.supportCount || proposal.supportCount
  };
  const generatedKeys = Object.keys(assumed).filter((key) => !spec[key as keyof EngineeringDrawingSpec]);
  const notes = [
    ...(spec.notes || []),
    ...(generatedKeys.length ? [
      `Geometría volumétrica propuesta para ${proposal.capacityT} t: Ø ${assumed.diameter} m, cuerpo ${assumed.bodyHeight} m y cono ${assumed.coneHeight} m.`,
      `Hipótesis: 0,80 t/m³, 90 % de llenado útil, cono 50° y boca Ø ${assumed.lowerOpening} m.`,
      'Apoyos, estructura, uniones y fundaciones no dimensionados; requieren cálculo y revisión profesional.'
    ] : [])
  ].slice(0, 6);
  return { spec: { ...spec, ...assumed, notes }, proposal };
}

function siloScene(spec: EngineeringDrawingSpec) {
  const resolved = resolvePreliminaryEngineeringDrawing(spec).spec;
  const result = buildSiloCommercialDesign({
    schemaVersion: '2.0',
    equipmentType: 'SILO',
    projectName: resolved.projectName || 'Predimensionamiento',
    customerName: resolved.customerName || 'Cliente a confirmar',
    productOrMaterial: 'trigo',
    capacity: resolved.capacityT || 1,
    capacityUnit: 't',
    requestedDimensions: {
      ...(resolved.diameter ? { diameter: resolved.diameter * 1000 } : {}),
      ...(resolved.bodyHeight ? { cylindricalHeight: resolved.bodyHeight * 1000 } : {}),
      ...(resolved.coneHeight ? { hopperHeight: resolved.coneHeight * 1000 } : {}),
      ...(resolved.freeHeight ? { dischargeClearance: resolved.freeHeight * 1000 } : {}),
      ...(resolved.lowerOpening ? { outletDiameter: resolved.lowerOpening * 1000 } : {})
    },
    siteRestrictions: [],
    preferredConfiguration: { bottomType: 'CONICAL', siloType: 'METALLIC_SUPPORTED', supportCount: resolved.supportCount || 6 },
    requiredComponents: ['ladder', 'platform'],
    optionalComponents: [],
    operatingConditions: { bulkDensityKgM3: 800, fillFactor: 0.9 },
    userNotes: resolved.notes || [],
    sourceConversationId: null,
    sourceBudgetId: null
  });
  result.drawingSpec.quoteNumber = resolved.quoteNumber || 'PENDIENTE';
  return buildSiloA3DrawingScene(result, {
    project: resolved.projectName || 'Predimensionamiento',
    customer: resolved.customerName || 'Cliente a confirmar',
    quoteNumber: resolved.quoteNumber || 'PENDIENTE'
  }, resolved.notes || []);
}

function genericScene(spec: EngineeringDrawingSpec): DrawingScene {
  const scene = drawA3CommercialSheet({
    designPackId: `LEGACY-${spec.drawingType}`,
    designPackVersion: 'compatibility-1',
    scale: 100,
    titleBlock: {
      company: 'FMH',
      project: spec.projectName || 'Predimensionamiento',
      customer: spec.customerName || 'Cliente a confirmar',
      drawingName: `${spec.drawingType} - esquema orientativo`,
      equipment: spec.drawingType,
      capacity: spec.capacityT ? `${spec.capacityT} t` : 'A CONFIRMAR',
      date: new Date().toLocaleDateString('es-AR'),
      scale: 'S/E',
      drawnBy: 'FMH Ingeniería',
      reviewedBy: 'Ingeniero Civil German Arroyo - ID 03136/5',
      approvedBy: 'PENDIENTE',
      drawingNumber: 'FMH-PRELIMINAR',
      revision: 'A',
      quoteNumber: spec.quoteNumber || 'PENDIENTE',
      observations: 'Representación orientativa.'
    },
    notes: spec.notes || ['Geometría representativa pendiente de DesignPack específico.']
  });
  const sheet = scene.sheets[0]!;
  const label = spec.drawingType === 'HOPPER' ? 'ELEVACIÓN GENERAL DE TOLVA' : 'VISTA GENERAL';
  sheet.entities.push(
    { id: drawingId('legacy-title'), type: 'Text', layerId: 'annotations', x: 28, y: 26, text: label, style: { fontSize: 4, fontWeight: 'bold', fill: '#172630' } },
    spec.drawingType === 'HOPPER'
      ? { id: drawingId('legacy-shape'), type: 'Polyline', layerId: 'geometry', points: [{ x: 65, y: 55 }, { x: 235, y: 55 }, { x: 190, y: 190 }, { x: 110, y: 190 }], closed: true }
      : { id: drawingId('legacy-shape'), type: 'Rectangle', layerId: 'geometry', x: 65, y: 55, width: 210, height: 130 },
    { id: drawingId('legacy-note'), type: 'Text', layerId: 'annotations', x: 70, y: 205, text: `ANCHO ${spec.width || 20} m · LARGO ${spec.length || 40} m · ALTURA ${spec.height || spec.bodyHeight || 8} m`, style: { fontSize: 3.4, fontWeight: 'bold', fill: '#1f5e45' } }
  );
  return scene;
}

export function renderPreliminaryEngineeringScene(spec: EngineeringDrawingSpec) {
  return spec.drawingType === 'SILO' ? siloScene(spec) : genericScene(spec);
}

export function renderPreliminaryEngineeringSvg(spec: EngineeringDrawingSpec) {
  return renderSceneToSvg(renderPreliminaryEngineeringScene(spec));
}

export async function renderPreliminaryEngineeringPdf(spec: EngineeringDrawingSpec) {
  return renderSceneToPdf(renderPreliminaryEngineeringScene(spec));
}
