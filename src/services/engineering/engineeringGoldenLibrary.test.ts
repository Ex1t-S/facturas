import { describe, expect, it } from 'vitest';
import { assertMethodContext, sourcePriority, validatePublicSourceUrl } from './engineeringSourceImporter.js';
import { parseCirsocRectangularSections, parseStructuralCatalogCsv } from './structuralCatalogImporter.js';
import { extractBenchmarkSlices } from './engineeringCuration.js';
import { entityReviewPatch, isBenchmarkReady, mergeDrawingCorrection, updatedSessionCounters } from './engineeringReview.js';
import { sanitizeEngineeringExtractedText } from './engineeringIngestion.js';

describe('engineering golden library controls', () => {
  it('accepts only HTTPS URLs on the declared official domain', () => {
    expect(validatePublicSourceUrl('https://www.inti.gob.ar/cirsoc', 'inti.gob.ar').hostname).toBe('www.inti.gob.ar');
    expect(() => validatePublicSourceUrl('http://www.inti.gob.ar/cirsoc', 'inti.gob.ar')).toThrow();
    expect(() => validatePublicSourceUrl('https://evil.example/cirsoc', 'inti.gob.ar')).toThrow();
  });

  it('keeps primary Argentine context separate from international references', () => {
    expect(() => assertMethodContext({ jurisdiction: 'AR', primaryStandard: 'CIRSOC 301', supportingReferences: [{ id: 'x', title: 'AISC', jurisdiction: 'USA', usagePolicy: 'PRIMARY' }] })).toThrow(/mezclar/);
    expect(assertMethodContext({ jurisdiction: 'AR', primaryStandard: 'CIRSOC 301', supportingReferences: [{ id: 'x', title: 'AISC', jurisdiction: 'USA', usagePolicy: 'INTERNATIONAL_REFERENCE' }] }).jurisdiction).toBe('AR');
  });

  it('ranks current official regulations before historical and international material', () => {
    expect(sourcePriority({ sourceType: 'REGULATION', verificationStatus: 'OFFICIAL_CURRENT' })).toBeLessThan(sourcePriority({ sourceType: 'INTERNATIONAL_REFERENCE', verificationStatus: 'OFFICIAL_CURRENT' }));
    expect(sourcePriority({ sourceType: 'REGULATION', verificationStatus: 'OFFICIAL_CURRENT' })).toBeLessThan(sourcePriority({ sourceType: 'REGULATION', verificationStatus: 'OFFICIAL_HISTORICAL' }));
  });

  it('preserves missing catalog properties instead of inventing them', () => {
    const rows = parseStructuralCatalogCsv('designation,type,area,ix\nSHS 150x150x6.35,SHS,36.4,');
    expect(rows[0].designation).toBe('SHS 150x150x6.35');
    expect(rows[0].ix).toBe(null);
  });

  it('extracts rectangular tube rows with explicit unit conversion and review state', () => {
    const rows = parseCirsocRectangularSections('Tubos de acero\nSección\nRectangular\n1.25 0.076 0.897 0.704 2.817 1.408 0.953 0.953 0.826 1.090 1.512 1.340 0.5 0.7 20 40');
    expect(rows[0].designation).toBe('RHS 20x40x1.25');
    expect(rows[0].area).toBeCloseTo(89.7);
    expect(rows[0].ix).toBeCloseTo(28170);
    expect(rows[0].notes).toContain('NEEDS_REVIEW');
  });

  it('skips the contents occurrence and keeps the embedded source page', () => {
    const slices = extractBenchmarkSlices('-- 4 of 10 --\nEJEMPLO N°1 ....\n-- 5 of 10 --\nEJEMPLO N°1\nEnunciado: dimensionar una barra.');
    expect(slices[0].pageReferences).toEqual([5]);
    expect(slices[0].excerpt).toContain('Enunciado');
  });

  it('only allows a benchmark to be confirmed when structured evidence exists', () => {
    expect(isBenchmarkReady({ inputJson: '{}', expectedOutputJson: '{"result":{"value":1}}', implementedTool: 'calculate_vertical_load' })).toBe(false);
    expect(isBenchmarkReady({ inputJson: '{"storedMassT":20}', expectedOutputJson: '{"result":{"value":196}}', implementedTool: 'calculate_vertical_load' })).toBe(true);
  });

  it('keeps human decisions explicit and resumable', () => {
    expect(entityReviewPatch('PROJECT', 'CONFIRMED', true)).toEqual({ status: 'CONFIRMED', verified: true });
    expect(entityReviewPatch('CATALOG', 'SKIPPED')).toEqual({ reviewStatus: 'SKIPPED', verified: false });
    expect(updatedSessionCounters({ processedCount: 2, confirmedCount: 1, correctedCount: 0, skippedCount: 1, rejectedCount: 0 }, 'CORRECTED').correctedCount).toBe(1);
  });

  it('merges drawing corrections without losing extracted fields', () => {
    expect(mergeDrawingCorrection({ diameter: 10, customer: 'FMH' }, 'diameter', 12)).toEqual({ diameter: 12, customer: 'FMH' });
  });

  it('removes PDF NUL bytes before persisting extracted text in PostgreSQL', () => {
    expect(sanitizeEngineeringExtractedText('EN 1993\u0000-1-5')).toBe('EN 1993-1-5');
  });
});
