// ============================================================
// IMPOSTAZIONI — salvate sul computer (localStorage)
// ============================================================
const SETTINGS_KEY = 'campoAperto.settings.v1';
const QUALITY_LEVELS = [
  { id: 'bassa', label: 'Bassa' }, { id: 'media', label: 'Media' }, { id: 'alta', label: 'Alta' }, { id: 'ultra', label: 'Ultra' },
];
function defaultSettings() {
  return {
    quality: 'alta',          // bassa, media, alta, ultra
    resScale: 1,              // scala di risoluzione (0.5 - 1)
    dynamicRes: true,         // abbassa la risoluzione da sola se gli fps scendono
    fpsLimit: 0,              // 0 = sincronizzato con lo schermo
    showFps: false,
    volMaster: 0.8, volSfx: 1, volCrowd: 0.7, muted: false,
    keys: JSON.parse(JSON.stringify(DEFAULT_KEYS)),
    mouse: true,
    padKeys: JSON.parse(JSON.stringify(DEFAULT_PAD)),
    padEnabled: true,         // controller attivo
    padLayout: 'xbox',        // nomi dei pulsanti: xbox o ps (PlayStation)
    vibration: true,          // vibrazione del controller
    deadzone: 0.22,           // zona morta delle levette (0.1 - 0.4)
    assistReceive: true,      // senza direzione, chi riceve un tuo passaggio va incontro alla palla
    lastSetup: null,          // ultima partita impostata (squadre, durata...)
    camera: 0,
    name: '',
    server: '',               // server online (wss://...), facoltativo: senza, le partite si ospitano in rete locale
    lanHost: '',              // ultimo indirizzo dell'host in rete locale con cui sei entrato (IP o IP:porta)
    netDebug: false,          // pannello di diagnostica della rete
  };
}
function loadSettings() {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k in s) if (saved[k] !== undefined && typeof saved[k] === typeof s[k]) s[k] = saved[k];
      if (!s.keys || Array.isArray(s.keys)) s.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
      if (!s.padKeys || Array.isArray(s.padKeys)) s.padKeys = JSON.parse(JSON.stringify(DEFAULT_PAD));
      // azioni nuove (aggiunte dopo il primo salvataggio): tasti predefiniti, se non sono già usati altrove
      for (const a in DEFAULT_KEYS) {
        if (Array.isArray(s.keys[a])) continue;
        const used = new Set(); for (const b in s.keys) if (Array.isArray(s.keys[b])) for (const c of s.keys[b]) if (c) used.add(c);
        s.keys[a] = DEFAULT_KEYS[a].map(c => (c && used.has(c) ? null : c));
      }
      for (const a in DEFAULT_PAD) {
        if (s.padKeys[a] === undefined) {
          const taken = Object.keys(s.padKeys).some(b => s.padKeys[b] === DEFAULT_PAD[a]);
          s.padKeys[a] = taken ? null : DEFAULT_PAD[a];
        }
      }
      if (saved.lastSetup && typeof saved.lastSetup === 'object') s.lastSetup = saved.lastSetup;
    }
  } catch (e) { /* impostazioni rovinate o archivio non disponibile: si usano quelle predefinite */ }
  if (QUALITY_LEVELS.every(q => q.id !== s.quality)) s.quality = 'alta';
  // vecchio valore predefinito (fino alla 0.4.1): indicava il computer di ciascun giocatore, mai quello dell'host
  if (/^ws:\/\/(localhost|127\.0\.0\.1):8787\/?$/.test(s.server)) s.server = '';
  s.resScale = clamp(Number(s.resScale) || 1, 0.5, 1);
  s.deadzone = clamp(Number(s.deadzone) || 0.22, 0.1, 0.4);
  if (!PAD_NAMES[s.padLayout]) s.padLayout = 'xbox';
  return s;
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* non disponibile: restano valide per la sessione */ }
}
