// Wheel of Whimsy — static app for GitHub Pages.
// Lists live in lists/lists.yaml (the index) and lists/<id>.yaml (the ideas).
// Date history lives in Supabase, behind a passcode per list (see supabase/setup.sql).

const CONFIG = {
  repo: 'mattkrnr/dates',
  branch: 'main',
  maxSlices: 12,
  restDays: 30,        // a date done within this many days sits out of the wheel
  minPool: 3,          // ...unless that would leave fewer than this many on the wheel
  rainPct: 50, coldF: 40, hotF: 92,
  // Supabase project for date history. The key below is the public "publishable"/anon key,
  // which is safe to ship: the tables are locked and every function checks the list passcode.
  supabaseUrl: 'https://bkhhcsmbpnlgsnbzblov.supabase.co',
  supabaseKey: 'sb_publishable_JdJa4qMmvvrD96M3fDvbQA_WGQSvzfu',
};

const SEASONS = ['winter', 'spring', 'summer', 'fall'];
const SEASON_EMOJI = { winter: '❄️', spring: '🌷', summer: '☀️', fall: '🍂' };
const ENERGY = { chill: '🛋️ chill', medium: '🚶 medium', active: '🏃 active' };
const COLORS = ['#ff5d73', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];
const DEFAULT_COORDS = { lat: 40.35, lng: -74.66 }; // central NJ, only used for sunset before a ZIP is known

const $ = (s) => document.querySelector(s);

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const state = {
  lists: [],
  list: null,
  ideas: [],
  history: [],
  origin: null,
  zip: '',
  plan: ymd(new Date()),
  forecast: null,        // { zip, days: { 'YYYY-MM-DD': {...} } }
  filters: Object.assign(
    { when: 'any', light: 'any', season: 'now', budget: 'any', energy: 'any', maxMiles: 0 },
    store.get('filters', {}),
  ),
  wheel: [],
  wheelKey: '',
  skipped: new Set(),
  rotation: 0,
  spinning: false,
  stars: 0,
};

// ---------- date helpers ----------
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
function prettyDate(s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) { return parseYmd(s).toLocaleDateString('en-US', opts); }
function planLabel(s) {
  const today = ymd(new Date());
  if (s === today) return 'tonight';
  if (s === addDays(today, 1)) return 'tomorrow';
  return prettyDate(s);
}
function seasonOf(s) {
  const m = parseYmd(s).getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'fall';
}
function isWeekendDay(s) { const d = parseYmd(s).getDay(); return d === 0 || d === 5 || d === 6; } // Fri–Sun
function fmtTime(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase(); }

// Sunset (NOAA-style approximation, ±2 min). Returns a Date.
function computeSunset(dateStr, lat, lng) {
  const rad = Math.PI / 180;
  const J = new Date(dateStr + 'T12:00:00Z').getTime() / 86400000 + 2440587.5;
  const n = Math.round(J - 2451545.0 + 0.0008);
  const Js = n - lng / 360;
  const M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad;
  return new Date((Jt + H / 360 - 2440587.5) * 86400000);
}

