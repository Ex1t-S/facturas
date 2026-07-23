const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;

export const FMH_BODY_ROW_HEIGHT_TWIPS = 6000;
export const FMH_DETAIL_AREA_HEIGHT_TWIPS = 2500;

export function applyFmhA4PageSize(xml: string) {
  return xml.replace(/<w:pgSz\b[^>]*\/>/, `<w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}"/>`);
}

/** Enforces the same portrait A4 canvas and a useful full-page body area. */
export function applyFmhA4Layout(xml: string, bodyRowHeight = FMH_BODY_ROW_HEIGHT_TWIPS) {
  let output = applyFmhA4PageSize(xml);
  const rowHeights = [...output.matchAll(/<w:trHeight\b[^>]*\/>/g)];
  const last = rowHeights.at(-1);
  if (last?.index !== undefined) {
    const replacement = `<w:trHeight w:val="${bodyRowHeight}" w:hRule="atLeast"/>`;
    output = `${output.slice(0, last.index)}${replacement}${output.slice(last.index + last[0].length)}`;
  }
  return output;
}

/**
 * A borderless nested table gives the commercial detail a flexible top area
 * and keeps the greeting in a separate bottom row. If content grows, Word can
 * expand the first row naturally instead of overlapping or clipping it.
 */
export function buildBottomAnchoredFmhBody(input: {
  detailsXml: string;
  closingXml: string;
  widthTwips?: number;
  detailAreaHeightTwips?: number;
}) {
  const width = input.widthTwips ?? 9000;
  const detailHeight = input.detailAreaHeightTwips ?? FMH_DETAIL_AREA_HEIGHT_TWIPS;
  return [
    '<w:tbl>',
    `<w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>`,
    `<w:tblGrid><w:gridCol w:w="${width}"/></w:tblGrid>`,
    `<w:tr><w:trPr><w:trHeight w:val="${detailHeight}" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${input.detailsXml || '<w:p/>'}</w:tc></w:tr>`,
    `<w:tr><w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${input.closingXml}</w:tc></w:tr>`,
    '</w:tbl><w:p/>'
  ].join('');
}
