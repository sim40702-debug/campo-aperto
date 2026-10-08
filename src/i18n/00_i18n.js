// ============================================================
// LINGUE — italiano (lingua del codice), inglese, tedesco, francese
// Le frasi si scrivono in italiano come sempre. Le traduzioni sono in un file per lingua:
// src/i18n/en.json, de.json, fr.json. Ogni file è diviso in sezioni (generale, partita, gioco...) e in ogni
// sezione c'è "frase italiana": "traduzione". I tre file devono avere le stesse frasi (lo controlla
// tests/lingue_test.js). Una frase con valori inseriti si scrive
// con {0}, {1}... al posto dei valori (es. 'Cartellino giallo — {0}'); {t0} vuol dire che anche
// il valore va tradotto (es. il nome di un ruolo), {#0} che il valore è solo un numero (per frasi corte come
// '{#0} di {#1}', che altrimenti potrebbero cambiare anche il nome di una squadra come "Falchi di Brera").
// Una riga che inizia con @ serve solo al codice (trf) e non viene cercata nelle scritte della pagina.
// Le scritte sulla pagina si traducono da sole: un osservatore guarda ogni testo che cambia e,
// se la lingua scelta non è l'italiano, lo sostituisce con la traduzione. Così funzionano anche
// le frasi che arrivano dal server e dalla simulazione, che restano in italiano.
// Un elemento con translate="no" (nomi dei giocatori, delle squadre...) non viene mai tradotto.
// ============================================================
const LANGUAGES = [
  { id: 'it', label: 'Italiano', locale: 'it-IT' },
  { id: 'en', label: 'English', locale: 'en-GB' },
  { id: 'de', label: 'Deutsch', locale: 'de-CH' },
  { id: 'fr', label: 'Français', locale: 'fr-CH' },
];
const I18N = {
  lang: 'it',
  exact: { en: new Map(), de: new Map(), fr: new Map() },   // frase italiana -> traduzione
  patterns: [],                                              // frasi con {0}: { re, groups, text: { en, de, fr } }
  templates: { en: new Map(), de: new Map(), fr: new Map() }, // per trf(): modello italiano -> modello tradotto
  cache: new Map(),                                          // risultati già calcolati (anche "nessuna traduzione")
};
const LANG_COLUMN = { en: 1, de: 2, fr: 3 };

