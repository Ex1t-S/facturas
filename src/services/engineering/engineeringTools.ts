import { calculateEulerBucklingReference, calculateNominalLoadPerSupport, calculateSectionUtilizationBasic, calculateSimpleAxialStress, calculateSlendernessRatio, calculateVerticalLoad } from '../../domain/engineering/structural.js';
import { circularTubeSection, rectangularHollowSection, rectangularSection } from '../../domain/engineering/sections.js';
import { searchEngineeringKnowledge } from './engineeringKnowledge.js';
import { searchOfficialEngineeringRegulations } from './regulations.js';

export const engineeringToolDefinitions = [
  { type: 'function', name: 'search_fmh_engineering_knowledge', description: 'Busca antecedentes técnicos internos FMH con fuentes trazables.', parameters: { type: 'object', properties: { query: { type: 'string' }, projectType: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'search_official_engineering_regulations', description: 'Busca candidatos de reglamentos argentinos y fuentes oficiales registradas.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_vertical_load', description: 'Calcula carga vertical preliminar de masa almacenada y cargas ingresadas.', parameters: { type: 'object', properties: { storedMassT: { type: 'number' }, selfWeightKN: { type: 'number' }, additionalLoadKN: { type: 'number' } }, required: ['storedMassT'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_load_per_support', description: 'Calcula la carga vertical nominal ideal por apoyo.', parameters: { type: 'object', properties: { totalLoadKN: { type: 'number' }, supportCount: { type: 'integer' } }, required: ['totalLoadKN', 'supportCount'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_simple_axial_stress', description: 'Calcula tensión axial básica a partir de fuerza y área.', parameters: { type: 'object', properties: { forceKN: { type: 'number' }, areaMm2: { type: 'number' } }, required: ['forceKN', 'areaMm2'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_slenderness', description: 'Calcula la relación geométrica de esbeltez.', parameters: { type: 'object', properties: { lengthMm: { type: 'number' }, radiusGyrationMm: { type: 'number' }, effectiveLengthFactor: { type: 'number' } }, required: ['lengthMm', 'radiusGyrationMm'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'calculate_euler_reference_buckling', description: 'Calcula una referencia elástica de Euler, no normativa.', parameters: { type: 'object', properties: { elasticModulusMPa: { type: 'number' }, inertiaMm4: { type: 'number' }, effectiveLengthMm: { type: 'number' } }, required: ['elasticModulusMPa', 'inertiaMm4', 'effectiveLengthMm'], additionalProperties: false }, strict: true },
  { type: 'function', name: 'get_section_properties', description: 'Obtiene propiedades geométricas de una sección simple o hueca.', parameters: { type: 'object', properties: { kind: { type: 'string' }, widthMm: { type: 'number' }, heightMm: { type: 'number' }, thicknessMm: { type: 'number' }, diameterMm: { type: 'number' } }, required: ['kind'], additionalProperties: false }, strict: true }
];

export async function executeEngineeringTool(name: string, args: Record<string, unknown>, companyId: string) {
  switch (name) {
    case 'search_fmh_engineering_knowledge': return searchEngineeringKnowledge({ companyId, q: String(args.query), projectType: args.projectType ? String(args.projectType) : undefined, take: 8 });
    case 'search_official_engineering_regulations': return searchOfficialEngineeringRegulations(companyId, String(args.query));
    case 'calculate_vertical_load': return calculateVerticalLoad({ storedMassT: Number(args.storedMassT), selfWeightKN: args.selfWeightKN === undefined ? undefined : Number(args.selfWeightKN), additionalLoadKN: args.additionalLoadKN === undefined ? undefined : Number(args.additionalLoadKN) });
    case 'calculate_load_per_support': return calculateNominalLoadPerSupport(Number(args.totalLoadKN), Number(args.supportCount));
    case 'calculate_simple_axial_stress': return calculateSimpleAxialStress(Number(args.forceKN), Number(args.areaMm2));
    case 'calculate_slenderness': return calculateSlendernessRatio(Number(args.lengthMm), Number(args.radiusGyrationMm), args.effectiveLengthFactor === undefined ? 1 : Number(args.effectiveLengthFactor));
    case 'calculate_euler_reference_buckling': return calculateEulerBucklingReference({ elasticModulusMPa: Number(args.elasticModulusMPa), inertiaMm4: Number(args.inertiaMm4), effectiveLengthMm: Number(args.effectiveLengthMm) });
    case 'get_section_properties': {
      const kind = String(args.kind);
      if (kind === 'rectangular') return rectangularSection(Number(args.widthMm), Number(args.heightMm));
      if (kind === 'rectangular_hollow' || kind === 'square_hollow') return rectangularHollowSection(Number(args.widthMm), Number(args.heightMm ?? args.widthMm), Number(args.thicknessMm));
      if (kind === 'circular_tube') return circularTubeSection(Number(args.diameterMm), Number(args.thicknessMm));
      throw new Error('Tipo de sección no soportado.');
    }
    default: throw new Error(`Herramienta no disponible: ${name}`);
  }
}
