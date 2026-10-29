/* Rinde Fácil — pantallas de la cuenta: crear cuenta, entrar, recuperar contraseña, equipo nuevo y la herramienta «Seguridad». */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var U = RF.util, UI = RF.ui, h = U.h, C = RF.crypto, A = RF.auth, V = RF.vault;
  var TOOLS = RF.tools = RF.tools || {};

  /* ---------- piezas ---------- */
  function passField(label, opts) {
    opts = opts || {};
    var input = h('input', { type: 'password', autocomplete: opts.autocomplete || 'current-password', required: opts.required !== false, id: opts.id || null, 'aria-describedby': opts.describedby || null, spellcheck: 'false', autocapitalize: 'off' });
    var eye = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'Mostrar u ocultar la contraseña', onclick: function () { input.type = input.type === 'password' ? 'text' : 'password'; } }, UI.icon('eye', 16));
    return { input: input, node: h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), h('div', { class: 'pw-row' }, input, eye), opts.hint ? h('span', { class: 'hint' }, opts.hint) : null) };
  }
  function textField(label, opts) {
    opts = opts || {};
    var input = h('input', { type: 'text', autocomplete: opts.autocomplete || 'username', required: true, spellcheck: 'false', value: opts.value || '', id: opts.id || null });
    return { input: input, node: h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, opts.hint ? h('span', { class: 'hint' }, opts.hint) : null) };
  }
  function shell(title, lead, kids) {
    return h('main', { class: 'auth-wrap', id: 'main' }, h('div', { class: 'auth-card' }, h('div', { class: 'brand auth-brand' }, 'Rinde Fácil'), h('h1', { class: 'auth-title' }, title), lead ? h('p', { class: 'lead' }, lead) : null, kids));
  }
  function work(promise, label) {
    var b = UI.busy(label || 'Abriendo…', [{ id: 'k', label: 'Verificando la contraseña. Puede tardar unos segundos…', from: 0, to: 90, tau: 2 }]);
    return promise.then(function (r) { b.done('Listo'); return r; }, function (e) { b.fail(e && e.message ? e.message : 'No se pudo'); throw e; });
  }
  function errBox() { return h('div', { class: 'auth-err', role: 'alert' }); }
  /* si el error trae una espera (retryAfter del servicio o seconds de la bóveda), el aviso cuenta hacia atrás cada segundo */
  var tickers = new WeakMap();
  function showErr(box, msg, e) {
    if (tickers.has(box)) { clearInterval(tickers.get(box)); tickers.delete(box); }
    U.clear(box); if (!msg) return;
    var total = e && Number(e.retryAfter || e.seconds);
    if (!(total > 0)) { box.appendChild(UI.callout('bad', '', msg)); return; }
    var end = Date.now() + total * 1000, node = UI.callout('bad', '', ''), span = node;
    node.setAttribute('role', 'timer');
    function paint() {
      var left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) { span.textContent = 'Ya pasó la espera. Puedes intentarlo de nuevo.'; clearInterval(id); tickers.delete(box); return; }
      span.textContent = 'Pausa de seguridad: faltan ' + U.waitText(left) + ' para volver a intentar.';
    }
    var id = setInterval(function () { if (!node.isConnected) { clearInterval(id); tickers.delete(box); return; } paint(); }, 1000);
    tickers.set(box, id); box.appendChild(node); paint();
  }
  function passwordChecklist(passwordInput, communityInput, id) {
    var list = h('ul', { class: 'pw-hints', id: id, 'aria-label': 'Requisitos de la contraseña' }), parts = [];
    function communityName() { return communityInput && communityInput.value !== undefined ? communityInput.value : (communityInput || ''); }
    function update() {
      C.passwordChecks(passwordInput.value, communityName()).forEach(function (check, i) {
        var part = parts[i];
        part.row.className = 'pw-check ' + (check.valid ? 'is-met' : 'is-missing');
        part.row.textContent = check.label;
        part.row.setAttribute('aria-label', check.label + (check.valid ? ': cumplido' : ': pendiente'));
      });
    }
    C.passwordChecks('', '').forEach(function (check) {
      var row = h('li', { class: 'pw-check is-missing' }, check.label);
      parts.push({ row: row });
      list.appendChild(row);
    });
    passwordInput.addEventListener('input', update);
    if (communityInput && communityInput.addEventListener) communityInput.addEventListener('input', update);
    update();
    return { node: list, update: update };
  }
  function passwordConfirmation(passwordInput, confirmation, id) {
    var feedback = h('span', { class: 'pw-match', id: id, 'aria-live': 'polite' });
    var attempted = false;
    function update() {
      var typed = confirmation.input.value.length > 0;
      var matches = typed && passwordInput.value === confirmation.input.value;
      feedback.className = 'pw-match' + (typed || attempted ? (matches ? ' is-met' : ' is-missing') : '');
      feedback.textContent = !typed ? 'Vuelve a escribir tu contraseña.' : matches ? 'Las contraseñas coinciden.' : 'Las contraseñas todavía no coinciden.';
      confirmation.input.setAttribute('aria-invalid', (typed || attempted) && !matches ? 'true' : 'false');
    }
    function validate() {
      attempted = true; update();
      if (!confirmation.input.value || passwordInput.value !== confirmation.input.value) { confirmation.input.focus(); return false; }
      return true;
    }
    confirmation.node.appendChild(feedback);
    passwordInput.addEventListener('input', update);
    confirmation.input.addEventListener('input', update);
    update();
    return { update: update, validate: validate, reset: function () { attempted = false; update(); } };
  }

  /* ---------- código de recuperación ---------- */
  function recoveryScreen(code, then, warning) {
    var ok = h('input', { type: 'checkbox', id: 'recok' });
    var go = UI.btn('Continuar', { cls: 'primary big', onclick: function () { then(); } }); go.disabled = true;
    ok.addEventListener('change', function () { go.disabled = !ok.checked; });
    return shell('Guarda tu código de recuperación', 'Si algún día olvidas la contraseña, este código es la única forma de abrir los datos de este equipo. Anótalo en papel y guárdalo en un lugar seguro. No lo compartas por WhatsApp ni lo saques en foto.', [
      warning ? UI.callout('warn', 'El servicio sigue con la contraseña anterior', warning) : null,
      h('div', { class: 'recovery-code', 'aria-label': 'Código de recuperación' }, code),
      h('div', { class: 'row-actions' }, UI.btn('Copiar', { icon: 'copy', cls: 'ghost', onclick: function () { U.copyText(code).then(function (okc) { UI.toast(okc ? 'Código copiado.' : 'No se pudo copiar; anótalo a mano.', okc ? 'ok' : 'bad'); }); } }),
        UI.btn('Imprimir', { icon: 'pdf', cls: 'ghost', onclick: function () { RF.exp.printDoc({ title: 'Código de recuperación de Rinde Fácil', subtitle: (V.user() || ''), blocks: [{ t: 'p', text: 'Guárdalo en un lugar seguro. Quien tenga este código puede abrir los datos de la comunidad.' }, { t: 'kv', rows: [['Código', code]] }], footer: 'Generado el ' + U.fmtDate(U.todayISO()) + '.' }); } })),
      h('label', { class: 'check', for: 'recok' }, ok, h('span', null, 'Ya guardé mi código en un lugar seguro')), go]);
  }

  /* Un fallo de transporte conserva la bóveda recién creada para reintentar la misma alta. */
  var RECHAZO_ALTA = /^(CODIGO_INVALIDO|DATOS_INVALIDOS|BLOQUEADO|INQUILINO_INEXISTENTE)$/;
  var MENSAJE_SIN_RESPUESTA = 'No se pudo confirmar la activación: el servicio no respondió o se cortó la conexión. No se borró nada de este equipo; vuelve a intentarlo con el mismo código y la misma contraseña. Si te dice que la comunidad ya tiene cuenta, usa «Entrar con mi clave».';
  var MENSAJE_PUDO_GUARDARSE = 'El correo o el código no coinciden, o el código venció. La activación anterior pudo guardarse antes de que se cortara la conexión: no se borró nada de este equipo. Entra con tu clave para comprobarlo.';
  var LEAD_CUENTA_EXISTENTE = 'Esta comunidad ya tiene cuenta. Entra con tu correo y clave para traer sus datos a este equipo.';
  function activationMessage(e) {
    if (e && e.pudoGuardarse) return MENSAJE_PUDO_GUARDARSE;
    if (e && e.code === 'CODIGO_INVALIDO') return 'El correo o el código no coinciden, o el código venció. Revisa los datos o pide un código nuevo.';
    if (e && e.code === 'CUENTA_EXISTENTE') return LEAD_CUENTA_EXISTENTE;
    if (e && (e.code === 'DATOS_LOCALES' || e.code === 'YA_EXISTE')) return 'Este equipo ya tiene datos guardados. Conserva su respaldo e inicia sesión, o activa desde otro navegador sin datos.';
    if (e && e.code === 'BLOQUEADO') return 'Demasiados intentos. Espera un rato.';
    return e && e.code ? 'No se pudo crear la cuenta. Vuelve a intentarlo.' : MENSAJE_SIN_RESPUESTA;
  }
  function emailField() {
    var field = textField('Correo registrado', { id: 'auth-email' });
    field.input.type = 'email'; field.input.setAttribute('type', 'email');
    field.input.setAttribute('autocapitalize', 'off');
    return field;
  }
  function normalizedEmail(input) { return input.value.trim().toLowerCase().replace(/\s+/g, ''); }
  function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

  /* ---------- activar por correo (o proteger los datos antiguos) ---------- */
  function createScreen(legacy, onDone) {
    var name = legacy ? textField('Nombre de la comunidad', { value: (legacy.community && legacy.community.name) || '' }) : emailField();
    var code = legacy ? null : textField('Código de primer ingreso', { autocomplete: 'one-time-code', hint: 'Te lo entrega el Organismo Colaborador. Sirve una sola vez y vence a los 30 días.' });
    var p1 = passField('Nueva clave', { autocomplete: 'new-password', describedby: legacy ? 'create-password-requirements' : null, hint: legacy ? C.passwordChecks('', '').map(function (check) { return check.label; }).join('. ') + '.' : 'Mínimo 8 caracteres, una mayúscula (A-Z, Á, É, Í, Ó, Ú, Ñ) y un número (0-9).' });
    var p2 = passField('Confirmar clave', { autocomplete: 'new-password', required: false, describedby: 'create-password-match' });
    var match = passwordConfirmation(p1.input, p2, 'create-password-match');
    var legacyHints = legacy ? passwordChecklist(p1.input, name.input, 'create-password-requirements') : null;
    var err = errBox(), pendiente = null, sinRespuesta = false, enviando = false, accountExists = false, pendingEmail = '';
    var title = h('span', null, legacy ? 'Protege los datos de tu comunidad' : 'Activar tu comunidad');
    var lead = h('span', null, legacy ? 'Protege los datos de este equipo con una contraseña.' : 'Escribe el correo registrado, el Código de primer ingreso y elige tu clave definitiva.');
    function irAEntrarConClave() {
      if (enviando) return;
      A.lock('manual').then(function () { A.goto('device'); }, function () { showErr(err, 'No se pudieron guardar los cambios de este equipo. Vuelve a intentarlo.'); });
    }
    function mostrarCuentaExistente() {
      accountExists = true; p1.input.value = p2.input.value = '';
      title.textContent = 'Inicia sesión con tu comunidad'; lead.textContent = LEAD_CUENTA_EXISTENTE;
      U.clear(form); form.appendChild(err);
      form.appendChild(h('button', { type: 'button', class: 'btn primary big', onclick: irAEntrarConClave }, 'Entrar con mi clave'));
    }
    function activar(r) {
      return A.serverActivateCorreo(pendingEmail, code.input.value.trim()).then(function () { pendiente = null; sinRespuesta = false; return r; }, function (e) {
        var codigo = e && e.code;
        if (codigo === 'CUENTA_EXISTENTE' && sinRespuesta) throw e;
        if (codigo === 'CODIGO_INVALIDO' && sinRespuesta) throw Object.assign(new Error(MENSAJE_PUDO_GUARDARSE), { code: codigo, pudoGuardarse: true });
        if (RECHAZO_ALTA.test(codigo || '') || codigo === 'CUENTA_EXISTENTE') {
          pendiente = null; sinRespuesta = false;
          return A.wipeDevice().then(function () { throw e; }, function () { throw e; });
        }
        if (!codigo) sinRespuesta = true;
        throw e;
      });
    }
    var form = h('form', { class: 'auth-form', novalidate: true, onsubmit: function (ev) {
      ev.preventDefault(); showErr(err, '');
      if (enviando) return;
      if (accountExists) return showErr(err, LEAD_CUENTA_EXISTENTE);
      var user = legacy ? name.input.value.trim() : normalizedEmail(name.input);
      if (legacy ? user.length < 3 : !validEmail(user)) return showErr(err, legacy ? 'Escribe el nombre de la comunidad.' : 'Escribe un correo válido.');
      var problem = legacy ? C.passwordProblems(p1.input.value, user)[0] : A.activationPasswordProblem(p1.input.value);
      if (problem) return showErr(err, problem);
      if (!match.validate()) return;
      if (!legacy && !code.input.value.trim()) return showErr(err, 'Escribe el Código de primer ingreso.');
      if (pendiente && (p1.input.value !== V.password() || user !== pendingEmail)) return showErr(err, 'Escribe la misma contraseña y el mismo correo que usaste al principio para completar esta activación.');
      enviando = true;
      var todo = legacy ? A.createAccount(user, p1.input.value) : pendiente ? activar(pendiente) : A.createAccount(user, p1.input.value, { activacionCorreo: true }).then(function (r) {
        pendiente = r; pendingEmail = user; return activar(r);
      });
      /* Ni la barra de progreso ni los avisos reflejan mensajes remotos o errores de transporte con datos ingresados. */
      todo = todo.catch(function (e) { throw Object.assign(new Error(legacy ? 'No se pudieron proteger los datos de este equipo.' : activationMessage(e)), { code: e && e.code, pudoGuardarse: e && e.pudoGuardarse }); });
      work(todo, legacy ? 'Protegiendo los datos…' : 'Activando tu comunidad…').then(function (r) {
        enviando = false; name.input.value = ''; if (code) code.input.value = ''; p1.input.value = p2.input.value = '';
        onDone(r);
      }).catch(function (e) {
        enviando = false;
        if (e.code === 'CUENTA_EXISTENTE' || e.pudoGuardarse) mostrarCuentaExistente();
        showErr(err, e.message);
      });
    } }, name.node, code ? code.node : null, p1.node, legacyHints ? legacyHints.node : null, p2.node, err, h('button', { type: 'submit', class: 'btn primary big' }, legacy ? 'Proteger mis datos' : 'Activar mi comunidad'));
    return shell(title, lead, [form, h('button', { type: 'button', class: 'linklike', onclick: irAEntrarConClave }, 'Iniciar sesión')]);
  }

  /* ---------- lista pública y entrada por correo ---------- */
  function communityListScreen() {
    var list = h('div', { 'aria-live': 'polite' }), err = errBox();
    function load() {
      U.clear(list); showErr(err, ''); list.appendChild(h('p', null, 'Cargando comunidades…'));
      Promise.resolve().then(function () { return A.comunidadesPublicas(); }).then(function (r) {
        if (!r || r.ok !== true || !Array.isArray(r.comunidades)) throw new Error('SERVICIO');
        U.clear(list);
        if (!r.comunidades.length) list.appendChild(h('p', null, 'No hay comunidades disponibles por ahora.'));
        r.comunidades.forEach(function (c) {
          if (!c || typeof c.id !== 'string' || typeof c.nombre !== 'string') return;
          list.appendChild(h('button', { type: 'button', class: 'btn big', onclick: function () {
            if (RF.organismo && RF.organismo.urlComunidad) root.location.assign(RF.organismo.urlComunidad(c.id));
            else A.goto('login', { id: c.id, nombre: c.nombre });
          } }, c.nombre));
        });
      }).catch(function () {
        U.clear(list); showErr(err, 'No se pudo cargar la lista de comunidades. Revisa la conexión y vuelve a intentarlo.');
        list.appendChild(h('button', { type: 'button', class: 'btn', onclick: load }, 'Reintentar'));
      });
    }
    load();
    var google = h('button', { type: 'button', class: 'btn organismo-entrada', onclick: function () {
      if (google.disabled) return;
      showErr(err, '');
      if (!RF.googleOrganismo || !RF.organismo || !RF.organismo.entrarConGoogle) return showErr(err, 'El ingreso con Google todavía no está configurado.');
      google.disabled = true;
      RF.organismo.entrarConGoogle(approvedList()[0]).then(function () { RF.app.render(); }).catch(function (e) { showErr(err, e.message); })
        .finally(function () { google.disabled = false; });
    } }, 'Entrar como Organismo Colaborador');
    var screen = shell('Elige tu comunidad', 'Selecciona el nombre de tu comunidad para ingresar.', [list, err, google,
      !approvedList().length ? h('p', { class: 'hint' }, 'Esta versión no tiene un servicio aprobado. Pide configurar el servicio de tu comunidad.') : null,
      h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('activar'); } }, 'Tengo un código de primer ingreso')]);
    screen.className += ' organismo-acceso';
    return screen;
  }
  function communityLoginScreen(community) {
    var email = emailField(), pw = passField('Clave'), err = errBox(), sending = false;
    var google = h('button', { type: 'button', class: 'btn big', onclick: function () {
      if (sending) return;
      if (!RF.googleComunidad) return showErr(err, 'El ingreso con Google está pendiente de configuración. Puedes entrar con tu clave.');
      sending = true; google.disabled = true; showErr(err, '');
      RF.googleComunidad.enter(community.id).then(function () { view = null; arg = null; RF.app.render(); }).catch(function () {
        showErr(err, RF.googleComunidad.configured() ? 'No se pudo ingresar con Google. Revisa la cuenta elegida, los permisos y la conexión.' : 'El ingreso con Google está pendiente de configuración. Puedes entrar con tu clave.');
      }).finally(function () { sending = false; google.disabled = false; });
    } }, 'Entrar con Google');
    var form = h('form', { class: 'auth-form', novalidate: true, onsubmit: function (ev) {
      ev.preventDefault(); showErr(err, '');
      if (sending) return;
      var user = normalizedEmail(email.input);
      if (!validEmail(user)) return showErr(err, 'Escribe un correo válido.');
      if (!pw.input.value) return showErr(err, 'Escribe tu clave.');
      if (!approvedList().length) return showErr(err, 'Esta versión no tiene un servicio aprobado. Pide configurar el servicio de tu comunidad.');
      sending = true;
      work(A.connectDevice(approvedList()[0], user, pw.input.value, community.id).catch(function () {
        throw new Error('No se pudo ingresar. Revisa el correo, la clave y la conexión, o espera si agotaste los intentos.');
      }), 'Ingresando…').then(function (r) {
        sending = false; email.input.value = pw.input.value = ''; view = null; arg = null;
        if (RF.googleComunidad) RF.googleComunidad.offerSetup();
        if (r && r.copiaLocal) UI.toast('Los datos anteriores de este equipo se reemplazaron por los de la cuenta del servicio.', 'ok');
        if (r && r.fotosPendientes) UI.toast('No se pudieron quitar las fotos anteriores de este equipo.', 'bad');
        if (r && r.legacyPendiente) UI.toast('No se pudo quitar una copia antigua sin cifrar de este navegador.', 'bad');
      }).catch(function (e) { sending = false; showErr(err, e.message); pw.input.value = ''; });
    } }, email.node, pw.node, err, h('button', { type: 'submit', class: 'btn primary big' }, 'Ingresar'));
    return shell(community.nombre, 'Ingresa con tu correo registrado y tu clave.', [
      V.meta() || (V.legacyState && V.legacyState()) ? h('p', { class: 'hint' }, 'Al traer la cuenta del servicio se reemplazarán los datos de este equipo y sus fotos locales. Respalda antes los cambios que no guardaste en el servicio.') : null,
      form, google, h('p', { class: 'hint' }, 'Con Google autorizas crear la carpeta «Rinde Fácil» en tu Drive y compartirla con edición con el Organismo. Usa la cuenta registrada de tu comunidad. Los cambios se guardan en el servicio; mantén esta pestaña abierta hasta confirmar el guardado.'),
      h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('recover', { id: community.id }); } }, 'Olvidé mi contraseña'),
      h('button', { type: 'button', class: 'linklike', onclick: function () {
        if (RF.organismo && RF.organismo.inquilinoDeHost() && !/(^|\.)localhost$/.test(root.location.hostname || '')) root.location.assign('/');
        else A.goto('device');
      } }, 'Elegir otra comunidad'),
      h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('activar'); } }, 'Tengo un código de primer ingreso')]);
  }

  /* ---------- entrar ---------- */
  /* dirección del servicio aprobada para esta publicación */
  function approvedList() { return RF.cloud && RF.cloud.approvedUrls ? RF.cloud.approvedUrls() : []; }
  /* device = true: equipo nuevo; entra con el nombre de usuario y la contraseña que están en el servicio y trae los datos a este equipo */
  function lockScreen(reason, device) {
    var m = V.meta() || {};
    var name = textField('Comunidad', { value: device ? '' : (m.display || '') });
    var pw = passField('Contraseña');
    var err = errBox();
    /* sin servicio aprobado no hay de dónde traer la cuenta: se dice antes de pedir la contraseña, no después */
    var sinServicio = device && !approvedList().length;
    var form = h('form', { class: 'auth-form', onsubmit: function (ev) {
      ev.preventDefault(); showErr(err, '');
      if (sinServicio) return showErr(err, 'Esta versión no tiene un servicio aprobado para traer la cuenta desde otro equipo. Pide configurar el servicio de tu comunidad y vuelve a entrar.');
      var job = device ? A.connectDevice(approvedList()[0], name.input.value, pw.input.value) : A.unlock(name.input.value, pw.input.value);
      work(job, device ? 'Conectando…' : 'Abriendo…').then(function (r) { if (r && r.fotosPendientes) UI.toast('No se pudieron quitar las fotos anteriores de este equipo. No se pueden abrir con la cuenta nueva.', 'bad'); if (r && r.legacyPendiente) UI.toast('No se pudo quitar una copia antigua sin cifrar de este navegador. Avisa a quien te apoya.', 'bad'); }).catch(function (e) { showErr(err, device && RF.cloud && RF.cloud.humanError ? RF.cloud.humanError(e) : e.message, e); pw.input.value = ''; pw.input.focus(); });
    } }, name.node, pw.node, err, h('button', { type: 'submit', class: 'btn primary big' }, 'Entrar'));
    setTimeout(function () { (name.input.value ? pw.input : name.input).focus(); }, 30);
    if (!device) return shell('Entra a Rinde Fácil', reason === 'inactividad' ? 'La sesión se cerró porque estuvo un rato sin usarse. Tus datos siguen guardados.' : 'Escribe el nombre de tu comunidad y tu contraseña.',
      [form, h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('recover'); } }, 'Olvidé mi contraseña'),
        h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('device'); } }, 'Traer la cuenta del servicio a este equipo'),
        h('p', { class: 'hint' }, 'Si tu comunidad ya tiene cuenta en el servicio, usa «Traer la cuenta del servicio» con el mismo usuario y clave. Los cambios de este equipo se conservan cifrados hasta sincronizarlos.')]);
    return shell('Inicia sesión', 'Usa el nombre de tu comunidad y la contraseña que tenías en el otro equipo.',
      [sinServicio ? h('p', { class: 'hint' }, 'Esta versión no tiene un servicio aprobado para traer tu cuenta. Pide configurar el servicio de tu comunidad; no crees otra cuenta.') : null,
        device && (V.meta() || (V.legacyState && V.legacyState())) ? h('p', { class: 'hint' }, 'Este equipo ya tiene datos. Si están vinculados, se conservan al ingresar. Si están sin vincular, la entrada queda bloqueada sin borrar nada.') : null,
        form,
        !V.meta() ? h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto(''); } }, 'Crear la cuenta de tu comunidad en este equipo') : null]);
  }

  /* ---------- recuperar ---------- */
  function recoverScreen() {
    var route = RF.organismo && RF.organismo.inquilinoDeHost ? RF.organismo.inquilinoDeHost() : '';
    var tenant = textField('Identificador de la comunidad', { id: 'recover-tenant', value: (arg && arg.id) || route || '', hint: 'El mismo identificador que usas para ingresar al servicio.' });
    tenant.input.required = false;
    var code = textField('Código de recuperación local', { id: 'recover-local-code', autocomplete: 'off', hint: 'Los 26 caracteres que guardaste al crear la cuenta. Usa el navegador que conserva tu almacén cifrado.' });
    var emailCode = textField('Código recibido por correo', { autocomplete: 'one-time-code' });
    emailCode.input.setAttribute('inputmode', 'numeric'); emailCode.input.setAttribute('maxlength', '6'); emailCode.input.required = false;
    var meta = V.meta() || {}, reqId = 'recover-password-requirements';
    var communityName = meta.display || meta.user || '';
    var p1 = passField('Contraseña nueva', { autocomplete: 'new-password', describedby: reqId });
    var p2 = passField('Repite la contraseña nueva', { autocomplete: 'new-password', required: false, describedby: 'recover-password-match' });
    var matchHint = passwordConfirmation(p1.input, p2, 'recover-password-match');
    var hints = passwordChecklist(p1.input, communityName, reqId);
    var err = errBox(), notice = h('p', { role: 'status', 'aria-live': 'polite' }), sending = false;
    var send = h('button', { type: 'button', class: 'btn', onclick: function () {
      if (sending) return;
      var id = tenant.input.value.trim().toLowerCase();
      if (!id) return showErr(err, 'Indica el identificador de tu comunidad.');
      sending = true; send.disabled = true; showErr(err, '');
      A.requestRecovery(id).then(function () { notice.textContent = 'Código enviado al correo registrado. Vence en 15 minutos; tienes cinco intentos. Puedes pedir hasta tres códigos por hora.'; }, function (e) { showErr(err, e.message); }).finally(function () { sending = false; send.disabled = false; });
    } }, 'Enviar código por correo');
    var form = h('form', { class: 'auth-form', onsubmit: function (ev) {
      ev.preventDefault(); showErr(err, '');
      if (sending) return;
      var problems = C.passwordProblems(p1.input.value, communityName); if (problems.length) return showErr(err, problems[0]);
      if (!matchHint.validate()) return;
      var id = tenant.input.value.trim().toLowerCase();
      if (id && !/^\d{6}$/.test(emailCode.input.value.trim())) return showErr(err, 'Escribe el código de seis dígitos recibido por correo.');
      sending = true;
      work(A.recover(code.input.value, p1.input.value, id ? { inquilino: id, codigo: emailCode.input.value.trim() } : undefined), 'Recuperando…').then(function (r) {
        var warning = r.serviceTrustBlocked ? 'La bóveda de este equipo se recuperó, pero la dirección guardada del servicio no está aprobada en esta versión. No se envió el código ni se modificó el acceso remoto. Pide verificar y aprobar la dirección antes de conectar.'
          : r.serverReset === false ? 'La bóveda de este equipo ya cambió y se generó el código nuevo que aparece abajo, pero el servicio remoto no confirmó el restablecimiento. El Drive todavía puede exigir la contraseña anterior. No borres esta sesión ni pierdas el código; vuelve a intentar cuando el servicio esté disponible.'
          : r.serverAccountMissing ? 'La recuperación cambió la bóveda de este equipo, pero el servicio conectado todavía no tiene una cuenta creada. El código de abajo sirve para este equipo; no se modificó ningún acceso remoto.' : '';
        A.goto('recovery', { code: r.recoveryCode, warning: warning });
      }).catch(function (e) {
        showErr(err, e.message, e);
        if (e && e.code === 'LOCAL_RECOVERY_COMMIT_FAILED_AFTER_REMOTE') {
          var retry = h('button', { type: 'button', class: 'btn', onclick: function () {
            if (sending) return;
            sending = true;
            work(A.retryRecoveryCommit(), 'Guardando recuperación…').then(function (r) { A.goto('recovery', { code: r.recoveryCode }); }, function (error) { showErr(err, error.message); err.appendChild(retry); }).finally(function () { sending = false; });
          } }, 'Reintentar guardado local');
          err.appendChild(retry);
        }
      }).finally(function () { sending = false; });
    } }, tenant.node, send, notice, emailCode.node, code.node, p1.node, hints.node, p2.node, err, h('button', { type: 'submit', class: 'btn primary big' }, 'Cambiar contraseña'));
    return shell('Recuperar el acceso', 'Pide el código por correo y usa tu código de recuperación local para conservar tus datos al cambiar la clave.', [!V.meta() ? h('p', { class: 'hint' }, 'Este navegador no tiene un almacén local. Para recuperar sus datos, usa el equipo que lo conserva. El Organismo puede ayudarte a reiniciar la cuenta.') : null, form, h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('lock'); } }, 'Volver')]);
  }

  function insecureScreen() {
    return shell('Abre Rinde Fácil desde una dirección segura', 'Este navegador no permite proteger los datos con contraseña cuando la página no es https. Abre la dirección oficial de Rinde Fácil (empieza con https://).', null);
  }

  /* ---------- qué pantalla toca ---------- */
  var view = null, arg = null, activationNode = null;
  function screen(phase) {
    if (phase === 'insecure') return insecureScreen();
    if (phase === 'legacy') return shell('Datos sin vincular', 'Este equipo tiene datos sin vincular. La entrada está bloqueada hasta definir cómo incorporarlos al servicio. No se borró nada.', []);
    if (phase === 'locked' && V.meta() && !['device', 'recover', 'activar', 'reinicio', 'login'].includes(view)) return lockScreen(A.reason());
    if (view === 'recovery') {
      var recovery = arg && typeof arg === 'object' ? arg : { code: arg, warning: '' };
      return recoveryScreen(recovery.code, function () { view = null; arg = null; A.touch(); RF.app.render(); if (RF.googleComunidad) RF.googleComunidad.offerSetup(); }, recovery.warning);
    }
    if (view === 'recover') return recoverScreen();
    if (view === 'login' && arg) return communityLoginScreen(arg);
    if (view === 'activar' || view === 'reinicio') {
      if (!activationNode) activationNode = createScreen(null, activationDone);
      return activationNode;
    }
    if (view === 'device') return communityListScreen();
    if (view === 'lock' && phase === 'locked') return lockScreen(A.reason());
    var community = RF.organismo && RF.organismo.inquilinoDeHost ? RF.organismo.inquilinoDeHost() : null;
    if (community) return communityLoginScreen({ id: community, nombre: community });
    return communityListScreen();
  }
  function activationDone(r) { view = 'recovery'; arg = r.recoveryCode; RF.app.render(); }
  A.goto = function (v, a) { view = v; arg = a || null; activationNode = null; RF.app.render(); };
  RF.authui = { showErr: showErr, screen: screen, pending: function () { return view === 'recovery' || view === 'activar' || view === 'reinicio'; } };

  /* ================= herramienta «Seguridad» ================= */
  TOOLS.seguridad = { title: 'Seguridad', icon: 'shield', desc: 'Cambia la contraseña, cierra sesiones, mira quién entró y revisa que todo esté protegido.', render: function () {
    /* en la entrada asistida del Organismo no se cierra la sesión de la comunidad ni se cambia su clave: el servicio lo rechaza */
    var asistida = !!(RF.auth && RF.auth.esAsistida && RF.auth.esAsistida());
    if (A.esGoogle && A.esGoogle()) return h('div', { class: 'tool-page' }, h('h1', {}, 'Seguridad'),
      h('p', {}, 'Entraste con Google. Los datos y adjuntos de esta sesión viven en memoria y se guardan en el servicio. Mantén la conexión y espera a que se confirme el guardado antes de cerrar la pestaña. Para cambiar la clave, ingresa con ella.'),
      UI.btn('Bloquear ahora', { onclick: function () { A.lock('manual').catch(function () { UI.toast('Quedan cambios sin guardar. Revisa la conexión y vuelve a intentarlo.', 'bad'); }); } }));
    var s = RF.store.get(), root = h('div', { class: 'tool-page' }, h('h1', { class: 'tool-title' }, 'Seguridad'), h('p', { class: 'lead' }, 'Todo lo que guardas en este equipo está cifrado con la contraseña de tu comunidad.'));
    var status = h('div'), log = h('div'), out = h('div');
    function msg(kind, t) { U.clear(out); out.appendChild(UI.callout(kind, '', t)); }
    function paintStatus() {
      U.clear(status);
      var m = V.meta() || {}, tk = A.token();
      var rows = [
        ['Datos de este equipo cifrados (AES-256)', true, 'Sin la contraseña o el código de recuperación no se pueden abrir.'],
        ['Código de recuperación', !!m.wrapR, m.wrapR ? 'Existe. Cambiar la contraseña conserva ese código; guárdalo en un lugar seguro.' : 'Este equipo no tiene uno (se conectó a un servicio ya creado).'],
        ['Servicio de la comunidad', RF.cloud.configured(), RF.cloud.configured() ? (tk ? 'Sesión abierta.' : 'Sesión cerrada; se abrirá al usarlo.') : (s.cloud.apiUrl ? 'Dirección no aprobada; no se envían datos.' : 'No conectado.')],
        ['Cierre por inactividad', true, (Number(s.ui.idleMinutes) || 15) + ' minutos']
      ];
      status.appendChild(h('ul', { class: 'sec-list' }, rows.map(function (r) { return h('li', { class: r[1] ? 'ok' : 'warn' }, h('span', { class: 'sec-ico' }, UI.icon(r[1] ? 'check' : 'alert', 18)), h('span', null, h('strong', null, r[0]), h('span', { class: 'muted small' }, ' · ' + r[2]))); })));
    }
    paintStatus();
    root.appendChild(UI.section('Estado', [status]));
    if (!asistida && RF.googleComunidad) root.appendChild(UI.section('Carpeta de la comunidad', [
      h('p', {}, 'Autoriza con la cuenta Google registrada crear «Rinde Fácil» en tu Drive y compartirla con edición con el Organismo.'),
      UI.btn('Preparar mi carpeta', { onclick: function () {
        RF.googleComunidad.connectDrive().then(function () { msg('ok', 'La carpeta está preparada.'); }).catch(function () {
          msg('bad', RF.googleComunidad.configured() ? 'No se pudo preparar la carpeta. Revisa la cuenta elegida y los permisos.' : 'Google está pendiente de configuración.');
        });
      } })]));

    var idle = UI.field('Cerrar la sesión si no la usas por', s.ui, 'idleMinutes', { type: 'select', noEmpty: true, options: [{ id: 5, name: '5 minutos' }, { id: 15, name: '15 minutos' }, { id: 30, name: '30 minutos' }, { id: 60, name: '1 hora' }], onChange: function (v) { s.ui.idleMinutes = Number(v); RF.store.update(function () { }, { silent: true }); paintStatus(); } });
    root.appendChild(UI.section('Esta sesión', [idle, h('div', { class: 'row-actions' },
      UI.btn('Bloquear ahora', { icon: 'shield', cls: 'primary', onclick: function () { A.lock('manual').catch(function () { UI.toast('No se bloqueó la sesión porque los últimos cambios no se guardaron. Revisa el aviso superior y vuelve a intentarlo.', 'bad'); }); } }),
      RF.cloud.configured() && !asistida ? UI.btn('Cerrar sesión en todos los dispositivos', { icon: 'close', cls: 'ghost', onclick: function () {
        A.logoutServer(true).then(function () { msg('ok', 'El servicio confirmó el cierre de las sesiones. Cada dispositivo tendrá que volver a entrar.'); paintStatus(); })
          .catch(function (e) { msg('bad', 'No se pudo confirmar el cierre de las sesiones: ' + (e.message || e)); });
      } }) : null)]));

    /* cambiar contraseña */
    var accountMeta = V.meta() || {}, reqId = 'change-password-requirements';
    var o = passField('Contraseña actual');
    var n1 = passField('Contraseña nueva', { autocomplete: 'new-password', describedby: reqId, hint: C.passwordChecks('', '').map(function (check) { return check.label; }).join('. ') + '.' });
    var n2 = passField('Repite la contraseña nueva', { autocomplete: 'new-password', required: false, describedby: 'change-password-match' });
    var matchHint = passwordConfirmation(n1.input, n2, 'change-password-match');
    var newPasswordHints = passwordChecklist(n1.input, accountMeta.display || accountMeta.user || '', reqId);
    if (asistida) root.appendChild(UI.section('Cambiar la contraseña', [h('p', { class: 'muted' }, 'Esta entrada es del Organismo Colaborador. La comunidad cambia su contraseña desde su propio equipo.')]));
    else root.appendChild(UI.section('Cambiar la contraseña', [h('form', { class: 'auth-form', onsubmit: function (ev) {
      ev.preventDefault();
      var problems = C.passwordProblems(n1.input.value, accountMeta.display || accountMeta.user || '');
      if (problems.length) return msg('bad', problems[0]);
      if (!matchHint.validate()) return;
      var old = o.input.value, nw = n1.input.value;
      work(A.changePassword(old, nw), 'Cambiando…').then(function (r) {
        o.input.value = n1.input.value = n2.input.value = '';
        newPasswordHints.update(); matchHint.reset();
        if (r.remoteChanged) msg('ok', 'La contraseña cambió en este equipo y el servicio confirmó el cambio; las demás sesiones se cerraron.');
        else if (r.remoteTrustBlocked) msg('warn', 'La contraseña cambió solo en este equipo. La dirección del servicio no está aprobada en esta versión; no se envió la contraseña ni se cambió nada en la nube.');
        else if (r.remoteAccountMissing) msg('warn', 'La contraseña cambió solo en este equipo. El servicio está configurado, pero todavía no tiene una cuenta creada.');
        else msg('warn', 'La contraseña cambió solo en este equipo. No hay un servicio conectado; sus datos remotos no se modificaron.');
      }).catch(function (e) { msg('bad', e.message); });
    } }, o.node, n1.node, newPasswordHints.node, n2.node, h('button', { type: 'submit', class: 'btn' }, 'Cambiar contraseña'))]));
    root.appendChild(out);

    /* registro de accesos */
    function loadLog() {
      U.clear(log); log.appendChild(UI.empty('Cargando…'));
      RF.cloud.post('audit', {}, 30000).then(function (r) {
        U.clear(log);
        if (!r || !r.ok) { log.appendChild(UI.empty('No se pudo leer el registro.')); return; }
        var names = { login: 'Entró', login_fail: 'Intento fallido', setup: 'Se creó la cuenta', setup_fail: 'Código de instalación incorrecto', change_password: 'Cambió la contraseña', change_fail: 'Intento fallido al cambiar la contraseña', reset: 'Recuperó la cuenta', reset_fail: 'Recuperación fallida', logout_all: 'Cerró todas las sesiones' };
        log.appendChild(h('table', { class: 'plain-grid' }, h('thead', null, h('tr', null, h('th', null, 'Cuándo'), h('th', null, 'Qué pasó'), h('th', null, 'Desde'))), h('tbody', null, r.log.map(function (e) { return h('tr', { class: e.ok ? '' : 'row-bad' }, h('td', null, new Date(e.t).toLocaleString('es-CL')), h('td', null, names[e.e] || e.e), h('td', null, e.d || '—')); }))));
        log.appendChild(h('p', { class: 'hint' }, '«Desde» es el equipo y navegador que declaró la app al entrar. Google no entrega la dirección IP, así que no se puede mostrar.'));
      }).catch(function (e) { U.clear(log); log.appendChild(UI.empty('No se pudo leer el registro (' + (e.message || e) + ').')); });
    }
    if (RF.cloud.configured()) root.appendChild(UI.section('Quién entró al servicio', [h('p', { class: 'hint' }, 'Los últimos accesos. Si ves algo que no reconoces, cambia la contraseña y cierra todas las sesiones.'), UI.btn('Ver el registro', { icon: 'list', cls: 'ghost', onclick: loadLog }), log]));

    root.appendChild(UI.section('Dejar de usar este equipo', [h('p', { class: 'hint' }, 'Si creaste esta copia por separado y quieres recuperar la cuenta del servicio, primero descarga el respaldo en «Nube y copias» y conserva aparte los comprobantes originales: el JSON no incluye fotos. Comprueba la cuenta del servicio desde otro navegador antes de borrar. Después de borrar solo este equipo, elige «Iniciar sesión» y usa el usuario y la clave de la comunidad. No cargues el respaldo antiguo encima de la cuenta recuperada sin revisar sus datos.'),
      h('p', { class: 'hint' }, 'Conservar esta copia puede mantener datos distintos; combinarla puede agregar registros de esta copia a la comunidad. Borrarla pierde los cambios y fotos que no respaldaste. Lo guardado en el Drive de la comunidad no se borra.'),
      UI.btn('Borrar los datos de este equipo', { icon: 'trash', cls: 'ghost danger', onclick: function () { UI.confirmBox('Se borrarán proyectos, fotos y ajustes de ESTE equipo y tendrás que crear o conectar la cuenta otra vez. Lo del Drive no se borra. ¿Seguir?', 'Borrar todo').then(function (ok) { if (ok) A.wipeDevice().then(function () { location.hash = '#/'; location.reload(); }); }); } })]));
    return root;
  } };
})(typeof window !== 'undefined' ? window : globalThis);
