import { describe, expect, it } from 'vitest';
import { cylinderVolume, coneVolume, frustumOfConeVolume, frustumOfPyramidVolume, rectangularPrism } from './geometry.js';
import { rectangularHollowSection, circularTubeSection } from './sections.js';
import { sheetMass } from './materials.js';
import { convertUnit } from './units.js';
import { calculateBomCost } from './costing.js';
import { engineeringExtractionSchema } from '../../services/engineering/engineeringSchemas.js';

describe('engineering deterministic calculations', () => {
  it('converts compatible units and rejects incompatible ones', () => {
    expect(convertUnit(1, 'm', 'mm')).toBe(1000);
    expect(convertUnit(2, 't', 'kg')).toBe(2000);
    expect(() => convertUnit(1, 'm', 'kg')).toThrow();
  });
  it('calculates common volumes', () => {
    expect(rectangularPrism(2, 3, 4).result.value).toBe(24);
    expect(cylinderVolume(1, 2).result.value).toBeCloseTo(2 * Math.PI);
    expect(coneVolume(1, 3).result.value).toBeCloseTo(Math.PI);
    expect(frustumOfConeVolume(2, 1, 3).result.value).toBeCloseTo(7 * Math.PI);
    expect(frustumOfPyramidVolume(16, 1, 3).result.value).toBeCloseTo(21);
  });
  it('calculates sheet mass and section properties', () => {
    expect(sheetMass(10, 4, 'acero al carbono').result.value).toBeCloseTo(314);
    expect(rectangularHollowSection(100, 100, 5).areaMm2).toBe(1900);
    expect(circularTubeSection(100, 5).areaMm2).toBeGreaterThan(0);
  });
  it('keeps cost lines without price visible', () => {
    const result = calculateBomCost([{ description: 'Chapa', quantity: 2, unit: 'm2', unitPrice: 100, source: 'CURRENT_PRICE' }, { description: 'Perfil', quantity: 3, unit: 'm', source: 'NO_PRICE' }]);
    expect(result.total).toBe(200);
    expect(result.withoutPrice).toHaveLength(1);
  });
  it('validates structured extractions', () => {
    const parsed = engineeringExtractionSchema.parse({ documentType: 'PROJECT', projectType: 'HOPPER', extractionConfidence: 0.8, evidence: [] });
    expect(parsed.projectType).toBe('HOPPER');
    expect(() => engineeringExtractionSchema.parse({ projectType: 'NOT_A_PROJECT' })).toThrow();
  });
});
