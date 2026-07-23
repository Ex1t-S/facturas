export type CommercialDraftItem = {
  lineId?: string;
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  taxRate?: number;
};

export type CommercialDraftMutation =
  | { kind: 'none' }
  | { kind: 'clear' }
  | { kind: 'delete'; target: string }
  | { kind: 'replace'; target: string; replacement: string }
  | { kind: 'quantity'; target: string; quantity: number }
  | { kind: 'price'; target: string; unitPrice: number };

export type MutationApplication = {
  status: 'not_a_mutation' | 'applied' | 'not_found' | 'ambiguous';
  items: CommercialDraftItem[];
  message?: string;
};

export const commercialMenu = [
  '¿Qué querés hacer?',
  '',
  '1. Crear presupuesto',
  '2. Crear remito',
  '3. Crear factura desde presupuesto',
  '4. Consultar documentos pendientes',
  '5. Buscar cliente o producto',
  '0. Cancelar / volver al inicio',
  '',
  'Podés responder con un número o pedirlo directamente por texto o audio.'
].join('\n');

export function normalizeCommercialText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCommercialMenuRequest(message: string) {
  return /^(?:menu|inicio|volver al inicio|opciones|que puedo hacer|ayuda)[.!\s]*$/i.test(normalizeCommercialText(message));
}

export function menuSelection(message: string, history?: Array<{ role: string; content: string }>) {
  const normalized = normalizeCommercialText(message);
  if (!/^[0-5]$/.test(normalized)) return null;
  const recentAssistant = [...(history ?? [])].reverse().find((entry) => entry.role === 'assistant')?.content ?? '';
  if (!recentAssistant.includes('1. Crear presupuesto') && !recentAssistant.includes('1. Presupuesto')) return null;
  return ({
    '0': 'menu',
    '1': 'quote',
    '2': 'delivery_note',
    '3': 'invoice',
    '4': 'pending_documents',
    '5': 'search'
  } as const)[normalized as '0' | '1' | '2' | '3' | '4' | '5'];
}

const numberWords: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10
};

