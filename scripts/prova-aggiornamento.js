// Prova temporanea (solo nel ramo prova-aggiornamento): si collega all'app aperta con --remote-debugging-port=9222,
// controlla gli aggiornamenti e aggiorna, scrivendo gli stati. Uso: node scripts/prova-aggiornamento.js
const { chromium } = require('playwright-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let b = null;
  for (let i = 0; i < 40 && !b; i++) { try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); } catch (e) { await sleep(2000); } }
  if (!b) { console.log('niente collegamento'); return; }
  let pg = null;
  for (let i = 0; i < 30 && !pg; i++) { pg = b.contexts().flatMap(c => c.pages()).find(p => p.url().includes('index.html')); if (!pg) await sleep(1000); }
  if (!pg) { console.log('niente pagina'); return; }
  await pg.waitForFunction(() => window.campoUpdate && window.game && window.game.loaded, null, { timeout: 60000 });
  const s1 = await pg.evaluate(() => window.campoUpdate.controlla());
  console.log('controlla ' + JSON.stringify({ fase: s1.fase, attuale: s1.attuale, nuova: s1.nuova, automatico: s1.automatico, saltate: s1.saltate, errore: s1.errore, note: (s1.note || '').length }));
  pg.evaluate(() => window.campoUpdate.aggiorna()).catch(() => {});
  let last = '';
  for (let i = 0; i < 400; i++) {
    let st;
    try { st = await pg.evaluate(() => window.campoUpdate.stato()); } catch (e) { console.log('pagina chiusa (l\'app si sta aggiornando)'); break; }
    const k = st.fase + ' ' + Math.floor((st.percentuale || 0) / 20) * 20 + ' ' + (st.errore || '');
    if (k !== last) { last = k; console.log('stato ' + k); }
    if (st.fase === 'errore') break;
    await sleep(1000);
  }
  process.exit(0);
})().catch(e => { console.log('errore ' + e.message); process.exit(0); });
