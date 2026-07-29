export const technicalValueOrigins = [
  'USER_INPUT',
  'CALCULATED',
  'DESIGN_PACK',
  'MANUFACTURER_REFERENCE',
  'STANDARD_REFERENCE',
  'PUBLIC_TECHNICAL_REFERENCE',
  'ILLUSTRATIVE_ASSUMPTION'
] as const;

export type TechnicalValueOrigin = (typeof technicalValueOrigins)[number];

export type TechnicalValue<T = number | string | boolean> = {
  value: T;
  unit: string;
  origin: TechnicalValueOrigin;
  confidence: number;
  sourceReference: string;
  note: string;
};

export const equipmentTypes = [
  'SILO',
  'HOPPER',
  'SCREW_CONVEYOR',
  'BUCKET_ELEVATOR',
  'FEEDER',
  'DRAG_CONVEYOR',
  'BELT_CONVEYOR',
  'SUPPORT_STRUCTURE',
  'GRAIN_HANDLING_PLANT'
] as const;

export type EquipmentType = (typeof equipmentTypes)[number];

export type EngineeringDesignRequestV2 = {
  schemaVersion: '2.0';
  equipmentType: EquipmentType;
  projectName: string;
  customerName: string;
  productOrMaterial: string;
  capacity: number;
  capacityUnit: 't' | 'kg' | 'm3' | 't/h' | 'm3/h';
  requestedDimensions: Record<string, number>;
  siteRestrictions: string[];
  preferredConfiguration: Record<string, string | number | boolean>;
  requiredComponents: string[];
  optionalComponents: string[];
  operatingConditions: Record<string, string | number | boolean>;
  userNotes: string[];
  sourceConversationId: string | null;
  sourceBudgetId: string | null;
};

export type SourceReference = {
  id: string;
  title: string;
  type: 'INTERNAL_FORMULA' | 'DESIGN_PACK' | 'MATERIAL_FIXTURE' | 'PUBLIC' | 'MANUFACTURER' | 'STANDARD';
  url: string | null;
  accessedAt: string | null;
  note: string;
};

export type EngineeringDrawingSpecV2 = {
  schemaVersion: '2.0';
  sheetSize: 'A3';
  orientation: 'LANDSCAPE';
  scale: 20 | 25 | 50 | 75 | 100;
  scaleMode: 'MANUAL' | 'AUTO';
  drawingName: string;
  drawingNumber: string;
  revision: string;
  quoteNumber: string;
  drawnBy: string;
  reviewedBy: string;
  approvedBy: string;
  selectedViews: string[];
  notes: string[];
};

export type EngineeringDesignResultV2 = {
  schemaVersion: '2.0';
  designPackId: string;
  designPackVersion: string;
  normalizedInputs: Record<string, TechnicalValue>;
  calculatedValues: Record<string, TechnicalValue>;
  assumedValues: Record<string, TechnicalValue>;
  selectedConfiguration: Record<string, TechnicalValue>;
  equipmentGeometry: Record<string, TechnicalValue>;
  components: Array<{
    id: string;
    type: string;
    name: string;
    values: Record<string, TechnicalValue>;
    status: 'REPRESENTATIVE' | 'PENDING_SELECTION' | 'USER_SELECTED';
  }>;
  warnings: string[];
  missingData: string[];
  sourceReferences: SourceReference[];
  commercialDescription: string;
  drawingSpec: EngineeringDrawingSpecV2;
  verificationStatus: 'EXPERIMENTAL' | 'REFERENCE_ONLY' | 'REVIEWED' | 'APPROVED_FOR_COMMERCIAL_PRELIMINARY_USE';
  generatedAt: string;
};

export const designPackStatuses = [
  'EXPERIMENTAL',
  'REFERENCE_ONLY',
  'REVIEWED',
  'APPROVED_FOR_COMMERCIAL_PRELIMINARY_USE',
  'OBSOLETE'
] as const;

export type DesignPackStatus = (typeof designPackStatuses)[number];

export type DesignPack = {
  id: string;
  equipmentType: EquipmentType;
  version: string;
  name: string;
  description: string;
  inputSchema: string;
  outputSchema: string;
  requiredInputs: string[];
  optionalInputs: string[];
  defaultValues: Record<string, number | string | boolean>;
  formulas: Array<{ id: string; expression: string; note: string }>;
  lookupTables: string[];
  constraints: string[];
  warnings: string[];
  geometryBuilder: string;
  drawingTemplate: string;
  sourceReferences: SourceReference[];
  testCases: string[];
  verificationStatus: DesignPackStatus;
};

export type BulkMaterialSpec = {
  id: string;
  commonName: string;
  category: string;
  bulkDensityMinKgM3: number;
  bulkDensityNominalKgM3: number;
  bulkDensityMaxKgM3: number;
  angleOfReposeDeg: number;
  particleSizeMinMm: number;
  particleSizeMaxMm: number;
  moisturePercent: number;
  flowability: string;
  abrasiveness: string;
  corrosiveness: string;
  explosibility: string;
  recommendedTroughLoadingPercent: number;
  materialFactor: number;
  specialHandlingNotes: string[];
  sourceReferences: SourceReference[];
  verificationStatus: 'REFERENCE_ONLY' | 'REVIEWED' | 'FMH_VERIFIED';
};

export type CommercialDrawingTitleBlock = {
  company: string;
  project: string;
  customer: string;
  drawingName: string;
  equipment: string;
  capacity: string;
  date: string;
  scale: string;
  drawnBy: string;
  reviewedBy: string;
  approvedBy: string;
  drawingNumber: string;
  revision: string;
  quoteNumber: string;
  observations: string;
};

export const MANDATORY_COMMERCIAL_LEGEND =
  'DISEÑO Y DIMENSIONES ORIENTATIVAS PARA COTIZACIÓN. LAS MEDIDAS DEFINITIVAS PUEDEN MODIFICARSE DURANTE LA ETAPA DE INGENIERÍA Y FABRICACIÓN.';

export const PRELIMINARY_DOCUMENT_WARNING =
  'Este documento representa una propuesta comercial preliminar. Verificar diseño, materiales, estructura, accionamientos, seguridad y normativa antes de fabricar.';

export function technicalValue<T extends number | string | boolean>(
  value: T,
  unit: string,
  origin: TechnicalValueOrigin,
  sourceReference: string,
  note: string,
  confidence = 0.7
): TechnicalValue<T> {
  return { value, unit, origin, sourceReference, note, confidence };
}
