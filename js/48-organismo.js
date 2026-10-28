/* Rinde Fácil — panel del Organismo Colaborador: acceso, comunidades, detalle, códigos de activación, entrada asistida, notas y registro.
 * Solo se muestra con sesión del Organismo (su clave se deriva en el navegador; el servicio nunca recibe la clave).
 * Los datos vienen del servicio central (acciones panel* de backend/Organismo.gs). Sin servicio conectado no se muestran cifras. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var U = RF.util, UI = RF.ui, h = U.h, E = RF.estado;
  var org = RF.organismo = RF.organismo || {};

  org.rol = null;    /* 'organismo' con sesión; si no, null */
  org.token = null;  /* sesión del Organismo: solo en memoria, nunca en el almacenamiento del navegador */
  org.url = null;    /* dirección del servicio central aprobada */
  org.fuente = null; /* { comunidades(), estado(id), registro(id?), codigos(), notas(id?) } */

  org.esOrganismo = function () { return org.rol === 'organismo' && !!org.token; };

  /* comunidad de esta dirección: «ejemplo.localhost» o «ejemplo.rinde-facil.cl» → «ejemplo»; si no, null (sitio de acceso) */
  org.inquilinoDeHost = function () {
    var host = (root.location && root.location.hostname) || '';
    var m = /^([a-z0-9-]+)\.(localhost|rinde-facil\.cl)$/.exec(host);
    return m && m[1] !== 'www' ? m[1] : null;
  };
  /* dirección de la comunidad, para abrir su sitio desde el panel */
  org.urlComunidad = function (id) {
    var local = /localhost$/.test((root.location && root.location.hostname) || '');
    var port = (root.location && root.location.port) ? ':' + root.location.port : '';
    return local ? 'http://' + id + '.localhost' + port + '/' : 'https://' + id + '.rinde-facil.cl/';
  };

  var SECCIONES = [
    { id: 'comunidades', label: 'Comunidades', icon: 'list', ruta: '#/o/comunidades' },
    { id: 'codigos', label: 'Códigos de activación', icon: 'shield', ruta: '#/o/codigos' },
    { id: 'notas', label: 'Notas', icon: 'file', ruta: '#/o/notas' },
    { id: 'registro', label: 'Registro de cambios', icon: 'calendar', ruta: '#/o/registro' }
  ];
  var ETIQUETA_CODIGO = { sin_activar: 'Sin activar', activa: 'Activa', sin_codigo: 'Sin código vigente' };

  function mensajeError(code) {
    var m = {
      SESION_INVALIDA: 'Tu sesión venció. Vuelve a entrar.',
      SESION_CERRADA: 'La sesión del panel se cerró. Vuelve a entrar.',
      CREDENCIALES_INVALIDAS: 'La clave no es correcta.',
      BLOQUEADO: 'Demasiados intentos. Espera un rato.',
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
    org.url = url;
    org.token = token;
    org.rol = 'organismo';
    var post = function (accion, datos) {
      /* el token vive solo en org.token: al cerrar se borra y estas llamadas (también las guardadas en los closures) fallan */
      if (!org.token) return Promise.reject(Object.assign(new Error(mensajeError('SESION_CERRADA')), { code: 'SESION_CERRADA' }));
      return RF.cloud.postRawTo(org.url, accion, Object.assign({ t: org.token }, datos || {})).then(function (r) {
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
        return org.fuente.comunidades().then(function (lista) {
          return Promise.all(lista.slice(0, 50).map(function (c) { return org.fuente.registro(c.id).then(function (x) { return x.map(function (e) { return Object.assign(e, { comunidad: c.nombre }); }); }); }))
            .then(function (partes) { return [].concat.apply([], partes).sort(function (a, b) { return String(b.t).localeCompare(String(a.t)); }); });
        });
      },
      codigos: function () {
        return Promise.all([post('panelInquilinos'), post('panelCodigos')]).then(function (x) {
          var vigentes = x[1].codigos.filter(function (c) { return c.vigente; });
          return x[0].inquilinos.map(function (i) {
            var v = vigentes.filter(function (c) { return c.inquilino === i.id; })[0];
            return { id: i.id, nombre: i.nombre, estado: i.estado === 'activa' ? 'activa' : (v ? 'sin_activar' : 'sin_codigo'), vence: v ? v.vence : '' };
          });
        });
      },
      notas: function (id) { return post('panelNotas', id ? { inquilino: id } : {}).then(function (r) { return r.notas; }); }
    };
    org.generarCodigo = function (id) { return post('panelGenerarCodigo', { inquilino: id }); };
    org.ticket = function (id) { return post('panelTicket', { inquilino: id }); };
    org.guardarNota = function (nota) { return post('panelNotaGuardar', nota); };
    org.borrarNota = function (id) { return post('panelNotaBorrar', { id: id }); };
    org.crearComunidad = function (nombre, rut) { return post('panelInquilinoCrear', { nombre: nombre, rut: rut }); };
    return org.token;
  }
  function textoAcceso(tipo) {
    return { activacion: 'Una comunidad activó su cuenta', activacion_fallida: 'Intento fallido de activación', codigo_emitido: 'Se generó un código de activación',
      ticket_emitido: 'El Organismo pidió entrar a la cuenta', entrada_asistida: 'El Organismo entró a la cuenta de la comunidad', ticket_rechazado: 'Un ticket fue rechazado' }[tipo] || tipo;
  }

  /* El Organismo entra con su clave: primero se piden la sal y las iteraciones, luego se deriva la clave en el navegador. */
  org.entrar = function (clave, url, correo) {
    var u = url || (RF.cloud.approvedUrls && RF.cloud.approvedUrls()[0]);
    if (!u) return Promise.reject(Object.assign(new Error('El servicio central no está configurado en esta versión.'), { code: 'SIN_SERVICIO' }));
    return RF.cloud.postRawTo(u, 'challenge', { organismo: true }).then(function (ch) {
      if (!ch || ch.ok !== true || ch.exists !== true) throw Object.assign(new Error('La cuenta del Organismo todavía no está creada en el servicio.'), { code: 'SIN_CUENTA' });
      return RF.crypto.deriveKeys(clave, ch.saltP, ch.it).then(function (k) {
        return RF.cloud.postRawTo(u, 'loginOrganismo', { user: correo, authKey: k.authKey });
      });
    }).then(function (r) {
      /* el servicio sin acceso del Organismo (versión anterior) rechaza la acción como sesión vencida: se dice la causa real */
      if (r && r.error === 'SESION_INVALIDA') throw Object.assign(new Error('El servicio conectado es una versión anterior y todavía no tiene el acceso del Organismo. No es un problema de tu clave: hay que actualizar el servicio.'), { code: 'SERVICIO_ANTIGUO' });
      if (!r || r.ok !== true) throw Object.assign(new Error(mensajeError(r && r.error)), { code: r && r.error, retryAfter: r && r.retryAfter });
      conectar(u, r.token);
      return true;
    });
  };
  /* cerrar: el token se borra de este equipo y se revoca en el servicio (acción logout, la misma de las demás sesiones).
     Si el servicio no confirma, la sesión caduca sola y se avisa. */
  org.cerrar = function () {
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
    /* el correo y la clave los escribe quien entra: nada viene precargado en la página pública */
    var correo = h('input', { type: 'email', autocomplete: 'username', required: true, 'aria-label': 'Correo del Organismo' });
    var input = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Clave del Organismo' });
    /* botón para ver lo que se escribe, como en el acceso de la comunidad */
    var ver = h('button', { type: 'button', class: 'linklike', 'aria-label': 'Mostrar la clave' }, 'Mostrar');
    ver.onclick = function () { var oculta = input.type === 'password'; input.type = oculta ? 'text' : 'password'; ver.textContent = oculta ? 'Ocultar' : 'Mostrar'; ver.setAttribute('aria-label', oculta ? 'Ocultar la clave' : 'Mostrar la clave'); };
    var boton = h('button', { type: 'submit', class: 'btn primary big' }, 'Entrar al panel');
    var form = h('form', { class: 'auth-form', novalidate: true, onsubmit: function (ev) {
      ev.preventDefault(); err.textContent = '';
      if (!correo.value.trim()) { err.textContent = 'Escribe el correo del Organismo.'; return; }
      if (!input.value) { err.textContent = 'Escribe la clave del Organismo.'; return; }
      boton.disabled = true; boton.textContent = 'Entrando…';
      org.entrar(input.value, undefined, correo.value.trim()).then(function () { onOk(); }, function (e) {
        err.textContent = e && (e.code === 'SIN_CUENTA' || e.code === 'SERVICIO_ANTIGUO') ? e.message : mensajeError(e && e.code) + (e && e.retryAfter ? ' Vuelve a intentar en ' + Math.ceil(e.retryAfter / 60) + ' min.' : '');
        boton.disabled = false; boton.textContent = 'Entrar al panel';
      });
    } }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Correo del Organismo'), correo),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Clave'), h('span', { class: 'clave-campo' }, input, ver)), err, boton,
      h('button', { type: 'button', class: 'linklike', onclick: function () { org.mostrarAcceso = false; if (/^#\/?o(\/|\?|$)/.test(location.hash || '')) location.hash = '#/'; else if (RF.app) RF.app.render(); } }, 'Volver'));
    return h('div', { class: 'view auth-view panel-org' }, h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Panel del Organismo Colaborador'),
      h('p', { class: 'lead' }, 'Para ver las comunidades. Si tu comunidad quiere rendir, entra desde el sitio de tu comunidad.')), form);
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
  function vistaComunidades(datos) {
    var cuenta = resumenEstados(datos), orden = Object.keys(E.ESTADOS).sort(function (a, b) { return E.ESTADOS[a].orden - E.ESTADOS[b].orden; });
    /* cada cifra de arriba es un filtro: al tocarla se ven solo las comunidades de ese estado; otra vez, se quita el filtro */
    var filtro = null, tiraEl = h('div', { class: 'estado-resumen' }), listaEl = h('div');
    function fila(d) {
      /* comunidad cuyo estado no se pudo leer (p. ej. recién creada, sin copia): fila sin cifras y el resto de la lista sigue */
      if (!d.ev) return h('li', null, h('div', { class: 'com-fila sin-copia' }, h('div', { class: 'com-cab' }, h('strong', { class: 'com-nombre' }, d.c.nombre)),
        h('p', { class: 'com-motivo' }, d.error && d.error.code === 'SIN_COPIA' ? 'Sin copia todavía' : mensajeError(d.error && d.error.code))));
      var ev = d.ev, fase = ev.fase ? ev.fase.name : '';
      return h('li', null, h('a', { class: 'com-fila', href: '#/o/c/' + encodeURIComponent(d.c.id) },
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
    return h('div', { class: 'view panel-org' },
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Comunidades'),
        h('p', { class: 'lead' }, 'Cada comunidad, con su estado según el Manual de Rendición. Toca una cifra para filtrar; toca una comunidad para ver su desglose.')),
      tiraEl, listaEl);
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
        /* sin 'noopener' el navegador devuelve la pestaña, y así se sabe si se abrió; luego se corta el vínculo con el panel */
        var w = root.open(org.urlComunidad(c.id) + '#ticket=' + encodeURIComponent(r.ticket), '_blank');
        if (w) { try { w.opener = null; } catch (e) { /* el navegador no deja cambiarlo: la pestaña sigue abierta */ } }
        mensaje.textContent = w ? 'Se abrió su sitio. El acceso dura dos minutos y se usa una sola vez. Queda registrado.' : 'Tu navegador bloqueó la pestaña. Permite ventanas emergentes para este sitio.';
        btnTicket.disabled = !activa;
      }, function (e) { mensaje.textContent = mensajeError(e && e.code); btnTicket.disabled = !activa; });
    };
    zonaAccion.appendChild(btnTicket);
    return h('div', { class: 'view panel-org' },
      h('a', { class: 'btn ghost small back', href: '#/o/comunidades' }, UI.icon('left', 16), 'Comunidades'),
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, c.nombre), h('div', { class: 'det-estado' }, pillEstado(ev.estado), h('span', { class: 'det-motivo' }, ev.motivo))),
      h('div', { class: 'kpi-tira' },
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-n' }, pctTexto(ev.presupuesto.porcentaje)), h('span', { class: 'kpi-t' }, 'Presupuesto rendido'), barra(ev.presupuesto.porcentaje)),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-n' }, String(abiertas.length)), h('span', { class: 'kpi-t' }, 'Observaciones sin responder')),
        h('div', { class: 'kpi' }, h('span', { class: 'kpi-n' }, ev.diasSinMovimiento == null ? '—' : String(ev.diasSinMovimiento)), h('span', { class: 'kpi-t' }, 'Días desde el último cambio'))),
      h('section', { class: 'panel-sec', id: 'sec-presupuesto' }, h('h2', { class: 'card-title' }, 'Presupuesto por cuenta'), graficoCuentas(d.estado || { projects: [] })),
      h('section', { class: 'panel-sec', id: 'sec-proyectos' }, h('h2', { class: 'card-title' }, 'Proyectos'), proyectos),
      h('section', { class: 'panel-sec', id: 'sec-observaciones' }, h('h2', { class: 'card-title' }, 'Observaciones de CORFO'), obsBox),
      h('section', { class: 'panel-sec', id: 'sec-acciones' }, h('h2', { class: 'card-title' }, 'Acciones'), zonaAccion, mensaje,
        h('p', { class: 'nota-accion' }, 'Entrar a su cuenta pide un acceso de un solo uso que dura dos minutos y queda registrado. La comunidad sigue pidiendo su clave en su propio sitio.')),
      h('details', { class: 'panel-sec panel-det' }, h('summary', { class: 'card-title' }, 'Registro de cambios de esta comunidad'), registro));
  }

  function vistaCodigos(codigos) {
    var mensaje = h('p', { class: 'nota-accion', role: 'status' });
    var filas = codigos.map(function (c) {
      /* el backend decide el tipo: alta si la comunidad está pendiente, reinicio si ya está activa (para recuperar su acceso) */
      var activa = c.estado === 'activa';
      var btn = h('button', { type: 'button', class: 'btn small' }, activa ? 'Generar código de reinicio' : 'Generar código de activación');
      var tdEstado = h('td', null, ETIQUETA_CODIGO[c.estado] || c.estado), tdVence = h('td', null, fechaTexto(c.vence));
      btn.onclick = function () {
        /* un código de reinicio deja sin efecto los anteriores de la comunidad: se pide confirmar antes (mismo recurso que al borrar una nota) */
        if (activa && !(root.confirm && root.confirm('¿Generar un código de reinicio para ' + c.nombre + '? Sirve una sola vez, vence a los 30 días y deja sin efecto los códigos anteriores de esta comunidad.'))) return;
        btn.disabled = true; mensaje.textContent = 'Generando…';
        org.generarCodigo(c.id).then(function (r) {
          mensaje.innerHTML = '';
          mensaje.appendChild(h('strong', { class: 'codigo-una-vez' }, r.codigo));
          mensaje.appendChild(document.createTextNode(' · Cópialo ahora: solo se muestra una vez. Vence el ' + fechaTexto(r.vence) + ' y sirve una sola vez para ' + c.nombre + (activa ? ' (reinicio de la cuenta).' : '.')));
          /* la fila refleja el código nuevo sin recargar; el anterior queda sin efecto. Una comunidad activa sigue activa */
          if (!activa) tdEstado.textContent = ETIQUETA_CODIGO.sin_activar;
          tdVence.textContent = fechaTexto(r.vence);
          btn.disabled = false;
        }, function (e) { mensaje.textContent = mensajeError(e && e.code); btn.disabled = false; });
      };
      return h('tr', null, h('td', null, c.nombre), tdEstado, tdVence, h('td', null, btn));
    });
    var tabla = codigos.length ? h('div', { class: 'table-scroll' }, h('table', { class: 'plain-grid' },
      h('thead', null, h('tr', null, h('th', null, 'Comunidad'), h('th', null, 'Estado'), h('th', null, 'Vence'), h('th', null, ''))),
      h('tbody', null, filas))) : UI.empty('No hay comunidades cargadas.');
    return h('div', { class: 'view panel-org' },
      h('header', { class: 'panel-head' }, h('h1', { class: 'tool-title' }, 'Códigos de activación'),
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
      if (!texto.value.trim()) { err.textContent = 'Escribe la nota.'; return; }
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
    if (sub === 'codigos') return f.codigos().then(vistaCodigos);
    if (sub === 'registro') return f.registro().then(vistaRegistro);
    if (sub === 'notas') return f.comunidades().then(function (lista) { return f.notas().then(function (n) { return vistaNotas(n, lista); }); });
    if (sub === 'c' || ruta.id) {
      return f.comunidades().then(function (lista) {
        var c = lista.filter(function (x) { return x.id === ruta.id; })[0];
        if (!c) throw new Error('No encontramos esa comunidad.');
        return f.estado(c.id).then(function (st) {
          return f.registro(c.id).then(function (reg) {
            return vistaDetalle({ c: c, ev: E.evaluarComunidad(st), registro: reg, estado: st });
          });
        });
      });
    }
    return f.comunidades().then(function (lista) {
      /* cada comunidad por separado: una sin copia (SIN_COPIA) no rechaza la lista entera */
      return Promise.all(lista.map(function (c) {
        return f.estado(c.id).then(function (st) { return { c: c, ev: E.evaluarComunidad(st) }; }).catch(function (e) { return { c: c, ev: null, error: e || {} }; });
      })).then(vistaComunidades);
    });
  }

  org.vista = function (ruta) {
    if (!org.esOrganismo()) return h('div', { class: 'view' }, UI.callout('bad', 'Esta parte es solo para el Organismo Colaborador.', ''));
    var host = h('div', { class: 'view panel-org' }, h('p', { class: 'lead' }, 'Cargando…'));
    cargar(ruta).then(function (vista) { U.clear(host); host.appendChild(vista); }, function (e) {
      U.clear(host);
      if (e && e.code === 'SESION_INVALIDA') { org.cerrar(); if (RF.app) RF.app.render(); return; }
      host.appendChild(UI.callout('bad', 'No se pudo cargar esta parte del panel.', ' ' + mensajeError(e && e.code) + ' Intenta de nuevo en un momento.'));
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