function parseSpokenNumber(value: string) {
  const normalized = normalizeCommercialText(value).replace(/\$/g, '').trim();
  const word = numberWords[normalized];
  if (word !== undefined) return word;
  const thousands = normalized.match(/^([\d.,]+)\s*(?:mil|k)$/);
  const raw = thousands?.[1] ?? normalized;
  const parsed = Number(raw.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed * (thousands ? 1000 : 1) : undefined;
}

function cleanTarget(value: string) {
  return normalizeCommercialText(value)
    .replace(/\b(?:del|de la|de el)\s+(?:presupuesto|remito|borrador)\b/g, ' ')
    .replace(/^(?:el|la|los|las|item|renglon|linea)\s+/g, '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function customerChangeQuery(message: string) {
  const normalized = normalizeCommercialText(message);
  const match = normalized.match(/\b(?:cambia|cambiar|reemplaza|pone|poner)\s+(?:el\s+)?cliente\s+(?:a|por)\s+(.+)$/);
  return match?.[1] ? cleanTarget(match[1]) : undefined;
}

/** Extracts a requested display/file name without committing the document. */
export function documentNameChangeQuery(message: string) {
  const normalized = normalizeCommercialText(message);
  const match = normalized.match(/\b(?:cambia(?:r)?|modifica(?:r)?|renombra(?:r)?|pone|pon)\s+(?:el\s+)?(?:nombre|archivo)\s+(?:(?:del|de la|de el)\s+)?(?:remito|presupuesto|documento|archivo|remitente)?\s*(?:a|por|como)\s+(.+)$/);
  if (!match?.[1]) return undefined;
  return match[1].replace(/\.(?:pdf)$/i, '').replace(/["']/g, '').trim();
}

export function parseCommercialDraftMutation(message: string): CommercialDraftMutation {
  const normalized = normalizeCommercialText(message);
  if (/\b(?:borra|elimina|saca|quita)\s+(?:todos?\s+los\s+items|todos?\s+los\s+renglones|todo)\b/.test(normalized)) return { kind: 'clear' };

  const replace = normalized.match(/\b(?:reemplaza|cambia)\s+(.+?)\s+por\s+(.+)$/);
  if (replace?.[1] && replace[2] && !replace[1].includes('cliente')) {
    return { kind: 'replace', target: cleanTarget(replace[1]), replacement: cleanTarget(replace[2]) };
  }

  const instead = normalized.match(/\ben\s+vez\s+de\s+(\w+)\s+(.+?)\s+(?:pone|pon|coloca)\s+(\w+)\b/);
  if (instead?.[1] && instead[2] && instead[3]) {
    const quantity = parseSpokenNumber(instead[3]);
    if (quantity !== undefined) return { kind: 'quantity', target: cleanTarget(instead[2]), quantity };
  }

  const quantity = normalized.match(/\b(?:cambia|corrige|pone|pon)\s+(?:la\s+)?cantidad\s+(?:(?:de|del|de la)\s+)?(.+?)\s+(?:a|por)\s+(\w+)\b/);
  if (quantity?.[1] && quantity[2]) {
    const parsed = parseSpokenNumber(quantity[2]);
    if (parsed !== undefined) return { kind: 'quantity', target: cleanTarget(quantity[1]), quantity: parsed };
  }

  const price = normalized.match(/\b(?:cambia|corrige|pone|pon)\s+(?:el\s+)?precio\s+(?:(?:de|del|de la)\s+)?(.+?)\s+(?:a|por|en)\s+\$?\s*([\d.,]+\s*(?:mil|k)?)/);
  if (price?.[1] && price[2]) {
    const parsed = parseSpokenNumber(price[2]);
    if (parsed !== undefined) return { kind: 'price', target: cleanTarget(price[1]), unitPrice: parsed };
  }

  const deletion = normalized.match(/\b(?:borra|elimina|saca|quita)\s+(.+)$/);
  if (deletion?.[1]) return { kind: 'delete', target: cleanTarget(deletion[1]) };
  return { kind: 'none' };
}

function matchingIndexes(items: CommercialDraftItem[], target: string) {
  const indexMatch = target.match(/^(?:item\s*)?(\d+)$/);
  if (indexMatch) {
    const index = Number(indexMatch[1]) - 1;
    return index >= 0 && index < items.length ? [index] : [];
  }

  const needle = cleanTarget(target);
  if (!needle) return [];
  const needleTokens = needle.split(' ').filter((token) => token.length > 2);
  return items
    .map((item, index) => ({ index, text: normalizeCommercialText(item.description) }))
    .filter(({ text }) => text.includes(needle) || (needleTokens.length > 0 && needleTokens.every((token) => text.includes(token))))
    .map(({ index }) => index);
}

export function applyCommercialDraftMutation(message: string, currentItems: CommercialDraftItem[]): MutationApplication {
  const mutation = parseCommercialDraftMutation(message);
  if (mutation.kind === 'none') return { status: 'not_a_mutation', items: currentItems };
  if (mutation.kind === 'clear') return { status: 'applied', items: [], message: 'Eliminé todos los ítems del borrador.' };

  const matches = matchingIndexes(currentItems, mutation.target);
  if (matches.length === 0) return { status: 'not_found', items: currentItems, message: `No encontré un ítem que coincida con "${mutation.target}".` };
  if (matches.length > 1) {
    const options = matches.map((index) => `${index + 1}. ${currentItems[index]?.description}`).join('\n');
    return { status: 'ambiguous', items: currentItems, message: `Encontré más de un ítem:\n${options}\nDecime el número de ítem.` };
  }

  const index = matches[0]!;
  if (mutation.kind === 'delete') {
    const removed = currentItems[index]!;
    return { status: 'applied', items: currentItems.filter((_, itemIndex) => itemIndex !== index), message: `Eliminé: ${removed.description}.` };
  }

  const items = currentItems.map((item, itemIndex) => {
    if (itemIndex !== index) return item;
    if (mutation.kind === 'replace') return { ...item, description: mutation.replacement };
    if (mutation.kind === 'quantity') return { ...item, quantity: mutation.quantity };
    return { ...item, unitPrice: mutation.unitPrice };
  });
  const updated = items[index]!;
  const detail = mutation.kind === 'replace'
    ? updated.description
    : mutation.kind === 'quantity'
      ? `${updated.description}: cantidad ${updated.quantity}`
      : `${updated.description}: $${updated.unitPrice}`;
  return { status: 'applied', items, message: `Actualicé ${detail}.` };
}
