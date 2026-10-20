(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SAMPLE = "Bienvenue dans Naturels Voices.\n\nCollez ici n'importe quel texte : un article, un cours, un chapitre de livre ou vos propres notes. Vous pouvez aussi importer un document Word ou PDF. Cliquez sur l'avatar à gauche pour choisir la voix de ce texte, puis appuyez sur Lire.\n\nAjoutez d'autres textes avec le bouton « Nouveau texte » en bas : chacun peut avoir sa propre voix. Pendant la lecture, chaque mot est surligné au moment où il est prononcé, et vous pouvez télécharger tout le projet en MP3.";
  const DIALOGUE = [
    ['narr', "Il est huit heures du matin. Dans une petite boulangerie de Tunis, Sami ouvre la porte."],
    ['m', "Bonjour Leïla ! Il vous reste des croissants ?"],
    ['f', "Bonjour Sami. Il m'en reste trois, ils sortent du four."],
    ['m', "Parfait, je les prends tous. Et une baguette, s'il vous plaît."],
    ['f', "Ça fait quatre dinars. Bonne journée !"],
    ['narr', "Sami repart, le sac chaud à la main, en souriant."],
  ];
  const FIRST_CHUNK = 260;   // premier morceau court : la lecture démarre vite
  const CHUNK = 1400;        // morceaux suivants
  const HARD_MAX = 2800;     // limite du serveur : 3000
  const SEP = '\n\n';        // séparation entre deux textes dans le texte complet du projet

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>',
    del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7zm4 2v8h1.5v-8zm2.5 0v8H14v-8z"/></svg>',
    mp3: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6zM4 19h16v2H4z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h7l2 2h9v12H3z"/></svg>',
    caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>',
  };

  const audio = $('audio'), blocksEl = $('blocks');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lv.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lv.' + k, JSON.stringify(v)); } catch {} },
  };
  const uid = () => Math.random().toString(36).slice(2, 10);

  let voices = [];
  let projects = [];
  let project = null;
  let full = '';         // texte complet du projet
  let offsets = [];      // position de chaque texte dans `full`
  let words = [];        // mots de `full` : {start, end}
  let spans = [];        // éléments affichés pour chaque mot
  let chunks = [];       // morceaux envoyés au moteur : {start, end, voice, bi}
  let cache = new Map(); // clé réglages + morceau -> Promise<{url, blob, words, mime}>
  let state = 'idle';    // idle | loading | playing | paused
  let session = 0;
  let playing = null;    // {ci, data}
  let current = -1;
  let rafId = 0;

  /* ---------------- utilitaires ---------------- */
  function showError(msg) { const b = $('banner'); b.textContent = msg; b.hidden = !msg; }
  function status(msg, busy) { const s = $('status'); s.textContent = msg || ''; s.classList.toggle('busy', !!busy); }

  async function api(path, opts) {
    let res;
    try { res = await fetch(path, opts); }
    catch { throw new Error('Le serveur Naturels Voices ne répond pas. Lancez-le (npm start dans le dossier du projet) puis réessayez.'); }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
    return data;
  }

  /* ---------------- voix ---------------- */
  let langNames = null, regionNames = null;
  try { langNames = new Intl.DisplayNames(['fr'], { type: 'language' }); regionNames = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch {}
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const baseLang = loc => loc.split('-')[0].toLowerCase();
  const langLabel = code => { try { return cap(langNames ? langNames.of(code) : code); } catch { return code; } };
  const regionLabel = loc => { const r = loc.split('-')[1]; try { return r && regionNames ? regionNames.of(r) : r || ''; } catch { return r || ''; } };
  const isMulti = v => /\(multilingue\)/.test(v.name);
  const cleanName = n => n.replace(/\s*\(multilingue\)/, '');
  const voiceMeta = v => `${v.gender} · ${regionLabel(v.locale)}`;
  const voiceById = id => voices.find(v => v.id === id);

  function defaultVoice() {
    const saved = store.get('voice', null);
    const v = voiceById(saved) || voiceById('fr-FR-DeniseNeural') || voices.find(x => baseLang(x.locale) === 'fr') || voices[0];
    return v ? v.id : saved;
  }
  const voiceOf = b => (voices.length && !voiceById(b.voice)) ? defaultVoice() : b.voice;

  async function loadVoices() {
    try {
      voices = await api('/api/voices');
    } catch (e) {
      status('');
      showError(e.message);
      $('btnRetry')?.remove();
      const btn = document.createElement('button');
      btn.className = 'link'; btn.id = 'btnRetry'; btn.textContent = 'Réessayer';
      btn.onclick = () => { btn.remove(); showError(''); status('Chargement des voix…', true); loadVoices(); };
      $('status').after(btn);
      return;
    }
    // Les textes sans voix valide reçoivent la voix par défaut.
    let changed = false;
    projects.forEach(p => p.blocks.forEach(b => { if (!voiceById(b.voice)) { b.voice = defaultVoice(); changed = true; } }));
    if (changed) persist();
    renderBlocks();
    updateNow(0);
    $('btnPlay').disabled = false;
    status(`${voices.length} voix disponibles`);
  }

  /* ---------------- avatars ---------------- */
  // Portrait illustré, toujours le même pour une voix donnée (tiré de son identifiant).
  const AV = {
    bg: ['#dbe4ff', '#ffe3e3', '#d3f9d8', '#fff3bf', '#e5dbff', '#c5f6fa', '#ffe8cc', '#fcc2d7'],
    skin: ['#f9dcc4', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'],
    hair: ['#2c1b12', '#4b2e1e', '#71452a', '#b5651d', '#d6a756', '#1f1f1f', '#8c8c8c', '#a33b20'],
    shirt: ['#4263eb', '#e8590c', '#2f9e44', '#ae3ec9', '#1098ad', '#e03131', '#495057', '#f08c00'],
  };
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function avatarSVG(v) {
    const h = hash(v.id);
    const pick = (a, k) => a[(h >>> k) % a.length];
    const bg = pick(AV.bg, 0), skin = pick(AV.skin, 3), hair = pick(AV.hair, 7), shirt = pick(AV.shirt, 11);
    const style = (h >>> 15) % 3, extra = (h >>> 18) % 4;
    let back = '', front = '';
    if (v.gender === 'Femme') {
      back = [
        '<path d="M17 33c0-13 6.5-20 15-20s15 7 15 20v19H17z"/>',
        '<path d="M18 34c0-12 6-19 14-19s14 7 14 19v8c0 2-2 3-4 3H22c-2 0-4-1-4-3z"/>',
        '<circle cx="32" cy="13" r="6"/>',
      ][style];
      front = '<path d="M20.5 31c0-10 5-15.5 11.5-15.5S43.5 21 43.5 31c-2.5-4.5-6-7.5-10.5-8.5-3 3.5-7 6.5-12.5 8.5z"/>';
    } else {
      front = [
        '<path d="M20.6 29c-.8-9 4.6-14 11.4-14s12.2 5 11.4 14c-1.4-4-4-6.5-11.4-6.5S22 25 20.6 29z"/>',
        '<path d="M20.6 30c-1-10 4-16 12-16 6 0 11 3 11 9v7c-1.6-4.5-5-7-11-7-7 0-10.4 3-12 7z"/>',
        '<path d="M21 26c1.5-6 5.5-9 11-9s9.5 3 11 9c-3-2.5-6.5-3.5-11-3.5s-8 1-11 3.5z"/>',
      ][style];
      if (extra === 0) front += '<path d="M21.5 33c.5 7 4.8 11.5 10.5 11.5S42 40 42.5 33c-1.5 2.5-3.5 4-5 4.3-1.5-1.3-3.5-1.8-5.5-1.8s-4 .5-5.5 1.8c-1.5-.3-3.5-1.8-5-4.3z"/>';
    }
    const glasses = extra === 1
      ? '<g fill="none" stroke="#2a2320" stroke-width="1.2"><circle cx="27.5" cy="31.5" r="3.3"/><circle cx="36.5" cy="31.5" r="3.3"/><path d="M30.8 31.3h2.4"/></g>' : '';
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="${bg}"/>`
      + `<g fill="${hair}">${back}</g>`
      + `<path d="M8 66c0-11 10.7-18 24-18s24 7 24 18z" fill="${shirt}"/>`
      + `<path d="M27 40h10v7c0 2.8-2.2 4-5 4s-5-1.2-5-4z" fill="${skin}"/><path d="M27 42h10v2.5c-3 1.6-7 1.6-10 0z" fill="#000" opacity=".1"/>`
      + `<circle cx="21" cy="32" r="2.4" fill="${skin}"/><circle cx="43" cy="32" r="2.4" fill="${skin}"/>`
      + `<ellipse cx="32" cy="31" rx="11" ry="12.5" fill="${skin}"/>`
      + `<circle cx="27.5" cy="31.5" r="1.4" fill="#2a2320"/><circle cx="36.5" cy="31.5" r="1.4" fill="#2a2320"/>`
      + `<circle cx="25.5" cy="35.5" r="2" fill="#ff7a7a" opacity=".22"/><circle cx="38.5" cy="35.5" r="2" fill="#ff7a7a" opacity=".22"/>`
      + `<path d="M28.8 36.8q3.2 2.6 6.4 0" fill="none" stroke="#7a3b2e" stroke-width="1.4" stroke-linecap="round"/>`
      + `<g fill="${hair}">${front}</g>${glasses}</svg>`;
  }

  /* ---------------- projets ---------------- */
  const makeProject = (name, blocks) => ({ id: uid(), name, updated: Date.now(), blocks });
  const makeBlock = (text = '', voice = null) => ({ id: uid(), text, voice });

  let saveTimer = 0;
  function persist() { clearTimeout(saveTimer); store.set('projects', projects); }
  function save() {
    project.updated = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set('projects', projects), 300);
    renderProjects();
  }

  function dateLabel(t) {
    const d = new Date(t), now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  function renderProjects() {
    $('projList').replaceChildren(...projects.map(p => {
      const row = document.createElement('div');
      row.className = 'proj' + (p === project ? ' on' : '');
      row.innerHTML = `<button type="button" class="proj-open"><span class="proj-ico">${ICON.folder}</span><span class="pt"><b></b><small></small></span></button>`
        + `<button type="button" class="icon-btn proj-del" title="Supprimer le projet" aria-label="Supprimer le projet">${ICON.del}</button>`;
      const n = p.blocks.length;
      row.querySelector('b').textContent = p.name || 'Projet sans titre';
      row.querySelector('small').textContent = `${n} texte${n > 1 ? 's' : ''} · ${dateLabel(p.updated)}`;
      row.querySelector('.proj-open').onclick = () => openProject(p.id);
      row.querySelector('.proj-del').onclick = () => deleteProject(p.id);
      if (p === project) row.querySelector('.proj-open').setAttribute('aria-current', 'true');
      return row;
    }));
  }

  function openProject(id) {
    stop();
    project = projects.find(p => p.id === id) || projects[0];
    store.set('project', project.id);
    $('projName').value = project.name;
    clearCache();
    rebuild();
    renderBlocks();
    renderProjects();
    updateStats();
    updateNow(0);
  }

  function newProject() {
    const last = project && project.blocks[project.blocks.length - 1];
    const p = makeProject(`Projet ${projects.length + 1}`, [makeBlock('', last ? voiceOf(last) : defaultVoice())]);
    projects.unshift(p);
    persist();
    openProject(p.id);
    $('projName').focus(); $('projName').select();
  }

  function deleteProject(id) {
    const p = projects.find(x => x.id === id);
    if (!p || !confirm(`Supprimer le projet « ${p.name || 'Projet sans titre'} » et tous ses textes ?`)) return;
    projects = projects.filter(x => x !== p);
    if (!projects.length) projects.push(makeProject('Mon projet', [makeBlock('', defaultVoice())]));
    persist();
    if (p === project) openProject(projects[0].id); else renderProjects();
  }

  function demoProject() {
    const fr = voices.filter(v => v.locale === 'fr-FR');
    const narr = defaultVoice();
    const m = (fr.find(v => v.gender === 'Homme' && !isMulti(v)) || fr.find(v => v.gender === 'Homme') || {}).id || narr;
    const f = (fr.find(v => v.gender === 'Femme' && v.id !== narr && !isMulti(v)) || fr.find(v => v.id !== narr) || {}).id || narr;
    const p = makeProject('Exemple : la boulangerie', DIALOGUE.map(([who, t]) => makeBlock(t, who === 'm' ? m : who === 'f' ? f : narr)));
    projects.unshift(p);
    persist();
    openProject(p.id);
  }

  /* ---------------- textes du projet ---------------- */
  function rebuild() {
    offsets = []; let t = '';
    project.blocks.forEach((b, i) => { if (i) t += SEP; offsets.push(t.length); t += b.text; });
    full = t;
  }

  function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

  function setBlockVoiceUI(el, b) {
    const v = voiceById(voiceOf(b));
    el.querySelector('.blk-voice .av').innerHTML = v ? avatarSVG(v) : '';
    el.querySelector('.blk-voice b').textContent = v ? cleanName(v.name) : '…';
    el.querySelector('.blk-voice small').textContent = v ? regionLabel(v.locale) : '';
    el.querySelector('.blk-voice').title = v ? `Voix : ${cleanName(v.name)} · ${voiceMeta(v)} — cliquer pour changer` : 'Choisir une voix';
  }

  function renderBlocks() {
    const n = project.blocks.length;
    blocksEl.replaceChildren(...project.blocks.map((b, i) => {
      const el = document.createElement('div');
      el.className = 'block'; el.dataset.i = i;
      el.innerHTML = `<button type="button" class="blk-voice"><span class="av av-xl"></span><b></b><small></small><span class="blk-change">Changer ${ICON.caret}</span></button>`
        + '<div class="blk-body"><textarea class="blk-text" rows="2" spellcheck="false" placeholder="Tapez ou collez votre texte ici…"></textarea><div class="reading" hidden></div></div>'
        + '<div class="blk-tools">'
        + `<button type="button" class="icon-btn" data-act="play" title="Lire à partir d’ici" aria-label="Lire à partir d’ici">${ICON.play}</button>`
        + `<button type="button" class="icon-btn edit-only" data-act="up" title="Monter" aria-label="Monter"${i ? '' : ' disabled'}>${ICON.up}</button>`
        + `<button type="button" class="icon-btn edit-only" data-act="down" title="Descendre" aria-label="Descendre"${i < n - 1 ? '' : ' disabled'}>${ICON.down}</button>`
        + `<button type="button" class="icon-btn" data-act="mp3" title="Télécharger ce texte en MP3" aria-label="Télécharger ce texte en MP3">${ICON.mp3}</button>`
        + `<button type="button" class="icon-btn edit-only" data-act="del" title="Supprimer ce texte" aria-label="Supprimer ce texte">${ICON.del}</button>`
        + '</div>';
      const ta = el.querySelector('textarea');
      ta.value = b.text;
      ta.setAttribute('aria-label', `Texte ${i + 1}`);
      setBlockVoiceUI(el, b);
      return el;
    }));
    blocksEl.querySelectorAll('textarea').forEach(autosize);
    if (state !== 'idle') { renderReading(); setState(state); }
  }

  function textChanged() {
    rebuild(); updateStats(); clearCache(); save();
    if (state === 'idle') updateNow(Math.min(Math.max(0, nowBlock), project.blocks.length - 1));
  }

  function addBlock(text = '') {
    const last = project.blocks[project.blocks.length - 1];
    project.blocks.push(makeBlock(text, last ? voiceOf(last) : defaultVoice()));
    renderBlocks(); textChanged();
    const tas = blocksEl.querySelectorAll('textarea');
    const ta = tas[tas.length - 1];
    ta.focus(); ta.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  blocksEl.addEventListener('input', e => {
    if (!e.target.matches('textarea')) return;
    const i = +e.target.closest('.block').dataset.i;
    project.blocks[i].text = e.target.value;
    autosize(e.target);
    textChanged();
  });

  blocksEl.addEventListener('click', e => {
    const blockEl = e.target.closest('.block'); if (!blockEl) return;
    const i = +blockEl.dataset.i, b = project.blocks[i];
    const w = e.target.closest('.w');
    if (w) { current = -1; playFrom(words[+w.dataset.i].start); return; }
    if (e.target.closest('.blk-voice')) {
      return openPicker({
        current: voiceOf(b), title: `Voix du texte ${i + 1}`,
        onPick: id => {
          b.voice = id; store.set('voice', id);
          setBlockVoiceUI(blockEl, b); save();
          if (state === 'idle') updateNow(i);
          settingsChanged();
        },
      });
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') {
      if (!b.text.trim()) { blockEl.querySelector('textarea').focus(); return; }
      if (state === 'idle') start(offsets[i]); else { current = -1; playFrom(offsets[i]); }
    } else if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      [project.blocks[i], project.blocks[j]] = [project.blocks[j], project.blocks[i]];
      renderBlocks(); textChanged();
      blocksEl.children[j].querySelector(`[data-act="${act}"]:not(:disabled)`)?.focus();
    } else if (act === 'mp3') {
      exportMp3(i, e.target.closest('[data-act]'));
    } else if (act === 'del') {
      if (b.text.trim() && !confirm('Supprimer ce texte ?')) return;
      if (project.blocks.length === 1) project.blocks[0].text = '';
      else project.blocks.splice(i, 1);
      renderBlocks(); textChanged();
    }
  });

  $('btnAddBlock').onclick = () => addBlock();
  $('projName').addEventListener('input', () => { project.name = $('projName').value; save(); });

  function updateStats() {
    const n = (full.match(/\S+/g) || []).length, nb = project.blocks.length;
    const min = n / (150 * parseFloat($('rate').value));
    $('sBlocks').textContent = nb + (nb > 1 ? ' textes' : ' texte');
    $('sWords').textContent = n.toLocaleString('fr-FR') + (n > 1 ? ' mots' : ' mot');
    $('sTime').textContent = '≈ ' + (min < 1 ? Math.max(n ? 1 : 0, Math.round(min * 60)) + ' s' : Math.round(min) + ' min');
  }

  // Bas du lecteur : la voix du texte en cours.
  let nowBlock = -1;
  function updateNow(bi) {
    nowBlock = bi;
    const b = project.blocks[bi]; if (!b) return;
    const v = voiceById(voiceOf(b));
    $('nowAv').innerHTML = v ? avatarSVG(v) : '';
    $('nowName').textContent = v ? cleanName(v.name) : '…';
    $('nowLbl').textContent = project.blocks.length > 1 ? `Texte ${bi + 1}/${project.blocks.length}` : 'Voix';
    blocksEl.querySelectorAll('.block').forEach((el, k) => el.classList.toggle('active', state !== 'idle' && k === bi));
  }

  /* ---------------- découpage et affichage de lecture ---------------- */
  function prepare() {
    words = [];
    let m; const re = /\S+/g;
    while ((m = re.exec(full))) words.push({ start: m.index, end: m.index + m[0].length });

    // Chaque texte est découpé en phrases puis en morceaux ; un morceau ne mélange jamais deux textes.
    // Une phrase trop longue est coupée sur un espace.
    chunks = [];
    project.blocks.forEach((b, bi) => {
      const off = offsets[bi], voice = voiceOf(b);
      const sre = /[^.!?…\n]+(?:[.!?…»"”)]+|\n+|$)\s*/g;
      let first = true;
      while ((m = sre.exec(b.text))) {
        if (!m[0]) { sre.lastIndex++; continue; }
        if (!m[0].trim()) continue;
        let s = off + m.index; const e = s + m[0].length;
        const pieces = [];
        while (e - s > HARD_MAX) {
          let cut = full.lastIndexOf(' ', s + HARD_MAX);
          if (cut <= s) cut = s + HARD_MAX;
          pieces.push({ start: s, end: cut }); s = cut;
        }
        pieces.push({ start: s, end: e });
        for (const sn of pieces) {
          const last = chunks[chunks.length - 1];
          const limit = chunks.length === 1 ? FIRST_CHUNK : CHUNK;
          if (last && !first && sn.end - last.start <= limit) last.end = sn.end;
          else chunks.push({ ...sn, voice, bi });
          first = false;
        }
      }
    });
  }

  function renderReading() {
    const els = blocksEl.querySelectorAll('.block');
    let wi = 0;
    project.blocks.forEach((b, i) => {
      const end = offsets[i] + b.text.length, frag = document.createDocumentFragment();
      let pos = offsets[i];
      while (wi < words.length && words[wi].start < end) {
        const w = words[wi];
        if (w.start > pos) frag.append(full.slice(pos, w.start));
        const sp = document.createElement('span');
        sp.className = 'w'; sp.dataset.i = wi; sp.textContent = full.slice(w.start, w.end);
        frag.append(sp); pos = w.end; wi++;
      }
      if (pos < end) frag.append(full.slice(pos, end));
      els[i].querySelector('.reading').replaceChildren(frag);
    });
    spans = [...blocksEl.querySelectorAll('.w')];
    current = -1;
  }

  function wordAt(charIdx) {
    let lo = 0, hi = words.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (words[mid].start <= charIdx) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  const chunkAt = charIdx => Math.max(0, chunks.findIndex(c => c.end > charIdx));

  function mark(i) {
    if (i === current || !spans.length) return;
    if (i < current || current < 0) spans.forEach((s, k) => { s.classList.toggle('done', k < i); s.classList.remove('now'); });
    else for (let k = current; k < i; k++) { spans[k].classList.remove('now'); spans[k].classList.add('done'); }
    current = i;
    const el = spans[i]; if (!el) return;
    el.classList.add('now');
    const r = el.getBoundingClientRect();
    const top = document.querySelector('.top').offsetHeight + 20, bottom = innerHeight - document.querySelector('.player').offsetHeight - 30;
    if (r.top < top || r.bottom > bottom) window.scrollBy({ top: r.top - innerHeight / 3 });
    $('bar').style.width = (100 * words[i].end / Math.max(1, full.length)) + '%';
  }

  /* ---------------- sélecteur de voix ---------------- */
  let picker = null;     // {current, onPick}
  let pickGender = '';
  const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  function openPicker(opts) {
    if (!voices.length) return;
    picker = opts;
    $('pickTitle').textContent = opts.title || 'Choisir une voix';
    const counts = {};
    voices.forEach(v => { const b = baseLang(v.locale); counts[b] = (counts[b] || 0) + 1; });
    const codes = Object.keys(counts).sort((a, b) => langLabel(a).localeCompare(langLabel(b), 'fr'));
    const cur = voiceById(opts.current);
    const lang = cur ? baseLang(cur.locale) : counts.fr ? 'fr' : codes[0];
    $('pickLang').replaceChildren(...codes.map(c => new Option(`${langLabel(c)} (${counts[c]})`, c, false, c === lang)));
    $('pickSearch').value = '';
    renderPicker();
    $('picker').hidden = false;
    const on = $('pickList').querySelector('.vcard.on');
    (on || $('pickSearch')).focus();
    on?.scrollIntoView({ block: 'nearest' });
  }
  let pickerReturn = null;
  function closePicker() {
    if ($('picker').hidden) return;
    $('picker').hidden = true;
    picker = null;
    previewAudio.pause();
    pickerReturn?.focus();
  }

  function renderPicker() {
    const code = $('pickLang').value, q = norm($('pickSearch').value.trim());
    const list = voices
      .filter(v => baseLang(v.locale) === code && (!pickGender || v.gender === pickGender)
        && (!q || norm(`${v.name} ${regionLabel(v.locale)} ${v.locale}`).includes(q)))
      .sort((a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name));
    if (!list.length) {
      const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Aucune voix ne correspond.';
      return $('pickList').replaceChildren(p);
    }
    $('pickList').replaceChildren(...list.map(v => {
      const card = document.createElement('div');
      card.className = 'vcard' + (picker && v.id === picker.current ? ' on' : '');
      card.tabIndex = 0; card.setAttribute('role', 'button');
      card.innerHTML = '<span class="av av-xl"></span><span class="vt"><b></b><small></small></span>'
        + `<button type="button" class="icon-btn prev" title="Écouter" aria-label="Écouter">${ICON.play}</button>`
        + '<span class="check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z"/></svg></span>';
      card.querySelector('.av').innerHTML = avatarSVG(v);
      card.querySelector('b').textContent = cleanName(v.name);
      card.querySelector('small').textContent = voiceMeta(v);
      if (isMulti(v)) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'Multilingue'; card.querySelector('.vt').append(t); }
      card.setAttribute('aria-label', `${cleanName(v.name)}, ${voiceMeta(v)}`);
      const choose = () => { const p = picker; closePicker(); if (p) p.onPick(v.id); };
      card.onclick = e => { if (!e.target.closest('.prev')) choose(); };
      card.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); choose(); } };
      card.querySelector('.prev').onclick = e => previewVoice(v.id, e.currentTarget);
      return card;
    }));
  }

  // Les extraits passent par un lecteur à part pour ne pas perturber la lecture en cours.
  const previewAudio = new Audio();
  async function previewVoice(id, btn) {
    const v = voiceById(id);
    if (!v || btn.classList.contains('busy')) return;
    if (state === 'playing') toggle();
    const fr = baseLang(v.locale) === 'fr';
    btn.classList.add('busy'); btn.disabled = true;
    try {
      const r = await api('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fr ? `Bonjour, je m'appelle ${cleanName(v.name)}. Voici un aperçu de ma voix.` : `Hello, my name is ${cleanName(v.name)}. This is a preview of my voice.`,
          voice: id, rate: +$('rate').value, pitch: +$('pitch').value }) });
      if (previewAudio.src) URL.revokeObjectURL(previewAudio.src);
      previewAudio.src = URL.createObjectURL(b64ToBlob(r.audio, r.mime));
      previewAudio.volume = +$('volume').value;
      await previewAudio.play();
    } catch (e) { showError(e.message); }
    finally { btn.classList.remove('busy'); btn.disabled = false; }
  }

  $('pickClose').onclick = closePicker;
  $('picker').addEventListener('mousedown', e => { if (e.target === $('picker')) closePicker(); });
  $('pickLang').onchange = renderPicker;
  $('pickSearch').oninput = renderPicker;
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    pickGender = b.dataset.g;
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    renderPicker();
  });
  document.addEventListener('focusin', e => { if ($('picker').hidden) pickerReturn = e.target; });

  /* ---------------- synthèse ---------------- */
  function b64ToBlob(b64, mime) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function getChunk(ci) {
    const c = chunks[ci];
    const key = [c.voice, $('rate').value, $('pitch').value, c.start, c.end].join('|');
    if (cache.has(key)) return cache.get(key);
    const p = api('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: full.slice(c.start, c.end), voice: c.voice, rate: +$('rate').value, pitch: +$('pitch').value }),
    }).then(r => {
      const blob = b64ToBlob(r.audio, r.mime);
      return { blob, url: URL.createObjectURL(blob), mime: r.mime, durationMs: r.durationMs,
        words: r.words.map(w => ({ start: c.start + w.s, t: w.t })) };
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    return p;
  }
  function clearCache() {
    cache.forEach(p => p.then(d => URL.revokeObjectURL(d.url), () => {}));
    cache = new Map();
  }

  async function playFrom(charIdx) {
    const my = ++session;
    audio.pause();
    cancelAnimationFrame(rafId);
    if (!chunks.length) return stop();
    const ci = chunkAt(charIdx);
    setState('loading');
    updateNow(chunks[ci].bi);
    status(`Préparation du passage ${ci + 1}/${chunks.length}…`, true);
    let data;
    try { data = await getChunk(ci); }
    catch (e) { if (my === session) { showError(e.message); stop(); } return; }
    if (my !== session) return;
    showError('');
    playing = { ci, data };
    audio.src = data.url;
    audio.volume = +$('volume').value;
    const target = words.length ? words[wordAt(charIdx)].start : charIdx;
    const first = data.words.find(w => w.start >= target);
    const seek = first && charIdx > chunks[ci].start ? Math.max(0, first.t / 1000 - 0.08) : 0;
    try {
      if (seek) await new Promise(res => { audio.addEventListener('loadedmetadata', res, { once: true }); });
      audio.currentTime = seek;
      await audio.play();
    } catch (e) {
      if (my === session) { showError('La lecture audio a été bloquée par le navigateur. Cliquez sur Lire pour réessayer.'); stop(); }
      return;
    }
    if (my !== session) return;
    setState('playing');
    status(`Passage ${ci + 1}/${chunks.length}`);
    for (let k = 1; k <= 2 && ci + k < chunks.length; k++) getChunk(ci + k).catch(() => {});
    tick();
  }

  function tick() {
    if (!playing) return;
    const ms = audio.currentTime * 1000;
    const ws = playing.data.words;
    let lo = 0, hi = ws.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ws[mid].t <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans >= 0) mark(wordAt(ws[ans].start));
    rafId = requestAnimationFrame(tick);
  }

  audio.addEventListener('ended', () => {
    if (!playing) return;
    const next = playing.ci + 1;
    if (next >= chunks.length) { $('bar').style.width = '100%'; stop(true); status('Lecture terminée'); return; }
    playFrom(chunks[next].start);
  });

  function setState(s) {
    state = s;
    $('btnStop').disabled = s === 'idle';
    $('btnPrev').disabled = $('btnNext').disabled = s === 'idle';
    $('btnPlay').classList.toggle('loading', s === 'loading');
    $('playLbl').textContent = s === 'playing' ? 'Pause' : s === 'paused' ? 'Reprendre' : s === 'loading' ? 'Chargement…' : 'Lire';
    $('icoPlay').innerHTML = s === 'playing'
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M7 4.5v15l13-7.5z"/>';
    const idle = s === 'idle';
    blocksEl.classList.toggle('locked', !idle);
    blocksEl.querySelectorAll('textarea').forEach(t => t.hidden = !idle);
    blocksEl.querySelectorAll('.reading').forEach(r => r.hidden = idle);
    $('btnAddBlock').disabled = !idle;
    if (idle) {
      blocksEl.querySelectorAll('.block.active').forEach(el => el.classList.remove('active'));
      blocksEl.querySelectorAll('textarea').forEach(autosize);
    }
  }

  function stop(keepBar) {
    session++;
    audio.pause();
    cancelAnimationFrame(rafId);
    playing = null; current = -1;
    setState('idle');
    status('');
    if (!keepBar) $('bar').style.width = '0';
  }

  function start(charIdx = 0) {
    if (!full.trim()) { blocksEl.querySelector('textarea')?.focus(); return; }
    showError('');
    prepare(); renderReading();
    if (charIdx === 0) window.scrollTo({ top: 0 });
    playFrom(charIdx);
  }

  function toggle() {
    if ($('btnPlay').disabled) return;
    if (state === 'playing') { audio.pause(); cancelAnimationFrame(rafId); setState('paused'); status('En pause'); return; }
    if (state === 'paused') { audio.play().then(() => { setState('playing'); status(`Passage ${playing.ci + 1}/${chunks.length}`); tick(); }); return; }
    if (state === 'loading') return;
    start(0);
  }

  function settingsChanged() {
    if (state === 'playing' || state === 'paused') {
      const at = current >= 0 ? words[current].start : playing ? chunks[playing.ci].start : 0;
      prepare();
      current = -1;
      playFrom(at);
    }
  }

  // Phrase précédente / suivante pendant la lecture.
  function skip(dir) {
    if (state === 'idle' || !words.length) return;
    const pos = current >= 0 ? words[current].start : playing ? chunks[playing.ci].start : 0;
    const starts = [...new Set(chunks.flatMap(c => {
      const out = [c.start]; const re = /[.!?…\n]+["»”)]*\s+/g; const t = full.slice(c.start, c.end); let m;
      while ((m = re.exec(t))) if (m.index + m[0].length < t.length) out.push(c.start + m.index + m[0].length);
      return out;
    }))].sort((a, b) => a - b);
    const i = starts.findLastIndex(s => s <= pos);
    const target = dir < 0 ? starts[Math.max(0, i - (pos - starts[i] < 12 ? 1 : 0))] : starts[i + 1];
    if (target === undefined) return;
    current = -1;
    playFrom(target);
  }

  /* ---------------- export MP3 ---------------- */
  // Télécharge le MP3 d'un seul texte du projet.
  let exporting = false;
  async function exportMp3(bi, btn) {
    if (exporting) return;
    if (!project.blocks[bi].text.trim()) { blocksEl.children[bi].querySelector('textarea')?.focus(); return; }
    if (state === 'idle') prepare();
    const ids = chunks.map((c, i) => c.bi === bi ? i : -1).filter(i => i >= 0);
    exporting = true;
    btn.disabled = true; btn.classList.add('busy');
    showError('');
    const total = ids.length;
    let done = 0;
    const label = () => status(`Génération du MP3 : ${done}/${total}…`, true);
    label();
    try {
      const results = new Array(total);
      let next = 0;
      const worker = async () => {
        while (next < total) { const k = next++; results[k] = await getChunk(ids[k]); done++; label(); }
      };
      await Promise.all([worker(), worker(), worker()]);
      const mime = results[0].mime;
      const blob = new Blob(results.map(r => r.blob), { type: mime });
      const base = (project.name || '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'lecture';
      const name = project.blocks.length > 1 ? `${base} - texte ${bi + 1}` : base;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.${mime === 'audio/mpeg' ? 'mp3' : 'wav'}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      status(`Fichier prêt : ${blob.size < 1048576 ? Math.max(1, Math.round(blob.size / 1024)) + ' Ko' : (blob.size / 1048576).toFixed(1) + ' Mo'}`);
    } catch (e) {
      status('');
      showError(e.message);
    } finally {
      exporting = false;
      btn.disabled = false; btn.classList.remove('busy');
    }
  }

  /* ---------------- import ---------------- */
  async function importFile(f) {
    if (!f) return;
    stop();
    showError('');
    status(`Lecture de « ${f.name} »…`, true);
    try {
      let text;
      if (/\.(txt|md)$/i.test(f.name) || f.type === 'text/plain') text = await f.text();
      else {
        const r = await api('/api/extract', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name) }, body: f });
        text = r.text;
      }
      const last = project.blocks[project.blocks.length - 1];
      if (!last.text.trim()) { last.text = text; renderBlocks(); textChanged(); }
      else addBlock(text);
      status(`« ${f.name} » importé`);
    } catch (e) {
      status('');
      showError(e.message);
    }
  }

  /* ---------------- événements ---------------- */
  $('btnPlay').onclick = toggle;
  $('btnStop').onclick = () => stop();
  $('btnPrev').onclick = () => skip(-1);
  $('btnNext').onclick = () => skip(1);
  $('btnNewProject').onclick = newProject;
  $('btnDemo').onclick = demoProject;
  $('btnImport').onclick = () => $('file').click();
  $('file').onchange = e => { importFile(e.target.files[0]); e.target.value = ''; };

  const setPop = open => { $('speedPop').hidden = !open; $('btnSpeed').setAttribute('aria-expanded', open); };
  $('btnSpeed').onclick = () => setPop($('speedPop').hidden);
  document.addEventListener('mousedown', e => { if (!e.target.closest('.pop-wrap')) setPop(false); });

  const outs = {
    rate: ['oRate', v => (+v).toFixed(2).replace(/0$/, '') + '×'],
    pitch: ['oPitch', v => (v > 0 ? '+' : '') + v + ' %'],
    volume: ['oVol', v => Math.round(v * 100) + ' %'],
  };

  const doc = $('doc');
  doc.addEventListener('dragover', e => { e.preventDefault(); doc.classList.add('drop'); });
  doc.addEventListener('dragleave', e => { if (!doc.contains(e.relatedTarget)) doc.classList.remove('drop'); });
  doc.addEventListener('drop', e => { e.preventDefault(); doc.classList.remove('drop'); importFile(e.dataTransfer.files[0]); });

  document.addEventListener('keydown', e => {
    if (!$('picker').hidden) { if (e.key === 'Escape') closePicker(); return; }
    if (e.key === 'Escape' && !$('speedPop').hidden) { setPop(false); $('btnSpeed').focus(); return; }
    const tag = document.activeElement.tagName;
    if (e.code === 'Space' && !/INPUT|SELECT|BUTTON|TEXTAREA/.test(tag) && !document.activeElement.isContentEditable) { e.preventDefault(); toggle(); }
    if (e.key === 'Escape' && state !== 'idle') stop();
  });
  addEventListener('resize', () => blocksEl.querySelectorAll('textarea').forEach(autosize));

  /* ---------------- installation comme application ---------------- */
  // Le navigateur propose l'installation (Edge, Chrome) : on affiche notre propre bouton.
  let installPrompt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('btnInstall').hidden = false; });
  addEventListener('appinstalled', () => { installPrompt = null; $('btnInstall').hidden = true; status('Application installée : retrouvez-la dans le menu Démarrer.'); });
  $('btnInstall').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('btnInstall').hidden = true;
  };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* ---------------- démarrage ---------------- */
  projects = store.get('projects', null);
  if (!Array.isArray(projects) || !projects.length) {
    // Première ouverture (ou ancienne version) : on reprend le texte déjà saisi.
    projects = [makeProject('Mon premier projet', [makeBlock(store.get('text', SAMPLE), store.get('voice', null))])];
    persist();
  }

  for (const [k, [o, f]] of Object.entries(outs)) {
    const el = $(k);
    el.value = store.get(k, el.value);
    const upd = () => {
      $(o).textContent = f(el.value);
      if (k === 'rate') $('oRate2').textContent = f(el.value);
      store.set(k, el.value);
      if (project) updateStats();
      if (k === 'volume') audio.volume = +el.value;
    };
    el.addEventListener('input', upd); upd();
    if (k !== 'volume') el.addEventListener('change', settingsChanged);
  }

  openProject(store.get('project', projects[0].id));
  status('Chargement des voix…', true);
  loadVoices();
})();
