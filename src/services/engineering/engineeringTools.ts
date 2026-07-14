import { calculateEulerBucklingReference, calculateNominalLoadPerSupport, calculateSectionUtilizationBasic, calculateSimpleAxialStress, calculateSlendernessRatio, calculateVerticalLoad } from '../../domain/engineering/structural.js';
import { circularTubeSection, rectangularHollowSection, rectangularSection } from '../../domain/engineering/sections.js';
import { calculatePurchase } from './purchasing.js';
import { buildSiloSupportTakeoff } from './takeoff.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';
import { searchEngineeringSectionCandidates } from './sectionCandidates.js';
import { listEngineeringDrawings } from './drawingLibrary.js';

const engineeringToolDefinitionsBase = [
  { type: 'function', name: 'search_relevant_fmh_precedents', description: 'Busca antecedentes técnicos internos FMH y devuelve fuentes trazables. Usar sólo cuando aporten valor a la pregunta.', parameters: { type: 'object', properties: { query: { type: 'string' }, projectType: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'search_official_engineering_regulations', description: 'Busca candidatos de reglamentos argentinos y fuentes oficiales registradas.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'search_relevant_fmh_drawings', description: 'Busca planos FMH relacionados con una consulta.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'get_inventory_sections', description: 'Obtiene candidatos de catálogo estructural/inventario sólo si tienen propiedades geométricas utilizables.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_vertical_load', description: 'Calcula carga vertical preliminar de masa almacenada y cargas ingresadas.', parameters: { type: 'object', properties: { storedMassT: { type: 'number' }, selfWeightKN: { type: 'number' }, additionalLoadKN: { type: 'number' } }, required: ['storedMassT'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_load_per_support', description: 'Calcula la carga vertical nominal ideal por apoyo.', parameters: { type: 'object', properties: { totalLoadKN: { type: 'number' }, supportCount: { type: 'integer' } }, required: ['totalLoadKN', 'supportCount'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'compare_support_alternatives', description: 'Compara dos o más cantidades explícitas de apoyos sin elegirlas por cuenta propia.', parameters: { type: 'object', properties: { totalLoadKN: { type: 'number' }, supportCounts: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 6 } }, required: ['totalLoadKN', 'supportCounts'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_simple_axial_stress', description: 'Calcula tensión axial básica a partir de fuerza y área.', parameters: { type: 'object', properties: { forceKN: { type: 'number' }, areaMm2: { type: 'number' } }, required: ['forceKN', 'areaMm2'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_slenderness', description: 'Calcula la relación geométrica de esbeltez.', parameters: { type: 'object', properties: { lengthMm: { type: 'number' }, radiusGyrationMm: { type: 'number' }, effectiveLengthFactor: { type: 'number' } }, required: ['lengthMm', 'radiusGyrationMm'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_euler_reference_buckling', description: 'Calcula una referencia elástica de Euler, no normativa.', parameters: { type: 'object', properties: { elasticModulusMPa: { type: 'number' }, inertiaMm4: { type: 'number' }, effectiveLengthMm: { type: 'number' } }, required: ['elasticModulusMPa', 'inertiaMm4', 'effectiveLengthMm'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'compare_section_candidates', description: 'Compara candidatos con propiedades suministradas. Devuelve tensión, esbeltez y Euler de referencia; no declara verificación normativa.', parameters: { type: 'object', properties: { forceKN: { type: 'number' }, lengthMm: { type: 'number' }, candidates: { type: 'array', items: { type: 'object', properties: { designation: { type: 'string' }, areaMm2: { type: 'number' }, ixMm4: { type: 'number' }, iyMm4: { type: 'number' }, kgPerM: { type: 'number' } }, required: ['designation', 'areaMm2', 'ixMm4', 'iyMm4'], additionalProperties: false } } }, required: ['forceKN', 'lengthMm', 'candidates'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'get_section_properties', description: 'Obtiene propiedades geométricas de una sección simple o hueca.', parameters: { type: 'object', properties: { kind: { type: 'string' }, widthMm: { type: 'number' }, heightMm: { type: 'number' }, thicknessMm: { type: 'number' }, diameterMm: { type: 'number' } }, required: ['kind'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'build_preliminary_takeoff', description: 'Prepara un cómputo geométrico preliminar de patas, diagonales y vinculación de un silo.', parameters: { type: 'object', properties: { supportCount: { type: 'integer' }, freeHeightM: { type: 'number' }, diameterM: { type: 'number' } }, required: ['supportCount', 'freeHeightM'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_purchase_plan', description: 'Calcula barras comerciales, sobrante y costo conocido a partir de metros y piezas.', parameters: { type: 'object', properties: { description: { type: 'string' }, needM: { type: 'number' }, commercialLengthM: { type: 'number' }, pricePerM: { type: 'number' } }, required: ['description', 'needM', 'commercialLengthM'], additionalProperties: false }, strict: true }
];

// Los esquemas incluyen argumentos opcionales. Responses API exige que, con
// strict=true, todas las propiedades sean obligatorias (o nullable). Mantener
// strict=false permite omitir esos argumentos y cada ejecutor valida los datos
// que realmente necesita antes de calcular.
export const engineeringToolDefinitions = engineeringToolDefinitionsBase.map((tool) => ({ ...tool, strict: false }));

function compareSections(forceKN: number, lengthMm: number, candidates: Array<{ designation: string; areaMm2: number; ixMm4: number; iyMm4: number; kgPerM?: number }>) {
  return candidates.map((candidate) => {
    const radiusX = Math.sqrt(candidate.ixMm4 / candidate.areaMm2);
    const radiusY = Math.sqrt(candidate.iyMm4 / candidate.areaMm2);
    const slenderness = calculateSlendernessRatio(lengthMm, Math.min(radiusX, radiusY)).result.value;
    const stress = calculateSimpleAxialStress(forceKN, candidate.areaMm2).result.value;
    const euler = calculateEulerBucklingReference({ elasticModulusMPa: 200000, inertiaMm4: Math.min(candidate.ixMm4, candidate.iyMm4), effectiveLengthMm: lengthMm }).result.value;
    return { ...candidate, axialStressMPa: stress, slenderness, eulerReferenceKN: euler, referenceMargin: euler / forceKN, screening: euler >= forceKN && slenderness <= 200 ? 'PASA CRIBADO PRELIMINAR' : 'REQUIERE REVISIÓN', note: 'Euler y límite de esbeltez usados sólo como cribado, no como verificación normativa.' };
  }).sort((a, b) => a.axialStressMPa - b.axialStressMPa);
}

export async function executeEngineeringTool(name: string, args: Record<string, unknown>, companyId: string) {
  switch (name) {
    case 'search_relevant_fmh_precedents':
    case 'search_fmh_engineering_knowledge': return searchEngineeringKnowledge({ companyId, q: String(args.query), projectType: args.projectType ? String(args.projectType) : undefined, take: 8 });
    case 'search_official_engineering_regulations': { const { searchOfficialEngineeringRegulations } = await import('./regulations.js'); return searchOfficialEngineeringRegulations(companyId, String(args.query)); }
    case 'search_relevant_fmh_drawings': return listEngineeringDrawings({ companyId, q: String(args.query), take: 12 });
    case 'get_inventory_sections': return searchEngineeringSectionCandidates(companyId, String(args.query), 24);
    case 'calculate_vertical_load': return calculateVerticalLoad({ storedMassT: Number(args.storedMassT), selfWeightKN: args.selfWeightKN === undefined ? undefined : Number(args.selfWeightKN), additionalLoadKN: args.additionalLoadKN === undefined ? undefined : Number(args.additionalLoadKN) });
    case 'calculate_load_per_support': return calculateNominalLoadPerSupport(Number(args.totalLoadKN), Number(args.supportCount));
    case 'compare_support_alternatives': return { rows: (args.supportCounts as unknown[]).map((count) => ({ supportCount: Number(count), ...calculateNominalLoadPerSupport(Number(args.totalLoadKN), Number(count)) })) };
    case 'calculate_simple_axial_stress': return calculateSimpleAxialStress(Number(args.forceKN), Number(args.areaMm2));
    case 'calculate_slenderness': return calculateSlendernessRatio(Number(args.lengthMm), Number(args.radiusGyrationMm), args.effectiveLengthFactor === undefined ? 1 : Number(args.effectiveLengthFactor));
    case 'calculate_euler_reference_buckling': return calculateEulerBucklingReference({ elasticModulusMPa: Number(args.elasticModulusMPa), inertiaMm4: Number(args.inertiaMm4), effectiveLengthMm: Number(args.effectiveLengthMm) });
    case 'compare_section_candidates': return compareSections(Number(args.forceKN), Number(args.lengthMm), (args.candidates || []) as Array<{ designation: string; areaMm2: number; ixMm4: number; iyMm4: number; kgPerM?: number }>);
    case 'get_section_properties': {
      const kind = String(args.kind);
      if (kind === 'rectangular') return rectangularSection(Number(args.widthMm), Number(args.heightMm));
      if (kind === 'rectangular_hollow' || kind === 'square_hollow') return rectangularHollowSection(Number(args.widthMm), Number(args.heightMm ?? args.widthMm), Number(args.thicknessMm));
      if (kind === 'circular_tube') return circularTubeSection(Number(args.diameterMm), Number(args.thicknessMm));
      throw new Error('Tipo de sección no soportado.');
    }
    case 'build_preliminary_takeoff': return buildSiloSupportTakeoff({ supportCount: Number(args.supportCount), freeHeightM: Number(args.freeHeightM), diameterM: args.diameterM === undefined ? undefined : Number(args.diameterM) });
    case 'calculate_purchase_plan': return calculatePurchase({ description: String(args.description), needM: Number(args.needM), commercialLengthM: Number(args.commercialLengthM), pricePerM: args.pricePerM === undefined ? undefined : Number(args.pricePerM) });
    default: throw new Error(`Herramienta no disponible: ${name}`);
  }
}
