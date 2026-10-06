// ============================================================
// SQUADRE IN PIÙ — 24 squadre originali oltre alle 8 del server, per campionati, tornei e coppe.
// Stesso file nel gioco e nel server (build.js engine): le competizioni tra amici sul server usano le stesse rose.
// ============================================================

const EXTRA_TEAM_TEMPLATES = [
  { name: 'Aquile del Lario', short: 'AQL', rating: 77, home: ['#0f3d6e', '#f2f2f2', '#0f3d6e'], away: ['#f2f2f2', '#0f3d6e', '#f2f2f2'] },
  { name: 'Grifoni di Lucca', short: 'GRI', rating: 75, home: ['#b8122e', '#111111', '#b8122e'], away: ['#f4d03f', '#111111', '#f4d03f'] },
  { name: 'Cervi di Sila', short: 'CER', rating: 69, home: ['#2d6a4f', '#d8f3dc', '#2d6a4f'], away: ['#d8f3dc', '#2d6a4f', '#d8f3dc'] },
  { name: 'Corsari di Levante', short: 'COR', rating: 74, home: ['#111827', '#ef4444', '#111827'], away: ['#ef4444', '#111827', '#ef4444'] },
  { name: 'Leoni di Marmo', short: 'LEO', rating: 79, home: ['#e7e5e4', '#1c1917', '#e7e5e4'], away: ['#1c1917', '#e7e5e4', '#1c1917'] },
  { name: 'Torre Nera', short: 'TOR', rating: 71, home: ['#1f1f1f', '#fbbf24', '#1f1f1f'], away: ['#fbbf24', '#1f1f1f', '#fbbf24'] },
  { name: 'Vele di Salina', short: 'VEL', rating: 66, home: ['#38bdf8', '#ffffff', '#38bdf8'], away: ['#ffffff', '#0369a1', '#ffffff'] },
  { name: 'Fiamme d\'Etna', short: 'FIA', rating: 72, home: ['#dc2626', '#f97316', '#dc2626'], away: ['#f97316', '#7f1d1d', '#f97316'] },
  { name: 'Querce di Romagna', short: 'QUE', rating: 67, home: ['#4d7c0f', '#fef9c3', '#4d7c0f'], away: ['#fef9c3', '#4d7c0f', '#fef9c3'] },
  { name: 'Arsenale Lagunare', short: 'ARS', rating: 76, home: ['#7c2d12', '#fde68a', '#7c2d12'], away: ['#fde68a', '#7c2d12', '#fde68a'] },
  { name: 'Lince Bianca', short: 'LIN', rating: 70, home: ['#f8fafc', '#334155', '#f8fafc'], away: ['#334155', '#f8fafc', '#334155'] },
  { name: 'Marinai di Ancona', short: 'MAR', rating: 68, home: ['#1e3a8a', '#fde047', '#1e3a8a'], away: ['#fde047', '#1e3a8a', '#fde047'] },
  { name: 'Pietra Serena', short: 'PIE', rating: 65, home: ['#9ca3af', '#1f2937', '#9ca3af'], away: ['#1f2937', '#9ca3af', '#1f2937'] },
  { name: 'Rondini di Tevere', short: 'RON', rating: 73, home: ['#7e22ce', '#f5f3ff', '#7e22ce'], away: ['#f5f3ff', '#7e22ce', '#f5f3ff'] },
  { name: 'Stambecchi Alpini', short: 'STB', rating: 67, home: ['#a16207', '#fefce8', '#a16207'], away: ['#fefce8', '#a16207', '#fefce8'] },
  { name: 'Ulivi di Puglia', short: 'ULI', rating: 69, home: ['#65a30d', '#1e293b', '#65a30d'], away: ['#1e293b', '#a3e635', '#1e293b'] },
  { name: 'Volpi Rosse', short: 'VOL', rating: 71, home: ['#ea580c', '#ffffff', '#ea580c'], away: ['#ffffff', '#ea580c', '#ffffff'] },
  { name: 'Cometa Azzurra', short: 'COM', rating: 78, home: ['#0ea5e9', '#0c4a6e', '#0ea5e9'], away: ['#0c4a6e', '#7dd3fc', '#0c4a6e'] },
  { name: 'Faro di Trieste', short: 'FAR', rating: 70, home: ['#ffffff', '#b91c1c', '#ffffff'], away: ['#b91c1c', '#ffffff', '#b91c1c'] },
  { name: 'Granata del Po', short: 'GRA', rating: 74, home: ['#7f1d1d', '#ffffff', '#7f1d1d'], away: ['#ffffff', '#7f1d1d', '#ffffff'] },
  { name: 'Orione', short: 'ORI', rating: 72, home: ['#312e81', '#c7d2fe', '#312e81'], away: ['#c7d2fe', '#312e81', '#c7d2fe'] },
  { name: 'Saette del Gargano', short: 'SAE', rating: 64, home: ['#facc15', '#1e40af', '#facc15'], away: ['#1e40af', '#facc15', '#1e40af'] },
  { name: 'Tritoni di Napoli', short: 'TRI', rating: 80, home: ['#22d3ee', '#083344', '#22d3ee'], away: ['#083344', '#22d3ee', '#083344'] },
  { name: 'Zefiro', short: 'ZEF', rating: 66, home: ['#a7f3d0', '#064e3b', '#a7f3d0'], away: ['#064e3b', '#a7f3d0', '#064e3b'] },
];
// generate sempre uguali (seme fisso) senza toccare la sequenza casuale del resto del gioco
function buildExtraTeams() {
  const prev = rand;
  setSeed(4242);
  try {
    return EXTRA_TEAM_TEMPLATES.map((t, i) => generateTeam(t, ['4-3-3', '4-4-2', '4-2-3-1'][i % 3]));
  } finally { rand = prev; }
}

