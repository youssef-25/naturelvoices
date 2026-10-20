// Serveur Naturels Voices : sert l'interface et l'API de synthèse.
// Utilisé tel quel pour la version web, et démarré en interne par la version bureau.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { extractText } = require('./extract');

const MAX_CHUNK = 3000;      // caractères par requête de synthèse
const MAX_UPLOAD_MB = 25;

function loadProvider(name) {
  if (name === 'mock') return require('./providers/mock');
  return require('./providers/edge');
}

// Associe chaque mot renvoyé par le moteur à sa position dans le texte envoyé.
function alignWords(text, boundaries) {
  const words = [];
  let cursor = 0;
  const lower = text.toLowerCase();
  for (const b of boundaries) {
    const w = (b.text || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
    if (!w) continue;
    let idx = text.indexOf(w, cursor);
    if (idx < 0) idx = lower.indexOf(w.toLowerCase(), cursor);
    if (idx < 0 || idx - cursor > 400) continue;
    words.push({ s: idx, e: idx + w.length, t: Math.round(b.t), d: Math.round(b.d) });
    cursor = idx + w.length;
  }
  return words;
}

function createApp({ provider = process.env.TTS_PROVIDER || 'edge' } = {}) {
  const tts = loadProvider(provider);
  const app = express();
  const cache = new Map(); // petit cache LRU des morceaux déjà synthétisés

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => res.json({ ok: true, provider }));

  app.get('/api/voices', async (req, res) => {
    try {
      res.json(await tts.listVoices());
    } catch (e) {
      console.error('[voices]', e.message);
      res.status(502).json({ error: 'Impossible de charger la liste des voix. Vérifiez la connexion Internet puis réessayez.' });
    }
  });

  app.post('/api/tts', async (req, res) => {
    const { text, voice } = req.body || {};
    const rate = Math.min(3, Math.max(0.5, Number(req.body?.rate) || 1));
    const pitch = Math.min(50, Math.max(-50, Number(req.body?.pitch) || 0));
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Le texte est vide.' });
    if (text.length > MAX_CHUNK) return res.status(413).json({ error: `Morceau trop long (max ${MAX_CHUNK} caractères).` });
    if (typeof voice !== 'string' || !/^[\w-]+$/.test(voice)) return res.status(400).json({ error: 'Voix invalide.' });

    const key = crypto.createHash('sha1').update([voice, rate, pitch, text].join('\u0000')).digest('hex');
    try {
      let out = cache.get(key);
      if (!out) {
        const r = await tts.synthesize(text, { voice, rate, pitch });
        out = {
          mime: r.mime,
          durationMs: Math.round(r.durationMs),
          words: alignWords(text, r.boundaries),
          audio: r.audio.toString('base64'),
        };
        cache.set(key, out);
        if (cache.size > 300) cache.delete(cache.keys().next().value);
      } else {
        cache.delete(key); cache.set(key, out);
      }
      res.json(out);
    } catch (e) {
      console.error('[tts]', e.message);
      res.status(502).json({ error: 'La synthèse a échoué. Vérifiez la connexion Internet ou essayez une autre voix.' });
    }
  });

  app.post('/api/extract', express.raw({ type: '*/*', limit: MAX_UPLOAD_MB + 'mb' }), async (req, res) => {
    const name = decodeURIComponent(req.get('x-filename') || '');
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Fichier vide.' });
      const text = await extractText(req.body, name);
      if (!text) return res.status(422).json({ error: 'Aucun texte trouvé dans ce fichier (un PDF scanné ne contient que des images).' });
      res.json({ text });
    } catch (e) {
      console.error('[extract]', e.message);
      res.status(e.status || 422).json({ error: e.status ? e.message : 'Impossible de lire ce fichier.' });
    }
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: `Fichier trop volumineux (max ${MAX_UPLOAD_MB} Mo).` });
    next(err);
  });

  return app;
}

function startServer({ port = 0, host = '127.0.0.1', provider } = {}) {
  const app = createApp({ provider });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, port: server.address().port }));
    server.on('error', reject);
  });
}

module.exports = { createApp, startServer, alignWords };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  startServer({ port, host }).then(({ port }) => {
    console.log(`Naturels Voices prêt : http://localhost:${port}`);
  });
}
