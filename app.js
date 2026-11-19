/* Retro Radio — internet radio with a vintage analog radio interface.
   Station data: Radio Browser (free, open community directory, no API key).
   Curated South African list: stations-za.json */
'use strict';

const APP_VERSION = '1.1.0';
const PAGES_URL = 'https://m9r1u5.github.io/Radio/';
const APK_URL = 'https://github.com/m9r1u5/Radio/releases/latest/download/RetroRadio.apk';
const HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
const API_HOSTS = ['de1.api.radio-browser.info', 'fi1.api.radio-browser.info', 'nl1.api.radio-browser.info',
  'at1.api.radio-browser.info', 'de2.api.radio-browser.info', 'all.api.radio-browser.info'];
const CACHE_DAYS = 7;
const DEAD_DAYS = 3;
const FM_MIN = 87.5, FM_MAX = 108;

const IS_NATIVE = !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : window.Capacitor.isNative));
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const ZA_PROVINCES = ['Gauteng', 'KwaZulu-Natal', 'Western Cape', 'Eastern Cape', 'Free State',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'National'];
// normalised words -> province (checked with "includes", longest keys first)
const ZA_STATE_WORDS = {
  gauteng: 'Gauteng', johannesburg: 'Gauteng', joburg: 'Gauteng', jhb: 'Gauteng', pretoria: 'Gauteng', tshwane: 'Gauteng',
  soweto: 'Gauteng', sandton: 'Gauteng', randburg: 'Gauteng', midrand: 'Gauteng', centurion: 'Gauteng', ekurhuleni: 'Gauteng', vereeniging: 'Gauteng',
  kwazulunatal: 'KwaZulu-Natal', kwazulu: 'KwaZulu-Natal', kzn: 'KwaZulu-Natal', natal: 'KwaZulu-Natal', durban: 'KwaZulu-Natal',
  pietermaritzburg: 'KwaZulu-Natal', richardsbay: 'KwaZulu-Natal', newcastle: 'KwaZulu-Natal', umhlanga: 'KwaZulu-Natal',
  westerncape: 'Western Cape', westkaap: 'Western Cape', capetown: 'Western Cape', kaapstad: 'Western Cape', stellenbosch: 'Western Cape',
  george: 'Western Cape', paarl: 'Western Cape', worcester: 'Western Cape',
  easterncape: 'Eastern Cape', oostkaap: 'Eastern Cape', portelizabeth: 'Eastern Cape', gqeberha: 'Eastern Cape', eastlondon: 'Eastern Cape', mthatha: 'Eastern Cape',
  freestate: 'Free State', vrystaat: 'Free State', bloemfontein: 'Free State', welkom: 'Free State',
  limpopo: 'Limpopo', polokwane: 'Limpopo', northernprovince: 'Limpopo',
  mpumalanga: 'Mpumalanga', nelspruit: 'Mpumalanga', mbombela: 'Mpumalanga', witbank: 'Mpumalanga', emalahleni: 'Mpumalanga',
  northwest: 'North West', noordwes: 'North West', rustenburg: 'North West', potchefstroom: 'North West', mahikeng: 'North West', mafikeng: 'North West',
  northerncape: 'Northern Cape', noordkaap: 'Northern Cape', kimberley: 'Northern Cape', upington: 'Northern Cape',
  national: 'National', nationwide: 'National'
};
const ZA_WORD_KEYS = Object.keys(ZA_STATE_WORDS).sort((a, b) => b.length - a.length);

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('rr_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rr_' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('rr_' + k); } catch (e) { } }
};
function freqLabel(st) { return st.freq ? Number(st.freq).toFixed(1) : (st.band || ''); }
function titleCase(s) { return String(s).toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }
function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }
function lev(a, b) {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------- Radio Browser API ---------------- */
let apiHost = store.get('apiHost', null);
async function fetchT(url, ms = 9000, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: ctl.signal }, opts)); } finally { clearTimeout(t); }
}
async function api(path) {
  const hosts = apiHost ? [apiHost, ...API_HOSTS.filter(h => h !== apiHost)] : API_HOSTS.slice();
  let lastErr;
  for (const h of hosts) {
    try {
      const r = await fetchT('https://' + h + path);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (h !== apiHost) { apiHost = h; store.set('apiHost', h); }
      return j;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('API unreachable');
}
function slim(s) {
  return {
    id: s.stationuuid, name: (s.name || '').trim(), url: s.url_resolved || s.url, hls: !!s.hls,
    favicon: s.favicon || '', cc: (s.countrycode || '').toUpperCase(), country: s.country || '',
    state: (s.state || '').trim(), tags: s.tags || '', codec: s.codec || '', freq: null, region: null
  };
}
function regionFor(st) {
  if (st.cc === 'ZA') {
    const k = norm(st.state);
    if (k) for (const w of ZA_WORD_KEYS) if (k.includes(w)) return ZA_STATE_WORDS[w];
    return 'Other';
  }
  return st.state ? titleCase(st.state) : 'All';
}
// pull a frequency out of a station name, e.g. "Jozi FM 105.8" -> 105.8
function guessFreq(name) {
  const m = String(name).match(/(?:^|[^\d.])((?:8[89]|9\d|10[0-8])[.,]\d)(?!\d)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

/* ---------------- state ---------------- */
const S = {
  countries: [], ci: 0,
  regions: [], ri: 0,
  list: [], ti: 0,
  power: false,
  volume: store.get('volume', 0.6),
  current: null,
  scanning: false,
  settings: Object.assign({ static: true, light: 'amber' }, store.get('settings', {}))
};
const countryData = {}; // code -> { all:[], byRegion:{}, regions:[] }
let curated = null;

/* ---------------- dial ---------------- */
function buildScale() {
  const put = (row, labels, min, max) => {
    row.innerHTML = labels.map(v => `<span style="left:${((v - min) / (max - min) * 92 + 4).toFixed(2)}%">${v}</span>`).join('');
  };
  put($('rowSW'), [3.0, 4.5, 6.0, 7.5, 9.0, 10.5, 12], 2.5, 12.5);
  put($('rowAM'), [530, 700, 900, 1100, 1300, 1600], 500, 1650);
  $('rowFM').innerHTML = [88, 92, 96, 100, 104, 108].map(v => `<span style="left:${posToPct(fmPos(v))}%">${v}</span>`).join('');
  let ticks = '';
  for (let f = 88; f <= 108; f += 1) ticks += `<i style="left:${posToPct(fmPos(f))}%;height:${f % 4 === 0 ? 8 : 4}px"></i>`;
  $('ticks').innerHTML = ticks;
}
const fmPos = f => clamp((f - FM_MIN) / (FM_MAX - FM_MIN), 0, 1);
const posToPct = p => (p * 92 + 4).toFixed(2);
function layoutDial(list) {
  const nofreq = list.filter(s => !s.freq);
  nofreq.forEach((s, i) => { s._pos = (i + 0.5) / nofreq.length; });
  list.forEach(s => { if (s.freq) s._pos = fmPos(s.freq); });
  list.sort((a, b) => a._pos - b._pos || a.name.localeCompare(b.name));
  return list;
}
function setNeedle(pos) { $('needle').style.left = posToPct(pos == null ? 0.02 : pos) + '%'; }

/* ---------------- countries & stations ---------------- */
async function loadCurated() {
  if (curated) return curated;
  try {
    const r = await fetch('stations-za.json', { cache: 'no-cache' });
    const j = await r.json();
    curated = (j.stations || []).map((c, i) => ({
      id: 'za-' + norm(c.name) || 'za-' + i, name: c.name, url: c.url || '', hls: /\.m3u8/i.test(c.url || ''),
      favicon: '', cc: 'ZA', country: 'South Africa', state: c.province, region: c.province,
      freq: c.freq || null, band: c.band || '', aliases: c.aliases || [], curated: true, verify: !!c.verify
    }));
  } catch (e) { curated = []; }
  const resolved = store.get('resolved', {});
  curated.forEach(c => { const r = resolved[c.id]; if (!c.url && r) Object.assign(c, r); });
  return curated;
}

async function loadCountries() {
  const cached = store.get('countries', null);
  if (cached && Date.now() - cached.ts < CACHE_DAYS * 864e5) return cached.list;
  try {
    const j = await api('/json/countries?hidebroken=true');
    const list = j.filter(c => c.stationcount >= 3 && c.iso_3166_1)
      .map(c => ({ code: c.iso_3166_1.toUpperCase(), name: c.name.replace(/^The /, '') }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.find(c => c.code === 'ZA')) list.push({ code: 'ZA', name: 'South Africa' });
    store.set('countries', { ts: Date.now(), list });
    return list;
  } catch (e) {
    return (cached && cached.list) || [{ code: 'ZA', name: 'South Africa' }];
  }
}

async function loadCountry(code) {
  if (countryData[code]) return countryData[code];
  let raw = null;
  const cached = store.get('cc_' + code, null);
  if (cached && Date.now() - cached.ts < CACHE_DAYS * 864e5) raw = cached.list;
  if (!raw) {
    try {
      const j = await api(`/json/stations/search?countrycode=${code}&hidebroken=true&order=clickcount&reverse=true&limit=1200`);
      raw = j.map(slim).filter(s => s.url && s.name);
      store.set('cc_' + code, { ts: Date.now(), list: raw });
    } catch (e) {
      raw = (cached && cached.list) || [];
    }
  }
  let all = raw.map(s => Object.assign({}, s));
  all.forEach(s => { s.region = regionFor(s); s.freq = guessFreq(s.name); });

  if (code === 'ZA') {
    const cur = (await loadCurated()).map(c => Object.assign({}, c));
    const used = new Set();
    for (const c of cur) {
      const keys = [norm(c.name), ...c.aliases.map(norm)].filter(k => k.length >= 2);
      let match = all.find(s => !used.has(s.id) && keys.includes(norm(s.name)));
      if (!match) match = all.find(s => !used.has(s.id) && keys.some(k => k.length >= 3 && norm(s.name).startsWith(k)));
      if (match) {
        used.add(match.id);
        if (!c.url) { c.url = match.url; c.hls = match.hls; }
        c.favicon = match.favicon; c.apiId = match.id;
      }
    }
    // drop API duplicates of curated stations (keep other versions of the same brand out of the way)
    all = all.filter(s => !used.has(s.id));
    all = cur.concat(all);
  }

  const byRegion = {};
  let regions;
  if (code === 'ZA') {
    regions = ZA_PROVINCES.slice();
    if (all.some(s => s.region === 'Other')) regions.push('Other');
    regions.forEach(r => { byRegion[r] = []; });
    all.forEach(s => { (byRegion[s.region] || (byRegion[s.region] = [])).push(s); });
  } else {
    byRegion.All = all.slice();
    const states = {};
    all.forEach(s => { if (s.region !== 'All') (states[s.region] = states[s.region] || []).push(s); });
    regions = ['All', ...Object.keys(states).sort((a, b) => a.localeCompare(b))];
    Object.assign(byRegion, states);
  }
  Object.keys(byRegion).forEach(r => layoutDial(byRegion[r]));
  return (countryData[code] = { code, all, byRegion, regions });
}

/* ---------------- dead stations ---------------- */
let dead = store.get('dead', {});
const isDead = st => st && dead[st.id] && Date.now() - dead[st.id] < DEAD_DAYS * 864e5;
function markDead(st) { dead[st.id] = Date.now(); store.set('dead', dead); }
function markAlive(st) { if (dead[st.id]) { delete dead[st.id]; store.set('dead', dead); } }

/* ---------------- UI text ---------------- */
function country() { return S.countries[S.ci] || { code: 'ZA', name: 'South Africa' }; }
function updateWhere() {
  const r = S.regions[S.ri];
  $('where').textContent = country().name + (r ? ' · ' + r : '');
}
function showStation(st) {
  const fl = st ? freqLabel(st) : '';
  const showF = fl && !digits(st.name).includes(digits(fl).replace(/0$/, ''));
  $('stationName').textContent = st ? st.name + (showF ? '  ' + fl : '') : '— no stations here —';
  setNeedle(st ? st._pos : null);
  updateFavBtn();
}
function setStatus(txt, bad) { const el = $('status'); el.textContent = txt || ''; el.classList.toggle('bad', !!bad); }

/* ---------------- static noise (Web Audio) ---------------- */
let ac = null, noiseGain = null;
function ensureAudioCtx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let env = 0.6;
    for (let i = 0; i < len; i++) {
      if (i % 600 === 0) env = 0.45 + Math.random() * 0.55;
      let v = (Math.random() * 2 - 1) * env;
      if (Math.random() < 0.00025) v = (Math.random() < .5 ? -1 : 1) * 0.95; // crackle
      d[i] = v;
    }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
    noiseGain = ac.createGain(); noiseGain.gain.value = 0;
    src.connect(bp); bp.connect(lp); lp.connect(noiseGain); noiseGain.connect(ac.destination);
    src.start();
  }
  if (ac.state === 'suspended') ac.resume().catch(() => { });
  return ac;
}
function staticTo(level, tc = 0.08) {
  if (!ac || !noiseGain) return;
  const v = S.settings.static && S.power ? level * Math.pow(S.volume, 1.5) * 0.45 : 0;
  noiseGain.gain.cancelScheduledValues(ac.currentTime);
  noiseGain.gain.setTargetAtTime(v, ac.currentTime, tc);
}

/* ---------------- stream playback ---------------- */
const audio = new Audio();
audio.preload = 'none';
audio.setAttribute('playsinline', '');
let hls = null, hlsLoading = null, playToken = 0, tuneTimer = null, fadeTimer = null;

function loadHlsLib() {
  if (window.Hls) return Promise.resolve();
  if (hlsLoading) return hlsLoading;
  hlsLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = HLS_JS; s.onload = res; s.onerror = () => { hlsLoading = null; rej(new Error('hls.js')); };
    document.head.appendChild(s);
  });
  return hlsLoading;
}
function stopStream() {
  clearInterval(fadeTimer);
  if (hls) { try { hls.destroy(); } catch (e) { } hls = null; }
  try { audio.pause(); } catch (e) { }
  audio.removeAttribute('src');
  try { audio.load(); } catch (e) { }
}
function setAudioVolume(v) { if (!IS_IOS) audio.volume = clamp(v, 0, 1); }
function fadeIn() {
  if (IS_IOS) return;
  clearInterval(fadeTimer);
  let v = 0; audio.volume = 0;
  fadeTimer = setInterval(() => { v += 0.08; audio.volume = clamp(Math.min(v, S.volume), 0, 1); if (v >= S.volume) clearInterval(fadeTimer); }, 50);
}

async function resolveUrl(st) {
  if (st.url) return st.url;
  const tries = [st.name, ...(st.aliases || []).filter(a => a.length > 2 && !/^[\d.]+$/.test(a)).slice(0, 2)];
  for (const q of tries) {
    try {
      const j = await api(`/json/stations/byname/${encodeURIComponent(q)}?hidebroken=true&order=clickcount&reverse=true&limit=15`);
      const list = j.map(slim).filter(s => s.url);
      const pick = list.find(s => s.cc === (st.cc || 'ZA')) || null;
      if (pick) {
        st.url = pick.url; st.hls = pick.hls; st.favicon = st.favicon || pick.favicon; st.apiId = pick.id;
        if (st.curated) { const r = store.get('resolved', {}); r[st.id] = { url: st.url, hls: st.hls, favicon: st.favicon, apiId: st.apiId }; store.set('resolved', r); }
        return st.url;
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

function waitForPlay(token, ms = 13000) {
  return new Promise(resolve => {
    let done = false;
    const finish = ok => { if (done) return; done = true; cleanup(); resolve(ok); };
    const onPlay = () => finish(true);
    const onErr = () => finish(false);
    const t = setTimeout(() => finish(false), ms);
    const iv = setInterval(() => { if (token !== playToken) finish(null); }, 200);
    function cleanup() { clearTimeout(t); clearInterval(iv); audio.removeEventListener('playing', onPlay); audio.removeEventListener('error', onErr); }
    audio.addEventListener('playing', onPlay); audio.addEventListener('error', onErr);
  });
}

async function playStream(st) {
  const token = ++playToken;
  stopStream();
  if (!S.power) return false;
  if (!navigator.onLine) { setStatus('NO SIGNAL — no internet connection', true); staticTo(0.6); return false; }
  setStatus('Tuning…');
  const url = await resolveUrl(st);
  if (token !== playToken) return null;
  if (!url) { setStatus('No signal — stream not found', true); markDead(st); staticTo(0.35); return false; }

  try {
    const isHls = st.hls || /\.m3u8(\?|$)/i.test(url);
    if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
      await loadHlsLib();
      if (token !== playToken) return null;
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ lowLatencyMode: false });
        hls.loadSource(url); hls.attachMedia(audio);
        hls.on(window.Hls.Events.ERROR, (e, d) => { if (d.fatal) audio.dispatchEvent(new Event('error')); });
      } else audio.src = url;
    } else {
      audio.src = url;
    }
    setAudioVolume(0);
    const p = audio.play(); if (p && p.catch) p.catch(() => { });
  } catch (e) { /* handled below by timeout/error */ }

  const ok = await waitForPlay(token);
  if (ok === null || token !== playToken) return null;
  if (ok) {
    markAlive(st);
    fadeIn();
    staticTo(0, 0.25);
    setStatus(st.curated && st.verify ? 'On air · frequency not verified' : 'On air');
    addRecent(st);
    pingClick(st);
    updateMediaSession(st);
    nativeStart(st);
    return true;
  }
  stopStream();
  markDead(st);
  setStatus('No signal — station off air', true);
  staticTo(0.3);
  return false;
}
function pingClick(st) { const id = st.apiId || (st.curated ? null : st.id); if (id) api('/json/url/' + id).catch(() => { }); }

audio.addEventListener('waiting', () => { if (S.power && S.current) setStatus('Buffering…'); });
audio.addEventListener('playing', () => { if (S.power && S.current && $('status').textContent === 'Buffering…') setStatus('On air'); });
audio.addEventListener('stalled', () => { if (S.power && S.current && !audio.paused) setStatus('Weak signal…'); });

// called when the needle lands on a station: static now, stream after the knob settles
function tuneTo(st, immediate) {
  S.current = st || null;
  showStation(st);
  saveSpot();
  clearTimeout(tuneTimer);
  if (!S.power) return;
  playToken++; stopStream();
  if (!st) { setStatus('No stations in this region', true); staticTo(0.5); return; }
  staticTo(0.75, 0.03);
  setStatus('…');
  tuneTimer = setTimeout(async () => {
    const ok = await playStream(st);
    if (ok === false && S.scanning) scanStep();
    if (ok === true && S.scanning) stopScan();
  }, immediate ? 50 : 450);
}

/* ---------------- tuning, regions, countries ---------------- */
function stepIndex(list, from, dir) {
  if (!list.length) return -1;
  for (let k = 1; k <= list.length; k++) {
    const i = (from + dir * k + list.length * k) % list.length;
    if (!isDead(list[i])) return i;
  }
  return (from + dir + list.length) % list.length;
}
function tune(dir) {
  if (!S.list.length) { tuneTo(null); return; }
  S.ti = stepIndex(S.list, S.ti, dir);
  tuneTo(S.list[S.ti]);
}
function selectRegion(i, opts = {}) {
  const cd = countryData[country().code];
  if (!cd) return;
  S.ri = (i + S.regions.length) % S.regions.length;
  S.list = cd.byRegion[S.regions[S.ri]] || [];
  updateWhere();
  if (opts.station) {
    let idx = S.list.findIndex(s => s.id === opts.station.id || (s.apiId && s.apiId === opts.station.id) || norm(s.name) === norm(opts.station.name));
    if (idx < 0) { S.list.push(opts.station); layoutDial(S.list); idx = S.list.indexOf(opts.station); }
    S.ti = idx;
  } else {
    S.ti = 0;
    if (S.list.length && isDead(S.list[0])) S.ti = stepIndex(S.list, 0, 1);
  }
  tuneTo(S.list[S.ti] || null, opts.immediate);
}
function region(dir) { if (S.regions.length) selectRegion(S.ri + dir); }

let countryTimer = null;
function countryStep(dir) {
  if (!S.countries.length) return;
  S.ci = (S.ci + dir + S.countries.length) % S.countries.length;
  S.regions = []; updateWhere();
  $('stationName').textContent = country().name.toUpperCase();
  setStatus('Loading stations…');
  playToken++; stopStream(); if (S.power) staticTo(0.5);
  clearTimeout(countryTimer);
  countryTimer = setTimeout(() => openCountry(country().code), 650);
}
async function openCountry(code, opts = {}) {
  const ci = S.countries.findIndex(c => c.code === code);
  if (ci >= 0) S.ci = ci;
  setStatus('Loading stations…');
  const cd = await loadCountry(code);
  if (country().code !== code) return; // user moved on
  S.regions = cd.regions;
  let ri = 0;
  if (opts.region) ri = Math.max(0, S.regions.indexOf(opts.region));
  else if (code === 'ZA') ri = Math.max(0, S.regions.indexOf(store.get('lastZARegion', 'Gauteng')));
  if (!cd.all.length) { updateWhere(); tuneTo(null); setStatus(navigator.onLine ? 'No stations found' : 'NO SIGNAL — offline', true); return; }
  selectRegion(ri, opts);
}
function saveSpot() {
  const c = country();
  store.set('spot', { cc: c.code, region: S.regions[S.ri], station: S.current ? { id: S.current.id, name: S.current.name } : null });
  if (c.code === 'ZA' && S.regions[S.ri]) store.set('lastZARegion', S.regions[S.ri]);
}

/* ---------------- power & volume ---------------- */
function powerOn() {
  if (S.power) return;
  S.power = true; document.body.classList.remove('off');
  ensureAudioCtx();
  if (!S.current && S.list.length) S.current = S.list[S.ti];
  tuneTo(S.current, true);
}
function powerOff() {
  if (!S.power) return;
  S.power = false; document.body.classList.add('off');
  playToken++; clearTimeout(tuneTimer); stopStream(); stopScan();
  staticTo(0);
  setStatus('Turn VOLUME to switch on');
  if (ac) setTimeout(() => { if (!S.power && ac) ac.suspend().catch(() => { }); }, 300);
  nativeStop();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
}
function setVolume(v) {
  S.volume = clamp(v, 0, 1); store.set('volume', S.volume);
  if (S.volume < 0.04) { powerOff(); return; }
  if (!S.power) powerOn();
  setAudioVolume(S.volume);
  if (noiseGain && ac) staticTo(noiseGain.gain.value > 0.001 ? 0.6 : 0);
}

/* ---------------- scan ---------------- */
function scanStep() {
  if (!S.scanning) return;
  if (++S.scanCount > S.list.length) { stopScan(); setStatus('Scan finished — nothing playing here', true); return; }
  tune(1);
}
function startScan() {
  if (!S.list.length) return;
  if (!S.power) { setVolume(Math.max(S.volume, 0.5)); knobs.vol.setAngle(volToAngle(S.volume)); }
  S.scanning = true; S.scanCount = 0; $('btnScan').classList.add('on');
  scanStep();
}
function stopScan() { S.scanning = false; $('btnScan').classList.remove('on'); }

/* ---------------- knobs ---------------- */
function makeKnob(el, { onStep, onLong, stepDeg = 30, continuous = null }) {
  let angle = 0, acc = 0, last = null, start = null, moved = 0, longT = null, down = false;
  const center = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const ang = (e, c) => Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
  const render = () => { el.style.transform = `rotate(${angle}deg)`; };
  let c;
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); ensureAudioCtx();
    down = true; c = center(); last = ang(e, c); start = { x: e.clientX, y: e.clientY, t: Date.now() }; moved = 0; acc = 0;
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    if (onLong) longT = setTimeout(() => { longT = null; if (moved < 8) { down = false; el.classList.remove('dragging'); vibrate(20); onLong(); } }, 600);
  });
  el.addEventListener('pointermove', e => {
    if (!down) return;
    moved = Math.max(moved, Math.hypot(e.clientX - start.x, e.clientY - start.y));
    if (moved < 6) return;
    if (longT) { clearTimeout(longT); longT = null; }
    const a = ang(e, c); let d = a - last; if (d > 180) d -= 360; if (d < -180) d += 360; last = a;
    if (continuous) {
      angle = clamp(angle + d, continuous.min, continuous.max); render(); continuous.onAngle(angle);
    } else {
      angle += d; acc += d; render();
      while (Math.abs(acc) >= stepDeg) { const s = Math.sign(acc); acc -= s * stepDeg; vibrate(6); onStep(s); }
    }
  });
  const up = e => {
    if (!down) return; down = false; el.classList.remove('dragging');
    if (longT) { clearTimeout(longT); longT = null; }
    if (moved < 6 && Date.now() - start.t < 600) { // tap: right half = forward, left half = back
      const dir = e.clientX >= c.x ? 1 : -1;
      if (continuous) { angle = clamp(angle + dir * 27, continuous.min, continuous.max); render(); continuous.onAngle(angle); }
      else { angle += dir * stepDeg; render(); vibrate(6); onStep(dir); }
    } else if (!continuous) { // snap to the step grid
      angle -= acc; acc = 0; render();
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => {
    e.preventDefault(); const dir = e.deltaY > 0 ? -1 : 1; ensureAudioCtx();
    if (continuous) { angle = clamp(angle + dir * 13.5, continuous.min, continuous.max); render(); continuous.onAngle(angle); }
    else { angle += dir * stepDeg; render(); onStep(dir); }
  }, { passive: false });
  return {
    turn(steps) { angle += steps * stepDeg; render(); },
    setAngle(a) { angle = a; render(); }
  };
}
const VOL_MIN = -140, VOL_MAX = 140;
const volToAngle = v => VOL_MIN + v * (VOL_MAX - VOL_MIN);
const knobs = {};
function setupKnobs() {
  knobs.country = makeKnob($('knobCountry'), { stepDeg: 24, onStep: countryStep, onLong: pickCountry });
  knobs.region = makeKnob($('knobRegion'), { stepDeg: 30, onStep: region, onLong: pickRegion });
  knobs.tune = makeKnob($('knobTune'), { stepDeg: 22, onStep: d => { stopScan(); tune(d); } });
  knobs.vol = makeKnob($('knobVol'), {
    continuous: { min: VOL_MIN, max: VOL_MAX, onAngle: a => setVolume((a - VOL_MIN) / (VOL_MAX - VOL_MIN)) }
  });
  knobs.vol.setAngle(VOL_MIN); // radio starts switched off
}

