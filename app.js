// Wheel of Whimsy — static app for GitHub Pages.
// Lists live in lists/lists.yaml (the index) and lists/<id>.yaml (the ideas).

const CONFIG = {
  repo: 'mattkrnr/dates',   // used for the "edit this list" link
  branch: 'main',
  maxSlices: 12,
};

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const SEASON_EMOJI = { winter: '❄️', spring: '🌷', summer: '☀️', fall: '🍂' };
const COLORS = ['#ff5d73', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];

const $ = (s) => document.querySelector(s);

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  lists: [],
  list: null,
  ideas: [],
  origin: null,          // {lat, lng} of the ZIP
  zip: '',
  filters: Object.assign({ when: 'any', light: 'any', season: 'now', maxMiles: 0 }, store.get('filters', {})),
  wheel: [],             // ideas currently on the wheel
  wheelKey: '',
  skipped: new Set(),    // "nah" picks, skipped for this visit
  rotation: 0,
  spinning: false,
};

// ---------- helpers ----------
function currentSeason(d = new Date()) {
  const m = d.getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}

function num(v) { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : null; }

function milesBetween(a, b) {
  const R = 3958.8, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isHome(addr) { return !addr || String(addr).trim().toLowerCase() === 'home'; }

function normalize(raw, i) {
  const when = String(raw.when || 'either').toLowerCase().replace(/s$/, '');
  let s = raw.season ?? 'any';
  if (!Array.isArray(s)) s = String(s).split(/[,/ ]+/);
  s = s.map((x) => String(x).toLowerCase().trim()).map((x) => (x === 'autumn' ? 'fall' : x)).filter(Boolean);
  const seasons = s.includes('any') || s.length === 0 ? new Set(SEASONS) : new Set(s.filter((x) => SEASONS.includes(x)));
  return {
    id: i,
    name: String(raw.name || 'Untitled date'),
    address: isHome(raw.address) ? 'home' : String(raw.address),
    when: when === 'weekend' || when === 'weeknight' ? when : 'either',
    daylight: raw.daylight === true || String(raw.daylight).toLowerCase() === 'yes',
    seasons,
    notes: raw.notes ? String(raw.notes) : '',
    link: raw.link ? String(raw.link) : '',
    coords: num(raw.lat) != null && num(raw.lng) != null ? { lat: num(raw.lat), lng: num(raw.lng) } : null,
    geo: 'pending', // pending | ok | approx | failed
    dist: null,
  };
}

// ---------- geocoding (OpenStreetMap Nominatim, max 1 request/sec, cached) ----------
const GEO_KEY = 'geocache-v1';
const geoCache = store.get(GEO_KEY, {});
let lastGeoCall = 0;

async function nominatim(params) {
  const wait = lastGeoCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeoCall = Date.now();
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'us', ...params });
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('geocoder ' + res.status);
  const data = await res.json();
  return data[0] ? { lat: Number(data[0].lat), lng: Number(data[0].lon) } : null;
}

async function geocodeZip(zip) {
  const key = 'z:' + zip;
  if (geoCache[key]) return geoCache[key];
  const hit = await nominatim({ postalcode: zip });
  if (hit) { geoCache[key] = hit; store.set(GEO_KEY, geoCache); }
  return hit;
}

async function geocodeAddress(addr) {
  const key = 'a:' + addr.toLowerCase().replace(/\s+/g, ' ').trim();
  if (geoCache[key]) return geoCache[key];
  let hit = await nominatim({ q: addr });
  let approx = false;
  if (!hit) {
    // Fall back to the ZIP in the address so the idea still gets a rough distance.
    const zip = addr.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
    if (zip) { hit = await geocodeZip(zip[1]); approx = !!hit; }
  }
  if (hit) {
    const val = { ...hit, approx };
    geoCache[key] = val; store.set(GEO_KEY, geoCache);
    return val;
  }
  return null;
}

