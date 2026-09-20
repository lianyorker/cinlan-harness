/** Deterministic OOXML samples with independently recognizable document, sheet, and slide content. */
import { strToU8, zipSync } from 'fflate'

const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main'

function archive(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)])), {
    level: 0, mtime: new Date(2020, 0, 1),
  })
}

function types(overrides: Record<string, string>): string {
  return `<Types xmlns="${contentTypes}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.entries(overrides).map(([path, type]) => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('')}</Types>`
}

function rels(items: [string, string, string][]): string {
  return `<Relationships xmlns="${relationships}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${officeRelationships}/${type}" Target="${target}"/>`).join('')}</Relationships>`
}

/** @returns A two-page Word document containing paragraphs and a two-column table. */
export function docxFixture(): Uint8Array {
  return archive({
    '[Content_Types].xml': types({ 'word/document.xml': 'wordprocessingml.document.main' }),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>DOCX_TEXT_MARKER</w:t></w:r></w:p>
      <w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid>
        <w:tr><w:tc><w:p><w:r><w:t>DOCX_TABLE_MARKER</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Quantity</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>Sample widgets</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>DOCX_SECOND_PAGE</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
    </w:body></w:document>`,
  })
}

/** @returns A spreadsheet containing a labeled numeric table and a calculated total. */
export function xlsxFixture(): Uint8Array {
  return archive({
    '[Content_Types].xml': types({ 'xl/workbook.xml': 'spreadsheetml.sheet.main', 'xl/worksheets/sheet1.xml': 'spreadsheetml.worksheet' }),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${officeRelationships}"><sheets><sheet name="Preview table" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto"/></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/></cols>
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>XLSX_TABLE_MARKER</t></is></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>North</t></is></c><c r="B2"><v>1200</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>South</t></is></c><c r="B3"><v>345</v></c></row>
        <row r="4"><c r="A4" t="inlineStr"><is><t>Calculated total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>1545</v></c></row>
      </sheetData><pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
    </worksheet>`,
  })
}

function shapeTree(text: string): string {
  return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Preview text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="10058400" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>${text}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody>
    </p:sp></p:spTree>`
}

/** @returns Two presentation slides with distinct text and a landscape page size. */
export function pptxFixture(): Uint8Array {
  const parts: Record<string, string> = {
    '[Content_Types].xml': types({
      'ppt/presentation.xml': 'presentationml.presentation.main',
      'ppt/slides/slide1.xml': 'presentationml.slide', 'ppt/slides/slide2.xml': 'presentationml.slide',
    }),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<p:presentation xmlns:p="${presentation}" xmlns:a="${drawing}" xmlns:r="${officeRelationships}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml']]),
  }
  for (const [index, marker] of ['PPTX_FIRST_SLIDE_MARKER', 'PPTX_SECOND_SLIDE_MARKER'].entries()) {
    parts[`ppt/slides/slide${index + 1}.xml`] = `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}"><p:cSld>${shapeTree(marker)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  }
  return archive(parts)
}
