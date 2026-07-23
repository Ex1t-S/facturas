import type { CommercialCurrency } from './types.js';
import { foldCommercialText } from './normalizer.js';

const numberWords: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10
};

export function parseCommercialNumber(value: string): number | undefined {
  const normalized = foldCommercialText(value).replace(/\$/g, '').trim();
  if (numberWords[normalized] !== undefined) return numberWords[normalized];
  const multiplierMatch = normalized.match(/^([\d.,]+)\s*(mil|k)$/);
  const raw = multiplierMatch?.[1] ?? normalized;
  const compact = raw.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!compact) return undefined;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed * (multiplierMatch ? 1000 : 1) : undefined;
}

export function detectCurrency(value: string): CommercialCurrency | undefined {
  const normalized = foldCommercialText(value);
  if (/\b(?:usd|u\$s|dolar|dolares)\b/.test(normalized)) return 'USD';
  if (/\b(?:ars|pesos?)\b/.test(normalized)) return 'ARS';
  return undefined;
}

export function parseMoneyExpression(
  value: string,
  options: { allowBare?: boolean; inheritedCurrency?: CommercialCurrency } = {}
) {
  const normalized = foldCommercialText(value);
  const marked = normalized.match(
    /(?:precio|importe|valor|costo)\s*(?:unitario\s*)?(?:a|de|por|en|:|=)?\s*(?:usd|u\$s|ars|\$)?\s*([\d.,]+(?:\s*(?:mil|k))?)\s*(?:usd|u\$s|dolares?|ars|pesos?|\$)?/
  );
  const symbolFirst = normalized.match(/(?:usd|u\$s|ars|\$)\s*([\d.,]+(?:\s*(?:mil|k))?)/);
  const symbolLast = normalized.match(
    /([\d.,]+(?:\s*(?:mil|k))?)\s*(?:usd\b|u\$s\b|dolares?\b|ars\b|pesos?\b|\$)/
  );
  const bareMatches = options.allowBare
    ? [...normalized.matchAll(/(?:^|\s)([\d.,]+(?:\s*(?:mil|k))?)(?=\s|$)/g)]
    : [];
  // Price mutation messages often contain the referenced item number before the
  // actual amount ("item 1 a 50000"). The monetary amount is the last bare
  // number, never the first positional reference.
  const bare = bareMatches.at(-1);
  const token = marked?.[1] ?? symbolFirst?.[1] ?? symbolLast?.[1] ?? bare?.[1];
  const amount = token ? parseCommercialNumber(token) : undefined;
  return {
    amount,
    currency: detectCurrency(value) ?? options.inheritedCurrency,
    explicit: Boolean(marked || symbolFirst || symbolLast || bare)
  };
}
