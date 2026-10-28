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

  /* rechazos del servicio al activar: la cuenta no se creó, así que la bóveda de este equipo ya no sirve y se borra */
  var RECHAZO_ALTA = /^(CODIGO_INVALIDO|DATOS_INVALIDOS|BLOQUEADO|INQUILINO_INEXISTENTE)$/;
  var MENSAJE_SIN_RESPUESTA = 'No se pudo confirmar la activación: el servicio no respondió o se cortó la conexión. No se borró nada de este equipo; vuelve a intentarlo con el mismo código y la misma contraseña. Si te dice que la comunidad ya tiene cuenta, usa «Entrar con mi clave».';
  /* el código ya se gastó tras una respuesta perdida: la activación anterior pudo guardarse, así que la bóveda se conserva */
  var MENSAJE_PUDO_GUARDARSE = 'El RUT o el código no coinciden, o ya se usó. La activación anterior pudo guardarse antes de que se cortara la conexión: no se borró nada de este equipo. Si la comunidad ya quedó activada, entra con tu clave.';
  var LEAD_CUENTA_EXISTENTE = 'Esta comunidad ya tiene cuenta. Entra con tu clave para traer sus datos a este equipo, o usa un código de reinicio si olvidaste la clave.';
  var LEAD_PUDO_GUARDARSE = 'La activación anterior pudo guardarse. Entra con tu clave para comprobarlo, o usa un código de reinicio si olvidaste la clave.';
  /* aviso de un rechazo que borró la bóveda: lo muestra la pantalla nueva que dibuja el borrado */
  var avisoAlta = null;

  /* ---------- crear cuenta (o proteger los datos que ya había) ---------- */
  function createScreen(legacy, onDone, conReinicio) {
    var tenant = !legacy && A.inquilino && A.inquilino();
    /* código de reinicio: la comunidad ya tiene cuenta; es el mismo formulario de activar, sin comprobar antes que la cuenta no exista */
    var reinicio = !!(conReinicio && tenant);
    var title = h('span', null, reinicio ? 'Activa con tu código de reinicio' : legacy ? 'Protege los datos de tu comunidad' : 'Crea la cuenta de tu comunidad');
    var lead = h('span', null, reinicio ? 'Escribe el RUT, el código de reinicio que te entregó el Organismo y tu contraseña nueva. La contraseña nueva reemplaza a la anterior de la comunidad.' : legacy ? 'Tus datos de antes se van a guardar cifrados con una contraseña. Elige una que puedas recordar; sin ella nadie podrá abrirlos, ni siquiera nosotros.' : 'La contraseña protege lo que guardas en este equipo: gastos, fotos y documentos. Nadie más puede abrirlo sin ella.');
    var name = textField('Nombre de la comunidad', { hint: 'Este es el «usuario» con el que entras.', value: (legacy && legacy.community && legacy.community.name) || '' });
    /* sitio de una comunidad (subdominio): el nombre viene del servicio y se activa con el RUT y el código del Organismo */
    var rutField = tenant ? textField('RUT de la comunidad', { hint: 'El RUT de la comunidad, como figura en el acuerdo con CORFO.' }) : null;
    var codeField = tenant ? textField('Código de activación', { hint: reinicio ? 'El código de reinicio que entregó el Organismo.' : 'Te lo entrega el Organismo Colaborador. Sirve una sola vez y vence a los 30 días.' }) : null;
    if (tenant) {
      name.input.readOnly = true; name.input.value = 'Cargando…';
      A.infoInquilino().then(function (r) { if (r && r.ok) name.input.value = r.nombre; else showErr(err, 'Esta dirección no corresponde a una comunidad del servicio.'); }, function () { name.input.value = ''; showErr(err, 'No se pudo comprobar la comunidad. Revisa la conexión.'); });
    }
    var reqId = 'create-password-requirements';
    var p1 = passField('Contraseña', { autocomplete: 'new-password', describedby: reqId, hint: 'Al menos 10 caracteres. Una frase de tres o cuatro palabras funciona bien.' });
    var p2 = passField('Repite la contraseña', { autocomplete: 'new-password', required: false, describedby: 'create-password-match' });
    var matchHint = passwordConfirmation(p1.input, p2, 'create-password-match');
    var err = errBox(), hints = passwordChecklist(p1.input, name.input, reqId), accountExists = false;
    /* alta sin respuesta del servicio: la bóveda ya está en este equipo y el reintento no crea otra. sinRespuesta: pudo llegar al servicio */
    var pendiente = null, sinRespuesta = false, enviando = false;
    /* activa la cuenta en el servicio. Solo un rechazo definitivo borra la bóveda de este equipo; sin respuesta se conserva para reintentar */
    function activar(r) {
      return A.serverActivate(rutField.input.value.trim(), codeField.input.value.trim(), { reinicio: reinicio }).then(function () { pendiente = null; sinRespuesta = false; return r; }, function (e) {
        var codigo = e && e.code;
        /* puede ser la cuenta que este equipo ya envió: no se borra y se pasa a «Entrar con mi clave» */
        if (codigo === 'CUENTA_EXISTENTE' && sinRespuesta) throw e;
        /* el código ya se gastó y el envío anterior no tuvo respuesta: la activación anterior pudo guardarse, así que no se borra nada */
        if (codigo === 'CODIGO_INVALIDO' && sinRespuesta) throw Object.assign(new Error(MENSAJE_PUDO_GUARDARSE), { code: codigo, pudoGuardarse: true });
        if (RECHAZO_ALTA.test(codigo || '') || codigo === 'CUENTA_EXISTENTE') {
          pendiente = null; sinRespuesta = false; avisoAlta = e;
          return RF.auth.wipeDevice().then(function () { throw e; }, function () { throw e; });
        }
        /* respuesta del servicio que no crea la cuenta, o error local: no se borra nada */
        if (codigo) throw e;
        /* sin código no llegó la respuesta (TIMEOUT, red): la cuenta puede haberse guardado */
        sinRespuesta = true;
        throw new Error(MENSAJE_SIN_RESPUESTA);
      });
    }
    /* la comunidad ya tiene cuenta (o una activación anterior pudo guardarse): se retira el alta y se ofrece entrar con la clave o usar un código de reinicio */
    function mostrarCuentaExistente(texto) {
      accountExists = true; p1.input.value = p2.input.value = '';
      title.textContent = 'Inicia sesión con tu comunidad';
      lead.textContent = texto;
      U.clear(form); form.appendChild(err);
      form.appendChild(h('button', { type: 'button', class: 'btn primary big', onclick: irAEntrarConClave }, 'Entrar con mi clave'));
      form.appendChild(h('button', { type: 'button', class: 'btn big', onclick: irAReinicio }, 'Tengo un código de reinicio'));
    }
    /* si quedó abierta por un alta sin respuesta, la bóveda se cierra antes de la entrada: la app no debe mostrarse con ella */
    function irAEntrarConClave() {
      A.lock('manual').then(function () { A.goto('device'); }, function () { showErr(err, 'No se pudieron guardar los cambios de este equipo. Vuelve a intentarlo en un momento.'); });
    }
    /* «Tengo un código de reinicio»: el formulario de activación con la contraseña nueva. Solo se quita la bóveda que creó este mismo alta (está vacía: aún no tiene datos de la comunidad). Cualquier otra cuenta guardada en el equipo no se borra */
    function irAReinicio() {
      if (!V.meta()) return A.goto('reinicio');
      if (!pendiente) return showErr(err, 'Este equipo ya tiene la cuenta de la comunidad guardada. El código de reinicio no borra datos de este equipo: usa otro equipo sin cuenta, o pide ayuda al Organismo Colaborador.');
      view = 'reinicio'; arg = null; avisoAlta = null;
      var volver = function () { RF.app.render(); };
      RF.auth.wipeDevice().then(volver, volver);
    }
    var form = h('form', { class: 'auth-form', novalidate: true, onsubmit: function (ev) {
      ev.preventDefault(); showErr(err, '');
      if (accountExists) return showErr(err, 'Esta comunidad ya tiene cuenta. Inicia sesión con tu clave.');
      var nm = name.input.value.trim();
      if (nm.length < 3) return showErr(err, 'Escribe el nombre de la comunidad.');
      var pr = C.passwordProblems(p1.input.value, nm); if (pr.length) return showErr(err, pr[0]);
      if (!matchHint.validate()) return;
      if (tenant && !rutField.input.value.trim()) return showErr(err, 'Escribe el RUT de la comunidad.');
      if (tenant && !codeField.input.value.trim()) return showErr(err, 'Escribe el código de activación.');
      /* con varias comunidades, la cuenta se activa en el servicio con el RUT y el código. Sin respuesta, la bóveda se conserva y el reintento usa esa misma alta */
      if (tenant && pendiente && p1.input.value !== V.password()) return showErr(err, 'Escribe la misma contraseña que usaste al principio: esta cuenta se activa con ella.');
      if (enviando) return;
      enviando = true;
      var todo;
      if (!tenant) todo = A.createAccount(nm, p1.input.value);
      else if (pendiente) todo = activar(pendiente);
      else todo = A.createAccount(nm, p1.input.value, reinicio ? { reinicio: true } : undefined).then(function (r) { pendiente = r; return activar(r); });
      work(todo, tenant ? 'Activando tu cuenta…' : 'Comprobando la cuenta…').then(function (r) { enviando = false; if (r && r.legacyPendiente) UI.toast('No se pudo quitar una copia antigua sin cifrar de este navegador. Avisa a quien te apoya.', 'bad'); onDone(r); }).catch(function (e) {
        enviando = false;
        if (e.code === 'CUENTA_EXISTENTE') mostrarCuentaExistente(LEAD_CUENTA_EXISTENTE);
        else if (e.pudoGuardarse) mostrarCuentaExistente(LEAD_PUDO_GUARDARSE);
        showErr(err, e.message, e);
      });
    } }, name.node, tenant ? rutField.node : null, tenant ? codeField.node : null, p1.node, hints.node, p2.node, err, h('button', { type: 'submit', class: 'btn primary big' }, tenant ? (reinicio ? 'Activar con el código de reinicio' : 'Activar mi cuenta') : (legacy ? 'Proteger mis datos' : 'Crear cuenta')));
    /* si la activación fue rechazada, el aviso se muestra aquí: el borrado de este equipo redibuja la pantalla y el formulario anterior ya no se ve */
    if (avisoAlta) { var previo = avisoAlta; avisoAlta = null; showErr(err, previo.message, previo); if (previo.code === 'CUENTA_EXISTENTE') mostrarCuentaExistente(LEAD_CUENTA_EXISTENTE); }
    return shell(title, lead,
      [form, reinicio ? h('p', { class: 'hint' }, 'Con un código de reinicio no se comprueba antes si la comunidad tiene cuenta.') : h('p', { class: 'hint' }, 'Antes de crear, comprobamos si tu comunidad ya tiene cuenta. Hace falta conexión y un servicio aprobado.'),
        reinicio ? null : legacy ? h('p', { class: 'hint' }, 'Si tu comunidad ya tiene cuenta en el servicio, no crees otra: elige «Iniciar sesión» y usa esa cuenta.') : h('p', { class: 'hint' }, 'Si tu comunidad ya tiene cuenta, inicia sesión con su usuario y clave para traer sus datos a este equipo.'),
        h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('device'); } }, 'Iniciar sesión (ya tengo la cuenta de mi comunidad)')]);
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
      work(job, device ? 'Conectando…' : 'Abriendo…').then(function (r) { if (r && r.copiaLocal) UI.toast('Los datos anteriores de este equipo se reemplazaron por los de la cuenta del servicio.', 'ok'); if (r && r.fotosPendientes) UI.toast('No se pudieron quitar las fotos anteriores de este equipo. No se pueden abrir con la cuenta nueva.', 'bad'); if (r && r.legacyPendiente) UI.toast('No se pudo quitar una copia antigua sin cifrar de este navegador. Avisa a quien te apoya.', 'bad'); }).catch(function (e) { showErr(err, device && RF.cloud && RF.cloud.humanError ? RF.cloud.humanError(e) : e.message, e); pw.input.value = ''; pw.input.focus(); });
    } }, name.node, pw.node, err, h('button', { type: 'submit', class: 'btn primary big' }, 'Entrar'));
    setTimeout(function () { (name.input.value ? pw.input : name.input).focus(); }, 30);
    if (!device) return shell('Entra a Rinde Fácil', reason === 'inactividad' ? 'La sesión se cerró porque estuvo un rato sin usarse. Tus datos siguen guardados.' : 'Escribe el nombre de tu comunidad y tu contraseña.',
      [form, h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('recover'); } }, 'Olvidé mi contraseña'),
        h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('device'); } }, 'Traer la cuenta del servicio a este equipo'),
        h('p', { class: 'hint' }, 'Si tu comunidad ya tiene cuenta en el servicio, usa «Traer la cuenta del servicio» con el mismo usuario y clave. Los datos de este equipo se reemplazarán por los de esa cuenta.')]);
    return shell('Inicia sesión', 'Usa el nombre de tu comunidad y la contraseña que tenías en el otro equipo.',
      [sinServicio ? h('p', { class: 'hint' }, 'Esta versión no tiene un servicio aprobado para traer tu cuenta. Pide configurar el servicio de tu comunidad; no crees otra cuenta.') : null,
        device && (V.meta() || (V.legacyState && V.legacyState())) ? h('p', { class: 'hint' }, 'Este equipo ya tiene datos. Al traer la cuenta del servicio, los datos de este equipo y sus fotos locales se reemplazan por los de esa cuenta. Los cambios que no se guardaron en el servicio se pierden.') : null,
        form,
        !V.meta() ? h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto(''); } }, 'Crear la cuenta de tu comunidad en este equipo') : null]);
  }

  /* ---------- recuperar ---------- */
  function recoverScreen() {
    var code = textField('Código de recuperación', { autocomplete: 'off', hint: 'Los 26 caracteres que guardaste al crear la cuenta.' });
    var meta = V.meta() || {}, reqId = 'recover-password-requirements';
    var communityName = meta.display || meta.user || '';
    var p1 = passField('Contraseña nueva', { autocomplete: 'new-password', describedby: reqId });
    var p2 = passField('Repite la contraseña nueva', { autocomplete: 'new-password', required: false, describedby: 'recover-password-match' });
    var matchHint = passwordConfirmation(p1.input, p2, 'recover-password-match');
    var hints = passwordChecklist(p1.input, communityName, reqId);
    var err = errBox();
    var form = h('form', { class: 'auth-form', onsubmit: function (ev) {
      ev.preventDefault(); showErr(err, '');
      var problems = C.passwordProblems(p1.input.value, communityName); if (problems.length) return showErr(err, problems[0]);
      if (!matchHint.validate()) return;
      work(A.recover(code.input.value, p1.input.value), 'Recuperando…').then(function (r) {
        var warning = r.serviceTrustBlocked ? 'La bóveda de este equipo se recuperó, pero la dirección guardada del servicio no está aprobada en esta versión. No se envió el código ni se modificó el acceso remoto. Pide verificar y aprobar la dirección antes de conectar.'
          : r.serverReset === false ? 'La bóveda de este equipo ya cambió y se generó el código nuevo que aparece abajo, pero el servicio remoto no confirmó el restablecimiento. El Drive todavía puede exigir la contraseña anterior. No borres esta sesión ni pierdas el código; vuelve a intentar cuando el servicio esté disponible.'
          : r.serverAccountMissing ? 'La recuperación cambió la bóveda de este equipo, pero el servicio conectado todavía no tiene una cuenta creada. El código de abajo sirve para este equipo; no se modificó ningún acceso remoto.' : '';
        A.goto('recovery', { code: r.recoveryCode, warning: warning });
      }).catch(function (e) {
        if (e && e.code === 'LOCAL_RECOVERY_COMMIT_FAILED_AFTER_REMOTE' && e.recoveryCode) A.goto('recovery', { code: e.recoveryCode, warning: e.message });
        else showErr(err, e.message, e);
      });
    } }, code.node, p1.node, hints.node, p2.node, err, h('button', { type: 'submit', class: 'btn primary big' }, 'Cambiar contraseña'));
    return shell('Recuperar el acceso', 'Con el código de recuperación puedes elegir una contraseña nueva sin perder tus datos.', [form, h('button', { type: 'button', class: 'linklike', onclick: function () { A.goto('lock'); } }, 'Volver')]);
  }

  function insecureScreen() {
    return shell('Abre Rinde Fácil desde una dirección segura', 'Este navegador no permite proteger los datos con contraseña cuando la página no es https. Abre la dirección oficial de Rinde Fácil (empieza con https://).', null);
  }

  /* ---------- qué pantalla toca ---------- */
  var view = null, arg = null;
  function screen(phase) {
    if (phase === 'insecure') return insecureScreen();
    if (view === 'recovery') {
      var recovery = arg && typeof arg === 'object' ? arg : { code: arg, warning: '' };
      return recoveryScreen(recovery.code, function () { view = null; arg = null; A.touch(); RF.app.render(); }, recovery.warning);
    }
    if (view === 'recover' && phase === 'locked') return recoverScreen();
    if (view === 'lock' && phase === 'locked') return lockScreen(A.reason());
    if (phase === 'locked' && view !== 'device') return lockScreen(A.reason());
    if ((phase === 'none' || phase === 'legacy' || phase === 'locked') && view === 'device') return lockScreen('', true); /* equipo nuevo o con copia local: traer la cuenta que ya existe en el servicio */
    return createScreen(phase === 'legacy' ? V.legacyState() : null, function (r) { view = 'recovery'; arg = r.recoveryCode; RF.app.render(); }, view === 'reinicio' && phase === 'none');
  }
  A.goto = function (v, a) { view = v; arg = a || null; RF.app.render(); };
  RF.authui = { showErr: showErr, screen: screen, pending: function () { return view === 'recovery'; } };

  /* ================= herramienta «Seguridad» ================= */
  TOOLS.seguridad = { title: 'Seguridad', icon: 'shield', desc: 'Cambia la contraseña, cierra sesiones, mira quién entró y revisa que todo esté protegido.', render: function () {
    /* en la entrada asistida del Organismo no se cierra la sesión de la comunidad ni se cambia su clave: el servicio lo rechaza */
    var asistida = !!(RF.auth && RF.auth.esAsistida && RF.auth.esAsistida());
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
    var n1 = passField('Contraseña nueva', { autocomplete: 'new-password', describedby: reqId, hint: 'Al menos 10 caracteres.' });
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