/* ---------------- sheets ---------------- */
function openSheet(id) { document.querySelectorAll('.sheet').forEach(s => { s.hidden = s.id !== id; }); }
function closeSheets() { document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; }); }
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheets(); });

function stationLi(st, extra = '') {
  const img = st.favicon ? `<img src="${esc(st.favicon)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'📻'}))">` : '<div class="ph">📻</div>';
  const meta = [st.region && st.region !== 'All' && st.region !== 'Other' ? st.region : '', st.country || st.cc].filter(Boolean).join(' · ');
  return `${img}<div class="t"><div class="n">${esc(st.name)}${isDead(st) ? ' <small style="color:#c66">(dead?)</small>' : ''}</div><div class="m">${esc(meta)}</div></div><span class="f">${esc(freqLabel(st))}</span>${extra}`;
}

let listState = null;
function openList(title, items, { render, onPick, onRemove, filter, sel } = {}) {
  listState = { items, render, onPick, onRemove };
  $('listTitle').textContent = title;
  $('listFilter').hidden = !filter; $('listFilter').value = '';
  drawList('');
  openSheet('listSheet');
  if (sel != null) { const li = $('listItems').children[sel]; li && li.scrollIntoView({ block: 'center' }); }
}
function drawList(q) {
  const { items, render, onRemove } = listState;
  const nq = norm(q);
  const ul = $('listItems');
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => !nq || norm(it.label || it.name).includes(nq));
  ul.innerHTML = shown.length ? '' : '<li class="empty">Nothing here yet</li>';
  shown.forEach(({ it, i }) => {
    const li = document.createElement('li');
    li.innerHTML = render(it) + (onRemove ? '<button class="x" aria-label="Remove">&times;</button>' : '');
    if (it.sel) li.classList.add('sel');
    li.addEventListener('click', e => {
      if (e.target.classList.contains('x')) { onRemove(it, i); return; }
      closeSheets(); listState.onPick(it, i);
    });
    ul.appendChild(li);
  });
}
$('listFilter').addEventListener('input', e => drawList(e.target.value));

