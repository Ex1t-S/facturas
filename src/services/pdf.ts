import PDFDocument from 'pdfkit';

export type QuotePdfInput = {
  number: number;
  customerName: string;
  issueDate: Date;
  validUntil?: Date | null;
  currency: string;
  subtotal: string | number;
  taxTotal: string | number;
  total: string | number;
  notes?: string | null;
  items: Array<{
    description: string;
    quantity: string | number;
    unit: string;
    unitPrice: string | number;
    total: string | number;
  }>;
};

export async function renderQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 54, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const formatDate = (date: Date) => date.toLocaleDateString('es-AR');
  const formatAmount = (value: string | number) => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const currencyLabel = input.currency === 'USD' ? 'U$S' : '$';

  doc.font('Helvetica-Bold').fontSize(16).text('F.M.H.', { align: 'left' });
  doc.font('Helvetica').fontSize(10).text('De: Adalberto R. Arroyo');
  doc.text('SILOS-NORIAS- SINFINES - ESTRUCTURAS METALICAS');
  doc.text('Fabricacion y montaje');
  doc.text('contacto: 2923 648947');
  doc.text('Parque Industrial - Huanguelen');
  doc.text('fmharroyo@gmail.com');
  doc.moveDown(1.4);

  doc.font('Helvetica-Bold').fontSize(11).text(`CLIENTE: ${input.customerName}`);
  doc.font('Helvetica').text(`Fecha de emision: ${formatDate(input.issueDate)}`);
  doc.moveDown(1.2);

  doc.font('Helvetica-Bold').fontSize(14).text(`Presupuesto N ${String(input.number).padStart(5, '0')}`, { align: 'center' });
  doc.moveDown(1.4);

  input.items.forEach((item, index) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const lineNet = Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : Number(item.total);
    const descriptionPrefix = input.items.length > 1 ? `${index + 1}. ` : '';

    doc.font('Helvetica').fontSize(11).text(`${descriptionPrefix}${item.description}`, {
      align: 'left',
      lineGap: 3
    });
    if (quantity > 1 || item.unit !== 'trabajo') {
      doc.fontSize(10).text(`Cantidad: ${item.quantity} ${item.unit}`, { align: 'left' });
    }
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(11).text(`Costo: ${'.'.repeat(44)} ${currencyLabel} ${formatAmount(lineNet)} + iva`, {
      align: 'left'
    });
    doc.moveDown(0.9);
  });

  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).text(`Subtotal: ${currencyLabel} ${formatAmount(input.subtotal)}`, { align: 'right' });
  doc.text(`IVA/impuestos: ${currencyLabel} ${formatAmount(input.taxTotal)}`, { align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).text(`Total estimado: ${currencyLabel} ${formatAmount(input.total)}`, { align: 'right' });

  if (input.notes) {
    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(10).text(input.notes, { lineGap: 3 });
  }

  doc.moveDown(1.5);
  doc.font('Helvetica').fontSize(11).text('Hacemos propicia la oportunidad para saludar muy atentamente.-');
  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export type DeliveryNotePdfInput = {
  number?: string;
  customerName: string;
  issueDate: Date;
  notes?: string | null;
  items: Array<{
    description: string;
    quantity: string | number;
    unit: string;
  }>;
};

export async function renderDeliveryNotePdf(input: DeliveryNotePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 54, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const formatDate = (date: Date) => date.toLocaleDateString('es-AR');

  doc.font('Helvetica-Bold').fontSize(16).text('F.M.H.', { align: 'left' });
  doc.font('Helvetica').fontSize(10).text('De: Adalberto R. Arroyo');
  doc.text('SILOS-NORIAS- SINFINES - ESTRUCTURAS METALICAS');
  doc.text('Fabricacion y montaje');
  doc.text('contacto: 2923 648947');
  doc.text('Parque Industrial - Huanguelen');
  doc.text('fmharroyo@gmail.com');
  doc.moveDown(1.4);

  doc.font('Helvetica-Bold').fontSize(14).text(`Remito${input.number ? ` N ${input.number}` : ''}`, { align: 'center' });
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11).text(`CLIENTE: ${input.customerName}`);
  doc.font('Helvetica').text(`Fecha de emision: ${formatDate(input.issueDate)}`);
  doc.moveDown(1.2);

  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Cant.', 54, tableTop, { width: 58 });
  doc.text('Unidad', 116, tableTop, { width: 72 });
  doc.text('Descripcion', 196, tableTop, { width: 340 });
  doc.moveTo(54, tableTop + 18).lineTo(540, tableTop + 18).stroke();
  doc.y = tableTop + 26;

  doc.font('Helvetica').fontSize(10);
  input.items.forEach((item) => {
    const y = doc.y;
    doc.text(String(item.quantity), 54, y, { width: 58 });
    doc.text(item.unit, 116, y, { width: 72 });
    doc.text(item.description, 196, y, { width: 340, lineGap: 2 });
    doc.moveDown(0.8);
  });

  if (input.notes) {
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10).text(input.notes, { lineGap: 3 });
  }

  doc.moveDown(2);
  doc.text('Firma y aclaracion: ________________________________');
  doc.end();

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
