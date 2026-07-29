import type { DesignPack } from './types.js';

export const siloDesignPackDefinition: DesignPack = {
  id: 'FMH-SILO-COMMERCIAL-PRELIMINARY',
  equipmentType: 'SILO',
  version: '1.0.0',
  name: 'Silo comercial orientativo FMH',
  description: 'Dimensionamiento volumétrico y representación A3 para cotización. No dimensiona estructura ni fabricación.',
  inputSchema: 'EngineeringDesignRequestV2',
  outputSchema: 'EngineeringDesignResultV2',
  requiredInputs: ['productOrMaterial', 'capacity', 'capacityUnit'],
  optionalInputs: ['diameter', 'cylindricalHeight', 'roofHeight', 'hopperHeight', 'dischargeClearance', 'outletDiameter', 'supportCount'],
  defaultValues: {
    fillFactor: 0.92,
    hopperHeightDiameterRatio: 0.42,
    roofHeightDiameterRatio: 0.18,
    outletDiameterMm: 500,
    dischargeClearanceMm: 4000,
    supportCount: 8,
    visualRingHeightMm: 1000
  },
  formulas: [
    { id: 'required-volume', expression: 'capacityKg / bulkDensityKgM3', note: 'Volumen útil requerido.' },
    { id: 'cylinder-volume', expression: 'PI * diameterM^2 / 4 * cylindricalHeightM', note: 'Volumen geométrico cilíndrico.' },
    { id: 'cone-volume', expression: 'PI * diameterM^2 / 4 * hopperHeightM / 3', note: 'Volumen geométrico cónico.' },
    { id: 'estimated-capacity', expression: '(cylinderVolumeM3 + coneVolumeM3) * fillFactor * densityKgM3 / 1000', note: 'Capacidad másica orientativa.' }
  ],
  lookupTables: ['bulkMaterialFixtures'],
  constraints: ['Todos los valores internos se expresan en mm, kg y m3.', 'No calcular espesores, apoyos ni fundaciones definitivas.'],
  warnings: ['Verificar densidad real, condiciones del sitio y criterios de seguridad antes de cotizar definitivamente.'],
  geometryBuilder: 'buildSiloCommercialDesign',
  drawingTemplate: 'buildSiloA3DrawingScene',
  sourceReferences: [
    {
      id: 'FMH-SILO-GEOMETRY-V1',
      title: 'Reglas geométricas determinísticas iniciales para cotización',
      type: 'DESIGN_PACK',
      url: null,
      accessedAt: null,
      note: 'Reglas internas ilustrativas, pendientes de revisión técnica.'
    }
  ],
  testCases: ['silo-400t-wheat-conical-clearance-4m'],
  verificationStatus: 'REFERENCE_ONLY'
};

export const designPackRegistry: DesignPack[] = [siloDesignPackDefinition];