function pickCountry() {
  const items = S.countries.map((c, i) => ({ label: c.name, code: c.code, sel: i === S.ci }));
  openList('Choose country', items, {
    filter: true, sel: S.ci,
    render: it => `<div class="ph">${flag(it.code)}</div><div class="t"><div class="n">${esc(it.label)}</div></div>`,
    onPick: it => { const d = S.countries.findIndex(c => c.code === it.code) - S.ci; knobs.country.turn(d); S.ci += d; updateWhere(); openCountry(it.code); }
  });
}
function pickRegion() {
  if (!S.regions.length) return;
  const cd = countryData[country().code];
  const items = S.regions.map((r, i) => ({ label: r, n: (cd.byRegion[r] || []).length, sel: i === S.ri }));
  openList(country().name + ' — regions', items, {
    filter: S.regions.length > 12, sel: S.ri,
    render: it => `<div class="t"><div class="n">${esc(it.label)}</div><div class="m">${it.n} stations</div></div>`,
    onPick: (it) => { const i = S.regions.indexOf(it.label); knobs.region.turn(i - S.ri); selectRegion(i); }
  });
}
function flag(cc) { return /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map(ch => 127397 + ch.charCodeAt(0))) : '🌐'; }

/* ---------------- go to a station from search / favourites ---------------- */
async function goToStation(st) {
  st = Object.assign({}, st);
  const code = st.cc || 'ZA';
  if (!S.countries.find(c => c.code === code)) S.countries.push({ code, name: st.country || code });
  const ci = S.countries.findIndex(c => c.code === code);
  if (ci !== S.ci) { knobs.country.turn(ci - S.ci > 0 ? 3 : -3); S.ci = ci; }
  const cd = await loadCountry(code);
  if (!st.region) st.region = regionFor(st);
  let reg = st.region;
  // prefer the copy already in the country list (curated entries carry frequency + aliases)
  const same = cd.all.find(s => s.id === st.id || (s.apiId && s.apiId === st.id) || norm(s.name) === norm(st.name));
  if (same) { st = same; reg = same.region; }
  S.regions = cd.regions;
  let ri = S.regions.indexOf(reg);
  if (ri < 0) ri = S.regions.indexOf(code === 'ZA' ? 'Other' : 'All');
  if (ri < 0) ri = 0;
  if (ri !== S.ri) knobs.region.turn(ri - S.ri);
  if (!S.power) { S.volume = Math.max(S.volume, 0.5); knobs.vol.setAngle(volToAngle(S.volume)); S.power = true; document.body.classList.remove('off'); ensureAudioCtx(); }
  stopScan();
  const prevTi = S.ti;
  selectRegion(ri, { station: st, immediate: true });
  knobs.tune.turn(S.ti >= prevTi ? 2 : -2);
}

