import { describe, expect, it } from 'vitest';
import { cylinderVolume, coneVolume, frustumOfConeVolume, frustumOfPyramidVolume, rectangularPrism } from './geometry.js';
import { rectangularHollowSection, circularTubeSection } from './sections.js';
import { sheetMass } from './materials.js';
import { convertUnit } from './units.js';
import { calculateBomCost } from './costing.js';
import { engineeringExtractionSchema } from '../../services/engineering/engineeringSchemas.js';
import { calculateEulerBucklingReference, calculateNominalLoadPerSupport, calculateSimpleAxialStress, calculateSlendernessRatio, calculateVerticalLoad } from './structural.js';
import { parseConversationState, updateConversationState, activeInputs } from '../../services/engineering/conversationState.js';
import { buildSiloSupportTakeoff, aggregateTakeoff } from '../../services/engineering/takeoff.js';
import { calculatePurchase } from '../../services/engineering/purchasing.js';
import { optimizeLinearCuts } from '../../services/engineering/cuttingOptimization.js';
import { buildSiloMaterialEstimate } from '../../services/engineering/engineeringEstimate.js';
import { renderPreliminaryEngineeringSvg } from '../../services/engineering/drawing.js';

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
  it('calculates structural preliminary traces without claiming a full verification', () => {
    const load = calculateVerticalLoad({ storedMassT: 200 });
    expect(load.result.value).toBeCloseTo(1961.33, 1);
    expect(calculateNominalLoadPerSupport(load.result.value, 4).result.value).toBeCloseTo(490.33, 1);
    expect(calculateSimpleAxialStress(100, 1000).result.value).toBe(100);
    expect(calculateSlendernessRatio(3000, 25).result.value).toBe(120);
    expect(calculateEulerBucklingReference({ elasticModulusMPa: 200000, inertiaMm4: 1e6, effectiveLengthMm: 3000 }).result.value).toBeGreaterThan(0);
  });
  it('retains and supersedes technical inputs across conversation turns', () => {
    let state = parseConversationState();
    state = updateConversationState(state, 'Necesito un silo aéreo de 200 toneladas.');
    state = updateConversationState(state, 'Es para maíz y va en Pergamino.');
    state = updateConversationState(state, 'Necesito 4 metros libres y comparar 4 patas contra 6.');
    expect(activeInputs(state).find((item) => item.key === 'capacity')?.value).toBe(200);
    expect(activeInputs(state).find((item) => item.key === 'product')?.value).toBe('maíz');
    expect(activeInputs(state).find((item) => item.key === 'location')?.value).toContain('Pergamino');
    expect(activeInputs(state).find((item) => item.key === 'freeHeight')?.value).toBe(4);
    expect(state.decisions).toHaveLength(1);
    expect(state.missingData.some((item) => ['product', 'location', 'freeHeight'].includes(item.key))).toBe(false);
    state = updateConversationState(state, 'El silo tiene 8 metros de diametro, 7 metros de cuerpo y un cono de 2 metros.');
    expect(activeInputs(state).find((item) => item.key === 'diameter')?.value).toBe(8);
    expect(activeInputs(state).find((item) => item.key === 'bodyHeight')?.value).toBe(7);
    expect(activeInputs(state).find((item) => item.key === 'coneHeight')?.value).toBe(2);
    state = updateConversationState(state, 'Corregir a 9 metros de di\u00e1metro.');
    expect(activeInputs(state).find((item) => item.key === 'diameter')?.value).toBe(9);
  });
  it('creates a preliminary takeoff and commercial purchase quantities', () => {
    const takeoff = buildSiloSupportTakeoff({ supportCount: 6, freeHeightM: 4, diameterM: 8, legCandidate: { id: 'a', designation: 'Tubo 100x100x4', kgPerM: 12, source: 'INVENTORY', sourceTitle: 'Inventario', verified: true } });
    const grouped = aggregateTakeoff(takeoff.lines);
    expect(grouped.find((line) => line.description === 'Patas de soporte')?.totalLengthM).toBe(24);
    expect(grouped.find((line) => line.description === 'Patas de soporte')?.estimatedWeightKg).toBe(288);
    expect(grouped.find((line) => line.description === 'Arriostramientos diagonales')?.totalLengthM).toBeGreaterThan(0);
    expect(calculatePurchase({ description: 'Tubo', needM: 43, commercialLengthM: 12, stockM: 0, pricePerM: 100 }).buyQuantity).toBe(4);
    expect(calculatePurchase({ description: 'Sin precio', needM: 10, commercialLengthM: 12 }).priceStatus).toBe('NO_PRICE');
  });
  it('builds a complete synthetic silo BOM, weight, cutting plan and known material cost', () => {
    const candidates = [
      { id: 'legs', designation: 'Tubo estructural de prueba A', kgPerM: 12, source: 'INVENTORY' as const, sourceTitle: 'Inventario sintético', verified: true, stockQuantity: 0, stockUnit: 'm', currentPrice: 100 },
      { id: 'braces', designation: 'Tubo estructural de prueba B', kgPerM: 7, source: 'INVENTORY' as const, sourceTitle: 'Inventario sintético', verified: true, stockQuantity: 0, stockUnit: 'm', currentPrice: 80 },
      { id: 'beams', designation: 'Perfil estructural de prueba C', kgPerM: 15, source: 'INVENTORY' as const, sourceTitle: 'Inventario sintético', verified: true, stockQuantity: 0, stockUnit: 'm', currentPrice: 120 }
    ];
    const result = buildSiloMaterialEstimate({ supportCount: 6, freeHeightM: 4, diameterM: 8, candidates });
    expect(result.materials).toHaveLength(3);
    expect(result.materials.reduce((sum, line) => sum + Number(line.totalLengthM || 0), 0)).toBeGreaterThan(70);
    expect(result.totalWeightKg).toBeGreaterThan(900);
    expect(result.purchase.every((line) => Number(line.buyQuantity) > 0)).toBe(true);
    expect(result.purchase.every((line) => line.priceStatus === 'CURRENT')).toBe(true);
    expect(result.costKnown).toBeGreaterThan(0);
    expect(result.missingPrices).toEqual([]);
    expect(optimizeLinearCuts([{ lengthM: 7, quantity: 3 }], 12)).toHaveLength(3);
    expect(calculatePurchase({ description: 'Tubo', needM: 21, commercialLengthM: 12, pricePerM: 10, pieces: [{ lengthM: 7, quantity: 3 }] }).subtotal).toBe(360);
  });
  it('generates a traceable FMH preliminary drawing without using image generation', () => {
    const svg = renderPreliminaryEngineeringSvg({ drawingType: 'SILO', diameter: 8, bodyHeight: 7, coneHeight: 2, freeHeight: 4, supportCount: 6, capacityT: 200, customerName: 'Cliente de prueba' });
    expect(svg).toContain('PLANO PRELIMINAR PARA PRESUPUESTO');
    expect(svg).toContain('NO APTO PARA FABRICACION');
    expect(svg).toContain('6 apoyos');
  });
});
