export type PreliminarySiloGeometry = {
  capacityT: number;
  diameter: number;
  bodyHeight: number;
  coneHeight: number;
  lowerOpening: number;
  freeHeight: number;
  supportCount: number;
  bulkDensityTPerM3: number;
  usableFillRatio: number;
  coneAngleDeg: number;
  requiredGrossVolumeM3: number;
  proposedGrossVolumeM3: number;
  estimatedUsableCapacityT: number;
  assumptions: string[];
};

const FMH_REFERENCE_CAPACITY_T = 54;
const FMH_REFERENCE_DIAMETER_M = 4.15;

function round1(value: number) { return Math.round(value * 10) / 10; }
function ceil1(value: number) { return Math.ceil(value * 10) / 10; }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }

export function proposePreliminarySiloGeometry(capacityT: number): PreliminarySiloGeometry {
  if (!Number.isFinite(capacityT) || capacityT <= 0) throw new Error('La capacidad del silo debe ser mayor que cero.');

  // El antecedente FMH "Silo BA 4,15 Cono 50º" declara 54 t de trigo a 800 kg/m³.
  // Se escala el diámetro por semejanza cúbica y se resuelve el cuerpo cilíndrico
  // contra el volumen útil requerido. Esto es geometría volumétrica, no cálculo estructural.
  const bulkDensityTPerM3 = 0.8;
  const usableFillRatio = 0.9;
  const coneAngleDeg = 50;
  const lowerOpening = 0.4;
  const diameter = round1(clamp(
    FMH_REFERENCE_DIAMETER_M * Math.cbrt(capacityT / FMH_REFERENCE_CAPACITY_T),
    FMH_REFERENCE_DIAMETER_M,
    12
  ));
  const radius = diameter / 2;
  const lowerRadius = lowerOpening / 2;
  const coneHeight = ceil1((radius - lowerRadius) * Math.tan(coneAngleDeg * Math.PI / 180));
  const cylinderArea = Math.PI * radius ** 2;
  const coneVolume = Math.PI * coneHeight * (radius ** 2 + radius * lowerRadius + lowerRadius ** 2) / 3;
  const requiredGrossVolumeM3 = capacityT / (bulkDensityTPerM3 * usableFillRatio);
  const bodyHeight = ceil1(Math.max(2, (requiredGrossVolumeM3 - coneVolume) / cylinderArea));
  const proposedGrossVolumeM3 = cylinderArea * bodyHeight + coneVolume;
  const estimatedUsableCapacityT = proposedGrossVolumeM3 * bulkDensityTPerM3 * usableFillRatio;

  return {
    capacityT: round1(capacityT),
    diameter,
    bodyHeight,
    coneHeight,
    lowerOpening,
    freeHeight: 4,
    supportCount: 12,
    bulkDensityTPerM3,
    usableFillRatio,
    coneAngleDeg,
    requiredGrossVolumeM3: round1(requiredGrossVolumeM3),
    proposedGrossVolumeM3: round1(proposedGrossVolumeM3),
    estimatedUsableCapacityT: round1(estimatedUsableCapacityT),
    assumptions: [
      'Producto de referencia: trigo con densidad aparente ilustrativa de 0,80 t/m³.',
      'Volumen utilizable supuesto: 90 % del volumen geométrico.',
      'Cono ilustrativo de 50° y boca inferior de 0,40 m, basado en un antecedente histórico FMH no verificado.',
      'Altura libre de 4,00 m y 12 apoyos se muestran sólo para representación; deben definirse mediante cálculo estructural.'
    ]
  };
}
