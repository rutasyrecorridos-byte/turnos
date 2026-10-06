'use strict';
/* =========================================================
   TURNOS — gestión de turnos, anotaciones y alertas
   Funciona en navegador (sin alertas) y como app Android
   con Capacitor (alertas locales programadas).
   ========================================================= */
(() => {

  // ---------- Constantes ----------
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DEFAULT_SHIFT_TYPES = [
    { id: 'm', name: 'Mañana', abbr: 'M', color: '#0284c7', hours: 8, start: '' },
    { id: 't', name: 'Tarde', abbr: 'T', color: '#f59e0b', hours: 8, start: '' },
    { id: 'n', name: 'Noche', abbr: 'N', color: '#6366f1', hours: 8, start: '' },
    { id: 'g', name: 'Guardia', abbr: 'G', color: '#dc2626', hours: 24, start: '' },
    { id: 's', name: 'Servicio', abbr: 'S', color: '#059669', hours: 8, start: '' },
    { id: 'r', name: 'Retorno', abbr: 'R', color: '#8b5cf6', hours: 8, start: '' },
    { id: 'd', name: 'Descanso / Libre', abbr: 'L', color: '#64748b', hours: 0, start: '' }
  ];
  const PALETTE = ['#0284c7', '#06b6d4', '#059669', '#16a34a', '#84cc16', '#f59e0b', '#ea580c', '#dc2626', '#db2777', '#8b5cf6', '#6366f1', '#64748b'];
  const LEADS = [
    [0, 'A la hora'], [5, '5 min antes'], [10, '10 min antes'], [15, '15 min antes'], [30, '30 min antes'],
    [60, '1 h antes'], [90, '1 h 30 min antes'], [120, '2 h antes'], [240, '4 h antes'], [720, '12 h antes'],
    [1440, '1 día antes'], [2880, '2 días antes']
  ];
  const REPEATS = { none: 'No se repite', daily: 'Cada día', weekly: 'Cada semana', monthly: 'Cada mes', yearly: 'Cada año' };
  const HORIZON_DAYS = 60;
  const MAX_NOTIFS = 300;
  const TEST_ID = 99999;
  const LS = { types: 'turnos_shift_types', asg: 'turnos_assignments', rem: 'turnos_reminders', set: 'turnos_settings' };

  // ---------- Capacitor (si existe) ----------
  const Cap = window.Capacitor;
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const plugin = (name) => {
    if (!isNative) return null;
    if (Cap.Plugins && Cap.Plugins[name]) return Cap.Plugins[name];
    return typeof Cap.registerPlugin === 'function' ? Cap.registerPlugin(name) : null;
  };
  const LN = plugin('LocalNotifications');
  const AppP = plugin('App');
  const FS = plugin('Filesystem');
  const ShareP = plugin('Share');
  const SB = plugin('StatusBar');

  // ---------- Utilidades ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');
  const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parts = (k) => k.split('-').map(Number);
  const dateOf = (k, hm = '00:00') => { const [y, m, d] = parts(k); const [h, mi] = hm.split(':').map(Number); return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0); };
  const keyOf = (dt) => key(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const todayKey = () => keyOf(new Date());
  const addDays = (k, n) => { const [y, m, d] = parts(k); return keyOf(new Date(y, m - 1, d + n)); };
  const dayNum = (k) => { const [y, m, d] = parts(k); return Date.UTC(y, m - 1, d) / 86400000; };
  const hm = (dt) => `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtLong = (k) => dateOf(k).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = (k) => dateOf(k).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const leadText = (min) => (LEADS.find((l) => l[0] === Number(min)) || [0, `${min} min antes`])[1];
  const isWeekend = (k) => { const w = dateOf(k).getDay(); return w === 0 || w === 6; };
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

  // ---------- Estado ----------
  const now = new Date();
  const state = {
    year: now.getFullYear(),
    month: now.getMonth(),
    view: 'month',
    tab: 'cal',
    selected: todayKey(),
    paint: false,
    paintShift: null,           // id de turno o '__none'
    shiftTypes: [],
    assignments: {},            // "YYYY-MM-DD": { shiftId, extraHours, note }
    reminders: [],              // { id, title, date, time, lead, repeat }
    settings: { shiftAlerts: false, shiftLead: 60 },
    sheetOpen: false
  };

  // ---------- Persistencia ----------
  function readJSON(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function load() {
    state.shiftTypes = migrateTypes(readJSON(LS.types, null) || DEFAULT_SHIFT_TYPES.map((t) => ({ ...t })));
    state.assignments = readJSON(LS.asg, {}) || {};
    state.reminders = readJSON(LS.rem, []) || [];
    state.settings = { ...state.settings, ...(readJSON(LS.set, {}) || {}) };
  }
  function save() {
    localStorage.setItem(LS.types, JSON.stringify(state.shiftTypes));
    localStorage.setItem(LS.asg, JSON.stringify(state.assignments));
    localStorage.setItem(LS.rem, JSON.stringify(state.reminders));
    localStorage.setItem(LS.set, JSON.stringify(state.settings));
  }
  function migrateTypes(types) {
    return (types || []).map((t) => ({
      id: t.id, name: t.name || 'Turno', color: t.color || '#64748b',
      hours: num(t.hours), start: t.start || '',
      abbr: (t.abbr || (t.name || '?').trim().charAt(0)).toUpperCase().slice(0, 3)
    }));
  }
  const typeById = (id) => state.shiftTypes.find((t) => t.id === id);

  // ---------- Avisos breves ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const el = $('toast'); el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // =========================================================
  //   RECORDATORIOS: repeticiones y ocurrencias
  // =========================================================
  function occursOn(r, k) {
    if (k < r.date) return false;
    if (r.date === k) return true;
    const [, m1, d1] = parts(r.date), [, m2, d2] = parts(k);
    switch (r.repeat) {
      case 'daily': return true;
      case 'weekly': return (dayNum(k) - dayNum(r.date)) % 7 === 0;
      case 'monthly': return d1 === d2;
      case 'yearly': return d1 === d2 && m1 === m2;
      default: return false;
    }
  }
  const remindersOn = (k) => state.reminders.filter((r) => occursOn(r, k)).sort((a, b) => a.time.localeCompare(b.time));

  // Lista de eventos futuros (recordatorios + inicio de turnos) en el horizonte
  function upcomingEvents(days = HORIZON_DAYS) {
    const out = [];
    const nowMs = Date.now();
    const start = todayKey();
    for (let i = 0; i <= days + 2; i++) {
      const k = addDays(start, i);
      for (const r of remindersOn(k)) {
        const ev = dateOf(k, r.time).getTime();
        out.push({ kind: 'rem', k, time: r.time, eventAt: ev, notifyAt: ev - num(r.lead) * 60000, rem: r });
      }
      if (state.settings.shiftAlerts) {
        const a = state.assignments[k];
        const st = a && typeById(a.shiftId);
        if (st && st.start) {
          const ev = dateOf(k, st.start).getTime();
          out.push({ kind: 'shift', k, time: st.start, eventAt: ev, notifyAt: ev - num(state.settings.shiftLead) * 60000, st, note: a.note });
        }
      }
    }
    const limit = nowMs + days * 86400000;
    return out.filter((e) => e.eventAt >= nowMs - 60000 && e.eventAt <= limit + 2 * 86400000)
      .sort((a, b) => a.eventAt - b.eventAt);
  }

  // =========================================================
  //   NOTIFICACIONES LOCALES
  // =========================================================
  let scheduleTimer;
  function scheduleAll() { clearTimeout(scheduleTimer); scheduleTimer = setTimeout(doSchedule, 700); }

  async function doSchedule() {
    if (!LN) return;
    try {
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted') return;
      const pending = await LN.getPending();
      const old = (pending.notifications || []).filter((n) => Number(n.id) !== TEST_ID).map((n) => ({ id: Number(n.id) }));
      if (old.length) await LN.cancel({ notifications: old });

      const nowMs = Date.now();
      const horizon = nowMs + HORIZON_DAYS * 86400000;
      const list = upcomingEvents()
        .filter((e) => e.notifyAt > nowMs + 3000 && e.notifyAt <= horizon)
        .sort((a, b) => a.notifyAt - b.notifyAt)
        .slice(0, MAX_NOTIFS)
        .map((e, i) => {
          const when = `${fmtShort(e.k)}, ${e.time}`;
          let title, body;
          if (e.kind === 'rem') {
            title = e.rem.title || 'Recordatorio';
            body = num(e.rem.lead) === 0 ? `Ahora · ${when}` : `${cap1(leadText(e.rem.lead).replace(' antes', ''))} para: ${when}`;
          } else {
            title = `Turno de ${e.st.name} · ${e.time}`;
            body = `Empieza ${leadPhrase(state.settings.shiftLead)} (${fmtShort(e.k)})` + (e.note ? ` · ${e.note}` : '');
          }
          return {
            id: i + 1, title, body,
            schedule: { at: new Date(e.notifyAt), allowWhileIdle: true },
            channelId: 'alertas', smallIcon: 'ic_stat_turnos', iconColor: '#0891b2',
            extra: { date: e.k, kind: e.kind }
          };
        });
      if (list.length) await LN.schedule({ notifications: list });
    } catch (err) {
      console.error('Error programando alertas', err);
    }
  }
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const leadPhrase = (min) => {
    min = num(min);
    if (min === 0) return 'ahora';
    if (min < 60) return `en ${min} min`;
    if (min < 1440) { const h = Math.floor(min / 60), m = min % 60; return `en ${h} h${m ? ` ${m} min` : ''}`; }
    return min === 1440 ? 'mañana' : `en ${Math.round(min / 1440)} días`;
  };

  async function initNotifications() {
    if (!LN) return;
    try {
      await LN.createChannel({
        id: 'alertas', name: 'Alertas y turnos', description: 'Recordatorios programados y avisos de turno',
        importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#06b6d4'
      });
    } catch (e) { /* canal ya existe o no soportado */ }
    try {
      const p = await LN.checkPermissions();
      if (p.display === 'prompt' || p.display === 'prompt-with-rationale') await LN.requestPermissions();
    } catch (e) { }
    try {
      LN.addListener('localNotificationActionPerformed', (ev) => {
        const d = ev && ev.notification && ev.notification.extra && ev.notification.extra.date;
        if (d) goToDay(d);
      });
    } catch (e) { }
    await refreshPermBox();
    scheduleAll();
  }

  async function refreshPermBox() {
    const box = $('permBox');
    const banner = $('notifBanner');
    if (!LN) {
      box.innerHTML = `<div><span>Notificaciones</span><span class="ko">Solo en la app Android</span></div>`;
      banner.innerHTML = `<div class="banner">Estás usando la versión web: las alertas solo suenan en la app Android instalada.</div>`;
      return;
    }
    let disp = '?', exact = 'granted';
    try { disp = (await LN.checkPermissions()).display; } catch (e) { }
    try { if (LN.checkExactNotificationSetting) exact = (await LN.checkExactNotificationSetting()).exact_alarm; } catch (e) { }
    const ok = (v) => v === 'granted';
    box.innerHTML = `
      <div><span>Mostrar notificaciones</span><span class="${ok(disp) ? 'ok' : 'ko'}">${ok(disp) ? 'Permitido' : 'Denegado'}</span></div>
      <div><span>Alarmas a la hora exacta</span><span class="${ok(exact) ? 'ok' : 'ko'}">${ok(exact) ? 'Permitido' : 'Denegado'}</span></div>`;
    banner.innerHTML = ok(disp) ? (ok(exact) ? '' : `<div class="banner">Las alarmas exactas están desactivadas: los avisos pueden llegar con retraso. Actívalas en Ajustes → Alertas → Revisar permisos.</div>`)
      : `<div class="banner">Las notificaciones están desactivadas, así que las alertas no sonarán. Ve a Ajustes → Alertas → Revisar permisos.</div>`;
  }

  async function checkPermsAction() {
    if (!LN) { toast('Las alertas funcionan en la app Android'); return; }
    try {
      let p = await LN.checkPermissions();
      if (p.display !== 'granted') p = await LN.requestPermissions();
      if (p.display !== 'granted') {
        toast('Actívalas en Ajustes de Android → Aplicaciones → Turnos → Notificaciones', 4500);
      } else if (LN.checkExactNotificationSetting) {
        const ex = await LN.checkExactNotificationSetting();
        if (ex.exact_alarm !== 'granted' && LN.changeExactNotificationSetting) await LN.changeExactNotificationSetting();
      }
    } catch (e) { console.error(e); }
    await refreshPermBox();
    scheduleAll();
  }

  async function testNotification() {
    if (LN) {
      try {
        const p = await LN.checkPermissions();
        if (p.display !== 'granted') { await checkPermsAction(); return; }
        await LN.schedule({
          notifications: [{
            id: TEST_ID, title: 'Prueba de alerta', body: 'Si ves esto, las alertas de Turnos funcionan.',
            schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true },
            channelId: 'alertas', smallIcon: 'ic_stat_turnos', iconColor: '#0891b2', extra: { date: todayKey() }
          }]
        });
        toast('Prueba programada: llegará en 10 segundos. Puedes bloquear el móvil.');
      } catch (e) { toast('No se pudo programar la prueba'); }
    } else if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') { setTimeout(() => new Notification('Prueba de alerta', { body: 'Notificación del navegador', icon: 'img/icon-192.png' }), 10000); toast('Prueba en 10 s (deja la pestaña abierta)'); }
      else toast('El navegador no permite notificaciones');
    } else toast('Este navegador no admite notificaciones');
  }

  // =========================================================
  //   RENDER: CALENDARIO
  // =========================================================
  function renderTop() {
    const a = state.assignments[todayKey()];
    const st = a && typeById(a.shiftId);
    $('topSubtitle').textContent = st ? `Hoy: ${st.name}${st.start ? ' · ' + st.start : ''}` : 'Hoy: sin turno asignado';
  }

  function renderPeriod() {
    $('periodLabel').textContent = state.view === 'month' ? `${MONTHS[state.month]} ${state.year}` : String(state.year);
    document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    $('monthView').classList.toggle('hidden', state.view !== 'month');
    $('yearView').classList.toggle('hidden', state.view !== 'year');
    $('paintbar').classList.toggle('hidden', state.view !== 'month');
    if (state.view !== 'month') $('paintHint').classList.add('hidden');
  }

  function renderPaintbar() {
    $('paintToggle').classList.toggle('on', state.paint);
    const chips = $('paintChips');
    chips.classList.toggle('disabled', !state.paint);
    chips.innerHTML = state.shiftTypes.map((t) =>
      `<button class="chip ${state.paintShift === t.id ? 'on' : ''}" data-paint="${esc(t.id)}"><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</button>`
    ).join('') + `<button class="chip ${state.paintShift === '__none' ? 'on' : ''}" data-paint="__none"><svg style="width:14px;height:14px"><use href="#i-x"/></svg>Borrar</button>`;
    const hint = $('paintHint');
    if (state.paint && state.view === 'month') {
      const t = typeById(state.paintShift);
      hint.textContent = state.paintShift === '__none' ? 'Toca los días para quitar el turno (las notas se conservan).'
        : t ? `Toca los días para asignar «${t.name}». Vuelve a tocar para quitarlo.` : 'Elige un turno y toca los días para asignarlo.';
      hint.classList.remove('hidden');
    } else hint.classList.add('hidden');
  }

  function renderMonth() {
    const grid = $('monthGrid');
    const y = state.year, m = state.month;
    const first = new Date(y, m, 1).getDay();
    const offset = first === 0 ? 6 : first - 1;
    const days = new Date(y, m + 1, 0).getDate();
    const tk = todayKey();
    let html = '';
    for (let i = 0; i < offset; i++) html += '<div class="cell empty"></div>';
    for (let d = 1; d <= days; d++) {
      const k = key(y, m, d);
      const a = state.assignments[k];
      const st = a && typeById(a.shiftId);
      const hasRem = state.reminders.some((r) => occursOn(r, k));
      const cls = ['cell'];
      if (st) cls.push('has-shift');
      if (isWeekend(k)) cls.push('we');
      if (k === tk) cls.push('today');
      if (k === state.selected && !state.paint) cls.push('sel');
      const style = st ? `style="background:${esc(st.color)}"` : '';
      html += `<button class="${cls.join(' ')}" data-day="${k}" ${style}>
        <span class="num">${d}</span>
        <span class="abbr">${st ? esc(st.abbr) : ''}</span>
        <span class="marks">${a && a.note ? '<i class="mark-note"></i>' : ''}${hasRem ? '<i class="mark-bell"></i>' : ''}</span>
        ${a && a.extraHours > 0 ? `<span class="xtra">+${a.extraHours}</span>` : ''}
      </button>`;
    }
    grid.innerHTML = html;
  }

  function renderDayDetail() {
    const k = state.selected;
    const box = $('dayDetail');
    const a = state.assignments[k] || {};
    const st = typeById(a.shiftId);
    const rems = remindersOn(k);
    const shiftPill = st
      ? `<span class="pill" style="background:${esc(st.color)}">${esc(st.name)}</span><span class="muted small">${st.hours} h${st.start ? ' · entrada ' + esc(st.start) : ''}</span>`
      : `<span class="pill ghost">Sin turno</span>`;
    box.innerHTML = `
      <div class="dd-head">
        <div><h3>${esc(cap1(fmtLong(k)))}</h3><p>${k === todayKey() ? 'Hoy' : 'Toca de nuevo el día para editarlo'}</p></div>
        <button class="btn small" data-act="edit-day"><svg><use href="#i-edit"/></svg>Editar</button>
      </div>
      <div class="dd-row">${shiftPill}${a.extraHours > 0 ? `<span class="pill" style="background:#b45309">+${a.extraHours} h extra</span>` : ''}</div>
      ${a.note ? `<div class="dd-note"><svg><use href="#i-note"/></svg>${esc(a.note)}</div>` : ''}
      ${rems.map((r) => reminderItem(r, k)).join('')}
      <button class="btn block mt-s" data-act="add-rem"><svg><use href="#i-bell"/></svg>Añadir alerta este día</button>`;
  }

  function reminderItem(r, k) {
    return `<button class="list-item" data-rem="${esc(r.id)}" data-k="${k}">
      <span class="li-icon"><svg><use href="#i-bell"/></svg></span>
      <span class="li-main"><b>${esc(r.title)}</b><small><svg><use href="#i-clock"/></svg>${esc(r.time)} · ${esc(leadText(r.lead))}${r.repeat && r.repeat !== 'none' ? ` · <svg><use href="#i-repeat"/></svg>${esc(REPEATS[r.repeat].toLowerCase())}` : ''}</small></span>
    </button>`;
  }

  function renderYear() {
    const tk = todayKey();
    const cur = new Date();
    let html = '';
    for (let m = 0; m < 12; m++) {
      const first = new Date(state.year, m, 1).getDay();
      const offset = first === 0 ? 6 : first - 1;
      const days = new Date(state.year, m + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < offset; i++) cells += '<span></span>';
      for (let d = 1; d <= days; d++) {
        const k = key(state.year, m, d);
        const a = state.assignments[k];
        const st = a && typeById(a.shiftId);
        cells += `<span class="${st ? 's' : ''} ${k === tk ? 't' : ''}" ${st ? `style="background:${esc(st.color)}"` : ''}>${d}</span>`;
      }
      const isCur = state.year === cur.getFullYear() && m === cur.getMonth();
      html += `<button class="mini ${isCur ? 'current' : ''}" data-month="${m}"><h4>${MONTHS[m]}</h4><div class="mg">${cells}</div></button>`;
    }
    $('yearView').innerHTML = html;
  }

  function renderCalendar() {
    renderPeriod();
    renderPaintbar();
    if (state.view === 'month') { renderMonth(); renderDayDetail(); } else renderYear();
  }

  // =========================================================
  //   RENDER: AGENDA
  // =========================================================
  function renderAgenda() {
    const events = upcomingEvents();
    const tk = todayKey();
    const box = $('agendaList');
    if (!events.length) {
      box.innerHTML = `<div class="empty-state">No hay alertas en los próximos ${HORIZON_DAYS} días.<br>Pulsa <b>Nueva</b> para programar una.</div>`;
    } else {
      let html = '', last = '';
      for (const e of events) {
        if (e.k !== last) {
          last = e.k;
          const label = e.k === tk ? 'Hoy' : e.k === addDays(tk, 1) ? 'Mañana' : fmtShort(e.k);
          html += `<div class="day-group ${e.k === tk ? 'today' : ''}">${esc(label)}</div>`;
        }
        if (e.kind === 'rem') {
          const r = e.rem;
          html += `<button class="list-item" data-rem="${esc(r.id)}" data-k="${e.k}">
            <span class="li-time">${esc(e.time)}</span>
            <span class="li-main"><b>${esc(r.title)}</b><small><svg><use href="#i-bell"/></svg>${esc(leadText(r.lead))}${r.repeat !== 'none' ? ` · <svg><use href="#i-repeat"/></svg>${esc(REPEATS[r.repeat].toLowerCase())}` : ''}</small></span>
          </button>`;
        } else {
          html += `<button class="list-item" data-goto="${e.k}">
            <span class="li-time">${esc(e.time)}</span>
            <span class="li-color" style="background:${esc(e.st.color)}"></span>
            <span class="li-main"><b>Turno de ${esc(e.st.name)}</b><small><svg><use href="#i-bell"/></svg>${esc(leadText(state.settings.shiftLead))}</small></span>
          </button>`;
        }
      }
      box.innerHTML = html;
    }
    // Badge: alertas de hoy
    const todayCount = events.filter((e) => e.k === tk).length;
    const badge = $('agendaBadge');
    badge.textContent = todayCount; badge.classList.toggle('hidden', !todayCount);

    // Anotaciones del mes mostrado
    const prefix = `${state.year}-${pad(state.month + 1)}-`;
    $('notesRange').textContent = `${MONTHS[state.month]} ${state.year}`;
    const notes = Object.keys(state.assignments).filter((k) => k.startsWith(prefix) && state.assignments[k].note).sort();
    $('notesList').innerHTML = notes.length ? notes.map((k) => {
      const a = state.assignments[k]; const st = typeById(a.shiftId);
      return `<button class="list-item" data-goto="${k}">
        <span class="li-color" style="background:${st ? esc(st.color) : 'var(--surface-3)'}"></span>
        <span class="li-main"><b>${esc(a.note)}</b><small>${esc(fmtShort(k))}${st ? ' · ' + esc(st.name) : ''}</small></span>
      </button>`;
    }).join('') : `<div class="empty-state">Sin anotaciones en ${MONTHS[state.month].toLowerCase()}.</div>`;
  }

  // =========================================================
  //   RENDER: RESUMEN
  // =========================================================
  function renderStatsSelect() {
    const sel = $('statsPeriod'); const prev = sel.value;
    sel.innerHTML = `<option value="year">Año ${state.year}</option>` + MONTHS.map((m, i) => `<option value="${i}">${m} ${state.year}</option>`).join('');
    sel.value = prev && sel.querySelector(`option[value="${prev}"]`) ? prev : 'year';
  }
  function renderStats() {
    const period = $('statsPeriod').value;
    let total = 0, worked = 0, extra = 0;
    const counts = {};
    state.shiftTypes.forEach((t) => { counts[t.id] = { days: 0, hours: 0, t }; });
    for (const [k, a] of Object.entries(state.assignments)) {
      const [y, m] = parts(k);
      if (y !== state.year) continue;
      if (period !== 'year' && Number(period) !== m - 1) continue;
      const st = typeById(a.shiftId);
      if (st) {
        counts[st.id].days++; counts[st.id].hours += st.hours; total += st.hours;
        if (st.hours > 0) worked++;
      }
      if (a.extraHours) { extra += num(a.extraHours); total += num(a.extraHours); }
    }
    $('stTotal').textContent = `${+total.toFixed(1)} h`;
    $('stDays').textContent = worked;
    $('stExtra').textContent = `${+extra.toFixed(1)} h`;
    const rows = Object.values(counts);
    const max = Math.max(1, ...rows.map((r) => r.days));
    $('statsBreakdown').innerHTML = rows.map((r) => `
      <div class="bar-row">
        <div class="bar-top"><b><span class="dot" style="background:${esc(r.t.color)}"></span>${esc(r.t.name)}</b><span><span class="muted">${r.days} ${r.days === 1 ? 'día' : 'días'} ·</span> <b>${+r.hours.toFixed(1)} h</b></span></div>
        <div class="bar"><i style="width:${(r.days / max) * 100}%;background:${esc(r.t.color)}"></i></div>
      </div>`).join('');
  }

  // =========================================================
  //   RENDER: AJUSTES
  // =========================================================
  function renderSettings() {
    $('shiftTypesList').innerHTML = state.shiftTypes.map((t) => `
      <div class="list-item">
        <span class="li-color" style="background:${esc(t.color)}"></span>
        <span class="li-main"><b>${esc(t.name)} <span class="muted small">(${esc(t.abbr)})</span></b><small>${t.hours} h${t.start ? ` · entrada ${esc(t.start)}` : ' · sin hora de entrada'}</small></span>
        <span class="li-actions">
          <button class="icon-btn" data-edit-type="${esc(t.id)}" aria-label="Editar"><svg><use href="#i-edit"/></svg></button>
          <button class="icon-btn" data-del-type="${esc(t.id)}" aria-label="Eliminar"><svg><use href="#i-trash"/></svg></button>
        </span>
      </div>`).join('');
    $('shiftAlertsToggle').checked = !!state.settings.shiftAlerts;
    const lead = $('shiftLead');
    lead.innerHTML = LEADS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    lead.value = String(state.settings.shiftLead);
  }

  function renderAll() {
    renderTop();
    renderCalendar();
    renderAgenda();
    renderStatsSelect();
    renderStats();
    renderSettings();
  }

  // =========================================================
  //   NAVEGACIÓN
  // =========================================================
  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab));
    document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'agenda') renderAgenda();
    if (tab === 'stats') { renderStatsSelect(); renderStats(); }
    window.scrollTo(0, 0);
  }
  function goToDay(k) {
    const [y, m] = parts(k);
    state.year = y; state.month = m - 1; state.selected = k; state.view = 'month';
    closeSheet();
    switchTab('cal');
    renderCalendar();
    renderStatsSelect();
  }
  function shiftPeriod(delta) {
    if (state.view === 'month') {
      state.month += delta;
      if (state.month < 0) { state.month = 11; state.year--; }
      if (state.month > 11) { state.month = 0; state.year++; }
    } else state.year += delta;
    renderCalendar();
    renderStatsSelect();
  }

  // =========================================================
  //   HOJA INFERIOR
  // =========================================================
  function openSheet(title, sub, html, onMount) {
    $('sheetTitle').textContent = title;
    $('sheetSub').textContent = sub || '';
    $('sheetBody').innerHTML = html;
    $('sheetBackdrop').classList.remove('hidden');
    $('sheet').scrollTop = 0;
    state.sheetOpen = true;
    if (onMount) onMount($('sheetBody'));
  }
  function closeSheet() {
    $('sheetBackdrop').classList.add('hidden');
    $('sheetBody').innerHTML = '';
    state.sheetOpen = false;
  }

  // ---------- Editar día ----------
  function openDaySheet(k) {
    const a = state.assignments[k] || {};
    let selected = a.shiftId || null;
    const opts = [`<button type="button" class="shift-opt ${!selected ? 'on' : ''}" data-sid=""><span class="dot" style="background:transparent;border:2px dashed var(--muted)"></span><span><b>Sin turno</b><small>—</small></span></button>`]
      .concat(state.shiftTypes.map((t) => `<button type="button" class="shift-opt ${selected === t.id ? 'on' : ''}" data-sid="${esc(t.id)}"><span class="dot" style="background:${esc(t.color)}"></span><span><b>${esc(t.name)}</b><small>${t.hours} h${t.start ? ' · ' + esc(t.start) : ''}</small></span></button>`));
    const rems = remindersOn(k);
    openSheet('Editar día', fmtLong(k), `
      <label class="form-label">Turno</label>
      <div class="shift-opts">${opts.join('')}</div>
      <div class="field-row"><label>Horas extra</label>
        <div class="stepper"><button type="button" data-step="-0.5">−</button><input id="fExtra" class="input" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${a.extraHours || 0}"><button type="button" data-step="0.5">+</button></div>
      </div>
      <label class="form-label" for="fNote">Notas u observaciones</label>
      <textarea id="fNote" class="input" placeholder="Ej.: retorno de retén, formación, servicio especial…">${esc(a.note || '')}</textarea>
      <label class="form-label">Alertas de este día</label>
      <div>${rems.length ? rems.map((r) => reminderItem(r, k)).join('') : '<p class="muted small" style="margin:0">Ninguna</p>'}</div>
      <button type="button" class="btn block mt-s" id="fAddRem"><svg><use href="#i-bell"/></svg>Añadir alerta</button>
      <div class="sheet-actions">
        <button type="button" class="btn danger" id="fClear">Limpiar día</button>
        <button type="button" class="btn primary" id="fSave"><svg><use href="#i-check"/></svg>Guardar</button>
      </div>`, (body) => {
      body.querySelectorAll('.shift-opt').forEach((b) => b.addEventListener('click', () => {
        selected = b.dataset.sid || null;
        body.querySelectorAll('.shift-opt').forEach((x) => x.classList.toggle('on', x === b));
      }));
      body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        const inp = $('fExtra'); inp.value = Math.min(24, Math.max(0, num(inp.value) + num(b.dataset.step)));
      }));
      const commit = () => {
        const extraHours = Math.max(0, num($('fExtra').value));
        const note = $('fNote').value.trim();
        if (!selected && !note && !extraHours) delete state.assignments[k];
        else state.assignments[k] = { shiftId: selected, extraHours, note };
        save(); scheduleAll();
      };
      $('fSave').addEventListener('click', () => { commit(); closeSheet(); state.selected = k; renderAll(); toast('Día guardado'); });
      $('fClear').addEventListener('click', () => {
        if (!state.assignments[k]) { closeSheet(); return; }
        if (!confirm('¿Quitar el turno, las horas extra y la nota de este día? (las alertas se mantienen)')) return;
        delete state.assignments[k]; save(); scheduleAll(); closeSheet(); renderAll();
      });
      $('fAddRem').addEventListener('click', () => { commit(); renderAll(); openReminderSheet(null, k); });
      body.querySelectorAll('[data-rem]').forEach((b) => b.addEventListener('click', () => { commit(); renderAll(); openReminderSheet(b.dataset.rem, k); }));
    });
  }

  // ---------- Alerta / recordatorio ----------
  function openReminderSheet(id, k) {
    const existing = id ? state.reminders.find((r) => r.id === id) : null;
    const nextHour = `${pad(Math.min(23, new Date().getHours() + 1))}:00`;
    const r = existing || { title: '', date: k || todayKey(), time: (k && k !== todayKey()) ? '09:00' : nextHour, lead: 0, repeat: 'none' };
    openSheet(existing ? 'Editar alerta' : 'Nueva alerta', existing && existing.repeat !== 'none' ? `Se repite: ${REPEATS[existing.repeat].toLowerCase()}` : 'Te avisará con una notificación', `
      <label class="form-label" for="rTitle">¿Qué hay que recordar?</label>
      <input id="rTitle" class="input" maxlength="80" placeholder="Ej.: revisar EPI, reconocimiento médico, pagar cuota…" value="${esc(r.title)}">
      <div class="form-grid">
        <div><label class="form-label" for="rDate">${existing && existing.repeat !== 'none' ? 'Desde el día' : 'Día'}</label><input id="rDate" class="input" type="date" value="${esc(r.date)}"></div>
        <div><label class="form-label" for="rTime">Hora</label><input id="rTime" class="input" type="time" value="${esc(r.time)}"></div>
      </div>
      <label class="form-label" for="rLead">Avisarme</label>
      <select id="rLead" class="select" style="width:100%">${LEADS.map(([v, l]) => `<option value="${v}" ${Number(r.lead) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="form-label" for="rRepeat">Repetir</label>
      <select id="rRepeat" class="select" style="width:100%">${Object.entries(REPEATS).map(([v, l]) => `<option value="${v}" ${r.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="sheet-actions">
        ${existing ? '<button type="button" class="btn danger" id="rDel"><svg><use href="#i-trash"/></svg>Eliminar</button>' : ''}
        <button type="button" class="btn primary" id="rSave"><svg><use href="#i-bell"/></svg>${existing ? 'Guardar' : 'Programar'}</button>
      </div>`, () => {
      if (!existing) setTimeout(() => $('rTitle').focus(), 250);
      $('rSave').addEventListener('click', () => {
        const title = $('rTitle').value.trim();
        const date = $('rDate').value, time = $('rTime').value;
        if (!title) { toast('Escribe qué quieres recordar'); $('rTitle').focus(); return; }
        if (!date || !time) { toast('Indica día y hora'); return; }
        const data = { title, date, time, lead: Number($('rLead').value), repeat: $('rRepeat').value };
        if (existing) Object.assign(existing, data);
        else state.reminders.push({ id: uid(), ...data });
        save(); scheduleAll(); closeSheet();
        state.selected = date;
        renderAll();
        const notifyAt = dateOf(date, time).getTime() - data.lead * 60000;
        if (data.repeat === 'none' && notifyAt < Date.now()) toast('Guardada, pero esa hora ya ha pasado: no sonará', 3500);
        else toast(LN ? 'Alerta programada' : 'Alerta guardada (sonará en la app Android)');
      });
      if (existing) $('rDel').addEventListener('click', () => {
        if (!confirm(existing.repeat !== 'none' ? '¿Eliminar esta alerta y todas sus repeticiones?' : '¿Eliminar esta alerta?')) return;
        state.reminders = state.reminders.filter((x) => x.id !== existing.id);
        save(); scheduleAll(); closeSheet(); renderAll(); toast('Alerta eliminada');
      });
    });
  }

  // ---------- Tipo de turno ----------
  function openTypeSheet(id) {
    const t = id ? typeById(id) : null;
    let color = t ? t.color : PALETTE[state.shiftTypes.length % PALETTE.length];
    openSheet(t ? 'Editar tipo de turno' : 'Nuevo tipo de turno', 'Nombre, horas, color y hora de entrada', `
      <div class="form-grid">
        <div><label class="form-label" for="tName">Nombre</label><input id="tName" class="input" maxlength="30" placeholder="Ej.: Retén" value="${esc(t ? t.name : '')}"></div>
        <div><label class="form-label" for="tAbbr">Abreviatura</label><input id="tAbbr" class="input" maxlength="3" placeholder="R" value="${esc(t ? t.abbr : '')}" style="text-transform:uppercase"></div>
        <div><label class="form-label" for="tHours">Horas</label><input id="tHours" class="input" type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${t ? t.hours : 8}"></div>
        <div><label class="form-label" for="tStart">Hora de entrada</label><input id="tStart" class="input" type="time" value="${esc(t ? t.start : '')}"></div>
      </div>
      <p class="hint">Si pones hora de entrada, podrás recibir un aviso antes de empezar cada turno de este tipo (Ajustes → Alertas).</p>
      <label class="form-label">Color</label>
      <div class="palette" id="tPal">${PALETTE.map((c) => `<button type="button" data-c="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}<input type="color" id="tColor" value="${esc(color)}"></div>
      <div class="sheet-actions">
        <button type="button" class="btn" id="tCancel">Cancelar</button>
        <button type="button" class="btn primary" id="tSave"><svg><use href="#i-check"/></svg>Guardar</button>
      </div>`, (body) => {
      const setColor = (c) => { color = c; $('tColor').value = c; body.querySelectorAll('#tPal button').forEach((b) => b.classList.toggle('on', b.dataset.c === c)); };
      body.querySelectorAll('#tPal button').forEach((b) => b.addEventListener('click', () => setColor(b.dataset.c)));
      $('tColor').addEventListener('input', (e) => setColor(e.target.value));
      $('tCancel').addEventListener('click', closeSheet);
      $('tSave').addEventListener('click', () => {
        const name = $('tName').value.trim();
        if (!name) { toast('Ponle un nombre al turno'); return; }
        const data = {
          name, color, hours: Math.max(0, num($('tHours').value)), start: $('tStart').value || '',
          abbr: ($('tAbbr').value.trim() || name.charAt(0)).toUpperCase().slice(0, 3)
        };
        if (t) Object.assign(t, data); else state.shiftTypes.push({ id: 'st_' + Date.now(), ...data });
        save(); scheduleAll(); closeSheet(); renderAll(); toast('Tipo de turno guardado');
      });
    });
  }

  // ---------- Ciclo de turnos ----------
  function openPatternSheet() {
    const seq = [];
    const from = state.selected || todayKey();
    const to = `${parts(from)[0]}-12-31`;
    openSheet('Aplicar ciclo de turnos', 'Repite una secuencia de turnos entre dos fechas', `
      <label class="form-label">1. Toca los turnos en orden</label>
      <div class="chips" style="flex-wrap:wrap">${state.shiftTypes.map((t) => `<button type="button" class="chip" data-add="${esc(t.id)}"><span class="dot" style="background:${esc(t.color)}"></span>${esc(t.abbr)} · ${esc(t.name)}</button>`).join('')}
        <button type="button" class="chip" data-add=""><span class="dot" style="border:2px dashed var(--muted)"></span>Día vacío</button></div>
      <label class="form-label">2. Secuencia (toca un elemento para quitarlo)</label>
      <div class="seq" id="pSeq"></div>
      <div class="form-grid">
        <div><label class="form-label" for="pFrom">Desde</label><input id="pFrom" class="input" type="date" value="${from}"></div>
        <div><label class="form-label" for="pTo">Hasta</label><input id="pTo" class="input" type="date" value="${to}"></div>
      </div>
      <label class="checkline"><input type="checkbox" id="pOver" checked> Sobrescribir los turnos ya asignados</label>
      <p class="hint">Las notas y horas extra de cada día se conservan. Ejemplo: 7 días de Servicio + 7 días de Libre.</p>
      <div class="sheet-actions">
        <button type="button" class="btn" id="pCancel">Cancelar</button>
        <button type="button" class="btn primary" id="pApply"><svg><use href="#i-pattern"/></svg>Aplicar</button>
      </div>`, (body) => {
      const draw = () => {
        $('pSeq').innerHTML = seq.length ? seq.map((id, i) => {
          const t = typeById(id);
          return `<button type="button" class="chip" data-rm="${i}">${t ? `<span class="dot" style="background:${esc(t.color)}"></span>${esc(t.abbr)}` : '—'}</button>`;
        }).join('') : '<span class="muted small">Vacía</span>';
        $('pSeq').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { seq.splice(Number(b.dataset.rm), 1); draw(); }));
      };
      draw();
      body.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { seq.push(b.dataset.add || null); draw(); }));
      $('pCancel').addEventListener('click', closeSheet);
      $('pApply').addEventListener('click', () => {
        const a = $('pFrom').value, b = $('pTo').value;
        if (!seq.length) { toast('Añade al menos un turno a la secuencia'); return; }
        if (!a || !b || b < a) { toast('Revisa las fechas'); return; }
        const total = dayNum(b) - dayNum(a) + 1;
        if (total > 1100) { toast('Máximo unos 3 años de una vez'); return; }
        if (!confirm(`Se aplicará el ciclo a ${total} días. ¿Continuar?`)) return;
        const over = $('pOver').checked;
        for (let i = 0; i < total; i++) {
          const k = addDays(a, i);
          const sid = seq[i % seq.length];
          const cur = state.assignments[k];
          if (cur && cur.shiftId && !over) continue;
          const next = { shiftId: sid, extraHours: cur ? cur.extraHours || 0 : 0, note: cur ? cur.note || '' : '' };
          if (!next.shiftId && !next.note && !next.extraHours) delete state.assignments[k];
          else state.assignments[k] = next;
        }
        save(); scheduleAll(); closeSheet();
        goToDay(a);
        renderAll();
        toast('Ciclo aplicado');
      });
    });
  }

  // =========================================================
  //   COPIA DE SEGURIDAD
  // =========================================================
  async function exportBackup() {
    const data = {
      app: 'turnos', version: 2, exportDate: new Date().toISOString(),
      shiftTypes: state.shiftTypes, assignments: state.assignments, reminders: state.reminders, settings: state.settings
    };
    const json = JSON.stringify(data, null, 2);
    const name = `turnos_copia_${todayKey()}.json`;
    if (FS && ShareP) {
      try {
        const res = await FS.writeFile({ path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
        await ShareP.share({ title: 'Copia de seguridad de Turnos', text: 'Copia de seguridad de Turnos', files: [res.uri], dialogTitle: 'Guardar o enviar la copia' });
      } catch (e) {
        if (!String(e && e.message).toLowerCase().includes('cancel')) toast('No se pudo exportar la copia');
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const aEl = document.createElement('a'); aEl.href = url; aEl.download = name;
    document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!d || !Array.isArray(d.shiftTypes) || typeof d.assignments !== 'object') throw new Error('formato');
        const n = Object.keys(d.assignments).length;
        if (!confirm(`La copia contiene ${n} días anotados y ${(d.reminders || []).length} alertas. Sustituirá los datos actuales. ¿Continuar?`)) return;
        state.shiftTypes = migrateTypes(d.shiftTypes);
        state.assignments = d.assignments || {};
        state.reminders = Array.isArray(d.reminders) ? d.reminders : [];
        if (d.settings) state.settings = { ...state.settings, ...d.settings };
        save(); scheduleAll(); renderAll(); toast('Datos importados');
      } catch (e) { toast('El archivo no es una copia válida de Turnos'); }
    };
    reader.readAsText(file);
  }

  function resetYear() {
    if (!confirm(`¿Borrar todos los turnos y notas del año ${state.year}? Las alertas no se tocan.`)) return;
    Object.keys(state.assignments).forEach((k) => { if (parts(k)[0] === state.year) delete state.assignments[k]; });
    save(); scheduleAll(); renderAll(); toast(`Año ${state.year} borrado`);
  }

  // =========================================================
  //   EVENTOS
  // =========================================================
  function bind() {
    document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; renderCalendar(); }));
    $('prevBtn').addEventListener('click', () => shiftPeriod(-1));
    $('nextBtn').addEventListener('click', () => shiftPeriod(1));
    $('todayBtn').addEventListener('click', () => goToDay(todayKey()));

    // Pintar
    $('paintToggle').addEventListener('click', () => {
      state.paint = !state.paint;
      if (state.paint && !state.paintShift && state.shiftTypes[0]) state.paintShift = state.shiftTypes[0].id;
      renderCalendar();
    });
    $('paintChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-paint]'); if (!b) return;
      state.paintShift = b.dataset.paint; renderPaintbar();
    });

    // Días
    $('monthGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]'); if (!b) return;
      const k = b.dataset.day;
      if (state.paint && state.paintShift) {
        const cur = state.assignments[k] || { shiftId: null, extraHours: 0, note: '' };
        const target = state.paintShift === '__none' ? null : (cur.shiftId === state.paintShift ? null : state.paintShift);
        const next = { ...cur, shiftId: target };
        if (!next.shiftId && !next.note && !next.extraHours) delete state.assignments[k]; else state.assignments[k] = next;
        save(); scheduleAll(); renderMonth(); renderTop();
        if (navigator.vibrate) navigator.vibrate(12);
        return;
      }
      if (state.selected === k) { openDaySheet(k); return; }
      state.selected = k; renderMonth(); renderDayDetail();
    });

    // Deslizar para cambiar de mes
    let sx = 0, sy = 0;
    $('monthGrid').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    $('monthGrid').addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) shiftPeriod(dx < 0 ? 1 : -1);
    }, { passive: true });

    $('dayDetail').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'edit-day') openDaySheet(state.selected);
      if (act && act.dataset.act === 'add-rem') openReminderSheet(null, state.selected);
      const r = e.target.closest('[data-rem]'); if (r) openReminderSheet(r.dataset.rem, r.dataset.k);
    });
    $('yearView').addEventListener('click', (e) => {
      const b = e.target.closest('[data-month]'); if (!b) return;
      state.month = Number(b.dataset.month); state.view = 'month'; renderCalendar();
    });

    // Agenda
    $('newReminderBtn').addEventListener('click', () => openReminderSheet(null, todayKey()));
    ['agendaList', 'notesList'].forEach((id) => $(id).addEventListener('click', (e) => {
      const r = e.target.closest('[data-rem]'); if (r) { openReminderSheet(r.dataset.rem, r.dataset.k); return; }
      const g = e.target.closest('[data-goto]'); if (g) goToDay(g.dataset.goto);
    }));

    // Resumen
    $('statsPeriod').addEventListener('change', renderStats);

    // Ajustes
    $('addShiftBtn').addEventListener('click', () => openTypeSheet(null));
    $('patternBtn').addEventListener('click', openPatternSheet);
    $('shiftTypesList').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit-type]'); if (ed) { openTypeSheet(ed.dataset.editType); return; }
      const del = e.target.closest('[data-del-type]');
      if (del) {
        const t = typeById(del.dataset.delType);
        if (t && confirm(`¿Eliminar «${t.name}»? Los días que lo tengan quedarán sin turno visible.`)) {
          state.shiftTypes = state.shiftTypes.filter((x) => x.id !== t.id);
          if (state.paintShift === t.id) state.paintShift = null;
          save(); scheduleAll(); renderAll();
        }
      }
    });
    $('shiftAlertsToggle').addEventListener('change', (e) => {
      state.settings.shiftAlerts = e.target.checked; save(); scheduleAll(); renderAgenda();
      if (e.target.checked && !state.shiftTypes.some((t) => t.start)) toast('Pon la hora de entrada en los tipos de turno para recibir el aviso', 4000);
    });
    $('shiftLead').addEventListener('change', (e) => { state.settings.shiftLead = Number(e.target.value); save(); scheduleAll(); renderAgenda(); });
    $('permBtn').addEventListener('click', checkPermsAction);
    $('testNotifBtn').addEventListener('click', testNotification);
    $('exportBtn').addEventListener('click', exportBackup);
    $('importBtn').addEventListener('click', () => $('importInput').click());
    $('importInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; });
    $('resetYearBtn').addEventListener('click', resetYear);

    // Hoja
    $('sheetClose').addEventListener('click', closeSheet);
    // Cerrar solo si el toque empieza y termina fuera de la hoja: al abrirse el
    // teclado la hoja se mueve, y si no, el dedo acababa cerrándola sin querer.
    let downOutside = false;
    $('sheetBackdrop').addEventListener('pointerdown', (e) => { downOutside = e.target.id === 'sheetBackdrop'; });
    $('sheetBackdrop').addEventListener('click', (e) => { if (downOutside && e.target.id === 'sheetBackdrop') closeSheet(); downOutside = false; });

    // Teclado en pantalla: encoger la hoja y centrar el campo enfocado
    bindKeyboard();

    // Al volver a la app: refrescar fecha y renovar alertas
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { renderTop(); renderCalendar(); renderAgenda(); refreshPermBox(); scheduleAll(); }
    });
  }

  // Ajusta la interfaz cuando se abre el teclado del móvil, para que el campo
  // en el que se escribe no quede tapado.
  function bindKeyboard() {
    const root = document.documentElement;
    const vv = window.visualViewport;
    let kbNative = -1;              // alto comunicado por Android (-1 = aún sin dato)

    const setVars = (kb) => {
      kb = Math.max(0, Math.round(kb));
      root.style.setProperty('--kb', kb + 'px');
      root.style.setProperty('--vph', Math.max(240, window.innerHeight - kb) + 'px');
      document.body.classList.toggle('kb-open', kb > 80);
    };

    // 1) Android: el propio sistema nos dice cuánto mide el teclado.
    const KB = plugin('Keyboard');
    if (KB && KB.addListener) {
      const onShow = (info) => {
        let h = (info && info.keyboardHeight) || 0;
        // por si llegara en píxeles físicos en vez de lógicos
        if (h > window.innerHeight * 0.95 && window.devicePixelRatio > 1) h = h / window.devicePixelRatio;
        kbNative = Math.min(h, window.innerHeight * 0.75);
        setVars(kbNative);
        setTimeout(centerFocused, 60);
      };
      const onHide = () => { kbNative = 0; setVars(0); };
      try {
        KB.addListener('keyboardWillShow', onShow);
        KB.addListener('keyboardDidShow', onShow);
        KB.addListener('keyboardWillHide', onHide);
        KB.addListener('keyboardDidHide', onHide);
      } catch (e) { kbNative = -1; }
      try { if (KB.setResizeMode) KB.setResizeMode({ mode: 'none' }); } catch (e) { }
      try { if (KB.setAccessoryBarVisible) KB.setAccessoryBarVisible({ isVisible: false }); } catch (e) { }
    }

    // 2) Respaldo para el navegador y para móviles que sí redimensionan la ventana.
    const apply = () => {
      if (kbNative > 0) return;                    // manda el dato de Android
      const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      setVars(kb);
      if (kb > 120) centerFocused();
    };
    if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
    window.addEventListener('resize', apply);
    apply();

    // 3) Último recurso: si el teclado está abierto y nadie nos lo ha dicho,
    //    reservamos sitio al enfocar un campo dentro de la hoja.
    let focusTimer;
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el || !el.matches || !el.matches('input, textarea, select')) return;
      if (kbNative < 0 && (!vv || Math.abs(vv.height - window.innerHeight) < 40)) {
        setVars(Math.round(window.innerHeight * 0.46));   // altura típica de un teclado
      }
      clearTimeout(focusTimer);
      focusTimer = setTimeout(centerFocused, 300);
    });
    document.addEventListener('focusout', () => {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => {
        const a = document.activeElement;
        if (a && a.matches && a.matches('input, textarea, select')) return;
        if (kbNative <= 0) setVars(vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0);
      }, 250);
    });
  }
  function centerFocused() {
    const el = document.activeElement;
    if (!el || !el.matches || !el.matches('input, textarea, select')) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
  }

  function bindNative() {
    if (AppP) {
      AppP.addListener('backButton', () => {
        if (state.sheetOpen) closeSheet();
        else if (state.paint) { state.paint = false; renderCalendar(); }
        else if (state.tab !== 'cal') switchTab('cal');
        else if (state.view === 'year') { state.view = 'month'; renderCalendar(); }
        else AppP.exitApp();
      });
      AppP.getInfo().then((i) => { $('aboutLine').textContent = `Turnos · versión ${i.version} (${i.build})`; }).catch(() => { });
    }
    if (SB) {
      SB.setStyle({ style: 'LIGHT' }).catch(() => { });
      SB.setBackgroundColor({ color: '#ffffff' }).catch(() => { });
    }
  }

  // ---------- Arranque ----------
  function start() {
    load();
    bind();
    renderAll();
    $('aboutLine').textContent = isNative ? 'Turnos' : 'Turnos · versión web';
    bindNative();
    initNotifications();
    if (!LN) refreshPermBox();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
