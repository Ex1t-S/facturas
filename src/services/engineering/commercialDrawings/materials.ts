import type { BulkMaterialSpec, SourceReference } from './types.js';

const initialReference: SourceReference = {
  id: 'FMH-BULK-MATERIALS-INITIAL-REFERENCE',
  title: 'Tabla inicial referencial de materiales a granel',
  type: 'MATERIAL_FIXTURE',
  url: null,
  accessedAt: null,
  note: 'Valores orientativos para presupuestación. Requieren contraste con ficha del producto y revisión técnica.'
};

function material(input: Omit<BulkMaterialSpec, 'sourceReferences' | 'verificationStatus'>): BulkMaterialSpec {
  return {
    ...input,
    sourceReferences: [initialReference],
    verificationStatus: 'REFERENCE_ONLY'
  };
}

export const bulkMaterialFixtures: BulkMaterialSpec[] = [
  material({
    id: 'wheat-reference-v1',
    commonName: 'trigo',
    category: 'cereal',
    bulkDensityMinKgM3: 720,
    bulkDensityNominalKgM3: 780,
    bulkDensityMaxKgM3: 830,
    angleOfReposeDeg: 28,
    particleSizeMinMm: 2,
    particleSizeMaxMm: 8,
    moisturePercent: 14,
    flowability: 'media-alta',
    abrasiveness: 'baja',
    corrosiveness: 'baja',
    explosibility: 'polvo combustible; evaluar protección específica',
    recommendedTroughLoadingPercent: 30,
    materialFactor: 1,
    specialHandlingNotes: ['Confirmar humedad, densidad del lote y requisitos de aireación.']
  }),
  material({
    id: 'maize-reference-v1',
    commonName: 'maíz',
    category: 'cereal',
    bulkDensityMinKgM3: 680,
    bulkDensityNominalKgM3: 720,
    bulkDensityMaxKgM3: 760,
    angleOfReposeDeg: 27,
    particleSizeMinMm: 5,
    particleSizeMaxMm: 14,
    moisturePercent: 14,
    flowability: 'alta',
    abrasiveness: 'baja',
    corrosiveness: 'baja',
    explosibility: 'polvo combustible; evaluar protección específica',
    recommendedTroughLoadingPercent: 30,
    materialFactor: 1,
    specialHandlingNotes: ['Confirmar presencia de quebrado y humedad.']
  }),
  material({
    id: 'soy-reference-v1',
    commonName: 'soja',
    category: 'oleaginosa',
    bulkDensityMinKgM3: 700,
    bulkDensityNominalKgM3: 750,
    bulkDensityMaxKgM3: 780,
    angleOfReposeDeg: 27,
    particleSizeMinMm: 4,
    particleSizeMaxMm: 10,
    moisturePercent: 13,
    flowability: 'alta',
    abrasiveness: 'baja',
    corrosiveness: 'baja',
    explosibility: 'polvo combustible; evaluar protección específica',
    recommendedTroughLoadingPercent: 30,
    materialFactor: 1,
    specialHandlingNotes: ['Confirmar densidad aparente y porcentaje de finos.']
  }),
  material({
    id: 'sunflower-reference-v1',
    commonName: 'girasol',
    category: 'oleaginosa',
    bulkDensityMinKgM3: 350,
    bulkDensityNominalKgM3: 400,
    bulkDensityMaxKgM3: 450,
    angleOfReposeDeg: 30,
    particleSizeMinMm: 5,
    particleSizeMaxMm: 15,
    moisturePercent: 11,
    flowability: 'media',
    abrasiveness: 'baja',
    corrosiveness: 'baja',
    explosibility: 'polvo combustible; evaluar protección específica',
    recommendedTroughLoadingPercent: 25,
    materialFactor: 1.1,
    specialHandlingNotes: ['La densidad puede variar significativamente según variedad e impurezas.']
  }),
  material({
    id: 'pellet-reference-v1',
    commonName: 'pellet',
    category: 'subproducto',
    bulkDensityMinKgM3: 550,
    bulkDensityNominalKgM3: 620,
    bulkDensityMaxKgM3: 700,
    angleOfReposeDeg: 32,
    particleSizeMinMm: 4,
    particleSizeMaxMm: 30,
    moisturePercent: 12,
    flowability: 'media',
    abrasiveness: 'media',
    corrosiveness: 'baja',
    explosibility: 'confirmar según composición',
    recommendedTroughLoadingPercent: 25,
    materialFactor: 1.2,
    specialHandlingNotes: ['Confirmar fragilidad, longitud y generación de finos.']
  }),
  material({
    id: 'flour-reference-v1',
    commonName: 'harina',
    category: 'polvo',
    bulkDensityMinKgM3: 500,
    bulkDensityNominalKgM3: 580,
    bulkDensityMaxKgM3: 650,
    angleOfReposeDeg: 40,
    particleSizeMinMm: 0.01,
    particleSizeMaxMm: 1,
    moisturePercent: 14,
    flowability: 'baja-variable',
    abrasiveness: 'baja',
    corrosiveness: 'baja',
    explosibility: 'polvo combustible; protección obligatoria a definir',
    recommendedTroughLoadingPercent: 15,
    materialFactor: 1.5,
    specialHandlingNotes: ['Evaluar cohesión, aireación, explosibilidad y tendencia a formar bóvedas.']
  }),
  material({
    id: 'granular-fertilizer-reference-v1',
    commonName: 'fertilizante granulado',
    category: 'fertilizante',
    bulkDensityMinKgM3: 900,
    bulkDensityNominalKgM3: 1050,
    bulkDensityMaxKgM3: 1200,
    angleOfReposeDeg: 32,
    particleSizeMinMm: 1,
    particleSizeMaxMm: 6,
    moisturePercent: 2,
    flowability: 'media',
    abrasiveness: 'media',
    corrosiveness: 'alta-variable',
    explosibility: 'confirmar según producto',
    recommendedTroughLoadingPercent: 20,
    materialFactor: 1.4,
    specialHandlingNotes: ['Confirmar formulación, higroscopicidad, corrosión y compatibilidad de materiales.']
  })
];

export function findBulkMaterial(value: string) {
  const normalized = value.trim().toLocaleLowerCase('es-AR');
  return bulkMaterialFixtures.find((item) => normalized.includes(item.commonName) || item.commonName.includes(normalized));
}
