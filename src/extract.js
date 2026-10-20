// Extraction du texte des fichiers importés : .txt, .md, .docx, .pdf
const path = require('path');

async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return clean(value);
  }
  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return clean(result.text.replace(/^-- \d+ of \d+ --$/gm, ''));
    } finally {
      await parser.destroy();
    }
  }
  if (['.txt', '.md', '.text', ''].includes(ext)) return clean(buffer.toString('utf8'));
  const err = new Error('Format non pris en charge. Utilisez un fichier .txt, .docx ou .pdf.');
  err.status = 415;
  throw err;
}

function clean(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')   // mots coupés en fin de ligne (PDF)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { extractText };
