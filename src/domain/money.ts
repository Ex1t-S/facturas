export type QuoteLineInput = {
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
};

export type QuoteTotals = {
  subtotal: number;
  taxTotal: number;
  total: number;
  lines: Array<QuoteLineInput & { netTotal: number; taxTotal: number; total: number }>;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateQuoteTotals(items: QuoteLineInput[]): QuoteTotals {
  const lines = items.map((item) => {
    const discount = item.discount ?? 0;
    const taxRate = item.taxRate ?? 21;
    const gross = item.quantity * item.unitPrice;
    const netTotal = roundMoney(gross - gross * (discount / 100));
    const taxTotal = roundMoney(netTotal * (taxRate / 100));
    return {
      ...item,
      discount,
      taxRate,
      netTotal,
      taxTotal,
      total: roundMoney(netTotal + taxTotal)
    };
  });

  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.netTotal, 0));
  const taxTotal = roundMoney(lines.reduce((sum, line) => sum + line.taxTotal, 0));

  return {
    subtotal,
    taxTotal,
    total: roundMoney(subtotal + taxTotal),
    lines
  };
}
