/* ============================================================
   BeeTown – PWA-Client
   ============================================================ */
'use strict';

const APP_VERSION = 'v2.8.31';
const BACKUP_GRACE_DAYS_FRONTEND = 3; // muss zu BACKUP_GRACE_DAYS in server.py passen

/* Baut eine URL zum Setup-Portal (Backup-/Update-Seite). Laeuft das Portal
   wegen eines belegten Port 80 auf einem Ausweich-Port (landingPort aus
   /api/platform), muss dieser mit angegeben werden - sonst landet der Link
   auf Port 80, wo nichts (Passendes) antwortet. */
function setupPortalUrl(landingPort, path){
  const port=landingPort||80;
  return location.protocol+'//'+location.hostname+(port!==80?':'+port:'')+path;
}

const KAEFIG_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block"><line x1="3" y1="0" x2="3" y2="14" stroke="currentColor" stroke-width="1.6"/><line x1="7" y1="0" x2="7" y2="14" stroke="currentColor" stroke-width="1.6"/><line x1="11" y1="0" x2="11" y2="14" stroke="currentColor" stroke-width="1.6"/><line x1="0" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.6"/><line x1="0" y1="10" x2="14" y2="10" stroke="currentColor" stroke-width="1.6"/></svg>`;
const OXAL_BLOCK_ICON = `<img class="oxblock-icon" src="./icons/varroa_block.png" alt="Blockbehandlung">`;
function varroaCountBadgeHTML(e){
  if(e.varroaCount===undefined || e.varroaCount===null || e.varroaCount==='') return '';
  return `<div class="entry-badge entry-badge-varroacount"><img class="status-varroa-icon-sm" src="./icons/varroa.png" alt=""> ${esc(e.varroaCount)} Milben${e.varroaAnts?' · 🐜 Ameisen gesehen':''}</div>`;
}

/* ---------- Globale Settings ---------- */
window._showHrNrs = true; // Default: anzeigen
window._showSearch = true; // Default: anzeigen
window._actionBtnVis = {}; // key -> bool, Default: alle an (siehe actionBtnHidden())
window._obsBtnVis = {};    // key -> bool, Default: alle an (siehe obsBtnHidden())
window._homeBtnVis = {};   // key -> bool, Default: alle an (siehe homeBtnHidden())
async function loadSettings() {
  try {
    const s = await apiGet('./api/settings');
    window._showHrNrs = (s.showHrNrs !== 'false');
    window._showSearch = (s.showSearch !== 'false');
    const actionVis = {};
    ACTION_BTN_CONFIG.forEach(c => { actionVis[c.key] = (s['actionBtn_'+c.key] !== 'false'); });
    window._actionBtnVis = actionVis;
    const obsVis = {};
    OBS_OPTIONS.forEach(([k]) => { obsVis[k] = (s['obsBtn_'+k] !== 'false'); });
    OBS_SELECT_CONFIG.forEach((c) => { obsVis[c.key] = (s['obsBtn_'+c.key] !== 'false'); });
    window._obsBtnVis = obsVis;
    const homeVis = {};
    HOME_BTN_CONFIG.forEach(c => { homeVis[c.key] = (s['homeBtn_'+c.key] !== 'false'); });
    window._homeBtnVis = homeVis;
    window._bkPrefix = s.bkPrefix !== undefined ? s.bkPrefix : 'BK';
  } catch(_) {}
}
/* Buttons auf der Startseite - einzeln in den Einstellungen ausblendbar.
   "Einstellungen" selbst bleibt bewusst immer sichtbar (sonst kein Weg
   zurück, um Buttons wieder einzublenden). */
const HOME_BTN_CONFIG = [
  {key:'all',         label:'Alle'},
  {key:'honey',       label:'Ernte'},
  {key:'honeystir',   label:'Rühren'},
  {key:'fuetterung',  label:'Fütterung'},
  {key:'lastentries', label:'Letzte Einträge'},
  {key:'varroacount', label:'Varroazählung'},
  {key:'archive',     label:'Archiv'},
];
function homeBtnHidden(key) {
  return (window._homeBtnVis && window._homeBtnVis[key]===false) ? 'hidden' : '';
}
/* Sonderbehandlung von Völkern/Standorten, deren Name mit dem konfigurierbaren
   Präfix beginnt (Standard „BK“); leerer Präfix deaktiviert die Sonderbehandlung. */
function isBkName(name) {
  const p = (window._bkPrefix !== undefined ? window._bkPrefix : 'BK').trim();
  if(!p) return false;
  return (name||'').toUpperCase().startsWith(p.toUpperCase());
}

/* ---------- Lade-Biene ---------- */
let _pendingReqs = 0;
function _beeBusy(on) {
  _pendingReqs = Math.max(0, _pendingReqs + (on ? 1 : -1));
  const bee = document.getElementById('loading-bee');
  if (bee) bee.classList.toggle('bee-active', _pendingReqs > 0);
}

/* ---------- API-Schicht ---------- */
async function api(method, path, body, isRaw) {
  const opts = { method };
  if (body !== undefined) {
    if (isRaw) { opts.body = body; opts.headers = { 'Content-Type': 'image/jpeg' }; }
    else { opts.body = JSON.stringify(body); opts.headers = { 'Content-Type': 'application/json' }; }
  }
  _beeBusy(true);
  let res;
  try { res = await fetch(path, opts); }
  catch (e) { _beeBusy(false); throw new Error('Server nicht erreichbar – ist das VPN aktiv?'); }
  _beeBusy(false);
  if (!res.ok) {
    let msg = 'Fehler ' + res.status;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  const ct = res.headers.get('Content-Type') || '';
  return ct.includes('application/json') ? res.json() : res;
}
const apiGet = (p) => api('GET', p);

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function todayInput() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function nowDateTimeInput() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const photoURL = (id) => `./api/photos/${id}`;
/* Zahl parsen, egal ob mit Punkt oder Komma als Dezimaltrennzeichen eingegeben */
function parseDecimal(str) {
  if(str==null) return NaN;
  return parseFloat(String(str).trim().replace(',','.'));
}
function fmtNum(n) {
  return (Math.round(n*10)/10).toString().replace('.',',');
}

/* ---------- Zuckersirup-Rechner ---------- */
/* Kalibrierungswerte aus der Praxis (nicht die reine Physik-Formel, sondern die vom Nutzer
   bestätigten, gewohnten Werte): pro kg Zucker wie viel Wasser nötig ist und wie viel Liter
   Sirup dabei am Ende herauskommen. */
const SIRUP_RATIOS = {
  '1:1.2': {label:'1 : 1,2', waterPerKg: 1.2,  yieldPerKg: 9.3/5},
  '1:1':   {label:'1 : 1',   waterPerKg: 1,    yieldPerKg: 1.6/1},
  '3:2':   {label:'3 : 2',   waterPerKg: 2/3,  yieldPerKg: 3.8/3},
};
function sirupFromTarget(ratioKey, targetLiters) {
  const r = SIRUP_RATIOS[ratioKey];
  const sugar = targetLiters / r.yieldPerKg;
  const water = sugar * r.waterPerKg;
  return { sugar, water, result: targetLiters };
}
function sirupFromSugar(ratioKey, sugarKg) {
  const r = SIRUP_RATIOS[ratioKey];
  const water = sugarKg * r.waterPerKg;
  const result = sugarKg * r.yieldPerKg;
  return { sugar: sugarKg, water, result };
}

/* ---------- Umlarv-Berechnung ---------- */
function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function umlarvInfo(colony, settings) {
  if (!colony.umlarvDate) return '';
  const schlupfDays = parseInt(settings.schlupfDays || '11');
  const eilageDays  = parseInt(settings.eilageDays  || '28');
  const schlupf = addDays(colony.umlarvDate, schlupfDays);
  const eilage  = addDays(colony.umlarvDate, schlupfDays + eilageDays);
  const today   = new Date().toISOString().slice(0, 10);
  const schlupfPast = schlupf < today;
  const eilagePast  = eilage  < today;
  return `<div class="umlarv-info">
    <div class="umlarv-row">
      <span class="umlarv-label">🐛 Umgelarvt:</span>
      <span class="umlarv-date">${fmtDate(colony.umlarvDate)}</span>
    </div>
    <div class="umlarv-row">
      <span class="umlarv-label">👑 Schlupf:</span>
      <span class="umlarv-date ${schlupfPast?'umlarv-past':'umlarv-future'}">${fmtDate(schlupf)}</span>
    </div>
    <div class="umlarv-row">
      <span class="umlarv-label">🥚 Erste Eilage:</span>
      <span class="umlarv-date ${eilagePast?'umlarv-past':'umlarv-future'}">${fmtDate(eilage)}</span>
    </div>
  </div>`;
}

/* ---------- Auto-Refresh (Punkt 1) ---------- */
let _refreshTimer = null;
let _lastEntryHash = '';
function startAutoRefresh() {
  stopAutoRefresh();
  _refreshTimer = setInterval(async () => {
    if (nav.view !== 'colony') return;
    try {
      const entries = await apiGet('./api/entries?colonyId=' + nav.colonyId);
      const hash = JSON.stringify(entries.map(e => e.id + (e.createdAt||'')));
      if (_lastEntryHash && hash !== _lastEntryHash) {
        _lastEntryHash = hash;
        renderColony();
      } else {
        _lastEntryHash = hash;
      }
    } catch(_) {}
  }, 30000);
}
function stopAutoRefresh() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

/* ---------- Cooldown-Anzeige für "Fütterungsvorschlag übernehmen" ---------- */
let _fvCooldownTimer = null;
function stopFvCooldownTimer() {
  if (_fvCooldownTimer) { clearInterval(_fvCooldownTimer); _fvCooldownTimer = null; }
}

/* ---------- Demaree ---------- */
function demareeLabel(c) {
  const stufe = c.demareeStage ? ` Stufe ${esc(c.demareeStage)}` : '';
  let label = c.demareeEndedAt ? `Demaree${stufe} beendet` : `Demaree${stufe}`;
  const refDate = c.demareeEndedAt || c.demareedAt;
  if (refDate) {
    const days = Math.floor((Date.now() - new Date(refDate)) / 86400000);
    label += c.demareeEndedAt ? ` · vor ${days} Tagen` : ` · seit ${days} Tagen`;
  }
  return label;
}

/* ---------- Oxalsäure-Blockbehandlung ---------- */
const OXAL_BLOCK_DAYS = 22;
const OXAL_BLOCK_MAX_STAGE = 6;
function oxalBlockInfo(c) {
  const stage = parseInt(c.oxalBlockStage) || 0;
  const startAt = c.oxalBlockStartAt || '';
  if (!stage || !startAt) return null;
  const lastAt = c.oxalBlockLastAt || startAt;
  const daysSinceStart = Math.floor((Date.now() - new Date(startAt)) / 86400000);
  const daysSinceLast  = Math.floor((Date.now() - new Date(lastAt)) / 86400000);
  const done = daysSinceStart >= OXAL_BLOCK_DAYS;
  return { stage, startAt, lastAt, daysSinceStart, daysSinceLast, done };
}
function oxalBlockLabel(c) {
  const info = oxalBlockInfo(c);
  if (!info) return '';
  let label = info.done ? `Block Stufe ${info.stage} abgeschlossen` : `Block Stufe ${info.stage}`;
  label += ` · Bedampfung vor ${info.daysSinceStart} Tagen`;
  if (info.daysSinceLast !== info.daysSinceStart) {
    label += ` · letzte Stufe vor ${info.daysSinceLast} Tagen`;
  }
  if (!info.done) label += ` (Tag ${info.daysSinceStart}/${OXAL_BLOCK_DAYS})`;
  return label;
}
/* Legt/erneuert automatisch eine Erinnerung für die nächste fällige Blockstufe an.
   Völker desselben Standorts mit demselben Fälligkeitsdatum landen dabei in
   EINER gemeinsamen Erinnerung (je Volk eine Zeile) statt in Dubletten. */
const OXAL_BLOCK_REMINDER_MARKER = '🧪 Blockbehandlung fällig';
function parseOxalBlockReminderLines(text) {
  if(!text || !text.startsWith(OXAL_BLOCK_REMINDER_MARKER)) return null;
  return text.slice(OXAL_BLOCK_REMINDER_MARKER.length).split('\n').map((s)=>s.trim()).filter(Boolean)
    .map((line)=>{ const m=line.match(/^•\s*(.+?):\s*Stufe\s*(\d+)$/); return m?{name:m[1],stage:parseInt(m[2],10)}:null; })
    .filter(Boolean);
}
function buildOxalBlockReminderText(lines) {
  return OXAL_BLOCK_REMINDER_MARKER+'\n'+lines.map((l)=>`• ${l.name}: Stufe ${l.stage}`).join('\n');
}
async function scheduleOxalBlockReminder(colony, fromDate, stage) {
  try {
    const reminders = await apiGet('./api/reminders').catch(()=>[]);
    /* Volk aus allen bestehenden Auto-Erinnerungen entfernen (alter Stand) */
    for(const r of reminders){
      const lines = parseOxalBlockReminderLines(r.text);
      if(!lines) continue;
      const remaining = lines.filter((l)=>l.name!==colony.name);
      if(remaining.length===lines.length) continue;
      if(remaining.length===0) await api('DELETE','./api/reminders/'+r.id);
      else await api('PUT','./api/reminders/'+r.id,{...r,text:buildOxalBlockReminderText(remaining)});
    }
    if(stage >= OXAL_BLOCK_MAX_STAGE) return;

    const settings = await apiGet('./api/settings').catch(()=>({}));
    const gapDays = parseInt(settings.oxalBlockGapDays || '4') || 4;
    const dueDate = addDays(fromDate, gapDays);

    /* Nach dem Aufräumen erneut laden: passende Sammel-Erinnerung (selber Standort,
       selbes Datum) suchen und das Volk dort ergänzen, statt eine neue anzulegen */
    const fresh = await apiGet('./api/reminders').catch(()=>[]);
    const target = fresh.find((r)=>r.apiaryId===(colony.apiaryId||'') && r.dueDate===dueDate && parseOxalBlockReminderLines(r.text));
    if(target){
      const lines = parseOxalBlockReminderLines(target.text);
      lines.push({name:colony.name, stage:stage+1});
      await api('PUT','./api/reminders/'+target.id,{...target,text:buildOxalBlockReminderText(lines)});
    } else {
      const apiaries = await apiGet('./api/apiaries').catch(()=>[]);
      const apiary = apiaries.find((a)=>a.id===colony.apiaryId);
      await api('POST','./api/reminders',{
        text: buildOxalBlockReminderText([{name:colony.name, stage:stage+1}]),
        apiaryId: colony.apiaryId||'',
        apiaryName: apiary?apiary.name:'',
        dueDate,
        remindDaysBefore: 0,
        createdAt: new Date().toISOString(),
      });
    }
  } catch(_) {}
}

const ENTRY_TYPES = [
  'Durchsicht / Kontrolle', 'Varroabehandlung', 'Varroa-Zählung', 'Fütterung',
  'Schwarmkontrolle', 'Wanderung', 'Umweiselung', 'Sonstiges',
];

const OBS_OPTIONS = [
  ['queen_seen',    'Königin'],
  ['eggs_seen',     'Stifte'],
  ['larvae_seen',   'Larven / Maden'],
  ['swarm_open',    'Offene Schwarmzelle'],
  ['swarm_capped',  'Verdeckelte Schwarmzelle'],
  ['loech_brutnest','Löchriges Brutnest'],
];
/* Nur noch für die Anzeige alter, nicht mehr bearbeiteter Einträge (Schwarmstimmung/Wildbau
   liefen früher als einzelne Beobachtungs-Toggles, sind jetzt Auswahl-Buttons – siehe unten) */
const LEGACY_OBS_LABEL = {
  no_ss:'Keine SS', wildbau:'Wildbau',
  ss_stark:'Starke SS', ss_normal:'Normale SS', ss_gering:'Geringe SS',
};
const OBS_LABEL = {
  ...Object.fromEntries(OBS_OPTIONS),
  'oxal':        'Oxalsäure Bedampfung',
  'weiselprobe': 'Weiselprobe eingehängt',
  'kaefigung':   'Käfigung',
  'koeniginFrei':'Königin freigelassen',
};
const SWARM_COUNT_KEYS = { swarm_open: 'swarm_open_count', swarm_capped: 'swarm_capped_count' };

/* ---------- Aktions-Buttons im Eintrag: einzeln ein-/ausschaltbar ---------- */
const ACTION_BTN_CONFIG = [
  {key:'demaree',      label:'Demaree'},
  {key:'hr',           label:'Honigraum (+ HR)'},
  {key:'weiselprobe',  label:'Weiselprobe'},
  {key:'oxal',         label:'Oxalsäure Bedampfung'},
  {key:'oxalblock',    label:'Oxalsäure-Block starten'},
  {key:'kaefigung',    label:'Käfigung'},
  {key:'koeniginfrei', label:'Königin freigelassen'},
  {key:'fuettern',     label:'Fütterung'},
  {key:'wabentyp',     label:'+Wabe (Typ + Position)'},
];
const POS_1_TO_12 = Array.from({length:12},(_,i)=>i+1);
/* Beobachtungen mit fester Werte-Auswahl statt einfachem Ein/Aus-Toggle:
   ein Button öffnet ein Auswahlfenster, der Button-Text zeigt die gewählte Stufe. */
const OBS_SELECT_CONFIG = [
  { key:'swarmmood', field:'swarmMood',   label:'Schwarmstimmung', idleLabel:'Schwarmstimmung', chipPrefix:'',
    optionsCore:[['stark','Starke SS'],['normal','Normale SS'],['gering','Geringe SS'],['keine','Keine SS']] },
  { key:'wildbau',   field:'wildbauLevel', label:'Wildbau', idleLabel:'Wildbau', chipPrefix:'Wildbau: ',
    optionsCore:[['gering','Gering'],['mittel','Mittel'],['stark','Stark']] },
  { key:'waben',     field:'wabenAnzahl',  label:'Anzahl Waben', idleLabel:'Anzahl Waben', chipPrefix:'Anzahl Waben: ',
    optionsCore: Array.from({length:12},(_,i)=>[String(i+1),String(i+1)]) },
];
function obsSelectLabel(cfg, value) {
  if(!value) return '';
  const found = cfg.optionsCore.find(([v])=>v===value);
  return cfg.chipPrefix + (found?found[1]:value);
}
/* Grobe Zuordnung alter Werte (vor dieser Umstellung) auf die neuen festen Stufen,
   nur für die Vorbelegung beim Bearbeiten bereits bestehender Einträge. */
function legacySwarmMoodFromObs(obsArr) {
  if(!obsArr) return '';
  if(obsArr.includes('no_ss')) return 'keine';
  if(obsArr.includes('ss_stark')) return 'stark';
  if(obsArr.includes('ss_normal')) return 'normal';
  if(obsArr.includes('ss_gering')) return 'gering';
  return '';
}
function legacyWildbauLevelFromStufe(stufe) {
  const n = parseInt(stufe)||0;
  if(!n) return '';
  if(n<=2) return 'gering';
  if(n===3) return 'mittel';
  return 'stark';
}
const WABE_TYPES = [
  ['MW','MW (Mittelwand)'],
  ['AW','AW (Ausgebaute Wabe)'],
  ['FW','FW (Futterwabe)'],
  ['BW','BW (Brutwabe)'],
  ['DW','DW (Drohnenwabe)'],
  ['PW','PW (Pollenwabe)'],
];
function wabeLabelParts(entries) {
  const anySwap = entries.some((e)=>e.action==='swap');
  const byType = {};
  entries.forEach((e)=>{ (byType[e.type]=byType[e.type]||[]).push(e); });
  const parts = Object.keys(byType).map((t)=>{
    const list = byType[t].slice().sort((a,b)=>a.pos-b.pos).map((e)=>String(e.pos));
    return t+' Pos'+list.join(',');
  });
  return {anySwap, text: parts.join(', ')};
}
/* Reine Textvariante (Suche, textContent) – ohne Farbe/Markup */
function wabeBtnLabel(entries) {
  if(!entries || !entries.length) return '+Wabe';
  const {anySwap, text} = wabeLabelParts(entries);
  return (anySwap?'⇄':'+')+'Wabe: '+text;
}
/* HTML-Variante für Button-/Chip-Anzeige: Tausch-Zeichen vorne statt „+“, farblich hervorgehoben */
function wabeBtnLabelHtml(entries) {
  if(!entries || !entries.length) return '+Wabe';
  const {anySwap, text} = wabeLabelParts(entries);
  const prefix = anySwap ? '<span class="wabe-swap-mark" title="Enthält mind. einen Wabentausch">⇄</span>' : '+';
  return prefix+'Wabe: '+esc(text);
}
function wabePosTypeGridHTML(entries) {
  return POS_1_TO_12.map((n)=>{
    const cur = entries.find((e)=>e.pos===n);
    return `<div class="wabe-pos-row">
      <span class="wabe-pos-label">Position ${n}</span>
      <select class="inp wabe-type-select" data-pos="${n}">
        <option value="">— keine —</option>
        ${WABE_TYPES.map(([v,l])=>`<option value="${v}" ${cur?.type===v?'selected':''}>${esc(l)}</option>`).join('')}
      </select>
      <label class="wabe-swap-lbl" title="Vorhandene Wabe an dieser Position austauschen, statt eine neue hinzuzufügen">
        <input type="checkbox" class="wabe-swap-check" data-pos="${n}" ${cur?.action==='swap'?'checked':''}> Tausch
      </label>
    </div>`;
  }).join('');
}
function readWabePosTypeGrid() {
  return [...document.querySelectorAll('.wabe-type-select')]
    .map((sel)=>{
      const pos=parseInt(sel.dataset.pos);
      const swapChk=document.querySelector(`.wabe-swap-check[data-pos="${pos}"]`);
      return {pos, type:sel.value, action: swapChk?.checked ? 'swap' : 'add'};
    })
    .filter((e)=>e.type)
    .sort((a,b)=>a.pos-b.pos);
}
function actionBtnHidden(key) {
  return (window._actionBtnVis && window._actionBtnVis[key]===false) ? 'hidden' : '';
}
function obsBtnHidden(key) {
  return (window._obsBtnVis && window._obsBtnVis[key]===false) ? 'hidden' : '';
}
/* Zuordnung Aktions-Button-Key -> DOM-id-Suffix (für Live-Umschalten, gilt für Einzel- "btn-" UND Sammeleintrag "mass-btn-") */
const ACTION_BTN_ID_SUFFIX = {
  demaree:'demaree', hr:'hr', weiselprobe:'weiselprobe', oxal:'oxal',
  oxalblock:'oxal-block', kaefigung:'kaefigung', koeniginfrei:'koenigin-frei',
  fuettern:'fuettern', wabentyp:'wabentyp',
};
function applyButtonVisibilityLive() {
  ACTION_BTN_CONFIG.forEach((c)=>{
    const suffix=ACTION_BTN_ID_SUFFIX[c.key];
    ['btn-'+suffix,'mass-btn-'+suffix].forEach((id)=>{
      const el=document.getElementById(id);
      if(el) el.classList.toggle('hidden', window._actionBtnVis?.[c.key]===false);
    });
  });
  document.querySelectorAll('[data-obs]').forEach((btn)=>{
    const k=btn.dataset.obs;
    const hide = window._obsBtnVis?.[k]===false;
    const wrapper=btn.closest('.obs-swarm-row');
    if(wrapper) wrapper.classList.toggle('hidden', hide);
    else btn.classList.toggle('hidden', hide);
  });
  OBS_SELECT_CONFIG.forEach((c)=>{
    ['btn-'+c.key,'mass-btn-'+c.key].forEach((id)=>{
      const el=document.getElementById(id);
      if(el) el.classList.toggle('hidden', window._obsBtnVis?.[c.key]===false);
    });
  });
}
/* Popup: alle Aktions-/Beobachtungs-Buttons schnell ein-/ausschalten */
function openButtonManager() {
  openModal('Buttons ein-/ausblenden',`
    <label class="lbl form-section-label">Aktionen</label>
    <div class="check-list">
      ${ACTION_BTN_CONFIG.map((c)=>`<label class="check-item">
        <input type="checkbox" class="mgr-action-chk" data-key="${c.key}" ${window._actionBtnVis?.[c.key]!==false?'checked':''}><span>${esc(c.label)}</span>
      </label>`).join('')}
    </div>
    <label class="lbl form-section-label" style="margin-top:1rem">Beobachtungen</label>
    <div class="check-list">
      ${[...OBS_OPTIONS,...OBS_SELECT_CONFIG.map((c)=>[c.key,c.label])].map(([k,l])=>`<label class="check-item">
        <input type="checkbox" class="mgr-obs-chk" data-key="${k}" ${window._obsBtnVis?.[k]!==false?'checked':''}><span>${esc(l)}</span>
      </label>`).join('')}
    </div>`,
    async(data,close)=>{
      const payload={};
      document.querySelectorAll('.mgr-action-chk').forEach((chk)=>{ payload['actionBtn_'+chk.dataset.key]=chk.checked?'true':'false'; });
      document.querySelectorAll('.mgr-obs-chk').forEach((chk)=>{ payload['obsBtn_'+chk.dataset.key]=chk.checked?'true':'false'; });
      await api('POST','./api/settings',payload);
      await loadSettings();
      applyButtonVisibilityLive();
      close();
    },null);
}


/* ---------- Alle-Völker Spaltenkonfiguration ---------- */
const ALL_COLS = [
  {key:'showStatus',   label:'Zustand (Farb-Dot)',         def:true},
  {key:'showFlags',    label:'⚠ Umweiselung / ⭐ Nachzucht', def:true},
  {key:'showApiary',   label:'Standort',                   def:true},
  {key:'showQueen',    label:'Königin (Jahr/Nr/Gen)',       def:true},
  {key:'showSource',   label:'Herkunft',                   def:false},
  {key:'showHr',       label:'Honigraume (Anzahl)',         def:true},
  {key:'showDemaree',  label:'Demaree-Status',              def:true},
  {key:'showOxalBlock',label:'Oxalsäure-Blockbehandlung',   def:true},
  {key:'showUmlarv',   label:'Königinnenzucht (Schlupf/Eilage)', def:true},
  {key:'showWeisel',   label:'Weiselprobe',                def:true},
  {key:'showKaef',     label:'Käfigung',                   def:true},
  {key:'showLastEntry',label:'Letzter Eintrag (Datum)',    def:false},
  {key:'showNotes',    label:'Notizen (Kurzvorschau)',      def:false},
];
function getAllCols(settings) {
  const cfg = {};
  ALL_COLS.forEach(c => {
    const stored = settings['allCol_'+c.key];
    cfg[c.key] = stored !== undefined ? stored === 'true' : c.def;
  });
  return cfg;
}

/* ---------- Honigraume ---------- */
function parseHR(colony) {
  try { return JSON.parse(colony.honigRaeume || '[]'); } catch(_) { return []; }
}
function hrCountBadge(colony) {
  const hrs = parseHR(colony);
  if (!hrs.length) return '';
  const nrs = hrs.slice().reverse().map(h => h.nr || '--').join(', ');
  const showNrs = window._showHrNrs !== false;
  const nrSpan = showNrs ? ` <span class="hr-nrs">(${esc(nrs)})</span>` : '';
  return `<span class="hr-badge" title="Honigraume: ${esc(nrs)}">🍯 ${hrs.length}${nrSpan}</span>`;
}

/* ---------- Königin-Farben ---------- */
const QUEEN_COLOR_NAME  = { '1':'Weiß','6':'Weiß','2':'Gelb','7':'Gelb','3':'Rot','8':'Rot','4':'Grün','9':'Grün','5':'Blau','0':'Blau' };
const QUEEN_COLOR_CLASS = { '1':'white','6':'white','2':'yellow','7':'yellow','3':'red','8':'red','4':'green','9':'green','5':'blue','0':'blue' };
const QUEEN_HEX  = { white:'#ffffff', yellow:'#f5c518', red:'#e03131', green:'#2f9e44', blue:'#1971c2' };
const QUEEN_TEXT = { white:'#241f17', yellow:'#241f17', red:'#ffffff', green:'#ffffff', blue:'#ffffff' };
const queenColorForYear = (y) => (y ? (QUEEN_COLOR_NAME[String(y).slice(-1)] || '') : '');
const queenClass        = (y) => (y ? (QUEEN_COLOR_CLASS[String(y).slice(-1)] || '') : '');

function queenYearBadge(year) {
  if (!year || year === 'unbekannt') return year === 'unbekannt' ? '<span class="qbadge q-unknown">?</span>' : '';
  const c = queenClass(year);
  const yy = String(year).slice(-2);
  return c ? `<span class="qbadge q-${c}" title="${esc(queenColorForYear(year))}">${yy}</span>` : yy;
}

function queenInfoLine(c) {
  if (!c.queenYear && !c.queenNr) return 'Keine Königin-Angabe';
  const nr    = c.queenNr  ? `(${esc(c.queenNr)}) ` : '';
  const f0    = c.queenGen === 'F0' ? ' 👑' : '';
  const badge = queenYearBadge(c.queenYear);
  const gen   = c.queenGen ? ` <span class="queen-gen">${esc(c.queenGen)}</span>` : '';
  const src   = '';
  return `Königin ${nr}${badge}${gen}${f0}${src}`;
}

function queenYearField(selectedYear, selectedNr) {
  const cur = new Date().getFullYear();
  const years = [cur, cur-1, cur-2, cur-3];
  let sel = selectedYear ? String(selectedYear) : String(cur);
  if (sel !== 'unbekannt' && !years.map(String).includes(sel)) years.unshift(Number(sel));
  return `<label class="lbl">Königin Jahr</label>
    <select class="inp qyear-select" name="queenYear">
      <option value="unbekannt" ${sel==='unbekannt'?'selected':''}>— Unbekannt —</option>
      ${years.map((y) => {
        const c = queenClass(y);
        const bg = QUEEN_HEX[c]||'#fff', tx = QUEEN_TEXT[c]||'#241f17';
        return `<option value="${y}" data-q="${c}" style="background:${bg};color:${tx}" ${String(y)===sel?'selected':''}>${y} – ${esc(queenColorForYear(y))}</option>`;
      }).join('')}
    </select>
    <label class="lbl">Königin Nummer (2-stellig)</label>
    <input class="inp" name="queenNr" type="text" maxlength="2" pattern="[0-9]{0,2}" placeholder="z. B. 07" value="${esc(selectedNr??'')}">`;
}
function wireQueenYearColor() {
  const sel = $('.qyear-select');
  if (!sel) return;
  const paint = () => {
    const opt = sel.options[sel.selectedIndex];
    const c = opt?.dataset.q;
    if (c) { sel.style.background = QUEEN_HEX[c]; sel.style.color = QUEEN_TEXT[c]; sel.style.fontWeight='700'; }
    else { sel.style.background=''; sel.style.color=''; sel.style.fontWeight=''; }
  };
  sel.onchange = paint; paint();
}

/* ---------- Umweiselung ---------- */
const REQUEUE_REASONS = ['Sanftmut','Schwarmlust','Legeleistung','Alter der Königin','Krankheit','Sonstiges'];

function requeueBadge(colony) {
  if (!colony.requeueFlag) return '';
  const reasons = colony.requeueReasons ? JSON.parse(colony.requeueReasons) : [];
  const tip = reasons.length ? reasons.join(', ') : '';
  return `<span class="requeue-badge" title="${esc(tip)}">⚠ Umweiselung${tip ? ': '+esc(tip) : ''}</span>`;
}
function breedBadge(colony) {
  if (!colony.breedFlag) return '';
  return `<span class="breed-badge">⭐ Nachzucht</span>`;
}

/* ---------- Theme ---------- */
const currentTheme = () => { try { return localStorage.getItem('imkerei-theme')||'system'; } catch(_){return'system';} };
function applyTheme(t) {
  try {
    if (t==='system') { localStorage.removeItem('imkerei-theme'); document.documentElement.removeAttribute('data-theme'); }
    else { localStorage.setItem('imkerei-theme',t); document.documentElement.setAttribute('data-theme',t); }
  } catch(_){}
}

/* ---------- Fotos ---------- */
function resizeImage(file, maxSize=1280, quality=0.82) {
  return new Promise((resolve,reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let {width,height} = img;
      if (width>maxSize||height>maxSize) {
        if (width>=height){height=Math.round(height*maxSize/width);width=maxSize;}
        else{width=Math.round(width*maxSize/height);height=maxSize;}
      }
      const c = document.createElement('canvas');
      c.width=width; c.height=height;
      c.getContext('2d').drawImage(img,0,0,width,height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => b?resolve(b):reject(new Error('Bild fehlerhaft')),'image/jpeg',quality);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Bild nicht lesbar'));};
    img.src=url;
  });
}
async function uploadPhoto(file) {
  const blob = await resizeImage(file);
  const {id} = await api('POST','./api/photos',blob,true);
  return id;
}
function photoButtonsHTML(thumbsId='form-thumbs', allEntries, colonyId) {
  return `<label class="lbl">Fotos</label>
    <div class="photo-grid" id="${thumbsId}"></div>
    <div class="photo-row">
      <label class="btn btn-photo">📷 Kamera<input type="file" accept="image/*" capture="environment" class="photo-input" hidden></label>
      <label class="btn btn-photo">🖼 Galerie<input type="file" accept="image/*" multiple class="photo-input" hidden></label>
    </div>`;
}

/* Punkt 2: Foto verschieben */
function wirePhotos(photos, thumbsId='form-thumbs', allEntries, currentEntryId) {
  const container = $('#'+thumbsId);
  const draw = () => {
    container.innerHTML = photos.map((p,i)=>`
      <div class="photo-card">
        <div class="thumb-wrap"><img class="thumb" src="${photoURL(p.id)}">
          <button class="thumb-del" type="button" data-i="${i}">✕</button>
          ${allEntries && allEntries.length > 1 ? `<button class="thumb-move" type="button" data-i="${i}" title="Zu anderem Eintrag verschieben">↗</button>` : ''}
        </div>
        <input class="cap-inp" data-i="${i}" placeholder="Beschreibung (optional)" value="${esc(p.caption||'')}">
      </div>`).join('');
    container.querySelectorAll('.thumb-del').forEach((b)=>b.onclick=()=>{photos.splice(+b.dataset.i,1);draw();});
    container.querySelectorAll('.cap-inp').forEach((inp)=>inp.oninput=()=>{photos[+inp.dataset.i].caption=inp.value;});
    container.querySelectorAll('.thumb-move').forEach((b)=>b.onclick=()=>{
      const photo = photos[+b.dataset.i];
      const others = (allEntries||[]).filter(e => e.id !== currentEntryId);
      openModal('Foto verschieben',`
        <p class="muted">Zu welchem Eintrag soll das Foto verschoben werden?</p>
        ${selectField('Eintrag','targetEntryId',others[0]?.id||'',others.map(e=>[e.id,`${fmtDate(e.date)} – ${esc(e.type)}`]))}`,
        async(data,close)=>{
          const target = others.find(e=>e.id===data.targetEntryId);
          if(!target) return;
          const newPhotos = [...(target.photos||[]), photo];
          await api('PUT','./api/entries/'+target.id, {...target, photos: newPhotos});
          photos.splice(+b.dataset.i, 1);
          draw();
          close();
        },null);
    });
  };
  document.querySelectorAll('.photo-input').forEach((inp)=>inp.onchange=async(ev)=>{
    const labels=[...document.querySelectorAll('.btn-photo')];
    labels.forEach((l)=>l.classList.add('busy'));
    for(const f of [...ev.target.files]){
      try{const id=await uploadPhoto(f);photos.push({id,caption:''});}
      catch(err){alert('Foto-Fehler: '+err.message);}
    }
    labels.forEach((l)=>l.classList.remove('busy'));
    ev.target.value=''; draw();
  });
  draw();
}

/* ---------- Beobachtungs-Toggles ---------- */
function obsTogglesHTML(selected, swarmCounts, selectValues) {
  return `<label class="lbl">Beobachtungen</label>
    <div class="obs-toggles">${OBS_OPTIONS.map(([k,l])=>{
      const isSwarm = k in SWARM_COUNT_KEYS;
      const count = swarmCounts?(swarmCounts[SWARM_COUNT_KEYS[k]]||0):0;
      if (isSwarm) return `<div class="obs-swarm-row ${obsBtnHidden(k)}">
          <button type="button" class="obs-btn ${selected.has(k)?'on':''}" data-obs="${k}">${esc(l)}</button>
          <div class="swarm-counter ${selected.has(k)?'':'hidden'}" data-counter="${k}">
            <button type="button" class="cnt-btn" data-cnt-dec="${k}">−</button>
            <span class="cnt-val" data-cnt-val="${k}">${count}</span>
            <button type="button" class="cnt-btn" data-cnt-inc="${k}">+</button>
          </div></div>`;
      return `<button type="button" class="obs-btn ${obsBtnHidden(k)} ${selected.has(k)?'on':''}" data-obs="${k}">${esc(l)}</button>`;
    }).join('')}${OBS_SELECT_CONFIG.map((cfg)=>{
      const val=selectValues?.[cfg.field]||'';
      const label=val ? obsSelectLabel(cfg,val) : cfg.idleLabel;
      return `<button type="button" class="obs-btn ${obsBtnHidden(cfg.key)} ${val?'on':''}" data-obssel="${cfg.key}">${esc(label)}</button>`;
    }).join('')}</div>`;
}
function wireObs(selected, swarmCounts, selectValues) {
  document.querySelectorAll('[data-obs]').forEach((b)=>b.onclick=()=>{
    const k=b.dataset.obs;
    if(selected.has(k)){selected.delete(k);b.classList.remove('on');}
    else{
      selected.add(k);b.classList.add('on');
      if(k in SWARM_COUNT_KEYS&&swarmCounts){
        const ck=SWARM_COUNT_KEYS[k];
        if(!swarmCounts[ck])swarmCounts[ck]=1;
        const v=document.querySelector(`[data-cnt-val="${k}"]`);
        if(v)v.textContent=swarmCounts[ck];
      }
    }
    const counter=document.querySelector(`[data-counter="${k}"]`);
    if(counter)counter.classList.toggle('hidden',!selected.has(k));
  });
  if(swarmCounts){
    document.querySelectorAll('[data-cnt-inc]').forEach((b)=>b.onclick=()=>{
      const k=b.dataset.cntInc,ck=SWARM_COUNT_KEYS[k];
      swarmCounts[ck]=(swarmCounts[ck]||0)+1;
      document.querySelector(`[data-cnt-val="${k}"]`).textContent=swarmCounts[ck];
    });
    document.querySelectorAll('[data-cnt-dec]').forEach((b)=>b.onclick=()=>{
      const k=b.dataset.cntDec,ck=SWARM_COUNT_KEYS[k];
      swarmCounts[ck]=Math.max(0,(swarmCounts[ck]||0)-1);
      document.querySelector(`[data-cnt-val="${k}"]`).textContent=swarmCounts[ck];
    });
  }
  if(selectValues){
    document.querySelectorAll('[data-obssel]').forEach((btn)=>{
      const cfg=OBS_SELECT_CONFIG.find((c)=>c.key===btn.dataset.obssel);
      if(!cfg) return;
      btn.onclick=()=>{
        openModal(cfg.label,
          selectField(cfg.label,cfg.field,selectValues[cfg.field]||'',[['','-'],...cfg.optionsCore]),
          (data,close)=>{
            selectValues[cfg.field]=data[cfg.field]||'';
            const val=selectValues[cfg.field];
            btn.textContent = val ? obsSelectLabel(cfg,val) : cfg.idleLabel;
            btn.classList.toggle('on', !!val);
            close(); return Promise.resolve();
          },null);
      };
    });
  }
}
function obsChipsHTML(obs, extraData) {
  const chips = (obs||[]).map((k)=>{
    const warn=(k==='swarm_open'||k==='swarm_capped')?' obs-chip-warn':'';
    const action=(k==='oxal'||k==='weiselprobe'||k==='kaefigung')?' obs-chip-action':'';
    let label=OBS_LABEL[k]||LEGACY_OBS_LABEL[k]||k;
    if(extraData&&k in SWARM_COUNT_KEYS){const cnt=extraData[SWARM_COUNT_KEYS[k]];if(cnt&&cnt>0)label+=` (${cnt})`;}
    if(k==='wildbau'&&extraData?.wildbau_stufe){label+=` (Stufe ${extraData.wildbau_stufe})`;}
    return `<span class="obs-chip${warn}${action}">${esc(label)}</span>`;
  });
  OBS_SELECT_CONFIG.forEach((cfg)=>{
    const val=extraData?.[cfg.field];
    if(val) chips.push(`<span class="obs-chip obs-chip-action">${esc(obsSelectLabel(cfg,val))}</span>`);
  });
  if(extraData?.fuetterType){
    let fl = `🍯 ${extraData.fuetterType}`;
    if(extraData.fuetterMenge) fl += ` · ${extraData.fuetterMenge} L`;
    chips.push(`<span class="obs-chip obs-chip-action">${esc(fl)}</span>`);
  }
  if(extraData?.gewicht){
    chips.push(`<span class="obs-chip obs-chip-action">⚖️ ${esc(String(extraData.gewicht).replace('.',','))} kg</span>`);
  }
  if(extraData?.wabenPositions && extraData.wabenPositions.length){
    chips.push(`<span class="obs-chip obs-chip-action">${wabeBtnLabelHtml(extraData.wabenPositions)}</span>`);
  }
  if(!chips.length) return '';
  return `<div class="obs-chips">${chips.join('')}</div>`;
}

/* ============================================================
   Router
   ============================================================ */
const app = $('#app');
const titleEl = $('#screen-title');
const backBtn = $('#back-btn');
let nav = { view:'apiaries', apiaryId:null, colonyId:null };

function go(view, params={}) {
  stopAutoRefresh();
  stopFvCooldownTimer();
  const restoreScrollY = params.restoreScrollY;
  const cleanParams = {...params};
  delete cleanParams.restoreScrollY;
  /* Scroll-/Such-Erinnerung nur gültig, wenn im selben go()-Aufruf explizit mitgegeben – sonst nicht versehentlich eine alte Position/Suche aus einer anderen Navigation übernehmen */
  if(view==='colony' && !('backScrollY' in cleanParams)) cleanParams.backScrollY = undefined;
  if(view==='apiaries' && !('searchQuery' in cleanParams)) cleanParams.searchQuery = undefined;
  if(!('from' in cleanParams)) cleanParams.from = undefined;
  if(!('fromParams' in cleanParams)) cleanParams.fromParams = undefined;
  nav={...nav,...cleanParams,view};
  render().then(()=>{
    if(typeof restoreScrollY === 'number'){
      /* doppelt verzögert: nach dem Setzen von innerHTML braucht der Browser einen Layout-Tick, bis die neue Höhe wirklich verfügbar ist */
      requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,restoreScrollY)));
    } else window.scrollTo(0,0);
  });
}

async function render() {
  try {
    await loadSettings();
    if(nav.view==='apiaries') return await renderApiaries();
    if(nav.view==='colonies') return await renderColonies();
    if(nav.view==='colony')   return await renderColony();
    if(nav.view==='all')      return await renderAll();
    if(nav.view==='archive')  return await renderArchive();
    if(nav.view==='settings') return await renderSettings();
    if(nav.view==='honey')       return await renderHoney();
    if(nav.view==='fuetterung')  return await renderFuetterung();
    if(nav.view==='gewicht')     return await renderGewicht();
    if(nav.view==='lastentries') return await renderLastEntries();
    if(nav.view==='varroacount') return await renderVarroaCount();
    if(nav.view==='varroahistory') return await renderVarroaHistory();
    if(nav.view==='sirupcalc') return await renderSirupCalc();
    if(nav.view==='fuetterungsvorschlag') return await renderFuetterungsvorschlag();
    if(nav.view==='honeystir') return await renderHoneyStir();
    if(nav.view==='honeystirbatch') return await renderHoneyStirBatch();
  } catch(e) {
    app.innerHTML=`<div class="banner-error">${esc(e.message)}
      <button class="btn btn-ghost btn-sm" onclick="location.reload()">Neu laden</button></div>`;
  }
}

backBtn.addEventListener('click',()=>{
  if(nav.from){ go(nav.from, nav.fromParams||{}); return; }
  if(nav.view==='colony'){ go('colonies',{apiaryId:nav.apiaryId,restoreScrollY:nav.backScrollY}); return; }
  if(nav.view==='honeystirbatch'){ go('honeystir'); return; }
  if(['colonies','settings','archive','all','honey','honeystir','fuetterung','gewicht','lastentries','varroacount','varroahistory','sirupcalc','fuetterungsvorschlag'].includes(nav.view)) go('apiaries');
});

/* Update-Hinweis im Header (Setup-Portal installiert - Pi ODER
   Linux-Server - + wenn eine neuere Version vorliegt) - klein gehalten,
   damit normale Nutzer die Update-Seite nicht extra ansteuern muessen,
   um von einem verfuegbaren Update zu erfahren. */
let piUpdateAvailable=false;
let setupLandingPort=80;
function updatePiUpdateBadge(){
  const el=document.getElementById('update-badge-tag');
  if(el) el.style.display=piUpdateAvailable?'':'none';
}
(async()=>{
  try{
    const r=await fetch('./api/platform');
    const d=await r.json();
    piUpdateAvailable=!!(d && d.setupPortal && d.updateAvailable);
    setupLandingPort=d.landingPort||80;
    updatePiUpdateBadge();
  }catch(_){}
})();

/* Header mit Version */
function setHeader(title,showBack){
  titleEl.textContent=title;
  backBtn.hidden=!showBack;
  let vEl=document.getElementById('app-version-tag');
  if(!vEl){
    vEl=document.createElement('span');
    vEl.id='app-version-tag';
    vEl.className='app-version-tag';
    titleEl.parentNode.insertBefore(vEl,titleEl.nextSibling);
  }
  vEl.textContent=APP_VERSION;
  let updEl=document.getElementById('update-badge-tag');
  if(!updEl){
    updEl=document.createElement('span');
    updEl.id='update-badge-tag';
    updEl.className='update-badge-tag';
    updEl.textContent='🔄 Update';
    updEl.title='Update verfügbar – antippen für Details';
    updEl.style.display='none';
    updEl.onclick=()=>{ window.location.href=setupPortalUrl(setupLandingPort,'/update'); };
    vEl.parentNode.insertBefore(updEl,vEl.nextSibling);
  }
  updatePiUpdateBadge();
  /* Datum oben rechts – nur auf Startseite */
  let dateEl=document.getElementById('header-date');
  if(!dateEl){
    dateEl=document.createElement('span');
    dateEl.id='header-date';
    dateEl.className='header-date';
    titleEl.parentNode.appendChild(dateEl);
  }
  const now=new Date();
  dateEl.textContent=now.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
  dateEl.style.display='';
}

/* ---------- Betriebsname ---------- */
function getApiaryName() {
  try { return localStorage.getItem('beecheck-apiary-name') || 'Imkerei Frerichs'; } catch(_){ return 'Imkerei Frerichs'; }
}
function setApiaryName(name) {
  try { localStorage.setItem('beecheck-apiary-name', name); } catch(_){}
}

/* ---------- Standorte ---------- */
async function renderApiaries() {
  setHeader('BeeTown',false);
  const apiaries = await apiGet('./api/apiaries');
  const reminders = await apiGet('./api/reminders');
  const counts={};
  const bkCounts={};
  await Promise.all(apiaries.map(async(a)=>{
    const cols = await apiGet('./api/colonies?apiaryId='+a.id);
    counts[a.id] = cols.length;
    bkCounts[a.id] = cols.filter(c => isBkName(c.name)).length;
  }));

  /* Logo-URL mit Cache-Buster */
  let logoHTML = '';
  try {
    const r = await fetch('./api/logo',{method:'HEAD'});
    if(r.ok) logoHTML = `<img class="brand-logo-custom" src="./api/logo?t=${Date.now()}" alt="Logo">`;
  } catch(_){}

  const apiaryName = getApiaryName();

  /* USB-Backup-Warnung: nur Pi-Betrieb, wenn kein Stick als Backup-Ziel
     eingerichtet ist - ohne ihn liegen Backups nur auf der SD-Karte. */
  let usbWarningHTML='';
  let updateNoticeHTML='';
  try{
    const pr=await fetch('./api/platform');
    const pd=await pr.json();
    if(pd && pd.pi && pd.usbBackupMissing){
      usbWarningHTML=`<div class="banner-error" style="margin-bottom:1rem">
        <p style="margin:0">⚠️ Kein USB-Stick als Backup-Ziel eingerichtet – Backups liegen nur auf der SD-Karte.
        Bei einem Ausfall der SD-Karte sind dann <strong>alle</strong> Daten unwiderruflich verloren.</p>
        <a class="btn btn-ghost block" href="${setupPortalUrl(pd.landingPort,'/backup')}">Jetzt einrichten</a>
      </div>`;
    }
    /* Hinweis NUR nach einem naechtlichen Auto-Update, nicht nach einem
       manuellen Update (dort stehen die Versionshinweise ja schon auf der
       Update-Seite selbst). pd.autoUpdatedVersion wird serverseitig
       ausschliesslich vom automatischen Update-Zweig gesetzt (siehe
       run_update_check_once() in imkerei_wifi_portal.py) - der Vergleich
       mit APP_VERSION stellt sicher, dass wirklich die gerade laufende
       Version gemeint ist (nicht ein alter Stand, falls zwischenzeitlich
       manuell auf eine andere Version gewechselt wurde). Einmalig
       anzeigen, "gesehen" wird direkt danach vermerkt. */
    let seenAutoUpdate=null;
    try{ seenAutoUpdate=localStorage.getItem('beetown-seen-auto-update'); }catch(_){}
    if(pd && pd.setupPortal && pd.autoUpdatedVersion && pd.autoUpdatedVersion===APP_VERSION
       && seenAutoUpdate!==pd.autoUpdatedVersion){
      const notes=(pd.latestVersionNotes||'').trim();
      updateNoticeHTML=`<div class="msg ok" style="margin-bottom:1rem">
        <p style="margin:0">🎉 <strong>BeeTown wurde über Nacht automatisch auf ${esc(APP_VERSION)} aktualisiert.</strong></p>
        ${notes?`<p style="margin:.5rem 0 0; white-space:pre-wrap; font-size:.9rem">${esc(notes)}</p>`:''}
      </div>`;
      try{ localStorage.setItem('beetown-seen-auto-update', pd.autoUpdatedVersion); }catch(_){}
    }
  }catch(_){}

  app.innerHTML=`
    ${updateNoticeHTML}
    ${usbWarningHTML}
    <div class="brand">
      <svg class="brand-bee" viewBox="0 0 120 120" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <polygon points="60,6 108,33 108,87 60,114 12,87 12,33" fill="var(--honey,#f5a623)" opacity="0.18"/>
        <polygon points="60,6 108,33 108,87 60,114 12,87 12,33" fill="none" stroke="var(--honey,#f5a623)" stroke-width="4"/>
        <ellipse cx="60" cy="62" rx="16" ry="22" fill="#f5c518"/>
        <rect x="44" y="56" width="32" height="5" rx="2" fill="#333" opacity="0.7"/>
        <rect x="44" y="65" width="32" height="5" rx="2" fill="#333" opacity="0.7"/>
        <rect x="44" y="74" width="32" height="5" rx="2" fill="#333" opacity="0.7"/>
        <ellipse cx="42" cy="50" rx="13" ry="7" fill="rgba(150,210,255,0.75)" transform="rotate(-30 42 50)"/>
        <ellipse cx="78" cy="50" rx="13" ry="7" fill="rgba(150,210,255,0.75)" transform="rotate(30 78 50)"/>
        <circle cx="60" cy="40" r="10" fill="#f5c518"/>
        <circle cx="56" cy="38" r="2" fill="#333"/>
        <circle cx="64" cy="38" r="2" fill="#333"/>
        <line x1="56" y1="30" x2="50" y2="22" stroke="#333" stroke-width="2" stroke-linecap="round"/>
        <circle cx="50" cy="21" r="2.5" fill="#333"/>
        <line x1="64" y1="30" x2="70" y2="22" stroke="#333" stroke-width="2" stroke-linecap="round"/>
        <circle cx="70" cy="21" r="2.5" fill="#333"/>
      </svg>
      <div class="brand-text-col">
        <span class="name">BeeTown</span>
        ${apiaryName ? `<span class="apiary-name-tag">${esc(apiaryName)}</span>` : ''}
      </div>
      ${logoHTML ? `<div class="brand-logo-wrap">${logoHTML}</div>` : ''}
    </div>
    <div class="toolbar">
      <button class="btn btn-ghost ${homeBtnHidden('all')}" id="open-all">🐝 Alle</button>
      <button class="btn btn-ghost ${homeBtnHidden('honey')}" id="open-honey">🍯 Ernte</button>
      <button class="btn btn-ghost ${homeBtnHidden('honeystir')}" id="open-honeystir">🥄 Rühren</button>
      <button class="btn btn-ghost ${homeBtnHidden('fuetterung')}" id="open-fuetterung">🍬 Fütterung</button>
      <button class="btn btn-ghost ${homeBtnHidden('lastentries')}" id="open-lastentries" title="Letzte Einträge">🕒 Letzte Einträge</button>
      <button class="btn btn-ghost ${homeBtnHidden('varroacount')}" id="open-varroacount" title="Varroa Zählung" style="padding:.4rem .6rem"><img src="./icons/varroa.png" alt="Varroa Zählung" style="width:20px;height:20px;object-fit:contain;vertical-align:middle"> Varroazählung</button>
      <button class="btn btn-ghost ${homeBtnHidden('archive')}" id="open-archive">📦 Archiv</button>
      <button class="btn btn-ghost" id="open-settings" title="Einstellungen" style="font-size:1.4rem;line-height:1">⚙︎</button>
    </div>
    ${window._showSearch!==false?`
    <div class="search-box">
      <div class="search-box-wrap">
        <input type="search" id="global-search" class="inp" placeholder="🔍 Alles durchsuchen … z. B. „Futter: Mittel“" autocomplete="off">
        <button type="button" id="global-search-clear" class="search-clear-btn" aria-label="Suche zurücksetzen" style="display:none">✕</button>
      </div>
    </div>
    <div id="search-results"></div>`:''}
    <div id="apiaries-main-content">
    ${apiaries.length===0?`
      ${emptyState('Noch keine Standorte','Lege deinen ersten Bienenstand an.')}
      <button class="btn btn-primary block" id="add-apiary-empty">+ Standort anlegen</button>`:`
    <ul class="card-list">
      ${apiaries.map((a)=>`
        <li class="card" data-open="${a.id}">
          <div class="card-main">
            <div class="card-title">${esc(a.name)}</div>
            <div class="card-sub">${esc(a.location||'–')}</div>
          </div>
          <div class="badge">${isBkName(a.name) ? `${bkCounts[a.id]} ${esc(window._bkPrefix||'BK')}s` : `${counts[a.id]} Völker`}</div>
        </li>`).join('')}
    </ul>`}
    <div class="reminders-section">
      <div class="reminder-head">
        <h2 class="section-h" style="margin:0">Erinnerungen</h2>
        <button class="btn btn-primary btn-sm" id="add-reminder">+ Erinnerung</button>
      </div>
      ${reminders.length===0
        ? '<p class="muted" style="padding:.5rem 0">Keine Erinnerungen</p>'
        : (() => {
            // Gruppieren nach Standort
            const groups = {};
            reminders.forEach(r => {
              const key = r.apiaryName || '';
              if(!groups[key]) groups[key] = [];
              groups[key].push(r);
            });
            const keys = Object.keys(groups).sort((a,b)=> a===''?1:b===''?-1:a.localeCompare(b,'de'));
            return keys.map(k => `
              ${k ? `<div class="reminder-group-head">📍 ${esc(k)}</div>` : '<div class="reminder-group-head reminder-no-apiary">Ohne Standort</div>'}
              <ul class="reminder-list">
                ${groups[k].map(r=>{
                  const due=isReminderDue(r);
                  const dateInfo = r.dueDate
                    ? `Fällig: ${fmtDate(r.dueDate)}${parseInt(r.remindDaysBefore)>0?' · ab '+parseInt(r.remindDaysBefore)+' Tagen vorher':''}`
                    : `Angelegt: ${fmtDateTime(r.createdAt)}`;
                  return `
                  <li class="reminder-item${due?' reminder-item-due':''}">
                    <div class="reminder-body">
                      <div class="reminder-text">${due?'🔔 ':''}${esc(r.text)}</div>
                      <div class="reminder-date">${dateInfo}</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:.2rem;flex-shrink:0">
                      <button class="btn btn-ghost btn-sm reminder-edit" data-id="${r.id}">✏</button>
                      <button class="btn btn-ghost btn-sm reminder-del" data-id="${r.id}">✕</button>
                    </div>
                  </li>`;}).join('')}
              </ul>`).join('');
          })()}
    </div>
    </div>
    <hr class="reminders-divider">
    <div class="donate-box">
      <p>BeeTown ist kostenlos, werbefrei und ganz ohne Tracking. Wenn dir die
      App im Imker-Alltag hilft, freue ich mich über eine kleine Spende für
      Kaffee &amp; Weiterentwicklung. 🐝☕</p>
      <a class="btn btn-ghost" href="https://www.paypal.com/donate/?hosted_button_id=F7WE7N68TBAKE" target="_blank" rel="noopener">☕ BeeTown unterstützen</a>
    </div>
    <div class="donate-box">
      <p>Idee, Wunsch oder einen Fehler gefunden? Ich freue mich über Feedback.</p>
      <a class="btn btn-ghost" href="mailto:beetown@cfrerichs.de?subject=BeeTown%20Verbesserungsvorschlag">✉️ Verbesserungsvorschlag senden</a>
    </div>`;

  /* Globale Suche (nur verdrahten, wenn das Suchfeld überhaupt angezeigt wird) */
  const searchInput = document.getElementById('global-search');
  const searchResultsEl = document.getElementById('search-results');
  const mainContentEl = document.getElementById('apiaries-main-content');
  const searchClearBtn = document.getElementById('global-search-clear');
  if(searchInput && searchResultsEl){
    const updateClearBtn = () => { if(searchClearBtn) searchClearBtn.style.display = searchInput.value ? '' : 'none'; };
    let searchGen = 0, searchDebounce;
    searchInput.addEventListener('input', () => {
      updateClearBtn();
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if(!q){ searchResultsEl.innerHTML=''; mainContentEl.style.display=''; return; }
      searchDebounce = setTimeout(async () => {
        const myGen = ++searchGen;
        mainContentEl.style.display='none';
        searchResultsEl.innerHTML = '<p class="muted" style="padding:.5rem 0">Suche läuft …</p>';
        const results = await performSearch(q);
        if(myGen !== searchGen) return; // veraltete Suche, Ergebnis ignorieren
        renderSearchResults(searchResultsEl, results, q);
      }, 300);
    });
    searchClearBtn?.addEventListener('click', () => {
      searchInput.value = '';
      updateClearBtn();
      searchResultsEl.innerHTML = '';
      mainContentEl.style.display = '';
      searchInput.focus();
    });
    /* Beim Zurückspringen aus einem Suchergebnis: Suche + Position wiederherstellen */
    if(nav.searchQuery){
      searchInput.value = nav.searchQuery;
      updateClearBtn();
      mainContentEl.style.display='none';
      searchResultsEl.innerHTML = '<p class="muted" style="padding:.5rem 0">Suche läuft …</p>';
      const restoredResults = await performSearch(nav.searchQuery);
      renderSearchResults(searchResultsEl, restoredResults, nav.searchQuery);
    }
  }

  $('#open-all').onclick=()=>go('all');
  $('#open-honey').onclick=()=>go('honey');
  $('#open-honeystir').onclick=()=>go('honeystir');
  $('#open-fuetterung').onclick=()=>go('fuetterung');
  $('#open-lastentries').onclick=()=>go('lastentries');
  $('#open-varroacount').onclick=()=>go('varroacount');
  $('#open-archive').onclick=()=>go('archive');
  $('#open-settings').onclick=()=>go('settings');
  const ae=$('#add-apiary-empty');
  if(ae) ae.onclick=()=>apiaryForm();
  app.querySelectorAll('[data-open]').forEach((el)=>el.onclick=()=>go('colonies',{apiaryId:el.dataset.open}));

  /* Erinnerungen verdrahten */
  document.getElementById('add-reminder').onclick = () => reminderForm(null, apiaries, ()=>renderApiaries());
  document.querySelectorAll('.reminder-edit').forEach(b=>b.onclick=()=>{
    const r = reminders.find(x=>x.id===b.dataset.id);
    reminderForm(r, apiaries, ()=>renderApiaries());
  });
  document.querySelectorAll('.reminder-del').forEach(b=>b.onclick=async()=>{
    if(!confirm('Erinnerung löschen?')) return;
    await api('DELETE','./api/reminders/'+b.dataset.id);
    renderApiaries();
  });
}

/* ---------- Globale Suche ---------- */
const SEARCH_KIND_LABEL = {apiary:'📍 Standort', colony:'🐝 Volk', entry:'📋 Eintrag', reminder:'🔔 Erinnerung', honey:'🍯 Ernte'};
function makeSnippet(blob, q, radius) {
  radius = radius || 40;
  const idx = blob.toLowerCase().indexOf(q);
  if(idx===-1) return blob.length>90 ? blob.slice(0,90)+'…' : blob;
  const start = Math.max(0, idx-radius);
  const end = Math.min(blob.length, idx+q.length+radius);
  return (start>0?'…':'') + blob.slice(start,end) + (end<blob.length?'…':'');
}
async function performSearch(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!terms.length) return [];
  const results = [];
  const STATUS_TEXT_ALL = { ok:'In Ordnung', watch:'Beobachten', varroa:'Varroa?', weak:'Schwach', dead:'Tot', dissolved:'Aufgelöst' };

  const [apiaries, archivedColonies, allEntries, honeyList, reminders] = await Promise.all([
    apiGet('./api/apiaries').catch(()=>[]),
    apiGet('./api/archive').catch(()=>[]),
    apiGet('./api/entries/all').catch(()=>[]),
    apiGet('./api/honey_harvests').catch(()=>[]),
    apiGet('./api/reminders').catch(()=>[]),
  ]);

  let activeColonies = [];
  await Promise.all(apiaries.map(async(a)=>{
    const cols = await apiGet('./api/colonies?apiaryId='+a.id).catch(()=>[]);
    cols.forEach((c)=>{ c.apiaryName=a.name; });
    activeColonies = activeColonies.concat(cols);
  }));
  const allColonies = activeColonies.concat(archivedColonies);

  const addIfMatch = (blob, entry) => {
    const lower = blob.toLowerCase();
    if(terms.every((t)=>lower.includes(t))){
      entry.snippet = makeSnippet(blob, terms[0]);
      results.push(entry);
    }
  };

  apiaries.forEach((a)=>{
    const blob = [a.name, a.location, a.notes].filter(Boolean).join(' · ');
    addIfMatch(blob, {kind:'apiary', title:a.name, sub:'Standort', ref:a});
  });

  allColonies.forEach((c)=>{
    const parts = [
      c.name,
      c.apiaryName ? 'Standort: '+c.apiaryName : '',
      c.status ? 'Zustand: '+(STATUS_TEXT_ALL[c.status]||c.status) : '',
      c.queenYear ? 'Königin: '+c.queenYear : '',
      c.queenNr ? 'Königinnen-Nr: '+c.queenNr : '',
      c.queenGen ? 'Generation: '+c.queenGen : '',
      c.source ? 'Herkunft: '+c.source : '',
      c.notes ? 'Notizen: '+c.notes : '',
      c.archived ? 'Archiviert' : '',
    ].filter(Boolean);
    addIfMatch(parts.join(' · '), {
      kind:'colony', title:c.name,
      sub:'Volk'+(c.apiaryName?' · '+c.apiaryName:'')+(c.archived?' · archiviert':''),
      ref:c,
    });
  });

  allEntries.forEach((e)=>{
    const extra = e.obs_extra || {};
    const obsLabels = (e.obs||[]).map((k)=>OBS_LABEL[k]||LEGACY_OBS_LABEL[k]||k);
    const parts = [
      e.type ? 'Art: '+e.type : '',
      e.date ? 'Datum: '+fmtDate(e.date) : '',
      e.notes ? 'Notizen: '+e.notes : '',
      e.temper && e.temper!=='---' ? 'Sanftmut: '+e.temper : '',
      e.strength && e.strength!=='---' ? 'Volksstärke: '+e.strength : '',
      e.food && e.food!=='---' ? 'Futter: '+e.food : '',
      obsLabels.join(', '),
      extra.gewicht ? 'Gewicht: '+extra.gewicht+' kg' : '',
      extra.fuetterType ? 'Fütterung: '+extra.fuetterType+(extra.fuetterMenge?' '+extra.fuetterMenge+' L':'') : '',
      extra.wabenPositions && extra.wabenPositions.length ? wabeBtnLabel(extra.wabenPositions) : '',
      ...OBS_SELECT_CONFIG.map((cfg)=> extra[cfg.field] ? obsSelectLabel(cfg,extra[cfg.field]) : ''),
      e.demareeAction ? 'Demaree Stufe '+e.demareeAction : '',
      e.entryHrNr ? 'HR '+e.entryHrNr : '',
      e.oxalBlockAction ? 'Oxalsäure-Block Stufe '+e.oxalBlockAction : '',
      e.varroaCount ? e.varroaCount+' Milben'+(e.varroaAnts?' · Ameisen gesehen':'') : '',
      e.colonyName ? 'Volk: '+e.colonyName : '',
      e.apiaryName ? 'Standort: '+e.apiaryName : '',
    ].filter(Boolean);
    addIfMatch(parts.join(' · '), {
      kind:'entry', title:(e.colonyName||'?')+' · '+(e.type||'Eintrag')+' · '+fmtDate(e.date),
      sub:'Eintrag'+(e.apiaryName?' · '+e.apiaryName:''),
      ref:e,
    });
  });

  reminders.forEach((r)=>{
    const parts=[r.text, r.apiaryName?'Standort: '+r.apiaryName:'', r.dueDate?'Fällig: '+fmtDate(r.dueDate):''].filter(Boolean);
    addIfMatch(parts.join(' · '), {kind:'reminder', title:r.text, sub:'Erinnerung'+(r.apiaryName?' · '+r.apiaryName:''), ref:r});
  });

  honeyList.forEach((h)=>{
    const parts=[h.tracht, h.apiaryName?'Standort: '+h.apiaryName:'', h.notizen, h.year?'Jahr: '+h.year:'', h.menge?'Menge: '+String(h.menge).replace('.',',')+' kg':''].filter(Boolean);
    addIfMatch(parts.join(' · '), {kind:'honey', title:(h.tracht||'Ernte')+' '+h.year, sub:'Honigernte'+(h.apiaryName?' · '+h.apiaryName:''), ref:h});
  });

  return results;
}
function renderSearchResults(container, results, query) {
  if(!results.length){
    container.innerHTML = `<p class="muted" style="padding:.6rem 0">Keine Treffer für „${esc(query)}“.</p>`;
    return;
  }
  container.innerHTML = `
    <p class="muted" style="padding:.3rem 0">${results.length} Treffer für „${esc(query)}“</p>
    <ul class="card-list search-results-list">
      ${results.map((r,i)=>`<li class="card search-result-item" data-i="${i}">
        <div class="card-main">
          <div class="card-title">${esc(r.title)}</div>
          <div class="card-sub">${esc(r.sub)}</div>
          <div class="card-sub search-snippet">${esc(r.snippet)}</div>
        </div>
        <div class="badge">${SEARCH_KIND_LABEL[r.kind]||r.kind}</div>
      </li>`).join('')}
    </ul>`;
  container.querySelectorAll('.search-result-item').forEach((li)=>{
    li.onclick=()=>openSearchResult(results[+li.dataset.i], query);
  });
}
async function openSearchResult(r, query) {
  if(r.kind==='apiary'){
    go('colonies', {apiaryId:r.ref.id});
  } else if(r.kind==='colony'){
    go('colony', {colonyId:r.ref.id, apiaryId:r.ref.apiaryId});
  } else if(r.kind==='entry'){
    nav.view='colony'; nav.colonyId=r.ref.colonyId; nav.apiaryId=r.ref.apiaryId;
    nav.from='apiaries'; nav.fromParams={searchQuery:query, restoreScrollY:window.scrollY};
    await renderColony();
    const target = document.getElementById('entry-'+r.ref.id);
    if(target){
      target.scrollIntoView({block:'center'});
      target.classList.add('entry-highlight');
      setTimeout(()=>target.classList.remove('entry-highlight'), 2000);
    }
  } else if(r.kind==='reminder'){
    nav.view='apiaries';
    await renderApiaries();
    const apiaries = await apiGet('./api/apiaries').catch(()=>[]);
    reminderForm(r.ref, apiaries, ()=>renderApiaries());
  } else if(r.kind==='honey'){
    nav.view='honey';
    await renderHoney();
    setTimeout(()=>{ document.querySelector(`.harvest-item[data-id="${r.ref.id}"]`)?.click(); }, 30);
  }
}

/* ---------- Erinnerungen: Fälligkeit & Formular ---------- */
function isReminderDue(r) {
  if(!r.dueDate) return false;
  const days = parseInt(r.remindDaysBefore)||0;
  return todayInput() >= addDays(r.dueDate, -days);
}
function reminderForm(existing, apiaries, after) {
  const done = after || (()=>renderApiaries());
  openModal(existing?'Erinnerung bearbeiten':'Erinnerung',`
    ${selectField('Standort','apiaryId',existing?.apiaryId||'',
      [['','— kein Standort —'], ...apiaries.map(a=>[a.id, a.name])])}
    ${textareaField('Text','text',existing?.text||'')}
    ${field('Datum','dueDate',existing?.dueDate||'','','date')}
    ${field('Erinnere Tage vorher','remindDaysBefore',existing?.remindDaysBefore||0,'','number')}`,
    async(data,close)=>{
      if(!data.text.trim()) return alert('Bitte einen Text eingeben.');
      const apiary = apiaries.find(a=>a.id===data.apiaryId);
      const payload = {
        text: data.text.trim(),
        apiaryId: data.apiaryId||'',
        apiaryName: apiary ? apiary.name : '',
        dueDate: data.dueDate||'',
        remindDaysBefore: parseInt(data.remindDaysBefore)||0,
      };
      if(existing) await api('PUT','./api/reminders/'+existing.id, payload);
      else await api('POST','./api/reminders',{...payload, createdAt:new Date().toISOString()});
      close(); done();
    },
    existing ? async(close)=>{
      if(!confirm('Erinnerung löschen?')) return;
      await api('DELETE','./api/reminders/'+existing.id);
      close(); done();
    } : null);
}
/* Snooze: pro Gerät (localStorage), damit ein Handy das andere nicht stummschaltet */
function reminderSnoozeKey(id) { return 'snoozeReminder_'+id; }
function isReminderSnoozed(r) {
  try { const until = localStorage.getItem(reminderSnoozeKey(r.id)); return !!until && todayInput() < until; }
  catch(_) { return false; }
}
function snoozeReminder(id, days) {
  try { localStorage.setItem(reminderSnoozeKey(id), addDays(todayInput(), days)); } catch(_) {}
}

/* Popup beim App-Start: fällige Erinnerungen anzeigen und direkt aufrufbar machen */
async function checkDueReminders() {
  let reminders;
  try { reminders = await apiGet('./api/reminders'); } catch(_) { return; }
  const due = reminders.filter((r)=>isReminderDue(r) && !isReminderSnoozed(r));
  if(!due.length) return;
  openModal('🔔 Erinnerungen fällig',`
    <ul class="reminder-list">
      ${due.map(r=>`<li class="reminder-item reminder-item-due" data-id="${r.id}">
        <div class="reminder-body reminder-due-popup-item" data-id="${r.id}" style="cursor:pointer">
          <div class="reminder-text">🔔 ${esc(r.text)}</div>
          <div class="reminder-date">${r.apiaryName?'📍 '+esc(r.apiaryName)+' · ':''}Fällig: ${fmtDate(r.dueDate)}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm reminder-snooze-btn" data-id="${r.id}" title="Bis morgen stummschalten">⏰ Stumm</button>
      </li>`).join('')}
    </ul>
    <p class="muted">Antippen, um die Erinnerung zu öffnen. Mit ⏰ bis morgen stummschalten.</p>`,
    async(data,close)=>{ close(); },
    null);
  document.querySelector('.modal-back .modal-foot')?.style.setProperty('display','none');
  document.querySelectorAll('.reminder-due-popup-item').forEach(el=>{
    el.onclick=async()=>{
      const r = due.find(x=>x.id===el.dataset.id);
      el.closest('.modal-back')?.remove();
      nav.view='apiaries';
      await renderApiaries();
      const apiaries = await apiGet('./api/apiaries');
      reminderForm(r, apiaries, ()=>renderApiaries());
    };
  });
  document.querySelectorAll('.reminder-snooze-btn').forEach(btn=>{
    btn.onclick=(e)=>{
      e.stopPropagation();
      snoozeReminder(btn.dataset.id, 1);
      const li=btn.closest('li');
      li?.remove();
      if(!document.querySelectorAll('.reminder-due-popup-item').length){
        document.querySelector('.modal-back')?.remove();
      }
    };
  });
}

function apiaryForm(existing,after) {
  const done=after||(()=>go('apiaries'));
  openModal(existing?'Standort bearbeiten':'Neuer Standort',`
    ${field('Name','name',existing?.name,true)}
    ${field('Lage / Ort','location',existing?.location)}
    ${textareaField('Notizen','notes',existing?.notes)}`,
    async(data,close)=>{
      if(!data.name.trim()) return alert('Bitte einen Namen eingeben.');
      if(existing) await api('PUT','./api/apiaries/'+existing.id,data);
      else await api('POST','./api/apiaries',{...data,createdAt:new Date().toISOString()});
      close(); done();
    },
    existing?async(close)=>{
      if(!confirm('Standort löschen? Aktive Völker/Einträge werden gelöscht.')) return;
      await api('DELETE','./api/apiaries/'+existing.id);
      close(); go('apiaries');
    }:null);
}

/* ---------- Völker ---------- */
async function renderColonies() {
  const apiary=(await apiGet('./api/apiaries')).find((a)=>a.id===nav.apiaryId);
  if(!apiary) return go('apiaries');
  setHeader(apiary.name,true);
  const colonies=await apiGet('./api/colonies?apiaryId='+apiary.id);
  const entryCounts={}; const swarmFlags={};
  await Promise.all(colonies.map(async c=>{
    try{
      const e=await apiGet('./api/entries?colonyId='+c.id);
      entryCounts[c.id]=e.length;
      if(e.length){
        const obs=e[0].obs||[];
        swarmFlags[c.id]=obs.includes('swarm_open')||obs.includes('swarm_capped');
      }
    } catch(_){ entryCounts[c.id]=0; }
  }));
  app.innerHTML=`
    <div class="toolbar">
      <button class="btn btn-primary" id="add-colony">+ Volk</button>
      ${colonies.length?'<button class="btn btn-ghost" id="mass-entry">≣ Sammeleintrag</button>':''}
      ${colonies.length?'<button class="btn btn-ghost" id="bulk-edit">≣ Völker bearbeiten</button>':''}
      ${colonies.length?'<button class="btn btn-ghost" id="bulk-move">↗ Standort wechseln</button>':''}
      ${colonies.length>1?'<button class="btn btn-ghost" id="sort-colonies">↕ Sortieren</button>':''}
      <button class="btn btn-ghost" id="edit-apiary" title="Standort" style="font-size:1.4rem;line-height:1">⚙︎</button>
    </div>
    ${colonies.length===0?emptyState('Noch keine Völker','Füge das erste Volk hinzu.'):`
    <ul class="card-list" id="colony-list">
      ${colonies.map((c)=>`
        <li class="card" data-id="${c.id}" data-open="${c.id}">
          <div class="status-col">
            ${(c.status==='dead')?'<span class="status-skull">💀</span>':(c.status==='dissolved')?'<span class="status-skull" title="Aufgelöst">✕</span>':(c.status==='varroa')?'<img class="status-varroa-icon" src="./icons/varroa.png" title="Varroa?" alt="Varroa?">':'<div class="dot dot-'+esc(c.status||'ok')+'" title="Zustand"></div>'}
${c.requeueFlag?(()=>{const _r=c.requeueReasons?JSON.parse(c.requeueReasons||'[]'):[];const _cls=_r.includes('Sanftmut')?'requeue-dot-red':'';return `<span class="requeue-dot ${_cls}" title="Umweiselung">⚠</span>`;})():''}
            ${c.breedFlag?'<span class="breed-dot" title="Nachzucht">⭐</span>':''}
          </div>
          <div class="card-main">
            <div class="card-title">${esc(c.name)} <span class="entry-count-badge">(${entryCounts[c.id]||0})</span>${swarmFlags[c.id]?'<span title="Schwarmstimmung" style="margin-left:.3rem;font-size:1rem">🪽</span>':''}</div>
            <div class="card-sub">${queenInfoLine(c)} ${hrCountBadge(c)}</div>
            ${c.source?`<div class="card-source">${esc(c.source)}</div>`:''}
            ${c.weiselprobeDate ? `<div class="demaree-badge">🐝 Weiselprobe: ${fmtDate(c.weiselprobeDate)}</div>` : ''}
            ${c.kaefigungDate ? (() => {
              const days = Math.floor((Date.now()-new Date(c.kaefigungDate))/86400000);
              return `<div class="kaef-badge">${KAEFIG_SVG} Käfigung: ${days} Tage</div>`;
            })() : ''}
            ${c.koeniginFreiDate ? `<div class="demaree-badge">👑 freigelassen: ${fmtDate(c.koeniginFreiDate)}</div>` : ''}
            ${c.demareeStage?`<div class="demaree-badge ${c.demareeEndedAt?'demaree-done':''}">${demareeLabel(c)}</div>`:''}
            ${c.oxalBlockStage?`<div class="demaree-badge ${oxalBlockInfo(c)?.done?'demaree-done':''}">${OXAL_BLOCK_ICON} ${oxalBlockLabel(c)}</div>`:''}
          </div>
        </li>`).join('')}
    </ul>`}`;

  $('#add-colony').onclick=()=>colonyForm(apiary.id);
  $('#edit-apiary').onclick=()=>apiaryForm(apiary,()=>renderColonies());
  const me=$('#mass-entry'); if(me) me.onclick=()=>massEntryForm(apiary.id,colonies);
  const be=$('#bulk-edit'); if(be) be.onclick=()=>bulkColonyForm(colonies);
  const bm=$('#bulk-move'); if(bm) bm.onclick=()=>bulkMoveForm(apiary.id,colonies);
  const sc=$('#sort-colonies'); if(sc) sc.onclick=()=>enableSortMode();
  app.querySelectorAll('[data-open]').forEach((el)=>el.onclick=()=>go('colony',{colonyId:el.dataset.open,from:null,fromParams:null,backScrollY:window.scrollY}));
}

function enableSortMode() {
  const list=document.getElementById('colony-list');
  if(!list) return;
  /* Klick-Handler wirklich entfernen (nicht nur das Attribut), sonst
     navigiert ein Klick neben den Pfeilen weiterhin zum Volk und die
     Sortier-Ansicht "schließt sich". */
  list.querySelectorAll('[data-open]').forEach((el)=>{ el.removeAttribute('data-open'); el.onclick=null; });
  const redraw=()=>{
    const items=[...list.querySelectorAll('li.card')];
    items.forEach((card,i)=>{
      let ctrl=card.querySelector('.sort-ctrl');
      if(!ctrl){ctrl=document.createElement('div');ctrl.className='sort-ctrl';card.appendChild(ctrl);}
      ctrl.innerHTML=
`<button class="sort-btn" data-up="1">▲</button><button class="sort-btn" data-down="1">▼</button>`;
      ctrl.querySelector('[data-up]')?.addEventListener('click',(e)=>{
        e.stopPropagation();
        if(card.previousElementSibling){ list.insertBefore(card,card.previousElementSibling); }
        else { list.appendChild(card); } /* oben -> ganz nach unten */
        redraw();
      });
      ctrl.querySelector('[data-down]')?.addEventListener('click',(e)=>{
        e.stopPropagation();
        if(card.nextElementSibling){ list.insertBefore(card.nextElementSibling,card); }
        else { list.insertBefore(card,list.firstElementChild); } /* unten -> ganz nach oben */
        redraw();
      });
    });
  };
  redraw();
  const sortBtn=document.getElementById('sort-colonies');
  if(sortBtn){
    sortBtn.textContent='✓ Fertig';
    sortBtn.classList.replace('btn-ghost','btn-primary');
    sortBtn.onclick=async()=>{
      const order=[...list.querySelectorAll('li[data-id]')].map((li)=>li.dataset.id);
      try{ await api('POST','./api/colonies/reorder',{order}); } catch(err){ alert('Fehler: '+err.message); }
      renderColonies();
    };
    if(!document.getElementById('sort-az')){
      const azBtn=document.createElement('button');
      azBtn.className='btn btn-ghost';
      azBtn.id='sort-az';
      azBtn.textContent='A–Z';
      sortBtn.insertAdjacentElement('beforebegin',azBtn);
      azBtn.onclick=(e)=>{
        e.stopPropagation();
        const items=[...list.querySelectorAll('li.card')];
        items.sort((a,b)=>{
          const ta=(a.querySelector('.card-title')?.childNodes[0]?.nodeValue||'').trim().toLowerCase();
          const tb=(b.querySelector('.card-title')?.childNodes[0]?.nodeValue||'').trim().toLowerCase();
          return ta.localeCompare(tb,'de');
        });
        items.forEach((item)=>list.appendChild(item));
        redraw();
      };
    }
  }
}

async function bulkMoveForm(currentApiaryId, colonies) {
  if(colonies.length===0) return;
  const apiaries=(await apiGet('./api/apiaries')).filter((a)=>a.id!==currentApiaryId);
  if(apiaries.length===0){ alert('Kein anderer Standort vorhanden.'); return; }
  openModal('Völker verschieben',`
    <label class="lbl">Ziel-Standort</label>
    <select class="inp" name="targetApiaryId">
      <option value="" selected disabled>— bitte wählen —</option>
      ${apiaries.map((a)=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}
    </select>
    <label class="lbl" style="margin-top:.8rem">Völker auswählen *</label>
    <label class="check-item"><input type="checkbox" id="move-select-all"><span><strong>Alle auswählen</strong></span></label>
    <div class="check-list">${colonies.map((c)=>`<label class="check-item"><input type="checkbox" class="move-col-check" value="${c.id}"><span>${esc(c.name)}</span></label>`).join('')}</div>`,
    async(data,close)=>{
      if(!data.targetApiaryId) return alert('Bitte einen Ziel-Standort auswählen.');
      const ids=[...document.querySelectorAll('.move-col-check:checked')].map((x)=>x.value);
      if(ids.length===0) return alert('Bitte mindestens ein Volk auswählen.');
      for(const cid of ids){
        const col=colonies.find((c)=>c.id===cid);
        if(col) await api('PUT','./api/colonies/'+cid,{...col,apiaryId:data.targetApiaryId});
      }
      close(); renderColonies();
    },null);
  document.getElementById('move-select-all')?.addEventListener('change',(e)=>{
    document.querySelectorAll('.move-col-check').forEach((chk)=>chk.checked=e.target.checked);
  });
}

async function bulkColonyForm(colonies) {
  openModal('Völker bearbeiten',`
    <p class="muted">Wähle Völker aus. Nur ausgefüllte Felder werden überschrieben.</p>
    <label class="lbl">Völker auswählen *</label>
    <div class="check-list">
      ${colonies.map((c)=>`<label class="check-item">
        <input type="checkbox" class="col-check" value="${c.id}"><span>${esc(c.name)}</span></label>`).join('')}
    </div>
    ${field('Herkunft','source','')}
    ${selectField('Zustand','status','',[['','— nicht ändern —'],['ok','In Ordnung'],['watch','Beobachten'],['varroa','Varroa?'],['weak','Schwach'],['dead','Tot'],['dissolved','Aufgelöst']])}
    ${textareaField('Notiz (wird überschrieben)','notes','')}
    <label class="lbl" style="margin-top:.5rem">Umlarvdatum (leer = nicht ändern)</label>
    <input class="inp" name="umlarvDate" type="date" value="">`,
    async(data,close)=>{
      const ids=[...document.querySelectorAll('.col-check:checked')].map((x)=>x.value);
      if(ids.length===0) return alert('Bitte mindestens ein Volk auswählen.');
      const fields={};
      if(data.source.trim())   fields.source     = data.source.trim();
      if(data.status)          fields.status      = data.status;
      if(data.notes.trim())    fields.notes       = data.notes.trim();
      if(data.umlarvDate)      fields.umlarvDate  = data.umlarvDate;
      if(Object.keys(fields).length===0) return alert('Kein Feld ausgewählt.');
      await api('POST','./api/colonies/bulk-update',{ids,fields});
      close(); renderColonies();
    },null);
}

/* ---------- Volk-Formular ---------- */
async function colonyForm(apiaryId, existing) {
  const scales = await apiGet('./api/scales');
  const scaleOpts = [['','— keine —'], ...scales.map((s)=>[s.id, s.name])];
  let defaultZiel = existing?.zielGewicht || '';
  if(!existing){
    try{ const s = await apiGet('./api/settings'); defaultZiel = s.zielGewicht || ''; }catch(_){}
  }
  openModal(existing?'Volk bearbeiten':'Neues Volk',`
    ${field('Name / Nummer','name',existing?.name,true)}
    ${queenYearField(existing?.queenYear, existing?.queenNr)}
    ${selectField('Königin Generation','queenGen',existing?.queenGen||'',[['','— unbekannt —'],['F0','F0'],['F1','F1'],['F2','F2'],['Fx','Fx']])}
    ${selectField('Zustand','status',existing?.status||'ok',[['ok','In Ordnung'],['watch','Beobachten'],['varroa','Varroa?'],['weak','Schwach'],['dead','Tot'],['dissolved','Aufgelöst']])}
    ${field('Herkunft','source',existing?.source)}
    ${selectField('Waage','scaleId',existing?.scaleId||'',scaleOpts)}
    ${textareaField('Notizen','notes',existing?.notes)}
    <hr class="form-divider">
    <label class="lbl form-section-label">Gewicht</label>
    ${field('Aktuelles Gewicht (kg)','currentWeight',existing?.currentWeight||'','','number')}
    ${existing?.currentWeightDate ? `<p class="muted" style="margin:.1rem 0 .5rem">Stand: ${fmtDate(existing.currentWeightDate)}</p>` : ''}
    ${field('Ziel-Gewicht (kg)','zielGewicht',defaultZiel,'','number')}
    <hr class="form-divider">
    <label class="lbl form-section-label">Honigraume</label>
    <div id="hr-list"></div>
    <button type="button" class="btn btn-ghost" id="btn-add-hr" style="${parseHR(existing||{}).length>=5?'display:none':''}">+ Honigraum hinzufügen</button>
    <hr class="form-divider">
    <label class="lbl form-section-label">Demaree-Verfahren</label>
    ${selectField('Stufe','demareeStage',existing?.demareeStage||'',[['','—'],['1','Stufe 1'],['2','Stufe 2'],['3','Stufe 3'],['4','Stufe 4'],['5','Stufe 5']])}
    ${field('Gesetzt am','demareedAt',existing?.demareedAt||'','','date')}
    ${field('Abgeschlossen am','demareeEndedAt',existing?.demareeEndedAt||'','','date')}
    <hr class="form-divider">
    ${field('Käfigung','kaefigungDate',existing?.kaefigungDate||'','','date')}
    ${field('👑 Königin freigelassen','koeniginFreiDate',existing?.koeniginFreiDate||'','','date')}
    <hr class="form-divider">
    <label class="lbl form-section-label">${OXAL_BLOCK_ICON} Oxalsäure-Blockbehandlung</label>
    ${selectField('Stufe','oxalBlockStage',existing?.oxalBlockStage||'',[['','—'],['1','Stufe 1'],['2','Stufe 2'],['3','Stufe 3'],['4','Stufe 4'],['5','Stufe 5'],['6','Stufe 6']])}
    ${field('Erste Stufe (Bedampfung) am','oxalBlockStartAt',existing?.oxalBlockStartAt||'','','date')}
    ${field('Letzte Stufe am','oxalBlockLastAt',existing?.oxalBlockLastAt||'','','date')}
    <p class="muted" style="margin:.1rem 0 .5rem">Gilt nach 22 Tagen ab der ersten Stufe automatisch als abgeschlossen.</p>
    <hr class="form-divider">
    <label class="lbl form-section-label">Begattungskasten / Königinnenzucht</label>
    ${field('Umlarvdatum','umlarvDate',existing?.umlarvDate||'','','date')}
    ${field('Weiselprobe eingehängt','weiselprobeDate',existing?.weiselprobeDate||'','','date')}
    <hr class="form-divider">
    ${existing?`
    <button type="button" class="btn btn-ghost block" id="m-requeue">⚠ Umweiselung markieren</button>
    <button type="button" class="btn btn-ghost block ${existing.breedFlag?'btn-active':''}" id="m-breed">${existing.breedFlag?'⭐ Nachzucht aufheben':'⭐ Als Nachzucht markieren'}</button>
    <button type="button" class="btn btn-ghost block" id="m-archive">📦 Ins Archiv verschieben</button>`:''}`,
    async(data,close)=>{
      if(!data.name.trim()) return alert('Bitte einen Namen eingeben.');
      // honigRaeume aus hidden input holen (liegt außerhalb der form)
      const hrInp = document.getElementById('hr-data-input');
      if(hrInp) data.honigRaeume = hrInp.value;
      if(existing){
        // existing als Basis – verhindert dass Felder wie requeueFlag etc. verloren gehen
        const payload = {...existing, ...data};
        await api('PUT','./api/colonies/'+existing.id, payload);
      } else {
        await api('POST','./api/colonies',{...data,apiaryId,createdAt:new Date().toISOString()});
      }
      close(); renderColonies();
    },
    existing?async(close)=>{
      if(!confirm('Volk inkl. aller Einträge endgültig löschen?')) return;
      await api('DELETE','./api/colonies/'+existing.id);
      close(); go('colonies',{apiaryId});
    }:null, true);

  wireQueenYearColor();
  wireHR(existing);

  if(existing){
    const ab=document.getElementById('m-archive');
    if(ab) ab.onclick=async()=>{
      if(!confirm('Volk ins Archiv verschieben?')) return;
      ab.disabled=true;
      try{ await api('POST','./api/colonies/'+existing.id+'/archive'); document.querySelector('.modal-back')?.remove(); go('colonies',{apiaryId}); }
      catch(err){alert('Fehler: '+err.message);ab.disabled=false;}
    };
    const rq=document.getElementById('m-requeue');
    if(rq) rq.onclick=()=>{ document.querySelector('.modal-back')?.remove(); requeueForm(existing,apiaryId); };
    const br=document.getElementById('m-breed');
    if(br) br.onclick=async()=>{
      await api('PUT','./api/colonies/'+existing.id,{...existing,breedFlag:existing.breedFlag?0:1});
      document.querySelector('.modal-back')?.remove(); renderColonies();
    };
  }
}

function requeueForm(colony, apiaryId) {
  const current = colony.requeueReasons ? JSON.parse(colony.requeueReasons) : [];
  openModal('Umweiselung markieren',`
    <p class="muted">Gründe (mehrere möglich):</p>
    <div class="check-list">
      ${REQUEUE_REASONS.map((r)=>`<label class="check-item">
        <input type="checkbox" class="rq-check" value="${r}" ${current.includes(r)?'checked':''}><span>${esc(r)}</span></label>`).join('')}
    </div>
    ${textareaField('Sonstige Begründung','requeueNote',colony.requeueNote||'')}
    <label class="check-item" style="margin-top:.5rem">
      <input type="checkbox" id="rq-clear"> <span>Markierung aufheben</span></label>`,
    async(data,close)=>{
      const clear=document.getElementById('rq-clear')?.checked;
      const reasons=[...document.querySelectorAll('.rq-check:checked')].map((x)=>x.value);
      await api('PUT','./api/colonies/'+colony.id,{...colony,requeueFlag:clear?0:1,requeueReasons:clear?'[]':JSON.stringify(reasons),requeueNote:clear?'':data.requeueNote});
      close(); renderColonies();
    },null);
}

/* ---------- Stockkarte ---------- */
async function renderColony() {
  const colony=await apiGet('./api/colonies/'+nav.colonyId);
  if(!colony) return go('colonies',{apiaryId:nav.apiaryId});
  const isArchived=!!colony.archived;
  nav.apiaryId=colony.apiaryId;
  setHeader(colony.name,true);
  const entries=await apiGet('./api/entries?colonyId='+colony.id);
  _lastEntryHash = JSON.stringify(entries.map(e=>e.id+(e.createdAt||'')));
  startAutoRefresh();

  let scaleLink='';
  if(colony.scaleId){
    const scales=await apiGet('./api/scales');
    const scale=scales.find((s)=>s.id===colony.scaleId);
    if(scale&&scale.url) scaleLink=`<a class="btn btn-ghost btn-sm scale-link" href="${esc(scale.url)}" target="_blank" rel="noopener">⚖️ ${esc(scale.name)}</a>`;
  }

  app.innerHTML=`
    <div class="colony-head">
      ${(colony.status==='dead')?'<span class="status-skull status-skull-lg">💀</span>':(colony.status==='dissolved')?'<span class="status-skull status-skull-lg" title="Aufgelöst">✕</span>':(colony.status==='varroa')?'<img class="status-varroa-icon status-varroa-icon-lg" src="./icons/varroa.png" title="Varroa?" alt="Varroa?">':'<div class="dot dot-'+esc(colony.status||'ok')+' dot-lg" title="Zustand"></div>'}
      <div class="colony-meta">
        ${isArchived?'<span class="badge">📦 Archiviert · nur lesbar</span>':''}
        <div class="card-sub">${queenInfoLine(colony)}</div>
        ${colony.notes?`<div class="note-block">${esc(colony.notes)}</div>`:''}
        <div id="umlarv-info-block"></div>
        ${(colony.weiselprobeDate || colony.kaefigungDate || colony.koeniginFreiDate) ? `
        <div class="umlarv-info">
          ${colony.weiselprobeDate ? `
          <div class="umlarv-row">
            <span class="umlarv-label">🐝 Weiselprobe:</span>
            <span class="umlarv-date">${fmtDate(colony.weiselprobeDate)}</span>
          </div>` : ''}
          ${colony.kaefigungDate ? (() => {
            const days = Math.floor((Date.now()-new Date(colony.kaefigungDate))/86400000);
            return `<div class="umlarv-row">
              <span class="umlarv-label">${KAEFIG_SVG} Käfigung:</span>
              <span class="umlarv-date umlarv-future">${fmtDate(colony.kaefigungDate)} (${days} Tage)</span>
            </div>`;
          })() : ''}
          ${colony.koeniginFreiDate ? `
          <div class="umlarv-row">
            <span class="umlarv-label">👑 freigelassen:</span>
            <span class="umlarv-date">${fmtDate(colony.koeniginFreiDate)}</span>
          </div>` : ''}
        </div>` : ''}
        ${colony.demareeStage?`<div class="demaree-badge ${colony.demareeEndedAt?'demaree-done':''}">${demareeLabel(colony)}</div>`:''}
        ${colony.oxalBlockStage?`<div class="demaree-badge ${oxalBlockInfo(colony)?.done?'demaree-done':''}">${OXAL_BLOCK_ICON} ${oxalBlockLabel(colony)}</div>`:''}
        ${requeueBadge(colony)}${breedBadge(colony)}${scaleLink}
      </div>
      ${isArchived?'':'<button class="btn btn-ghost btn-sm" id="edit-colony">Bearbeiten</button>'}
    </div>
    ${isArchived?'':'<div class="toolbar"><button class="btn btn-primary" id="add-entry">+ Eintrag</button></div>'}
    <h2 class="section-h">Stockkarte</h2>
    ${entries.length===0?emptyState('Noch keine Einträge','Dokumentiere die erste Durchsicht.'):`
    <ul class="timeline">
      ${entries.map((e)=>{
        const extra=e.obs_extra?(typeof e.obs_extra==='string'?JSON.parse(e.obs_extra):e.obs_extra):{};
        return `<li class="entry" id="entry-${esc(e.id)}">
          <div class="entry-date">${fmtDate(e.date)}</div>
          <div class="entry-body">
            <div class="entry-type">${esc(e.type)}</div>
            ${obsChipsHTML(e.obs,extra)}
            ${e.temper&&e.temper!=='---'?`<span class="obs-chip">Sanftmut: ${esc(e.temper)}</span>`:''}
            ${e.strength&&e.strength!=='---'?`<span class="obs-chip">Volksstärke: ${esc(e.strength)}</span>`:''}
            ${e.food&&e.food!=='---'?`<span class="obs-chip">Futter: ${esc(e.food)}</span>`:''}
            ${e.demareeAction?`<div class="entry-badge entry-badge-demaree">Demaree Stufe ${esc(e.demareeAction)}</div>`:''}
            ${e.oxalBlockAction?`<div class="entry-badge entry-badge-oxblock">${OXAL_BLOCK_ICON} Block Stufe ${esc(e.oxalBlockAction)}</div>`:''}
            ${varroaCountBadgeHTML(e)}
            ${e.entryHrNr?`<div class="entry-badge entry-badge-hr">🍯 HR ${esc(e.entryHrNr)}</div>`:''}
            ${e.notes?`<div class="entry-notes">${esc(e.notes)}</div>`:''}
            <div class="photos">${(e.photos||[]).map((p)=>`
              <figure class="photo-fig">
                <img class="thumb" loading="lazy" src="${photoURL(p.id)}" data-full="${photoURL(p.id)}" data-cap="${esc(p.caption||'')}">
                ${p.caption?`<figcaption>${esc(p.caption)}</figcaption>`:''}
              </figure>`).join('')}</div>
          </div>
          ${isArchived?'':`<button class="btn btn-ghost btn-sm" data-edit="${e.id}">⋯</button>`}
        </li>`;
      }).join('')}
    </ul>`}`;

  // Umlarv-Info asynchron laden
  apiGet('./api/settings').then(settings => {
    const block = document.getElementById('umlarv-info-block');
    if (block) block.innerHTML = umlarvInfo(colony, settings);
  }).catch(()=>{});
  if(!isArchived){
    $('#edit-colony').onclick=()=>colonyForm(colony.apiaryId,colony);
    $('#add-entry').onclick=()=>entryForm(colony.id,null,colony,entries);
    app.querySelectorAll('[data-edit]').forEach((el)=>{
      const e=entries.find((x)=>x.id===el.dataset.edit);
      el.onclick=()=>entryForm(colony.id,e,colony,entries);
    });
  }
  app.querySelectorAll('.thumb').forEach((im)=>im.onclick=()=>openLightbox(im.dataset.full,im.dataset.cap));
}

/* ---------- Eintrag ---------- */
function entryForm(colonyId, existing, colony, allEntries) {
  const photos=existing?(existing.photos||[]).map((p)=>({...p})):[];
  const obs=new Set(existing?.obs||[]);
  const existingExtra=existing?.obs_extra?(typeof existing.obs_extra==='string'?JSON.parse(existing.obs_extra):existing.obs_extra):{};
  const swarmCounts={swarm_open_count:existingExtra.swarm_open_count||0,swarm_capped_count:existingExtra.swarm_capped_count||0};
  /* Altdaten (frühere Einzel-Toggles) migrieren, dann aus dem obs-Set entfernen */
  const selectValues={
    swarmMood: existingExtra.swarmMood || legacySwarmMoodFromObs(existing?.obs),
    wildbauLevel: existingExtra.wildbauLevel || legacyWildbauLevelFromStufe(existingExtra.wildbau_stufe),
    wabenAnzahl: existingExtra.wabenAnzahl || '',
  };
  ['no_ss','ss_stark','ss_normal','ss_gering','wildbau'].forEach((k)=>obs.delete(k));

  const TEMPER_OPTIONS   = ['---','5 – sehr sanft','4 – sanft','3 – mittel','2 – lebhaft','1 – stechlustig'];
  const STRENGTH_OPTIONS = ['---','5 – sehr stark','4 – stark','3 – mittel','2 – schwach','1 – sehr schwach'];
  const FOOD_OPTIONS     = ['---','5 – Zu viel','4 – Gut','3 – Mittel','2 – Gering','1 – Nichts'];
  const FUETTER_TYPES    = ['Zuckerwasser (1 : 1,2)','Zuckerwasser (1 : 1)','Zuckerwasser (3 : 2)','Sirup'];

  const curStage = colony ? (parseInt(colony.demareeStage)||0) : 0;
  const nextStage = Math.min(curStage+1, 5);
  const demareeButtonLabel = colony?.demareeStage ? `🔄 Demaree → Stufe ${nextStage}` : `🔄 Demaree starten (Stufe 1)`;
  let demareeActionVal = existing?.demareeAction || '';
  const oxBlockInfoCur = colony ? oxalBlockInfo(colony) : null;
  const oxNextStage = (!colony?.oxalBlockStage || oxBlockInfoCur?.done) ? 1 : (parseInt(colony.oxalBlockStage)||0)+1;
  const oxalBlockButtonLabel = (colony?.oxalBlockStage && !oxBlockInfoCur?.done) ? `${OXAL_BLOCK_ICON} Block → Stufe ${oxNextStage}` : `${OXAL_BLOCK_ICON} Block starten (Stufe 1)`;
  let oxalBlockActionVal = existing?.oxalBlockAction || '';
  let entryHrNr = existing?.entryHrNr || '';
  let entryWeiselprobe = existing?.obs?.includes('weiselprobe') || false;
  let entryKaefigung      = existing?.obs?.includes('kaefigung')      || false;
  let entryOxal           = existing?.obs?.includes('oxal')           || false;
  let entryKoeniginFrei   = existing?.obs?.includes('koeniginFrei')   || false;
  let entryWabenPositions = (existingExtra.wabenPositions||[]).slice();

  openModal(existing?'Eintrag bearbeiten':'Neuer Eintrag',`
    ${obsTogglesHTML(obs,swarmCounts,selectValues)}
    <label class="lbl">Aktionen</label>
    <div class="action-btns">
      <button type="button" class="obs-btn ${actionBtnHidden('demaree')} ${demareeActionVal?'on':''}" id="btn-demaree">${demareeButtonLabel}</button>
      <button type="button" class="obs-btn ${actionBtnHidden('hr')} ${entryHrNr?'on':''}" id="btn-hr">🍯 ${entryHrNr ? 'HR '+entryHrNr : '+ HR'}</button>
      <button type="button" class="obs-btn ${actionBtnHidden('weiselprobe')} ${entryWeiselprobe?'on':''}" id="btn-weiselprobe">🐝 + Weiselprobe</button>
      <button type="button" class="obs-btn ${actionBtnHidden('oxal')} ${entryOxal?'on':''}" id="btn-oxal">🧪 Oxalsäure Bedampfung</button>
      <button type="button" class="obs-btn ${actionBtnHidden('oxalblock')} ${oxalBlockActionVal?'on':''}" id="btn-oxal-block">${oxalBlockButtonLabel}</button>
      <button type="button" class="obs-btn ${actionBtnHidden('kaefigung')} ${entryKaefigung?'on':''}" id="btn-kaefigung">${KAEFIG_SVG} Käfigung</button>
      <button type="button" class="obs-btn ${actionBtnHidden('koeniginfrei')} ${entryKoeniginFrei?'on':''}" id="btn-koenigin-frei">👑 freigelassen</button>
      <button type="button" class="obs-btn ${actionBtnHidden('fuettern')} ${existingExtra.fuetterType?'on':''}" id="btn-fuettern">🍯 Fütterung</button>
      <button type="button" class="obs-btn ${actionBtnHidden('wabentyp')} ${entryWabenPositions.length?'on':''}" id="btn-wabentyp">${wabeBtnLabelHtml(entryWabenPositions)}</button>
    </div>
    <div id="fuetter-block" style="${existingExtra.fuetterType?'':'display:none'}">
      ${selectField('Fütterungsart','fuetterType',existingExtra.fuetterType||FUETTER_TYPES[0],FUETTER_TYPES.map(t=>[t,t]))}
      ${field('Menge (Liter)','fuetterMenge',existingExtra.fuetterMenge||'','','number')}
    </div>
    ${selectField('Art','type',existing?.type||'',ENTRY_TYPES.map((t)=>[t,t]))}
    ${field('Datum','date',existing?.date||todayInput(),true,'date')}
    ${selectField('Sanftmut','temper',existing?.temper||'---',TEMPER_OPTIONS.map((t)=>[t,t]))}
    ${selectField('Volksstärke','strength',existing?.strength||'---',STRENGTH_OPTIONS.map((t)=>[t,t]))}
    ${selectField('Futter','food',existing?.food||'---',FOOD_OPTIONS.map((t)=>[t,t]))}
    ${field('Gewicht (kg)','gewicht',existingExtra.gewicht||'','','number')}
    ${textareaField('Notizen','notes',existing?.notes)}
    ${photoButtonsHTML()}`,
    async(data,close)=>{
      const obs_extra={...swarmCounts, ...selectValues,
        gewicht: data.gewicht||'',
        fuetterType: document.getElementById('btn-fuettern')?.classList.contains('on') ? (data.fuetterType||'') : '',
        fuetterMenge: document.getElementById('btn-fuettern')?.classList.contains('on') ? (data.fuetterMenge||'') : '',
        wabenPositions: entryWabenPositions};
      const oxalBtn=document.getElementById('btn-oxal');
      if(oxalBtn?.classList.contains('on')) obs.add('oxal');
      else obs.delete('oxal');
      if(entryWeiselprobe) obs.add('weiselprobe');
      else obs.delete('weiselprobe');
      if(entryKaefigung) obs.add('kaefigung');
      else obs.delete('kaefigung');
      if(entryKoeniginFrei) obs.add('koeniginFrei');
      else obs.delete('koeniginFrei');
      const payload={...data,photos,obs:[...obs],obs_extra,demareeAction:demareeActionVal,entryHrNr,oxalBlockAction:oxalBlockActionVal};
      if(existing) await api('PUT','./api/entries/'+existing.id,payload);
      else await api('POST','./api/entries',{...payload,colonyId,createdAt:new Date().toISOString()});
      /* Alle colony-Updates in einem einzigen PUT zusammenfassen */
      if(colony){
        let colonyUpdate = {...colony};
        let needsUpdate = false;
        if(demareeActionVal){
          colonyUpdate.demareeStage = String(nextStage);
          colonyUpdate.demareedAt   = data.date || todayInput();
          colonyUpdate.demareeEndedAt = '';
          needsUpdate = true;
        }
        if(oxalBlockActionVal){
          colonyUpdate.oxalBlockStage = String(oxNextStage);
          colonyUpdate.oxalBlockLastAt = data.date || todayInput();
          if(oxNextStage === 1){ colonyUpdate.oxalBlockStartAt = data.date || todayInput(); }
          needsUpdate = true;
          await scheduleOxalBlockReminder(colony, data.date || todayInput(), oxNextStage);
        }
        if(entryWeiselprobe){
          colonyUpdate.weiselprobeDate = data.date || todayInput();
          needsUpdate = true;
        } else if(existing?.obs?.includes('weiselprobe')) {
          colonyUpdate.weiselprobeDate = '';
          needsUpdate = true;
        }
        if(entryKaefigung){
          colonyUpdate.kaefigungDate = data.date || todayInput();
          needsUpdate = true;
        } else if(existing?.obs?.includes('kaefigung')) {
          colonyUpdate.kaefigungDate = '';
          needsUpdate = true;
        }
        if(entryKoeniginFrei){
          colonyUpdate.koeniginFreiDate = data.date || todayInput();
          needsUpdate = true;
        } else if(existing?.obs?.includes('koeniginFrei')) {
          colonyUpdate.koeniginFreiDate = '';
          needsUpdate = true;
        }
        if(data.gewicht){
          colonyUpdate.currentWeight = data.gewicht;
          colonyUpdate.currentWeightDate = data.date || todayInput();
          needsUpdate = true;
        }
        if(entryHrNr){
          const hrs = parseHR(colony);
          if(!hrs.find(h=>h.nr===entryHrNr) && hrs.length<5){
            hrs.push({nr:entryHrNr, date:data.date||todayInput()});
            colonyUpdate.honigRaeume = JSON.stringify(hrs);
            needsUpdate = true;
          }
        }
        if(needsUpdate) await api('PUT','./api/colonies/'+colony.id, colonyUpdate);
      }
      close(); renderColony();
    },
    existing?async(close)=>{
      if(!confirm('Diesen Eintrag löschen?')) return;
      await api('DELETE','./api/entries/'+existing.id);
      close(); renderColony();
    }:null);

  const typeSelect = document.querySelector('.modal-body select[name="type"]');

  /* "Buttons"-Button: Aktions-/Beobachtungs-Buttons per Popup ein-/ausblenden (direkt links neben Speichern) */
  const saveBtn = document.getElementById('m-save');
  if(saveBtn){
    const btnsBtn=document.createElement('button');
    btnsBtn.type='button';
    btnsBtn.className='btn btn-ghost btn-sm';
    btnsBtn.textContent='Buttons';
    btnsBtn.onclick=()=>openButtonManager();
    const saveWrap=document.createElement('div');
    saveWrap.style.cssText='display:flex;gap:.5rem;align-items:center';
    saveBtn.parentNode.insertBefore(saveWrap, saveBtn);
    saveWrap.appendChild(btnsBtn);
    saveWrap.appendChild(saveBtn);
  }

  /* Weiselprobe */
  const weiselBtn = document.getElementById('btn-weiselprobe');
  if(weiselBtn){
    weiselBtn.classList.toggle('on', entryWeiselprobe);
    weiselBtn.onclick = () => {
      entryWeiselprobe = !entryWeiselprobe;
      weiselBtn.classList.toggle('on', entryWeiselprobe);
    };
  }

  /* Oxalsäure */
  const oxalBtnEl = document.getElementById('btn-oxal');
  if(oxalBtnEl){
    if(existing?.obs?.includes('oxal')) oxalBtnEl.classList.add('on');
    oxalBtnEl.addEventListener('click', function(){ this.classList.toggle('on'); });
  }

  /* Käfigung – setzt Datum am Volk */
  const kaefBtn = document.getElementById('btn-kaefigung');
  if(kaefBtn){
    kaefBtn.classList.toggle('on', entryKaefigung);
    kaefBtn.onclick = () => {
      entryKaefigung = !entryKaefigung;
      kaefBtn.classList.toggle('on', entryKaefigung);
    };
  }

  const koeFreibtn = document.getElementById('btn-koenigin-frei');
  if(koeFreibtn){
    koeFreibtn.classList.toggle('on', entryKoeniginFrei);
    koeFreibtn.onclick = () => {
      entryKoeniginFrei = !entryKoeniginFrei;
      koeFreibtn.classList.toggle('on', entryKoeniginFrei);
    };
  }

  const fuetternBtn = document.getElementById('btn-fuettern');
  if(fuetternBtn){
    fuetternBtn.onclick = () => {
      fuetternBtn.classList.toggle('on');
      const fb = document.getElementById('fuetter-block');
      if(fb) fb.style.display = fuetternBtn.classList.contains('on') ? '' : 'none';
      if(fuetternBtn.classList.contains('on') && typeSelect){
        typeSelect.value = 'Fütterung';
      }
    };
  }

  const hrBtn=document.getElementById('btn-hr');
  if(hrBtn) hrBtn.onclick=()=>{
    openModal('Honigraum',`
      <label class="lbl">HR-Nummer</label>
      <input class="inp" name="hrNr" type="text" maxlength="2" placeholder="-- = keiner" value="${entryHrNr||''}">
      <p class="muted">Leer lassen = kein HR für diesen Eintrag</p>`,
      (data,close)=>{ entryHrNr=data.hrNr.trim()||''; hrBtn.textContent = entryHrNr ? '🍯 HR '+entryHrNr : '🍯 + HR'; hrBtn.classList.toggle('on',!!entryHrNr); close(); return Promise.resolve(); },null);
  };
  const demBtn=document.getElementById('btn-demaree');
  if(demBtn) demBtn.onclick=()=>{ demareeActionVal=demareeActionVal?'':String(nextStage); demBtn.classList.toggle('on',!!demareeActionVal); };
  const oxBlockBtn=document.getElementById('btn-oxal-block');
  if(oxBlockBtn) oxBlockBtn.onclick=()=>{ oxalBlockActionVal=oxalBlockActionVal?'':String(oxNextStage); oxBlockBtn.classList.toggle('on',!!oxalBlockActionVal); };

  const wabeTypBtn=document.getElementById('btn-wabentyp');
  if(wabeTypBtn) wabeTypBtn.onclick=()=>{
    openModal('Wabe – Typ je Position',`
      <label class="lbl">Wabentyp je Position (1–12)</label>
      <div class="wabe-pos-grid">${wabePosTypeGridHTML(entryWabenPositions)}</div>
      <p class="muted">Für jede Position optional einen Wabentyp wählen – auch unterschiedliche Typen an verschiedenen Positionen möglich.
      Häkchen „Tausch" setzen, wenn eine vorhandene Wabe ausgetauscht statt eine neue hinzugefügt wird (in der Übersicht vorne als farbiges ⇄ statt „+" markiert).</p>`,
      (data,close)=>{
        entryWabenPositions=readWabePosTypeGrid();
        wabeTypBtn.innerHTML = wabeBtnLabelHtml(entryWabenPositions);
        wabeTypBtn.classList.toggle('on', entryWabenPositions.length>0);
        close(); return Promise.resolve();
      },null);
  };
  setTimeout(()=>{ const d=document.querySelector('.modal-body input[name="date"]'); if(d) d.focus(); },50);
  wireObs(obs,swarmCounts,selectValues);
  wirePhotos(photos,'form-thumbs',allEntries,existing?.id);
}

/* ---------- Sammeleintrag ---------- */
function massEntryForm(apiaryId, colonies) {
  const obs=new Set(),swarmCounts={swarm_open_count:0,swarm_capped_count:0},massPhotos=[];
  let massWeiselprobe=false, massKaefigung=false, massKoeniginFrei=false;
  let massWabenPositions=[];
  const selectValues={swarmMood:'', wildbauLevel:'', wabenAnzahl:''};
  const FOOD_OPTIONS=['---','5 – Zu viel','4 – Gut','3 – Mittel','2 – Gering','1 – Nichts'];
  const FUETTER_TYPES=['Zuckerwasser (1 : 1,2)','Zuckerwasser (1 : 1)','Zuckerwasser (3 : 2)','Sirup'];
  openModal('Sammeleintrag',`
    <label class="lbl">Völker auswählen *</label>
    <label class="check-item"><input type="checkbox" id="mass-select-all"><span><strong>Alle auswählen</strong></span></label>
    <div class="check-list">${colonies.map((c)=>`<label class="check-item"><input type="checkbox" class="col-check" value="${c.id}"><span>${esc(c.name)}</span></label>`).join('')}</div>
    ${obsTogglesHTML(obs,swarmCounts,selectValues)}
    <label class="lbl">Aktionen</label>
    <div class="action-btns">
      <button type="button" class="obs-btn ${actionBtnHidden('weiselprobe')}" id="mass-btn-weiselprobe">🐝 + Weiselprobe</button>
      <button type="button" class="obs-btn ${actionBtnHidden('oxal')}" id="mass-btn-oxal">🧪 Oxalsäure Bedampfung</button>
      <button type="button" class="obs-btn ${actionBtnHidden('kaefigung')}" id="mass-btn-kaefigung">${KAEFIG_SVG} Käfigung</button>
      <button type="button" class="obs-btn ${actionBtnHidden('koeniginfrei')}" id="mass-btn-koenigin-frei">👑 freigelassen</button>
      <button type="button" class="obs-btn ${actionBtnHidden('fuettern')}" id="mass-btn-fuettern">🍯 Fütterung</button>
      <button type="button" class="obs-btn ${actionBtnHidden('wabentyp')}" id="mass-btn-wabentyp">${wabeBtnLabelHtml(massWabenPositions)}</button>
    </div>
    <div id="mass-fuetter-block" style="display:none">
      ${selectField('Fütterungsart','fuetterType',FUETTER_TYPES[0],FUETTER_TYPES.map(t=>[t,t]))}
      ${field('Menge (Liter)','fuetterMenge','','','number')}
    </div>
    ${selectField('Art','type',ENTRY_TYPES[0],ENTRY_TYPES.map((t)=>[t,t]))}
    ${field('Datum','date',todayInput(),true,'date')}
    ${selectField('Futter','food','---',FOOD_OPTIONS.map((t)=>[t,t]))}
    ${textareaField('Notizen','notes')}
    <label class="lbl">Fotos</label>
    <div class="photo-grid" id="mass-thumbs"></div>
    <div class="photo-row">
      <label class="btn btn-photo">📷 Kamera<input type="file" accept="image/*" capture="environment" class="mass-photo" hidden></label>
      <label class="btn btn-photo">🖼 Galerie<input type="file" accept="image/*" multiple class="mass-photo" hidden></label>
    </div>`,
    async(data,close)=>{
      const ids=[...document.querySelectorAll('.col-check:checked')].map((x)=>x.value);
      if(ids.length===0) return alert('Bitte mindestens ein Volk auswählen.');
      const oxalMassBtn=document.getElementById('mass-btn-oxal');
      if(oxalMassBtn?.classList.contains('on')) obs.add('oxal');
      const obs_extra={...swarmCounts, ...selectValues,
        fuetterType: document.getElementById('mass-btn-fuettern')?.classList.contains('on') ? (data.fuetterType||'') : '',
        fuetterMenge: document.getElementById('mass-btn-fuettern')?.classList.contains('on') ? (data.fuetterMenge||'') : '',
        wabenPositions: massWabenPositions};
      for(const cid of ids){
        const photos=[];
        for(const mp of massPhotos){ try{const r=await api('POST','./api/photos',mp.blob,true);photos.push({id:r.id,caption:mp.caption||''});}catch(_){} }
        await api('POST','./api/entries',{colonyId:cid,type:data.type,date:data.date,notes:data.notes,food:data.food,photos,obs:[...obs],obs_extra,createdAt:new Date().toISOString()});
        if(massWeiselprobe||massKaefigung||massKoeniginFrei){
          const col=colonies.find(c=>c.id===cid);
          if(col){
            const upd={...col};
            if(massWeiselprobe)   upd.weiselprobeDate  =data.date||todayInput();
            if(massKaefigung)     upd.kaefigungDate     =data.date||todayInput();
            if(massKoeniginFrei)  upd.koeniginFreiDate  =data.date||todayInput();
            await api('PUT','./api/colonies/'+cid,upd);
          }
        }
      }
      close(); alert(ids.length+' Einträge erstellt.'); renderColonies();
    },null);
  wireObs(obs,swarmCounts,selectValues);

  document.getElementById('mass-select-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.col-check').forEach(chk => chk.checked = e.target.checked);
  });

  const massTypeSelect=document.querySelector('.modal-body select[name="type"]');
  document.getElementById('mass-btn-fuettern')?.addEventListener('click',function(){
    this.classList.toggle('on');
    const fb=document.getElementById('mass-fuetter-block');
    if(fb) fb.style.display=this.classList.contains('on')?'':'none';
    if(this.classList.contains('on') && massTypeSelect){
      massTypeSelect.value='Fütterung';
    }
  });
  document.getElementById('mass-btn-weiselprobe')?.addEventListener('click',function(){
    massWeiselprobe=!massWeiselprobe; this.classList.toggle('on',massWeiselprobe);
  });
  document.getElementById('mass-btn-oxal')?.addEventListener('click',function(){
    this.classList.toggle('on');
  });
  document.getElementById('mass-btn-kaefigung')?.addEventListener('click',function(){
    massKaefigung=!massKaefigung; this.classList.toggle('on',massKaefigung);
  });
  document.getElementById('mass-btn-koenigin-frei')?.addEventListener('click',function(){
    massKoeniginFrei=!massKoeniginFrei; this.classList.toggle('on',massKoeniginFrei);
  });
  const massWabeTypBtn=document.getElementById('mass-btn-wabentyp');
  if(massWabeTypBtn) massWabeTypBtn.onclick=()=>{
    openModal('Wabe – Typ je Position',`
      <label class="lbl">Wabentyp je Position (1–12)</label>
      <div class="wabe-pos-grid">${wabePosTypeGridHTML(massWabenPositions)}</div>
      <p class="muted">Für jede Position optional einen Wabentyp wählen – auch unterschiedliche Typen an verschiedenen Positionen möglich.
      Häkchen „Tausch" setzen, wenn eine vorhandene Wabe ausgetauscht statt eine neue hinzugefügt wird (in der Übersicht vorne als farbiges ⇄ statt „+" markiert).</p>`,
      (data,close)=>{
        massWabenPositions=readWabePosTypeGrid();
        massWabeTypBtn.innerHTML = wabeBtnLabelHtml(massWabenPositions);
        massWabeTypBtn.classList.toggle('on', massWabenPositions.length>0);
        close(); return Promise.resolve();
      },null);
  };
  /* "Buttons"-Button: Aktions-/Beobachtungs-Buttons per Popup ein-/ausblenden (direkt links neben Speichern) */
  const massSaveBtn = document.getElementById('m-save');
  if(massSaveBtn){
    const massBtnsBtn=document.createElement('button');
    massBtnsBtn.type='button';
    massBtnsBtn.className='btn btn-ghost btn-sm';
    massBtnsBtn.textContent='Buttons';
    massBtnsBtn.onclick=()=>openButtonManager();
    const massSaveWrap=document.createElement('div');
    massSaveWrap.style.cssText='display:flex;gap:.5rem;align-items:center';
    massSaveBtn.parentNode.insertBefore(massSaveWrap, massSaveBtn);
    massSaveWrap.appendChild(massBtnsBtn);
    massSaveWrap.appendChild(massSaveBtn);
  }

  const thumbs=$('#mass-thumbs');
  const drawMass=()=>{
    thumbs.innerHTML=massPhotos.map((mp,i)=>`<div class="photo-card"><div class="thumb-wrap"><img class="thumb" src="${mp.url}"><button class="thumb-del" type="button" data-i="${i}">✕</button></div><input class="cap-inp" data-i="${i}" placeholder="Beschreibung" value="${esc(mp.caption||'')}"></div>`).join('');
    thumbs.querySelectorAll('.thumb-del').forEach((b)=>b.onclick=()=>{massPhotos.splice(+b.dataset.i,1);drawMass();});
    thumbs.querySelectorAll('.cap-inp').forEach((inp)=>inp.oninput=()=>{massPhotos[+inp.dataset.i].caption=inp.value;});
  };
  document.querySelectorAll('.mass-photo').forEach((inp)=>inp.onchange=async(ev)=>{
    const labels=[...document.querySelectorAll('.btn-photo')];labels.forEach((l)=>l.classList.add('busy'));
    for(const f of [...ev.target.files]){try{const blob=await resizeImage(f);massPhotos.push({blob,url:URL.createObjectURL(blob),caption:''});}catch(err){alert('Foto-Fehler: '+err.message);}}
    labels.forEach((l)=>l.classList.remove('busy'));ev.target.value='';drawMass();
  });
  drawMass();
}

/* ---------- Alle Völker ---------- */
async function renderAll() {
  setHeader('Alle Völker', true);
  const apiaries = await apiGet('./api/apiaries');
  const settings = await apiGet('./api/settings').catch(()=>({}));

  // Alle Völker aller Standorte laden
  let all = [];
  await Promise.all(apiaries.map(async(a) => {
    const colsData = await apiGet('./api/colonies?apiaryId=' + a.id);
    colsData.forEach(c => { c._apiaryName = a.name; });
    all = all.concat(colsData);
  }));

  // Alphabetisch, BK* ans Ende
  all.sort((a,b) => {
    const aIsBK = isBkName(a.name);
    const bIsBK = isBkName(b.name);
    if(aIsBK && !bIsBK) return 1;
    if(!aIsBK && bIsBK) return -1;
    return a.name.localeCompare(b.name, 'de');
  });

  if(all.length === 0) {
    app.innerHTML = emptyState('Keine Völker', 'Noch keine Völker angelegt.');
    return;
  }

  const cols = getAllCols(settings);
  let lastEntryMap = {};
  if(cols.showLastEntry){
    await Promise.all(all.map(async c=>{
      try{
        const ents=await apiGet('./api/entries?colonyId='+c.id);
        lastEntryMap[c.id]=ents.length?fmtDate(ents[0].date):'';
      }catch(_){}
    }));
  }
  const STATUS_ICON = { ok:'🟢', watch:'🟡', varroa:'<img class="status-varroa-icon-sm" src="./icons/varroa.png" alt="Varroa?">', weak:'🟠', dead:'💀', dissolved:'✕' };
  const schlupfDays = parseInt(settings.schlupfDays || '11');
  const eilageDays  = parseInt(settings.eilageDays  || '28');
  const today = new Date().toISOString().slice(0,10);

  app.innerHTML = `
    <div class="toolbar" style="justify-content:space-between;align-items:center">
      <span class="muted">${all.length} Völker · alphabetisch</span>
      <button class="btn btn-ghost btn-sm" id="print-all">🖨 Drucken</button>
    </div>
    <ul class="all-list">
      ${all.map(c => {
        const status = STATUS_ICON[c.status||'ok'] || '🟢';
        const _reqReasons = c.requeueFlag ? (() => { try{ return JSON.parse(c.requeueReasons||'[]'); }catch(_){return [];} })() : [];
        const _reqCls = _reqReasons.includes('Sanftmut') ? 'requeue-dot-sm requeue-red' : 'requeue-dot-sm requeue-orange';
        const requeue = c.requeueFlag ? `<span class="${_reqCls}" title="Umweiselung">⚠</span>` : '';
        const breed   = c.breedFlag   ? '<span class="breed-dot-sm"   title="Nachzucht">⭐</span>' : '';
        const demaree = c.demareeStage && !c.demareeEndedAt
          ? `<span class="all-badge all-demaree">D${esc(c.demareeStage)}</span>` : '';
        const _oxInfo = c.oxalBlockStage ? oxalBlockInfo(c) : null;
        const oxblock = _oxInfo && !_oxInfo.done
          ? `<span class="all-badge all-oxblock" title="${esc(oxalBlockLabel(c))}">${OXAL_BLOCK_ICON}${esc(c.oxalBlockStage)} (${_oxInfo.daysSinceStart}/${OXAL_BLOCK_DAYS}T)</span>` : '';

        // Königin
        const qYear2 = c.queenYear && c.queenYear !== 'unbekannt'
          ? String(c.queenYear).slice(-2) : '';
        const qBadge = qYear2
          ? `<span class="qbadge q-${queenClass(c.queenYear)}" style="font-size:.7rem;padding:0 .25rem">${qYear2}</span> ` : '';
        const qNr  = c.queenNr  ? `(${esc(c.queenNr)})` : '';
        const qGen = c.queenGen === 'F0' ? '👑' : (c.queenGen ? esc(c.queenGen) : '');

        // Honigraume
        const hrs = parseHR(c);
        const hrBadge = hrs.length ? `<span class="all-badge all-hr">🍯${hrs.length}</span>` : '';

        // Umlarv
        let umlarvBadge = '';
        if(c.umlarvDate) {
          const schlupf = addDays(c.umlarvDate, schlupfDays);
          const eilage  = addDays(c.umlarvDate, schlupfDays + eilageDays);
          // Nächsten noch ausstehenden Termin anzeigen
          let label, date2, cls;
          if(today <= schlupf) {
            label='👑 Schlupf'; date2=schlupf; cls='all-umlarv';
          } else if(today <= eilage) {
            label='🥚 Eilage'; date2=eilage; cls='all-umlarv';
          } else {
            label='🐛 Umgelarvt'; date2=c.umlarvDate; cls='all-umlarv-done';
          }
          umlarvBadge = `<span class="all-badge ${cls}" title="Umgelarvt: ${fmtDate(c.umlarvDate)} · Schlupf: ${fmtDate(schlupf)} · Eilage: ${fmtDate(eilage)}">${label}: ${fmtDate(date2)}</span>`;
        }

        const notesSnip = cols.showNotes && c.notes ? `<span class="all-badge" style="color:var(--ink-soft)">${esc(c.notes.slice(0,20))}${c.notes.length>20?'…':''}</span>` : '';
        const lastEnt = cols.showLastEntry && lastEntryMap[c.id] ? `<span class="all-badge" style="background:#f1f3f5;color:var(--ink-soft)">📋 ${lastEntryMap[c.id]}</span>` : '';
        return `<li class="all-row" data-colony="${c.id}" data-apiary="${c._apiaryId||c.apiaryId}">
          ${cols.showStatus?`<span class="all-status">${status}${cols.showFlags?requeue+breed:''}</span>`:''}
          <span class="all-name">${esc(c.name)}</span>
          ${cols.showApiary?`<span class="all-sub">${esc(c._apiaryName)}</span>`:''}
          ${cols.showQueen?`<span class="all-queen">${qBadge}${qNr ? qNr+' ' : ''}${qGen}</span>`:''}
          ${cols.showSource&&c.source?`<span class="all-badge" style="background:transparent;color:var(--ink-soft)">${esc(c.source)}</span>`:''}
          <span class="all-badges">
            ${cols.showHr?hrBadge:''}
            ${cols.showDemaree?demaree:''}
            ${cols.showOxalBlock?oxblock:''}
            ${cols.showUmlarv?umlarvBadge:''}
            ${cols.showWeisel&&c.weiselprobeDate?`<span class="all-badge all-weisel">🐝 ${fmtDate(c.weiselprobeDate)}</span>`:''}
            ${cols.showKaef&&c.kaefigungDate&&(!c.koeniginFreiDate||c.koeniginFreiDate<c.kaefigungDate)?`<span class="all-badge all-kaef">${KAEFIG_SVG} ${Math.floor((Date.now()-new Date(c.kaefigungDate))/86400000)}T</span>`:''}
            ${lastEnt}${notesSnip}
          </span>
        </li>`;
      }).join('')}
    </ul>`;

  app.querySelectorAll('.all-row').forEach(el => {
    el.onclick = () => go('colony', {
      colonyId: el.dataset.colony,
      apiaryId: el.dataset.apiary,
      from: 'all', fromParams: {restoreScrollY: window.scrollY}
    });
  });

  const printBtn = document.getElementById('print-all');
  if(printBtn) printBtn.onclick = () => printAllList(all, settings);
}

/* ---------- Druck der Alle-Liste ---------- */
function printAllList(all, settings) {
  const STATUS_TEXT = { ok:'In Ordnung', watch:'Beobachten', varroa:'Varroa?', weak:'Schwach', dead:'Tot', dissolved:'Aufgelöst' };
  const cols = getAllCols(settings);
  const schlupfDays = parseInt(settings.schlupfDays || '11');
  const eilageDays  = parseInt(settings.eilageDays  || '28');
  const today = new Date().toISOString().slice(0,10);
  const dateStr = new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});

  const rows = all.map(c => {
    const flags = [];
    if(c.requeueFlag) flags.push('Umweiselung');
    if(c.breedFlag)   flags.push('Nachzucht');
    if(c.demareeStage && !c.demareeEndedAt) flags.push('Demaree '+c.demareeStage);
    if(cols.showOxalBlock){
      const oi = c.oxalBlockStage ? oxalBlockInfo(c) : null;
      if(oi && !oi.done) flags.push('Oxal-Block Stufe '+c.oxalBlockStage+' ('+oi.daysSinceStart+'/'+OXAL_BLOCK_DAYS+'T)');
    }
    const hrs = parseHR(c);
    const hrTxt = hrs.length ? hrs.length+' HR' : '';
    let zucht = '';
    if(c.umlarvDate){
      const schlupf = addDays(c.umlarvDate, schlupfDays);
      const eilage  = addDays(c.umlarvDate, schlupfDays+eilageDays);
      zucht = `Schlupf ${fmtDate(schlupf)}, Eilage ${fmtDate(eilage)}`;
    }
    const queen = (c.queenYear && c.queenYear!=='unbekannt' ? String(c.queenYear).slice(-2) : '?')
      + (c.queenNr ? ' / '+c.queenNr : '')
      + (c.queenGen ? ' / '+c.queenGen : '');
    const cells = [];
    cells.push(`<td>${esc(c.name)}</td>`);
    if(cols.showApiary)  cells.push(`<td>${esc(c._apiaryName||'')}</td>`);
    if(cols.showStatus)  cells.push(`<td>${STATUS_TEXT[c.status||'ok']||''}</td>`);
    if(cols.showQueen)   cells.push(`<td>${esc(queen)}</td>`);
    if(cols.showSource)  cells.push(`<td>${esc(c.source||'')}</td>`);
    if(cols.showHr)      cells.push(`<td>${hrTxt}</td>`);
    if(cols.showFlags)   cells.push(`<td>${esc(flags.join(', '))}</td>`);
    if(cols.showUmlarv)  cells.push(`<td>${zucht}</td>`);
    if(cols.showWeisel)  cells.push(`<td>${c.weiselprobeDate?fmtDate(c.weiselprobeDate):''}</td>`);
    if(cols.showKaef)    cells.push(`<td>${c.kaefigungDate?fmtDate(c.kaefigungDate):''}</td>`);
    if(cols.showNotes)   cells.push(`<td>${esc((c.notes||'').slice(0,40))}</td>`);
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  const headers = ['Name'];
  if(cols.showApiary)  headers.push('Standort');
  if(cols.showStatus)  headers.push('Zustand');
  if(cols.showQueen)   headers.push('Königin (Jahr/Nr/Gen)');
  if(cols.showSource)  headers.push('Herkunft');
  if(cols.showHr)      headers.push('HR');
  if(cols.showFlags)   headers.push('Status');
  if(cols.showUmlarv)  headers.push('Königinnenzucht');
  if(cols.showWeisel)  headers.push('Weiselprobe');
  if(cols.showKaef)    headers.push('Käfigung');
  if(cols.showNotes)   headers.push('Notizen');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Völkerübersicht ${dateStr}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:1.5cm;color:#000}
      h1{font-size:18px;margin:0 0 .2cm 0}
      .sub{font-size:11px;color:#555;margin-bottom:.5cm}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#f0f0f0;font-weight:700}
      tr:nth-child(even){background:#f9f9f9}
      @media print{ .noprint{display:none} }
    </style></head><body>
    <h1>Völkerübersicht – BeeTown</h1>
    <div class="sub">${all.length} Völker · Stand ${dateStr}</div>
    <table>
      <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`;

  const w = window.open('', '_blank');
  if(!w){ alert('Bitte Pop-ups erlauben, um zu drucken.'); return; }
  w.document.write(html);
  w.document.close();
}

