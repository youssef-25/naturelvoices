// Fournisseur de voix : voix neuronales Microsoft Edge (gratuites, sans clé API).
// Ce service n'est pas une API officielle : idéal pour un usage personnel ou un prototype.
// Pour un produit commercial, utilisez Azure AI Speech (même catalogue de voix, API officielle).
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const KBPS = 48;

let voiceCache = null;
let voiceCacheAt = 0;

async function listVoices() {
  if (voiceCache && Date.now() - voiceCacheAt < 24 * 3600 * 1000) return voiceCache;
  const tts = new MsEdgeTTS();
  const raw = await tts.getVoices();
  tts.close();
  voiceCache = raw.map(v => ({
    id: v.ShortName,
    name: v.ShortName.split('-').slice(2).join('-').replace(/Neural$/, '').replace(/Multilingual$/, ' (multilingue)'),
    locale: v.Locale,
    gender: v.Gender === 'Female' ? 'Femme' : v.Gender === 'Male' ? 'Homme' : v.Gender,
  }));
  voiceCacheAt = Date.now();
  return voiceCache;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const parts = [];
    stream.on('data', d => parts.push(d));
    stream.on('end', () => resolve(parts));
    stream.on('error', reject);
  });
}

// Synthétise un morceau de texte. Renvoie l'audio MP3 et les mots avec leur instant de prononciation.
async function synthesize(text, { voice, rate = 1, pitch = 0 }) {
  const tts = new MsEdgeTTS({ synthesisTimeoutMs: 60000 });
  try {
    await tts.setMetadata(voice, FORMAT, { wordBoundaryEnabled: true });
    const ratePct = Math.round((rate - 1) * 100);
    const prosody = {
      rate: (ratePct >= 0 ? '+' : '') + ratePct + '%',
      pitch: (pitch >= 0 ? '+' : '') + Math.round(pitch) + '%',
    };
    const { audioStream, metadataStream } = tts.toStream(escapeXml(text), prosody);
    // Le flux de métadonnées ne se termine jamais (msedge-tts 2.x) : on le lit au fil de l'eau
    // et on s'arrête à la fin de l'audio, moment où tous les mots ont déjà été reçus.
    const metaParts = [];
    if (metadataStream) metadataStream.on('data', d => metaParts.push(d));
    const audioParts = await collect(audioStream);
    const audio = Buffer.concat(audioParts);
    if (!audio.length) throw new Error('Le service vocal n’a renvoyé aucun son.');

    const boundaries = [];
    for (const part of metaParts) {
      let json;
      try { json = JSON.parse(part.toString()); } catch { continue; }
      for (const m of json.Metadata || []) {
        if (m.Type !== 'WordBoundary' || !m.Data) continue;
        boundaries.push({
          t: m.Data.Offset / 10000,          // 100 ns -> ms
          d: (m.Data.Duration || 0) / 10000,
          text: m.Data.text ? m.Data.text.Text : '',
        });
      }
    }
    return {
      audio,
      mime: 'audio/mpeg',
      durationMs: (audio.length * 8) / KBPS, // MP3 à débit constant
      boundaries,
    };
  } finally {
    tts.close();
  }
}

module.exports = { listVoices, synthesize };
