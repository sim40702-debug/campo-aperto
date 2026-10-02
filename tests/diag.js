const fs = require('fs'), path = require('path');
const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => /^0[1-8]_/.test(f)).sort();
let code = files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG, resolveTackleOrig: Match.prototype.resolveTackle };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let tackles = 0;
A.Match.prototype.resolveTackle = function (a, b, s) { tackles++; return A.resolveTackleOrig.call(this, a, b, s); };
const db = A.buildDatabase(3); A.setSeed(11);
const m = new A.Match(db[0], db[1], { halfSeconds: 120, humanTeam: -1 });
const zones = [0, 0, 0, 0, 0]; let ownerTime = 0, freeTime = 0, minPressDist = [];
let steps = 0, presserDists = [];
while (m.state !== 'FULLTIME' && steps < 60 * 400) {
  m.update(A.CONFIG.DT, null); steps++; m.events.length = 0;
  if (m.state !== 'PLAY') continue;
  zones[Math.min(4, Math.floor((m.ball.x + 52.5) / 21))]++;
  if (m.ball.owner) {
    ownerTime++;
    const opp = m.ball.owner.team.opponent();
    if (opp.presser) presserDists.push(Math.hypot(opp.presser.x - m.ball.owner.x, opp.presser.z - m.ball.owner.z));
  } else freeTime++;
}
presserDists.sort((a, b) => a - b);
console.log('zone x (5 fasce)', zones.map(z => Math.round(z / 60) + 's'));
console.log('possesso palla al piede', Math.round(ownerTime / 60) + 's', 'palla libera', Math.round(freeTime / 60) + 's');
console.log('distanza pressatore: p10', presserDists[Math.floor(presserDists.length * 0.1)]?.toFixed(2), 'mediana', presserDists[Math.floor(presserDists.length / 2)]?.toFixed(2));
console.log('tentativi di contrasto', tackles, 'score', m.teams[0].score, m.teams[1].score);