/* ---------- Honig-Ernte ---------- */
async function renderHoney() {
  setHeader('Honig-Ernte', true);
  const [list, apiaries] = await Promise.all([
    apiGet('./api/honey_harvests'),
    apiGet('./api/apiaries')
  ]);

  const gesamt = list.reduce((s, h) => s + (h.menge || 0), 0);
  const byYear = {};
  list.forEach(h => {
    if (!byYear[h.year]) byYear[h.year] = [];
    byYear[h.year].push(h);
  });
  const years = Object.keys(byYear).sort((a,b) => b - a);

  const apiaryOpts = apiaries.map(a =>
    `<option value="${a.id}" data-name="${esc(a.name)}">${esc(a.name)}</option>`
  ).join('');

  const fmtKg = (n) => n.toFixed(1).replace('.',',');
  const curYearNum = new Date().getFullYear();

  /* Für die Gesamt-Ø je Standort (aktuelles Jahr): pro Standort die
     Völkeranzahl NICHT über Trachten aufsummieren (gleiche Völker!),
     sondern den Maximalwert nehmen. Menge dagegen wird aufsummiert. */
  const apiaryYearStats = {};
  list.filter(h => h.year === curYearNum).forEach(h => {
    const key = h.apiaryName || 'Kein Standort';
    if (!apiaryYearStats[key]) apiaryYearStats[key] = { menge: 0, voelker: 0 };
    apiaryYearStats[key].menge += h.menge || 0;
    apiaryYearStats[key].voelker = Math.max(apiaryYearStats[key].voelker, parseInt(h.anzahlVoelker) || 0);
  });
  const apiaryAvgList = Object.entries(apiaryYearStats).filter(([_, v]) => v.voelker > 0);
  const gesamtMengeAvg = apiaryAvgList.reduce((s, [_, v]) => s + v.menge, 0);
  const gesamtVoelkerAvg = apiaryAvgList.reduce((s, [_, v]) => s + v.voelker, 0);

  app.innerHTML = `
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Honigernten je Standort und Jahr erfassen und die
    Gesamtmenge im Überblick behalten.</p>
    <div style="padding:.5rem 0 1rem">
      <button class="btn btn-primary" id="btn-add-harvest">+ Ernte erfassen</button>
    </div>
    ${list.length === 0 ? emptyState('Noch keine Ernten', 'Erfasse deine erste Honigernte.') : `
      ${years.map(y => {
        const eintraege = byYear[y];
        const jahresMenge = eintraege.reduce((s, h) => s + (h.menge || 0), 0);
        const isCurYear = y == curYearNum;
        const byTracht = {};
        eintraege.forEach(h => {
          if (!byTracht[h.tracht]) byTracht[h.tracht] = [];
          byTracht[h.tracht].push(h);
        });
        const trachtKeys = Object.keys(byTracht);
        return `
          <h2 class="section-h">${esc(String(y))}</h2>
          ${trachtKeys.map(t => {
            const gruppe = byTracht[t];
            const trachtMenge = gruppe.reduce((s, h) => s + (h.menge || 0), 0);
            return `
              <h3 style="margin:.8rem 0 .3rem;font-size:.95rem;color:var(--honey-dark,#b8860b)">${esc(t)}</h3>
              <ul class="card-list">
                ${gruppe.map(h => {
                  const perVolk = (isCurYear && h.anzahlVoelker) ? h.menge / h.anzahlVoelker : null;
                  return `
                  <li class="card harvest-item" data-id="${esc(h.id)}">
                    <div class="card-main">
                      <div class="card-title">${h.apiaryName ? esc(h.apiaryName) : 'Kein Standort'}</div>
                      <div class="card-sub">${h.anzahlVoelker ? h.anzahlVoelker + ' Völker' : ''}${perVolk!==null ? ' · Ø ' + fmtKg(perVolk) + ' kg/Volk' : ''}${h.notizen ? ' · ' + esc(h.notizen) : ''}</div>
                    </div>
                    <div class="badge">${String(h.menge).replace('.',',')} kg</div>
                  </li>`;
                }).join('')}
                <li style="display:flex;justify-content:flex-end;padding:.3rem .5rem;color:var(--ink-soft);font-size:.9rem">
                  ${esc(t)} gesamt: <strong style="margin-left:.4rem">${fmtKg(trachtMenge)} kg</strong>
                </li>
              </ul>`;
          }).join('')}
          <p style="text-align:right;padding:.2rem .5rem;font-size:.95rem">Jahr ${esc(String(y))}: <strong>${fmtKg(jahresMenge)} kg</strong></p>
          ${isCurYear && apiaryAvgList.length ? `
          <ul class="card-list" style="margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--line)">
            ${apiaryAvgList.map(([name, v]) => `
              <li class="card" style="background:var(--chip-bg)">
                <div class="card-main">
                  <div class="card-title" style="font-size:.9rem">Ø ${esc(name)} (alle Trachten)</div>
                  <div class="card-sub">${fmtKg(v.menge)} kg / ${v.voelker} Völker</div>
                </div>
                <div class="badge">${fmtKg(v.menge / v.voelker)} kg</div>
              </li>`).join('')}
            ${gesamtVoelkerAvg > 0 ? `
            <li style="display:flex;justify-content:flex-end;padding:.3rem .5rem;color:var(--ink-soft);font-size:.9rem">
              Ø über alle Standorte: <strong style="margin-left:.4rem">${fmtKg(gesamtMengeAvg/gesamtVoelkerAvg)} kg</strong>
            </li>` : ''}
          </ul>` : ''}`;
      }).join('')}
      <p style="text-align:right;padding:.4rem .5rem;font-size:1rem;border-top:1px solid var(--line,#ddd)">Gesamt alle Jahre: <strong>${fmtKg(gesamt)} kg</strong></p>
    `}`;

  function harvestModal(title, existing) {
    const curYear = new Date().getFullYear();
    const h = existing || {};
    openModal(title, `
      <label class="lbl">Standort</label>
      <select class="inp" name="apiaryId">
        <option value="">– Kein Standort –</option>
        ${apiaries.map(a => `<option value="${a.id}" ${h.apiaryId===a.id?'selected':''}>${esc(a.name)}</option>`).join('')}
      </select>
      <label class="lbl">Jahr</label>
      <input class="inp" name="year" type="number" value="${h.year || curYear}" min="2000" max="2099" required>
      <label class="lbl">Tracht</label>
      <select class="inp" name="tracht">
        ${['Frühtracht','Sommertracht','Rapshonig'].map(t =>
          `<option value="${t}" ${(h.tracht||'Frühtracht')===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <label class="lbl">Menge (kg)</label>
      <input class="inp" name="menge" type="number" step="0.1" min="0" value="${h.menge||''}" placeholder="z.B. 25.5" required>
      <label class="lbl">Anzahl Völker</label>
      <input class="inp" name="anzahlVoelker" type="number" step="1" min="0" value="${h.anzahlVoelker||''}" placeholder="z.B. 6">
      <label class="lbl">Notizen (optional)</label>
      <input class="inp" name="notizen" type="text" value="${esc(h.notizen||'')}" placeholder="Anmerkungen">
    `,
    async (data, close) => {
      if (!data.year || !data.menge) return;
      const apiaryName = data.apiaryId
        ? (apiaries.find(a => a.id === data.apiaryId) || {}).name || ''
        : '';
      const payload = {
        year: parseInt(data.year),
        tracht: data.tracht,
        menge: parseFloat(data.menge),
        notizen: data.notizen || '',
        apiaryId: data.apiaryId || '',
        apiaryName,
        anzahlVoelker: parseInt(data.anzahlVoelker) || 0
      };
      if (existing) {
        await api('PUT', './api/honey_harvests/' + existing.id, payload);
      } else {
        await api('POST', './api/honey_harvests', payload);
      }
      close();
      renderHoney();
    },
    existing ? async (close) => {
      await api('DELETE', './api/honey_harvests/' + existing.id);
      close();
      renderHoney();
    } : null, true);
  }

  document.getElementById('btn-add-harvest').onclick = () => harvestModal('Ernte erfassen', null);

  app.querySelectorAll('.harvest-item').forEach(li => {
    li.onclick = () => {
      const h = list.find(x => x.id === li.dataset.id);
      if (h) harvestModal('Ernte bearbeiten', h);
    };
  });
}

/* ---------- Honig-Rühren (cremig rühren) ---------- */
const STIR_APPEARANCE_OPTIONS = [
  'Keine Änderung zum Vortag',
  'Schlieren im Honig – beginnende Kristallisation',
  'Masse wird homogener, aber noch Anteile vom dunklen Glukosehonig sichtbar',
  'Masse ist homogen, keine Glukoseanteile mehr sichtbar (überrührt)',
  'Masse ist fest geworden',
];

async function renderHoneyStir() {
  setHeader('Rühren', true);
  const batches = await apiGet('./api/honey_stir_batches');

  const openBatchModal = () => {
    openModal('Neue Charge (Impfung)', `
      <label class="lbl">Honigsorte</label>
      <input class="inp" name="honeyType" type="text" placeholder="z. B. Sommertracht">
      <label class="lbl">Menge der Charge (kg)</label>
      <input class="inp" name="amountKg" type="text" inputmode="decimal" placeholder="z. B. 9">
      <label class="lbl">Datum + Uhrzeit der Impfung</label>
      <input class="inp" name="seedDate" type="datetime-local" value="${nowDateTimeInput()}">
      <label class="lbl">Temperatur des Honigs (°C)</label>
      <input class="inp" name="seedTemp" type="text" inputmode="decimal" placeholder="z. B. 24">
      <label class="lbl">Impfmenge (g)</label>
      <input class="inp" name="seedAmountG" type="text" inputmode="decimal" placeholder="z. B. 500">
      <label class="lbl">Sorte des Impfhonigs</label>
      <input class="inp" name="seedHoneyType" type="text" placeholder="z. B. Frühtracht, feincremig">`,
      async (data, close) => {
        await api('POST', './api/honey_stir_batches', data);
        close();
        renderHoneyStir();
      }, null);
  };

  app.innerHTML = `
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Hier den Rührvorgang beim cremig Rühren von Honig
    dokumentieren – von der Impfung bis zur fertigen Charge.</p>
    <div style="padding:.2rem 0 1rem">
      <button class="btn btn-primary" id="btn-add-stirbatch">+ Neue Charge (Impfung)</button>
    </div>
    ${batches.length === 0 ? emptyState('Noch keine Chargen', 'Erfasse deine erste Impfung.') : `
      <ul class="card-list">
        ${batches.map(b => `
          <li class="card" data-open="${esc(b.id)}">
            <div class="card-main">
              <div class="card-title">${esc(b.honeyType||'(ohne Sorte)')}${b.status==='done'?' <span class="muted" style="font-size:.75rem">· abgeschlossen</span>':''}</div>
              <div class="card-sub">${esc(b.amountKg||'?')} kg · geimpft ${fmtDateTime(b.seedDate)}</div>
            </div>
            <button class="btn btn-ghost btn-sm" data-delete="${esc(b.id)}">🗑</button>
          </li>`).join('')}
      </ul>`}`;

  document.getElementById('btn-add-stirbatch').onclick = openBatchModal;
  app.querySelectorAll('[data-open]').forEach(el => {
    el.onclick = () => go('honeystirbatch', {batchId: el.dataset.open});
  });
  app.querySelectorAll('[data-delete]').forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
      if(!confirm('Diese Charge inkl. aller Rühr-Einträge und Fotos endgültig löschen?')) return;
      await api('DELETE', './api/honey_stir_batches/' + b.dataset.delete);
      renderHoneyStir();
    };
  });
}

async function renderHoneyStirBatch() {
  const batchId = nav.batchId;
  const batches = await apiGet('./api/honey_stir_batches');
  const batch = batches.find(b => b.id === batchId);
  setHeader(batch ? (batch.honeyType || 'Rühren') : 'Rühren', true);
  if (!batch) {
    app.innerHTML = emptyState('Nicht gefunden', 'Diese Charge existiert nicht mehr.');
    return;
  }
  const entries = await apiGet('./api/honey_stir_entries?batchId=' + batchId);

  const entryModal = (existing) => {
    const photos = existing ? [...(existing.photos||[])] : [];
    openModal(existing ? 'Rühr-Eintrag bearbeiten' : 'Rühr-Eintrag erfassen', `
      <label class="lbl">Datum + Uhrzeit</label>
      <input class="inp" name="date" type="datetime-local" value="${existing ? existing.date : nowDateTimeInput()}">
      <label class="lbl">Temperatur (°C)</label>
      <input class="inp" name="temp" type="text" inputmode="decimal" value="${existing?esc(existing.temp):''}" placeholder="z. B. 22">
      ${selectField('Aussehen','appearance', existing?existing.appearance:STIR_APPEARANCE_OPTIONS[0], STIR_APPEARANCE_OPTIONS.map(o=>[o,o]))}
      ${photoButtonsHTML('stir-thumbs')}`,
      async (data, close) => {
        data.photos = photos;
        if (existing) await api('PUT', './api/honey_stir_entries/'+existing.id, data);
        else await api('POST', './api/honey_stir_entries', {...data, batchId});
        close();
        renderHoneyStirBatch();
      },
      existing ? async (close) => {
        await api('DELETE', './api/honey_stir_entries/'+existing.id);
        close();
        renderHoneyStirBatch();
      } : null);
    wirePhotos(photos, 'stir-thumbs');
  };

  const finishModal = () => {
    openModal('Charge abschließen', `
      <p class="muted" style="font-size:.8rem">Kurzes Schlussfazit zu dieser Charge.</p>
      <label class="lbl">Schlussfazit</label>
      <textarea class="inp" name="conclusion" rows="4">${esc(batch.conclusion||'')}</textarea>`,
      async (data, close) => {
        await api('PUT', './api/honey_stir_batches/'+batchId, {...batch, status:'done', conclusion:data.conclusion});
        close();
        renderHoneyStirBatch();
      }, null);
  };

  app.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="card-main" style="width:100%">
        <div style="font-weight:600;margin-bottom:.3rem">${esc(batch.honeyType||'(ohne Sorte)')} – ${esc(batch.amountKg||'?')} kg</div>
        <div class="muted" style="font-size:.85rem">Geimpft ${fmtDateTime(batch.seedDate)} bei ${esc(batch.seedTemp||'?')}°C
        mit ${esc(batch.seedAmountG||'?')} g ${esc(batch.seedHoneyType||'Impfhonig')}</div>
      </div>
    </div>
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Nur so lange rühren, bis immer noch wenige
    Glukose-Anteile sichtbar sind – ist die Masse schon homogen und es sind keine flüssigen Glukose-Anteile mehr
    sichtbar, dann ist der Honig überrührt und weniger lagerfähig.</p>
    ${batch.status==='done' ? `
      <div class="msg ok" style="margin-bottom:1rem">
        <strong>Abgeschlossen.</strong>${batch.conclusion?`<div style="margin-top:.4rem;white-space:pre-wrap">${esc(batch.conclusion)}</div>`:''}
      </div>` : ''}
    <div style="padding:.2rem 0 1rem;display:flex;gap:.5rem;flex-wrap:wrap">
      <button class="btn btn-primary" id="btn-add-stirentry">+ Rühr-Eintrag</button>
      ${batch.status!=='done'?'<button class="btn btn-ghost btn-sm" id="btn-finish-batch">✅ Abschließen</button>':''}
    </div>
    ${entries.length === 0 ? emptyState('Noch keine Einträge', 'Noch nichts gerührt.') : `
      <ul class="card-list">
        ${entries.map(e => `
          <li class="card" data-open="${esc(e.id)}">
            <div class="card-main" style="width:100%">
              <div class="card-title">${fmtDateTime(e.date)}${e.temp?` · ${esc(e.temp)}°C`:''}</div>
              <div class="card-sub">${esc(e.appearance||'')}</div>
              ${e.photos && e.photos.length ? `<div class="photo-grid" style="margin-top:.4rem">${e.photos.map(p=>`<img class="thumb" src="${photoURL(p.id)}">`).join('')}</div>` : ''}
            </div>
          </li>`).join('')}
      </ul>`}`;

  document.getElementById('btn-add-stirentry').onclick = () => entryModal(null);
  const finishBtn = document.getElementById('btn-finish-batch');
  if (finishBtn) finishBtn.onclick = finishModal;
  app.querySelectorAll('[data-open]').forEach(el => {
    el.onclick = () => {
      const en = entries.find(x => x.id === el.dataset.open);
      if (en) entryModal(en);
    };
  });
}

/* ---------- Fütterungs-Übersicht ---------- */
/* Ungefährer Zuckeranteil je Liter fertiger Zuckerlösung.
   Verhältnis wird als Zucker:Wasser (Gewicht) verstanden; die Werte
   berücksichtigen die höhere Dichte der Zuckerlösung gegenüber Wasser.
   Bei Fertigsirup (z.B. Apiinvert) wird ein üblicher Zuckeranteil von ca. 73% angenommen. */
const SUGAR_PER_LITER = {
  'Zuckerwasser (1 : 1,2)': 0.54,
  'Zuckerwasser (1 : 1)':   0.62,
  'Zuckerwasser (3 : 2)':   0.77,
  'Sirup':                  1.05,
};

async function renderFuetterung() {
  setHeader('Fütterung', true);
  const curYear = new Date().getFullYear();
  const apiaries = await apiGet('./api/apiaries');
  const fmtKgZ = (n) => n.toFixed(2).replace('.',',');
  const fmtL = (n) => n.toFixed(1).replace('.',',');

  // Struktur: byColony[colonyName] = { apiaryName, byType: { typ: {liter, zuckerKg} } }
  const byColony = {};
  await Promise.all(apiaries.map(async a => {
    const colonies = await apiGet('./api/colonies?apiaryId=' + a.id);
    await Promise.all(colonies.map(async c => {
      const entries = await apiGet('./api/entries?colonyId=' + c.id);
      entries.forEach(e => {
        const extra = e.obs_extra ? (typeof e.obs_extra === 'string' ? JSON.parse(e.obs_extra) : e.obs_extra) : {};
        if(!extra.fuetterType) return;
        const year = e.date ? parseInt(e.date.slice(0,4)) : 0;
        if(year !== curYear) return;
        if(!byColony[c.name]) byColony[c.name] = { apiaryName: a.name, byType: {} };
        const t = extra.fuetterType;
        const liter = parseFloat(extra.fuetterMenge) || 0;
        const zuckerKg = liter * (SUGAR_PER_LITER[t] || 0);
        if(!byColony[c.name].byType[t]) byColony[c.name].byType[t] = { liter: 0, zuckerKg: 0 };
        byColony[c.name].byType[t].liter += liter;
        byColony[c.name].byType[t].zuckerKg += zuckerKg;
      });
    }));
  }));

  const colonyNames = Object.keys(byColony).sort();

  const gesamtByType = {};
  colonyNames.forEach(cn => {
    Object.entries(byColony[cn].byType).forEach(([t, v]) => {
      if(!gesamtByType[t]) gesamtByType[t] = { liter: 0, zuckerKg: 0 };
      gesamtByType[t].liter += v.liter;
      gesamtByType[t].zuckerKg += v.zuckerKg;
    });
  });

  const row = (label, liter, zucker, bold) => `
    <div style="display:grid;grid-template-columns:1fr 62px 78px;gap:.4rem;align-items:center;padding:.15rem 0${bold?';border-top:1px solid var(--line);margin-top:.2rem;padding-top:.35rem':''}">
      <span${bold?' style="font-weight:600"':''}>${label}</span>
      <span style="text-align:right;color:var(--ink-soft);font-variant-numeric:tabular-nums">${fmtL(liter)} L</span>
      <strong style="text-align:right;font-variant-numeric:tabular-nums">${fmtKgZ(zucker)} kg</strong>
    </div>`;

  app.innerHTML = `
    <div class="toolbar">
      <button class="btn btn-ghost" id="open-gewicht">⚖️ Gewicht</button>
      <button class="btn btn-ghost" id="open-fuetterungsvorschlag">🍯 Fütterungsvorschlag</button>
      <button class="btn btn-ghost" id="open-sirupcalc">🍬 Zuckersirup-Rechner</button>
    </div>
    <h2 class="section-h">Bereits gefütterte Mengen</h2>
    <div class="card" style="margin-bottom:.75rem">
      <div class="card-main" style="width:100%">
        ${Object.entries(gesamtByType).map(([t, v]) => row(esc(t), v.liter, v.zuckerKg)).join('')}
      </div>
    </div>
    ${colonyNames.length === 0
      ? emptyState('Keine Fütterungen', 'Noch keine Fütterungen in ' + curYear + ' erfasst.')
      : colonyNames.map(cn => {
          const { apiaryName, byType } = byColony[cn];
          const volksLiter = Object.values(byType).reduce((s,v) => s+v.liter, 0);
          const volksZucker = Object.values(byType).reduce((s,v) => s+v.zuckerKg, 0);
          return `
            <h2 class="section-h">${esc(cn)} <span class="muted" style="font-weight:normal;font-size:.85em">${esc(apiaryName)}</span></h2>
            <div class="card" style="margin-bottom:1rem">
              <div class="card-main" style="width:100%">
                ${Object.entries(byType).map(([t, v]) => row(esc(t), v.liter, v.zuckerKg)).join('')}
                ${row('Gesamt', volksLiter, volksZucker, true)}
              </div>
            </div>`;
        }).join('')}`;
  $('#open-gewicht').onclick = () => go('gewicht', {from:'fuetterung', fromParams:{restoreScrollY: window.scrollY}});
  $('#open-fuetterungsvorschlag').onclick = () => go('fuetterungsvorschlag', {from:'fuetterung', fromParams:{restoreScrollY: window.scrollY}});
  $('#open-sirupcalc').onclick = () => go('sirupcalc', {from:'fuetterung', fromParams:{restoreScrollY: window.scrollY}});
}

/* Staffel-Regeln für den Fütterungsvorschlag: jede Stufe deckt einen eigenständigen,
   nicht überlappenden Bereich ab (kleinster Grenzwert zuerst). Die letzte Stufe je
   Fütterungsart hat kein "max" und fängt alles Darüberliegende auf. Der Nutzer kann
   die Werte auf der Seite anpassen; Speicherung als JSON in settings.fuetterTiers. */
const FUETTER_TIER_DEFAULTS = {
  '1:1 / 1:1,2': [ {max:5, liter:1}, {max:8, liter:2}, {max:11, liter:3}, {liter:4} ],
  '2:3 oder Sirup': [ {max:2, liter:2}, {max:5, liter:3}, {max:8, liter:3}, {liter:4} ],
};

/* Welche konkrete Fütterungsart (aus FUETTER_TYPES) zu welcher Vorschlags-Gruppe gehört —
   der Vorschlag rechnet nur mit der Gruppe, bei der Übernahme muss die tatsächlich
   gemischte Art konkret ausgewählt werden (sonst passt sie nicht zu "Bereits gefütterte Mengen"). */
const FUETTER_TYPES_BY_GROUP = {
  '1:1 / 1:1,2': ['Zuckerwasser (1 : 1,2)', 'Zuckerwasser (1 : 1)'],
  '2:3 oder Sirup': ['Zuckerwasser (3 : 2)', 'Sirup'],
};

function loadFuetterTiers(settingsObj) {
  try {
    const parsed = JSON.parse(settingsObj.fuetterTiers || 'null');
    if(parsed && parsed['1:1 / 1:1,2'] && parsed['2:3 oder Sirup']) return parsed;
  } catch(_) {}
  return JSON.parse(JSON.stringify(FUETTER_TIER_DEFAULTS));
}

function fuetterLiterFor(fehlt, tierKey, tiersConfig) {
  if(fehlt <= 0) return 0;
  const bands = tiersConfig[tierKey] || [];
  for(const b of bands) {
    if(b.max === undefined || fehlt <= b.max) return b.liter;
  }
  return null;
}

async function renderFuetterungsvorschlag() {
  setHeader('Fütterungsvorschlag', true);
  const apiaries = await apiGet('./api/apiaries');
  const settingsObj = await apiGet('./api/settings').catch(()=>({}));
  const fmtKg = (n) => n.toFixed(1).replace('.',',');

  if(apiaries.length === 0){
    app.innerHTML = emptyState('Keine Standorte','Noch keine Standorte angelegt.');
    return;
  }

  const savedFvApiaryId = settingsObj.fvApiaryFilter || '';
  let currentApiaryId = apiaries.some(a => a.id === savedFvApiaryId) ? savedFvApiaryId : apiaries[0].id;
  const savedFvTier = settingsObj.fvTierFilter;
  let currentTier = (savedFvTier === '1:1 / 1:1,2' || savedFvTier === '2:3 oder Sirup') ? savedFvTier : '1:1 / 1:1,2';
  let all = [];
  let lastRows = [];
  let lastGesamt = 0;
  const tiersConfig = loadFuetterTiers(settingsObj);
  let tiersDirty = false;
  const saveTiers = () => api('POST','./api/settings',{fuetterTiers: JSON.stringify(tiersConfig)}).catch(()=>{});
  const updateSaveTiersBtn = () => {
    const btn = document.getElementById('btn-save-tiers');
    if(btn) btn.style.display = tiersDirty ? '' : 'none';
  };

  const renderTierEditor = () => {
    const editEl = document.getElementById('fv-tier-editor');
    if(!editEl) return;
    const bands = tiersConfig[currentTier];
    editEl.innerHTML = bands.map((b,i) => {
      const isLast = i === bands.length-1;
      return `
        <div style="display:flex;align-items:center;gap:.35rem;font-size:.8rem;margin-bottom:.3rem">
          ${isLast ? `<span>darüber:</span>` : `
          <span>bis</span>
          <input class="inp fv-tier-input" type="text" inputmode="decimal" data-idx="${i}" data-field="max" value="${String(b.max).replace('.',',')}" style="width:52px;padding:.2rem .4rem">
          <span>kg:</span>`}
          <input class="inp fv-tier-input" type="text" inputmode="decimal" data-idx="${i}" data-field="liter" value="${String(b.liter).replace('.',',')}" style="width:48px;padding:.2rem .4rem">
          <span>L</span>
        </div>`;
    }).join('');
    editEl.querySelectorAll('.fv-tier-input').forEach(inp => {
      inp.onchange = () => {
        const idx = +inp.dataset.idx, field = inp.dataset.field;
        const val = parseDecimal(inp.value);
        if(isNaN(val)) return;
        tiersConfig[currentTier][idx][field] = val;
        tiersDirty = true;
        updateSaveTiersBtn();
        renderTable();
      };
    });
    updateSaveTiersBtn();
  };

  const renderTable = () => {
    const bodyEl = document.getElementById('fv-body');
    if(!bodyEl) return;
    let gesamt = 0;
    const rows = all.map(c => {
      const cur = parseFloat(c.currentWeight);
      const ziel = parseFloat(c.zielGewicht);
      const hasCur = !isNaN(cur), hasZiel = !isNaN(ziel);
      const fehlt = (hasCur && hasZiel) ? ziel - cur : null;
      const liter = fehlt !== null ? fuetterLiterFor(fehlt, currentTier, tiersConfig) : null;
      if(liter !== null) gesamt += liter;
      const daysSince = c.currentWeightDate ? Math.floor((Date.now() - new Date(c.currentWeightDate+'T00:00:00').getTime()) / 86400000) : null;
      const stale = !hasCur || daysSince === null || daysSince > 5;
      return { c, cur, ziel, hasCur, hasZiel, fehlt, liter, daysSince, stale };
    });
    lastRows = rows;
    lastGesamt = gesamt;

    bodyEl.innerHTML = `
      <h2 class="section-h">Gesamtmengen</h2>
      <div class="card" style="margin-bottom:1rem">
        <div class="card-main" style="width:100%;display:flex;justify-content:space-between;align-items:center">
          <span>Für den gesamten Stand</span>
          <strong style="font-variant-numeric:tabular-nums">${gesamt.toFixed(1).replace('.',',')} L</strong>
        </div>
      </div>
      <h2 class="section-h">Mengen pro Volk</h2>
      ${rows.length === 0 ? emptyState('Keine Völker','Keine Völker (ohne BK) an diesem Standort.') : `
      <div style="display:grid;grid-template-columns:1fr 52px 52px 60px 56px;gap:.5rem;padding:0 .8rem;font-size:.72rem;color:var(--ink-soft);margin-bottom:.25rem">
        <span></span><span style="text-align:right">Ist</span><span style="text-align:right">Ziel</span><span style="text-align:right">Fehlt</span><span style="text-align:right">Menge</span>
      </div>
      <ul class="card-list">
        ${rows.map(r => `
          <li class="card" data-id="${esc(r.c.id)}" data-apiary="${esc(r.c.apiaryId)}" style="display:grid;grid-template-columns:1fr 52px 52px 60px 56px;gap:.5rem;align-items:center;padding:.55rem .8rem;cursor:pointer${r.stale?';background:var(--warn-bg);border-color:var(--warn-line)':''}">
            <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600${r.stale?';color:var(--warn-ink)':''}">${r.stale?'⚠️ ':''}${esc(r.c.name)}${r.stale?`<div style="font-weight:400;font-size:.72rem;white-space:normal">${!r.hasCur?'kein Gewicht erfasst':(r.daysSince===null?'noch nie gewogen':'letztes Wiegen vor '+r.daysSince+' Tagen')}</div>`:''}</div>
            <div style="text-align:right;font-size:.85rem;color:var(--ink-soft);font-variant-numeric:tabular-nums">${r.hasCur ? fmtKg(r.cur) : '–'}</div>
            <div style="text-align:right;font-size:.85rem;color:var(--ink-soft);font-variant-numeric:tabular-nums">${r.hasZiel ? fmtKg(r.ziel) : '–'}</div>
            <div style="text-align:right;font-size:.85rem;font-variant-numeric:tabular-nums">${r.fehlt===null ? '–' : (r.fehlt>0 ? fmtKg(r.fehlt) : '✓')}</div>
            <div style="text-align:right;font-size:.85rem;font-weight:650;font-variant-numeric:tabular-nums">${r.liter !== null ? r.liter+' L' : '–'}</div>
          </li>`).join('')}
      </ul>`}`;
    bodyEl.querySelectorAll('li.card[data-id]').forEach(li => {
      li.onclick = () => go('colony', {
        colonyId: li.dataset.id, apiaryId: li.dataset.apiary,
        from: 'fuetterungsvorschlag', fromParams: {restoreScrollY: window.scrollY}
      });
    });
  };

  const loadApiary = async(apiaryId) => {
    currentApiaryId = apiaryId;
    const colsData = await apiGet('./api/colonies?apiaryId=' + apiaryId);
    all = colsData.filter(c => !isBkName(c.name));
    all.sort((a,b) => a.name.localeCompare(b.name, 'de'));
    renderTable();
  };

  const updateTakeoverBtn = () => {
    const btn = document.getElementById('btn-fv-takeover');
    if(!btn) return;
    const remainingMs = fvCooldownUntil ? (new Date(fvCooldownUntil).getTime() - Date.now()) : 0;
    if(remainingMs > 0){
      btn.disabled = true;
      btn.textContent = `⏳ Gesperrt noch ${Math.ceil(remainingMs/60000)} Min.`;
    } else {
      btn.disabled = false;
      btn.textContent = '✅ Für alle Völker übernehmen';
      stopFvCooldownTimer();
    }
  };

  let fvCooldownUntil = settingsObj.fvTakeoverCooldownUntil || null;

  const openTakeoverModal = () => {
    const eligible = lastRows.filter(r => r.liter !== null && r.liter > 0);
    if(eligible.length === 0){ alert('Keine Völker mit einem Fütterungsvorschlag > 0 L vorhanden.'); return; }
    const typeOptions = FUETTER_TYPES_BY_GROUP[currentTier] || [];
    openModal('Fütterungsvorschlag übernehmen', `
      <div style="background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:8px;padding:.6rem .7rem;margin-bottom:.9rem">
        <label class="lbl" style="color:var(--warn-ink);font-weight:700;margin-bottom:.3rem">⚠️ Welche Fütterungsart wurde tatsächlich gemischt?</label>
        <select class="inp" id="fv-take-type">
          <option value="" selected disabled>– bitte auswählen –</option>
          ${typeOptions.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
      </div>
      <p class="muted">Wähle die Völker aus, für die ein Fütterungs-Eintrag angelegt werden soll. Menge kann angepasst werden.</p>
      <div class="check-list">
        ${eligible.map(r => `
          <div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--line)">
            <input type="checkbox" class="fv-take-check" data-colony="${esc(r.c.id)}" checked>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.c.name)}</span>
            <input type="text" inputmode="decimal" class="inp fv-take-amount" data-colony="${esc(r.c.id)}" value="${String(r.liter).replace('.',',')}" style="width:56px;padding:.2rem .4rem">
            <span>L</span>
          </div>`).join('')}
      </div>`,
      async(data, close) => {
        const reenable = () => { const b = document.getElementById('m-save'); if(b) b.disabled = false; };
        const chosenType = document.getElementById('fv-take-type')?.value || '';
        if(!chosenType){ alert('Bitte zuerst die tatsächlich gemischte Fütterungsart auswählen.'); reenable(); return; }
        const items = [...document.querySelectorAll('.fv-take-check:checked')].map(cb => {
          const amountInp = document.querySelector(`.fv-take-amount[data-colony="${cb.dataset.colony}"]`);
          const menge = parseDecimal(amountInp?.value || '');
          return { colonyId: cb.dataset.colony, menge };
        }).filter(it => !isNaN(it.menge) && it.menge > 0);
        if(items.length === 0){ alert('Keine Völker ausgewählt.'); reenable(); return; }
        const gesamtMenge = items.reduce((s,it) => s+it.menge, 0);
        if(!confirm(`Fütterungsart: ${chosenType}\nVölker: ${items.length}\nGesamtmenge: ${gesamtMenge.toFixed(1).replace('.',',')} L\n\nIst die Fütterungsart oben richtig ausgewählt? Fortfahren?`)) { reenable(); return; }
        if(!confirm(`Wirklich für ${items.length} Völker "${chosenType}" eintragen? Diese Aktion kann nicht rückgängig gemacht werden.`)) { reenable(); return; }
        for(const it of items){
          await api('POST','./api/entries',{
            colonyId: it.colonyId, type:'Fütterung', date: todayInput(), notes:'', food:'---', photos:[], obs:[],
            obs_extra: { fuetterType: chosenType, fuetterMenge: String(it.menge) },
            createdAt: new Date().toISOString()
          });
        }
        close();
        fvCooldownUntil = new Date(Date.now() + 5*60*1000).toISOString();
        api('POST','./api/settings',{fvTakeoverCooldownUntil: fvCooldownUntil}).catch(()=>{});
        updateTakeoverBtn();
        stopFvCooldownTimer();
        _fvCooldownTimer = setInterval(() => { if(nav.view==='fuetterungsvorschlag') updateTakeoverBtn(); }, 15000);
        showToast(`✅ Übernahme durchgeführt: ${items.length} Einträge erstellt`, 5000);
      }, null, true);
    const saveBtn = document.getElementById('m-save');
    if(saveBtn) saveBtn.textContent = 'Jetzt übernehmen';
  };

  app.innerHTML = `
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Hier wird ein Vorschlag auf Basis der aktuell
    erfassten Gewichte erstellt. Wenn die Fütterung so durchgeführt wurde, kann man mit dem Button unten die
    Fütterung für alle Völker übernehmen. Anpassungen sind noch möglich.</p>
    <label class="lbl">Standort</label>
    <select class="inp" id="fv-apiary-select" style="margin-bottom:.8rem">
      ${apiaries.map(a => `<option value="${esc(a.id)}" ${a.id===currentApiaryId?'selected':''}>${esc(a.name)}</option>`).join('')}
    </select>
    <label class="lbl">Fütterungsart</label>
    <select class="inp" id="fv-tier-select" style="margin-bottom:.6rem">
      <option value="1:1 / 1:1,2" ${currentTier==='1:1 / 1:1,2'?'selected':''}>1:1 / 1:1,2</option>
      <option value="2:3 oder Sirup" ${currentTier==='2:3 oder Sirup'?'selected':''}>2:3 oder Sirup</option>
    </select>
    <div class="card" style="margin-bottom:.8rem">
      <div class="card-main" style="width:100%">
        <div class="muted" style="font-size:.72rem;margin-bottom:.4rem">Fehlendes Gewicht → Fütterung(L)</div>
        <div id="fv-tier-editor"></div>
        <button class="btn btn-primary btn-sm" id="btn-save-tiers" style="display:none;margin-top:.4rem">💾 Speichern</button>
      </div>
    </div>
    <div id="fv-body"></div>
    <div style="padding:1rem .8rem .5rem;display:flex;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" id="btn-print-fv">🖨 Drucken</button>
    </div>
    <div style="padding:.5rem .8rem 1rem">
      <button class="btn btn-primary block" id="btn-fv-takeover">✅ Für alle Völker übernehmen</button>
    </div>`;

  document.getElementById('fv-apiary-select').onchange = (ev) => {
    api('POST','./api/settings',{fvApiaryFilter: ev.target.value}).catch(()=>{});
    loadApiary(ev.target.value);
  };
  document.getElementById('fv-tier-select').onchange = (ev) => {
    currentTier = ev.target.value;
    api('POST','./api/settings',{fvTierFilter: currentTier}).catch(()=>{});
    renderTierEditor();
    renderTable();
  };
  document.getElementById('btn-save-tiers').onclick = () => {
    saveTiers();
    tiersDirty = false;
    updateSaveTiersBtn();
    showToast('✅ Bedingungen gespeichert');
  };
  document.getElementById('btn-print-fv').onclick = () => {
    const apiaryName = apiaries.find(a => a.id === currentApiaryId)?.name || '';
    printFuetterungsvorschlagList(apiaryName, currentTier, lastRows, lastGesamt, fmtKg);
  };
  document.getElementById('btn-fv-takeover').onclick = () => openTakeoverModal();

  renderTierEditor();
  await loadApiary(currentApiaryId);
  updateTakeoverBtn();
  if(fvCooldownUntil && new Date(fvCooldownUntil).getTime() > Date.now()){
    stopFvCooldownTimer();
    _fvCooldownTimer = setInterval(() => { if(nav.view==='fuetterungsvorschlag') updateTakeoverBtn(); }, 15000);
  }
}

