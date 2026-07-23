import type { QuoteWithDetails } from './fmhQuoteDocument.js';
import type { FmhDeliveryNoteDocumentInput } from './fmhDeliveryNoteDocument.js';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripXml(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function tables(xml: string) {
  return [...xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/g)].map((match) => ({ xml: match[0], index: match.index ?? 0 }));
}

function rows(tableXml: string) {
  return [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((match) => ({ xml: match[0], index: match.index ?? 0 }));
}

function cells(rowXml: string) {
  return [...rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((match) => ({ xml: match[0], index: match.index ?? 0 }));
}

function setCellText(cellXml: string, value: string) {
  let replaced = false;
  const safe = escapeXml(value);
  const output = cellXml.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g, (_match, open: string, close: string) => {
    if (replaced) return `${open}${close}`;
    replaced = true;
    return `${open}${safe}${close}`;
  });
  if (replaced) return output;
  return output.replace(/(<w:r\b[^>]*>)/, `$1<w:t xml:space="preserve">${safe}</w:t>`);
}

function setRowCells(rowXml: string, values: string[]) {
  const rowCells = cells(rowXml);
  let output = rowXml;
  for (let index = rowCells.length - 1; index >= 0; index -= 1) {
    const cell = rowCells[index]!;
    const value = values[index] ?? '';
    output = `${output.slice(0, cell.index)}${setCellText(cell.xml, value)}${output.slice(cell.index + cell.xml.length)}`;
  }
  return output;
}

function replaceTable(xml: string, predicate: (tableXml: string) => boolean, transform: (tableXml: string) => string) {
  const match = tables(xml).find((candidate) => predicate(candidate.xml));
  if (!match) throw new Error('La plantilla FMH moderna no contiene la tabla esperada');
  return `${xml.slice(0, match.index)}${transform(match.xml)}${xml.slice(match.index + match.xml.length)}`;
}

function replaceDetailRows(tableXml: string, itemRows: string[][]) {
  const tableRows = rows(tableXml);
  if (tableRows.length < 2) throw new Error('La tabla de detalle FMH moderna no tiene fila de datos');
  const header = tableRows[0]!.xml;
  const template = tableRows[1]!.xml;
  const renderedRows = (itemRows.length ? itemRows : [['', '', '', '', '', '']]).map((values) => setRowCells(template, values)).join('');
  const start = tableRows[0]!.index;
  const end = tableRows.at(-1)!.index + tableRows.at(-1)!.xml.length;
  return `${tableXml.slice(0, start)}${header}${renderedRows}${tableXml.slice(end)}`;
}

function replaceAllRows(tableXml: string, renderedRows: string[]) {
  const tableRows = rows(tableXml);
  if (!tableRows.length) return tableXml;
  const start = tableRows[0]!.index;
  const end = tableRows.at(-1)!.index + tableRows.at(-1)!.xml.length;
  return `${tableXml.slice(0, start)}${renderedRows.join('')}${tableXml.slice(end)}`;
}

function formatDate(date: Date) {
  return date.toLocaleDateString('es-AR');
}

function formatAmount(value: number, currency: string) {
  const label = currency === 'USD' ? 'U$S' : '$';
  return `${label} ${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

function lineNet(item: QuoteWithDetails['items'][number]) {
  return Number(item.quantity) * Number(item.unitPrice) * (1 - Number(item.discount ?? 0) / 100);
}

export function isModernFmhQuoteTemplate(xml: string) {
  return stripXml(xml).includes('DETALLE Y VALORES') && stripXml(xml).includes('P. UNITARIO');
}

export function isModernFmhDeliveryTemplate(xml: string) {
  return stripXml(xml).includes('DETALLE DE TRABAJOS') && stripXml(xml).includes('OBSERVACIONES');
}

export function replaceModernQuoteTemplate(xml: string, quote: QuoteWithDetails) {
  let output = xml;
  output = replaceTable(output, (table) => stripXml(table).includes('PRESUPUESTO') && stripXml(table).includes('N.º'), (table) => {
    const row = rows(table)[0]!;
    return replaceAllRows(table, [setRowCells(row.xml, [`FABRICACIÓN Y MONTAJE INDUSTRIAL`, `PRESUPUESTO\nN.º ${String(quote.number).padStart(5, '0')}`])]);
  });
  output = replaceTable(output, (table) => stripXml(table).includes('CLIENTE') && stripXml(table).includes('DOMICILIO'), (table) => {
    const tableRows = rows(table);
    const values = [
      ['CLIENTE', quote.customer.legalName, 'FECHA', formatDate(quote.issueDate)],
      ['CUIT', String(quote.customer.cuit ?? '—'), 'MONEDA', quote.currency],
      ['DOMICILIO', String(quote.customer.address ?? '—'), 'VALIDEZ', '15 días']
    ];
    return replaceAllRows(table, tableRows.map((row, index) => setRowCells(row.xml, values[index]!)));
  });
  const items = quote.items.map((item, index) => {
    const subtotal = lineNet(item);
    return [
      String(index + 1),
      item.description,
      String(item.quantity),
      item.unit,
      formatAmount(Number(item.unitPrice), quote.currency),
      formatAmount(subtotal, quote.currency)
    ];
  });
  output = replaceTable(output, (table) => stripXml(table).includes('P. UNITARIO'), (table) => replaceDetailRows(table, items));
  const subtotal = quote.items.reduce((sum, item) => sum + lineNet(item), 0);
  const tax = quote.items.reduce((sum, item) => sum + lineNet(item) * Number(item.taxRate ?? 0) / 100, 0);
  output = replaceTable(output, (table) => stripXml(table).includes('SUBTOTAL') && stripXml(table).includes('IVA') && stripXml(table).includes('TOTAL') && !stripXml(table).includes('P. UNITARIO'), (table) => {
    const tableRows = rows(table);
    return replaceAllRows(table, tableRows.map((row, index) => setRowCells(row.xml, [index === 0 ? 'SUBTOTAL' : index === 1 ? `IVA ${quote.items[0]?.taxRate ?? 0}%` : 'TOTAL', formatAmount(index === 0 ? subtotal : index === 1 ? tax : subtotal + tax, quote.currency)])));
  });
  if (quote.notes) {
    output = replaceTable(output, (table) => stripXml(table).includes('OBSERVACIONES'), (table) => {
      const tableRows = rows(table);
      const rendered = tableRows.map((row, index) => index === 1 ? setRowCells(row.xml, [`ALCANCE\n${quote.notes}`, 'OBSERVACIONES\n' + quote.notes]) : row.xml);
      return replaceAllRows(table, rendered);
    });
  }
  return output;
}

export function replaceModernDeliveryTemplate(xml: string, input: FmhDeliveryNoteDocumentInput) {
  let output = xml;
  output = replaceTable(output, (table) => stripXml(table).includes('REMITO') && stripXml(table).includes('N.º'), (table) => {
    const row = rows(table)[0]!;
    return replaceAllRows(table, [setRowCells(row.xml, ['FABRICACIÓN Y MONTAJE INDUSTRIAL', `REMITO\nN.º ${input.number ? String(input.number).padStart(5, '0') : 'BORRADOR'}`])]);
  });
  output = replaceTable(output, (table) => stripXml(table).includes('CLIENTE') && stripXml(table).includes('PROYECTO'), (table) => {
    const tableRows = rows(table);
    const values = [
      ['CLIENTE', input.customerName, 'FECHA', formatDate(input.issueDate)],
      ['CUIT', '—', 'MONEDA', 'ARS'],
      ['DOMICILIO', '—', 'PROYECTO', 'Trabajo FMH']
    ];
    return replaceAllRows(table, tableRows.map((row, index) => setRowCells(row.xml, values[index]!)));
  });
  const items = input.items.map((item, index) => [String(index + 1), item.description, String(item.quantity ?? ''), item.unit ?? '']);
  output = replaceTable(output, (table) => stripXml(table).includes('DESCRIPCIÓN') && stripXml(table).includes('UNIDAD') && !stripXml(table).includes('P. UNITARIO'), (table) => replaceDetailRows(table, items));
  if (input.notes) {
    output = replaceTable(output, (table) => stripXml(table).includes('OBSERVACIONES'), (table) => replaceAllRows(table, [setRowCells(rows(table)[0]!.xml, [input.notes!])]));
  }
  return output;
}
