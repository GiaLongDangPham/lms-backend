import { ZipFile } from 'yazl';

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx';
export interface PackageEntry { name: string; content: string | Buffer }
export const officeTypes = {
  docx: { main: 'word/document.xml', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xml: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Safe lesson</w:t></w:r></w:p></w:body></w:document>' },
  xlsx: { main: 'xl/workbook.xml', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>' },
  pptx: { main: 'ppt/presentation.xml', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xml: '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>' },
};

export async function officePackage(format: OfficeFormat, extra: PackageEntry[] = []): Promise<Buffer> {
  const type = officeTypes[format];
  const entries: PackageEntry[] = [
    { name: '[Content_Types].xml', content: `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${type.main}" ContentType="${type.contentType}"/></Types>` },
    { name: '_rels/.rels', content: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${type.main}"/></Relationships>` },
    { name: type.main, content: type.xml },
  ];
  const zip = new ZipFile();
  for (const entry of [...entries, ...extra]) zip.addBuffer(Buffer.from(entry.content), entry.name, { compress: false });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
  zip.end(); return result;
}