let geoRun = 0;
async function geocodeIdeas() {
  const run = ++geoRun;
  const todo = state.ideas.filter((i) => i.address !== 'home' && !i.coords);
  let left = todo.length;
  for (const idea of todo) {
    if (run !== geoRun) return; // a new list was loaded
    if (left > 0) setStatus(`Finding ${left} place${left === 1 ? '' : 's'} on the map…`);
    try {
      const hit = await geocodeAddress(idea.address);
      if (hit) { idea.coords = { lat: hit.lat, lng: hit.lng }; idea.geo = hit.approx ? 'approx' : 'ok'; }
      else idea.geo = 'failed';
    } catch { idea.geo = 'failed'; }
    left--;
    updateDistances();
    render();
  }
  if (run === geoRun) {
    const failed = state.ideas.filter((i) => i.geo === 'failed').length;
    setStatus(failed ? `Couldn't find ${failed} address${failed === 1 ? '' : 'es'} on the map — those ideas ignore the distance filter.` : '');
  }
}

function updateDistances() {
  for (const idea of state.ideas) {
    if (idea.address === 'home') { idea.dist = 0; idea.geo = 'ok'; continue; }
    if (idea.coords && idea.geo === 'pending') idea.geo = 'ok';
    idea.dist = idea.coords && state.origin ? milesBetween(state.origin, idea.coords) : null;
  }
}

// ---------- filtering ----------
function matches(idea) {
  const f = state.filters;
  if (f.when !== 'any' && idea.when !== 'either' && idea.when !== f.when) return false;
  if (f.light === 'dark' && idea.daylight) return false;
  const season = f.season === 'now' ? currentSeason() : f.season;
  if (season !== 'any' && !idea.seasons.has(season)) return false;
  const max = Number(f.maxMiles);
  if (max > 0 && idea.dist != null && idea.dist > max) return false;
  return true;
}

// ---------- rendering ----------
function setStatus(t) { $('#status').textContent = t; }

function describe(idea) {
  const bits = [];
  if (idea.address === 'home') bits.push('🏠 at home');
  else if (idea.dist != null) bits.push(`${idea.dist < 10 ? idea.dist.toFixed(1) : Math.round(idea.dist)} mi${idea.geo === 'approx' ? ' (approx)' : ''}`);
  else if (idea.geo === 'failed') bits.push('distance unknown');
  bits.push(idea.when === 'either' ? 'any night' : idea.when);
  bits.push(idea.daylight ? '☀️ needs daylight' : '🌙 works after dark');
  bits.push(idea.seasons.size === 4 ? 'all year' : [...idea.seasons].map((s) => SEASON_EMOJI[s] + ' ' + s).join(', '));
  return bits;
}

function render() {
  const matched = state.ideas.filter(matches);
  $('#matchCount').textContent = `(${matched.length} of ${state.ideas.length} match)`;

  const ul = $('#ideaList');
  ul.replaceChildren(...matched.map((idea) => {
    const li = document.createElement('li');
    if (state.skipped.has(idea.id)) li.className = 'off';
    const n = document.createElement('div'); n.className = 'n'; n.textContent = idea.name;
    const m = document.createElement('div'); m.className = 'm'; m.textContent = describe(idea).join(' · ');
    li.append(n, m);
    return li;
  }));

  if (!state.spinning) buildWheel(matched);
}

function buildWheel(matched, reshuffle = false) {
  let pool = matched.filter((i) => !state.skipped.has(i.id));
  if (pool.length === 0 && matched.length) { state.skipped.clear(); pool = matched; } // ran out of "nah"s
  const key = pool.map((i) => i.id).join(',');
  if (key === state.wheelKey && !reshuffle) return;
  state.wheelKey = key;
  if (pool.length > CONFIG.maxSlices) {
    pool = [...pool].sort(() => Math.random() - 0.5).slice(0, CONFIG.maxSlices);
  }
  state.wheel = pool;
  drawWheel();
}

const wheelCanvas = $('#wheel');
const wctx = wheelCanvas.getContext('2d');

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const size = wheelCanvas.clientWidth || 400;
  wheelCanvas.width = Math.round(size * dpr);
  wheelCanvas.height = Math.round(size * dpr);
  drawWheel();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function wrap2(ctx, text, maxW) {
  const words = text.split(/\s+/);
  let first = '';
  while (words.length && ctx.measureText((first + ' ' + words[0]).trim()).width <= maxW) first = (first + ' ' + words.shift()).trim();
  if (!first) return [fitText(ctx, text, maxW)];
  if (!words.length) return [first];
  return [first, fitText(ctx, words.join(' '), maxW)];
}