// ---------- misc helpers ----------
function num(v) { const n = Number(v); return Number.isFinite(n) && v !== null && v !== '' ? n : null; }
function milesBetween(a, b) {
  const R = 3958.8, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function isHome(addr) { return !addr || String(addr).trim().toLowerCase() === 'home'; }
function el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; }
function starStr(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

function normalize(raw, i) {
  const when = String(raw.when || 'either').toLowerCase().replace(/s$/, '');
  let s = raw.season ?? 'any';
  if (!Array.isArray(s)) s = String(s).split(/[,/ ]+/);
  s = s.map((x) => String(x).toLowerCase().trim()).map((x) => (x === 'autumn' ? 'fall' : x)).filter(Boolean);
  const seasons = s.includes('any') || s.length === 0 ? new Set(SEASONS) : new Set(s.filter((x) => SEASONS.includes(x)));
  const yes = (v) => v === true || String(v).toLowerCase() === 'yes';
  let budget = null;
  if (raw.budget != null) {
    const b = String(raw.budget).trim();
    budget = /^\$+$/.test(b) ? Math.min(3, b.length) : (num(b) != null ? Math.max(1, Math.min(3, num(b))) : null);
    if (/free/i.test(b)) budget = 1;
  }
  const energy = String(raw.energy || '').toLowerCase();
  return {
    id: i,
    name: String(raw.name || 'Untitled date'),
    address: isHome(raw.address) ? 'home' : String(raw.address),
    when: when === 'weekend' || when === 'weeknight' ? when : 'either',
    daylight: yes(raw.daylight),
    outdoor: yes(raw.outdoor),
    budget,
    energy: ENERGY[energy] ? energy : null,
    seasons,
    notes: raw.notes ? String(raw.notes) : '',
    link: raw.link ? String(raw.link) : '',
    coords: num(raw.lat) != null && num(raw.lng) != null ? { lat: num(raw.lat), lng: num(raw.lng) } : null,
    geo: 'pending',
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
    if (run !== geoRun) return;
    setStatus(`Finding ${left} place${left === 1 ? '' : 's'} on the map…`);
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

// ---------- weather (Open-Meteo, free, no key, ~16 days out) ----------
const WX = [
  [[0], '☀️', 'clear'], [[1, 2], '🌤️', 'partly cloudy'], [[3], '☁️', 'cloudy'], [[45, 48], '🌫️', 'fog'],
  [[51, 53, 55, 56, 57], '🌦️', 'drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'rain'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'snow'], [[95, 96, 99], '⛈️', 'storms'],
];
function wxInfo(code) { const hit = WX.find(([codes]) => codes.includes(code)); return hit ? { icon: hit[1], text: hit[2] } : { icon: '🌡️', text: '' }; }

async function loadForecast() {
  if (!state.origin) { state.forecast = null; return; }
  if (state.forecast && state.forecast.zip === state.zip) return;
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: state.origin.lat.toFixed(3), longitude: state.origin.lng.toFixed(3),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset',
    temperature_unit: 'fahrenheit', timezone: 'auto', forecast_days: '16',
  });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const j = await res.json();
    const days = {};
    j.daily.time.forEach((t, i) => {
      days[t] = {
        code: j.daily.weather_code[i], hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]),
        rain: j.daily.precipitation_probability_max[i], sunset: j.daily.sunset[i],
      };
    });
    state.forecast = { zip: state.zip, days };
  } catch { state.forecast = { zip: state.zip, days: {} }; }
}

function dayWeather() { return state.forecast?.days?.[state.plan] || null; }

function sunsetForPlan() {
  const w = dayWeather();
  if (w?.sunset) { const [h, m] = w.sunset.slice(11, 16).split(':').map(Number); const d = parseYmd(state.plan); d.setHours(h, m); return d; }
  const c = state.origin || DEFAULT_COORDS;
  return computeSunset(state.plan, c.lat, c.lng);
}

// Warnings for an outdoor idea on the planned day ([] if fine or unknown).
function weatherWarnings(idea) {
  const w = dayWeather();
  if (!idea.outdoor || !w) return [];
  const out = [];
  if (w.rain != null && w.rain >= CONFIG.rainPct) out.push(`${wxInfo(w.code).icon} ${w.rain}% chance of ${w.code >= 71 && w.code <= 86 ? 'snow' : 'rain'}`);
  if (w.hi < CONFIG.coldF) out.push(`🥶 high of only ${w.hi}°`);
  if (w.hi > CONFIG.hotF) out.push(`🥵 high of ${w.hi}°`);
  return out;
}

function renderPlanInfo() {
  const sunset = sunsetForPlan();
  $('#darkLabel').textContent = `🌙 After sunset (${fmtTime(sunset)})`;
  const s = seasonOf(state.plan);
  $('#nowSeasonLabel').textContent = `${SEASON_EMOJI[s]} That day (${s})`;
  const w = dayWeather();
  const label = planLabel(state.plan);
  const head = label === 'tonight' ? 'Today' : label[0].toUpperCase() + label.slice(1);
  if (w) {
    const i = wxInfo(w.code);
    $('#forecast').textContent = `${head}: ${i.icon} ${w.hi}°/${w.lo}°, ${w.rain ?? 0}% precip · sunset ${fmtTime(sunset)}`;
  } else if (state.origin && daysBetween(ymd(new Date()), state.plan) > 15) {
    $('#forecast').textContent = `${head}: too far out for a forecast · sunset ${fmtTime(sunset)}`;
  } else {
    $('#forecast').textContent = `${head}: sunset ${fmtTime(sunset)}`;
  }
}

