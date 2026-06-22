export function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-AR');
}

export function similarity(a: string, b: string) {
  const left = new Set(normalizeName(a).split(' ').filter(Boolean));
  const right = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}