/* ---------------- search ---------------- */
let searchTimer = null, searchSeq = 0;
function scoreStation(st, q) {
  const qn = norm(q), qd = digits(q);
  if (!qn) return 0;
  const isFreq = /^[\d\s.,]+$/.test(q.trim()) && qd.length >= 2;
  const nn = norm(st.name);
  const al = (st.aliases || []).map(norm);
  let sc = 0;
  if (isFreq) {
    const fd = st.freq ? digits(Number(st.freq).toFixed(1)) : '';
    if (fd && (fd === qd || fd === qd + '0')) sc = 100;
    else if (fd && fd.startsWith(qd)) sc = 75;
    if (nn.includes(qd)) sc = Math.max(sc, nn === qd ? 98 : 65);
    if (al.some(a => a === qd)) sc = Math.max(sc, 95);
  } else {
    if (nn === qn) sc = 100;
    else if (al.includes(qn)) sc = 96;
    else if (nn.startsWith(qn)) sc = 85;
    else if (al.some(a => a.startsWith(qn))) sc = 80;
    else if (qn.length >= 2 && nn.includes(qn)) sc = 65;
    else if (qn.length >= 3 && al.some(a => a.includes(qn))) sc = 60;
    else if (qn.length >= 4) { // forgiving: small typos
      const maxD = qn.length >= 8 ? 2 : 1;
      const words = [nn, ...al, ...String(st.name).toLowerCase().split(/\s+/).map(norm)];
      if (words.some(w => w && (lev(w, qn) <= maxD || lev(w.slice(0, qn.length), qn) <= maxD))) sc = 45;
    }
  }
  if (sc && st.curated) sc += 8;
  if (sc && st.cc === country().code) sc += 3;
  return sc;
}
function localPool() {
  const pool = new Map();
  const add = s => { if (s && s.name && !pool.has(s.id)) pool.set(s.id, s); };
  (curated || []).forEach(add);
  Object.values(countryData).forEach(cd => cd.all.forEach(add));
  store.get('favs', []).forEach(add);
  store.get('recent', []).forEach(add);
  return [...pool.values()];
}
function runSearch(q) {
  const seq = ++searchSeq;
  q = q.trim();
  if (!q) { renderResults([], ''); return; }
  const local = localPool().map(st => ({ st, sc: scoreStation(st, q) })).filter(x => x.sc > 0);
  renderResults(local, q);
  clearTimeout(searchTimer);
  if (q.length < 2 || !navigator.onLine) return;
  $('searchHint').textContent = 'Searching the world…';
  searchTimer = setTimeout(async () => {
    try {
      const j = await api(`/json/stations/search?name=${encodeURIComponent(q)}&hidebroken=true&order=clickcount&reverse=true&limit=40`);
      if (seq !== searchSeq) return;
      const have = new Set(local.map(x => x.st.id).concat(local.map(x => x.st.apiId).filter(Boolean)));
      const remote = j.map(slim).filter(s => s.url && !have.has(s.id)).map(s => {
        s.region = regionFor(s); s.freq = guessFreq(s.name);
        return { st: s, sc: Math.max(20, scoreStation(s, q) - 15) };
      });
      renderResults(local.concat(remote), q);
    } catch (e) { if (seq === searchSeq) $('searchHint').textContent = 'Could not reach the station directory'; }
  }, 450);
}
function renderResults(results, q) {
  results.sort((a, b) => b.sc - a.sc);
  const ul = $('searchResults'); ul.innerHTML = '';
  $('searchHint').textContent = q ? `${results.length} station${results.length === 1 ? '' : 's'}` : 'Type a name, short name or frequency.';
  results.slice(0, 80).forEach(({ st }) => {
    const li = document.createElement('li');
    li.innerHTML = stationLi(st);
    li.addEventListener('click', () => { closeSheets(); goToStation(st); });
    ul.appendChild(li);
  });
}
$('searchInput').addEventListener('input', e => runSearch(e.target.value));

