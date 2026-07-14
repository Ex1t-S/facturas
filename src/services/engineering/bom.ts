import type { TakeoffLine } from './takeoff.js';

export type BomLine = TakeoffLine & { materialKey: string };

export function buildEngineeringBom(lines: TakeoffLine[]) {
  return lines.map((line) => ({ ...line, materialKey: line.specification || line.description }));
}

