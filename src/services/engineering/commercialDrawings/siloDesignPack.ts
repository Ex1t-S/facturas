import { createHash } from 'node:crypto';
import { siloDesignPackDefinition } from './designPacks.js';
import { findBulkMaterial } from './materials.js';
import {
  MANDATORY_COMMERCIAL_LEGEND,
  PRELIMINARY_DOCUMENT_WARNING,
  technicalValue,
  type EngineeringDesignRequestV2,
  type EngineeringDesignResultV2,
  type TechnicalValue
} from './types.js';

const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));
const mmToM = (value: number) => value / 1000;

function asDimension(
  request: EngineeringDesignRequestV2,
  key: string,
  fallback: number,
  assumptionNote: string
): TechnicalValue<number> {
  const supplied = request.requestedDimensions[key];
  if (Number.isFinite(supplied) && supplied > 0) {
    return technicalValue(supplied, 'mm', 'USER_INPUT', 'USER_REQUEST', `Dimensión ingresada por el usuario: ${key}.`, 1);
  }
  return technicalValue(fallback, 'mm', 'ILLUSTRATIVE_ASSUMPTION', siloDesignPackDefinition.id, assumptionNote, 0.55);
}

function selectDiameterMm(requiredGrossVolumeM3: number) {
  const candidates = [4000, 4800, 5500, 6400, 7200, 8000, 9000, 10000, 12000];
  const preferred = candidates.find((diameter) => {
    const coneHeightM = mmToM(diameter * 0.42);
    const coneVolume = Math.PI * Math.pow(mmToM(diameter), 2) * coneHeightM / 12;
    const area = Math.PI * Math.pow(mmToM(diameter), 2) / 4;
    const bodyHeight = (requiredGrossVolumeM3 - coneVolume) / area;
    return bodyHeight > mmToM(diameter) * 0.9 && bodyHeight <= mmToM(diameter) * 1.35;
  });
  return preferred ?? candidates[candidates.length - 1];
}

