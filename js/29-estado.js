/* Rinde Fácil — estado de una comunidad para el panel del Organismo: semáforo con su motivo, fase y presupuesto rendido.
 * Solo cálculo, sin pantalla. Los estados vienen del Manual de Rendición (p. 10) y de las reglas que la app ya usa en las observaciones.
 * «Sin movimiento» NO viene del Manual: es una propuesta del equipo, marcada así. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  var U = RF.util, D = RF.data, L = RF.logic;

  var SIN_MOVIMIENTO_DIAS = 30; /* propuesta del equipo: a confirmar */
  var POR_VENCER_DIAS = 3;      /* mismo aviso que la pestaña «Observaciones de CORFO» */
  var ESTADOS = {
    atrasada: { id: 'atrasada', label: 'Atrasada', orden: 0, origen: 'Manual p. 10' },
    observada: { id: 'observada', label: 'Observada', orden: 1, origen: 'Manual p. 10' },
    sin_movimiento: { id: 'sin_movimiento', label: 'Sin movimiento', orden: 2, origen: 'Propuesta del equipo' },
    al_dia: { id: 'al_dia', label: 'Al día', orden: 3, origen: '' }
  };

  function num(x) { return Number(x) || 0; }

  /* Al entrar a una comunidad se muestra primero un proyecto de ejecución.
   * La administración sigue disponible para elegirla explícitamente después. */
  function proyectoInicial(state) {
    var projects = (state && state.projects) || [];
    var active = projects.filter(function (p) { return p.id === state.activeProjectId; })[0];
    if (active && !RF.store.esAdmin(active)) return active;
    return projects.filter(function (p) { return !RF.store.esAdmin(p); })[0] || projects[0] || null;
  }

  function faseInfo(id) {
    var f = (D.FASES || []).filter(function (x) { return x.id === id; })[0];
    return { id: id, name: f ? f.name : id };
  }

  /* observaciones de CORFO que siguen sin responder, con su plazo de aclaración */
  function observacionesAbiertas(project, hoy, feriados) {
    return (project.observations || []).filter(function (o) { return o && o.recibida && !o.respondida; }).map(function (o) {
      var plazo = L.aclaracionDeadline(o.recibida, feriados);
      var vencida = hoy > plazo;
      return {
        id: o.id,
        titulo: o.titulo || '',
        recibida: o.recibida,
        plazo: plazo,
        vencida: vencida,
        diasHabiles: vencida ? 0 : U.businessDaysBetween(hoy, plazo, feriados)
      };
    });
  }

  /* presupuesto aprobado frente a lo ya rendido, sumando las cuatro cuentas del Manual */
  function presupuesto(project) {
    var t = L.totalsByCuenta(project), aprobado = 0, rendido = 0;
    D.CUENTAS.forEach(function (c) { aprobado += num(t[c.id].aprobado); rendido += num(t[c.id].rendido); });
    return { aprobado: aprobado, rendido: rendido, porcentaje: aprobado > 0 ? Math.round(rendido * 100 / aprobado) : null };
  }

  /* fase según el flujo oficial de la app: sin PEA aprobado, subir el PEA; con observaciones abiertas, rendir y responder; si no, gastos */
  function faseDelProyecto(project, abiertas) {
    if (abiertas.length) return faseInfo('F5');
    if (!project.peaAprobado) return faseInfo('F2');
    return faseInfo('F4');
  }

  function evaluarProyecto(project, opts) {
    var hoy = opts.hoy, feriados = opts.feriados;
    var abiertas = observacionesAbiertas(project, hoy, feriados);
    var vencidas = abiertas.filter(function (o) { return o.vencida; });
    var estado = vencidas.length ? ESTADOS.atrasada : abiertas.length ? ESTADOS.observada : ESTADOS.al_dia;
    var motivo = 'Sin observaciones abiertas.';
    if (vencidas.length === 1) motivo = 'Una observación venció su plazo de aclaración el ' + U.fmtDate(vencidas[0].plazo) + '.';
    else if (vencidas.length > 1) motivo = vencidas.length + ' observaciones vencieron su plazo de aclaración.';
    else if (abiertas.length) {
      var cerca = abiertas.filter(function (o) { return o.diasHabiles <= POR_VENCER_DIAS; })[0];
      motivo = cerca ? 'Quedan ' + cerca.diasHabiles + ' día(s) hábil(es) para aclarar «' + (cerca.titulo || 'una observación') + '».' : abiertas.length + ' observación(es) dentro de plazo de aclaración.';
    }
    return {
      id: project.id,
      nombre: project.name || 'Proyecto sin nombre',
      /* mismo criterio que RF.store.esAdmin (02-store.js): este módulo lee copias sin migrar */
      esAdministracion: project.tipo === 'administracion' || /^gastos (administrativos|de administracion)( o indirectos)?$/.test(String(project.name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()),
      codigo: project.code || '',
      fase: faseDelProyecto(project, abiertas),
      estado: estado,
      motivo: motivo,
      observaciones: abiertas,
      presupuesto: presupuesto(project)
    };
  }

  /* última fecha (AAAA-MM-DD) en que la comunidad registró algún cambio */
  function ultimaActividad(state) {
    var ult = null;
    (state.activity || []).forEach(function (a) {
      var d = a && a.t ? String(a.t).slice(0, 10) : null;
      if (d && (!ult || d > ult)) ult = d;
    });
    return ult;
  }

  /* estado de la comunidad: el peor estado de sus proyectos; si no tiene problemas y lleva días sin cambios, «sin movimiento» */
  function evaluarComunidad(state, opts) {
    opts = opts || {};
    var hoy = opts.hoy || U.todayISO();
    var feriados = opts.feriados || state.holidays || [];
    var evalOpts = { hoy: hoy, feriados: feriados };
    var proyectos = (state.projects || []).map(function (p) { return evaluarProyecto(p, evalOpts); });
    var peor = null, aprobado = 0, rendido = 0, i;
    for (i = 0; i < proyectos.length; i++) {
      if (!peor || proyectos[i].estado.orden < peor.estado.orden) peor = proyectos[i];
      aprobado += proyectos[i].presupuesto.aprobado;
      rendido += proyectos[i].presupuesto.rendido;
    }
    var ult = ultimaActividad(state);
    var dias = ult ? U.diffDays(ult, hoy) : null;
    var estado = peor ? peor.estado : ESTADOS.sin_movimiento;
    var motivo = peor ? peor.motivo : 'Todavía no hay proyectos cargados.';
    if (estado.id === 'al_dia' && (dias === null || dias > SIN_MOVIMIENTO_DIAS)) {
      estado = ESTADOS.sin_movimiento;
      motivo = ult ? 'Sin cambios desde el ' + U.fmtDate(ult) + '.' : 'Todavía no hay cambios registrados.';
    }
    return {
      estado: estado,
      motivo: motivo,
      fase: peor ? peor.fase : faseInfo('F2'),
      proyectos: proyectos,
      presupuesto: { aprobado: aprobado, rendido: rendido, porcentaje: aprobado > 0 ? Math.round(rendido * 100 / aprobado) : null },
      ultimaActividad: ult,
      diasSinMovimiento: dias,
      hoy: hoy
    };
  }

  RF.estado = {
    proyectoInicial: proyectoInicial,
    SIN_MOVIMIENTO_DIAS: SIN_MOVIMIENTO_DIAS,
    POR_VENCER_DIAS: POR_VENCER_DIAS,
    ESTADOS: ESTADOS,
    observacionesAbiertas: observacionesAbiertas,
    presupuesto: presupuesto,
    faseDelProyecto: faseDelProyecto,
    ultimaActividad: ultimaActividad,
    evaluarProyecto: evaluarProyecto,
    evaluarComunidad: evaluarComunidad
  };
})(typeof window !== 'undefined' ? window : globalThis);