function printFuetterungsvorschlagList(apiaryName, tierKey, rows, gesamt, fmtKg) {
  const dateStr = new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const rowsHtml = rows.map(r => `<tr>
      <td>${esc(r.c.name)}</td>
      <td>${r.hasCur ? fmtKg(r.cur) : '–'}</td>
      <td>${r.hasZiel ? fmtKg(r.ziel) : '–'}</td>
      <td>${r.fehlt===null ? '–' : (r.fehlt>0 ? fmtKg(r.fehlt) : '✓')}</td>
      <td>${r.liter !== null ? r.liter+' L' : '–'}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fütterungsvorschlag ${dateStr}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:1.5cm;color:#000}
      h1{font-size:18px;margin:0 0 .2cm 0}
      .sub{font-size:11px;color:#555;margin-bottom:.5cm}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#f0f0f0;font-weight:700}
      .gesamt{margin-top:.4cm;font-size:12px;font-weight:700}
    </style></head><body>
    <h1>Fütterungsvorschlag</h1>
    <div class="sub">Standort: ${esc(apiaryName)} · Fütterungsart: ${esc(tierKey)} · Stand: ${dateStr}</div>
    <table><thead><tr><th>Volk</th><th>Ist (kg)</th><th>Ziel (kg)</th><th>Fehlt (kg)</th><th>Menge</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    <div class="gesamt">Gesamt für den Stand: ${gesamt.toFixed(1).replace('.',',')} L</div>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if(!w){ alert('Bitte Pop-ups erlauben, um zu drucken.'); return; }
  w.document.write(html);
  w.document.close();
}

async function renderSirupCalc() {
  setHeader('Zuckersirup-Rechner', true);

  app.innerHTML = `
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Zuckersirup berechnen – wahlweise ausgehend von
    der gewünschten Sirupmenge oder von der vorhandenen Zuckermenge.</p>
    <label class="lbl">Mischungsverhältnis (Zucker : Wasser)</label>
    <select class="inp" id="sirup-ratio">
      ${Object.entries(SIRUP_RATIOS).map(([k,r])=>`<option value="${esc(k)}">${esc(r.label)}</option>`).join('')}
    </select>

    <h2 class="section-h">Zielmenge → Zucker + Wasser</h2>
    <p class="muted">Wie viel Sirup soll am Ende herauskommen?</p>
    <label class="lbl">Zielmenge Sirup (Liter)</label>
    <input class="inp" id="sirup-target-input" type="text" inputmode="decimal" placeholder="z. B. 35">
    <button class="btn btn-primary block" id="btn-calc-target" style="margin-top:.5rem">Berechnen</button>
    <div class="card" id="sirup-target-result" style="margin-top:.6rem;display:none"></div>

    <h2 class="section-h">Zucker-Menge → Wasser + Ergebnis</h2>
    <p class="muted">Wie viel Zucker hast du (z. B. abgewogen)?</p>
    <label class="lbl">Zucker (kg)</label>
    <input class="inp" id="sirup-sugar-input" type="text" inputmode="decimal" placeholder="z. B. 5">
    <button class="btn btn-primary block" id="btn-calc-sugar" style="margin-top:.5rem">Berechnen</button>
    <div class="card" id="sirup-sugar-result" style="margin-top:.6rem;display:none"></div>

    <h2 class="section-h">Verlauf (letzte 20)</h2>
    <ul class="card-list" id="sirup-history"></ul>`;

  const ratioSelect = document.getElementById('sirup-ratio');

  const saveCalc = async(mode, inputValue, r) => {
    await api('POST','./api/sirup_calc',{
      date: todayInput(), ratio: ratioSelect.value, mode,
      inputValue: String(inputValue), sugar: fmtNum(r.sugar), water: fmtNum(r.water), result: fmtNum(r.result),
      createdAt: new Date().toISOString()
    });
    await loadHistory();
  };

  document.getElementById('btn-calc-target').onclick = async() => {
    const val = parseDecimal(document.getElementById('sirup-target-input').value);
    if(isNaN(val) || val<=0) return alert('Bitte eine gültige Zielmenge eingeben.');
    const r = sirupFromTarget(ratioSelect.value, val);
    const out = document.getElementById('sirup-target-result');
    out.style.display='';
    out.innerHTML = `<div class="card-main" style="width:100%">
      <div><strong>${fmtNum(r.sugar)} kg</strong> Zucker + <strong>${fmtNum(r.water)} L</strong> Wasser</div>
      <div class="muted">ergibt ca. ${fmtNum(r.result)} L Sirup</div>
    </div>`;
    await saveCalc('target', val, r);
  };

  document.getElementById('btn-calc-sugar').onclick = async() => {
    const val = parseDecimal(document.getElementById('sirup-sugar-input').value);
    if(isNaN(val) || val<=0) return alert('Bitte eine gültige Zucker-Menge eingeben.');
    const r = sirupFromSugar(ratioSelect.value, val);
    const out = document.getElementById('sirup-sugar-result');
    out.style.display='';
    out.innerHTML = `<div class="card-main" style="width:100%">
      <div>+ <strong>${fmtNum(r.water)} L</strong> Wasser</div>
      <div class="muted">ergibt ca. ${fmtNum(r.result)} L Sirup</div>
    </div>`;
    await saveCalc('sugar', val, r);
  };

  const loadHistory = async() => {
    const list = await apiGet('./api/sirup_calc').catch(()=>[]);
    const histEl = document.getElementById('sirup-history');
    histEl.innerHTML = list.length===0 ? '<li class="card muted" style="justify-content:center">Noch keine Berechnungen</li>' : list.map(h=>{
      const ratioLabel = SIRUP_RATIOS[h.ratio]?.label || h.ratio;
      const desc = h.mode==='target'
        ? `Ziel ${esc(h.inputValue)} L → ${esc(h.sugar)} kg Zucker + ${esc(h.water)} L Wasser`
        : `${esc(h.inputValue)} kg Zucker → ${esc(h.water)} L Wasser = ${esc(h.result)} L Sirup`;
      return `<li class="card">
        <div class="card-main">
          <div class="card-title">${fmtDate(h.date)} · ${esc(ratioLabel)}</div>
          <div class="card-sub">${desc}</div>
        </div>
        <button class="btn btn-ghost btn-sm sirup-del" data-id="${esc(h.id)}" title="Löschen">✕</button>
      </li>`;
    }).join('');
    histEl.querySelectorAll('.sirup-del').forEach(b=>b.onclick=async()=>{
      await api('DELETE','./api/sirup_calc/'+b.dataset.id);
      loadHistory();
    });
  };
  await loadHistory();
}

/* ---------- Gewicht ---------- */

async function renderLastEntries() {
  setHeader('Letzte Einträge', true);
  const items = await apiGet('./api/entries/latest');

  app.innerHTML = `
    ${items.length === 0 ? emptyState('Keine Einträge','Es wurden noch keine Stockkarten-Einträge erfasst.') : `
    <div class="toolbar" style="justify-content:space-between;align-items:center">
      <span class="muted">${items.length} Völker · neuester Eintrag zuerst</span>
    </div>
    <ul class="timeline">
      ${items.map((it) => {
        const extra = it.obs_extra || {};
        return `<li class="entry" data-open="${esc(it.colonyId)}" data-apiary="${esc(it.apiaryId||'')}" style="cursor:pointer">
          <div class="entry-date">${fmtDate(it.date)}</div>
          <div class="entry-body">
            <div class="entry-type"><strong>${esc(it.colonyName)}</strong> · ${esc(it.apiaryName||'–')} · ${esc(it.type||'')}</div>
            ${obsChipsHTML(it.obs,extra)}
            ${it.temper&&it.temper!=='---'?`<span class="obs-chip">Sanftmut: ${esc(it.temper)}</span>`:''}
            ${it.strength&&it.strength!=='---'?`<span class="obs-chip">Volksstärke: ${esc(it.strength)}</span>`:''}
            ${it.food&&it.food!=='---'?`<span class="obs-chip">Futter: ${esc(it.food)}</span>`:''}
            ${it.demareeAction?`<div class="entry-badge entry-badge-demaree">Demaree Stufe ${esc(it.demareeAction)}</div>`:''}
            ${it.oxalBlockAction?`<div class="entry-badge entry-badge-oxblock">${OXAL_BLOCK_ICON} Block Stufe ${esc(it.oxalBlockAction)}</div>`:''}
            ${varroaCountBadgeHTML(it)}
            ${it.entryHrNr?`<div class="entry-badge entry-badge-hr">🍯 HR ${esc(it.entryHrNr)}</div>`:''}
            ${it.notes?`<div class="entry-notes">${esc(it.notes)}</div>`:''}
            <div class="photos">${(it.photos||[]).map((p)=>`
              <figure class="photo-fig">
                <img class="thumb" loading="lazy" src="${photoURL(p.id)}" data-full="${photoURL(p.id)}" data-cap="${esc(p.caption||'')}">
                ${p.caption?`<figcaption>${esc(p.caption)}</figcaption>`:''}
              </figure>`).join('')}</div>
          </div>
        </li>`;
      }).join('')}
    </ul>`}`;

  app.querySelectorAll('.thumb').forEach((im)=>im.onclick=(ev)=>{ ev.stopPropagation(); openLightbox(im.dataset.full,im.dataset.cap); });
  app.querySelectorAll('[data-open]').forEach(el => {
    el.onclick = (ev) => {
      if (ev.target.closest('.thumb')) return;
      go('colony', { colonyId: el.dataset.open, apiaryId: el.dataset.apiary, from: 'lastentries', fromParams: {restoreScrollY: window.scrollY} });
    };
  });
}

async function renderVarroaCount() {
  setHeader('Varroa Zählung', true);
  const apiaries = await apiGet('./api/apiaries');
  const settings = await apiGet('./api/settings').catch(()=>({}));
  const autoNext = settings.varroaAutoNext === 'true';

  if(apiaries.length === 0){
    app.innerHTML = emptyState('Keine Standorte','Noch keine Standorte angelegt.');
    return;
  }

  const savedVarroaApiaryId = settings.varroaApiaryFilter || '';
  let currentApiaryId = apiaries.some(a => a.id === savedVarroaApiaryId) ? savedVarroaApiaryId : apiaries[0].id;
  let all = [];
  let lastCountMap = {};

  const cardSub = (c) => {
    const last = lastCountMap[c.id];
    return last?`letzte Zählung: ${esc(last.varroaCount)} Milben (${fmtDate(last.date)})${last.varroaAnts?' · 🐜 Ameisen':''}`:'noch keine Zählung';
  };

  const renderList = () => {
    const listEl = document.getElementById('varroa-list');
    if(!listEl) return;
    listEl.innerHTML = all.length === 0
      ? `<p class="muted" style="padding:.6rem 0">Keine Völker an diesem Standort.</p>`
      : all.map(c => `
        <li class="card" data-colony="${esc(c.id)}" style="cursor:pointer">
          <div class="card-main">
            <div class="card-title">${esc(c.name)}</div>
            <div class="card-sub" id="varroa-sub-${esc(c.id)}">${cardSub(c)}</div>
          </div>
          <img src="./icons/varroa.png" alt="" style="width:20px;height:20px;object-fit:contain">
        </li>`).join('');
    listEl.querySelectorAll('[data-colony]').forEach(el => {
      el.onclick = () => openForColony(all.findIndex(c=>c.id===el.dataset.colony));
    });
    const countEl = document.getElementById('varroa-count-label');
    if(countEl) countEl.textContent = `${all.length} Völker`;
  };

  const loadApiary = async(apiaryId) => {
    currentApiaryId = apiaryId;
    const colsData = await apiGet('./api/colonies?apiaryId=' + apiaryId);
    all = colsData.filter(c => !isBkName(c.name));
    all.sort((a,b) => a.name.localeCompare(b.name, 'de'));

    let varroaEntries = [];
    try { varroaEntries = await apiGet('./api/entries/varroa'); } catch(_) {}
    lastCountMap = {};
    varroaEntries.forEach(v => { if(!lastCountMap[v.colonyId]) lastCountMap[v.colonyId] = v; });

    renderList();
  };

  const openForColony = (idx) => {
    if(idx < 0 || idx >= all.length) return;
    const c = all[idx];
    const infoText = document.getElementById('varroa-infotext')?.value || '';
    openModal(`Varroa Zählung – ${esc(c.name)}`, `
      <label class="lbl">Anzahl gezählter Varroen</label>
      <input class="inp" name="varroaCount" type="number" min="0" inputmode="numeric" autofocus>
      <button type="button" class="obs-btn" id="btn-ants" style="margin-top:.7rem">🐜 Ameisen gesehen</button>
    `, async(data, close) => {
      let antsVal = false;
      const antsBtn = document.getElementById('btn-ants');
      if(antsBtn) antsVal = antsBtn.classList.contains('on');
      await api('POST','./api/entries',{
        colonyId: c.id, date: todayInput(), type: 'Varroa-Zählung',
        notes: infoText, varroaCount: data.varroaCount || '0', varroaAnts: antsVal
      });
      close();
      const sub = document.getElementById('varroa-sub-'+c.id);
      lastCountMap[c.id] = { varroaCount: data.varroaCount||'0', date: todayInput(), varroaAnts: antsVal };
      if(sub) sub.textContent = cardSub(c);
      if(autoNext) openForColony(idx+1);
    });
    const antsBtn = document.getElementById('btn-ants');
    if(antsBtn) antsBtn.onclick = () => antsBtn.classList.toggle('on');
    document.querySelector('input[name="varroaCount"]')?.focus();
  };

  app.innerHTML = `
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Ein Volk antippen, um eine neue Varroa-Zählung
    dafür zu erfassen.</p>
    <div class="toolbar" style="justify-content:space-between;align-items:center">
      <span class="muted" id="varroa-count-label">Völker</span>
      <button class="btn btn-ghost btn-sm" id="open-varroahistory">📋 Alle Zählungen</button>
    </div>
    <label class="lbl">Standort</label>
    <select class="inp" id="varroa-apiary-select">
      ${apiaries.map(a => `<option value="${esc(a.id)}" ${a.id===currentApiaryId?'selected':''}>${esc(a.name)}</option>`).join('')}
    </select>
    <label class="lbl" style="margin-top:.6rem">Info-Text (wird bei jeder Zählung übernommen)</label>
    <textarea class="inp" id="varroa-infotext" rows="2" placeholder="z.B. Windel eingelegt am ..., Auswertung nach 3 Tagen"></textarea>
    <ul class="card-list" id="varroa-list" style="margin-top:.8rem"></ul>`;

  $('#open-varroahistory').onclick = () => go('varroahistory', {from:'varroacount', fromParams:{restoreScrollY: window.scrollY}});
  document.getElementById('varroa-apiary-select').onchange = (ev) => {
    api('POST','./api/settings',{varroaApiaryFilter: ev.target.value}).catch(()=>{});
    loadApiary(ev.target.value);
  };

  await loadApiary(currentApiaryId);
}

async function renderVarroaHistory() {
  setHeader('Alle Varroa-Zählungen', true);
  let items = await apiGet('./api/entries/varroa');
  items = items.filter(it => !isBkName(it.colonyName));
  items.sort((a,b) => {
    const byName = a.colonyName.localeCompare(b.colonyName, 'de');
    if(byName !== 0) return byName;
    return b.date.localeCompare(a.date);
  });

  if(items.length === 0){
    app.innerHTML = emptyState('Keine Zählungen','Es wurden noch keine Varroa-Zählungen erfasst.');
    return;
  }

  app.innerHTML = `
    <div class="toolbar" style="justify-content:space-between;align-items:center">
      <span class="muted">${items.length} Zählungen · nach Volk sortiert</span>
      <button class="btn btn-ghost btn-sm" id="print-varroa">🖨 Drucken</button>
    </div>
    <div class="table-wrap">
      <table class="data-table data-table-compact">
        <thead><tr>
          <th>Volk</th><th>Datum</th><th>Standort</th><th>Anzahl</th><th>Ameisen</th><th>Info</th><th></th>
        </tr></thead>
        <tbody>
          ${items.map(it => `
            <tr data-open="${esc(it.colonyId)}" data-apiary="${esc(it.apiaryId||'')}" style="cursor:pointer">
              <td>${esc(it.colonyName)}</td>
              <td>${fmtDate(it.date)}</td>
              <td>${esc(it.apiaryName||'–')}</td>
              <td>${esc(it.varroaCount)}</td>
              <td>${it.varroaAnts?'🐜 Ja':'–'}</td>
              <td class="ellipsis" title="${esc(it.notes||'')}">${esc(it.notes||'')}</td>
              <td><button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}" title="Bearbeiten">✎</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  $('#print-varroa').onclick = () => printVarroaList(items);

  app.querySelectorAll('tr[data-open]').forEach(el => {
    el.onclick = (ev) => {
      if(ev.target.closest('[data-edit]')) return;
      go('colony', { colonyId: el.dataset.open, apiaryId: el.dataset.apiary, from: 'varroahistory', fromParams: {restoreScrollY: window.scrollY} });
    };
  });

  app.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const it = items.find(x => x.id === btn.dataset.edit);
      if(it) openVarroaEditModal(it);
    };
  });
}

function openVarroaEditModal(it) {
  openModal(`Zählung bearbeiten – ${esc(it.colonyName)}`, `
    <label class="lbl">Datum</label>
    <input class="inp" name="date" type="date" value="${esc(it.date)}">
    <label class="lbl" style="margin-top:.6rem">Anzahl gezählter Varroen</label>
    <input class="inp" name="varroaCount" type="number" min="0" value="${esc(it.varroaCount)}">
    <button type="button" class="obs-btn ${it.varroaAnts?'on':''}" id="btn-ants-edit" style="margin-top:.7rem">🐜 Ameisen gesehen</button>
    <label class="lbl" style="margin-top:.6rem">Info-Text</label>
    <textarea class="inp" name="notes" rows="2">${esc(it.notes||'')}</textarea>
  `, async(data, close) => {
    const antsBtn = document.getElementById('btn-ants-edit');
    const antsVal = antsBtn ? antsBtn.classList.contains('on') : false;
    await api('PUT','./api/entries/'+it.id, {
      ...it,
      date: data.date, notes: data.notes,
      varroaCount: data.varroaCount || '0', varroaAnts: antsVal
    });
    close();
    renderVarroaHistory();
  }, async(close) => {
    if(!confirm('Diese Zählung wirklich löschen?')) return;
    await api('DELETE','./api/entries/'+it.id);
    close();
    renderVarroaHistory();
  });
  const antsBtn = document.getElementById('btn-ants-edit');
  if(antsBtn) antsBtn.onclick = () => antsBtn.classList.toggle('on');
}

function printVarroaList(items) {
  const dateStr = new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const rowsHtml = items.map(it => `<tr>
    <td>${esc(it.colonyName)}</td>
    <td>${fmtDate(it.date)}</td>
    <td>${esc(it.apiaryName||'')}</td>
    <td>${esc(it.varroaCount)}</td>
    <td>${it.varroaAnts?'Ja':'–'}</td>
    <td>${esc(it.notes||'')}</td>
  </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Varroa-Zählungen ${dateStr}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:1.5cm;color:#000}
      h1{font-size:18px;margin:0 0 .2cm 0}
      .sub{font-size:11px;color:#555;margin-bottom:.5cm}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#f0f0f0;font-weight:700}
      tr:nth-child(even){background:#f9f9f9}
    </style></head><body>
    <h1>Varroa-Zählungen</h1>
    <div class="sub">${items.length} Zählungen · Stand ${dateStr}</div>
    <table><thead><tr><th>Volk</th><th>Datum</th><th>Standort</th><th>Anzahl</th><th>Ameisen</th><th>Info</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if(!w){ alert('Bitte Pop-ups erlauben, um zu drucken.'); return; }
  w.document.write(html);
  w.document.close();
}

async function renderGewicht() {
  setHeader('Gewicht', true);
  const apiaries = await apiGet('./api/apiaries');
  const fmtKg = (n) => n.toFixed(1).replace('.',',');

  let fullList = [];
  await Promise.all(apiaries.map(async(a) => {
    const colsData = await apiGet('./api/colonies?apiaryId=' + a.id);
    colsData.forEach(c => { c._apiaryName = a.name; });
    fullList = fullList.concat(colsData);
  }));
  // BK-Standorte ausschließen
  fullList = fullList.filter(c => !isBkName(c._apiaryName));

  const gewichtSettings = await apiGet('./api/settings').catch(()=>({}));
  const savedApiaryId = gewichtSettings.gewichtApiaryFilter || '';
  let currentApiaryId = apiaries.some(a => a.id === savedApiaryId) ? savedApiaryId : '';
  let all = [];
  const applyFilter = () => {
    all = currentApiaryId ? fullList.filter(c => c.apiaryId === currentApiaryId) : fullList.slice();
    all.sort((a,b) => a.name.localeCompare(b.name, 'de'));
  };
  applyFilter();

  app.innerHTML = `
    <p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Hier kannst du alle Gewichte erfassen –
    einfach oben das erste Volk antippen und dann der Reihe nach alle Völker durchgehen.</p>
    <label class="lbl">Standort</label>
    <select class="inp" id="gewicht-apiary-select" style="margin-bottom:.8rem">
      <option value="" ${currentApiaryId===''?'selected':''}>Alle Standorte</option>
      ${apiaries.map(a => `<option value="${esc(a.id)}" ${a.id===currentApiaryId?'selected':''}>${esc(a.name)}</option>`).join('')}
    </select>
    <div id="gewicht-body"></div>
    <div style="padding:1rem .8rem .5rem;display:flex;flex-direction:column;gap:.5rem">
      <button class="btn btn-primary" id="btn-set-ziel">🎯 Ziel-Gewicht setzen</button>
      <button class="btn btn-ghost btn-sm" id="btn-print-gewicht" style="align-self:flex-end">🖨 Drucken</button>
    </div>`;

  const bodyEl = document.getElementById('gewicht-body');
  const renderList = () => {
    bodyEl.innerHTML = all.length === 0 ? emptyState('Keine Völker','Keine Völker (ohne BK) vorhanden.') : `
      <div style="display:grid;grid-template-columns:1fr 52px 52px 60px;gap:.5rem;padding:0 .8rem;font-size:.72rem;color:var(--ink-soft);margin-bottom:.25rem">
        <span></span><span style="text-align:right">Ist</span><span style="text-align:right">Ziel</span><span style="text-align:right">Fehlt</span>
      </div>
      <ul class="card-list gewicht-list">
        ${all.map(c => {
          const cur = parseFloat(c.currentWeight);
          const ziel = parseFloat(c.zielGewicht);
          const hasCur = !isNaN(cur);
          const hasZiel = !isNaN(ziel);
          const fehlt = (hasCur && hasZiel) ? ziel - cur : null;
          const fehltText = fehlt === null ? '–' : (fehlt > 0 ? fmtKg(fehlt) : '✓');
          const fehltColor = fehlt === null ? 'var(--ink-soft)' : (fehlt > 0 ? 'var(--ink)' : 'var(--ok,#2f9e44)');
          return `
            <li class="card gewicht-item" data-id="${esc(c.id)}" data-apiary="${esc(c.apiaryId)}"
                style="display:grid;grid-template-columns:1fr 52px 52px 60px;gap:.5rem;align-items:center;padding:.55rem .8rem;touch-action:manipulation;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none">
              <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">${esc(c.name)}</div>
              <div style="text-align:right;font-size:.85rem;color:var(--ink-soft);font-variant-numeric:tabular-nums">${hasCur ? fmtKg(cur) : '–'}</div>
              <div style="text-align:right;font-size:.85rem;color:var(--ink-soft);font-variant-numeric:tabular-nums">${hasZiel ? fmtKg(ziel) : '–'}</div>
              <div style="text-align:right;font-size:.85rem;font-weight:650;color:${fehltColor};font-variant-numeric:tabular-nums">${fehltText}</div>
            </li>`;
        }).join('')}
      </ul>`;

    bodyEl.querySelectorAll('.gewicht-item').forEach(li => {
      let pressTimer = null;
      let longPressed = false;
      let activePointerId = null;

      const startPress = (e) => {
        longPressed = false;
        activePointerId = e.pointerId;
        pressTimer = setTimeout(() => {
          longPressed = true;
          /* Implizite Pointer-Capture explizit freigeben, BEVOR das Element aus dem DOM verschwindet –
             sonst bleibt der Browser (v.a. Android/iOS) in einem "Finger hängt noch am alten Element"-
             Zustand, der erst durch einen zweiten, ins Leere gehenden Tap aufgelöst wird. */
          try{ if(activePointerId!=null && li.hasPointerCapture?.(activePointerId)) li.releasePointerCapture(activePointerId); }catch(_){}
          const colony = all.find(c => c.id === li.dataset.id);
          if(colony) go('colony', { colonyId: colony.id, apiaryId: colony.apiaryId, from: 'gewicht', fromParams: {restoreScrollY: window.scrollY} });
        }, 1000);
      };
      const cancelPress = () => {
        if(pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      };

      li.addEventListener('pointerdown', startPress);
      li.addEventListener('pointerup', cancelPress);
      li.addEventListener('pointerleave', cancelPress);
      li.addEventListener('pointercancel', cancelPress);
      li.addEventListener('contextmenu', (e) => e.preventDefault());

      li.onclick = () => {
        if(longPressed) { longPressed = false; return; }
        const idx = all.findIndex(c => c.id === li.dataset.id);
        if(idx>=0) openWeightModal(idx);
      };
    });
  };

  const openWeightModal = (idx) => {
    if(idx<0 || idx>=all.length) return;
    const c = all[idx];
    openModal(`Gewicht erfassen — ${esc(c.name)}`, `
      ${field('Datum','date',todayInput(),true,'date')}
      <label class="lbl">Teilgewicht 1 (kg)</label>
      <input class="inp" name="teil1" type="text" inputmode="decimal" placeholder="z. B. 10,3" autofocus>
      <label class="lbl" style="margin-top:.5rem">Teilgewicht 2 (kg)</label>
      <input class="inp" name="teil2" type="text" inputmode="decimal" placeholder="z. B. 8,1">`,
      async(data,close)=>{
        const t1 = parseDecimal(data.teil1), t2 = parseDecimal(data.teil2);
        if(isNaN(t1) || isNaN(t2)) return alert('Bitte beide Teilgewichte eingeben.');
        const entryDate = data.date || todayInput();
        const totalStr = (Math.round((t1+t2)*10)/10).toString();
        await api('POST','./api/entries',{
          colonyId: c.id, type:'Gewichtserfassung', date: entryDate, notes:'', photos:[], obs:[],
          obs_extra: { gewicht: totalStr, teilgewicht1: data.teil1, teilgewicht2: data.teil2 },
          createdAt: new Date().toISOString()
        });
        await api('PUT','./api/colonies/'+c.id, {...c, currentWeight: totalStr, currentWeightDate: entryDate});
        c.currentWeight = totalStr; c.currentWeightDate = entryDate;
        close();
        renderList();
        showToast(`✅ ${totalStr.replace('.',',')} kg gespeichert`);
        openWeightModal(idx+1);
      }, null, true);
    setTimeout(()=>{
      const t1input = document.querySelector('.modal-body input[name="teil1"]');
      const t2input = document.querySelector('.modal-body input[name="teil2"]');
      t1input?.focus();
      t1input?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); t2input?.focus(); } });
      t2input?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); document.getElementById('m-save')?.click(); } });
    }, 50);
  };

  renderList();

  document.getElementById('gewicht-apiary-select').onchange = (ev) => {
    currentApiaryId = ev.target.value;
    api('POST','./api/settings',{gewichtApiaryFilter: currentApiaryId}).catch(()=>{});
    applyFilter();
    renderList();
  };

  document.getElementById('btn-set-ziel').onclick = () => {
    openModal('Ziel-Gewicht setzen', `
      <label class="lbl">Ziel-Gewicht (kg)</label>
      <input class="inp" name="zielGewicht" type="number" step="0.1" min="0" placeholder="z.B. 44" required>
      <label class="lbl" style="margin-top:.8rem">Für welche Völker?</label>
      <label class="check-item"><input type="checkbox" id="ziel-select-all" checked><span>Alle auswählen</span></label>
      <div class="check-list">
        ${all.map(c => `<label class="check-item"><input type="checkbox" class="ziel-col-check" value="${c.id}" checked><span>${esc(c.name)}${c._apiaryName?' ('+esc(c._apiaryName)+')':''}</span></label>`).join('')}
      </div>`,
      async(data,close)=>{
        if(!data.zielGewicht) return alert('Bitte ein Ziel-Gewicht eingeben.');
        const ids=[...document.querySelectorAll('.ziel-col-check:checked')].map(x=>x.value);
        if(ids.length===0) return alert('Bitte mindestens ein Volk auswählen.');
        await api('POST','./api/colonies/bulk-update',{ids,fields:{zielGewicht:data.zielGewicht}});
        close(); renderGewicht();
      }, null, true);
    document.getElementById('ziel-select-all').onchange = (e) => {
      document.querySelectorAll('.ziel-col-check').forEach(chk => chk.checked = e.target.checked);
    };
  };

  document.getElementById('btn-print-gewicht').onclick = () => printGewichtList(all, fmtKg);
}