export function buildSiloCommercialDesign(request: EngineeringDesignRequestV2): EngineeringDesignResultV2 {
  if (request.equipmentType !== 'SILO') throw new Error('El DesignPack de silo sólo acepta equipmentType SILO.');
  if (request.capacityUnit !== 't' && request.capacityUnit !== 'kg') throw new Error('El silo inicial requiere capacidad en t o kg.');
  const material = findBulkMaterial(request.productOrMaterial);
  const density = Number(request.operatingConditions.bulkDensityKgM3) || material?.bulkDensityNominalKgM3 || 780;
  const densityOrigin = Number(request.operatingConditions.bulkDensityKgM3) ? 'USER_INPUT' : 'DESIGN_PACK';
  const capacityKg = request.capacityUnit === 't' ? request.capacity * 1000 : request.capacity;
  const requestedVolumeM3 = capacityKg / density;
  const fillFactor = Number(request.operatingConditions.fillFactor) || Number(siloDesignPackDefinition.defaultValues.fillFactor);
  const requiredGrossVolumeM3 = requestedVolumeM3 / fillFactor;
  const suppliedDiameter = request.requestedDimensions.diameter;
  const diameterMm = suppliedDiameter || selectDiameterMm(requiredGrossVolumeM3);
  const diameter = asDimension(request, 'diameter', diameterMm, 'Diámetro seleccionado por regla geométrica reproducible del DesignPack.');
  const hopperHeight = asDimension(request, 'hopperHeight', diameterMm * 0.42, 'Altura de tolva asumida como 42 % del diámetro para la propuesta comercial.');
  const coneVolumeM3 = Math.PI * Math.pow(mmToM(Number(diameter.value)), 2) * mmToM(Number(hopperHeight.value)) / 12;
  const cylinderAreaM2 = Math.PI * Math.pow(mmToM(Number(diameter.value)), 2) / 4;
  const calculatedBodyHeightMm = Math.max(3000, (requiredGrossVolumeM3 - coneVolumeM3) / cylinderAreaM2 * 1000);
  const bodyHeight = request.requestedDimensions.cylindricalHeight
    ? asDimension(request, 'cylindricalHeight', calculatedBodyHeightMm, '')
    : technicalValue(round(calculatedBodyHeightMm, 0), 'mm', 'CALCULATED', 'required-volume+cylinder-volume+cone-volume', 'Altura cilíndrica calculada para alcanzar el volumen orientativo con la geometría seleccionada.', 0.82);
  const roofHeight = asDimension(request, 'roofHeight', diameterMm * 0.18, 'Altura visual de techo asumida como 18 % del diámetro.');
  const dischargeClearance = asDimension(request, 'dischargeClearance', 4000, 'Altura libre orientativa para descarga y equipo inferior.');
  const outletDiameter = asDimension(request, 'outletDiameter', Number(siloDesignPackDefinition.defaultValues.outletDiameterMm), 'Boca de descarga genérica pendiente de selección.');
  const supportPitchDiameter = asDimension(request, 'supportPitchDiameter', diameterMm * 0.82, 'Diámetro representativo entre ejes de apoyos.');
  const supportCountInput = Number(request.preferredConfiguration.supportCount);
  const supportCount = technicalValue(
    supportCountInput > 0 ? Math.floor(supportCountInput) : Number(siloDesignPackDefinition.defaultValues.supportCount),
    'un',
    supportCountInput > 0 ? 'USER_INPUT' : 'ILLUSTRATIVE_ASSUMPTION',
    supportCountInput > 0 ? 'USER_REQUEST' : siloDesignPackDefinition.id,
    'Cantidad representativa; no constituye dimensionamiento estructural.',
    supportCountInput > 0 ? 1 : 0.45
  );
  const cylinderVolumeM3 = cylinderAreaM2 * mmToM(Number(bodyHeight.value));
  const geometricVolumeM3 = cylinderVolumeM3 + coneVolumeM3;
  const estimatedCapacityT = geometricVolumeM3 * fillFactor * density / 1000;
  const differencePercent = (estimatedCapacityT - capacityKg / 1000) / (capacityKg / 1000) * 100;
  const totalHeightMm = Number(dischargeClearance.value) + Number(hopperHeight.value) + Number(bodyHeight.value) + Number(roofHeight.value);
  const visualRings = Math.max(4, Math.round(Number(bodyHeight.value) / Number(siloDesignPackDefinition.defaultValues.visualRingHeightMm)));
  const normalizedInputs: Record<string, TechnicalValue> = {
    capacity: technicalValue(round(capacityKg / 1000, 3), 't', 'USER_INPUT', 'USER_REQUEST', 'Capacidad nominal solicitada.', 1),
    bulkDensity: technicalValue(density, 'kg/m3', densityOrigin, densityOrigin === 'USER_INPUT' ? 'USER_REQUEST' : material?.id || 'wheat-reference-v1', densityOrigin === 'USER_INPUT' ? 'Densidad indicada por el usuario.' : 'Densidad aparente referencial; confirmar para el producto real.', densityOrigin === 'USER_INPUT' ? 1 : 0.55),
    fillFactor: technicalValue(fillFactor, 'ratio', 'DESIGN_PACK', siloDesignPackDefinition.id, 'Factor volumétrico orientativo del DesignPack.', 0.55)
  };
  const geometry: Record<string, TechnicalValue> = {
    diameter,
    cylindricalHeight: bodyHeight,
    roofHeight,
    hopperHeight,
    dischargeClearance,
    outletDiameter,
    supportPitchDiameter,
    supportCount,
    totalHeight: technicalValue(round(totalHeightMm, 0), 'mm', 'CALCULATED', 'silo-total-height', 'Suma de altura libre, tolva, cuerpo cilíndrico y techo.', 0.9),
    visualRings: technicalValue(visualRings, 'un', 'CALCULATED', 'visual-ring-count', 'Cantidad gráfica de anillos; no define espesores ni fabricación.', 0.8),
    floorLevel: technicalValue(request.requestedDimensions.floorLevel || 0, 'mm', request.requestedDimensions.floorLevel == null ? 'DESIGN_PACK' : 'USER_INPUT', request.requestedDimensions.floorLevel == null ? siloDesignPackDefinition.id : 'USER_REQUEST', 'Nivel de referencia del piso.', 0.9)
  };
  const assumedValues = Object.fromEntries(Object.entries(geometry).filter(([, item]) => item.origin === 'ILLUSTRATIVE_ASSUMPTION'));
  const warnings = [
    MANDATORY_COMMERCIAL_LEGEND,
    PRELIMINARY_DOCUMENT_WARNING,
    'Apoyos, placas, uniones, espesores y fundaciones son representativos y quedan pendientes de ingeniería.',
    ...(Math.abs(differencePercent) > 5 ? [`La capacidad geométrica estimada difiere ${round(Math.abs(differencePercent), 1)} % de la capacidad solicitada.`] : [])
  ];
  return {
    schemaVersion: '2.0',
    designPackId: siloDesignPackDefinition.id,
    designPackVersion: siloDesignPackDefinition.version,
    normalizedInputs,
    calculatedValues: {
      requiredUsefulVolume: technicalValue(round(requestedVolumeM3, 2), 'm3', 'CALCULATED', 'required-volume', 'Capacidad másica dividida por densidad aparente.', 0.9),
      cylinderVolume: technicalValue(round(cylinderVolumeM3, 2), 'm3', 'CALCULATED', 'cylinder-volume', 'Volumen geométrico del cuerpo cilíndrico.', 0.95),
      hopperVolume: technicalValue(round(coneVolumeM3, 2), 'm3', 'CALCULATED', 'cone-volume', 'Volumen geométrico del fondo cónico.', 0.95),
      geometricVolume: technicalValue(round(geometricVolumeM3, 2), 'm3', 'CALCULATED', 'cylinder-volume+cone-volume', 'Suma de cuerpo cilíndrico y cono.', 0.95),
      estimatedCapacity: technicalValue(round(estimatedCapacityT, 2), 't', 'CALCULATED', 'estimated-capacity', 'Capacidad geométrica orientativa con densidad y llenado indicados.', 0.8),
      capacityDifference: technicalValue(round(differencePercent, 2), '%', 'CALCULATED', 'capacity-comparison', 'Diferencia respecto de la capacidad nominal solicitada.', 0.85)
    },
    assumedValues,
    selectedConfiguration: {
      siloType: technicalValue(String(request.preferredConfiguration.siloType || 'METALLIC_SUPPORTED'), '', request.preferredConfiguration.siloType ? 'USER_INPUT' : 'DESIGN_PACK', request.preferredConfiguration.siloType ? 'USER_REQUEST' : siloDesignPackDefinition.id, 'Configuración comercial seleccionada.', request.preferredConfiguration.siloType ? 1 : 0.65),
      bottomType: technicalValue(String(request.preferredConfiguration.bottomType || 'CONICAL'), '', request.preferredConfiguration.bottomType ? 'USER_INPUT' : 'DESIGN_PACK', request.preferredConfiguration.bottomType ? 'USER_REQUEST' : siloDesignPackDefinition.id, 'Tipo de fondo.', request.preferredConfiguration.bottomType ? 1 : 0.8),
      roofType: technicalValue(String(request.preferredConfiguration.roofType || 'CONICAL'), '', request.preferredConfiguration.roofType ? 'USER_INPUT' : 'DESIGN_PACK', request.preferredConfiguration.roofType ? 'USER_REQUEST' : siloDesignPackDefinition.id, 'Tipo de techo representado.', request.preferredConfiguration.roofType ? 1 : 0.7)
    },
    equipmentGeometry: geometry,
    components: [
      { id: 'support-frame', type: 'SUPPORT_STRUCTURE', name: 'Estructura soporte representativa', values: { supportCount, supportPitchDiameter }, status: 'REPRESENTATIVE' },
      { id: 'ladder', type: 'ACCESS', name: 'Escalera con jaula y plataforma', values: {}, status: request.requiredComponents.includes('ladder') ? 'USER_SELECTED' : 'REPRESENTATIVE' },
      { id: 'outlet', type: 'DISCHARGE', name: 'Descarga genérica', values: { outletDiameter }, status: 'PENDING_SELECTION' }
    ],
    warnings,
    missingData: [
      ...(!request.siteRestrictions.length ? ['Restricciones reales de altura y espacio disponible'] : []),
      ...(!Number(request.operatingConditions.bulkDensityKgM3) ? ['Densidad aparente confirmada del producto'] : []),
      'Cargas de viento, sismo y operación',
      'Ingeniería de estructura, uniones y fundaciones'
    ],
    sourceReferences: [...siloDesignPackDefinition.sourceReferences, ...(material?.sourceReferences || [])],
    commercialDescription: `Silo metálico orientativo para ${round(capacityKg / 1000, 2)} t de ${request.productOrMaterial}, fondo cónico, descarga libre aproximada de ${round(mmToM(Number(dischargeClearance.value)), 2)} m y componentes representativos sujetos a ingeniería.`,
    drawingSpec: {
      schemaVersion: '2.0',
      sheetSize: 'A3',
      orientation: 'LANDSCAPE',
      scale: 100,
      scaleMode: 'AUTO',
      drawingName: `Silo ${round(capacityKg / 1000, 0)} t - propuesta comercial`,
      drawingNumber: `FMH-SILO-${createHash('sha256').update(`${request.projectName}|${capacityKg}|${request.productOrMaterial}`).digest('hex').slice(0, 8).toUpperCase()}`,
      revision: 'A',
      quoteNumber: request.sourceBudgetId || 'PENDIENTE',
      drawnBy: 'FMH Ingeniería',
      reviewedBy: 'Ingeniero Civil German Arroyo - ID 03136/5',
      approvedBy: 'PENDIENTE',
      selectedViews: ['FRONT_ELEVATION', 'SIDE_ELEVATION', 'LONGITUDINAL_SECTION', 'TOP_VIEW', 'SUPPORT_PLAN', 'DISCHARGE_DETAIL'],
      notes: warnings
    },
    verificationStatus: 'REFERENCE_ONLY',
    generatedAt: new Date().toISOString()
  };
}

export function createIllustrativeSilo400T(input: { seed: string }) {
  return buildSiloCommercialDesign({
    schemaVersion: '2.0',
    equipmentType: 'SILO',
    projectName: `Silo orientativo 400 t (${input.seed})`,
    customerName: 'Cliente a confirmar',
    productOrMaterial: 'trigo',
    capacity: 400,
    capacityUnit: 't',
    requestedDimensions: { dischargeClearance: 4000 },
    siteRestrictions: [],
    preferredConfiguration: { siloType: 'METALLIC_SUPPORTED', bottomType: 'CONICAL', roofType: 'CONICAL', supportCount: 8 },
    requiredComponents: ['ladder', 'safetyCage', 'platform', 'railing'],
    optionalComponents: ['inspectionHatch', 'ventilation'],
    operatingConditions: {},
    userNotes: [`Hipótesis reproducibles con semilla ${input.seed}.`],
    sourceConversationId: null,
    sourceBudgetId: null
  });
}