// ---------- planning date ----------
function buildPlanChips() {
  const today = ymd(new Date());
  const chips = [[today, 'Today'], [addDays(today, 1), 'Tomorrow']];
  const dow = new Date().getDay();
  const toSat = (6 - dow + 7) % 7;
  const sat = addDays(today, toSat <= 1 ? toSat + 7 : toSat);
  chips.push([sat, prettyDate(sat, { weekday: 'short', month: 'numeric', day: 'numeric' })]);
  const box = $('#planChips');
  box.replaceChildren(
    ...chips.map(([v, t]) => el('label', {}, el('input', { type: 'radio', name: 'plan', value: v }), el('span', { textContent: t }))),
    el('input', { type: 'date', id: 'planDate', className: 'plan-date', min: today, ariaLabel: 'Pick a date' }),
  );
  box.addEventListener('change', (e) => {
    if (e.target.id === 'planDate') { if (e.target.value) setPlan(e.target.value, true); }
    else if (e.target.name === 'plan') setPlan(e.target.value, true);
  });
  syncPlanChips();
}

function syncPlanChips() {
  let matched = false;
  document.querySelectorAll('#planChips input[name=plan]').forEach((r) => { r.checked = r.value === state.plan; matched ||= r.checked; });
  const pd = $('#planDate');
  pd.classList.toggle('active', !matched);
  if (!matched) pd.value = state.plan; else pd.value = '';
}

function setPlan(dateStr, userPicked) {
  state.plan = dateStr;
  syncPlanChips();
  const form = $('#filters');
  if (userPicked) {
    // Match "When" to the planned day; still changeable by hand.
    state.filters.when = isWeekendDay(dateStr) ? 'weekend' : 'weeknight';
    form.elements.when.value = state.filters.when;
    store.set('filters', state.filters);
  }
  autoLight();
  renderPlanInfo();
  state.skipped.clear();
  render();
}

// If we're planning for today and the sun is already down, flip on "After sunset".
function autoLight() {
  if (state.plan === ymd(new Date()) && new Date() >= sunsetForPlan()) {
    state.filters.light = 'dark';
    $('#filters').elements.light.value = 'dark';
  }
}

// ---------- history ----------
function lastDone(idea) {
  return state.history.filter((h) => h.idea === idea.name).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}
function isResting(idea) {
  const h = lastDone(idea);
  if (!h) return false;
  const gap = daysBetween(h.date, state.plan);
  return gap >= 0 && gap < CONFIG.restDays;
}

// ---------- Supabase (history storage) ----------
// Tables are locked; the app only calls passcode-checked functions (see supabase/setup.sql).
const sbReady = () => Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);
const passcode = () => (state.list ? store.get('code:' + state.list.id, '') : '');

class PasscodeError extends Error {}

