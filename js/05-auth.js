/* Rinde Fácil — sesión de la comunidad: contraseña al iniciar, bloqueo por inactividad y sesión con el servicio (token que vence).
 *
 * La contraseña abre los datos cifrados del equipo; el servicio confirma el alta antes de habilitar el trabajo.
 * El token del servicio vive solo en memoria: al recargar la página se pide la contraseña otra vez. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var C = RF.crypto, V = RF.vault;
  var S = { token: null, exp: 0, inflight: null, timer: null, last: Date.now(), listeners: [], started: false, insecure: false };
  var pendingLocalPasswordChange = null;
  var pendingRecoveryCommit = null;
  var PUBLIC = { ping: 1, challenge: 1, setup: 1, login: 1, resetPassword: 1, requestPasswordReset: 1, loginInquilino: 1, activarCorreo: 1, comunidadesPublicas: 1, infoInquilino: 1, canjearTicket: 1 };

  function normalizeEmail(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ''); }
  function activationPasswordProblem(password) {
    return C.passwordProblems(password, '')[0] || '';
  }

  function emit() { S.listeners.slice().forEach(function (f) { try { f(phase()); } catch (e) { /* un aviso que falla no debe frenar a los demás */ } }); }
  /* un servicio falso podría pedir pocas vueltas de PBKDF2 para adivinar la contraseña sin conexión: se exige el mínimo de la app */
  function checkChallenge(ch) {
    var saltOk = false;
    try { saltOk = !!ch && typeof ch.saltP === 'string' && ch.saltP.length <= 88 && /^[A-Za-z0-9+/]+={0,2}$/.test(ch.saltP) && C.ub64(ch.saltP).length >= 16; } catch (e) { /* sal inválida */ }
    if (!saltOk || !(Number(ch.it) >= C.ITERATIONS)) throw Object.assign(new Error('El servicio propone una protección más débil de la permitida. No se envió nada.'), { code: 'SERVICIO_DEBIL' });
  }
  /* entrada asistida del Organismo: la copia vive en memoria y se guarda en el servicio con la sesión asistida (sin bóveda de la comunidad) */
  var asistida = null, googleSession = false;
  /* huella de la copia tal como llegó del servicio: sin cambios desde entonces no hay nada que enviar al cerrar */
  var asistidaBase = null;
  /* misma huella que la sincronización (36-drive.js, syncFingerprint): dice si los datos cambiaron desde la última copia enviada */
  function huellaDatos(st) { st = st || RF.store.get(); return RF.store.fingerprint({ community: st.community, holidays: st.holidays, events: st.events, activity: st.activity, signatures: st.signatures, repo: st.repo, projects: st.projects, peaRespaldos: st.peaRespaldos }); }
  function phase() {
    if (S.insecure) return 'insecure';
    if (V.rawLegacy && V.rawLegacy()) { if (!S.migrationBlocked) { unlinked(); S.migrationBlocked = true; } return 'legacy'; }
    var ph = asistida ? (token() ? 'open' : 'locked') : googleSession ? 'open' : V.status();
    var route = RF.organismo && RF.organismo.inquilinoDeHost ? RF.organismo.inquilinoDeHost() : null;
    if (ph === 'open' && !asistida && (!serviceReady(cfg()) || (route && cfg().inquilino !== route))) return 'locked';
    return ph;
  } /* none | legacy | locked | open */
  function onChange(f) { S.listeners.push(f); }
  function cfg() { return RF.store.get().cloud || {}; }
  /* comunidad de la ruta o la cuenta autenticada/activada; la pantalla pública sólo preselecciona por ruta */
  function inquilino() { var d = RF.organismo && RF.organismo.inquilinoDeHost ? RF.organismo.inquilinoDeHost() : null; return d || cfg().inquilino || null; }
  /* en una comunidad nueva aún no hay dirección guardada: se usa el servicio central aprobado */
  function serviceUrl() { return cfg().apiUrl || (RF.cloud.approvedUrls()[0] || ''); }
  function trusted(url) { return !!(url && RF.cloud.trustedUrl && RF.cloud.trustedUrl(url)); }
  function binding(c) { return String(c.apiUrl || '').replace(/\/+$/, '') + '|' + String(c.inquilino || ''); }
  function serviceReady(c) { return !!(c && c.serviceReady === true && c.serviceBinding === binding(c) && c.inquilino && trusted(c.apiUrl) && c.rev >= 1); }
  function unlinked() {
    var message = 'Este equipo tiene datos sin vincular. La entrada está bloqueada hasta definir cómo incorporarlos al servicio. No se borró nada.';
    S.reason = message;
    try { root.localStorage.setItem('rf_sync_block', JSON.stringify({ reason: 'DATOS_SIN_VINCULAR', at: new Date().toISOString() })); } catch (e) { /* el bloqueo no depende del registro */ }
    return Object.assign(new Error(message), { code: 'DATOS_LOCALES' });
  }
  function incomplete(part) { return Object.assign(new Error('El alta no está completa: falta confirmar ' + part + ' en el servicio. No puedes empezar a trabajar; vuelve a ingresar para completarla.'), { code: 'ALTA_INCOMPLETA', part: part }); }
  function finishActivation() {
    return confirmService(!!cfg().activationPending).catch(function (e) {
      if (e.part !== 'la carpeta' || !RF.googleComunidad) throw e;
      return RF.googleComunidad.connectDrive().then(function () { return confirmService(!!cfg().activationPending); });
    });
  }
  // La confirmación cifrada permite trabajar sin red, sin depender de la vigencia del token.
  function confirmService(firstCopy) {
    var url = serviceUrl(), t = token();
    if (!trusted(url) || !cfg().inquilino || !t) return Promise.reject(incomplete('la cuenta'));
    return RF.cloud.postRawTo(url, 'estadoDriveComunidad', { t: t }).then(function (r) {
      if (!r || !r.ok || r.cuenta !== true) throw incomplete('la cuenta');
      if (!r.ready) throw incomplete('la carpeta');
      return RF.cloud.postRawTo(url, 'loadState', { t: t });
    }).then(function (r) {
      if (r && !r.ok && r.error === 'SIN_COPIA' && firstCopy) return RF.cloud.postRawTo(url, 'saveState', { t: t, state: RF.store.exportJSON(), baseRev: 0, force: false });
      return r;
    }).then(function (r) {
      if (!r || !r.ok || !(r.rev >= 1)) throw incomplete('la primera copia');
      var initial = !cfg().rev;
      if (initial && r.state) {
        var remote = RF.util.safeParse(r.state);
        if (!remote || !Array.isArray(remote.projects)) throw incomplete('una copia válida');
        remote.cloud = Object.assign({}, remote.cloud || {}, cfg(), { rev: r.rev });
        RF.store.attach(remote, V.save);
      }
      RF.store.update(function (s) {
        s.cloud.serviceReady = true; if (!s.cloud.rev) s.cloud.rev = r.rev;
        s.cloud.serviceBinding = binding(s.cloud);
        delete s.cloud.activationPending;
        if (initial) { s.cloud.syncFp = huellaDatos(s); s.cloud.base = RF.store.snapshotBase(s); }
      }, { silent: true, noSync: true });
      return RF.store.flush().then(function () { S.reason = ''; emit(); return true; });
    }).catch(function (e) { S.reason = e.message; throw e; });
  }
  function idleMs() { var m = Number((RF.store.get().ui || {}).idleMinutes); return (isFinite(m) && m >= 1 ? m : 15) * 60000; }

  function init() {
    RF.store.useVault();
    if (!C.available()) S.insecure = true;
    if (V.rawLegacy()) unlinked();
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
  /* Prepara una bóveda de alta; sigue bloqueada hasta confirmar cuenta, carpeta y copia.
     opts.reinicio: la comunidad ya tiene cuenta y se activa con un código de reinicio; no se comprueba que la cuenta no exista (el servicio sabe qué tipo de código es) */
  function createAccount(user, password, opts) {
    var loginUser = user;
    var reinicio = !!(opts && opts.reinicio);
    var porCorreo = !!(opts && opts.activacionCorreo);
    if (porCorreo) {
      var problem = activationPasswordProblem(password);
      if (problem) return Promise.reject(Object.assign(new Error(problem), { code: 'POLITICA' }));
      user = normalizeEmail(user);
      loginUser = user;
      // La identidad de ingreso queda dentro del estado cifrado. Los metadatos sólo llevan un identificador local.
      user = 'cuenta-' + Array.from(C.rand(16)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    var initial = RF.store.defaults();
    /* El alta rechazada puede eliminar su bóveda nueva: nunca debe incluir ni quitar una copia anterior del equipo. */
    if (V.rawLegacy()) return Promise.reject(unlinked());
    if (V.meta()) return Promise.reject(Object.assign(new Error('Ya hay una cuenta en este equipo. Entra con ella; no se creó otra.'), { code: 'YA_EXISTE' }));
    var urls = RF.cloud.approvedUrls(), url = String((initial.cloud && initial.cloud.apiUrl) || cfg().apiUrl || (urls.length === 1 ? urls[0] : '')).trim();
    if (!trusted(url)) return Promise.reject(incomplete('un servicio aprobado'));
    var unavailable = 'No se pudo comprobar si esta comunidad ya tiene cuenta. No se creó nada. Revisa la conexión y vuelve a intentar.';
    function crear(direccion) {
      initial.community = Object.assign({}, initial.community || {}, { name: (initial.community && initial.community.name) || user });
      if (direccion) initial.cloud = Object.assign({}, initial.cloud || {}, { apiUrl: direccion });
      if (porCorreo) initial.cloud = Object.assign({}, initial.cloud || {}, { loginUser: loginUser });
      initial.cloud = Object.assign({}, initial.cloud || {}, { activationPending: true });
      RF.store.ensureAdminProject(initial);
      var vopts = opts ? Object.assign({}, opts) : undefined;
      if (vopts) { delete vopts.reinicio; delete vopts.activacionCorreo; }
      if (vopts) delete vopts.skipPolicy; // el alta y la bóveda aplican la misma política
      return V.create(user, password, initial, vopts);
    }
    /* El alta por correo se confirma en serverActivateCorreo. La bóveda provisional
       no habilita trabajo ni adopta datos anteriores. */
    var alta = reinicio || porCorreo ? crear(url).then(function (r) { return { r: r, sinComprobar: !url || reinicio }; }) :
      RF.cloud.postRawTo(url, 'challenge', inquilino() ? { inquilino: inquilino() } : {}).catch(function (e) {
        throw Object.assign(new Error(unavailable), { code: (e && e.code) || 'SERVICIO' });
      }).then(function (ch) {
        if (!ch || ch.ok !== true || typeof ch.exists !== 'boolean') throw Object.assign(new Error(unavailable), { code: 'SERVICIO' });
        if (ch.exists) throw Object.assign(new Error('Esta comunidad ya tiene cuenta. Inicia sesión con tu clave.'), { code: 'CUENTA_EXISTENTE' });
        return crear(url).then(function (r) { return { r: r, sinComprobar: false }; });
      });
    return alta.then(function (x) {
      var r = x.r;
      afterOpen(r.state, true);
      return { recoveryCode: r.recoveryCode, migrated: false, sinComprobar: x.sinComprobar, legacyPendiente: false };
    });
  }
  function unlock(user, password) {
    if (V.rawLegacy()) return Promise.reject(unlinked());
    return V.unlock(user, password).then(function (r) {
      var route = RF.organismo && RF.organismo.inquilinoDeHost ? RF.organismo.inquilinoDeHost() : null;
      var c = r.state.cloud || {};
      if (!c.inquilino || !trusted(c.apiUrl)) { V.lock(); throw unlinked(); }
      if (route && route !== c.inquilino) { V.lock(); throw incomplete('la comunidad de esta dirección'); }
      if (serviceReady(c)) { afterOpen(r.state); return r; }
      // En una ruta de comunidad la clave local no sustituye la validación del servicio.
      dropToken(); RF.store.attach(r.state, V.save);
      return serverLogin().then(finishActivation).then(function () { afterOpen(RF.store.get()); return r; }, function (e) {
        V.lock(); RF.store.detach(); dropToken(); emit(); throw e;
      });
    });
  }
  function requestRecovery(tenant) {
    var url = serviceUrl();
    if (!tenant || !RF.cloud.trustedUrl(url)) return Promise.reject(Object.assign(new Error('Indica tu comunidad y usa un servicio aprobado.'), { code: 'SERVICIO' }));
    return RF.cloud.postRawTo(url, 'requestPasswordReset', { inquilino: tenant }).then(function (r) {
      if (!r || r.ok !== true) throw Object.assign(new Error(r && r.error === 'LIMITE_REENVIOS' ? 'Esta comunidad alcanzó los tres envíos por hora. Espera antes de pedir otro.' : 'No se pudo enviar el código. Revisa el identificador y la conexión.'), { code: (r && r.error) || 'SERVICIO' });
      return { ok: true };
    });
  }
  function recover(code, newPassword, emailRecovery) {
    if (pendingRecoveryCommit) return Promise.reject(Object.assign(new Error('El servicio ya cambió la cuenta. Reintenta guardar la recuperación en este equipo.'), { code: 'LOCAL_RECOVERY_COMMIT_FAILED_AFTER_REMOTE' }));
    /* No prepares la recuperación desde una instantánea cifrada anterior a los últimos cambios.
       En especial, la URL del servicio debe sobrevivir para volver a comprobar su confianza. */
    var saved = RF.store && RF.store.flush ? RF.store.flush() : Promise.resolve();
    return saved.then(function () { return V.prepareRecovery(code, newPassword); }).then(function (prepared) {
      function commit(serverReset, response, accountMissing, serviceTrustBlocked) {
        return V.commitRecovery(prepared).then(function (r) {
          pendingRecoveryCommit = null;
          afterOpen(r.state, true);
          if (response) { setToken(response); keepDevice(response); }
          r.serverReset = serverReset;
          r.serverAccountMissing = !!accountMissing;
          r.serviceTrustBlocked = !!serviceTrustBlocked;
          return r;
        }).catch(function (e) {
          if (response) {
            pendingRecoveryCommit = function () { return commit(serverReset, response, accountMissing, serviceTrustBlocked); };
            e.code = 'LOCAL_RECOVERY_COMMIT_FAILED_AFTER_REMOTE';
            e.message = 'El servicio sí cambió la cuenta, pero este equipo no pudo guardar la nueva bóveda. No cierres ni recargues esta sesión. Reintenta el guardado local.';
          }
          throw e;
        });
      }
      /* Al estar bloqueada, store.get() devuelve valores vacíos. La URL del servicio no es secreta:
         obténla del estado que acaba de descifrarse y vuelve a validar su confianza antes de enviar nada. */
      var recoveredState = prepared.result && prepared.result.state || {};
      var remoteConfig = recoveredState.cloud || {};
      var tenant = remoteConfig.inquilino || null;
      if (emailRecovery && emailRecovery.inquilino !== tenant) throw Object.assign(new Error('El identificador no coincide con la bóveda de este equipo. No se cambió nada.'), { code: 'COMUNIDAD_DISTINTA' });
      if (tenant && (!emailRecovery || !/^\d{6}$/.test(emailRecovery.codigo || ''))) throw Object.assign(new Error('Escribe el código de seis dígitos recibido por correo.'), { code: 'CODIGO_INVALIDO' });
      var remoteUrl = String(recoveredState.cloud && recoveredState.cloud.apiUrl || '').trim();
      var remoteTrusted = !!remoteUrl && RF.cloud.trustedUrl(remoteUrl);
      if (!remoteTrusted) {
        throw Object.assign(new Error('El servicio de esta comunidad no está aprobado. No se cambió nada.'), { code: 'SERVICIO' });
      }
      if (!tenant) throw unlinked();
      /* No consumas el código local hasta que el servicio confirme el restablecimiento. */
      // Los parámetros ya proceden de la bóveda descifrada. challenge anónimo no informa si existe cuenta.
      var payload = { user: remoteConfig.loginUser || prepared.user, authKeyR: prepared.result.authKeyR, saltP: prepared.result.saltP, authKey: prepared.result.authKey, recSalt: prepared.result.recSalt2, authKeyR2: prepared.result.authKeyR2 };
      if (tenant) { payload.inquilino = tenant; payload.codigo = emailRecovery.codigo; }
      return RF.cloud.postRawTo(remoteUrl, 'resetPassword', payload).then(function (x) {
        if (!x || x.ok !== true) {
          var allowed = ['CODIGO_INVALIDO', 'CREDENCIALES_INVALIDAS', 'DATOS_INVALIDOS', 'OCUPADO', 'ERROR_INTERNO', 'INQUILINO_REQUERIDO'];
          var errorCode = x && allowed.indexOf(x.error) >= 0 ? x.error : 'RESTABLECIMIENTO_RECHAZADO';
          throw Object.assign(new Error(errorCode === 'CODIGO_INVALIDO' ? 'El código del correo no es válido, venció o agotó los cinco intentos. Solicita otro. La bóveda local no cambió.' : 'El servicio rechazó el restablecimiento. La bóveda local no cambió y el código de recuperación local sigue vigente.'), { code: errorCode });
        }
        return commit(true, x, false);
      }, function () {
        throw Object.assign(new Error('No se pudo confirmar el restablecimiento. La bóveda local no cambió. Revisa la conexión antes de volver a intentar.'), { code: 'RESTABLECIMIENTO_NO_CONFIRMADO' });
      });
    });
  }
  function retryRecoveryCommit() {
    if (!pendingRecoveryCommit) return Promise.reject(new Error('No hay una recuperación pendiente de guardar.'));
    return pendingRecoveryCommit();
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
  function flushLocalWrites() { return RF.localPersistence ? RF.localPersistence.flush() : Promise.resolve(); }
  function cerrarAsistida(reason) {
    stopIdle();
    if (googleSession) return RF.store.flush().then(flushLocalWrites).then(function () {
      RF.googleDevice.close(); googleSession = false; asistidaBase = null;
      dropToken(); RF.store.detach(); S.reason = reason || ''; scrub(); emit();
    }).catch(function (e) { startIdle(); throw e; });
    var envio = pendienteAsistida() && RF.drive && RF.drive.syncNow ? RF.drive.syncNow({ force: true }) : null;
    return Promise.resolve(envio).then(function () {
      if (pendienteAsistida()) throw Object.assign(new Error('Hay cambios que el servicio todavía no recibió. La sesión sigue abierta para no perderlos.'), { code: 'CAMBIOS_SIN_GUARDAR' });
      if (RF.blobs && RF.blobs.clearTransient) RF.blobs.clearTransient();
      asistida = null; googleSession = false; asistidaBase = null; dropToken(); RF.store.detach();
      if (V.isOpen()) V.lock();
      S.reason = reason || ''; scrub(); emit();
    }).catch(function (e) { startIdle(); throw e; });
  }
  function lock(reason) {
    if (asistida || googleSession) return cerrarAsistida(reason);
    if (!V.isOpen()) return Promise.resolve();
    stopIdle();
    return RF.store.flush().then(flushLocalWrites).then(function () { V.lock(); RF.store.detach(); S.token = null; S.exp = 0; S.reason = reason || ''; scrub(); emit(); }, function (e) {
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
    S.timer = setInterval(function () { if ((V.isOpen() || asistida || googleSession) && Date.now() - S.last > idleMs()) lock('inactividad').catch(function () { /* el aviso persistente explica por qué no se bloqueó la sesión */ }); }, 10000);
  }
  function stopIdle() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }

  /* ---------- sesión con el servicio ---------- */
  function token() { return S.token && S.exp > Date.now() + 30000 ? S.token : null; }
  /* credencial de equipo: permite entrar aunque un desconocido haya agotado los intentos; vive solo en los datos cifrados de este equipo */
  function deviceKey() { return cfg().device || ''; }
  function keepDevice(r) { if (r && typeof r.device === 'string' && /^[0-9a-f]{64}$/.test(r.device)) RF.store.update(function (s) { s.cloud.device = r.device; }, { silent: true }); }
  function setToken(r) {
    if (S.expiryTimer) clearTimeout(S.expiryTimer);
    S.token = r.token; S.exp = r.exp || (Date.now() + 11 * 3600000);
    var expected = S.token, exp = S.exp;
    S.expiryTimer = setTimeout(function () {
      if (S.token === expected && S.exp === exp) emit();
    }, Math.max(0, exp - Date.now() - 30000));
  }
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
    var pw = passwordOverride || V.password(), user = cfg().loginUser || V.user();
    if (!pw) return Promise.reject(Object.assign(new Error('Bloqueada'), { code: 'BLOQUEADA' }));
    var inq = inquilino();
    var send = function (accion, datos) { return inq ? RF.cloud.postRawTo(serviceUrl(), accion, datos) : RF.cloud.postRaw(accion, datos); };
    return send(inq ? 'loginInquilino' : 'login', Object.assign({ preparar: true, user: user }, inq ? { inquilino: inq } : {})).then(function (ch) {
      if (!ch || !ch.ok) throw Object.assign(new Error('El servicio no respondió bien.'), { code: 'SERVICIO' });
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
    if (googleSession) return Promise.reject(Object.assign(new Error('La sesión venció. Vuelve a ingresar con Google.'), { code: 'SESION_INVALIDA' }));
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
      throw Object.assign(new Error(r && r.error === 'CUENTA_EXISTENTE' ? 'Esta comunidad ya tiene cuenta en el servicio. Elige «Traer la cuenta del servicio» para recuperar sus datos.' : r && r.error === 'CODIGO_INVALIDO' ? 'El código de instalación no es correcto.' : r && r.error === 'BLOQUEADO' ? 'Demasiados intentos. Espera un rato.' : 'No se pudo crear la cuenta (' + ((r && r.error) || 'error') + ').'), { code: r && r.error });
    });
  }
  /* nombre y estado de la comunidad de esta dirección (sin RUT): la pantalla de alta lo muestra y decide si activa o entra */
  function infoInquilino() {
    var inq = inquilino();
    if (!inq) return Promise.reject(Object.assign(new Error('Esta dirección no corresponde a una comunidad.'), { code: 'SIN_COMUNIDAD' }));
    return RF.cloud.postRawTo(serviceUrl(), 'infoInquilino', { inquilino: inq });
  }
  function comunidadesPublicas() { return RF.cloud.postRawTo(serviceUrl(), 'comunidadesPublicas', {}); }
  /* El servicio resuelve la comunidad por correo. Nunca se manda la contraseña ni se consulta la cuenta antes del alta. */
  function serverActivateCorreo(correo, codigo) {
    var m = V.meta(), pw = V.password(), central = serviceUrl();
    if (!pw || !m) return Promise.reject(Object.assign(new Error('Abre la cuenta de este equipo para completar la activación.'), { code: 'BLOQUEADA' }));
    if (token() && cfg().inquilino) return finishActivation();
    return V.secrets().then(function (sec) {
      if (!sec || !sec.authKeyR) throw Object.assign(new Error('No se pudo preparar la recuperación de la cuenta.'), { code: 'SIN_RECUPERACION' });
      return C.deriveKeys(pw, m.saltP, m.it).then(function (k) {
        return RF.cloud.postRawTo(central, 'activarCorreo', { correo: normalizeEmail(correo), codigo: codigo, saltP: m.saltP, authKey: k.authKey, recSalt: sec.recSalt, authKeyR: sec.authKeyR });
      });
    }).then(function (r) {
      if (!r || r.ok !== true) {
        var code = r && r.error;
        var message = code === 'CUENTA_EXISTENTE' ? 'Esta comunidad ya tiene cuenta. Inicia sesión con tu clave.'
          : code === 'CODIGO_INVALIDO' ? 'El correo o el código no coinciden, o el código venció. Revisa los datos o pide un código nuevo.'
            : code === 'BLOQUEADO' ? 'Demasiados intentos. Espera un rato.' : 'No se pudo crear la cuenta. Vuelve a intentarlo.';
        throw Object.assign(new Error(message), { code: code, retryAfter: r && r.retryAfter });
      }
      if (!r.inquilino || !r.token) throw new Error('No se pudo confirmar la activación.');
      setToken(r); keepDevice(r);
      RF.store.update(function (s) { s.cloud.inquilino = r.inquilino; s.cloud.apiUrl = central; }, { silent: true });
      return RF.store.flush().then(finishActivation);
    });
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
        if (RF.blobs && RF.blobs.clearTransient) RF.blobs.clearTransient();
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
  function openGoogleAccount(session, state, url, rev) {
    if (!session || !session.token || !session.inquilino) throw new Error('SESION_INVALIDA');
    if (V.rawLegacy() || (V.meta() && !V.meta().serviceLinked)) return Promise.reject(unlinked());
    if (!trusted(url) || !(rev >= 1)) return Promise.reject(incomplete('la primera copia'));
    // Guardar la sesión anterior antes de abrir el almacén de Google.
    var previous = V.isOpen() || googleSession ? RF.store.flush().then(flushLocalWrites) : Promise.resolve();
    state.cloud = { apiUrl: url, inquilino: session.inquilino, rev: rev, autoSave: true, serviceReady: true };
    state.cloud.serviceBinding = binding(state.cloud);
    RF.store.ensureAdminProject(state);
    state.cloud.syncFp = huellaDatos(state); state.cloud.base = RF.store.snapshotBase(state);
    return previous.then(function () {
      if (V.isOpen()) V.lock();
      return RF.googleDevice.open(url, session.inquilino, state);
    }).then(function (saved) {
      asistida = null; googleSession = true; setToken(session);
      RF.store.attach(saved, RF.googleDevice.save);
      asistidaBase = huellaDatos();
      touch(); startIdle(); emit();
      return true;
    });
  }
  /* equipo nuevo: entra con la dirección del servicio y la contraseña, trae los datos y crea la bóveda de este equipo */
  function connectDevice(url, user, password, communityId) {
    if (V.rawLegacy() || (V.meta() && !V.meta().serviceLinked)) return Promise.reject(unlinked());
    if (!trusted(url)) return Promise.reject(Object.assign(new Error('El servicio no está aprobado. No se cambió nada.'), { code: 'SERVICIO_NO_APROBADO' }));
    if (String(user).indexOf('@') >= 0) user = normalizeEmail(user);
    var problems = C.passwordProblems(password, user);
    if (problems.length) return Promise.reject(Object.assign(new Error(problems[0]), { code: 'POLITICA', problems: problems }));
    if (V.meta()) return unlock(V.meta().user, password).then(function () {
      if (cfg().apiUrl !== url || (communityId && cfg().inquilino !== communityId)) return lock().then(function () { throw incomplete('la comunidad de este equipo'); });
      return { rev: cfg().rev, copiaLocal: true };
    });
    /* lo que había en este equipo al empezar: si cambia durante la descarga, no se escribe encima */
    var antes = { meta: V.rawMeta(), legacy: V.rawLegacy() };
    /* El backend actual exige inquilino para challenge y loginInquilino; el correo es el usuario verificado. */
    var inq = communityId || inquilino();
    return RF.cloud.postRawTo(url, inq ? 'loginInquilino' : 'login', Object.assign({ preparar: true, user: user }, inq ? { inquilino: inq } : {})).then(function (ch) {
      if (!ch || ch.ok !== true || typeof ch.saltP !== 'string') throw Object.assign(new Error('No se pudo comprobar la cuenta del servicio. No se creó nada.'), { code: 'SERVICIO' });
      checkChallenge(ch);
      return C.deriveKeys(password, ch.saltP, ch.it).then(function (k) {
        var datos = { user: user, authKey: k.authKey, wantDevice: true };
        return inq ? RF.cloud.postRawTo(url, 'loginInquilino', Object.assign({ inquilino: inq }, datos)) : RF.cloud.postRawTo(url, 'login', datos);
      });
    }).then(function (r) {
      if (!r || !r.ok) throw Object.assign(new Error(loginFailureMessage(r)), { code: r && r.error, retryAfter: r && r.retryAfter, attemptsRemaining: r && r.attemptsRemaining, attemptsLimit: r && r.attemptsLimit });
      return RF.cloud.postRawTo(url, 'estadoDriveComunidad', { t: r.token }).then(function (status) {
        if (!status || !status.ok || status.cuenta !== true || !status.ready) throw incomplete('la cuenta y su carpeta');
        return RF.cloud.postRawTo(url, 'loadState', { t: r.token });
      }).then(function (st) {
        if (!st || st.ok !== true) throw Object.assign(new Error(st && st.error === 'SIN_COPIA' ? 'La cuenta existe, pero todavía no hay una copia de sus datos en el servicio. Pide guardar la copia desde el equipo original y vuelve a entrar. No se creó nada.' : 'No se pudo descargar la copia del servicio. No se creó nada; vuelve a intentar.'), { code: (st && st.error) || 'SERVICIO' });
        var state;
        try { state = RF.util.safeParse(st.state); } catch (e) { throw Object.assign(new Error('La copia del servicio contiene datos inválidos. No se creó nada.'), { code: 'ESTADO_INVALIDO' }); }
        if (!state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.projects)) throw Object.assign(new Error('La copia del servicio contiene datos inválidos. No se creó nada.'), { code: 'ESTADO_INVALIDO' });
        if (!(st.rev >= 1) || !(inq || r.inquilino)) throw incomplete('la comunidad y su primera copia');
        state.cloud = Object.assign({}, state.cloud || {}, { apiUrl: url, rev: st.rev, inquilino: inq || r.inquilino, serviceReady: true }); delete state.cloud.device; delete state.cloud.base; delete state.cloud.syncFp; if (typeof r.device === 'string' && /^[0-9a-f]{64}$/.test(r.device)) state.cloud.device = r.device;
        state.cloud.serviceBinding = binding(state.cloud);
        var localUser = user.indexOf('@') >= 0 ? (inq || 'cuenta-' + C.b64(C.rand(16))) : user;
        if (user.indexOf('@') >= 0) state.cloud.loginUser = user;
        var communityName = state.community && state.community.name;
        state.community = Object.assign({}, state.community || {}, { name: communityName && communityName.indexOf('@') < 0 ? communityName : localUser });
        RF.store.ensureAdminProject(state);
        // Sólo un equipo vacío llega aquí. Una carrera con otra pestaña cancela la escritura.
        return V.create(localUser, password, state, { noRecovery: true, replace: true, expectRaw: antes.meta, expectLegacy: antes.legacy }).then(function (creada) {
          setToken(r); afterOpen(state);
          return { rev: st.rev, copiaLocal: false, fotosPendientes: false, legacyPendiente: creada.legacyPendiente };
        });
      });
    });
  }
  function serverChangePassword(oldPw, newPw) {
    /* igual que serverLogin: con varias comunidades el servidor busca la cuenta por inquilino */
    var inq = inquilino();
    return ensureSession().then(function (t) { return RF.cloud.postRaw('challenge', Object.assign({ t: t }, inq ? { inquilino: inq } : {})); }).then(function (ch) {
      if (!ch || !ch.exists) throw incomplete('la cuenta');
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
    var problems = C.passwordProblems(newPw, '');
    if (problems.length) return Promise.reject(Object.assign(new Error(problems[0]), { code: 'POLITICA', problems: problems }));
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
      if (!configured || !cfg().inquilino) throw incomplete('un servicio y una comunidad');
      var remote = serverChangePassword(oldPw, newPw).then(function (r) {
        if (!r || !r.ok) throw incomplete('el cambio de clave');
        return { configured: true, changed: !!(r && r.ok), accountMissing: !r };
      });
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
    token: token, needsSession: needsSession, ensureSession: ensureSession, dropToken: dropToken, serverLogin: serverLogin, serverSetup: serverSetup, infoInquilino: infoInquilino, inquilino: inquilino, entrarConTicket: entrarConTicket, esAsistida: esAsistida, connectDevice: connectDevice,
    serverChangePassword: serverChangePassword, changePassword: changePassword, logoutServer: logoutServer, setToken: setToken,
    comunidadesPublicas: comunidadesPublicas, requestRecovery: requestRecovery, retryRecoveryCommit: retryRecoveryCommit, serverActivateCorreo: serverActivateCorreo, activationPasswordProblem: activationPasswordProblem,
    openGoogleAccount: openGoogleAccount, confirmService: confirmService, esGoogle: function () { return googleSession; }, blockUnlinked: unlinked };
})(typeof window !== 'undefined' ? window : globalThis);
