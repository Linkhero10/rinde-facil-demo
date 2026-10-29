/* Rinde Fácil — barra inferior del celular: dos accesos a cada lado y «Subir documento» al centro.
 * Solo se ve en pantallas angostas (CSS). Con rol de Organismo, el centro lleva a las comunidades.
 * Con rol de Organismo, al abrir una comunidad la barra se desliza y muestra sus accesos (la segunda página);
 * se cambia de página deslizando con el dedo. La comunidad no tiene esta función. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var U = RF.util, UI = RF.ui, h = U.h;

  /* página visible de la barra del Organismo (0 = Panel, 1 = la comunidad abierta) y la comunidad que la muestra */
  var pagina = 0, comunidadVista = null;

  function activo(href) {
    var actual = location.hash || '#/';
    if (href === '#/h/gastos' && /[?&]nuevo=1(?:&|$)/.test(actual)) return false;
    if (href === '#/') return actual === '#/' || actual === '';
    return actual.indexOf(href) === 0;
  }
  function enlace(item) {
    var on = activo(item.href);
    return h('a', { href: item.href, class: 'tb-item' + (item.centro ? ' tb-centro' : '') + (on ? ' on' : ''), 'aria-current': on ? 'page' : null },
      UI.icon(item.icon, 22), h('span', { class: 'tb-t' }, item.label));
  }
  function boton(item) {
    return h('button', { type: 'button', class: 'tb-item' + (item.centro ? ' tb-centro' : ''), onclick: item.onclick },
      UI.icon(item.icon, 22), h('span', { class: 'tb-t' }, item.label));
  }
  function menu() {
    return h('button', { type: 'button', class: 'tb-item tb-menu', 'aria-label': 'Abrir el menú completo', onclick: function () {
      var b = document.querySelector('.menu-btn'); if (b) b.click();
    } }, UI.icon('menu', 22), h('span', { class: 'tb-t' }, 'Más'));
  }
  function irA(id) {
    var el = document.getElementById(id);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* página 0: el panel del Organismo (comunidades, códigos, registro) */
  function paginaPanel() {
    var izq = [{ href: '#/o/codigos', icon: 'shield', label: 'Códigos' }];
    var centro = { href: '#/o/comunidades', icon: 'list', label: 'Panel', centro: true };
    var der = [{ href: '#/o/registro', icon: 'calendar', label: 'Registro' }];
    return h('div', { class: 'tb-page' }, izq.map(enlace).concat([enlace(centro)], der.map(enlace), [menu()]));
  }
  /* página 1: accesos a la comunidad abierta; «Entrar» usa el mismo botón de la pantalla (pide el acceso de un solo uso) */
  function paginaComunidad() {
    var izq = [
      { icon: 'list', label: 'Proyectos', onclick: function () { irA('sec-proyectos'); } },
      { icon: 'alert', label: 'Pendientes', onclick: function () { irA('sec-observaciones'); } }
    ];
    var centro = { icon: 'shield', label: 'Entrar', centro: true, onclick: function () {
      var b = document.getElementById('btn-entrar'); if (b && !b.disabled) b.click();
    } };
    var der = [{ icon: 'money', label: 'Cuentas', onclick: function () { irA('sec-presupuesto'); } }];
    return h('div', { class: 'tb-page tb-comunidad' }, izq.map(boton).concat([boton(centro)], der.map(boton), [menu()]));
  }

  /* coloca las páginas: «indice» es la visible; «dx» mueve el conjunto con el dedo. Las inactivas se ocultan en reposo */
  function colocar(paginas, indice, dx, animado) {
    var ancho = paginas[0].parentNode.getBoundingClientRect().width || 360;
    paginas.forEach(function (p, i) {
      p.inert = i !== indice;
      p.setAttribute('aria-hidden', i === indice ? 'false' : 'true');
      p.style.transition = animado ? 'transform .25s ease' : 'none';
      p.style.transform = 'translateX(' + ((i - indice) * ancho + dx) + 'px)';
      p.style.visibility = (i === indice || dx || animado) ? 'visible' : 'hidden';
    });
  }
  function deslizar(barra, paginas) {
    var x0 = null, y0 = null, horizontal = null;
    function terminar(xFinal) {
      if (x0 === null) return;
      var dx = xFinal === null ? 0 : xFinal - x0;
      x0 = null;
      if (horizontal && xFinal !== null) {
        if (dx < -50 && pagina < paginas.length - 1) pagina++;
        else if (dx > 50 && pagina > 0) pagina--;
      }
      colocar(paginas, pagina, 0, true);
      setTimeout(function () { colocar(paginas, pagina, 0, false); }, 260);
    }
    function iniciar(x, y) {
      x0 = x; y0 = y; horizontal = null;
      colocar(paginas, pagina, 0, false);
    }
    function mover(x, y) {
      if (x0 === null) return;
      var dx = x - x0, dy = y - y0;
      if (horizontal === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (!horizontal) return;
      if ((dx < 0 && pagina >= paginas.length - 1) || (dx > 0 && pagina <= 0)) dx = dx / 3;
      colocar(paginas, pagina, dx, false);
    }
    if (root.PointerEvent) {
      var pointerId = null, arrastrado = false;
      barra.addEventListener('pointerdown', function (ev) {
        if (ev.isPrimary === false || ev.button !== 0) return;
        pointerId = ev.pointerId; arrastrado = false; iniciar(ev.clientX, ev.clientY);
      });
      barra.addEventListener('pointermove', function (ev) {
        if (ev.pointerId !== pointerId || x0 === null) return;
        mover(ev.clientX, ev.clientY);
        if (horizontal) {
          arrastrado = true;
          if (barra.setPointerCapture) barra.setPointerCapture(pointerId);
        }
      });
      function soltar(ev, cancelado) {
        if (ev.pointerId !== pointerId) return;
        terminar(cancelado ? null : ev.clientX);
        if (cancelado) arrastrado = false;
        if (barra.hasPointerCapture && barra.hasPointerCapture(pointerId)) barra.releasePointerCapture(pointerId);
        pointerId = null;
      }
      barra.addEventListener('pointerup', function (ev) { soltar(ev, false); });
      barra.addEventListener('pointercancel', function (ev) { soltar(ev, true); });
      barra.addEventListener('lostpointercapture', function (ev) { soltar(ev, true); });
      barra.addEventListener('click', function (ev) {
        if (arrastrado) { ev.preventDefault(); ev.stopPropagation(); arrastrado = false; }
      }, true);
    } else {
      barra.addEventListener('touchstart', function (ev) { iniciar(ev.touches[0].clientX, ev.touches[0].clientY); }, { passive: true });
      barra.addEventListener('touchmove', function (ev) { mover(ev.touches[0].clientX, ev.touches[0].clientY); }, { passive: true });
      barra.addEventListener('touchend', function (ev) { terminar(ev.changedTouches[0].clientX); });
      barra.addEventListener('touchcancel', function () { terminar(null); });
    }
    barra.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      pagina = Math.max(0, Math.min(paginas.length - 1, pagina + (ev.key === 'ArrowRight' ? 1 : -1)));
      colocar(paginas, pagina, 0, false);
      barra.focus();
    });
  }

  /* barra de dos páginas (solo Organismo, dentro de una comunidad). Al abrir la comunidad, se desliza desde el panel */
  function barraDoble(entrando) {
    var paginas = [paginaPanel(), paginaComunidad()];
    var barra = h('nav', { class: 'tabbar tb-pager', tabindex: '0', 'aria-label': 'Accesos rápidos' }, paginas);
    /* la barra aún no está en la pantalla: se coloca al siguiente cuadro, con su ancho real. Al entrar, se desliza desde el panel */
    colocar(paginas, entrando ? 0 : pagina, 0, false);
    requestAnimationFrame(function () {
      colocar(paginas, pagina, 0, entrando);
      /* al terminar la entrada, la página que no está visible se oculta (no se puede tocar ni enfocar) */
      if (entrando) setTimeout(function () { colocar(paginas, pagina, 0, false); }, 260);
    });
    deslizar(barra, paginas);
    return barra;
  }

  RF.tabbar = function (ruta) {
    var organismo = !!(RF.organismo && RF.organismo.esOrganismo && RF.organismo.esOrganismo());
    var enComunidad = organismo && !!ruta && ruta.sub === 'c' && !!ruta.id;
    if (enComunidad) {
      var entrando = comunidadVista !== ruta.id;
      if (entrando) { comunidadVista = ruta.id; pagina = 1; }
      return barraDoble(entrando);
    }
    comunidadVista = null; pagina = 0;
    var izq, centro, der;
    if (organismo) {
      izq = [{ href: '#/o/codigos', icon: 'shield', label: 'Códigos' }];
      centro = { href: '#/o/comunidades', icon: 'list', label: 'Panel', centro: true };
      der = [{ href: '#/o/registro', icon: 'calendar', label: 'Registro' }];
    } else {
      izq = [{ href: '#/', icon: 'home', label: 'Hoy' }, { href: '#/h/gastos', icon: 'money', label: 'Gastos' }];
      centro = { href: '#/h/gastos?nuevo=1', icon: 'plus', label: '+ Gasto', centro: true };
      der = [{ href: '#/h/revision', icon: 'check', label: 'Rendición' }];
    }
    var lista = izq.map(enlace).concat([enlace(centro)], der.map(enlace), [menu()]);
    return h('nav', { class: 'tabbar', 'aria-label': 'Accesos rápidos' }, lista);
  };
})(typeof window !== 'undefined' ? window : globalThis);