function drawWheel() {
  const W = wheelCanvas.width, r = W / 2, ctx = wctx;
  ctx.clearRect(0, 0, W, W);
  const slices = state.wheel;
  if (!slices.length) {
    ctx.fillStyle = '#f3e6dc';
    ctx.beginPath(); ctx.arc(r, r, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a6a72';
    ctx.font = `600 ${W * 0.04}px "DM Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(state.ideas.length ? 'No matches — loosen a filter' : 'Loading ideas…', r, r * 0.55);
    return;
  }
  const n = slices.length, arc = (Math.PI * 2) / n, rot = state.rotation;
  const fontPx = Math.max(W * 0.026, Math.min(W * 0.036, (W * 0.45) / n));
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * arc;
    ctx.beginPath(); ctx.moveTo(r, r); ctx.arc(r, r, r, a0, a0 + arc); ctx.closePath();
    // avoid two neighbours sharing a colour when n % colours === 1
    let c = COLORS[i % COLORS.length];
    if (i === n - 1 && n > 1 && c === COLORS[0]) c = COLORS[3];
    ctx.fillStyle = n === 1 ? COLORS[0] : c;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = W * 0.004; ctx.stroke();

    // Label: up to two lines, flipped on the left half so it never reads upside down.
    const mid = a0 + arc / 2;
    const flip = Math.cos(mid) < 0;
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(flip ? mid + Math.PI : mid);
    ctx.fillStyle = '#2b1d2f';
    ctx.font = `700 ${fontPx}px "DM Sans", sans-serif`;
    ctx.textBaseline = 'middle';
    const maxW = r * 0.6;
    const lines = n > 10 ? [fitText(ctx, slices[i].name, maxW)] : wrap2(ctx, slices[i].name, maxW);
    const lh = fontPx * 1.1;
    lines.forEach((line, k) => {
      const y = (k - (lines.length - 1) / 2) * lh;
      if (flip) { ctx.textAlign = 'left'; ctx.fillText(line, -r * 0.92, y); }
      else { ctx.textAlign = 'right'; ctx.fillText(line, r * 0.92, y); }
    });
    ctx.restore();
  }
}

// ---------- spinning ----------
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function spin() {
  if (state.spinning) return;
  if (!state.wheel.length) { setStatus('Nothing matches those filters — try loosening one.'); return; }
  const n = state.wheel.length, arc = (Math.PI * 2) / n, TAU = Math.PI * 2;
  const pick = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * arc * 0.7;
  const target = -Math.PI / 2 - (pick + 0.5) * arc + jitter; // puts the pick under the pointer
  const start = state.rotation;
  const turns = 5 + Math.floor(Math.random() * 3);
  const end = target + TAU * Math.ceil((start - target) / TAU) + turns * TAU;
  const dur = 4600 + Math.random() * 800;
  const t0 = performance.now();
  let lastSlice = null;

  state.spinning = true;
  $('#spinBtn').disabled = true;

  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    state.rotation = start + (end - start) * easeOut(t);
    drawWheel();
    const under = Math.floor((((-Math.PI / 2 - state.rotation) % TAU) + TAU) % TAU / arc);
    if (under !== lastSlice) { lastSlice = under; if (navigator.vibrate) navigator.vibrate(4); }
    if (t < 1) requestAnimationFrame(frame);
    else {
      state.rotation = end % TAU;
      state.spinning = false;
      $('#spinBtn').disabled = false;
      showResult(state.wheel[pick]);
    }
  }
  requestAnimationFrame(frame);
}

function showResult(idea) {
  $('#rName').textContent = idea.name;
  $('#rNotes').textContent = idea.notes;
  $('#rNotes').hidden = !idea.notes;
  $('#rTags').replaceChildren(...describe(idea).map((t) => Object.assign(document.createElement('span'), { textContent: t })));
  const home = idea.address === 'home';
  $('#rAddress').textContent = home ? '🏠 At home' : '📍 ' + idea.address;
  const map = $('#rMap');
  map.hidden = home;
  map.href = home ? '#' : 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(idea.address);
  const link = $('#rLink');
  link.hidden = !idea.link;
  if (idea.link) link.href = idea.link;
  $('#result').dataset.id = idea.id;
  $('#result').showModal();
}

// ---------- confetti ----------
function confetti() {
  const c = $('#confetti'), ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const parts = Array.from({ length: 160 }, () => ({
    x: c.width / 2, y: c.height * 0.45,
    vx: (Math.random() - 0.5) * 22 * dpr, vy: (-Math.random() * 20 - 6) * dpr,
    s: (5 + Math.random() * 6) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4,
    c: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const t0 = performance.now();
  (function tick(now) {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.6 * dpr; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
    }
    if (now - t0 < 2600) requestAnimationFrame(tick); else ctx.clearRect(0, 0, c.width, c.height);
  })(t0);
}

// ---------- loading ----------
async function loadYaml(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status})`);
  return jsyaml.load(await res.text());
}

async function setOrigin(zip) {
  state.zip = zip;
  store.set('zip:' + state.list.id, zip);
  state.origin = null;
  if (/^\d{5}$/.test(zip)) {
    try { state.origin = await geocodeZip(zip); } catch { /* offline */ }
    if (!state.origin) setStatus(`Couldn't find ZIP ${zip} — distance filter is off.`);
  }
  updateDistances();
  render();
}

async function loadList(id) {
  const list = state.lists.find((l) => l.id === id) || state.lists[0];
  state.list = list;
  store.set('lastList', list.id);
  const url = new URL(location.href); url.searchParams.set('list', list.id); history.replaceState(null, '', url);
  $('#listSelect').value = list.id;
  $('#editLink').href = `https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/lists/${list.id}.yaml`;

  state.ideas = []; state.skipped.clear(); state.wheelKey = ''; state.wheel = [];
  drawWheel();
  setStatus('Loading ideas…');
  let raw;
  try { raw = await loadYaml(`lists/${list.id}.yaml`); }
  catch (e) { setStatus(e.message); return; }
  const items = Array.isArray(raw) ? raw : raw?.ideas || [];
  state.ideas = items.map(normalize);
  setStatus('');

  const zip = store.get('zip:' + list.id, String(list.zip || ''));
  $('#zip').value = zip;
  await setOrigin(zip);
  geocodeIdeas();
}

function bindFilters() {
  const form = $('#filters');
  for (const [k, v] of Object.entries(state.filters)) {
    const el = form.elements[k];
    if (el) el.value = String(v);
  }
  const s = currentSeason();
  $('#nowSeasonLabel').textContent = `${SEASON_EMOJI[s]} Now (${s})`;
  form.addEventListener('change', (e) => {
    if (e.target.name === 'zip') return;
    state.filters = { when: form.elements.when.value, light: form.elements.light.value, season: form.elements.season.value, maxMiles: Number(form.elements.maxMiles.value) };
    store.set('filters', state.filters);
    state.skipped.clear();
    render();
  });
  $('#zip').addEventListener('input', (e) => {
    const z = e.target.value.replace(/\D/g, '').slice(0, 5);
    e.target.value = z;
    if (z.length === 5 && z !== state.zip) setOrigin(z);
  });
}

async function init() {
  bindFilters();
  sizeCanvas();
  addEventListener('resize', sizeCanvas);
  $('#spinBtn').addEventListener('click', spin);
  $('#rYes').addEventListener('click', () => { $('#result').close(); confetti(); });
  $('#rClose').addEventListener('click', () => $('#result').close());
  // Tapping the dimmed area outside the card also closes it.
  $('#result').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#rNo').addEventListener('click', () => {
    state.skipped.add(Number($('#result').dataset.id));
    $('#result').close();
    render();
    buildWheel(state.ideas.filter(matches), true);
    setTimeout(spin, 250);
  });

  try {
    const lists = await loadYaml('lists/lists.yaml');
    state.lists = (Array.isArray(lists) ? lists : []).filter((l) => l && l.id);
  } catch (e) { setStatus(e.message); return; }
  if (!state.lists.length) { setStatus('No lists yet — add one to lists/lists.yaml.'); return; }

  const sel = $('#listSelect');
  sel.replaceChildren(...state.lists.map((l) => Object.assign(document.createElement('option'), { value: l.id, textContent: l.name || l.id })));
  sel.addEventListener('change', () => loadList(sel.value));

  const wanted = new URLSearchParams(location.search).get('list') || store.get('lastList', null);
  await loadList(wanted);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