/* ---------- Druck der Gewicht-Liste ---------- */
function printGewichtList(all, fmtKg) {
  const dateStr = new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const rows = all.map(c => {
    const cur = parseFloat(c.currentWeight);
    const ziel = parseFloat(c.zielGewicht);
    const hasCur = !isNaN(cur);
    const hasZiel = !isNaN(ziel);
    const fehlt = (hasCur && hasZiel) ? ziel - cur : null;
    const fehltText = fehlt === null ? '–' : (fehlt > 0 ? fmtKg(fehlt) : '✓');
    return `<tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c._apiaryName||'')}</td>
      <td>${hasCur ? fmtKg(cur) : '–'}</td>
      <td>${hasZiel ? fmtKg(ziel) : '–'}</td>
      <td>${fehltText}</td>
    </tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gewichtsübersicht ${dateStr}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:1.5cm;color:#000}
      h1{font-size:18px;margin:0 0 .2cm 0}
      .sub{font-size:11px;color:#555;margin-bottom:.5cm}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#f0f0f0;font-weight:700}
    </style></head><body>
    <h1>Gewichtsübersicht</h1>
    <div class="sub">Stand: ${dateStr}</div>
    <table><thead><tr><th>Volk</th><th>Standort</th><th>Ist (kg)</th><th>Ziel (kg)</th><th>Fehlt (kg)</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if(!w){ alert('Bitte Pop-ups erlauben, um zu drucken.'); return; }
  w.document.write(html);
  w.document.close();
}

/* ---------- Archiv ---------- */
async function renderArchive() {
  setHeader('Archiv',true);
  const list=await apiGet('./api/archive');
  if(list.length===0){app.innerHTML=emptyState('Archiv ist leer','Archivierte Völker erscheinen hier.');return;}
  const groups={};
  for(const c of list){const y=(c.archivedAt||'').slice(0,4)||'Ohne Jahr';(groups[y]=groups[y]||[]).push(c);}
  const years=Object.keys(groups).sort((a,b)=>b.localeCompare(a));
  app.innerHTML='<p class="muted" style="font-size:.8rem; margin:0 0 .8rem">Archivierte Völker nach Jahr – hier'+
    ' wiederherstellen oder endgültig löschen.</p>'+years.map((y)=>`<h2 class="section-h">${esc(y)}</h2>
    <ul class="card-list">${groups[y].map((c)=>`<li class="card" data-open="${c.id}">
      <div class="card-main"><div class="card-title">${esc(c.name)}</div>
      <div class="card-sub">${c.apiaryName?esc(c.apiaryName):'(Standort gelöscht)'}${c.queenYear?` · Kö ${queenYearBadge(c.queenYear)}`:''}</div></div>
      <button class="btn btn-ghost btn-sm" data-restore="${c.id}">Wiederherstellen</button>
      <button class="btn btn-danger btn-sm" data-delete="${c.id}" title="Endgültig löschen">🗑</button></li>`).join('')}</ul>`).join('');
  app.querySelectorAll('[data-open]').forEach((el)=>el.onclick=()=>go('colony',{colonyId:el.dataset.open,from:'archive',fromParams:{}}));
  app.querySelectorAll('[data-restore]').forEach((b)=>b.onclick=(e)=>{e.stopPropagation();restoreColony(b.dataset.restore);});
  app.querySelectorAll('[data-delete]').forEach((b)=>b.onclick=async(e)=>{
    e.stopPropagation();
    const c=list.find((x)=>x.id===b.dataset.delete);
    if(!confirm(`„${c?.name||'Dieses Volk'}" endgültig aus dem Archiv löschen? Alle Einträge und Fotos werden unwiderruflich mitgelöscht.`)) return;
    await api('DELETE','./api/colonies/'+b.dataset.delete);
    renderArchive();
  });
}

