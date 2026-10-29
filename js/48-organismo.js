/* Rinde Fácil — panel del Organismo Colaborador: acceso, comunidades, detalle, códigos de primer ingreso, entrada asistida, notas y registro.
 * Solo se muestra con sesión del Organismo, que ingresa con Google.
 * Los datos vienen del servicio central (acciones panel* de backend/Organismo.gs). Sin servicio conectado no se muestran cifras. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var U = RF.util, UI = RF.ui, h = U.h, E = RF.estado;
  var org = RF.organismo = RF.organismo || {};
  var entregas = [];
  var cacheVistas = {}, cargas = {}, borradores = {}, limpiarFormularios = [];
  var plantillaCache = null, plantillaPendiente = null, sesionVersion = 0, vistaVersion = 0;
  function limpiarPanel() {
    sesionVersion++; vistaVersion++;
    limpiarFormularios.forEach(function (limpiar) { limpiar(); });
    Object.keys(borradores).forEach(function (key) {
      var b = borradores[key];
      Object.keys(b).forEach(function (campo) { b[campo] = null; });
    });
    cacheVistas = {}; cargas = {}; borradores = {}; limpiarFormularios = [];
    plantillaCache = null; plantillaPendiente = null;
  }
  function borrarEntregas() { entregas.slice().forEach(function (borrar) { borrar(); }); }
  function entregaSecreta(node, texto) {
    var copy = h('button', { type: 'button', class: 'btn primary' }, 'Copiar mensaje');
    var close = h('button', { type: 'button', class: 'btn ghost' }, 'Cerrar mensaje');
    function borrar() {
      texto = '';
      node.querySelectorAll('textarea, input').forEach(function (n) { n.value = ''; });
      // También se limpian los nodos retenidos por quien cerró la vista.
      Array.from(node.children).forEach(function (n) { if ('value' in n) n.value = ''; n.textContent = ''; });
      U.clear(node);
      entregas = entregas.filter(function (fn) { return fn !== borrar; });
    }
    copy.onclick = function () { U.copyText(texto).then(function (ok) { if (ok) borrar(); else copy.textContent = 'Seleccione el mensaje y cópielo.'; }); };
    close.onclick = borrar;
    node.appendChild(copy); node.appendChild(close); entregas.push(borrar);
  }

  org.rol = null;    /* 'organismo' con sesión; si no, null */
  org.token = null;  /* sesión del Organismo: solo en memoria, nunca en el almacenamiento del navegador */
  org.url = null;    /* dirección del servicio central aprobada */
  org.fuente = null; /* { comunidades(), estado(id), registro(id?), codigos(), notas(id?) } */

  org.esOrganismo = function () { return org.rol === 'organismo' && !!org.token; };

  /* La ruta identifica la comunidad. No decodificar ni normalizar «..» antes de validarla.
     Sólo en pruebas locales se conserva «subdominio.localhost/». */
  org.inquilinoDeHost = function () {
    var loc = root.location || {}, segment = (loc.pathname || '/').split('/')[1] || '';
    if (segment) return /^[a-z0-9-]+$/i.test(segment) ? segment.toLowerCase() : null;
    if (loc.pathname && loc.pathname !== '/') return null;
    var m = /^([a-z0-9-]+)\.localhost$/.exec((loc.hostname || '').toLowerCase());
    return m && m[1] !== 'www' ? m[1] : null;
  };
  /* dirección de la comunidad, para abrir su sitio desde el panel */
  org.urlComunidad = function (id) {
    id = String(id || '').toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Comunidad inválida.');
    var local = /(^|\.)localhost$/.test((root.location && root.location.hostname) || '');
    var port = (root.location && root.location.port) ? ':' + root.location.port : '';
    return local ? 'http://' + id + '.localhost' + port + '/' : 'https://rinde-facil.web.app/' + id;
  };

  var SECCIONES = [
    { id: 'comunidades', label: 'Comunidades', icon: 'list', ruta: '#/o/comunidades' },
    { id: 'codigos', label: 'Códigos de primer ingreso', icon: 'shield', ruta: '#/o/codigos' },
    { id: 'notas', label: 'Notas', icon: 'file', ruta: '#/o/notas' },
    { id: 'registro', label: 'Registro de cambios', icon: 'calendar', ruta: '#/o/registro' }
  ];
  var ETIQUETA_CODIGO = { sin_activar: 'Sin activar', activa: 'Activa', sin_codigo: 'Sin código vigente' };

  function mensajeError(code) {
    var m = {
      SESION_INVALIDA: 'Su sesión venció. Vuelva a entrar.',
      SESION_CERRADA: 'La sesión del panel se cerró. Vuelva a entrar.',
      CREDENCIALES_INVALIDAS: 'La clave no es correcta.',
      BLOQUEADO: 'Demasiados intentos. Espere un momento.',
      INQUILINO_INEXISTENTE: 'Esa comunidad no está en el registro.',
      SIN_COPIA: 'Esa comunidad todavía no tiene datos guardados.',
      CONFLICTO: 'Alguien guardó cambios antes que tú. Recarga y vuelve a intentar.',
      TICKET_INVALIDO: 'El acceso ya se usó o venció.',
      ESTADO_INVALIDO: 'Los datos de la comunidad no son válidos.'
    };
    return m[code] || 'No se pudo completar (' + (code || 'error') + ').';
  }

  /* ---------- acceso del Organismo ---------- */
  function conectar(url, token) {
    limpiarPanel();
    org.url = url;
    org.token = token;
    org.rol = 'organismo';
    var version = sesionVersion;
    var post = function (accion, datos) {
      /* el token vive solo en org.token: al cerrar se borra y estas llamadas (también las guardadas en los closures) fallan */
      if (!org.token || version !== sesionVersion) return Promise.reject(Object.assign(new Error(mensajeError('SESION_CERRADA')), { code: 'SESION_CERRADA' }));
      return RF.cloud.postRawTo(org.url, accion, Object.assign({ t: org.token }, datos || {})).then(function (r) {
        if (version !== sesionVersion) throw Object.assign(new Error(mensajeError('SESION_CERRADA')), { code: 'SESION_CERRADA' });
        if (!r || r.ok !== true) throw Object.assign(new Error(mensajeError(r && r.error)), { code: r && r.error });
        return r;
      });
    };
    org.post = post;
    org.fuente = {
      comunidades: function () { return post('panelInquilinos').then(function (r) { return r.inquilinos; }); },
      estado: function (id) { return post('panelEstado', { inquilino: id }).then(function (r) { return JSON.parse(r.state); }); },
      registro: function (id) {
        if (id) return post('panelRegistro', { inquilino: id }).then(function (r) {
          return r.cambios.map(function (c) { return { t: c.t, texto: (c.seccion ? c.seccion + ': ' : '') + (c.resumen || 'Cambio'), comunidad: id }; })
            .concat(r.accesos.map(function (a) { return { t: a.t, texto: textoAcceso(a.tipo), comunidad: id }; }));
        });
        return Promise.all([post('panelRegistro'), org.fuente.comunidades()]).then(function (info) {
          var lista = info[1], globales = info[0].cambios.map(function (c) {
            return { t: c.t, texto: typeof c.activo === 'boolean' ? 'Envío desde la cuenta del Organismo: ' + (c.activo ? 'activado' : 'desactivado') : 'Configuración actualizada' };
          });
          return Promise.all(lista.slice(0, 50).map(function (c) { return org.fuente.registro(c.id).then(function (x) { return x.map(function (e) { return Object.assign(e, { comunidad: c.nombre }); }); }); }))
            .then(function (partes) { return globales.concat([].concat.apply([], partes)).sort(function (a, b) { return String(b.t).localeCompare(String(a.t)); }); });
        });
      },
      codigos: function () {
        return Promise.all([post('panelInquilinos'), post('panelCodigos')]).then(function (x) {
          var vigentes = x[1].codigos.filter(function (c) { return c.vigente; });
          return x[0].inquilinos.map(function (i) {
            var v = vigentes.filter(function (c) { return c.inquilino === i.id; })[0];
            return { id: i.id, nombre: i.nombre, correo: i.correo, estado: i.estado === 'activa' ? 'activa' : (v ? 'sin_activar' : 'sin_codigo'), vence: v ? v.vence : '' };
          });
        });
      },
      notas: function (id) { return post('panelNotas', id ? { inquilino: id } : {}).then(function (r) { return r.notas; }); }
    };
    org.generarCodigo = function (id) { return post('panelGenerarCodigo', { inquilino: id }); };
    org.ticket = function (id) { return post('panelTicket', { inquilino: id }); };
    org.guardarNota = function (nota) { return post('panelNotaGuardar', nota); };
    org.borrarNota = function (id) { return post('panelNotaBorrar', { id: id }); };
    org.crearComunidad = function (nombre, correo, rut, enviar, mensaje) {
      return post('panelInquilinoCrear', { nombre: nombre, correo: correo, rut: rut, enviar: enviar === true, mensaje: mensaje });
    };
    org.reenviarCodigo = function (id, enviar, mensaje) { return post('panelReenviarCodigo', { inquilino: id, enviar: enviar === true, mensaje: mensaje }); };
    org.plantillaCorreo = function () {
      if (version !== sesionVersion) return Promise.reject({ code: 'SESION_CERRADA' });
      if (plantillaCache) return Promise.resolve(plantillaCache);
      if (!plantillaPendiente) plantillaPendiente = post('panelPlantillaCorreo').then(function (r) {
        plantillaCache = r; plantillaPendiente = null; return r;
      }, function (e) { if (version === sesionVersion) plantillaPendiente = null; throw e; });
      return plantillaPendiente;
    };
    org.guardarCorreo = function (id, correo) { return post('panelInquilinoActualizar', { inquilino: id, correo: correo }); };
    return org.token;
  }
  function textoAcceso(tipo) {
    return { activacion: 'Una comunidad activó su cuenta', activacion_fallida: 'Intento fallido de activación', codigo_emitido: 'Se generó un Código de primer ingreso',
      ticket_emitido: 'El Organismo pidió entrar a la cuenta', entrada_asistida: 'El Organismo entró a la cuenta de la comunidad', ticket_rechazado: 'Un ticket fue rechazado', organismo_desbloqueo: 'El Organismo desbloqueó el acceso de la comunidad' }[tipo] || tipo;
  }

  org.entrarConGoogle = function (url) {
    var u = url || (RF.cloud.approvedUrls && RF.cloud.approvedUrls()[0]);
    if (!u) return Promise.reject(Object.assign(new Error('El servicio central no está configurado en esta versión.'), { code: 'SIN_SERVICIO' }));
    if (!RF.googleOrganismo || !RF.googleOrganismo.configured()) return Promise.reject(Object.assign(new Error('El ingreso con Google todavía no está configurado.'), { code: 'GOOGLE_SIN_CONFIGURAR' }));
    return RF.googleOrganismo.enter(u).then(function (r) {
      if (!r || r.ok !== true || !r.token) throw Object.assign(new Error('Ingreso rechazado.'), { code: 'INGRESO_GOOGLE_RECHAZADO' });
      conectar(u, r.token);
      return true;
    }).catch(function (e) {
      var code = e && e.code;
      var message = code === 'INGRESO_GOOGLE_RECHAZADO' ? 'Esa cuenta de Google no es la del Organismo Colaborador.' :
        (code === 'GOOGLE_SIN_CONFIGURAR' ? 'El ingreso con Google todavía no está configurado.' : 'No se pudo entrar con Google. Revisa la conexión e inténtalo de nuevo.');
      throw Object.assign(new Error(message), { code: code });
    });
  };
  /* cerrar: el token se borra de este equipo y se revoca en el servicio (acción logout, la misma de las demás sesiones).
     Si el servicio no confirma, la sesión caduca sola y se avisa. */
  org.cerrar = function () {
    borrarEntregas(); limpiarPanel();
    var url = org.url, token = org.token;
    org.rol = null; org.token = null; org.url = null; org.fuente = null;
    if (!token || !url) return Promise.resolve({ ok: true, skipped: true });
    return RF.cloud.postRawTo(url, 'logout', { t: token }).then(function (r) {
      if (r && (r.ok === true || r.error === 'SESION_INVALIDA')) return r; /* ya no estaba abierta en el servicio */
      throw new Error('sin confirmación');
    }).catch(function () {
      if (UI && UI.toast) UI.toast('Se cerró el panel en este equipo, pero el servicio no confirmó el cierre. La sesión caduca sola.', 'bad');
    });
  };

  /* pantalla de acceso del Organismo (en el sitio principal, sin comunidad) */
  org.pantallaAcceso = function (onOk) {
    var err = h('p', { class: 'auth-error', role: 'alert' });
    var volver = h('button', { type: 'button', class: 'linklike', onclick: function () {
      org.mostrarAcceso = false;
      if (/^#\/?o(\/|\?|$)/.test(location.hash || '')) location.hash = '#/';
      else if (RF.app) RF.app.render();
    } }, 'Volver');
    var google = h('button', { type: 'button', class: 'btn big', onclick: function () {
      if (google.disabled) return;
      google.disabled = true; err.textContent = '';
      org.entrarConGoogle().then(function () { onOk(); }).catch(function (e) { err.textContent = e.message; })
        .finally(function () { google.disabled = false; });
    } }, 'Entrar con Google');
    return h('div', { class: 'view auth-view panel-org' }, h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Panel del Organismo Colaborador'),
      h('p', { class: 'lead' }, 'Acceda para ver las comunidades. Para preparar una rendición, ingrese desde el sitio de su comunidad.')), h('div', { class: 'auth-form' }, err, google, volver));
  };

  /* ---------- barra lateral del panel ---------- */
  org.sidebar = function (ruta) {
    var sec = ruta && ruta.name === 'organismo' ? ruta.sub : 'comunidades';
    return h('aside', { id: 'side', class: 'side', 'aria-label': 'Panel del Organismo' },
      h('div', { class: 'side-brand' }, h('a', { href: '#/o/comunidades', class: 'brand' }, 'Rinde Fácil'), h('span', { class: 'brand-sub' }, 'Organismo Colaborador')),
      h('nav', { 'aria-label': 'Secciones del panel' }, SECCIONES.map(function (s) {
        return h('a', { href: s.ruta, class: 'side-link' + (s.id === sec ? ' current' : ''), 'aria-current': s.id === sec ? 'page' : null }, UI.icon(s.icon, 18), s.label);
      })),
      h('div', { class: 'side-foot' }, h('button', { type: 'button', class: 'btn ghost small', onclick: function () { org.cerrar(); if (RF.app) RF.app.render(); } }, 'Salir del panel')));
  };

  /* ---------- piezas visuales ---------- */
  function pillEstado(est) {
    return h('span', { class: 'estado-pill ' + est.id }, h('span', { class: 'estado-dot', 'aria-hidden': 'true' }), est.label);
  }
  function barra(porcentaje) {
    var p = porcentaje == null ? 0 : Math.max(0, Math.min(100, porcentaje));
    return h('div', { class: 'pct-bar', role: 'img', 'aria-label': porcentaje == null ? 'Sin presupuesto aprobado' : 'Rendido: ' + porcentaje + ' %' }, h('i', { style: 'width:' + p + '%' }));
  }
  function pctTexto(porcentaje) { return porcentaje == null ? '—' : porcentaje + ' %'; }
  function fechaTexto(iso) { return iso ? U.fmtDate(iso) : '—'; }

  /* gráfico de barras por cuenta: aprobado (contorno) y rendido (relleno); mismo eje para comparar */
  function graficoCuentas(st) {
    var filas = RF.data.CUENTAS.map(function (c) {
      var ap = 0, re = 0;
      (st.projects || []).forEach(function (p) { var t = RF.logic.totalsByCuenta(p)[c.id] || {}; ap += Number(t.aprobado) || 0; re += Number(t.rendido) || 0; });
      return { id: c.id, nombre: c.id === 'administracion' ? c.name + ' (total aparte)' : c.name, aprobado: ap, rendido: re };
    });
    /* la administración es transversal: va al final como total aparte, no como una cuenta más de cada proyecto */
    filas = filas.filter(function (f) { return f.id !== 'administracion'; }).concat(filas.filter(function (f) { return f.id === 'administracion'; }));
    var max = Math.max.apply(null, [1].concat(filas.map(function (f) { return Math.max(f.aprobado, f.rendido); })));
    var ancho = 560, alto = 40 + filas.length * 46, izq = 150, der = 70;
    var anchoBarra = ancho - izq - der;
    var svg = ['<svg viewBox="0 0 ' + ancho + ' ' + alto + '" role="img" aria-label="Presupuesto aprobado y rendido por cuenta" xmlns="http://www.w3.org/2000/svg" class="grafico-cuentas">'];
    filas.forEach(function (f, i) {
      var y = 24 + i * 46;
      var wA = Math.round(anchoBarra * f.aprobado / max), wR = Math.round(anchoBarra * f.rendido / max);
      svg.push('<text x="0" y="' + (y + 14) + '" class="gc-label">' + escapar(f.nombre) + '</text>');
      svg.push('<rect x="' + izq + '" y="' + y + '" width="' + wA + '" height="12" rx="3" class="gc-aprobado"><title>Aprobado: ' + escapar(U.fmtCLP(f.aprobado)) + '</title></rect>');
      svg.push('<rect x="' + izq + '" y="' + (y + 16) + '" width="' + wR + '" height="12" rx="3" class="gc-rendido"><title>Rendido: ' + escapar(U.fmtCLP(f.rendido)) + '</title></rect>');
      svg.push('<text x="' + (izq + anchoBarra + 6) + '" y="' + (y + 14) + '" class="gc-valor">' + escapar(U.fmtCLP(f.rendido)) + ' de ' + escapar(U.fmtCLP(f.aprobado)) + '</text>');
    });
    svg.push('</svg>');
    var leyenda = h('p', { class: 'gc-leyenda' }, h('span', { class: 'gc-sw gc-aprobado' }), ' aprobado   ', h('span', { class: 'gc-sw gc-rendido' }), ' rendido');
    var box = h('div', { class: 'grafico' }); box.innerHTML = svg.join('');
    return h('div', null, box, leyenda);
  }
  function escapar(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- vistas ---------- */
  function resumenEstados(datos) {
    var cuenta = { atrasada: 0, observada: 0, sin_movimiento: 0, al_dia: 0 };
    datos.forEach(function (d) { if (d.ev) cuenta[d.ev.estado.id] = (cuenta[d.ev.estado.id] || 0) + 1; });
    return cuenta;
  }
  /* Plantilla y borradores viven en memoria hasta cerrar la sesión. */
  function formularioCorreo(inquilino, alCrear, alEmitir) {
    var version = sesionVersion, key = inquilino ? 'comunidad:' + inquilino.id : 'nueva';
    var b = borradores[key];
    if (!b) b = borradores[key] = { nombre: inquilino ? inquilino.nombre : '', correo: inquilino ? inquilino.correo : '',
      enviar: true, texto: '', editado: false, final: '', estado: '', ocupado: false };
    var nombre = h('input', { type: 'text', required: true, minlength: 3, maxlength: 80, 'aria-label': 'Nombre' });
    var correo = h('input', { type: 'email', required: true, maxlength: 120, 'aria-label': 'Correo de la comunidad' });
    nombre.value = b.nombre || ''; correo.value = b.correo || '';
    var enviar = h('input', { type: 'checkbox', checked: b.enviar });
    enviar.checked = b.enviar;
    var texto = h('textarea', { rows: 15, 'aria-label': 'Mensaje de bienvenida' }); texto.value = b.texto;
    var aviso = h('p', { class: 'nota-accion' });
    var resultado = h('div', { class: 'nota-accion', role: 'status' }, b.estado);
    var boton = h('button', { type: 'submit', class: 'btn primary' }, inquilino ? 'Reenviar código' : 'Generar código y completar mensaje');
    var restablecer = h('button', { type: 'button', class: 'btn ghost small' }, 'Restablecer plantilla');
    var copiar = h('button', { type: 'button', class: 'btn primary small' }, 'Copiar mensaje');
    var plantillaActual = plantillaCache;
    var codigoPendiente = '(se generará al crear la comunidad)', vencePendiente = '(se fija al generar el código)';
    function vigente() { return version === sesionVersion; }
    function sincronizar() {
      boton.disabled = !vigente() || !plantillaActual || b.ocupado;
      restablecer.disabled = !vigente() || !plantillaActual || b.ocupado;
    }
    function errorTexto(e) {
      return { CORREO_INVALIDO: 'Escriba un correo válido de hasta 120 caracteres.', CORREO_EXISTENTE: 'Ese correo ya está registrado en otra comunidad.',
        DATOS_INVALIDOS: 'Revise el nombre y el correo de la comunidad.', INQUILINO_EXISTENTE: 'Ya existe una comunidad con ese identificador.' }[e && e.code] || mensajeError(e && e.code);
    }
    function actualizar() {
      if (!vigente()) return;
      b.nombre = nombre.value; b.correo = correo.value; b.enviar = enviar.checked;
      if (plantillaActual && !b.editado && !b.final) {
        var valores = { nombre: b.nombre, correo: b.correo, codigo: codigoPendiente, vence: vencePendiente };
        b.texto = plantillaActual.cuerpo.replace(/\{(nombre|correo|codigo|vence)\}/g, function (_, campo) { return valores[campo] || ''; });
        texto.value = b.texto;
      }
    }
    nombre.oninput = correo.oninput = enviar.onchange = actualizar;
    texto.oninput = function () { if (vigente()) { b.texto = texto.value; b.editado = true; } };
    restablecer.onclick = function () {
      if (!vigente() || !plantillaActual || b.ocupado) return;
      b.editado = false;
      if (b.final) { b.texto = b.final; texto.value = b.final; }
      else actualizar();
    };
    copiar.onclick = function () {
      if (!vigente()) return;
      U.copyText(texto.value).then(function (ok) {
        if (vigente()) aviso.textContent = ok ? 'Mensaje copiado.' : 'Seleccione el mensaje y cópielo.';
      });
    };
    var form = h('form', { class: 'nota-form org-correo-form', onsubmit: function (ev) {
      ev.preventDefault();
      if (!vigente() || boton.disabled || b.ocupado) return;
      actualizar();
      if (!inquilino && (!nombre.value.trim() || !correo.value.trim())) { resultado.textContent = 'Complete el nombre y el correo de la comunidad.'; return; }
      b.ocupado = true; sincronizar(); b.estado = resultado.textContent = 'Emitiendo el Código de primer ingreso…';
      // La vista previa no reemplaza los marcadores que necesita el servidor.
      var mensaje = b.editado ? texto.value.split(codigoPendiente).join('{codigo}').split(vencePendiente).join('{vence}') : plantillaActual.cuerpo;
      var peticion = inquilino ? org.reenviarCodigo(inquilino.id, enviar.checked, mensaje)
        : org.crearComunidad(nombre.value, correo.value, null, enviar.checked, mensaje);
      peticion.then(function (r) {
        if (!vigente()) { r.mensajeListo = ''; return; }
        b.final = b.texto = r.mensajeListo; texto.value = b.texto;
        b.estado = r.enviado ? 'El código ya fue enviado por correo. Puede copiar el mensaje completo.' :
          (r.error === 'ENVIO_FALLIDO' ? 'No se pudo enviar el correo. Copie el mensaje y envíelo desde su correo institucional.' : 'Código generado. Copie el mensaje para enviarlo desde su correo institucional.');
        resultado.textContent = b.estado; b.ocupado = false;
        r.mensajeListo = ''; r.codigo = '';
        if (!inquilino && b.alCrear) b.alCrear(r.inquilino);
        if (alEmitir) alEmitir(r);
        b.actualizarVista();
      }, function (e) {
        if (!vigente()) return;
        b.ocupado = false; b.estado = resultado.textContent = errorTexto(e); b.actualizarVista();
      });
    } });
    if (!inquilino) {
      form.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nombre'), nombre));
      form.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Correo de la comunidad'), correo));
    }
    form.appendChild(h('label', { class: 'org-correo-opcion' }, enviar, h('span', null, 'Enviar correo de bienvenida desde la cuenta del Organismo')));
    form.appendChild(aviso);
    form.appendChild(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Mensaje de bienvenida'), texto));
    form.appendChild(h('div', { class: 'acciones' }, copiar, restablecer, boton)); form.appendChild(resultado);
    b.alCrear = alCrear;
    b.actualizarVista = function () { texto.value = b.texto; resultado.textContent = b.estado; sincronizar(); };
    limpiarFormularios.push(function () {
      nombre.value = ''; correo.value = ''; texto.value = ''; resultado.textContent = ''; aviso.textContent = '';
      enviar.checked = false; boton.disabled = true; copiar.disabled = true; restablecer.disabled = true;
    });
    sincronizar();
    if (plantillaActual) actualizar();
    else Promise.resolve().then(function () { return org.plantillaCorreo(); }).then(function (r) {
      if (!vigente()) return;
      plantillaActual = r; actualizar(); sincronizar();
    }, function (e) { if (vigente()) aviso.textContent = errorTexto(e); });
    return form;
  }
  function vistaComunidades(datos) {
    var cuenta = resumenEstados(datos), orden = Object.keys(E.ESTADOS).sort(function (a, b) { return E.ESTADOS[a].orden - E.ESTADOS[b].orden; });
    /* cada cifra de arriba es un filtro: al tocarla se ven solo las comunidades de ese estado; otra vez, se quita el filtro */
    var filtro = null, tiraEl = h('div', { class: 'estado-resumen' }), listaEl = h('div');
    function fila(d) {
      /* comunidad cuyo estado no se pudo leer (p. ej. recién creada, sin copia): fila sin cifras y el resto de la lista sigue */
      if (!d.ev) return h('li', null, h('div', { class: 'com-fila sin-copia' }, h('div', { class: 'com-cab' }, h('strong', { class: 'com-nombre' }, d.c.nombre)),
        h('p', { class: 'com-motivo' }, d.error && d.error.code === 'SIN_COPIA' ? 'Sin copia todavía' : mensajeError(d.error && d.error.code))));
      var ev = d.ev, fase = ev.fase ? ev.fase.name : '';
      return h('li', null, h('a', { class: 'com-fila', href: '#/o/c/' + encodeURIComponent(d.c.id), target: '_blank', rel: 'noopener' },
        h('div', { class: 'com-cab' }, h('strong', { class: 'com-nombre' }, d.c.nombre), pillEstado(ev.estado)),
        h('p', { class: 'com-motivo' }, ev.motivo),
        h('div', { class: 'com-pie' }, h('span', { class: 'com-fase' }, fase),
          h('span', { class: 'com-pct' }, h('span', { class: 'cifra-sm' }, pctTexto(ev.presupuesto.porcentaje)), ' rendido'), barra(ev.presupuesto.porcentaje))));
    }
    function pintar() {
      U.clear(tiraEl); U.clear(listaEl);
      orden.forEach(function (id) {
        tiraEl.appendChild(h('button', { type: 'button', class: 'estado-cifra ' + id + (filtro === id ? ' on' : ''), 'aria-pressed': filtro === id ? 'true' : 'false',
          onclick: function () { filtro = filtro === id ? null : id; pintar(); } },
          h('span', { class: 'cifra' }, String(cuenta[id] || 0)), h('span', { class: 'cifra-t' }, E.ESTADOS[id].label)));
      });
      var visibles = filtro ? datos.filter(function (d) { return d.ev && d.ev.estado.id === filtro; }) : datos;
      listaEl.appendChild(visibles.length ? h('ul', { class: 'com-lista' }, visibles.map(fila))
        : UI.empty(filtro ? 'Ninguna comunidad está en ese estado. Toca la cifra otra vez para ver todas.' : 'Todavía no hay comunidades activas.'));
    }
    pintar();
    var vista = h('div', { class: 'view panel-org' },
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Comunidades'),
        h('p', { class: 'lead' }, 'Cada comunidad, con su estado según el Manual de Rendición. Toca una cifra para filtrar; toca una comunidad para ver su desglose.')),
      h('section', { class: 'panel-sec' }, h('h2', { class: 'card-title' }, 'Nueva comunidad'), formularioCorreo(null, function (c) {
        datos.push({ c: c, ev: null, error: { code: 'SIN_COPIA' } }); pintar();
      })), tiraEl, listaEl);
    vista.actualizarDatos = function (nuevos) { datos = nuevos; cuenta = resumenEstados(datos); pintar(); };
    return vista;
  }

  function vistaDetalle(d) {
    var ev = d.ev, c = d.c, activa = c.estado === 'activa';
    var proyectos = h('div', { class: 'table-scroll' }, h('table', { class: 'plain-grid' },
      h('thead', null, h('tr', null, h('th', null, 'Proyecto'), h('th', null, 'Fase'), h('th', null, 'Estado'), h('th', { class: 'r' }, 'Rendido / aprobado'))),
      h('tbody', null, ev.proyectos.map(function (p) {
        /* el proyecto de gastos administrativos va con otro color: no es un proyecto de obra o de servicio */
        return h('tr', { class: p.esAdministracion ? 'fila-admin' : '' }, h('td', null, p.nombre, p.esAdministracion ? h('span', { class: 'tag-admin' }, 'Aparte') : null), h('td', null, p.fase.name), h('td', null, pillEstado(p.estado)),
          h('td', { class: 'r' }, U.fmtCLP(p.presupuesto.rendido) + ' / ' + U.fmtCLP(p.presupuesto.aprobado)));
      }))));
    var abiertas = [];
    ev.proyectos.forEach(function (p) { p.observaciones.forEach(function (o) { abiertas.push({ proyecto: p.nombre, o: o }); }); });
    var obsBox = abiertas.length ? h('ul', { class: 'obs-lista' }, abiertas.map(function (x) {
      return h('li', null, h('strong', null, x.o.titulo || 'Observación sin título'), ' · ', x.proyecto,
        h('span', { class: 'obs-plazo' + (x.o.vencida ? ' vencida' : '') }, x.o.vencida ? 'Venció el ' + fechaTexto(x.o.plazo) : 'Plazo: ' + fechaTexto(x.o.plazo)));
    })) : UI.empty('No hay observaciones de CORFO sin responder.');
    var registro = (d.registro || []).length ? h('ul', { class: 'reg-lista' }, d.registro.map(function (r) {
      return h('li', null, h('span', { class: 'reg-t' }, fechaTexto(String(r.t || '').slice(0, 10))), h('span', null, r.texto));
    })) : UI.empty('No hay cambios registrados todavía.');
    var zonaAccion = h('div', { class: 'acciones' });
    var mensaje = h('p', { class: 'nota-accion', role: 'status' });
    var btnTicket = h('button', { type: 'button', id: 'btn-entrar', class: 'btn primary', disabled: !activa, title: activa ? '' : 'La comunidad todavía no activa su cuenta.' }, 'Entrar a su cuenta');
    btnTicket.onclick = function () {
      btnTicket.disabled = true; mensaje.textContent = 'Pidiendo el acceso…';
      org.ticket(c.id).then(function (r) {
        root.open(org.urlComunidad(c.id) + '#ticket=' + encodeURIComponent(r.ticket), '_blank', 'noopener');
        /* Con noopener, null no permite saber si el navegador bloqueó la pestaña. */
        mensaje.textContent = 'Se solicitó abrir su sitio. Si no aparece, permita ventanas emergentes para este sitio. El acceso dura dos minutos y se usa una sola vez. Queda registrado.';
        btnTicket.disabled = !activa;
      }, function (e) { mensaje.textContent = mensajeError(e && e.code); btnTicket.disabled = !activa; });
    };
    zonaAccion.appendChild(btnTicket);
    var correoComunidad = h('input', { type: 'email', required: true, maxlength: 120, 'aria-label': 'Correo de la comunidad' });
    correoComunidad.value = c.correo || '';
    var estadoCorreo = h('p', { class: 'nota-accion', role: 'status' });
    var guardarCorreo = h('button', { type: 'button', class: 'btn' }, 'Guardar correo');
    guardarCorreo.onclick = function () {
      guardarCorreo.disabled = true;
      org.guardarCorreo(c.id, correoComunidad.value).then(function (r) {
        c.correo = r.inquilino.correo; correoComunidad.value = c.correo;
        estadoCorreo.textContent = 'Correo guardado'; guardarCorreo.disabled = false;
      }, function (e) {
        estadoCorreo.textContent = { CORREO_INVALIDO: 'Escriba un correo válido de hasta 120 caracteres.', CORREO_EXISTENTE: 'Ese correo ya está registrado en otra comunidad.' }[e && e.code] || mensajeError(e && e.code);
        guardarCorreo.disabled = false;
      });
    };
    return h('div', { class: 'view panel-org' },
      h('a', { class: 'btn ghost small back', href: '#/o/comunidades' }, UI.icon('left', 16), 'Comunidades'),
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, c.nombre), h('div', { class: 'det-estado' }, pillEstado(ev.estado), h('span', { class: 'det-motivo' }, ev.motivo))),
      h('section', { class: 'panel-sec' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Correo de la comunidad'), correoComunidad), guardarCorreo, estadoCorreo),
      h('div', { class: 'kpi-tira' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-n' }, pctTexto(ev.presupuesto.porcentaje)), h('span', { class: 'kpi-t' }, 'Presupuesto rendido'), barra(ev.presupuesto.porcentaje)),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-n' }, String(abiertas.length)), h('span', { class: 'kpi-t' }, 'Observaciones sin responder')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-n' }, ev.diasSinMovimiento == null ? '—' : String(ev.diasSinMovimiento)), h('span', { class: 'kpi-t' }, 'Días desde el último cambio'))),
      h('section', { class: 'panel-sec', id: 'sec-presupuesto' }, h('h2', { class: 'card-title' }, 'Presupuesto por cuenta'), graficoCuentas(d.estado || { projects: [] })),
      h('section', { class: 'panel-sec', id: 'sec-proyectos' }, h('h2', { class: 'card-title' }, 'Proyectos'), proyectos),
      h('section', { class: 'panel-sec', id: 'sec-observaciones' }, h('h2', { class: 'card-title' }, 'Observaciones de CORFO'), obsBox),
      h('section', { class: 'panel-sec', id: 'sec-acciones' }, h('h2', { class: 'card-title' }, 'Acciones'), zonaAccion, mensaje, formularioCorreo(c),
        h('p', { class: 'nota-accion' }, 'Entrar a su cuenta pide un acceso de un solo uso que dura dos minutos y queda registrado. La comunidad sigue pidiendo su clave en su propio sitio.')),
      h('details', { class: 'panel-sec panel-det' }, h('summary', { class: 'card-title' }, 'Registro de cambios de esta comunidad'), registro));
  }

  function vistaCodigos(codigos) {
    var mensaje = h('p', { class: 'nota-accion', role: 'status' });
    var filas = codigos.map(function (c) {
      /* el backend decide el tipo: alta si la comunidad está pendiente, reinicio si ya está activa (para recuperar su acceso) */
      var activa = c.estado === 'activa';
      var generar = h('button', { type: 'button', class: 'btn small' }, activa ? 'Generar código de reinicio' : 'Generar Código de primer ingreso');
      var btn = h('button', { type: 'button', class: 'btn small' }, 'Reenviar código');
      var zonaCorreo = h('div');
      var tdEstado = h('td', null, ETIQUETA_CODIGO[c.estado] || c.estado), tdVence = h('td', null, fechaTexto(c.vence));
      generar.onclick = function () {
        if (activa && !(root.confirm && root.confirm('¿Generar un código de reinicio para ' + c.nombre + '? Sirve una sola vez, vence a los 30 días y deja sin efecto los códigos anteriores de esta comunidad.'))) return;
        generar.disabled = true; mensaje.textContent = 'Generando…';
        org.generarCodigo(c.id).then(function (r) {
          U.clear(mensaje);
          mensaje.appendChild(h('strong', { class: 'codigo-una-vez' }, r.codigo));
          mensaje.appendChild(document.createTextNode(' · Cópialo ahora: solo se muestra una vez. Vence el ' + fechaTexto(r.vence) + ' y sirve una sola vez para ' + c.nombre + (activa ? ' (reinicio de la cuenta).' : '.')));
          entregaSecreta(mensaje, r.codigo); r.codigo = '';
          if (!activa) tdEstado.textContent = ETIQUETA_CODIGO.sin_activar;
          tdVence.textContent = fechaTexto(r.vence);
          generar.disabled = false;
        }, function (e) { mensaje.textContent = mensajeError(e && e.code); generar.disabled = false; });
      };
      btn.onclick = function () {
        /* un código de reinicio deja sin efecto los anteriores de la comunidad: se pide confirmar antes (mismo recurso que al borrar una nota) */
        if (activa && !(root.confirm && root.confirm('¿Reenviar un código de reinicio para ' + c.nombre + '? Sirve una sola vez, vence a los 30 días y deja sin efecto los códigos anteriores de esta comunidad.'))) return;
        U.clear(zonaCorreo);
        zonaCorreo.appendChild(formularioCorreo(c, null, function (r) {
          if (!activa) tdEstado.textContent = ETIQUETA_CODIGO.sin_activar;
          tdVence.textContent = fechaTexto(r.vence);
        }));
      };
      var desbloquear = h('button', { type: 'button', class: 'btn small', onclick: function () {
        desbloquear.disabled = true;
        org.post('panelDesbloquearComunidad', { inquilino: c.id }).then(function () {
          mensaje.textContent = 'Acceso desbloqueado. La acción quedó registrada.';
        }, function (e) { mensaje.textContent = mensajeError(e && e.code); }).finally(function () { desbloquear.disabled = false; });
      } }, 'Desbloquear acceso');
      return h('tr', null, h('td', null, c.nombre), tdEstado, tdVence, h('td', null, generar, btn, activa ? desbloquear : null, zonaCorreo));
    });
    var tabla = codigos.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'plain-grid' },
      h('thead', null, h('tr', null, h('th', null, 'Comunidad'), h('th', null, 'Estado'), h('th', null, 'Vence'), h('th', null, ''))),
      h('tbody', null, filas))) : UI.empty('No hay comunidades cargadas.');
    return h('div', { class: 'view panel-org' },
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Códigos de primer ingreso'),
        h('p', { class: 'lead' }, 'Cada código sirve una sola vez y vence a los 30 días. Se muestra completo solo al generarlo; después el servicio guarda únicamente una huella (hash), no el código.')),
      tabla, mensaje);
  }

  function vistaNotas(notas, comunidades) {
    var lista = notas.length ? h('ul', { class: 'notas-lista' }, notas.map(function (n) {
      var nombre = n.inq ? ((comunidades.filter(function (c) { return c.id === n.inq; })[0] || {}).nombre || n.inq) : 'General';
      var hecha = n.estado === 'hecha';
      var marcar = h('button', { type: 'button', class: 'btn ghost small' }, hecha ? 'Reabrir' : 'Marcar hecha');
      var borrar = h('button', { type: 'button', class: 'btn ghost small' }, 'Borrar');
      marcar.onclick = function () { org.guardarNota({ id: n.id, inquilino: n.inq, texto: n.texto, estado: hecha ? 'abierta' : 'hecha' }).then(function () { RF.app.render(); }); };
      borrar.onclick = function () { if (root.confirm && !root.confirm('¿Borrar esta nota?')) return; org.borrarNota(n.id).then(function () { RF.app.render(); }); };
      return h('li', { class: 'nota' + (hecha ? ' hecha' : '') }, h('span', { class: 'nota-com' }, nombre), h('p', null, n.texto),
        h('div', { class: 'nota-acc' }, marcar, borrar));
    })) : UI.empty('Todavía no hay notas. Sirven para organizarte: a una comunidad o para ti.');
    var texto = h('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Texto de la nota', placeholder: 'Ej.: llamar la próxima semana por la observación de la boleta' });
    var sel = h('select', { 'aria-label': 'Comunidad de la nota' }, [h('option', { value: '' }, 'General (para mí)')].concat(comunidades.map(function (c) { return h('option', { value: c.id }, c.nombre); })));
    var err = h('p', { class: 'nota-accion', role: 'status' });
    var form = h('form', { class: 'nota-form', onsubmit: function (ev) {
      ev.preventDefault();
      if (!texto.value.trim()) { err.textContent = 'Escriba la nota.'; return; }
      org.guardarNota({ inquilino: sel.value || null, texto: texto.value.trim(), estado: 'abierta' }).then(function () { RF.app.render(); }, function (e) { err.textContent = mensajeError(e && e.code); });
    } }, sel, texto, h('button', { type: 'submit', class: 'btn primary' }, 'Agregar nota'), err);
    return h('div', { class: 'view panel-org' },
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Notas'),
        h('p', { class: 'lead' }, 'Para organizarte con el equipo y con cada comunidad. Solo las ve el Organismo.')),
      form, lista);
  }

  function vistaRegistro(entradas) {
    var lista = entradas.length ? h('ul', { class: 'reg-lista amplia' }, entradas.map(function (r) {
      return h('li', null, h('span', { class: 'reg-t' }, fechaTexto(String(r.t || '').slice(0, 10))), h('span', null, r.comunidad ? r.comunidad + ' · ' : '', r.texto));
    })) : UI.empty('No hay cambios registrados.');
    return h('div', { class: 'view panel-org' },
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Registro de cambios'),
        h('p', { class: 'lead' }, 'Lo que hizo el Organismo en cada comunidad, y las entradas y accesos, con fecha y hora. No se envía aviso a las comunidades.')),
      lista);
  }

  /* ---------- carga y montaje ---------- */
  function cargar(ruta) {
    var f = org.fuente, sub = ruta.sub || 'comunidades';
    if (sub === 'codigos') return f.codigos();
    if (sub === 'registro') return f.registro();
    if (sub === 'notas') return Promise.all([f.notas(), f.comunidades()]);
    if (sub === 'c' || ruta.id) {
      return f.comunidades().then(function (lista) {
        var c = lista.filter(function (x) { return x.id === ruta.id; })[0];
        if (!c) throw new Error('No encontramos esa comunidad.');
        return Promise.all([f.estado(c.id), f.registro(c.id)]).then(function (datos) {
          return { c: c, ev: E.evaluarComunidad(datos[0]), registro: datos[1], estado: datos[0] };
        });
      });
    }
    return f.comunidades().then(function (lista) {
      /* Una comunidad sin copia no rechaza la lista entera. */
      return Promise.all(lista.map(function (c) {
        return f.estado(c.id).then(function (st) { return { c: c, ev: E.evaluarComunidad(st) }; })
          .catch(function (e) { return { c: c, ev: null, error: e || {} }; });
      }));
    });
  }
  function pintarRuta(ruta, datos) {
    var sub = ruta.sub || 'comunidades';
    if (sub === 'codigos') return vistaCodigos(datos);
    if (sub === 'registro') return vistaRegistro(datos);
    if (sub === 'notas') return vistaNotas(datos[0], datos[1]);
    if (sub === 'c' || ruta.id) return vistaDetalle(datos);
    return vistaComunidades(datos);
  }
  org.vista = function (ruta) {
    borrarEntregas();
    if (!org.esOrganismo()) return h('div', { class: 'view' }, UI.callout('bad', 'Esta parte es solo para el Organismo Colaborador.', ''));
    var version = sesionVersion, montaje = ++vistaVersion, key = (ruta.sub || 'comunidades') + ':' + (ruta.id || '');
    var guardada = Object.prototype.hasOwnProperty.call(cacheVistas, key), vista;
    var host = h('div', { class: 'view panel-org' });
    if (guardada) { vista = pintarRuta(ruta, cacheVistas[key]); host.appendChild(vista); }
    else host.appendChild(h('p', { class: 'lead' }, 'Cargando…'));
    if (!cargas[key]) cargas[key] = cargar(ruta).then(function (datos) {
      if (version === sesionVersion) { cacheVistas[key] = datos; delete cargas[key]; }
      return datos;
    }, function (e) { if (version === sesionVersion) delete cargas[key]; throw e; });
    cargas[key].then(function (datos) {
      if (version !== sesionVersion || montaje !== vistaVersion) return;
      if (vista && vista.actualizarDatos) vista.actualizarDatos(datos);
      else { U.clear(host); vista = pintarRuta(ruta, datos); host.appendChild(vista); }
    }, function (e) {
      if (version !== sesionVersion || montaje !== vistaVersion) return;
      if (e && e.code === 'SESION_INVALIDA') { org.cerrar(); if (RF.app) RF.app.render(); return; }
      // Un fallo al refrescar conserva la vista ya disponible.
      if (guardada) return;
      U.clear(host);
      host.appendChild(UI.callout('bad', 'No se pudo cargar esta parte del panel.', ' ' + mensajeError(e && e.code) + ' Intente de nuevo en un momento.'));
    });
    return host;
  };

  /* ruta del panel desde el hash: #/o/comunidades, #/o/codigos, #/o/notas, #/o/registro, #/o/c/<id> */
  org.ruta = function (partes) {
    var sub = partes[1] || 'comunidades';
    if (sub === 'c' && partes[2]) return { name: 'organismo', sub: 'c', id: decodeURIComponent(partes[2]) };
    return { name: 'organismo', sub: SECCIONES.some(function (s) { return s.id === sub; }) ? sub : 'comunidades' };
  };
  org.SECCIONES = SECCIONES;
})(typeof window !== 'undefined' ? window : globalThis);
