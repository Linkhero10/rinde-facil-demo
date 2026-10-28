/* Rinde Fácil — sesión de la comunidad: contraseña al iniciar, bloqueo por inactividad y sesión con el servicio (token que vence).
 *
 * Una sola contraseña abre dos cosas: los datos de este equipo (bóveda cifrada) y, si hay servicio conectado, la sesión con él.
 * El token del servicio vive solo en memoria: al recargar la página se pide la contraseña otra vez. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var C = RF.crypto, V = RF.vault;
  var S = { token: null, exp: 0, inflight: null, timer: null, last: Date.now(), listeners: [], started: false, insecure: false };
  var pendingLocalPasswordChange = null;
  var PUBLIC = { ping: 1, challenge: 1, setup: 1, login: 1, resetPassword: 1, loginInquilino: 1, activar: 1, infoInquilino: 1, canjearTicket: 1 };

  function emit() { S.listeners.slice().forEach(function (f) { try { f(phase()); } catch (e) { /* un aviso que falla no debe frenar a los demás */ } }); }
  /* un servicio falso podría pedir pocas vueltas de PBKDF2 para adivinar la contraseña sin conexión: se exige el mínimo de la app */
  function checkChallenge(ch) {
    if (!ch || !ch.exists) return;
    if (!(Number(ch.it) >= C.ITERATIONS) || typeof ch.saltP !== 'string' || ch.saltP.length < 16) throw Object.assign(new Error('El servicio propone una protección más débil de la permitida. No se envió nada.'), { code: 'SERVICIO_DEBIL' });
  }
  /* entrada asistida del Organismo: la copia vive en memoria y se guarda en el servicio con la sesión asistida (sin bóveda de la comunidad) */
  var asistida = null;
  /* huella de la copia tal como llegó del servicio: sin cambios desde entonces no hay nada que enviar al cerrar */
  var asistidaBase = null;
  /* misma huella que la sincronización (36-drive.js, syncFingerprint): dice si los datos cambiaron desde la última copia enviada */
  function huellaDatos() { var st = RF.store.get(); return RF.store.fingerprint({ community: st.community, holidays: st.holidays, events: st.events, activity: st.activity, signatures: st.signatures, repo: st.repo, projects: st.projects, peaRespaldos: st.peaRespaldos }); }
  function phase() { if (S.insecure) return 'insecure'; if (asistida) return 'open'; return V.status(); } /* none | legacy | locked | open */
  function onChange(f) { S.listeners.push(f); }
  function cfg() { return RF.store.get().cloud || {}; }
  /* comunidad de esta dirección (subdominio) o la guardada al activar; null en una instalación de una sola comunidad */
  function inquilino() { var d = RF.organismo && RF.organismo.inquilinoDeHost ? RF.organismo.inquilinoDeHost() : null; return d || cfg().inquilino || null; }
  /* en una comunidad nueva aún no hay dirección guardada: se usa el servicio central aprobado */
  function serviceUrl() { return cfg().apiUrl || (RF.cloud.approvedUrls()[0] || ''); }
  function idleMs() { var m = Number((RF.store.get().ui || {}).idleMinutes); return (isFinite(m) && m >= 1 ? m : 15) * 60000; }

  function init() {
    RF.store.useVault();
    if (!C.available()) S.insecure = true;
    return Promise.resolve(phase());
  }

  /* ---------- abrir, crear, cerrar ---------- */
  function afterOpen(state, quiet) {
    S.reason = '';
    RF.store.attach(state, V.save);
    touch(); startIdle();
    if (RF.blobs && RF.blobs.encryptAll) RF.blobs.encryptAll().catch(function () { /* las fotos se cifran de a poco */ });
    if (!quiet) emit();
  }
  /* primera vez: crea la cuenta; si había datos sin cifrar de la versión anterior, los protege con la contraseña nueva.
     opts.reinicio: la comunidad ya tiene cuenta y se activa con un código de reinicio; no se comprueba que la cuenta no exista (el servicio sabe qué tipo de código es) */
  function createAccount(user, password, opts) {
    var reinicio = !!(opts && opts.reinicio);
    var legacy = V.legacyState(), initial = legacy || RF.store.defaults();
    /* lo que había sin cifrar al empezar: si cambia antes de quitarla, no se quita */
    var legacyRaw = V.rawLegacy();
    if (V.meta()) return Promise.reject(Object.assign(new Error('Ya hay una cuenta en este equipo. Entra con ella; no se creó otra.'), { code: 'YA_EXISTE' }));
    var urls = RF.cloud.approvedUrls(), url = String((initial.cloud && initial.cloud.apiUrl) || cfg().apiUrl || (urls.length === 1 ? urls[0] : '')).trim();
    var unavailable = 'No se pudo comprobar si esta comunidad ya tiene cuenta. No se creó nada. Revisa la conexión y vuelve a intentar.';
    function crear(direccion) {
      initial.community = Object.assign({}, initial.community || {}, { name: (initial.community && initial.community.name) || user });
      if (direccion) initial.cloud = Object.assign({}, initial.cloud || {}, { apiUrl: direccion });
      RF.store.ensureAdminProject(initial);
      var vopts = opts ? Object.assign({}, opts) : undefined; if (vopts) delete vopts.reinicio;
      return V.create(user, password, initial, vopts);
    }
    /* Con direccion del servicio se consulta antes: si la comunidad ya tiene cuenta, este equipo no crea otra.
       Sin direccion no hay como consultar (la app aun no conoce el servicio): la cuenta queda solo en este equipo y se marca.
       Con reinicio no se consulta: el codigo de reinicio supone que la comunidad ya tiene cuenta. */
    var alta = !url || reinicio ? crear(url).then(function (r) { return { r: r, sinComprobar: !url || reinicio }; }) :
      RF.cloud.postRawTo(url, 'challenge', inquilino() ? { inquilino: inquilino() } : {}).catch(function (e) {
        throw Object.assign(new Error(unavailable), { code: (e && e.code) || 'SERVICIO' });
      }).then(function (ch) {
        if (!ch || ch.ok !== true || typeof ch.exists !== 'boolean') throw Object.assign(new Error(unavailable), { code: 'SERVICIO' });
        if (ch.exists) throw Object.assign(new Error('Esta comunidad ya tiene cuenta. Inicia sesión con tu clave.'), { code: 'CUENTA_EXISTENTE' });
        return crear(url).then(function (r) { return { r: r, sinComprobar: false }; });
      });
    return alta.then(function (x) {
      var r = x.r;
      var next = legacy ? V.verifyReadable().then(function (ok) {
        if (!ok) throw new Error('No se pudo comprobar la copia cifrada; no se borró nada.');
        if (V.rawLegacy() !== legacyRaw) throw Object.assign(new Error('La copia sin cifrar de este equipo cambió mientras se creaba la cuenta. No se borró nada; vuelve a intentar.'), { code: 'CAMBIO_LOCAL' });
        return !V.dropLegacy();
      }) : Promise.resolve(false);
      return next.then(function (pendiente) { afterOpen(r.state, true); return { recoveryCode: r.recoveryCode, migrated: !!legacy, sinComprobar: x.sinComprobar, legacyPendiente: pendiente }; });
    });
  }
  function unlock(user, password) { return V.unlock(user, password).then(function (r) { afterOpen(r.state); return r; }); }
  function recover(code, newPassword) {
    /* No prepares la recuperación desde una instantánea cifrada anterior a los últimos cambios.
       En especial, la URL del servicio debe sobrevivir para volver a comprobar su confianza. */
    var saved = RF.store && RF.store.flush ? RF.store.flush() : Promise.resolve();
    return saved.then(function () { return V.prepareRecovery(code, newPassword); }).then(function (prepared) {
      function commit(serverReset, response, accountMissing, serviceTrustBlocked) {
        return V.commitRecovery(prepared).then(function (r) {
          afterOpen(r.state, true);
          if (response) { setToken(response); keepDevice(response); }
          r.serverReset = serverReset;
          r.serverAccountMissing = !!accountMissing;
          r.serviceTrustBlocked = !!serviceTrustBlocked;
          return r;
        }).catch(function (e) {
          if (response) {
            e.code = 'LOCAL_RECOVERY_COMMIT_FAILED_AFTER_REMOTE';
            e.recoveryCode = prepared.result.recoveryCode;
            e.message = 'El servicio sí cambió la cuenta, pero este equipo no pudo guardar la nueva bóveda. No cierres ni recargues esta sesión. Código nuevo: ' + e.recoveryCode + '. Detalle: ' + (e.message || e);
          }
          throw e;
        });
      }
      /* Al estar bloqueada, store.get() devuelve valores vacíos. La URL del servicio no es secreta:
         obténla del estado que acaba de descifrarse y vuelve a validar su confianza antes de enviar nada. */
      var recoveredState = prepared.result && prepared.result.state || {};
      var remoteUrl = String(recoveredState.cloud && recoveredState.cloud.apiUrl || '').trim();
      var hasRemoteUrl = !!remoteUrl;
      var remoteTrusted = hasRemoteUrl && RF.cloud.trustedUrl(remoteUrl);
      if (!remoteTrusted) return commit(null, null, false, hasRemoteUrl);
      /* No consumas el código local hasta que el servicio confirme el restablecimiento. */
      return RF.cloud.postRawTo(remoteUrl, 'challenge', {}).then(function (ch) {
        if (!ch || !ch.ok) throw Object.assign(new Error('El servicio no respondió. La bóveda local no cambió y el código de recuperación sigue vigente.'), { code: 'SERVICIO' });
        if (!ch.exists) return commit(null, null, true);
        checkChallenge(ch);
        return RF.cloud.postRawTo(remoteUrl, 'resetPassword', { user: prepared.user, authKeyR: prepared.result.authKeyR, saltP: prepared.result.saltP, authKey: prepared.result.authKey, recSalt: prepared.result.recSalt2, authKeyR2: prepared.result.authKeyR2 }).then(function (x) {
          if (!x || x.ok !== true) throw Object.assign(new Error('El servicio rechazó el restablecimiento (' + ((x && x.error) || 'sin confirmación') + '). La bóveda local no cambió y el código de recuperación sigue vigente.'), { code: (x && x.error) || 'RESTABLECIMIENTO_RECHAZADO' });
          return commit(true, x, false);
        });
      });
    });
  }
  /* al bloquear no debe quedar nada de la comunidad a la vista: avisos, diálogos abiertos (además dejarían inerte la pantalla de acceso) ni fotos ampliadas */
  function scrub() {
    var d = root.document; if (!d) return;
    Array.prototype.slice.call(d.querySelectorAll('dialog')).forEach(function (x) { try { if (x.close) x.close(); } catch (e) { /* ya cerrado */ } if (x.parentNode) x.parentNode.removeChild(x); });
    var t = d.getElementById('toasts'); if (t) t.textContent = '';
    Array.prototype.slice.call(d.querySelectorAll('.busy')).forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); });
    /* La vista previa de impresión contiene un documento completo en un iframe; debe desaparecer al bloquear. */
    Array.prototype.slice.call(d.querySelectorAll('.print-overlay')).forEach(function (x) { if (x.parentNode) x.parentNode.removeChild(x); });
    Array.prototype.slice.call(d.querySelectorAll('img[src^="blob:"]')).forEach(function (i) { try { root.URL.revokeObjectURL(i.src); } catch (e) { /* nada */ } i.removeAttribute('src'); });
  }
  /* entrada asistida: no hay bóveda que cerrar. Si hay cambios que el servicio todavía no recibió, no se cierra ni se descartan:
     primero se intenta enviarlos; si no se puede, la sesión sigue abierta (el botón «Bloquear ahora» avisa). */
  function pendienteAsistida() { var c = RF.store.get().cloud || {}; return huellaDatos() !== (c.syncFp || asistidaBase); }
  function cerrarAsistida(reason) {
    stopIdle();
    var envio = pendienteAsistida() && RF.drive && RF.drive.syncNow ? RF.drive.syncNow({ force: true }) : null;
    return Promise.resolve(envio).then(function () {
      if (pendienteAsistida()) throw Object.assign(new Error('Hay cambios que el servicio todavía no recibió. La sesión sigue abierta para no perderlos.'), { code: 'CAMBIOS_SIN_GUARDAR' });
      asistida = null; asistidaBase = null; dropToken(); RF.store.detach();
      if (V.isOpen()) V.lock();
      S.reason = reason || ''; scrub(); emit();
    }).catch(function (e) { startIdle(); throw e; });
  }
  function lock(reason) {
    if (asistida) return cerrarAsistida(reason);
    if (!V.isOpen()) return Promise.resolve();
    stopIdle();
    return RF.store.flush().then(function () { V.lock(); RF.store.detach(); S.token = null; S.exp = 0; S.reason = reason || ''; scrub(); emit(); }, function (e) {
      /* No se cierra la bóveda si eso descartaría cambios que no alcanzaron a guardarse. */
      startIdle();
      throw e;
    });
  }
  function wipeDevice() { stopIdle(); V.wipe(); RF.store.detach(); S.token = null; scrub(); return (RF.blobs && RF.blobs.clearAll ? RF.blobs.clearAll() : Promise.resolve()).then(function () { emit(); }); }

  /* ---------- inactividad ---------- */
  function touch() { S.last = Date.now(); }
  function startIdle() {
    if (S.timer) return;
    if (!S.started && root.document) {
      ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) { root.document.addEventListener(ev, touch, { passive: true, capture: true }); });
      S.started = true;
    }
    S.timer = setInterval(function () { if ((V.isOpen() || asistida) && Date.now() - S.last > idleMs()) lock('inactividad').catch(function () { /* el aviso persistente explica por qué no se bloqueó la sesión */ }); }, 10000);
  }
  function stopIdle() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  /* ---------- sesión con el servicio ---------- */
  function token() { return S.token && S.exp > Date.now() + 30000 ? S.token : null; }
  /* credencial de equipo: permite entrar aunque un desconocido haya agotado los intentos; vive solo en los datos cifrados de este equipo */
  function deviceKey() { return cfg().device || ''; }
  function keepDevice(r) { if (r && typeof r.device === 'string' && /^[0-9a-f]{64}$/.test(r.device)) RF.store.update(function (s) { s.cloud.device = r.device; }, { silent: true }); }
  function setToken(r) { S.token = r.token; S.exp = r.exp || (Date.now() + 11 * 3600000); }
  function needsSession(action) { return !PUBLIC[action]; }

  function loginFailureMessage(r) {
    var code = r && r.error;
    if (code === 'BLOQUEADO') {
      return 'Pausa de seguridad: faltan ' + RF.util.waitText(Number(r.retryAfter) || 60) + '. Intentos disponibles ahora: 0.';
    }
    if (code === 'CREDENCIALES_INVALIDAS') {
      var message = 'El nombre o la contraseña de la comunidad no coinciden.';
      var remaining = Number(r.attemptsRemaining), limit = Number(r.attemptsLimit);
      if (Number.isInteger(remaining) && remaining >= 0) {
        message += remaining === 1 ? ' Te queda 1 intento' : ' Te quedan ' + remaining + ' intentos';
        if (Number.isInteger(limit) && limit > 0) message += ' (de ' + limit + ')';
        message += '.';
      }
      return message;
    }
    return 'No se pudo iniciar sesión (' + (code || 'ERROR') + ').';
  }

  /* inicia sesión con el servicio usando la contraseña que ya se escribió al abrir la app */
  function serverLogin(passwordOverride) {
    var pw = passwordOverride || V.password(), user = V.user();
    if (!pw) return Promise.reject(Object.assign(new Error('Bloqueada'), { code: 'BLOQUEADA' }));
    var inq = inquilino();
    var send = function (accion, datos) { return inq ? RF.cloud.postRawTo(serviceUrl(), accion, datos) : RF.cloud.postRaw(accion, datos); };
    return send('challenge', inq ? { inquilino: inq } : {}).then(function (ch) {
      if (!ch || !ch.ok) throw Object.assign(new Error('El servicio no respondió bien.'), { code: 'SERVICIO' });
      if (!ch.exists) throw Object.assign(new Error('El servicio todavía no tiene cuenta.'), { code: 'SIN_CUENTA' });
      checkChallenge(ch);
      var datos = { user: user, authKey: null, device: deviceKey() || undefined, wantDevice: !deviceKey() };
      return C.deriveKeys(pw, ch.saltP, ch.it).then(function (k) {
        datos.authKey = k.authKey;
        return inq ? send('loginInquilino', Object.assign({ inquilino: inq }, datos)) : send('login', datos);
      });
    }).then(function (r) {
      if (r && r.ok) { setToken(r); keepDevice(r); return r.token; }
      var code = (r && r.error) || 'ERROR';
      throw Object.assign(new Error(loginFailureMessage(r)), { code: code === 'CREDENCIALES_INVALIDAS' ? 'CLAVE_DISTINTA' : code, retryAfter: r && r.retryAfter, attemptsRemaining: r && r.attemptsRemaining, attemptsLimit: r && r.attemptsLimit });
    });
  }
  function ensureSession() {
    var t = token(); if (t) return Promise.resolve(t);
    if (!S.inflight) S.inflight = serverLogin().then(function (x) { S.inflight = null; return x; }, function (e) { S.inflight = null; throw e; });
    return S.inflight;
  }
  function dropToken() { S.token = null; S.exp = 0; }

  /* crear la cuenta en el servicio (una vez): pide el código de instalación que puso quien lo desplegó */
  function serverSetup(setupCode) {
    var m = V.meta(), pw = V.password(); if (!pw || !m) return Promise.reject(Object.assign(new Error('Bloqueada'), { code: 'BLOQUEADA' }));
    return Promise.all([V.secrets(), RF.cloud.postRaw('challenge', {})]).then(function (r) {
      var sec = r[0] || {}, ch = r[1];
      if (ch && ch.exists) throw Object.assign(new Error('Esta comunidad ya tiene cuenta en el servicio. Para traer esa cuenta a este equipo, elige «Traer la cuenta del servicio»; los datos de este equipo se reemplazarán por los de esa cuenta.'), { code: 'CUENTA_EXISTENTE' });
      if (!sec.authKeyR) throw Object.assign(new Error('Este equipo no tiene código de recuperación para crear la cuenta del servicio.'), { code: 'SIN_RECUPERACION' });
      return C.deriveKeys(pw, m.saltP, m.it).then(function (k) {
        return RF.cloud.postRaw('setup', { setupCode: setupCode, user: m.user, saltP: m.saltP, authKey: k.authKey, recSalt: sec.recSalt, authKeyR: sec.authKeyR });
      });
    }).then(function (r) {
      if (r && r.ok) { setToken(r); keepDevice(r); return true; }
      throw Object.assign(new Error(r && r.error === 'CODIGO_INVALIDO' ? 'El código de instalación no es correcto.' : r && r.error === 'BLOQUEADO' ? 'Demasiados intentos. Espera un rato.' : 'No se pudo crear la cuenta (' + ((r && r.error) || 'error') + ').'), { code: r && r.error });
    });
  }
  /* nombre y estado de la comunidad de esta dirección (sin RUT): la pantalla de alta lo muestra y decide si activa o entra */
  function infoInquilino() {
    var inq = inquilino();
    if (!inq) return Promise.reject(Object.assign(new Error('Esta dirección no corresponde a una comunidad.'), { code: 'SIN_COMUNIDAD' }));
    return RF.cloud.postRawTo(serviceUrl(), 'infoInquilino', { inquilino: inq });
  }
  /* «Entrar a su cuenta» desde el panel: canjea el ticket (un solo uso, dos minutos), trae la copia del servicio y la muestra en memoria */
  function entrarConTicket(ticket) {
    var inq = inquilino(), central = serviceUrl();
    return RF.cloud.postRawTo(central, 'canjearTicket', { inquilino: inq, ticket: ticket }).then(function (r) {
      if (!r || r.ok !== true) throw Object.assign(new Error('El acceso ya se usó o venció. Pide otro al Organismo.'), { code: (r && r.error) || 'TICKET_INVALIDO' });
      setToken(r);
      return RF.cloud.postRawTo(central, 'loadState', { t: r.token }).then(function (st) {
        if (!st || st.ok !== true) throw Object.assign(new Error('La comunidad todavía no tiene datos guardados en el servicio.'), { code: (st && st.error) || 'SIN_COPIA' });
        var state = RF.util.safeParse(st.state);
        if (!state || typeof state !== 'object' || !Array.isArray(state.projects)) throw Object.assign(new Error('La copia del servicio no es válida.'), { code: 'ESTADO_INVALIDO' });
        state.cloud = Object.assign({}, state.cloud || {}, { apiUrl: central, rev: st.rev || 0, inquilino: inq });
        delete state.cloud.device; delete state.cloud.base; delete state.cloud.syncFp;
        RF.store.ensureAdminProject(state);
        asistida = { inquilino: inq, por: 'organismo' };
        /* la copia vive solo en memoria: no se guarda en este equipo; lo que cambie lo envía la sincronización (36-drive.js) */
        RF.store.attach(state, function () { return Promise.resolve(true); });
        asistidaBase = huellaDatos();
        touch(); startIdle();
        emit();
        return true;
      });
    });
  }
  function esAsistida() { return asistida; }
  /* activar la cuenta de la comunidad con el RUT y el código que entregó el Organismo (una vez; el código vence a los 30 días).
     opts.reinicio: código de reinicio de una comunidad que ya tiene cuenta; no se consulta si existe (el servicio sabe qué tipo de código es) */
  function serverActivate(rut, codigo, opts) {
    var inq = inquilino(), m = V.meta(), pw = V.password(), reinicio = !!(opts && opts.reinicio);
    if (!inq) return Promise.reject(Object.assign(new Error('Esta dirección no corresponde a una comunidad.'), { code: 'SIN_COMUNIDAD' }));
    if (!pw || !m) return Promise.reject(Object.assign(new Error('Bloqueada'), { code: 'BLOQUEADA' }));
    var central = serviceUrl();
    return Promise.all([V.secrets(), reinicio ? null : RF.cloud.postRawTo(central, 'challenge', { inquilino: inq })]).then(function (r) {
      var sec = r[0] || {}, ch = r[1];
      if (ch && ch.exists) throw Object.assign(new Error('Esta comunidad ya tiene cuenta. Inicia sesión con tu clave.'), { code: 'CUENTA_EXISTENTE' });
      if (!sec.authKeyR) throw Object.assign(new Error('Este equipo no tiene código de recuperación para activar la cuenta.'), { code: 'SIN_RECUPERACION' });
      return C.deriveKeys(pw, m.saltP, m.it).then(function (k) {
        return RF.cloud.postRawTo(central, 'activar', { inquilino: inq, rut: rut, codigo: codigo, saltP: m.saltP, authKey: k.authKey, recSalt: sec.recSalt, authKeyR: sec.authKeyR });
      });
    }).then(function (r) {
      if (r && r.ok) { setToken(r); keepDevice(r); RF.store.update(function (s) { s.cloud.inquilino = inq; s.cloud.apiUrl = central; }, { silent: true }); return true; }
      var msg = r && r.error === 'CODIGO_INVALIDO' ? 'El RUT o el código no coinciden, o el código venció. Pide a tu Organismo un código nuevo.'
        : r && r.error === 'BLOQUEADO' ? 'Demasiados intentos. Espera un rato.' : 'No se pudo activar la cuenta (' + ((r && r.error) || 'error') + ').';
      throw Object.assign(new Error(msg), { code: r && r.error });
    });
  }
  /* equipo nuevo: entra con la dirección del servicio y la contraseña, trae los datos y crea la bóveda de este equipo */
  /* quita las fotos locales de la copia anterior; devuelve true si no se pudieron quitar (la bóveda nueva ya está guardada) */
  function clearBlobs() {
    return Promise.resolve().then(function () { return RF.blobs && RF.blobs.clearAll ? RF.blobs.clearAll() : null; }).then(function () { return false; }, function () { return true; });
  }
  function connectDevice(url, user, password) {
    var problems = C.passwordProblems(password, user);
    /* lo que había en este equipo al empezar: si cambia durante la descarga, no se escribe encima */
    var antes = { meta: V.rawMeta(), legacy: V.rawLegacy() };
    var inq = inquilino();
    return RF.cloud.postRawTo(url, 'challenge', inq ? { inquilino: inq } : {}).then(function (ch) {
      if (!ch || ch.ok !== true || typeof ch.exists !== 'boolean') throw Object.assign(new Error('No se pudo comprobar la cuenta del servicio. No se creó nada.'), { code: 'SERVICIO' });
      if (!ch.exists) throw Object.assign(new Error('Ese servicio todavía no tiene una cuenta creada.'), { code: 'SIN_CUENTA' });
      checkChallenge(ch);
      return C.deriveKeys(password, ch.saltP, ch.it).then(function (k) {
        var datos = { user: user, authKey: k.authKey, wantDevice: true };
        return inq ? RF.cloud.postRawTo(url, 'loginInquilino', Object.assign({ inquilino: inq }, datos)) : RF.cloud.postRawTo(url, 'login', datos);
      });
    }).then(function (r) {
      if (!r || !r.ok) throw Object.assign(new Error(loginFailureMessage(r)), { code: r && r.error, retryAfter: r && r.retryAfter, attemptsRemaining: r && r.attemptsRemaining, attemptsLimit: r && r.attemptsLimit });
      return RF.cloud.postRawTo(url, 'loadState', { t: r.token }).then(function (st) {
        if (!st || st.ok !== true) throw Object.assign(new Error(st && st.error === 'SIN_COPIA' ? 'La cuenta existe, pero todavía no hay una copia de sus datos en el servicio. Pide guardar la copia desde el equipo original y vuelve a entrar. No se creó nada.' : 'No se pudo descargar la copia del servicio. No se creó nada; vuelve a intentar.'), { code: (st && st.error) || 'SERVICIO' });
        var state;
        try { state = RF.util.safeParse(st.state); } catch (e) { throw Object.assign(new Error('La copia del servicio contiene datos inválidos. No se creó nada.'), { code: 'ESTADO_INVALIDO' }); }
        if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.projects)) throw Object.assign(new Error('La copia del servicio contiene datos inválidos. No se creó nada.'), { code: 'ESTADO_INVALIDO' });
        state.cloud = Object.assign({}, state.cloud || {}, { apiUrl: url, rev: st.rev || 0 }); delete state.cloud.device; delete state.cloud.base; delete state.cloud.syncFp; if (typeof r.device === 'string' && /^[0-9a-f]{64}$/.test(r.device)) state.cloud.device = r.device; state.community = Object.assign({}, state.community || {}, { name: (state.community && state.community.name) || user });
        RF.store.ensureAdminProject(state);
        /* la bóveda de la cuenta del servicio reemplaza la de este equipo en una sola escritura; si algo falla antes, nada cambia */
        /* la bóveda nueva reemplaza la de este equipo y quita la copia sin cifrar en la misma operación, solo si nada cambió desde el principio */
        return V.create(user, password, state, { noRecovery: true, replace: true, expectRaw: antes.meta, expectLegacy: antes.legacy, skipPolicy: !problems.length ? false : true }).then(function (creada) {
          return clearBlobs().then(function (fotosPendientes) {
            setToken(r); afterOpen(state);
            return { rev: st.rev, copiaLocal: !!(antes.meta || antes.legacy), fotosPendientes: fotosPendientes, legacyPendiente: creada.legacyPendiente };
          });
        });
      });
    });
  }
  function serverChangePassword(oldPw, newPw) {
    /* igual que serverLogin: con varias comunidades el servidor busca la cuenta por inquilino */
    var inq = inquilino();
    return RF.cloud.postRaw('challenge', inq ? { inquilino: inq } : {}).then(function (ch) {
      if (!ch || !ch.exists) return null;
      checkChallenge(ch);
      return C.deriveKeys(oldPw, ch.saltP, ch.it).then(function (ko) {
        var saltP = C.b64(C.rand(16));
        return C.deriveKeys(newPw, saltP, C.ITERATIONS).then(function (kn) {
          return ensureSession().then(function (t) { return RF.cloud.postRaw('changePassword', { t: t, authKeyOld: ko.authKey, saltP: saltP, authKey: kn.authKey }); });
        });
      });
    }).then(function (r) { if (r && !r.ok) throw Object.assign(new Error('El servicio no aceptó el cambio (' + r.error + ').'), { code: r.error }); return r; });
  }
  /* Evita que una falla de red deje la bóveda local usando una clave que el servicio no aceptó. */
  function changePassword(oldPw, newPw) {
    /* Serializa primero los cambios pendientes del estado cifrado. Si el KDF y el guardado
       escriben metadata a la vez, uno puede pisar el otro y perder, por ejemplo, la URL. */
    var saved = RF.store && RF.store.flush ? RF.store.flush() : Promise.resolve();
    if (pendingLocalPasswordChange) {
      if (pendingLocalPasswordChange.oldPw !== oldPw || pendingLocalPasswordChange.newPw !== newPw) return Promise.reject(Object.assign(new Error('El servicio ya cambió la contraseña, pero falta guardarla en este equipo. Repite los mismos valores para completar ese paso.'), { code: 'CAMBIO_LOCAL_PENDIENTE' }));
      return saved.then(function () { return V.changePassword(oldPw, newPw); }).then(function (local) {
        pendingLocalPasswordChange = null;
        return Object.assign({}, local, { remoteConfigured: true, remoteChanged: true, remoteAccountMissing: false });
      });
    }
    return saved.then(function () {
      var configured = RF.cloud.configured();
      var trustBlocked = !!cfg().apiUrl && !configured;
      var remote = configured ? serverChangePassword(oldPw, newPw).then(function (r) {
        return { configured: true, changed: !!(r && r.ok), accountMissing: !r };
      }) : Promise.resolve({ configured: false, changed: false, accountMissing: false, trustBlocked: trustBlocked });
      return remote.then(function (status) {
        return V.changePassword(oldPw, newPw).then(function (local) {
          return Object.assign({}, local, { remoteConfigured: status.configured, remoteChanged: status.changed, remoteAccountMissing: status.accountMissing, remoteTrustBlocked: !!status.trustBlocked });
        }, function (e) {
          if (status.changed) {
            pendingLocalPasswordChange = { oldPw: oldPw, newPw: newPw };
            e.remoteChanged = true;
            e.code = 'LOCAL_CHANGE_FAILED_AFTER_REMOTE';
            e.message = 'El servicio sí cambió la contraseña, pero este equipo no pudo guardar la nueva. No cierres ni recargues esta sesión; vuelve a intentar el cambio local. Detalle: ' + (e.message || e);
          }
          throw e;
        });
      });
    });
  }
  function logoutServer(all) {
    var t = token();
    if (!t) return all ? Promise.reject(Object.assign(new Error('No hay una sesión activa para cerrar desde este equipo.'), { code: 'SIN_SESION' })) : Promise.resolve({ ok: true, skipped: true });
    return RF.cloud.postRaw(all ? 'logoutAll' : 'logout', { t: t }).then(function (r) {
      if (!r || r.ok !== true) throw Object.assign(new Error('El servicio no confirmó el cierre de las sesiones.'), { code: (r && r.error) || 'CIERRE_NO_CONFIRMADO' });
      if (all) { dropToken(); RF.store.update(function (s) { delete s.cloud.device; }, { silent: true }); }
      return r;
    });
  }

  RF.auth = { reason: function () { return S.reason || ''; }, init: init, phase: phase, onChange: onChange, createAccount: createAccount, unlock: unlock, recover: recover, lock: lock, wipeDevice: wipeDevice, touch: touch,
    token: token, needsSession: needsSession, ensureSession: ensureSession, dropToken: dropToken, serverLogin: serverLogin, serverSetup: serverSetup, serverActivate: serverActivate, infoInquilino: infoInquilino, inquilino: inquilino, entrarConTicket: entrarConTicket, esAsistida: esAsistida, connectDevice: connectDevice,
    serverChangePassword: serverChangePassword, changePassword: changePassword, logoutServer: logoutServer, setToken: setToken };
})(typeof window !== 'undefined' ? window : globalThis);
