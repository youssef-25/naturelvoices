# Naturels Voices

Application de lecture à voix haute, inspirée de NaturalReader. Un seul code source sert à la fois pour le **site web** et pour l'**application de bureau** (Windows, macOS, Linux).

## Fonctionnalités

- Des centaines de voix neuronales dans des dizaines de langues (français, arabe, anglais…)
- **Plusieurs voix dans un même texte** : écrivez « Nom : réplique » en début de ligne et chaque personnage reçoit sa propre voix (dialogues, podcasts, histoires). Le MP3 exporté garde toutes les voix.
- Surlignage du mot prononcé, clic sur un mot pour reprendre la lecture à cet endroit
- Vitesse, tonalité et volume réglables
- Import de fichiers `.txt`, `.docx` et `.pdf` (bouton ou glisser-déposer)
- Export de la lecture complète en **MP3**
- Lecture qui démarre en une ou deux secondes, même sur de longs textes (le texte est découpé en passages et préparé à l'avance)
- Texte et réglages mémorisés entre deux sessions
- Thème clair et sombre automatique

## Prérequis

- [Node.js](https://nodejs.org) 18 ou plus récent
- Une connexion Internet (les voix sont générées par le service vocal de Microsoft)

## Démarrer

```bash
npm install
```

### Version web

```bash
npm start
```

Ouvrez ensuite http://localhost:3000. Variables utiles : `PORT` (par défaut 3000) et `HOST` (par défaut `0.0.0.0`).

Pour mettre le site en ligne, déployez le dossier sur un hébergeur Node.js (Render, Railway, Fly.io, un VPS…) avec la commande de démarrage `npm start`.

### Version bureau

```bash
npm run desktop
```

Pour créer un installateur :

```bash
npm run build:win     # Windows (.exe)
npm run build:mac     # macOS (.dmg), à lancer sur un Mac
npm run build:linux   # Linux (.AppImage)
```

Les fichiers produits se trouvent dans le dossier `dist/`.

### Mode test sans réseau

```bash
npm run dev:mock
```

Le moteur simulé renvoie du silence et des temps de mots inventés. Il sert à travailler sur l'interface sans connexion.

## Organisation du projet

```
public/            interface (HTML, CSS, JavaScript)
src/server.js      serveur : liste des voix, synthèse, import de fichiers
src/providers/     moteurs vocaux (edge = voix Microsoft, mock = test)
src/extract.js     extraction du texte des .docx et .pdf
electron/main.js   fenêtre de l'application de bureau
```

### API

| Route | Rôle |
|---|---|
| `GET /api/voices` | Liste des voix : `id`, `name`, `locale`, `gender` |
| `POST /api/tts` | `{ text, voice, rate, pitch }` → `{ audio (base64), mime, durationMs, words }` (3000 caractères max par appel) |
| `POST /api/extract` | Corps = le fichier, en-tête `x-filename` → `{ text }` |

## À savoir avant une mise en production

Le moteur par défaut utilise le service vocal de Microsoft Edge. Il est gratuit et ne demande pas de clé, mais ce n'est pas une API officielle : Microsoft peut le modifier ou le limiter à tout moment. Il convient bien pour un usage personnel ou un prototype.

Pour un produit commercial, remplacez-le par une API officielle en ajoutant un fichier dans `src/providers/` qui expose les deux mêmes fonctions (`listVoices` et `synthesize`) :

- **Azure AI Speech** : les mêmes voix, avec contrat et garanties
- **ElevenLabs** : les voix les plus expressives, clonage de voix
- **OpenAI TTS** ou **Google Cloud Text-to-Speech**

Gardez la clé API côté serveur, jamais dans `public/`.
