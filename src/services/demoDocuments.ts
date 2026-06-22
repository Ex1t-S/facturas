import PDFDocument from 'pdfkit';
import { Document as DocxDocument, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { prisma } from '../db.js';
import { writeDocumentFile } from './documentStorage.js';

async function pdfBuffer(title: string, rows: Array<[string, string, string]>) {
  const doc = new PDFDocument({ margin: 48 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.fontSize(20).text(title);
  doc.moveDown();
  doc.fontSize(11).text('Metalúrgica Demo SRL');
  doc.text('CUIT 30-70000000-1');
  doc.moveDown();
  rows.forEach(([description, quantity, total]) => {
    doc.fontSize(10).text(`${description} | Cantidad: ${quantity} | Total: ${total}`);
  });
  doc.moveDown();
  doc.fontSize(14).text('Documento demo para visualización inline.');
  doc.end();

  return new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function docxBuffer() {
  const doc = new DocxDocument({
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: 'Orden de trabajo demo', bold: true, size: 34 })] }),
          new Paragraph('Cliente: Cliente Industrial Demo SA'),
          new Paragraph('Trabajo: fabricación, soldadura y pintura de soporte metálico.'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: ['Etapa', 'Responsable', 'Estado'].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
              new TableRow({ children: ['Corte', 'Taller', 'Pendiente'].map((text) => new TableCell({ children: [new Paragraph(text)] })) }),
              new TableRow({ children: ['Plegado', 'Taller', 'Pendiente'].map((text) => new TableCell({ children: [new Paragraph(text)] })) })
            ]
          }),
          new Paragraph('Este archivo prueba la vista previa HTML de documentos Word.')
        ]
      }
    ]
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

async function createDocument(filename: string, mimeType: string, buffer: Buffer, kind: 'QUOTE' | 'INVOICE' | 'UNKNOWN') {
  const existing = await prisma.document.findFirst({ where: { fileName: filename, sourceType: 'demo' } });
  if (existing) return existing;

  const stored = await writeDocumentFile({ buffer, filename, mimeType, sourceType: 'demo' });
  return prisma.document.create({
    data: {
      sourceType: 'demo',
      fileName: filename,
      mimeType,
      storagePath: stored.storagePath,
      sha256: stored.sha256,
      kind,
      extractionStatus: 'UPLOADED',
      extraction: {
        create: {
          rawText: 'Documento demo',
          extractedJson: JSON.stringify({ status: 'demo' }),
          confidence: 0.9
        }
      }
    }
  });
}

export async function createDemoDocuments() {
  return Promise.all([
    createDocument(
      'presupuesto-demo.pdf',
      'application/pdf',
      await pdfBuffer('Presupuesto demo', [
        ['Fabricación de pieza según plano', '2', '$157.300'],
        ['Servicio de plegado', '3 hs', '$65.340']
      ]),
      'QUOTE'
    ),
    createDocument(
      'factura-compra-demo.pdf',
      'application/pdf',
      await pdfBuffer('Factura de compra demo', [
        ['Chapa 1/8 1.22x2.44', '5', '$210.000'],
        ['Electrodos 6013', '10 kg', '$38.000']
      ]),
      'INVOICE'
    ),
    createDocument(
      'orden-trabajo-demo.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      await docxBuffer(),
      'UNKNOWN'
    )
  ]);
}
