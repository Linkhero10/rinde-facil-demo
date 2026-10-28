/* Rinde Fácil — estado de la app, guardado local y copias de seguridad. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var U = RF.util;
  var KEY = 'rinde_facil_v2';
  var listeners = [];
  var storageListeners = [];
  var state = null;
  var storageOk = true;
  var storageError = null;
  var stateVersion = 0;

  function newProject(name) {
    return {
      id: U.uid('p'), name: name || 'Mi proyecto', code: '', convenio: 'corfo-2026-09', tipo: 'inversion',
      start: '', end: '', desembolso1: '', periodoInicio: '', periodoFin: '',
      budgetApproved: { rrhh: 0, operacion: 0, inversion: 0, administracion: 0 },
      done: {}, gantt: { stages: [] }, budgetLines: [], expenses: [], f29: [], obras: [], forms: {}, pea: { general: {}, proyecto: {} },
      observations: [], cotizaciones: [], reitem: { rows: [], motivo: '' }, notes: '',
      needs: {}, needsSet: false, peaAprobado: false, peaAprobadoAt: '', needsPea: null, needsAdded: [], needsCustom: [], show: {}, createdAt: new Date().toISOString()
    };
  }
  function defaults() {
    return {
      v: 2,
      community: { name: '', rut: '', address: '', legalRep: '', repRut: '', email: '', phone: '', ivaModo: 'no_contribuyente', oc: '', ocEmail: '', desembolsos: [] },
      cloud: { apiUrl: '', lastSync: null, rev: 0, autoSave: true, rootUrl: '', saves: [] },
      holidays: [], events: [], activity: [], signatures: [], projects: [], activeProjectId: null, repo: { docs: [], actas: [] },
      ui: { theme: 'system', open: {}, idleMinutes: 15 }
    };
  }
  function esAdmin(p) {
    var name = String(p && p.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return !!p && (p.tipo === 'administracion' || name === 'gastos administrativos' || name === 'gastos de administracion' || name === 'gastos administrativos o indirectos');
  }
  /* el PEA general es la fuente del presupuesto administrativo: si la migración mueve un monto, el PEA general lo guarda también
     (si no, la siguiente normalización lo volvería a su valor anterior, p. ej. 0) */
  function fijarPresupuestoGeneral(s, monto) {
    var gc = s.community && s.community.forms && s.community.forms.peaGeneral && s.community.forms.peaGeneral.data;
    if (gc) gc.presupuestoAdmin = monto;
    s.projects.forEach(function (x) {
      var g = x && x.forms && x.forms.peaGeneral && x.forms.peaGeneral.data;
      if (g && Object.prototype.hasOwnProperty.call(g, 'presupuestoAdmin')) g.presupuestoAdmin = monto;
    });
  }
  /* copia profunda de un registro (JSON): el gasto migrado y el registro no comparten adjuntos ni banderas */
  function copia(x) { return JSON.parse(JSON.stringify(x)); }
  /* Gastos, líneas y monto de administración que quedaron en proyectos normales (el formulario antiguo los permitía) pasan al proyecto Gastos administrativos.
     Sus cotizaciones, anexos 3 y 5 y fichas C pasan con ellos, conservando los vínculos.
     No se borra nada sin copia: cada movimiento queda en s.migracionAdministracion con los datos originales, para revertirlo a mano.
     El monto solo se mueve si el proyecto administrativo no tiene uno; si ya tiene, el del proyecto normal queda y la pantalla lo avisa. */
  function migrarAdministracion(s, admin) {
    var registros = [];
    if (!Array.isArray(admin.expenses)) admin.expenses = [];
    if (!Array.isArray(admin.budgetLines)) admin.budgetLines = [];
    s.projects.forEach(function (p) {
      if (!p || esAdmin(p)) return;
      var gastos = (p.expenses || []).filter(function (e) { return e && e.cuenta === 'administracion'; });
      var lineas = (p.budgetLines || []).filter(function (l) { return l && l.cuenta === 'administracion'; });
      var monto = Number(p.budgetApproved && p.budgetApproved.administracion) || 0;
      var mueveMonto = monto > 0 && !(Number(admin.budgetApproved.administracion) > 0);
      if (!gastos.length && !lineas.length && !mueveMonto) return;
      var f = p.forms || {}, a5 = f.anexo5 && f.anexo5.data || {};
      function porId(x) { return !!x && gastos.some(function (e) { return e.id && x.gastoId === e.id; }); }
      function porFicha(x) { return !!x && porId(x.data); }
      function porFila(x) {
        return !!x && (porId(x) || gastos.some(function (e) {
          var folio = String(e.folio == null ? '' : e.folio).trim();
          return folio !== '' && String(x.doc == null ? '' : x.doc).trim() === folio;
        }));
      }
      var respaldos = {
        cotizaciones: (p.cotizaciones || []).filter(porId),
        anexo3: (Array.isArray(f.anexo3) ? f.anexo3 : []).filter(porFicha),
        anexo5: { uso: (a5.uso || []).filter(porFila), hh: (a5.hh || []).filter(porFila) },
        informeC: (Array.isArray(f.informeC) ? f.informeC : []).filter(porFicha)
      };
      /* Preparar ambas copias antes de retirar nada: si JSON falla, el origen sigue completo.
         El registro conserva los originales incluso si el destino necesita cambiar un id. */
      var registro = copia({ fecha: new Date().toISOString(), desde: { id: p.id, nombre: p.name || '' }, gastos: gastos, lineas: lineas, montoMovido: mueveMonto ? monto : 0, respaldos: respaldos });
      var traslado = copia({ gastos: gastos, lineas: lineas, respaldos: respaldos });
      var idsGastos = Object.create(null), idsLineas = Object.create(null), idsMigrados = Object.create(null);
      admin.expenses.forEach(function (e) { if (e && e.id) idsGastos[e.id] = true; });
      admin.budgetLines.forEach(function (l) { if (l && l.id) idsLineas[l.id] = true; });
      /* la actividad del Gantt es de este proyecto: en el administrativo se quita (el original queda en el registro) */
      traslado.gastos.forEach(function (c, i) { if (c.actId) c.actId = ''; if (!c.id || idsGastos[c.id]) c.id = U.uid('adm'); idsGastos[c.id] = true; if (gastos[i].id) idsMigrados[gastos[i].id] = c.id; });
      traslado.lineas.forEach(function (c) { if (c.actId) c.actId = ''; if (!c.id || idsLineas[c.id]) c.id = U.uid('adm'); idsLineas[c.id] = true; });
      registro.idsGastos = copia(idsMigrados);
      function vincular(x) { if (x && Object.prototype.hasOwnProperty.call(idsMigrados, x.gastoId)) x.gastoId = idsMigrados[x.gastoId]; }
      traslado.respaldos.cotizaciones.forEach(vincular);
      traslado.respaldos.anexo3.forEach(function (x) { vincular(x.data); });
      traslado.respaldos.informeC.forEach(function (x) { vincular(x.data); if (x.data.actId) x.data.actId = ''; });
      ['uso', 'hh'].forEach(function (k) { traslado.respaldos.anexo5[k].forEach(vincular); });
      function trasladar(origen, destino, clave, originales, nuevos) {
        if (!originales.length) return;
        destino[clave] = (Array.isArray(destino[clave]) ? destino[clave] : []).concat(nuevos);
        origen[clave] = origen[clave].filter(function (x) { return originales.indexOf(x) < 0; });
      }
      admin.expenses = admin.expenses.concat(traslado.gastos);
      admin.budgetLines = admin.budgetLines.concat(traslado.lineas);
      trasladar(p, admin, 'cotizaciones', respaldos.cotizaciones, traslado.respaldos.cotizaciones);
      ['anexo3', 'informeC'].forEach(function (k) {
        if (!respaldos[k].length) return;
        admin.forms = admin.forms || {};
        trasladar(f, admin.forms, k, respaldos[k], traslado.respaldos[k]);
      });
      if (respaldos.anexo5.uso.length || respaldos.anexo5.hh.length) {
        admin.forms = admin.forms || {};
        admin.forms.anexo5 = admin.forms.anexo5 || {};
        var destino5 = admin.forms.anexo5.data = admin.forms.anexo5.data || {};
        ['uso', 'hh'].forEach(function (k) {
          if (!Array.isArray(destino5[k])) destino5[k] = [];
          trasladar(a5, destino5, k, respaldos.anexo5[k], traslado.respaldos.anexo5[k]);
        });
      }
      p.expenses = (p.expenses || []).filter(function (e) { return gastos.indexOf(e) < 0; });
      p.budgetLines = (p.budgetLines || []).filter(function (l) { return lineas.indexOf(l) < 0; });
      if (mueveMonto) { admin.budgetApproved.administracion = monto; p.budgetApproved.administracion = 0; fijarPresupuestoGeneral(s, monto); }
      registros.push(registro);
    });
    if (registros.length) s.migracionAdministracion = (Array.isArray(s.migracionAdministracion) ? s.migracionAdministracion : []).concat(registros);
  }
  /* Una administración por comunidad. Se conservan registros de proyectos antiguos duplicados. */
  function ensureAdminProject(s, presupuestoAdmin, createProject) {
    s.projects = Array.isArray(s.projects) ? s.projects : [];
    var presupuestoExplicito = presupuestoAdmin !== undefined && presupuestoAdmin !== null && presupuestoAdmin !== '';
    var admins = s.projects.filter(esAdmin), admin = admins[0];
    if (!admin) { admin = (createProject || newProject)('Gastos administrativos'); s.projects.push(admin); }
    function completar(dst, src) {
      Object.keys(src || {}).forEach(function (k) {
        if (Array.isArray(src[k])) {
          if (!Array.isArray(dst[k])) dst[k] = [];
          src[k].forEach(function (x) {
            if (dst[k].some(function (y) { return equalData(x, y); })) return;
            if (x && x.id && dst[k].some(function (y) { return y && y.id === x.id; })) x = Object.assign({}, x, { id: U.uid('adm') });
            dst[k].push(x);
          });
        } else if (src[k] && typeof src[k] === 'object') { dst[k] = dst[k] || {}; completar(dst[k], src[k]); }
        else if (dst[k] === undefined || dst[k] === null || dst[k] === '' || dst[k] === 0 || dst[k] === false) dst[k] = src[k];
      });
    }
    admins.slice(1).forEach(function (p) {
      var datos = Object.assign({}, p); delete datos.id; delete datos.name; delete datos.tipo;
      completar(admin, datos);
      if (s.activeProjectId === p.id) s.activeProjectId = admin.id;
      (s.repo && s.repo.docs || []).forEach(function (d) { if (d.projectId === p.id) d.projectId = admin.id; });
    });
    s.projects = s.projects.filter(function (p) { return !esAdmin(p); }); s.projects.push(admin);
    admin.name = 'Gastos administrativos'; admin.tipo = 'administracion'; admin.auto = true;
    var generalComunidad = s.community && s.community.forms && s.community.forms.peaGeneral && s.community.forms.peaGeneral.data;
    if (presupuestoAdmin == null && generalComunidad && generalComunidad.presupuestoAdmin !== '') presupuestoAdmin = generalComunidad.presupuestoAdmin;
    if (presupuestoAdmin === undefined || presupuestoAdmin === null || presupuestoAdmin === '') {
      s.projects.some(function (p) {
        var general = p.forms && p.forms.peaGeneral && p.forms.peaGeneral.data;
        var value = general && general.presupuestoAdmin;
        if (value === undefined || value === null || value === '') return false;
        presupuestoAdmin = value; return true;
      });
    }
    admin.budgetApproved = admin.budgetApproved || { rrhh: 0, operacion: 0, inversion: 0, administracion: 0 };
    if (presupuestoAdmin !== undefined && presupuestoAdmin !== null && presupuestoAdmin !== '') admin.budgetApproved.administracion = U.parseCLP(presupuestoAdmin);
    else if (admin.budgetApproved.administracion == null) admin.budgetApproved.administracion = 0;
    /* Un importe recién leído no debe retroceder al volver a abrir formularios antiguos. */
    if (presupuestoExplicito) {
      if (generalComunidad) generalComunidad.presupuestoAdmin = admin.budgetApproved.administracion;
      s.projects.forEach(function (p) {
        var general = p.forms && p.forms.peaGeneral && p.forms.peaGeneral.data;
        if (general && Object.prototype.hasOwnProperty.call(general, 'presupuestoAdmin')) general.presupuestoAdmin = admin.budgetApproved.administracion;
      });
    }
    migrarAdministracion(s, admin);
    return admin;
  }
  function migrate(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') { ensureAdminProject(d); return d; }
    var out = Object.assign({}, d, s);
    out.community = Object.assign({}, d.community, s.community || {});
    out.community.desembolsos = Array.isArray(out.community.desembolsos) ? out.community.desembolsos : [];
    if (/^SMI/i.test(out.community.oc || '')) out.community.oc = ''; /* el organismo se nombra por su rol, no por la institución */
    out.cloud = Object.assign({}, d.cloud, s.cloud || {});
    out.ui = Object.assign({}, d.ui, s.ui || {});
    out.holidays = Array.isArray(s.holidays) ? s.holidays : [];
    out.signatures = Array.isArray(s.signatures) ? s.signatures.filter(function (e) { return e && e.id && /^data:image\/png;base64,/.test(e.png || ''); }) : [];
    out.activity = Array.isArray(s.activity) ? s.activity.filter(function (e) { return e && typeof e === 'object' && e.id; }) : [];
    out.events = Array.isArray(s.events) ? s.events.filter(function (e) { return e && typeof e === 'object'; }) : [];
    out.repo = { docs: Array.isArray(s.repo && s.repo.docs) ? s.repo.docs : [], actas: Array.isArray(s.repo && s.repo.actas) ? s.repo.actas : [] };
    out.projects = (Array.isArray(s.projects) ? s.projects : []).map(function (p) {
      var np = Object.assign(newProject(p && p.name), p);
      np.budgetApproved = Object.assign({ rrhh: 0, operacion: 0, inversion: 0, administracion: 0 }, p.budgetApproved || {});
      np.gantt = p.gantt && Array.isArray(p.gantt.stages) ? p.gantt : { stages: [] };
      ['budgetLines', 'expenses', 'observations', 'cotizaciones', 'f29', 'obras'].forEach(function (k) { if (!Array.isArray(np[k])) np[k] = []; });
      np.forms = p.forms && typeof p.forms === 'object' ? p.forms : {};
      np.done = p.done && typeof p.done === 'object' ? p.done : {};
      np.pea = Object.assign({ general: {}, proyecto: {} }, p.pea || {});
      np.reitem = Object.assign({ rows: [], motivo: '' }, p.reitem || {});
      np.needs = p.needs && typeof p.needs === 'object' ? p.needs : {}; np.show = p.show && typeof p.show === 'object' ? p.show : {};
      ['needsAdded', 'needsCustom'].forEach(function (k) { if (!Array.isArray(np[k])) np[k] = []; });
      return np;
    });
    ensureAdminProject(out);
    if (!out.projects.some(function (p) { return p.id === out.activeProjectId; })) {
      out.activeProjectId = out.projects.length ? out.projects[0].id : null;
    }
    out.v = 2;
    return out;
  }
  /* con la bóveda de la comunidad, el estado solo existe en memoria mientras la app está abierta con la contraseña */
  var vaultMode = false, persistHook = null, pending = Promise.resolve(), latestSave = Promise.resolve(true);
  function setStorageStatus(ok, error) {
    var changed = storageOk !== ok;
    storageOk = ok;
    storageError = ok ? null : (error || new Error('No se pudieron guardar los cambios.'));
    if (changed) storageListeners.slice().forEach(function (l) { try { l(ok, storageError); } catch (e) { /* un indicador no debe frenar el guardado */ } });
  }
  function useVault() { vaultMode = true; state = null; persistHook = null; dirty = false; stateVersion++; }
  function attach(obj, hook) { state = migrate(obj); persistHook = hook || null; dirty = false; stateVersion++; listeners.slice().forEach(function (l) { l(state); }); return state; }
  function detach() { state = null; persistHook = null; dirty = false; stateVersion++; }
  function flush() {
    var queued = persistNow();
    if (vaultMode) {
      if (!queued && !storageOk) return Promise.reject(storageError || new Error('NO_GUARDADO'));
      return latestSave.then(function (ok) { if (ok === false) throw (storageError || new Error('NO_GUARDADO')); return true; });
    }
    if (!queued && !storageOk) return Promise.reject(storageError || new Error('NO_GUARDADO'));
    return Promise.resolve(queued);
  }
  function load() {
    if (vaultMode) { state = migrate(null); return state; }
    var raw = null;
    try { raw = root.localStorage.getItem(KEY); } catch (e) { setStorageStatus(false, e); }
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    state = migrate(parsed);
    return state;
  }
  var persistSoon = null, dirty = false;
  /* solo se escribe si hubo cambios: una pestaña vieja y sin tocar nunca pisa lo que guardó otra */
  function persistNow() {
    if (!dirty) return true;
    if (vaultMode) {
      if (!persistHook) { setStorageStatus(false, new Error('No hay un mecanismo de guardado conectado.')); return false; }
      dirty = false;
      var st = state, hook = persistHook, version = stateVersion;
      var attempt = pending.then(function () { return hook(st); });
      latestSave = attempt.then(function () { if (stateVersion === version) dirty = false; setStorageStatus(true); return true; }, function (e) { dirty = true; setStorageStatus(false, e); throw e; });
      pending = latestSave.then(function () {}, function () {});
      return true;
    }
    try { root.localStorage.setItem(KEY, JSON.stringify(state)); setStorageStatus(true); dirty = false; return true; }
    catch (e) { setStorageStatus(false, e); return false; }
  }
  function schedulePersist() {
    if (typeof setTimeout === 'undefined') { persistNow(); return; }
    clearTimeout(persistSoon);
    persistSoon = setTimeout(persistNow, 150);
  }
  /* Al cerrar o esconder la pestaña se intenta guardar; el navegador no garantiza esperar el cifrado asíncrono. */
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('pagehide', function () { if (state) persistNow(); });
    root.addEventListener('beforeunload', function () { if (state) persistNow(); });
    if (root.document && typeof root.document.addEventListener === 'function') root.document.addEventListener('visibilitychange', function () { if (root.document.visibilityState === 'hidden' && state) persistNow(); });
  }
  function get() { if (!state) load(); return state; }
  function project() {
    var s = get();
    for (var i = 0; i < s.projects.length; i++) if (s.projects[i].id === s.activeProjectId) return s.projects[i];
    return null;
  }
  /* muta el estado y avisa a la interfaz; opts.silent evita re-dibujar (para escribir en un campo) */
  function update(fn, opts) {
    var s = get();
    fn(s);
    stateVersion++;
    dirty = true;
    schedulePersist();
    if (!(opts && opts.silent)) listeners.slice().forEach(function (l) { l(s); });
    if (!(opts && opts.noSync)) changeListeners.slice().forEach(function (l) { try { l(s); } catch (e) { /* un oyente no debe romper el guardado */ } });
    return s;
  }
  var changeListeners = [];
  /* cualquier cambio de datos, incluso los «silenciosos»; opts.noSync lo excluye (lo usa la propia sincronización) */
  function onChange(fn) { changeListeners.push(fn); }
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (l) { return l !== fn; }); }; }
  function onStorageStatus(fn) { storageListeners.push(fn); return function () { storageListeners = storageListeners.filter(function (l) { return l !== fn; }); }; }
  function addProject(name) {
    var p = newProject(name);
    update(function (s) { s.projects.push(p); s.activeProjectId = p.id; ensureAdminProject(s); });
    if (esAdmin(p)) return get().projects.filter(esAdmin)[0];
    return p;
  }
  function removeProject(id) {
    update(function (s) {
      /* La administración es transversal: no se borra con sus gastos; ensureAdminProject la volvería a crear vacía. */
      var borrar = s.projects.filter(function (p) { return p.id === id; })[0];
      if (borrar && esAdmin(borrar)) return;
      s.projects = s.projects.filter(function (p) { return p.id !== id; });
      ensureAdminProject(s);
      if (s.activeProjectId === id) s.activeProjectId = s.projects.length ? s.projects[0].id : null;
    });
  }
  /* la clave de acceso al servicio nunca va dentro de una copia: la copia puede compartirse o quedar en un Drive con más gente */
  var OCR_EXTRACT = 2000;
  function exportJSON() {
    var copy = JSON.parse(JSON.stringify(get()));
    copy.cloud = Object.assign({}, copy.cloud, { saves: [] });
    if (copy.ui) delete copy.ui.borradores; /* los borradores son de este equipo: no viajan a las copias de Drive */
    delete copy.cloud.device; /* la credencial de equipo no viaja en copias ni respaldos */
    delete copy.cloud.base; delete copy.cloud.syncFp; /* la foto de sincronización es de cada equipo */
    delete copy.cloud.key; /* la clave compartida de las versiones anteriores ya no existe; por si quedara una copia vieja */
    /* del texto que leyó el OCR la copia lleva solo un extracto: pesa mucho y trae datos de terceros (RUT, direcciones); el original queda en el equipo */
    (copy.projects || []).forEach(function (p) { (p.expenses || []).forEach(function (e) { if (e.ocr && typeof e.ocr.raw === 'string' && e.ocr.raw.length > OCR_EXTRACT) { e.ocr.raw = e.ocr.raw.slice(0, OCR_EXTRACT); e.ocr.cortado = true; } }); });
    /* los gastos guardados en el registro de migración también llevan el OCR: se recorta igual */
    (copy.migracionAdministracion || []).forEach(function (m) { (m.gastos || []).forEach(function (e) { if (e && e.ocr && typeof e.ocr.raw === 'string' && e.ocr.raw.length > OCR_EXTRACT) { e.ocr.raw = e.ocr.raw.slice(0, OCR_EXTRACT); e.ocr.cortado = true; } }); });
    return JSON.stringify(copy, null, 2);
  }
  function importJSON(text) {
    var parsed = U.safeParse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) throw new Error('El archivo no es una copia de Rinde Fácil.');
    var mine = get().cloud, miUi = get().ui || {};
    state = migrate(parsed);
    state.ui = Object.assign({}, state.ui, { borradores: miUi.borradores || {} }); /* los borradores son de este equipo: una copia no los reemplaza */
    /* la conexión con el servicio es de este dispositivo: una copia no la reemplaza */
    if (mine && mine.apiUrl) state.cloud = Object.assign({}, state.cloud, { apiUrl: mine.apiUrl || state.cloud.apiUrl, saves: mine.saves || [] }); delete state.cloud.device; if (mine.device) state.cloud.device = mine.device;
    if (state.cloud) delete state.cloud.key;
    stateVersion++; dirty = true; persistNow();
    listeners.slice().forEach(function (l) { l(state); });
    return state;
  }
  function reset() { state = migrate(null); stateVersion++; dirty = true; persistNow(); listeners.slice().forEach(function (l) { l(state); }); }
  /* si otra pestaña (u otra ventana de la app) guarda cambios, esta se pone al día en vez de pisarlos */
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('storage', function (e) {
      if (vaultMode) { /* otra pestaña guardó en la bóveda: se descifra y se pone al día esta */
        if (root.RF.vault && e.key === root.RF.vault.KEY && persistHook && root.RF.vault.readState) root.RF.vault.readState().then(function (obj) { if (obj) { state = migrate(obj); dirty = false; listeners.slice().forEach(function (l) { l(state); }); } }).catch(function () { /* cambió la contraseña o se bloqueó */ });
        return;
      }
      if (e.key !== KEY || !e.newValue) return;
      try { var propios = state && state.ui && state.ui.borradores; state = migrate(JSON.parse(e.newValue)); if (propios) state.ui = Object.assign({}, state.ui, { borradores: propios }); dirty = false; listeners.slice().forEach(function (l) { l(state); }); } catch (err) { /* copia dañada: se ignora */ }
    });
  }
  /* Sin una base común no se puede decidir qué edición gana. Preparar todo en una copia;
     cualquier divergencia ambigua aborta antes de modificar el estado local. */
  function equalData(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    var ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    return ak.length === bk.length && ak.every(function (k, i) { return k === bk[i] && equalData(a[k], b[k]); });
  }
  function conflict(path) { throw Object.assign(new Error('No se pueden combinar automáticamente las copias: diferencias en ' + path + '. Guarda ambas copias y revisa los cambios, o elige explícitamente cuál conservar.'), { code: 'MERGE_CONFLICT', path: path }); }
  /* Huella de un dato: sirve para saber si cambió desde la última vez que los equipos coincidieron (la «base»). */
  function stable(v) {
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function fp(v) { var str = stable(v), h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  var LISTS = ['expenses', 'cotizaciones', 'observations', 'budgetLines', 'needsCustom', 'f29', 'obras', 'approvals'];
  /* foto de lo que hay ahora, dato por dato: se guarda tras cada sincronización y permite distinguir «lo cambié yo» de «lo cambió el otro equipo» */
  function snapshotBase(st) {
    var b = {};
    Object.keys(st.community || {}).forEach(function (k) { b['c|' + k] = fp(st.community[k]); });
    /* la lista de asistencia (peaRespaldos) es de todo el equipo, no de un proyecto: su foto sirve para saber si cambió */
    b['pr'] = fp(st.peaRespaldos);
    (st.events || []).forEach(function (x) { if (x && x.id) b['ev|' + x.id] = fp(x); });
    (st.activity || []).forEach(function (x) { if (x && x.id) b['act|' + x.id] = fp(x); });
    (st.signatures || []).forEach(function (x) { if (x && x.id) b['sig|' + x.id] = fp(x); });
    ['docs', 'actas'].forEach(function (k) { ((st.repo || {})[k] || []).forEach(function (x) { if (x && x.id) b['r|' + k + '|' + x.id] = fp(x); }); });
    (st.projects || []).forEach(function (p) {
      b['P|' + p.id] = 1;
      Object.keys(p).forEach(function (k) {
        if (LISTS.indexOf(k) >= 0) (p[k] || []).forEach(function (x) { if (x && x.id) b['l|' + p.id + '|' + k + '|' + x.id] = fp(x); });
        else if (k === 'done') Object.keys(p.done || {}).forEach(function (d) { b['d|' + p.id + '|' + d] = 1; });
        else if (k === 'forms') Object.keys(p.forms || {}).forEach(function (f) {
          if (Array.isArray(p.forms[f])) p.forms[f].forEach(function (x) { if (x && x.id) b['l|' + p.id + '|forms.' + f + '|' + x.id] = fp(x); });
          else b['f|' + p.id + '|' + f] = fp(p.forms[f]);
        });
        else b['p|' + p.id + '|' + k] = fp(p[k]);
      });
    });
    return b;
  }
  /* Une dos listas de registros con identificador. Con base (tres vías) se respetan los cambios de cada lado y los borrados;
     sin base solo se agregan los nuevos y cualquier registro distinto es conflicto. Devuelve { list, added }. */
  function unionById(local, remote, base, prefix) {
    var lm = new Map(), rm = new Map(), order = [], added = 0, out = [];
    (local || []).forEach(function (x) { if (!x || !x.id || lm.has(x.id)) conflict('identificadores locales'); lm.set(x.id, x); order.push(x.id); });
    (remote || []).forEach(function (x) { if (!x || !x.id || rm.has(x.id)) conflict('identificadores remotos'); rm.set(x.id, x); if (!lm.has(x.id)) order.push(x.id); });
    order.forEach(function (id) {
      var l = lm.get(id), r = rm.get(id), b = base ? base[prefix + id] : undefined;
      if (l && r) {
        if (equalData(l, r)) out.push(l);
        else if (b === undefined) conflict('registro ' + id);
        else if (fp(l) === b) out.push(r);
        else if (fp(r) === b) out.push(l);
        else conflict('registro ' + id);
      } else if (l) { /* solo aquí: nuevo, o lo borró el otro equipo */
        if (b !== undefined && fp(l) === b) return; /* lo borraron allá y aquí no se tocó */
        out.push(l);
      } else { /* solo allá: nuevo, o lo borramos aquí */
        if (b !== undefined && fp(r) === b) return;
        out.push(r); added++;
      }
    });
    return { list: out, added: added };
  }
  /* Une los datos de otra copia (la de la nube) con los de este equipo. base: la foto de la última sincronización (opcional). */
  function mergeRemote(remote, base) {
    function checkProjects(projects) {
      var ids = new Set();
      (projects || []).forEach(function (p) { if (!p || !p.id || ids.has(p.id)) conflict('identificadores de proyectos'); ids.add(p.id); });
    }
    checkProjects(remote && remote.projects); checkProjects(get().projects);
    var added = 0, r = migrate(U.safeParse(JSON.stringify(remote))), s = migrate(U.safeParse(JSON.stringify(get())));
    function empty(v) { return v === undefined || v === null || v === ''; }
    /* un valor suelto (con base): si solo cambió un lado, gana ese; si cambiaron los dos distinto, conflicto */
    function pick(l, rv, key, label) {
      if (equalData(l, rv)) return l;
      var b = base ? base[key] : undefined;
      if (b !== undefined) { if (fp(l) === b) return rv; if (fp(rv) === b) return l; }
      conflict(label);
    }
    /* los datos de la comunidad se juntan campo a campo: lo que un equipo dejó vacío se completa con lo del otro */
    (function () {
      var rc = r.community || {}, sc = s.community || {};
      Object.keys(rc).concat(Object.keys(sc)).forEach(function (k) {
        var a = sc[k], b = rc[k];
        if (empty(a) && !empty(b)) sc[k] = b;
        else if (!empty(a) && !empty(b)) sc[k] = pick(a, b, 'c|' + k, 'community');
      });
      s.community = sc;
      /* feriados: se unen (son fechas sueltas, no hay nada que pelear) */
      s.holidays = Array.from(new Set((s.holidays || []).concat(r.holidays || []))).sort();
    })();
    /* la lista de asistencia no es de ningún proyecto ni se pelea: si cambió solo en la copia remota, gana esa;
       si cambió aquí, o en los dos lados, o no hay base para saberlo, gana la de este equipo */
    (function () {
      if (equalData(s.peaRespaldos, r.peaRespaldos)) return;
      var basePr = base ? base['pr'] : undefined;
      if (basePr !== undefined && fp(s.peaRespaldos) === basePr && fp(r.peaRespaldos) !== basePr) s.peaRespaldos = r.peaRespaldos;
    })();
    Object.keys(r).concat(Object.keys(s)).forEach(function (k) { if (['projects', 'repo', 'cloud', 'ui', 'activeProjectId', 'events', 'community', 'holidays', 'activity', 'signatures', 'peaRespaldos', 'migracionAdministracion'].indexOf(k) < 0 && !equalData(s[k], r[k])) conflict(k); });
    (function () {
      var haveP = new Map(); s.projects.forEach(function (p) { haveP.set(p.id, p); });
      r.projects.forEach(function (rp) {
        var lp = haveP.get(rp.id);
        if (!lp) { s.projects.push(rp); added++; return; }
        Object.keys(rp).concat(Object.keys(lp)).forEach(function (k) {
          if (LISTS.concat(['forms', 'done']).indexOf(k) >= 0) return;
          lp[k] = pick(lp[k], rp[k], 'p|' + rp.id + '|' + k, 'proyecto ' + rp.id + '/' + k);
          if (lp[k] === undefined) delete lp[k];
        });
        LISTS.forEach(function (k) { var u = unionById(lp[k], rp[k], base, 'l|' + rp.id + '|' + k + '|'); lp[k] = u.list; added += u.added; });
        lp.forms = lp.forms || {};
        Object.keys(rp.forms || {}).concat(Object.keys(lp.forms)).forEach(function (k, i, all) {
          if (all.indexOf(k) !== i) return;
          var lf = lp.forms[k], rf = (rp.forms || {})[k];
          if ((Array.isArray(lf) || lf === undefined) && (Array.isArray(rf) || rf === undefined) && (lf !== undefined || rf !== undefined)) {
            var u = unionById(lf, rf, base, 'l|' + rp.id + '|forms.' + k + '|'); lp.forms[k] = u.list; added += u.added;
          } else if (rf === undefined && !base) conflict('formulario ' + k);
          else if (rf === undefined) { if (base['f|' + rp.id + '|' + k] === undefined) { /* nuevo aquí */ } else if (fp(lf) !== base['f|' + rp.id + '|' + k]) { /* cambiado aquí: se conserva */ } else delete lp.forms[k]; }
          else if (lf === undefined) { if (!base || base['f|' + rp.id + '|' + k] === undefined || fp(rf) !== base['f|' + rp.id + '|' + k]) { lp.forms[k] = rf; added++; } }
          else lp.forms[k] = pick(lf, rf, 'f|' + rp.id + '|' + k, 'formulario ' + k);
        });
        /* pasos marcados: si lo marcó cualquiera, queda marcado; con base, si uno lo desmarcó (y estaba marcado en la base), queda desmarcado */
        lp.done = lp.done || {};
        Object.keys(rp.done || {}).concat(Object.keys(lp.done)).forEach(function (k) {
          var inL = Object.prototype.hasOwnProperty.call(lp.done, k), inR = Object.prototype.hasOwnProperty.call(rp.done || {}, k);
          if (inL && inR) return;
          var was = base && base['d|' + rp.id + '|' + k] !== undefined;
          if (was) delete lp.done[k]; else lp.done[k] = true;
        });
      });
      var d = unionById(s.repo.docs, r.repo.docs, base, 'r|docs|'), a = unionById(s.repo.actas, r.repo.actas, base, 'r|actas|');
      s.repo.docs = d.list; s.repo.actas = a.list; added += d.added + a.added;
      var ev = unionById(s.events, r.events, base, 'ev|'); s.events = ev.list; added += ev.added;
      var sg = unionById(s.signatures, r.signatures, base, 'sig|'); s.signatures = sg.list; added += sg.added;
      var ac = unionById(s.activity, r.activity, base, 'act|'); s.activity = ac.list.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; }).slice(-400); /* el historial se une sin contarlo como cambio */
    })();
    ensureAdminProject(s);
    /* el registro de migración de administración solo crece: se unen las dos copias sin repetir una misma migración */
    (function () {
      var vistos = {}, lista = [];
      (s.migracionAdministracion || []).concat(r.migracionAdministracion || []).forEach(function (m) {
        var k = JSON.stringify([m && m.desde && m.desde.id, (m.gastos || []).map(function (x) { return x && x.id; }), (m.lineas || []).map(function (x) { return x && x.id; }), m.montoMovido]);
        if (!vistos[k]) { vistos[k] = true; lista.push(m); }
      });
      if (lista.length) s.migracionAdministracion = lista;
    })();
    update(function (current) { current.projects = s.projects; current.repo = s.repo; current.events = s.events; current.activity = s.activity; current.signatures = s.signatures; current.community = s.community; current.holidays = s.holidays; current.peaRespaldos = s.peaRespaldos; if (s.migracionAdministracion) current.migracionAdministracion = s.migracionAdministracion; });
    return added;
  }
  function isDone(p, tid, i) { return !!(p && p.done[tid + ':' + i]); }
  function setDone(tid, i, val) { /* en silencio: quien llama actualiza la pantalla que corresponde */
    update(function (s) {
      var p = project(); if (!p) return;
      if (val) p.done[tid + ':' + i] = true; else delete p.done[tid + ':' + i];
    }, { silent: true });
  }

  RF.store = {
    KEY: KEY, load: load, get: get, project: project, update: update, subscribe: subscribe,
    addProject: addProject, removeProject: removeProject, newProject: newProject, defaults: defaults, ensureAdminProject: ensureAdminProject, esAdmin: esAdmin,
    exportJSON: exportJSON, importJSON: importJSON, reset: reset, migrate: migrate,
    version: function () { return stateVersion; }, isDone: isDone, setDone: setDone, persistNow: persistNow, storageOk: function () { return storageOk; }, storageError: function () { return storageError; }, onStorageStatus: onStorageStatus,
    onChange: onChange, mergeRemote: mergeRemote, snapshotBase: snapshotBase, fingerprint: fp, useVault: useVault, attach: attach, detach: detach, flush: flush
  };
})(typeof window !== 'undefined' ? window : globalThis);
