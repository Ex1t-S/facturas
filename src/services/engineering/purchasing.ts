export type PurchaseInput = { description: string; needM: number; commercialLengthM?: number; stockM?: number; pricePerM?: number; priceStatus?: 'CURRENT' | 'HISTORICAL' | 'ESTIMATED' | 'NO_PRICE' };

export function calculatePurchase(input: PurchaseInput) {
  const stock = Math.max(0, input.stockM || 0);
  const toBuyM = Math.max(0, input.needM - stock);
  const buyQuantity = input.commercialLengthM ? Math.ceil(toBuyM / input.commercialLengthM) : undefined;
  const purchasedTotal = buyQuantity === undefined ? undefined : buyQuantity * input.commercialLengthM!;
  return { description: input.description, need: input.needM, unit: 'm', commercialLength: input.commercialLengthM, buyQuantity, purchasedTotal, waste: purchasedTotal === undefined ? undefined : purchasedTotal - toBuyM, stockAvailable: stock, toBuy: toBuyM, price: input.pricePerM, priceStatus: input.priceStatus || (input.pricePerM === undefined ? 'NO_PRICE' : 'CURRENT'), subtotal: input.pricePerM === undefined ? undefined : toBuyM * input.pricePerM };
}