/* ---------------- favourites & recent ---------------- */
const keep = st => ({ id: st.id, name: st.name, url: st.url, hls: st.hls, favicon: st.favicon, cc: st.cc, country: st.country, region: st.region, state: st.state, freq: st.freq, band: st.band, aliases: st.aliases, curated: st.curated, apiId: st.apiId });
const isFav = st => !!st && store.get('favs', []).some(f => f.id === st.id);
function toggleFav() {
  const st = S.current; if (!st) return;
  let favs = store.get('favs', []);
  if (isFav(st)) { favs = favs.filter(f => f.id !== st.id); toast('Removed from favourites'); }
  else { favs.unshift(keep(st)); toast('★ Saved ' + st.name); }
  store.set('favs', favs); updateFavBtn(); vibrate(15);
}
function updateFavBtn() { const on = isFav(S.current); $('btnFav').innerHTML = (on ? '&#9733;' : '&#9734;') + `<span>${on ? 'Saved' : 'Save'}</span>`; $('btnFav').classList.toggle('on', on); }
function addRecent(st) {
  const r = store.get('recent', []).filter(x => x.id !== st.id); r.unshift(keep(st)); store.set('recent', r.slice(0, 25));
}
function showFavs() {
  const favs = store.get('favs', []);
  openList('Favourites', favs, {
    render: st => stationLi(st), onPick: st => goToStation(st),
    onRemove: (st) => { store.set('favs', store.get('favs', []).filter(f => f.id !== st.id)); updateFavBtn(); showFavs(); }
  });
}
function showRecent() { openList('Recently played', store.get('recent', []), { render: st => stationLi(st), onPick: st => goToStation(st) }); }

