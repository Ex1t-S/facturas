export type NormalizedCommercialMessage = {
  raw: string;
  folded: string;
};

export function foldCommercialText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCommercialMessage(raw: string): NormalizedCommercialMessage {
  return { raw, folded: foldCommercialText(raw) };
}

export function normalizeCommercialDescription(value: string) {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/\bgalpon\b/gi, 'galpón')
    .replace(/\b(\d+(?:[.,]\d+)?)\s*t(?:on(?:eladas?)?)?\b/gi, '$1 t')
    .replace(/^[,;:.\-\s]+|[,;:.\-\s]+$/g, '')
    .trim();
  return cleaned ? cleaned[0]!.toLocaleUpperCase('es-AR') + cleaned.slice(1) : '';
}

function foldedWithMap(value: string) {
  let folded = '';
  const map: number[] = [];
  let previousSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const source = value[index]!;
    const normalized = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR');
    for (const char of normalized) {
      if (/\s/.test(char)) {
        if (previousSpace) continue;
        folded += ' ';
        map.push(index);
        previousSpace = true;
      } else {
        folded += char;
        map.push(index);
        previousSpace = false;
      }
    }
  }
  return { folded, map };
}

export function replaceNormalizedFragment(source: string, target: string, replacement: string) {
  const sourceMapped = foldedWithMap(source);
  const targetFolded = foldCommercialText(target);
  if (!targetFolded) return { status: 'not_found' as const, value: source };
  const first = sourceMapped.folded.indexOf(targetFolded);
  if (first < 0) return { status: 'not_found' as const, value: source };
  if (sourceMapped.folded.indexOf(targetFolded, first + targetFolded.length) >= 0) {
    return { status: 'ambiguous' as const, value: source };
  }
  const start = sourceMapped.map[first]!;
  const lastMapped = sourceMapped.map[first + targetFolded.length - 1]!;
  const end = lastMapped + 1;
  return {
    status: 'replaced' as const,
    value: normalizeCommercialDescription(source.slice(0, start) + replacement.trim() + source.slice(end))
  };
}
