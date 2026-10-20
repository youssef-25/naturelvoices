// Fournisseur simulé, sans réseau : produit du silence (WAV) et des temps de mots inventés.
// Sert uniquement aux tests de l'interface (TTS_PROVIDER=mock).
const VOICES = [
  { id: 'fr-FR-DeniseNeural', name: 'Denise', locale: 'fr-FR', gender: 'Femme' },
  { id: 'fr-FR-HenriNeural', name: 'Henri', locale: 'fr-FR', gender: 'Homme' },
  { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne (multilingue)', locale: 'fr-FR', gender: 'Femme' },
  { id: 'fr-FR-RemyMultilingualNeural', name: 'Remy (multilingue)', locale: 'fr-FR', gender: 'Homme' },
  { id: 'fr-CA-SylvieNeural', name: 'Sylvie', locale: 'fr-CA', gender: 'Femme' },
  { id: 'en-US-AriaNeural', name: 'Aria', locale: 'en-US', gender: 'Femme' },
  { id: 'ar-TN-ReemNeural', name: 'Reem', locale: 'ar-TN', gender: 'Femme' },
];

async function listVoices() { return VOICES; }

function silentWav(ms) {
  const rate = 8000, n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n, 0x80);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}

async function synthesize(text, { rate = 1 }) {
  await new Promise(r => setTimeout(r, 150));
  const words = text.match(/[\p{L}\p{N}'’]+/gu) || [];
  const step = 320 / rate;
  const boundaries = words.map((w, i) => ({ t: 100 + i * step, d: step * 0.8, text: w }));
  const durationMs = 200 + words.length * step;
  return { audio: silentWav(durationMs), mime: 'audio/wav', durationMs, boundaries };
}

module.exports = { listVoices, synthesize };