// long-press the dial to save a favourite
(() => {
  let t = null;
  const dial = $('dial');
  dial.addEventListener('pointerdown', () => { t = setTimeout(() => { t = null; toggleFav(); }, 650); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => dial.addEventListener(ev, () => { clearTimeout(t); t = null; }));
  dial.addEventListener('contextmenu', e => e.preventDefault());
})();
$('where').addEventListener('click', pickCountry);
$('stationName').addEventListener('click', pickRegion);

/* ---------------- settings ---------------- */
let sleepAt = 0, sleepT = null, sleepIv = null;
function applySettings() {
  document.body.classList.toggle('green', S.settings.light === 'green');
  document.body.classList.toggle('amber', S.settings.light !== 'green');
  $('setStatic').checked = !!S.settings.static;
  $('setLight').value = S.settings.light;
}
function saveSettings() { store.set('settings', S.settings); applySettings(); }
$('setStatic').addEventListener('change', e => { S.settings.static = e.target.checked; saveSettings(); if (!e.target.checked) staticTo(0); });
$('setLight').addEventListener('change', e => { S.settings.light = e.target.value; saveSettings(); });
$('setSleep').addEventListener('change', e => {
  const min = +e.target.value; clearTimeout(sleepT); clearInterval(sleepIv); sleepAt = 0; $('sleepLeft').textContent = '';
  if (!min) return;
  sleepAt = Date.now() + min * 60000;
  sleepT = setTimeout(() => { knobs.vol.setAngle(VOL_MIN); powerOff(); $('setSleep').value = '0'; $('sleepLeft').textContent = ''; clearInterval(sleepIv); toast('Sleep timer — radio off'); }, min * 60000);
  const show = () => { $('sleepLeft').textContent = 'Switching off in ' + Math.ceil((sleepAt - Date.now()) / 60000) + ' min'; };
  show(); sleepIv = setInterval(show, 20000);
  toast('Sleep timer: ' + min + ' min');
});
$('btnClearDead').addEventListener('click', () => { dead = {}; store.set('dead', dead); toast('Dead-station list cleared'); });
$('btnClearCache').addEventListener('click', () => {
  Object.keys(localStorage).filter(k => k.startsWith('rr_cc_') || k === 'rr_countries' || k === 'rr_resolved').forEach(k => localStorage.removeItem(k));
  Object.keys(countryData).forEach(k => delete countryData[k]); curated = null;
  toast('Refreshing station lists…'); closeSheets();
  loadCountries().then(l => { S.countries = l; openCountry(country().code); });
});
$('btnShare').addEventListener('click', async () => {
  const data = { title: 'Retro Radio', text: 'Listen to radio stations from all over the world on an old-school radio:', url: PAGES_URL };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(PAGES_URL); toast('Link copied'); }
  } catch (e) { /* cancelled */ }
});
function newer(a, b) { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; }
$('btnUpdate').addEventListener('click', async () => {
  toast('Checking…');
  try {
    const r = await fetchT(PAGES_URL + 'version.json?t=' + Date.now(), 8000, { cache: 'no-store' });
    const j = await r.json();
    if (!newer(j.version, APP_VERSION)) { toast('You have the latest version (' + APP_VERSION + ')'); return; }
    if (IS_NATIVE) { toast('Downloading version ' + j.version + '…'); setTimeout(() => { location.href = APK_URL; }, 600); }
    else {
      toast('Updating to ' + j.version + '…');
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage('skip'); }
      setTimeout(() => location.reload(), 900);
    }
  } catch (e) { toast('Could not check for updates'); }
});

/* ---------------- media session & native service ---------------- */
function updateMediaSession(st) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: st.name, artist: [st.region !== 'All' ? st.region : '', st.country || country().name].filter(Boolean).join(', '),
      album: 'Retro Radio',
      artwork: [{ src: st.favicon || 'icon-512.png', sizes: '512x512' }]
    });
    navigator.mediaSession.playbackState = 'playing';
  } catch (e) { }
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { } };
  h('play', () => { if (!S.power) { knobs.vol.setAngle(volToAngle(Math.max(S.volume, .5))); setVolume(Math.max(S.volume, .5)); } else tuneTo(S.current, true); });
  h('pause', () => { knobs.vol.setAngle(VOL_MIN); powerOff(); });
  h('stop', () => { knobs.vol.setAngle(VOL_MIN); powerOff(); });
  h('nexttrack', () => { knobs.tune.turn(1); tune(1); });
  h('previoustrack', () => { knobs.tune.turn(-1); tune(-1); });
}
// Android APK: native foreground service keeps the stream alive with the screen off
let nativeRadio = null;
function setupNative() {
  if (!IS_NATIVE) return;
  const C = window.Capacitor;
  try {
    nativeRadio = (C.registerPlugin && C.registerPlugin('RadioService')) || (C.Plugins && C.Plugins.RadioService) || null;
  } catch (e) { nativeRadio = null; }
  if (!nativeRadio && C.nativePromise) {
    nativeRadio = {
      start: o => C.nativePromise('RadioService', 'start', o),
      stop: () => C.nativePromise('RadioService', 'stop', {}),
      nowPlaying: o => C.nativePromise('RadioService', 'nowPlaying', o),
      addListener: (ev, cb) => C.nativeCallback && C.nativeCallback('RadioService', 'addListener', { eventName: ev }, cb)
    };
  }
  try { nativeRadio && nativeRadio.addListener && nativeRadio.addListener('stopPressed', () => { knobs.vol.setAngle(VOL_MIN); powerOff(); }); } catch (e) { }
}
function nativeStart(st) { try { nativeRadio && nativeRadio.start({ title: st.name, text: [st.region, st.country || country().name].filter(r => r && r !== 'All').join(' · ') }); } catch (e) { } }
function nativeStop() { try { nativeRadio && nativeRadio.stop(); } catch (e) { } }

