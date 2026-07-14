import { optimizeLinearCuts, type LinearPiece } from './cuttingOptimization.js';

export type PurchaseInput = { description: string; needM: number; commercialLengthM?: number; stockM?: number; pricePerM?: number; priceStatus?: 'CURRENT' | 'HISTORICAL' | 'ESTIMATED' | 'NO_PRICE'; pieces?: LinearPiece[] };

export function calculatePurchase(input: PurchaseInput) {
  const stock = Math.max(0, input.stockM || 0);
  const toBuyM = Math.max(0, input.needM - stock);
  const cutPlan = input.commercialLengthM && input.pieces?.length && stock === 0 ? optimizeLinearCuts(input.pieces, input.commercialLengthM) : undefined;
  const buyQuantity = cutPlan ? cutPlan.length : input.commercialLengthM ? Math.ceil(toBuyM / input.commercialLengthM) : undefined;
  const purchasedTotal = buyQuantity === undefined ? undefined : buyQuantity * input.commercialLengthM!;
  return { description: input.description, need: input.needM, unit: 'm', commercialLength: input.commercialLengthM, buyQuantity, purchasedTotal, waste: purchasedTotal === undefined ? undefined : purchasedTotal - toBuyM, stockAvailable: stock, toBuy: toBuyM, price: input.pricePerM, priceStatus: input.priceStatus || (input.pricePerM === undefined ? 'NO_PRICE' : 'CURRENT'), subtotal: input.pricePerM === undefined ? undefined : (purchasedTotal ?? toBuyM) * input.pricePerM, cutPlan };
}
