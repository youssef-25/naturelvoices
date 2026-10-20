// Version bureau : démarre le serveur en local puis l'affiche dans une fenêtre native.
const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const { startServer } = require('../src/server');

// Port fixe : les projets sont enregistrés par le navigateur intégré pour une adresse donnée
// (127.0.0.1:port). Un port qui change à chaque lancement ferait « disparaître » les projets.
const PORT = 47821;

let server, win;

async function listen() {
  try {
    return await startServer({ port: PORT, host: '127.0.0.1' });
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    console.warn(`Port ${PORT} occupé : port temporaire utilisé, les projets enregistrés ne seront pas visibles.`);
    return startServer({ port: 0, host: '127.0.0.1' });
  }
}

async function createWindow() {
  const started = server ? { port: server.address().port } : await listen();
  if (started.server) server = started.server;

  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    title: 'Naturels Voices',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12151c' : '#f3f5f9',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Les liens externes s'ouvrent dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // Téléchargement MP3 : Electron affiche la boîte « Enregistrer sous ».
  win.webContents.session.on('will-download', (event, item) => {
    item.setSaveDialogOptions({ title: 'Enregistrer l’audio', defaultPath: item.getFilename() });
  });

  await win.loadURL(`http://127.0.0.1:${started.port}/`);
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
  { label: 'Fichier', submenu: [{ role: process.platform === 'darwin' ? 'close' : 'quit', label: 'Quitter' }] },
  { label: 'Édition', submenu: [
    { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' },
    { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' },
  ] },
  { label: 'Affichage', submenu: [
    { role: 'zoomIn', label: 'Zoom avant' }, { role: 'zoomOut', label: 'Zoom arrière' }, { role: 'resetZoom', label: 'Taille réelle' },
    { type: 'separator' }, { role: 'togglefullscreen', label: 'Plein écran' }, { role: 'toggleDevTools', label: 'Outils de développement' },
  ] },
]));

// Une seule instance : relancer l'application ramène la fenêtre existante au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