/* ---------------- connectivity ---------------- */
window.addEventListener('offline', () => { if (S.power) { setStatus('NO SIGNAL — no internet connection', true); staticTo(0.6); } });
window.addEventListener('online', () => { if (S.power && S.current) tuneTo(S.current, true); });
document.addEventListener('keydown', e => {
  if (!$('searchSheet').hidden || !$('listSheet').hidden) { if (e.key === 'Escape') closeSheets(); return; }
  if (e.key === 'ArrowRight') { knobs.tune.turn(1); tune(1); }
  if (e.key === 'ArrowLeft') { knobs.tune.turn(-1); tune(-1); }
});

/* ---------------- find song (what is the station playing?) ----------------
   Radio stations broadcast the current song name inside the stream (ICY "StreamTitle").
   Android app: read natively (no CORS limits). Web app: read in the browser where the station allows it. */
function extractTitle(meta) {
  const i = meta.indexOf("StreamTitle='"); if (i < 0) return undefined;
  const a = i + 13; let j = meta.indexOf("';", a); if (j < 0) j = meta.lastIndexOf("'"); if (j < a) j = meta.length;
  return meta.slice(a, j).replace(/\0/g, ' ').trim();
}
function decodeMeta(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('iso-8859-1').decode(bytes); }
}
// returns: string (title, may be ''), or undefined when more bytes are needed
function parseIcy(buf, mi) {
  let pos = mi;
  while (pos < buf.length) {
    const len = buf[pos] * 16;
    if (pos + 1 + len > buf.length) return undefined;
    if (len > 0) { const t = extractTitle(decodeMeta(buf.subarray(pos + 1, pos + 1 + len))); if (t) return t; }
    pos += 1 + len + mi;
  }
  return undefined;
}
// no icy-metaint header visible: look for the metadata block directly
function scanIcy(buf) {
  const txt = new TextDecoder('iso-8859-1').decode(buf); // 1 char per byte, so indexes match bytes
  const i = txt.indexOf("StreamTitle='"); if (i < 0) return undefined;
  const j = txt.indexOf("';", i); if (j < 0) return undefined;
  return extractTitle(decodeMeta(buf.subarray(i, j + 2)));
}
async function icyBrowser(url) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { 'Icy-MetaData': '1' }, signal: ctl.signal, cache: 'no-store' });
    if (!r.ok || !r.body) return null;
    const mi = parseInt(r.headers.get('icy-metaint') || '0', 10);
    const reader = r.body.getReader();
    let buf = new Uint8Array(0);
    const max = mi ? mi * 4 + 4 * 4081 : 262144;
    while (buf.length < max) {
      const { done, value } = await reader.read(); if (done) break;
      const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
      const t = mi ? parseIcy(buf, mi) : scanIcy(buf);
      if (t !== undefined) { reader.cancel().catch(() => { }); return t; }
    }
    reader.cancel().catch(() => { });
    return null;
  } catch (e) { return null; } finally { clearTimeout(timer); try { ctl.abort(); } catch (e) { } }
}
async function readNowPlaying(st) {
  const url = st.url || await resolveUrl(st);
  if (!url) return { err: 'nostream' };
  if (st.hls || /\.m3u8(\?|$)/i.test(url)) return { err: 'hls' };
  if (IS_NATIVE && nativeRadio && nativeRadio.nowPlaying) {
    try { const r = await nativeRadio.nowPlaying({ url }); return { title: (r && r.title) || '' }; } catch (e) { /* fall back */ }
  }
  const t = await icyBrowser(url);
  return t == null ? { err: 'blocked' } : { title: t };
}
function looksLikeSong(t, st) {
  if (!t || t.length < 3) return false;
  const n = norm(t);
  if (n === norm(st.name) || n.length < 3) return false;
  if (/^(advert|adbreak|commercial|news|traffic|weather|jingle|promo)/i.test(t.trim())) return false;
  if (/^https?:\/\//i.test(t)) return false;
  return true;
}
function splitTitle(raw) {
  const s = raw.replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?)\s+[-–—~|]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: s };
}
function jsonp(url, ms = 7000) {
  return new Promise((res, rej) => {
    const cb = 'rrcb' + Date.now() + Math.floor(Math.random() * 1e5);
    const s = document.createElement('script');
    const done = () => { clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); };
    const t = setTimeout(() => { done(); rej(new Error('timeout')); }, ms);
    window[cb] = d => { done(); res(d); };
    s.onerror = () => { done(); rej(new Error('jsonp')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}
// free lookups for album art + 30-second preview (no keys): iTunes, then Deezer
async function lookupTrack(artist, title) {
  const q = (artist + ' ' + title).replace(/\(.*?\)|\[.*?\]|feat\.?.*$/gi, ' ').replace(/\s+/g, ' ').trim();
  try {
    const j = await jsonp(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=3&country=ZA`);
    const r = j && j.results && j.results[0];
    if (r) return { artist: r.artistName, title: r.trackName, art: (r.artworkUrl100 || '').replace('100x100', '600x600'), preview: r.previewUrl || '', album: r.collectionName || '' };
  } catch (e) { }
  try {
    const j = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=3&output=jsonp`);
    const r = j && j.data && j.data[0];
    if (r) return { artist: r.artist && r.artist.name, title: r.title, art: r.album && (r.album.cover_big || r.album.cover_medium) || '', preview: r.preview || '', album: r.album && r.album.title || '' };
  } catch (e) { }
  return null;
}

let finding = false, shownSongId = null;
function saveSong(song) {
  const songs = store.get('songs', []).filter(x => x.id !== song.id);
  songs.unshift(song); store.set('songs', songs.slice(0, 300));
}
async function findSong() {
  if (finding) return;
  const st = S.current;
  if (!S.power || !st) { toast('Switch the radio on and tune to a station first'); return; }
  if (!navigator.onLine) { toast('No internet connection'); return; }
  finding = true; vibrate(20);
  const btn = $('btnFind'); btn.classList.add('listening');
  const prevStatus = $('status').textContent;
  setStatus('♫ Listening…');
  try {
    const [res] = await Promise.all([readNowPlaying(st), sleep(1200)]);
    if (res.err === 'hls') { toast('This station does not send song names'); return; }
    if (res.err === 'blocked') { toast(IS_NATIVE ? 'Could not read this station — try again' : 'This station blocks song info in the web app. The Android app can read it.', 3500); return; }
    if (res.err || !looksLikeSong(res.title, st)) { toast(res.title ? 'No song right now: “' + res.title + '”' : 'No song info right now (advert, news or DJ talking?)', 3500); return; }
    const guess = splitTitle(res.title);
    setStatus('♫ Found: ' + res.title);
    const song = {
      id: Date.now(), raw: res.title, artist: guess.artist, title: guess.title, album: '', art: '', preview: '',
      station: st.name, region: st.region, country: st.country || country().name, at: Date.now()
    };
    let songs = store.get('songs', []);
    const dup = songs.find(x => norm(x.raw) === norm(song.raw) && Date.now() - x.at < 15 * 60000);
    if (dup) Object.assign(song, { id: dup.id, artist: dup.artist, title: dup.title, album: dup.album, art: dup.art, preview: dup.preview });
    saveSong(song);
    vibrate([15, 60, 15]);
    showSong(song);
    if (!song.art) lookupTrack(guess.artist, guess.title).then(info => { // add album art + preview when found
      if (!info) return;
      Object.assign(song, { artist: info.artist || song.artist, title: info.title || song.title, album: info.album || '', art: info.art || '', preview: info.preview || '' });
      saveSong(song);
      if (!$('songSheet').hidden && shownSongId === song.id) showSong(song);
    }).catch(() => { });
  } finally {
    btn.classList.remove('listening'); finding = false;
    setTimeout(() => { if ($('status').textContent.startsWith('♫')) setStatus(prevStatus && !prevStatus.startsWith('♫') ? prevStatus : 'On air'); }, 4000);
  }
}

// open a link in the phone's browser / YouTube / Spotify app
function openExternal(url) { if (IS_NATIVE) location.href = url; else window.open(url, '_blank', 'noopener'); }
const songQuery = s => encodeURIComponent((s.artist ? s.artist + ' ' : '') + s.title);
const preview = new Audio(); preview.preload = 'none';
function stopPreview() {
  if (!preview.paused) preview.pause();
  audio.muted = false;
  const b = $('btnPreview'); if (b) b.innerHTML = '&#9654; Play 30-sec preview here';
}
preview.addEventListener('ended', stopPreview);
preview.addEventListener('pause', () => { audio.muted = false; });
function showSong(song) {
  stopPreview();
  shownSongId = song.id;
  const when = new Date(song.at);
  const q = songQuery(song);
  $('songCard').innerHTML = `
    ${song.art ? `<img class="art" src="${esc(song.art)}" referrerpolicy="no-referrer" alt="">` : '<div class="art">&#9835;</div>'}
    <div class="ttl">${esc(song.title)}</div>
    <div class="art-name">${esc(song.artist || 'Unknown artist')}</div>
    <div class="when">Heard on ${esc(song.station)} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    ${norm(song.raw) !== norm(song.artist + song.title) ? `<div class="raw">Station said: “${esc(song.raw)}”</div>` : ''}
    <div class="acts">
      <button class="wide main yt" data-go="https://www.youtube.com/results?search_query=${q}">&#9654; Play full song on YouTube</button>
      ${song.preview ? '<button class="wide main" id="btnPreview">&#9654; Play 30-sec preview here</button>' : ''}
      <button class="wide yt" data-go="https://music.youtube.com/search?q=${q}">YouTube Music</button>
      <button class="wide sp" data-go="https://open.spotify.com/search/${q}">Spotify</button>
      <button class="wide dz" data-go="https://www.deezer.com/search/${q}">Deezer</button>
      <button class="wide ghost" id="btnSongDel">Delete</button>
    </div>`;
  $('songCard').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { stopPreview(); openExternal(b.dataset.go); }));
  const pb = $('btnPreview');
  if (pb) pb.addEventListener('click', () => {
    if (!preview.paused) { stopPreview(); return; }
    preview.src = song.preview; audio.muted = true;
    preview.play().then(() => { pb.innerHTML = '&#9632; Stop preview'; }).catch(() => { audio.muted = false; toast('Preview not available'); });
  });
  $('btnSongDel').addEventListener('click', () => { store.set('songs', store.get('songs', []).filter(x => x.id !== song.id)); stopPreview(); closeSheets(); toast('Song deleted'); });
  openSheet('songSheet');
}
function showSongs() {
  const songs = store.get('songs', []);
  openList('My songs (' + songs.length + ')', songs.map(s => Object.assign({ label: s.artist + ' ' + s.title + ' ' + s.station }, s)), {
    filter: songs.length > 8,
    render: s => `${s.art ? `<img src="${esc(s.art)}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph">&#9835;</div>'}<div class="t"><div class="n">${esc(s.title)}</div><div class="m">${esc(s.artist || 'Unknown artist')} · ${esc(s.station)} · ${new Date(s.at).toLocaleDateString()}</div></div>`,
    onPick: s => showSong(s),
    onRemove: s => { store.set('songs', store.get('songs', []).filter(x => x.id !== s.id)); showSongs(); }
  });
}
document.addEventListener('click', e => { if (e.target.closest('#songSheet [data-close]')) stopPreview(); });

/* ---------------- buttons ---------------- */
$('btnSearch').addEventListener('click', () => { ensureAudioCtx(); openSheet('searchSheet'); $('searchInput').value = ''; runSearch(''); setTimeout(() => $('searchInput').focus(), 60); });
$('btnScan').addEventListener('click', () => { ensureAudioCtx(); S.scanning ? stopScan() : startScan(); });
$('btnFav').addEventListener('click', toggleFav);
$('btnFavs').addEventListener('click', showFavs);
$('btnRecent').addEventListener('click', showRecent);
$('btnSongs').addEventListener('click', showSongs);
$('btnFind').addEventListener('click', findSong);
$('btnSettings').addEventListener('click', () => openSheet('settingsSheet'));

/* ---------------- boot ---------------- */
async function boot() {
  $('ver').textContent = APP_VERSION + (IS_NATIVE ? ' (app)' : '');
  buildScale(); applySettings(); setupKnobs(); setupMediaSession(); setupNative();
  setNeedle(0.02);
  const spot = store.get('spot', null);
  await loadCurated();
  S.countries = await loadCountries();
  const code = spot && S.countries.find(c => c.code === spot.cc) ? spot.cc : 'ZA';
  S.ci = Math.max(0, S.countries.findIndex(c => c.code === code));
  updateWhere();
  await openCountry(code, spot && spot.cc === code ? { region: spot.region } : {});
  if (spot && spot.station && spot.cc === code) {
    const i = S.list.findIndex(s => s.id === spot.station.id || s.name === spot.station.name);
    if (i >= 0) { S.ti = i; tuneTo(S.list[i]); }
  }
  setStatus('Turn VOLUME to switch on');
  if ('serviceWorker' in navigator && !IS_NATIVE && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
}
boot();