function i18nEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// aggiunge righe [italiano, inglese, tedesco, francese]; una traduzione vuota usa l'italiano
function addTranslations(rows) {
  const plain = x => x.replace(/\{[t#](\d+)\}/g, '{$1}');
  for (const row of rows) {
    let it = row[0].replace(/\s+/g, ' ');
    const codeOnly = it[0] === '@';
    if (codeOnly) it = it.slice(1);
    if (codeOnly) {
      for (const l in LANG_COLUMN) if (row[LANG_COLUMN[l]]) I18N.templates[l].set(plain(it), plain(row[LANG_COLUMN[l]]));
      continue;
    }
    if (/\{[t#]?\d+\}/.test(it)) {
      const groups = [];
      const re = new RegExp('^' + it.split(/(\{[t#]?\d+\})/).map(p => {
        const m = /^\{([t#]?)(\d+)\}$/.exec(p);
        if (!m) return i18nEscape(p);
        groups.push({ n: Number(m[2]), translate: m[1] === 't', mark: m[1] });
        return m[1] === '#' ? '(-?\\d[\\d.,\'’\\u00a0\\u202f]*)' : '([\\s\\S]*?)';
      }).join('') + '$');
      const text = {};
      for (const l in LANG_COLUMN) text[l] = row[LANG_COLUMN[l]] || it;
      // i modelli con più testo fisso vengono provati prima (sono più precisi)
      I18N.patterns.push({ re, groups, text, weight: it.replace(/\{[t#]?\d+\}/g, '').length });
      for (const l in LANG_COLUMN) I18N.templates[l].set(plain(it), plain(text[l]));
    } else {
      for (const l in LANG_COLUMN) if (row[LANG_COLUMN[l]]) I18N.exact[l].set(it, row[LANG_COLUMN[l]]);
    }
  }
  I18N.patterns.sort((a, b) => b.weight - a.weight);
  I18N.cache.clear();
}

// carica i file delle lingue ({ en: {...}, de: {...}, fr: {...} }, come in src/i18n/*.json):
// per ogni frase italiana fa una riga [italiano, inglese, tedesco, francese] e la passa ad addTranslations
function loadLanguages(langs) {
  const rows = [];
  for (const section in langs.en) {
    for (const it in langs.en[section]) {
      const row = [it];
      for (const l in LANG_COLUMN) row[LANG_COLUMN[l]] = (langs[l][section] || {})[it] || '';
      rows.push(row);
    }
  }
  addTranslations(rows);
}

// traduzione di una frase italiana completa (senza spazi ai lati); null se non c'è
function trCore(s, lang) {
  const exact = I18N.exact[lang].get(s);
  if (exact !== undefined) return exact;
  for (const p of I18N.patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    let out = p.text[lang];
    p.groups.forEach((g, i) => {
      let v = m[i + 1];
      if (g.translate) { const tv = trCore(v.trim(), lang); if (tv !== null) v = tv; }
      out = out.split('{' + g.mark + g.n + '}').join(v);
    });
    return out;
  }
  return null;
}

// traduce un testo nella lingua scelta (gli spazi all'inizio e alla fine restano)
function tr(text) {
  const lang = I18N.lang;
  if (lang === 'it' || typeof text !== 'string' || !/[A-Za-zÀ-ÿ]/.test(text)) return text;
  const key = lang + '\u0001' + text;
  const hit = I18N.cache.get(key);
  if (hit !== undefined) return hit;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  // gli a capo e gli spazi doppi dentro la frase (es. nell'HTML) contano come uno spazio
  const core = trCore(m[2].replace(/\s+/g, ' '), lang);
  const out = core === null ? text : m[1] + core + m[3];
  if (I18N.cache.size > 20000) I18N.cache.clear();
  I18N.cache.set(key, out);
  return out;
}
// per il codice: trf('Giornata {0}', 3) -> 'Matchday 3'. Si traduce il modello e poi si inseriscono i valori
// (così un nome o un pezzo di HTML tra i valori non disturba la traduzione)
function trf(key, ...args) {
  const k = key.replace(/\s+/g, ' ');
  let s = I18N.lang === 'it' ? k : (I18N.templates[I18N.lang].get(k) || I18N.exact[I18N.lang].get(k) || k);
  args.forEach((v, i) => { s = s.split('{' + i + '}').join(String(v)); });
  return s;
}
function uiLocale() {
  const l = LANGUAGES.find(x => x.id === I18N.lang);
  return l ? l.locale : 'it-IT';
}

// ---------- traduzione della pagina ----------
const I18N_ATTRS = ['title', 'placeholder', 'aria-label'];
const i18nText = new WeakMap();   // nodo di testo -> { orig, shown }
const i18nAttr = new WeakMap();   // elemento -> { attributo: { orig, shown } }
let i18nObserver = null;

function i18nSkip(el) {
  if (!el) return true;
  const tag = el.nodeName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'CODE') return true;
  return !!(el.closest && el.closest('[translate="no"]'));
}
function i18nDoText(node) {
  const cur = node.nodeValue;
  let rec = i18nText.get(node);
  if (rec && cur === rec.shown) return;          // l'abbiamo scritto noi
  if (i18nSkip(node.parentNode)) return;
  const shown = tr(cur);
  i18nText.set(node, { orig: cur, shown });
  if (shown !== cur) node.nodeValue = shown;
}
function i18nDoAttr(el, a) {
  const cur = el.getAttribute(a);
  if (cur === null) return;
  let all = i18nAttr.get(el);
  if (!all) { all = {}; i18nAttr.set(el, all); }
  const rec = all[a];
  if (rec && cur === rec.shown) return;
  if (i18nSkip(el)) return;
  const shown = tr(cur);
  all[a] = { orig: cur, shown };
  if (shown !== cur) el.setAttribute(a, shown);
}
function i18nWalk(root) {
  if (root.nodeType === 3) { i18nDoText(root); return; }
  if (root.nodeType !== 1 || i18nSkip(root)) return;
  for (const a of I18N_ATTRS) if (root.hasAttribute(a)) i18nDoAttr(root, a);
  for (let c = root.firstChild; c; c = c.nextSibling) i18nWalk(c);
}
// rimette il testo originale (italiano) dove l'avevamo tradotto, per tradurlo di nuovo nella nuova lingua
function i18nRestore(root) {
  if (root.nodeType === 3) {
    const rec = i18nText.get(root);
    if (rec && root.nodeValue === rec.shown && rec.orig !== rec.shown) root.nodeValue = rec.orig;
    i18nText.delete(root);
    return;
  }
  if (root.nodeType !== 1) return;
  const all = i18nAttr.get(root);
  if (all) {
    for (const a in all) if (root.getAttribute(a) === all[a].shown && all[a].orig !== all[a].shown) root.setAttribute(a, all[a].orig);
    i18nAttr.delete(root);
  }
  for (let c = root.firstChild; c; c = c.nextSibling) i18nRestore(c);
}
function i18nStartObserver() {
  if (i18nObserver || typeof MutationObserver === 'undefined' || !document.body) return;
  i18nObserver = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') i18nDoText(m.target);
      else if (m.type === 'attributes') i18nDoAttr(m.target, m.attributeName);
      else for (const n of m.addedNodes) i18nWalk(n);
    }
  });
  i18nObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
}

// cambia la lingua di tutto il gioco (anche le scritte già sulla pagina)
function setLanguage(id) {
  if (!LANGUAGES.some(l => l.id === id)) id = 'it';
  const changed = id !== I18N.lang;
  if (typeof document === 'undefined') { I18N.lang = id; return changed; }
  if (changed && document.body) i18nRestore(document.body);
  I18N.lang = id;
  document.documentElement.lang = id;
  if (document.body) {
    // in italiano non serve guardare la pagina: l'osservatore parte solo con un'altra lingua
    if (id !== 'it') { i18nStartObserver(); i18nWalk(document.body); }
    else if (i18nObserver) { i18nObserver.disconnect(); i18nObserver = null; }
    // il titolo della finestra
    const ti = document.querySelector('title');
    if (ti) { if (!ti.dataset.it) ti.dataset.it = ti.textContent; document.title = tr(ti.dataset.it); }
  }
  return changed;
}
