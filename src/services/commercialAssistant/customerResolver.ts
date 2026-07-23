import type { CommercialCustomer } from './types.js';
import { foldCommercialText } from './normalizer.js';

function significantTokens(value: string) {
  return foldCommercialText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !['sociedad', 'cooperativa', 'limitada', 'mixta', 'consumo', 'provision', 'transformacion', 'venta'].includes(token));
}

export type CustomerResolution =
  | { kind: 'RESOLVED'; customer: CommercialCustomer; matchedQuery: string }
  | { kind: 'AMBIGUOUS'; candidates: CommercialCustomer[]; matchedQuery: string }
  | { kind: 'NOT_FOUND' };

export function resolveCommercialCustomer(query: string, customers: CommercialCustomer[]): CustomerResolution {
  const needle = foldCommercialText(query).replace(/\b(?:srl|sa|sas|sh)\b/g, '').trim();
  const digits = query.replace(/\D/g, '');
  if (!needle) return { kind: 'NOT_FOUND' };
  const exact = customers.filter((customer) => {
    const names = [customer.legalName, customer.tradeName].filter(Boolean).map((value) => foldCommercialText(String(value)).replace(/\b(?:srl|sa|sas|sh)\b/g, '').trim());
    return names.includes(needle) || (digits.length >= 8 && customer.cuit?.replace(/\D/g, '') === digits);
  });
  if (exact.length === 1) return { kind: 'RESOLVED', customer: exact[0]!, matchedQuery: query };
  if (exact.length > 1) return { kind: 'AMBIGUOUS', candidates: exact.slice(0, 5), matchedQuery: query };
  const tokens = significantTokens(needle);
  const partial = customers.filter((customer) => {
    const haystack = foldCommercialText([customer.legalName, customer.tradeName, customer.cuit].filter(Boolean).join(' '));
    return haystack.includes(needle) || (tokens.length > 0 && tokens.every((token) => haystack.includes(token)));
  });
  if (partial.length === 1) return { kind: 'RESOLVED', customer: partial[0]!, matchedQuery: query };
  if (partial.length > 1) return { kind: 'AMBIGUOUS', candidates: partial.slice(0, 5), matchedQuery: query };
  return { kind: 'NOT_FOUND' };
}

export function findCustomerInsideMessage(message: string, customers: CommercialCustomer[]): CustomerResolution {
  const folded = foldCommercialText(message);
  const matches = customers.flatMap((customer) => {
    const nameVariants = [customer.tradeName, customer.legalName].filter(Boolean).map(String);
    const candidateTokens = nameVariants.flatMap(significantTokens);
    const matchedTokens = [...new Set(candidateTokens.filter((token) => folded.includes(token)))];
    return matchedTokens.length
      ? [{ customer, score: matchedTokens.reduce((sum, token) => sum + token.length, 0), matchedQuery: matchedTokens.join(' ') }]
      : [];
  });
  if (!matches.length) return { kind: 'NOT_FOUND' };
  matches.sort((left, right) => right.score - left.score);
  const bestScore = matches[0]!.score;
  const best = matches.filter((match) => match.score === bestScore);
  if (best.length === 1) return { kind: 'RESOLVED', customer: best[0]!.customer, matchedQuery: best[0]!.matchedQuery };
  return { kind: 'AMBIGUOUS', candidates: best.slice(0, 5).map((match) => match.customer), matchedQuery: best[0]!.matchedQuery };
}