async function restoreColony(colonyId) {
  const apiaries=await apiGet('./api/apiaries');
  if(apiaries.length===0){alert('Bitte zuerst einen Standort anlegen.');return;}
  openModal('Wiederherstellen',`<p class="muted">An welchen Standort?</p>${selectField('Standort','apiaryId',apiaries[0].id,apiaries.map((a)=>[a.id,a.name]))}`,
    async(data,close)=>{ await api('POST','./api/colonies/'+colonyId+'/restore',{apiaryId:data.apiaryId}); close(); renderArchive(); },null);
}

/* ---------- Einstellungen ---------- */
async function renderSettings() {
  setHeader('Einstellungen',true);
  const scales=await apiGet('./api/scales');
  const settingsSection = (id,title,body) => `<details class="settings-section" data-sec="${id}">
      <summary class="section-h">${title}</summary>
      <div class="settings-section-body">${body}</div>
    </details>`;
  app.innerHTML=`<div class="settings">
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:.5rem;margin-bottom:.5rem;flex-wrap:wrap">
      <a class="btn btn-ghost btn-sm" id="setup-portal-link" style="display:none">⚙️ Setup / Update / Backup</a>
      <button class="btn btn-save-settings" id="save-all-settings">💾 Speichern</button>
    </div>
    ${settingsSection('betrieb','Betrieb',`
      <label class="lbl">Betriebsname (wird oben angezeigt)</label>
      <input class="inp" id="apiary-name-input" type="text" placeholder="z. B. Imkerei Frerichs" value="">
      <label class="lbl" style="margin-top:1rem">Betriebslogo</label>
      <div id="logo-preview-wrap" style="margin:.3rem 0;display:none">
        <img id="logo-preview" src="./api/logo" style="max-height:60px;max-width:200px;object-fit:contain"
          onerror="document.getElementById('logo-preview-wrap').style.display='none'">
      </div>
      <div class="photo-row" style="margin-top:.3rem">
        <label class="btn btn-ghost">📂 Logo hochladen
          <input type="file" id="logo-upload-input" accept="image/png,image/jpeg" hidden>
        </label>
        <button class="btn btn-ghost btn-sm" id="logo-delete-btn" style="display:none">Logo löschen</button>
      </div>`)}
    ${settingsSection('zucht','Königinnenzucht – Zeitabstände',`
      <p class="muted">Wird für die Berechnung von Schlupf und erster Eilage verwendet.</p>
      <label class="lbl">Umlarven → Schlupf (Tage)</label>
      <input class="inp" id="schlupf-days" type="number" min="1" max="30" value="11">
      <label class="lbl" style="margin-top:.5rem">Schlupf → Erste Eilage (Tage)</label>
      <input class="inp" id="eilage-days" type="number" min="1" max="60" value="28">`)}
    ${settingsSection('gewicht','Gewicht',`
      <p class="muted">Ziel-Gewicht, das neuen Völkern automatisch zugewiesen wird.</p>
      <label class="lbl">Ziel-Gewicht (kg)</label>
      <input class="inp" id="ziel-gewicht" type="number" step="0.1" min="0" placeholder="z.B. 44">`)}
    ${settingsSection('oxalblockgap','Oxalsäure-Blockbehandlung',`
      <p class="muted">Nach jeder gespeicherten Blockstufe wird automatisch eine Erinnerung für die
      nächste fällige Stufe angelegt (und die vorherige Auto-Erinnerung entfernt).</p>
      <label class="lbl">Tage zwischen den Stufen</label>
      <input class="inp" id="oxal-block-gap-days" type="number" min="1" max="30" value="4">`)}
    ${settingsSection('bkfilter','Sonderbehandlung „BK"-Völker',`
      <p class="muted">Völker bzw. Standorte, deren Name mit diesem Präfix beginnt, werden in
      Übersichten (Alle Völker, Gewicht, Varroa-Zählung, Varroa-Historie, Ziel-Gewicht setzen)
      gesondert behandelt bzw. ausgeblendet. Präfix leer lassen, um die Sonderbehandlung
      abzuschalten.</p>
      <label class="lbl">Präfix</label>
      <input class="inp" id="bk-prefix" type="text" maxlength="10" placeholder="BK">`)}
    ${settingsSection('standorte','Standorte',`
      <button class="btn btn-primary block" id="add-apiary">+ Neuen Standort anlegen</button>`)}
    ${settingsSection('waagen','Stockwaagen',`
      <p class="muted">Bis zu 5 Beelogger-Waagen eintragen.</p>
      <ul class="card-list">${scales.map((s)=>`<li class="card"><div class="card-main"><div class="card-title">${esc(s.name)}</div><div class="card-sub scale-url-preview">${esc(s.url||'–')}</div></div><button class="btn btn-ghost btn-sm" data-edit-scale="${s.id}">Bearbeiten</button></li>`).join('')}${scales.length===0?'<li class="card muted" style="justify-content:center">Noch keine Waagen</li>':''}</ul>
      ${scales.length<5?'<button class="btn btn-ghost block" id="add-scale">+ Waage hinzufügen</button>':''}`)}
    ${settingsSection('allecols','„Alle Völker" – Angezeigte Felder',`
      <p class="muted">Welche Spalten sollen in der Gesamtübersicht erscheinen?</p>
      <div class="check-list" id="all-cols-cfg">
        ${ALL_COLS.map(c=>`<label class="check-item">
          <input type="checkbox" class="all-col-chk" data-key="${c.key}" ${c.def?'checked':''}><span>${esc(c.label)}</span>
        </label>`).join('')}
      </div>`)}
    ${settingsSection('homebtns','Startseite – Angezeigte Buttons',`
      <p class="muted">Welche Buttons sollen auf der Startseite erscheinen?</p>
      <div class="check-list" id="home-btns-cfg">
        ${HOME_BTN_CONFIG.map(c=>`<label class="check-item">
          <input type="checkbox" class="home-btn-chk" data-key="${c.key}" checked><span>${esc(c.label)}</span>
        </label>`).join('')}
      </div>`)}
    ${settingsSection('darstellung','Darstellung',`
      <label class="lbl">Design</label>
      <select class="inp" id="theme-select">
        <option value="system">System (automatisch)</option>
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
      </select>
      <label class="check-item" style="margin-top:.7rem">
        <input type="checkbox" id="toggle-hr-nrs"> <span>Honigraum-Nummern in Übersicht anzeigen</span>
      </label>
      <label class="check-item" style="margin-top:.5rem">
        <input type="checkbox" id="toggle-show-search"> <span>Suchfeld auf Startseite anzeigen</span>
      </label>`)}
    ${settingsSection('varroa','Varroa Zählung',`
      <label class="check-item">
        <input type="checkbox" id="toggle-varroa-autonext"> <span>Nach dem Speichern automatisch zum nächsten Volk springen</span>
      </label>`)}
    ${settingsSection('aktionbtns','Aktions-Buttons im Eintrag',`
      <p class="muted">Welche Aktions-Buttons sollen im Eintragsformular erscheinen?</p>
      <div class="check-list" id="action-btns-cfg">
        ${ACTION_BTN_CONFIG.map(c=>`<label class="check-item">
          <input type="checkbox" class="action-btn-chk" data-key="${c.key}" checked><span>${esc(c.label)}</span>
        </label>`).join('')}
      </div>`)}
    ${settingsSection('obsbtns','Beobachtungs-Buttons im Eintrag',`
      <p class="muted">Welche Beobachtungs-Buttons sollen im Eintragsformular erscheinen?</p>
      <div class="check-list" id="obs-btns-cfg">
        ${[...OBS_OPTIONS,...OBS_SELECT_CONFIG.map((c)=>[c.key,c.label])].map(([k,l])=>`<label class="check-item">
          <input type="checkbox" class="obs-btn-chk" data-key="${k}" checked><span>${esc(l)}</span>
        </label>`).join('')}
      </div>`)}
    <div id="backup-section-wrap">${settingsSection('datensicherung','Backup',`
      <a class="btn btn-ghost block" href="./api/backup" download>Backup exportieren (.json)</a>
      <label class="btn btn-ghost block">Backup importieren<input type="file" accept="application/json,.json" id="import-input" hidden></label>`)}</div>
    ${settingsSection('bereinigen','Daten bereinigen',`
      <div id="bereinigen-warning" class="banner-error" style="display:none;margin-bottom:.75rem">
        ⚠️ Diese Aktionen sind erst wieder möglich, sobald ein Backup existiert, das
        höchstens ${BACKUP_GRACE_DAYS_FRONTEND} Tage alt ist.
        <a class="btn btn-ghost block" href="#" id="bereinigen-backup-link" style="margin-top:.5rem">Jetzt Backup erstellen</a>
      </div>
      <button type="button" class="btn btn-danger block bereinigen-btn" id="btn-clear-fuetterung">Alle Fütterungs-Einträge entfernen</button>
      <button type="button" class="btn btn-danger block bereinigen-btn" id="btn-clear-honigraeume" style="margin-top:.5rem">Alle Honigräume entfernen</button>
      <button type="button" class="btn btn-danger block bereinigen-btn" id="btn-clear-demaree" style="margin-top:.5rem">Demaree-Status (Volkseinstellungen) zurücksetzen</button>
      <button type="button" class="btn btn-danger block bereinigen-btn" id="btn-clear-oxalblock" style="margin-top:.5rem">Oxalsäure-Blockbehandlung (Volkseinstellungen) zurücksetzen</button>
      <button type="button" class="btn btn-danger block bereinigen-btn" id="btn-clear-umlarv" style="margin-top:.5rem">Königinnenzucht-Datum (Volkseinstellungen) zurücksetzen</button>
      <p class="muted" style="margin-top:.5rem">Setzt nur die Felder am Volk zurück – vorhandene Einträge in der Stockkarte bleiben erhalten.</p>`)}
  </div>`;
  document.querySelectorAll('.settings-section').forEach(sec=>{
    const key='settingsSecOpen_'+sec.dataset.sec;
    if(localStorage.getItem(key)==='1') sec.open=true;
    sec.addEventListener('toggle', ()=>{ localStorage.setItem(key, sec.open?'1':'0'); });
  });
  // Setup/Update/Backup: ist ein Setup-Portal installiert (Pi ODER
  // Linux-Server per install.sh), einen einzigen Button oben neben
  // "Speichern" dorthin anzeigen (deckt Backup, Update, WLAN etc. ab) und
  // die separate Backup-Sektion (nur einfache JSON-Sicherung) ausblenden.
  // Ohne Setup-Portal (z. B. rein manuelle Installation) bleibt die
  // JSON-Sicherung die einzige Option, der Button bleibt versteckt.
  (async()=>{
    try{
      const r=await fetch('./api/platform');
      const d=await r.json();
      if(d && d.setupPortal){
        const setupLink=document.getElementById('setup-portal-link');
        const backupWrap=document.getElementById('backup-section-wrap');
        if(setupLink){ setupLink.href=setupPortalUrl(d.landingPort,'/'); setupLink.style.display=''; }
        if(backupWrap) backupWrap.style.display='none';
      }
      // "Daten bereinigen" nur mit einem ausreichend aktuellen Backup erlauben
      // (serverseitig ohnehin erzwungen - hier nur fuer klares Feedback vorab).
      const warn=document.getElementById('bereinigen-warning');
      const btns=document.querySelectorAll('.bereinigen-btn');
      if(d && !d.recentBackup){
        if(warn) warn.style.display='';
        btns.forEach(b=>{ b.disabled=true; b.style.opacity='.5'; });
        const bl=document.getElementById('bereinigen-backup-link');
        if(bl){
          bl.onclick=(ev)=>{
            ev.preventDefault();
            if(d.setupPortal) window.location.href=setupPortalUrl(d.landingPort,'/backup');
            else window.location.href='./api/backup';
          };
        }
      }
    }catch(_){}
  })();
  // Logo-Vorschau
  (async()=>{
    try{
      const r=await fetch('./api/logo',{method:'HEAD'});
      if(r.ok){
        const pw=document.getElementById('logo-preview-wrap');
        const db=document.getElementById('logo-delete-btn');
        if(pw) pw.style.display='';
        if(db) db.style.display='';
      }
    }catch(_){}
  })();
  const logoInp=document.getElementById('logo-upload-input');
  if(logoInp) logoInp.onchange=async(ev)=>{
    const file=ev.target.files[0]; if(!file) return;
    logoInp.disabled=true;
    try{
      const blob=await resizeImage(file,800,0.88);
      await api('POST','./api/logo',blob,true);
      const pw=document.getElementById('logo-preview-wrap');
      const lp=document.getElementById('logo-preview');
      const db=document.getElementById('logo-delete-btn');
      if(lp){ lp.src='./api/logo?t='+Date.now(); }
      if(pw) pw.style.display='';
      if(db) db.style.display='';
      alert('Logo gespeichert.');
    }catch(err){alert('Fehler: '+err.message);}
    logoInp.disabled=false; ev.target.value='';
  };
  const logoDelBtn=document.getElementById('logo-delete-btn');
  if(logoDelBtn) logoDelBtn.onclick=async()=>{
    if(!confirm('Logo löschen?')) return;
    try{
      await api('DELETE','./api/logo');
      const pw=document.getElementById('logo-preview-wrap');
      if(pw) pw.style.display='none';
      logoDelBtn.style.display='none';
      alert('Logo gelöscht.');
    }catch(err){alert('Fehler: '+err.message);}
  };
  // Zucht-Einstellungen laden
  apiGet('./api/settings').then(s => {
    const sd = document.getElementById('schlupf-days');
    const ed = document.getElementById('eilage-days');
    if(sd) sd.value = s.schlupfDays || '11';
    if(ed) ed.value = s.eilageDays  || '28';
    const zg = document.getElementById('ziel-gewicht');
    if(zg) zg.value = s.zielGewicht || '';
    const obg = document.getElementById('oxal-block-gap-days');
    if(obg) obg.value = s.oxalBlockGapDays || '4';
    const bkP = document.getElementById('bk-prefix');
    if(bkP) bkP.value = s.bkPrefix !== undefined ? s.bkPrefix : 'BK';
  }).catch(()=>{});

  const nameInp = document.getElementById('apiary-name-input');
  if(nameInp) nameInp.value = getApiaryName();

  $('#add-apiary').onclick=()=>apiaryForm();
  const addScale=$('#add-scale'); if(addScale) addScale.onclick=()=>scaleForm(null,()=>renderSettings());

  document.getElementById('btn-clear-fuetterung')?.addEventListener('click', async () => {
    if(!confirm('Wirklich ALLE Fütterungs-Einträge unwiderruflich entfernen?')) return;
    try {
      const r = await api('POST','./api/entries/clear-fuetterung',{});
      alert((r.deleted||0)+' Fütterungs-Einträge entfernt.');
      renderSettings();
    } catch(err) { alert('Fehler: '+err.message); }
  });

  document.getElementById('btn-clear-honigraeume')?.addEventListener('click', async () => {
    if(!confirm('Wirklich bei ALLEN Völkern die Honigräume entfernen?')) return;
    try {
      await api('POST','./api/colonies/clear-honigraeume',{});
      alert('Honigräume bei allen Völkern entfernt.');
      renderSettings();
    } catch(err) { alert('Fehler: '+err.message); }
  });

  document.getElementById('btn-clear-demaree')?.addEventListener('click', async () => {
    if(!confirm('Wirklich bei ALLEN Völkern den Demaree-Status zurücksetzen? Einträge in der Stockkarte bleiben erhalten.')) return;
    try {
      await api('POST','./api/colonies/clear-demaree',{});
      alert('Demaree-Status bei allen Völkern zurückgesetzt.');
      renderSettings();
    } catch(err) { alert('Fehler: '+err.message); }
  });

  document.getElementById('btn-clear-oxalblock')?.addEventListener('click', async () => {
    if(!confirm('Wirklich bei ALLEN Völkern die Oxalsäure-Blockbehandlung zurücksetzen? Einträge in der Stockkarte bleiben erhalten.')) return;
    try {
      await api('POST','./api/colonies/clear-oxalblock',{});
      alert('Oxalsäure-Blockbehandlung bei allen Völkern zurückgesetzt.');
      renderSettings();
    } catch(err) { alert('Fehler: '+err.message); }
  });

  document.getElementById('btn-clear-umlarv')?.addEventListener('click', async () => {
    if(!confirm('Wirklich bei ALLEN Völkern das Königinnenzucht-Datum (Umlarvdatum) zurücksetzen? Einträge in der Stockkarte bleiben erhalten.')) return;
    try {
      await api('POST','./api/colonies/clear-umlarv',{});
      alert('Königinnenzucht-Datum bei allen Völkern zurückgesetzt.');
      renderSettings();
    } catch(err) { alert('Fehler: '+err.message); }
  });
  document.querySelectorAll('[data-edit-scale]').forEach((b)=>{ const s=scales.find((x)=>x.id===b.dataset.editScale); b.onclick=()=>scaleForm(s,()=>renderSettings()); });
  // Alle-Völker Konfiguration laden
  apiGet('./api/settings').then(s=>{
    document.querySelectorAll('.all-col-chk').forEach(chk=>{
      const k=chk.dataset.key;
      const stored=s['allCol_'+k];
      if(stored!==undefined) chk.checked=(stored==='true');
    });
    document.querySelectorAll('.home-btn-chk').forEach(chk=>{
      const k=chk.dataset.key;
      const stored=s['homeBtn_'+k];
      chk.checked=(stored!=='false');
    });
  }).catch(()=>{});
  document.getElementById('save-all-settings')?.addEventListener('click', async()=>{
    const payload={};
    // Betriebsname
    const nameInpV=document.getElementById('apiary-name-input');
    if(nameInpV?.value.trim()) setApiaryName(nameInpV.value.trim());
    // Zucht-Einstellungen
    const sd=document.getElementById('schlupf-days')?.value;
    const ed=document.getElementById('eilage-days')?.value;
    if(sd) payload.schlupfDays=sd;
    if(ed) payload.eilageDays=ed;
    const zg=document.getElementById('ziel-gewicht')?.value;
    if(zg) payload.zielGewicht=zg;
    const obg=document.getElementById('oxal-block-gap-days')?.value;
    if(obg) payload.oxalBlockGapDays=obg;
    const bkPEl=document.getElementById('bk-prefix');
    if(bkPEl) payload.bkPrefix=bkPEl.value.trim();
    // Alle-Spalten
    document.querySelectorAll('.all-col-chk').forEach(chk=>{
      payload['allCol_'+chk.dataset.key]=chk.checked?'true':'false';
    });
    // Startseite-Buttons
    document.querySelectorAll('.home-btn-chk').forEach(chk=>{
      payload['homeBtn_'+chk.dataset.key]=chk.checked?'true':'false';
    });
    // HR-Nummern
    const hrNrsToggle=document.getElementById('toggle-hr-nrs');
    if(hrNrsToggle) payload.showHrNrs=hrNrsToggle.checked?'true':'false';
    // Suchfeld
    const showSearchToggle=document.getElementById('toggle-show-search');
    if(showSearchToggle) payload.showSearch=showSearchToggle.checked?'true':'false';
    // Aktions-Buttons
    document.querySelectorAll('.action-btn-chk').forEach(chk=>{
      payload['actionBtn_'+chk.dataset.key]=chk.checked?'true':'false';
    });
    // Beobachtungs-Buttons
    document.querySelectorAll('.obs-btn-chk').forEach(chk=>{
      payload['obsBtn_'+chk.dataset.key]=chk.checked?'true':'false';
    });
    if(Object.keys(payload).length) await api('POST','./api/settings',payload);
    await loadSettings();
    alert('Einstellungen gespeichert.');
  });
  const ts=$('#theme-select'); ts.value=currentTheme(); ts.onchange=()=>applyTheme(ts.value);
  const hrNrsToggle=document.getElementById('toggle-hr-nrs');
  if(hrNrsToggle){
    apiGet('./api/settings').then(s => {
      hrNrsToggle.checked = (s.showHrNrs !== 'false');
    }).catch(()=>{ hrNrsToggle.checked = true; });
    hrNrsToggle.onchange = async () => {
      await api('POST','./api/settings',{showHrNrs: hrNrsToggle.checked ? 'true' : 'false'});
      window._showHrNrs = hrNrsToggle.checked;
    };
  }
  const showSearchToggle=document.getElementById('toggle-show-search');
  if(showSearchToggle){
    apiGet('./api/settings').then(s => {
      showSearchToggle.checked = (s.showSearch !== 'false');
    }).catch(()=>{ showSearchToggle.checked = true; });
    showSearchToggle.onchange = async () => {
      await api('POST','./api/settings',{showSearch: showSearchToggle.checked ? 'true' : 'false'});
      window._showSearch = showSearchToggle.checked;
    };
  }
  const varroaAutoNextToggle=document.getElementById('toggle-varroa-autonext');
  if(varroaAutoNextToggle){
    apiGet('./api/settings').then(s => {
      varroaAutoNextToggle.checked = (s.varroaAutoNext === 'true');
    }).catch(()=>{ varroaAutoNextToggle.checked = false; });
    varroaAutoNextToggle.onchange = async () => {
      await api('POST','./api/settings',{varroaAutoNext: varroaAutoNextToggle.checked ? 'true' : 'false'});
    };
  }
  // Aktions- und Beobachtungs-Buttons: Checkbox-Zustand laden (Default: alle an)
  apiGet('./api/settings').then(s=>{
    document.querySelectorAll('.action-btn-chk').forEach(chk=>{
      chk.checked = (s['actionBtn_'+chk.dataset.key] !== 'false');
    });
    document.querySelectorAll('.obs-btn-chk').forEach(chk=>{
      chk.checked = (s['obsBtn_'+chk.dataset.key] !== 'false');
    });
  }).catch(()=>{});
  $('#import-input').onchange=async(ev)=>{
    const file=ev.target.files[0]; if(!file) return;
    if(!confirm('Backup importieren? Vorhandene Daten werden ersetzt.')) return;
    try{ const data=JSON.parse(await file.text()); await api('POST','./api/restore',data); alert('Backup importiert.'); go('apiaries'); }
    catch(err){alert('Import fehlgeschlagen: '+err.message);}
  };
}

