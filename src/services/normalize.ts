export function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-AR');
}

export function technicalTokens(value: string) {
  const normalized = normalizeName(value)
    .replace(/["']/g, '')
    .replace(/x/g, ' x ')
    .replace(/\//g, ' / ')
    .replace(/(?<=\d)(?=[a-z])/g, ' ')
    .replace(/(?<=[a-z])(?=\d)/g, ' ');
  const baseTokens = normalized.split(/[^a-z0-9./]+/).filter(Boolean);
  const aliases = baseTokens.flatMap((token) => {
    if (token === 'cano') return ['tubo'];
    if (token === 'chapa') return ['placa'];
    if (token === 'galvanizada') return ['galvanizado', 'cincalum'];
    return [];
  });
  return Array.from(new Set([...baseTokens, ...aliases]));
}

export function similarity(a: string, b: string) {
  const left = new Set(technicalTokens(a));
  const right = new Set(technicalTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

export function bestTechnicalSimilarity(base: string, candidates: string[]) {
  return candidates.reduce((best, candidate) => Math.max(best, similarity(base, candidate)), 0);
}