async function rpc(fn, args) {
  if (!sbReady()) throw new Error("History storage isn't set up yet.");
  const headers = { apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' };
  if (CONFIG.supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${CONFIG.supabaseKey}`; // legacy anon keys
  const res = await fetch(`${CONFIG.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    if (/wrong passcode/i.test(j.message || '')) throw new PasscodeError('That passcode didn\'t work for this list.');
    throw new Error(`Couldn't reach the history service (${res.status}).`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

let historyRun = 0;
async function loadHistory() {
  const listId = state.list.id;
  const run = ++historyRun;
  const note = $('#histNote');
  if (!sbReady()) { note.textContent = "History storage isn't connected yet."; return; }
  if (!passcode()) { note.textContent = '🔒 Enter this list\'s passcode in ⚙️ Settings to see and log your dates.'; state.history = []; renderHistory(); render(); return; }
  try {
    const data = await rpc('get_history', { p_list: listId, p_code: passcode() });
    if (run !== historyRun || state.list.id !== listId) return;
    state.history = Array.isArray(data) ? data : [];
    store.set('historyCache:' + listId, state.history);
    note.textContent = '';
  } catch (e) {
    if (run !== historyRun) return;
    if (e instanceof PasscodeError) { note.textContent = '🔒 The saved passcode no longer works. Update it in ⚙️ Settings.'; state.history = []; }
    else { note.textContent = 'Offline: showing the last copy saved on this phone.'; state.history = store.get('historyCache:' + listId, []); }
  }
  renderHistory();
  renderReminder();
  render();
}

function renderHistory() {
  const list = [...state.history].sort((a, b) => b.date.localeCompare(a.date) || String(b.logged).localeCompare(String(a.logged)));
  $('#histCount').textContent = list.length ? `(${list.length})` : '';
  $('#historyList').replaceChildren(...list.map((h) => {
    const del = el('button', { className: 'del', type: 'button', textContent: '✕', title: 'Remove' });
    del.addEventListener('click', () => removeHistory(h));
    return el('li', {},
      del,
      el('div', { className: 'n', textContent: h.idea }),
      el('div', { className: 'm', textContent: `${prettyDate(h.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}${h.rating ? ' · ' + starStr(h.rating) : ''}` }),
      ...(h.note ? [el('div', { className: 'note', textContent: h.note })] : []),
    );
  }));
  if (!list.length && passcode()) $('#historyList').replaceChildren(el('li', { className: 'm', textContent: 'No dates logged yet.' }));

  const sel = $('#logIdea');
  const cur = sel.value;
  sel.replaceChildren(el('option', { value: '', textContent: 'Which date?' }),
    ...[...state.ideas].sort((a, b) => a.name.localeCompare(b.name)).map((i) => el('option', { value: i.name, textContent: i.name })));
  sel.value = cur;
}

function setStars(n) {
  state.stars = n;
  document.querySelectorAll('#logStars button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= n));
}

function openLog(ideaName, date) {
  const p = $('#historyPanel');
  p.open = true;
  $('#logIdea').value = ideaName || '';
  $('#logDate').value = date || ymd(new Date());
  setStars(0);
  $('#logNote').value = '';
  $('#logStatus').textContent = '';
  p.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function needPasscode(statusEl) {
  statusEl.textContent = 'Enter this list\'s passcode in ⚙️ Settings first.';
  document.querySelector('.settings').open = true;
}

async function saveLog() {
  const idea = $('#logIdea').value, date = $('#logDate').value;
  const status = $('#logStatus');
  if (!idea || !date) { status.textContent = 'Pick the date idea and the day you went.'; return; }
  if (!passcode()) { needPasscode(status); return; }
  const btn = $('#logSave');
  btn.disabled = true; status.textContent = 'Saving…';
  try {
    const row = await rpc('add_history', {
      p_list: state.list.id, p_code: passcode(), p_idea: idea, p_date: date,
      p_rating: state.stars || null, p_note: $('#logNote').value.trim(),
    });
    state.history = [...state.history, row];
    store.set('historyCache:' + state.list.id, state.history);
    const planned = store.get('planned:' + state.list.id, null);
    if (planned && planned.idea === idea) store.del('planned:' + state.list.id);
    status.textContent = 'Saved! 💕';
    $('#logNote').value = ''; setStars(0); $('#logIdea').value = '';
    renderHistory(); renderReminder(); render();
    confetti();
  } catch (e) {
    status.textContent = e instanceof PasscodeError ? e.message + ' Check it in ⚙️ Settings.' : e.message + ' Your entry wasn\'t saved — try again when you\'re online.';
  }
  btn.disabled = false;
}

async function removeHistory(h) {
  if (!passcode()) { needPasscode($('#logStatus')); return; }
  if (!confirm(`Remove "${h.idea}" on ${prettyDate(h.date)} from your history?`)) return;
  try {
    await rpc('delete_history', { p_list: state.list.id, p_code: passcode(), p_id: h.id });
    state.history = state.history.filter((x) => x.id !== h.id);
    store.set('historyCache:' + state.list.id, state.history);
    renderHistory(); render();
  } catch (e) { $('#logStatus').textContent = e.message; }
}

// "Up next" / "How was it?" banner, based on the last "Let's do it".
function renderReminder() {
  const box = $('#reminder');
  const p = state.list && store.get('planned:' + state.list.id, null);
  if (!p) { box.hidden = true; return; }
  const today = ymd(new Date());
  const logged = state.history.some((h) => h.idea === p.idea && h.date >= p.date);
  if (logged) { store.del('planned:' + state.list.id); box.hidden = true; return; }
  const dismiss = el('button', { className: 'dismiss', type: 'button', textContent: '✕', title: 'Dismiss' });
  dismiss.addEventListener('click', () => { store.del('planned:' + state.list.id); box.hidden = true; });
  if (p.date > today) {
    const n = daysBetween(today, p.date);
    box.replaceChildren(el('span', { textContent: `📅 Up next: ${p.idea}, ${n === 1 ? 'tomorrow' : prettyDate(p.date) + ` (in ${n} days)`}` }), dismiss);
  } else if (p.date === today) {
    box.replaceChildren(el('span', { textContent: `💕 Tonight: ${p.idea}` }), dismiss);
  } else {
    const log = el('button', { type: 'button', textContent: 'Log it' });
    log.addEventListener('click', () => openLog(p.idea, p.date));
    box.replaceChildren(el('span', { textContent: `How was ${p.idea}?` }), el('div', {}, log, dismiss));
  }
  box.hidden = false;
}

// ---------- filtering ----------
function matches(idea) {
  const f = state.filters;
  if (f.when !== 'any' && idea.when !== 'either' && idea.when !== f.when) return false;
  if (f.light === 'dark' && idea.daylight) return false;
  const season = f.season === 'now' ? seasonOf(state.plan) : f.season;
  if (season !== 'any' && !idea.seasons.has(season)) return false;
  if (f.budget !== 'any' && idea.budget != null && idea.budget > Number(f.budget)) return false;
  if (f.energy !== 'any' && idea.energy && idea.energy !== f.energy) return false;
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
  if (idea.budget) bits.push('$'.repeat(idea.budget));
  if (idea.energy) bits.push(ENERGY[idea.energy]);
  bits.push(idea.when === 'either' ? 'any night' : idea.when);
  bits.push(idea.daylight ? '☀️ needs daylight' : '🌙 works after dark');
  if (idea.outdoor) bits.push('🌳 outdoors');
  bits.push(idea.seasons.size === 4 ? 'all year' : [...idea.seasons].map((s) => SEASON_EMOJI[s] + ' ' + s).join(', '));
  return bits;
}

function wheelPool(matched) {
  let pool = matched.filter((i) => !state.skipped.has(i.id));
  if (pool.length === 0 && matched.length) { state.skipped.clear(); pool = matched; }
  const fresh = pool.filter((i) => !isResting(i));
  return fresh.length >= CONFIG.minPool ? fresh : pool;
}

function render() {
  const matched = state.ideas.filter(matches);
  $('#matchCount').textContent = `(${matched.length} of ${state.ideas.length} match)`;
  const pool = new Set(wheelPool(matched).map((i) => i.id));

  $('#ideaList').replaceChildren(...matched.map((idea) => {
    const h = lastDone(idea);
    const log = el('button', { className: 'log-btn', type: 'button', textContent: '✓ Did it' });
    log.addEventListener('click', () => openLog(idea.name, state.plan <= ymd(new Date()) ? state.plan : ymd(new Date())));
    const meta = el('div', { className: 'm', textContent: describe(idea).join(' · ') });
    const li = el('li', { className: pool.has(idea.id) ? '' : 'off' }, log, el('div', { className: 'n', textContent: idea.name }), meta);
    for (const w of weatherWarnings(idea)) li.append(' ', el('span', { className: 'warn', textContent: w }));
    if (h) li.append(el('div', { className: 'm', textContent: `Last went ${prettyDate(h.date, { month: 'short', day: 'numeric', year: 'numeric' })}${h.rating ? ' ' + starStr(h.rating) : ''}${isResting(idea) && !pool.has(idea.id) ? ' · resting' : ''}` }));
    return li;
  }));

  if (!state.spinning) buildWheel(matched);
}

function buildWheel(matched, reshuffle = false) {
  let pool = wheelPool(matched);
  const key = pool.map((i) => i.id).join(',');
  if (key === state.wheelKey && !reshuffle) return;
  state.wheelKey = key;
  if (pool.length > CONFIG.maxSlices) pool = [...pool].sort(() => Math.random() - 0.5).slice(0, CONFIG.maxSlices);
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
    let c = COLORS[i % COLORS.length];
    if (i === n - 1 && n > 1 && c === COLORS[0]) c = COLORS[3];
    ctx.fillStyle = n === 1 ? COLORS[0] : c;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = W * 0.004; ctx.stroke();

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
  const target = -Math.PI / 2 - (pick + 0.5) * arc + jitter;
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
  const label = planLabel(state.plan);
  $('#rKicker').textContent = label === 'tonight' ? "Tonight's date is…" : `Your date ${label === 'tomorrow' ? 'tomorrow' : 'on ' + label} is…`;
  $('#rName').textContent = idea.name;
  $('#rNotes').textContent = idea.notes;
  $('#rNotes').hidden = !idea.notes;
  $('#rTags').replaceChildren(...describe(idea).map((t) => el('span', { textContent: t })));
  const warns = weatherWarnings(idea);
  $('#rWeather').hidden = !warns.length;
  $('#rWeather').textContent = warns.length ? `Heads up for ${label}: ${warns.join(', ')}` : '';
  const h = lastDone(idea);
  $('#rHistory').hidden = !h;
  if (h) $('#rHistory').textContent = `Last time: ${prettyDate(h.date, { month: 'short', day: 'numeric', year: 'numeric' })}${h.rating ? ' ' + starStr(h.rating) : ''}${h.note ? ` — "${h.note}"` : ''}`;
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
  await loadForecast();
  autoLight();
  renderPlanInfo();
  render();
}

async function loadList(id) {
  const list = state.lists.find((l) => l.id === id) || state.lists[0];
  state.list = list;
  store.set('lastList', list.id);
  const url = new URL(location.href); url.searchParams.set('list', list.id); history.replaceState(null, '', url);
  $('#listSelect').value = list.id;
  $('#editLink').href = `https://github.com/${CONFIG.repo}/edit/${CONFIG.branch}/lists/${list.id}.yaml`;
  $('#codeFor').textContent = list.name || list.id;
  $('#codeStatus').textContent = store.get('code:' + list.id, '') ? '✓ Unlocked on this phone.' : '';

  state.ideas = []; state.history = store.get('historyCache:' + list.id, []);
  state.skipped.clear(); state.wheelKey = ''; state.wheel = [];
  drawWheel();
  setStatus('Loading ideas…');
  let raw;
  try { raw = await loadYaml(`lists/${list.id}.yaml`); }
  catch (e) { setStatus(e.message); return; }
  const items = Array.isArray(raw) ? raw : raw?.ideas || [];
  state.ideas = items.map(normalize);
  setStatus('');
  renderHistory();
  renderReminder();

  const zip = store.get('zip:' + list.id, String(list.zip || ''));
  $('#zip').value = zip;
  loadHistory();
  await setOrigin(zip);
  geocodeIdeas();
}

function bindFilters() {
  const form = $('#filters');
  for (const [k, v] of Object.entries(state.filters)) {
    const field = form.elements[k];
    if (field) field.value = String(v);
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'zip') return;
    const f = form.elements;
    state.filters = { when: f.when.value, light: f.light.value, season: f.season.value, budget: f.budget.value, energy: f.energy.value, maxMiles: Number(f.maxMiles.value) };
    store.set('filters', state.filters);
    state.skipped.clear();
    render();
  });
  $('#zip').addEventListener('input', (e) => {
    const z = e.target.value.replace(/\D/g, '').slice(0, 5);
    e.target.value = z;
    if (z.length === 5 && z !== state.zip) { state.forecast = null; setOrigin(z); }
  });
}

function bindHistoryAndSettings() {
  document.querySelectorAll('#logStars button').forEach((b) => b.addEventListener('click', () => setStars(Number(b.dataset.v) === state.stars ? 0 : Number(b.dataset.v))));
  $('#logDate').max = ymd(new Date());
  $('#logDate').value = ymd(new Date());
  $('#logSave').addEventListener('click', saveLog);

  $('#codeSave').addEventListener('click', async () => {
    const code = $('#code').value.trim();
    const st = $('#codeStatus');
    const id = state.list.id;
    if (!code) { store.del('code:' + id); st.textContent = 'Passcode removed from this phone.'; loadHistory(); return; }
    st.textContent = 'Checking…';
    try {
      const ok = await rpc('check_code', { p_list: id, p_code: code });
      if (ok) { store.set('code:' + id, code); st.textContent = '✓ Unlocked. This phone can now see and log dates for this list.'; $('#code').value = ''; loadHistory(); }
      else st.textContent = "That passcode doesn't match this list.";
    } catch (e) { st.textContent = e.message; }
  });
  // Pick up dates the other phone logged when this app comes back to the foreground.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.list) loadHistory(); });
}

async function init() {
  bindFilters();
  bindHistoryAndSettings();
  buildPlanChips();
  autoLight();
  renderPlanInfo();
  sizeCanvas();
  addEventListener('resize', sizeCanvas);
  $('#spinBtn').addEventListener('click', spin);
  $('#rYes').addEventListener('click', () => {
    const idea = state.ideas.find((i) => i.id === Number($('#result').dataset.id));
    if (idea) store.set('planned:' + state.list.id, { idea: idea.name, date: state.plan });
    $('#result').close();
    renderReminder();
    confetti();
  });
  $('#rClose').addEventListener('click', () => $('#result').close());
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
  sel.replaceChildren(...state.lists.map((l) => el('option', { value: l.id, textContent: l.name || l.id })));
  sel.addEventListener('change', () => loadList(sel.value));

  const wanted = new URLSearchParams(location.search).get('list') || store.get('lastList', null);
  await loadList(wanted);
}

// Back arrow to the apps homepage — shown only when this tab was opened from it (?from=home).
(function homeBack() {
  const url = new URL(location.href);
  if (url.searchParams.get('from') === 'home') {
    try { sessionStorage.setItem('fromHome', '1'); } catch (_) {}
    url.searchParams.delete('from');
    history.replaceState(null, '', url);
  }
  let fromHome = false;
  try { fromHome = sessionStorage.getItem('fromHome') === '1'; } catch (_) {}
  const link = document.getElementById('homeBack');
  if (fromHome && link) link.hidden = false;
})();

// ---------- app updates + pull to refresh ----------
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  // When a new version of the app takes over, reload once so the new code runs.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  });
}

async function hardRefresh() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch { /* offline */ }
  location.reload();
}

(function pullToRefresh() {
  const bar = $('#ptr'), label = $('#ptrText');
  const THRESHOLD = 80;
  let startY = null, pulling = false, dist = 0;
  const blocked = () => state.spinning || $('#result').open || window.scrollY > 0;
  const show = (d) => {
    const y = Math.min(d, 120) - 60;
    bar.style.transform = `translate(-50%, ${y}px)`;
    bar.style.opacity = String(Math.min(1, d / 50));
    const ready = d >= THRESHOLD;
    bar.classList.toggle('ready', ready);
    label.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
  };
  const reset = () => { bar.style.transition = 'transform .2s, opacity .2s'; bar.style.transform = 'translate(-50%, -60px)'; bar.style.opacity = '0'; setTimeout(() => { bar.style.transition = ''; }, 220); };
  addEventListener('touchstart', (e) => {
    if (blocked() || e.touches.length !== 1) { startY = null; return; }
    startY = e.touches[0].clientY; pulling = false; dist = 0;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dist = (e.touches[0].clientY - startY) * 0.6;
    if (dist > 8 && window.scrollY <= 0) { pulling = true; show(dist); }
    else if (pulling && dist <= 8) { pulling = false; reset(); }
  }, { passive: true });
  addEventListener('touchend', () => {
    if (pulling && dist >= THRESHOLD) {
      bar.classList.add('loading'); label.textContent = 'Refreshing…';
      bar.style.transform = 'translate(-50%, 16px)';
      hardRefresh();
    } else if (pulling) reset();
    startY = null; pulling = false;
  }, { passive: true });
})();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