function scaleForm(existing, after) {
  openModal(existing?'Waage bearbeiten':'Neue Waage',`
    ${field('Name','name',existing?.name,true)}${field('URL (http://...)','url',existing?.url)}${textareaField('Notizen','notes',existing?.notes)}`,
    async(data,close)=>{ if(!data.name.trim()) return alert('Bitte einen Namen eingeben.'); if(existing) await api('PUT','./api/scales/'+existing.id,data); else await api('POST','./api/scales',data); close(); if(after) after(); },
    existing?async(close)=>{ if(!confirm('Waage löschen?')) return; await api('DELETE','./api/scales/'+existing.id); close(); if(after) after(); }:null);
}

/* ============================================================
   UI-Bausteine
   ============================================================ */
function emptyState(title,sub){
  return `<div class="empty"><svg viewBox="0 0 100 100" class="hex" aria-hidden="true"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27"/></svg><div class="empty-title">${esc(title)}</div><div class="empty-sub">${esc(sub)}</div></div>`;
}
function field(label,name,val,required,type='text'){
  if(type==='date'){
    return `<label class="lbl">${esc(label)}${required?' *':''}</label>
      <div style="display:flex;gap:.4rem;align-items:center">
        <input class="inp" name="${name}" type="date" value="${esc(val??'')}" style="flex:1">
        <button type="button" class="btn btn-ghost btn-sm date-clear" data-clear="${name}" title="Datum löschen">✕</button>
      </div>`;
  }
  return `<label class="lbl">${esc(label)}${required?' *':''}</label><input class="inp" name="${name}" type="${type}" value="${esc(val??'')}">`;
}
function textareaField(label,name,val){
  return `<label class="lbl">${esc(label)}</label><textarea class="inp" name="${name}" rows="3">${esc(val??'')}</textarea>`;
}
function selectField(label,name,val,options){
  return `<label class="lbl">${esc(label)}</label><select class="inp" name="${name}">${options.map(([v,t])=>`<option value="${esc(v)}" ${v===val?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
}

/* ---------- Honigraum-Editor (Punkt 4: Sortierung + Nummer editieren) ---------- */
function wireHR(colony) {
  const container = document.getElementById('hr-list');
  if (!container) return;
  const hrs = colony ? parseHR(colony) : [];

  const draw = () => {
    if(!hrs.length){ container.innerHTML='<p class="muted">Keine Honigraume eingetragen</p>'; syncHR(); return; }
    container.innerHTML = hrs.map((hr, i) => `
      <div class="hr-row">
        <span class="hr-position">${hrs.length - i}</span>
        <div class="hr-sort-ctrl">
          <button type="button" class="sort-btn hr-up" data-i="${i}" ${i===0?'disabled':''}>▲</button>
          <button type="button" class="sort-btn hr-down" data-i="${i}" ${i===hrs.length-1?'disabled':''}>▼</button>
        </div>
        <span class="hr-nr">Nr. <input class="inp hr-nr-inp" data-i="${i}" maxlength="2" value="${esc(hr.nr||'--')}" style="width:3rem;display:inline;padding:.1rem .3rem"></span>
        <input class="inp hr-date-inp" data-i="${i}" type="date" value="${esc(hr.date||'')}" style="width:9rem;display:inline;padding:.1rem .3rem">
        <button type="button" class="btn btn-ghost btn-sm hr-del" data-i="${i}">✕</button>
      </div>`).join('');
    container.querySelectorAll('.hr-del').forEach((b)=>b.onclick=()=>{ hrs.splice(+b.dataset.i,1); draw(); updateAddBtn(); });
    container.querySelectorAll('.hr-nr-inp').forEach((inp)=>inp.oninput=()=>{ hrs[+inp.dataset.i].nr=inp.value; syncHR(); });
    container.querySelectorAll('.hr-date-inp').forEach((inp)=>inp.onchange=()=>{ hrs[+inp.dataset.i].date=inp.value; syncHR(); });
    container.querySelectorAll('.hr-up').forEach((b)=>b.onclick=()=>{ const i=+b.dataset.i; if(i>0){[hrs[i-1],hrs[i]]=[hrs[i],hrs[i-1]];draw();} });
    container.querySelectorAll('.hr-down').forEach((b)=>b.onclick=()=>{ const i=+b.dataset.i; if(i<hrs.length-1){[hrs[i],hrs[i+1]]=[hrs[i+1],hrs[i]];draw();} });
    syncHR();
  };
  const syncHR = () => {
    let inp = document.getElementById('hr-data-input');
    if (!inp) { inp=document.createElement('input'); inp.type='hidden'; inp.name='honigRaeume'; inp.id='hr-data-input'; container.parentNode.appendChild(inp); }
    inp.value = JSON.stringify(hrs);
  };
  const updateAddBtn = () => { const btn=document.getElementById('btn-add-hr'); if(btn) btn.style.display=hrs.length>=5?'none':''; };
  const addBtn = document.getElementById('btn-add-hr');
  if(addBtn) addBtn.onclick=()=>{
    openModal('Honigraum hinzufügen',`
      <label class="lbl">Nummer (2-stellig)</label>
      <input class="inp" name="hrNr" type="text" maxlength="2" placeholder="z. B. 01" value="">
      <label class="lbl">Datum</label>
      <input class="inp" name="hrDate" type="date" value="${todayInput()}">`,
      (data,close)=>{ hrs.unshift({nr:data.hrNr||'--',date:data.hrDate||todayInput()}); draw(); updateAddBtn(); close(); return Promise.resolve(); },null);
  };
  draw();
}

function openModal(title,bodyHTML,onSave,onDelete,noBackdropClose=false){
  const back=document.createElement('div');
  back.className='modal-back';
  back.innerHTML=`<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="btn btn-ghost modal-close" aria-label="Schließen">✕</button></div>
    <form class="modal-body">${bodyHTML}</form>
    <div class="modal-foot">${onDelete?'<button type="button" class="btn btn-danger btn-sm" id="m-del">Löschen</button>':'<span></span>'}
    <button type="button" class="btn btn-primary" id="m-save">Speichern</button></div></div>`;
  document.body.appendChild(back);
  const close=()=>back.remove();
  back.querySelector('.modal-close').onclick=close;
  if(!noBackdropClose){ back.onclick=(e)=>{if(e.target===back)close();}; }
  const form=back.querySelector('.modal-body');
  /* Datum-Löschen-Buttons */
  back.querySelectorAll('.date-clear').forEach(b=>b.onclick=()=>{
    const inp=form.querySelector(`input[name="${b.dataset.clear}"]`);
    if(inp) inp.value='';
  });
  back.querySelector('#m-save').onclick=async(ev)=>{
    const data={};
    form.querySelectorAll('input[name],select[name],textarea[name]').forEach((el)=>{data[el.name]=el.value;});
    ev.target.disabled=true;
    try{await onSave(data,close);}
    catch(err){alert('Fehler: '+err.message);}
    finally{ev.target.disabled=false;}
  };
  if(onDelete) back.querySelector('#m-del').onclick=async(ev)=>{
    ev.target.disabled=true;
    try{await onDelete(close);}
    catch(err){alert('Fehler: '+err.message);}
    finally{ev.target.disabled=false;}
  };
}
/* Kurze Rückmeldung, verschwindet nach ca. 1 Sekunde von selbst */
function showToast(msg, duration=3000){
  const t=document.createElement('div');
  t.className='toast';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('toast-out'), duration);
  setTimeout(()=>t.remove(), duration+300);
}
function openLightbox(url,caption){
  const back=document.createElement('div');
  back.className='lightbox';
  back.innerHTML=`<figure><img src="${url}">${caption?`<figcaption>${esc(caption)}</figcaption>`:''}</figure>`;
  back.onclick=()=>back.remove();
  document.body.appendChild(back);
}

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }
render().then(()=>checkDueReminders());
