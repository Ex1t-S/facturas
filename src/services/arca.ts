import { config } from '../config.js';

export type ArcaInvoiceDraft = {
  invoiceId: string;
  type: string;
  customerCuit?: string | null;
  subtotal: number;
  taxTotal: number;
  total: number;
};

export type ArcaAuthorizationResult = {
  cae: string;
  caeDueDate: Date;
  pointOfSale: number;
  number: number;
  rawResponse: unknown;
};

export function assertArcaConfigured(): void {
  const missing = [
    ['ARCA_CUIT', config.ARCA_CUIT],
    ['ARCA_CERT_PATH', config.ARCA_CERT_PATH],
    ['ARCA_KEY_PATH', config.ARCA_KEY_PATH],
    ['ARCA_POINT_OF_SALE', config.ARCA_POINT_OF_SALE]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`ARCA is not configured. Missing: ${missing.map(([key]) => key).join(', ')}`);
  }
}

export async function authorizeInvoiceWithArca(_draft: ArcaInvoiceDraft): Promise<ArcaAuthorizationResult> {
  assertArcaConfigured();
  throw new Error('ARCA WSAA/WSFEv1 authorization is intentionally not enabled yet. Run homologation implementation before production use.');
}
