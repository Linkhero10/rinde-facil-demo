/* Anexos: propiedades OOXML de los modelos, con datos exclusivamente de la app. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {}, U = RF.util;
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS = ' xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" mc:Ignorable="wp14 a14 w15 w16cid"';
  NS += ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || ''; }); }
  function value(x) {
    if (x == null || x === false) return false;
    if (typeof x === 'number') return Number.isFinite(x) && x !== 0;
    var s = String(x).trim().replace(/\$/g, '').replace(/\s+/g, '');
    return !!s && !/^[+-]?0+(?:[.,]0+)*(?:%)?$/.test(s);
  }
  function any(xs) { return xs.some(function (x) { return Array.isArray(x) ? any(x) : value(x); }); }
  // El dato conserva día de dos dígitos y mes completo también en las tablas.
  function date(x) { return x ? (/^\d{4}-\d{2}-\d{2}$/.test(x) ? U.fmtDate(x).replace(/^\d(?= de )/, '0$&') : x) : ''; }
  function money(x) { return x == null || x === '' ? '' : U.fmtCLP(U.parseCLP(x)); }
  function viaticoTotal(rows) {
    return (rows || []).reduce(function (s, r) { return s + U.parseCLP(r.monto == null ? Number(r.dias || 0) * U.parseCLP(r.montoDia) : r.monto); }, 0);
  }
  function pct(x) { return x == null || x === '' ? '' : x + ' %'; }
  function field(d, key) { return d[key] == null ? '' : d[key]; }
  function textXml(x) { return esc(x).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">'); }
  function fill(x, values) { return x.replace(/\{\{(\w+)\}\}/g, function (_, k) { return textXml(values[k]); }); }
  function rawCell(row, i, v) {
    var first = true;
    return row && row.cells[i] ? row.cells[i].xml.replace(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g, function () {
      var s = first ? '<w:t xml:space="preserve">' + textXml(v) + '</w:t>' : '<w:t/>'; first = false; return s;
    }) : '';
  }
  function rowXml(row, values) { return '<w:tr>' + row.pr + row.cells.map(function (c) { return fill(c.xml, values); }).join('') + '</w:tr>'; }
  function tableXml(node, values, rows) { return '<w:tbl>' + node.pr + node.grid + (rows || node.rows.map(function (r) { return rowXml(r, values); })).join('') + '</w:tbl>'; }
  function widths(xml, sizes) {
    var column = 0;
    xml = xml.replace(/<w:gridCol w:w="\d+"\/>/g, function () { return '<w:gridCol w:w="' + sizes[column++] + '"/>'; });
    return xml.replace(/<w:tr>[\s\S]*?<\/w:tr>/g, function (row) {
      var at = 0;
      return row.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, function (cell) {
        var span = Number((cell.match(/<w:gridSpan w:val="(\d+)"/) || [0,1])[1]);
        var width = sizes.slice(at, at + span).reduce(function (a,b) { return a + b; },0); at += span;
        return cell.replace(/<w:tcW w:w="\d+"/, '<w:tcW w:w="' + width + '"');
      });
    });
  }
  function contactCells(xml) {
    var ri = -1;
    return xml.replace(/<w:tr>[\s\S]*?<\/w:tr>/g, function (row) {
      ri++; if (ri !== 2 && ri !== 7) return row;
      var cells = row.match(/<w:tc>[\s\S]*?<\/w:tc>/g);
      var label = cells[1], data = cells[2];
      var size = [label,data].reduce(function (sum,c) { return sum + Number(c.match(/<w:tcW w:w="(\d+)"/)[1]); },0);
      var span = [label,data].reduce(function (sum,c) { return sum + Number((c.match(/<w:gridSpan w:val="(\d+)"/) || [0,1])[1]); },0);
      var merged = label.replace(/<w:tcW w:w="\d+"/, '<w:tcW w:w="' + size + '"').replace(/<w:gridSpan[^>]*\/>/, '');
      merged = merged.replace('</w:tcPr>', '<w:gridSpan w:val="' + span + '"/></w:tcPr>');
      merged = merged.replace('</w:tc>', data.replace(/^<w:tc><w:tcPr>[\s\S]*?<\/w:tcPr>/, '').replace(/<\/w:tc>$/, '') + '</w:tc>');
      return row.replace(label + data, merged);
    });
  }
  function set(values, ti, ri, ci, v) { values['t' + ti + 'r' + ri + 'c' + ci] = v; }
  function rowValues(values, ti, ri, vs) { vs.forEach(function (v, i) { set(values, ti, ri, i, v); }); }
  function declaration2(node, values, d) {
    var source = values.declaracion, cursor = 0, pieces = [];
    var pr = (node.xml.match(/<w:r><w:rPr>[\s\S]*?<\/w:rPr>/) || ['<w:r><w:rPr></w:rPr>'])[0].slice(5);
    function run(s, bold) { return '<w:r>' + (bold ? pr.replace('</w:rPr>','<w:b/></w:rPr>') : pr) + '<w:t xml:space="preserve">' + textXml(s) + '</w:t></w:r>'; }
    [d.periodoInicio ? date(d.periodoInicio) : '[inicio]', d.periodoFin ? date(d.periodoFin) : '[término]', d.proyectoNombre || '[proyecto]', d.proyectoCodigo || '[código]'].forEach(function (term) {
      var at = source.indexOf(term,cursor); if (at < 0) return;
      pieces.push(run(source.slice(cursor,at),false),run(term,true)); cursor=at+term.length;
    });
    pieces.push(run(source.slice(cursor),false));
    return node.xml.replace(/<w:r>[\s\S]*?<\/w:r>/,pieces.join(''));
  }
  function bindings(doc) {
    var d = doc.anexoDatos, id = doc.anexoModelo, old = doc.blocks || [], ps = old.filter(function (b) { return b.t === 'p'; });
    var v = Object.assign({}, d, { ciudadFecha: (d.ciudad || '[Ciudad]') + ', ' + (d.fecha ? date(d.fecha) : '[fecha]') });
    v.montoTexto = money(id === 'anexo3' ? d.monto : id === 'anexo4' ? viaticoTotal(d.filas) : d.total);
    v.medioPagoTexto = d.medioPago === 'efectivo' ? 'pago en efectivo' : 'transferencia bancaria';
    v.fechaPagoTexto = d.fechaPago ? date(d.fechaPago) : '[fecha]';
    if (id === 'anexo1' || id === 'anexo2' || id === 'anexo3' || id === 'anexo4') v.declaracion = ps[1] && ps[1].text || '';
    if (id === 'anexo1') v.consecuencia = ps[2] && ps[2].text || '';
    if (id === 'anexo2') v.firmaNombre = (d.repNombre || '[Nombre del representante de la Comunidad que firma, con su título / cargo, si corresponde]') + (d.repCargo ? ' / ' + d.repCargo : '');
    if (id === 'anexo4') v.recepcion = ps[2] && ps[2].text || '';
    if (id === 'anexo1' || id === 'anexo2') {
      v.declaracion = v.declaracion.replace(/\b(\d)( de [a-záéíóú]+ de \d{4})/g, '0$1$2');
    }
    if (id === 'informe') {
      v.numeroInforme = 'INFORME TÉCNICO N° ' + field(d, 'nInforme'); v.codigoProyecto = 'PROYECTO CÓDIGO: ' + field(d, 'proyectoCodigo');
      var activities = activityNames(doc);
      [1,2,3].forEach(function (i) { v['actividad' + i] = activities[i - 1] ? 'Actividad ' + i + ':\t' + activities[i - 1] : ''; });
      rowValues(v, 0, 0, ['', date(d.fechaInforme)]); rowValues(v, 0, 1, ['', d.elaboradoPor]);
      rowValues(v, 0, 2, ['', date(d.fechaInicio)]); rowValues(v, 0, 3, ['', date(d.fechaTermino)]); rowValues(v, 0, 4, ['', date(d.fechaTransferencia)]);
      set(v, 1, 0, 2, date(d.periodoInicio)); set(v, 1, 0, 4, date(d.periodoFin));
      set(v, 1, 1, 1, d.elaboradoPor); set(v, 1, 2, 2, d.responsableCorreo); set(v, 1, 2, 4, d.responsableTel);
      [d.comunidad, d.comunidadRut, d.direccion, d.repLegal].forEach(function (x, i) { set(v, 1, i + 3, 1, x); });
      set(v, 1, 7, 2, d.repCorreo); set(v, 1, 7, 4, d.repTel); set(v, 1, 8, 1, d.oc);
      // El resumen del modelo es una única celda; conserva el relato de período ya registrado.
      set(v, 2, 0, 0, [d.resumen, d.descripcion, d.principales, d.desviaciones, d.riesgos].filter(function (x) { return x != null && x !== ''; }).join('\n\n'));
    }
    return v;
  }
  function fichaValues(ti, d) {
    var v = {}, put = function (r, c, x) { set(v, ti, r, c, x); };
    var pair = function (r, a, b) { put(r, 1, a); put(r, 3, b); };
    if (ti === 3) {
      put(0, 1, d.nombre); put(1, 1, date(d.fecha)); put(1, 3, d.lugar); put(1, 5, d.asistentes);
      pair(2, money(d.presupuestado), money(d.rendido));
      [d.objetivos, d.formaAdq, d.proveedores, d.participantes].forEach(function (x, i) { put(i + 3, 1, x); });
    } else if (ti === 4) {
      put(0, 1, d.nombre); pair(1, money(d.presupuestado), money(d.adjudicado)); put(2, 1, d.proveedor);
      put(3, 2, date(d.desde)); put(3, 4, date(d.hasta)); put(4, 1, money(d.adjudicado)); put(5, 1, d.objetivo); put(6, 1, d.entregables);
    } else if (ti === 5) {
      [d.nombre, d.objetivos, d.caracteristicas, d.formaAdq].forEach(function (x, i) { put(i, 1, x); });
      pair(4, money(d.presupuestado), money(d.rendido)); put(5, 1, d.proveedor); put(6, 2, date(d.desde)); put(6, 4, date(d.hasta));
    } else if (ti === 6) {
      pair(0, d.nombre, d.rut); pair(1, money(d.presupuestado), money(d.rendido)); pair(2, d.meses, d.mesesEjec);
      put(3, 2, date(d.desde)); put(3, 4, date(d.hasta)); put(4, 1, d.funcion); put(6, 1, d.descripcion); put(7, 1, d.principales);
    } else if (ti === 7) {
      [d.nombre, d.proveedor, d.lugar].forEach(function (x, i) { put(i, 1, x); }); pair(3, money(d.presupuestado), money(d.rendido));
      put(4, 1, d.formaContratacion); put(5, 2, date(d.fechaInicio)); put(5, 4, date(d.fechaTermino)); put(7, 1, d.descripcion);
    }
    var start = ti < 6 ? 9 : 8;
    if (ti < 6) put(8, 1, d.descripcion);
    pair(start, pct(d.avanceProg), pct(d.avanceReal)); pair(start + 1, pct(d.avanceProgAcum), pct(d.avanceRealAcum));
    put(start + 2, 1, d.criterio); put(start + 3, 1, d.desviaciones); put(start + 4, 1, d.riesgos);
    return v;
  }
  function detailRows(node, rows, cols, min, prototype) {
    var out = [], count = Math.max(min, rows.length);
    for (var i = 0; i < count; i++) {
      var p = node.rows[prototype + Math.min(i, min - 1)];
      var vs = i < rows.length ? cols(rows[i]) : [], r = '<w:tr>' + p.pr;
      p.cells.forEach(function (_, ci) { r += rawCell(p, ci, vs[ci] == null ? '' : vs[ci]); });
      out.push(r + '</w:tr>');
    }
    return out;
  }
  function dataTable(node, doc, values) {
    var id = doc.anexoModelo, d = doc.anexoDatos, ti = node.table, rows = d.filas || [], vs;
    if (id === 'anexo2') {
      vs = rows.map(function (r) { return [r.nFactura, r.fecha, r.bruto, r.neto, r.detalle, r.contexto]; });
      if (!any(vs)) return '';
      return widths(tableXml(node, values, [rowXml(node.rows[0], values)].concat(detailRows(node, rows, function (r) { return [r.nFactura, date(r.fecha), money(r.bruto), money(r.neto), r.detalle, r.contexto]; }, 1, 1))), [1700,1277,1250,1250,1265,1366]);
    }
    if (id === 'anexo4') {
      if (ti === 1) {
        if (!any([d.viajero, d.repNombre, (d.firmas || {}).viajero, (d.firmas || {}).rep])) return '';
        set(values, 1, 0, 0, 'Firma\n' + field(d, 'viajero')); set(values, 1, 0, 1, ''); set(values, 1, 0, 2, 'Firma\n' + field(d, 'repNombre'));
        return tableXml(node, values);
      }
      if (!any(rows.map(function (r) { return [r.destino, r.desde, r.hasta, r.dias, r.monto == null ? Number(r.dias || 0) * U.parseCLP(r.montoDia) : r.monto]; }))) return '';
      var total = viaticoTotal(rows);
      set(values, 0, 3, 1, money(total));
      return tableXml(node, values, [rowXml(node.rows[0], values)].concat(detailRows(node, rows, function (r) { return [r.destino, date(r.desde), date(r.hasta), r.dias, money(r.monto == null ? Number(r.dias || 0) * U.parseCLP(r.montoDia) : r.monto)]; }, 2, 1), [rowXml(node.rows[3], values)]));
    }
    if (id === 'anexo5') {
      var use = d.uso || [], hh = d.hh || [];
      function original(r) { return [r.concepto === 'Otro' ? r.conceptoOtro || 'Otro' : r.concepto, r.comunidad, r.periodo, r.doc, r.monto, r.pct, r.aRendir]; }
      if (!any(use.concat(hh).map(original))) return '';
      set(values, 0, 0, 0, 'Por valor de Uso Proyecto ' + field(d, 'proyectoNombre') + ' de acuerdo con el Programa de Ejecución de Actividades');
      set(values, 0, 10, 0, 'Por cantidad de horas HH Proyecto ' + field(d, 'proyectoNombre'));
      function cols(r) { return [r.concepto === 'Otro' ? r.conceptoOtro || 'Otro' : r.concepto, r.comunidad || d.comunidadNombre, r.periodo, r.doc, money(r.monto), pct(r.pct), money(r.aRendir == null ? Math.round(U.parseCLP(r.monto) * (Number(r.pct) || 0) / 100) : r.aRendir)]; }
      function total(xs) { return money(xs.reduce(function (s, r) { return s + (r.aRendir == null ? Math.round(U.parseCLP(r.monto) * (Number(r.pct) || 0) / 100) : U.parseCLP(r.aRendir)); }, 0)); }
      set(values, 0, 8, 1, total(use)); set(values, 0, 18, 1, total(hh));
      return widths(tableXml(node, values, node.rows.slice(0,3).map(function (r) { return rowXml(r, values); }).concat(detailRows(node, use, cols, 5, 3), [rowXml(node.rows[8], values), rowXml(node.rows[9], values)], node.rows.slice(10,13).map(function (r) { return rowXml(r, values); }), detailRows(node, hh, cols, 5, 13), [rowXml(node.rows[18], values)])), [1551,1390,1021,1500,1326,883,1131]);
    }
    if (id === 'informe') {
      if (ti >= 3) {
        var kind = ['informeA','informeB','informeC','informeD','informeE'][ti - 3];
        return ((doc.anexoProyecto.forms || {})[kind] || []).map(function (f) {
          // Los relatos del período de RRHH se migraron al informe general.
          // Las casillas del modelo permanecen, sin volver a imprimir texto antiguo.
          var data = ti === 6 ? Object.assign({}, f.data || {}, { descripcion: '', principales: '', desviaciones: '', riesgos: '' }) : f.data || {};
          var fv = fichaValues(ti, data);
          // La tabla B flotante podía saltarse su título y solaparse con el
          // siguiente. Las fichas rellenadas siguen el orden del documento.
          return any(Object.keys(fv).map(function (k) { return fv[k]; })) ? tableXml(node, fv).replace(/<w:tblpPr\b[^>]*\/>/g, '') : '';
        }).join('');
      }
      var pattern = new RegExp('^t' + ti + 'r');
      if (!any(Object.keys(values).filter(function (k) { return pattern.test(k); }).map(function (k) { return values[k]; }))) return '';
      return ti === 1 ? contactCells(tableXml(node, values)) : tableXml(node, values);
    }
    return tableXml(node, values);
  }
  function modelOf(doc) { return Object.assign({}, RF.anexoModelosDatos.common, RF.anexoModelosDatos.models[doc.anexoModelo]); }
  function activityNames(doc) {
    var forms = (doc.anexoProyecto || {}).forms || {}, names = [];
    ['informeA','informeB','informeC','informeD','informeE'].forEach(function (k) { (forms[k] || []).forEach(function (f) { var n = (f.data || {}).nombre; if (value(n)) names.push(n); }); });
    return names;
  }
  function signatures(doc, index) {
    var keys = { anexo1: ['rep'], anexo2: ['rep'], anexo3: ['prov'], anexo4: ['viajero', 'rep'] }[doc.anexoModelo] || [];
    return keys.map(function (k) { return { key: k, id: 'rIdSig' + index + k, data: (doc.anexoDatos.firmas || {})[k] || '' }; }).filter(function (s) { return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s.data); });
  }
  function signatureRun(id) {
    var serial = 100 + 10 * Number(id.match(/\d+/)[0]) + (/rep$/.test(id) ? 1 : /viajero$/.test(id) ? 2 : 3);
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1800000" cy="600000"/><wp:docPr id="' + serial + '" name="Firma registrada"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Firma"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:br/></w:r>';
  }
  function body(doc, index) {
    // Un formulario completamente vacío es el impreso oficial para rellenar:
    // conserva instrucciones, retículas y el índice cacheado del propio modelo.
    // Los documentos con datos siguen el enlace y las omisiones existentes.
    function hasInput(x, defaults) {
      if (Array.isArray(x)) return x.some(function (item, i) { return hasInput(item, (defaults || [])[i]); });
      if (x && typeof x === 'object') return Object.keys(x).some(function (k) { return hasInput(x[k], (defaults || {})[k]); });
      return x !== defaults && value(x);
    }
    var blank = !hasInput(doc.anexoDatos, doc.anexoDefaults);
    if (blank && doc.anexoModelo === 'informe') {
      var forms = doc.anexoProyecto.forms || {};
      blank = !['informeA','informeB','informeC','informeD','informeE'].some(function (kind) {
        return (forms[kind] || []).some(function (f) {
          // RRHH calcula estos dos textos incluso sin una contratación.
          var data = f.data || {};
          return Object.keys(data).some(function (key) {
            return !(kind === 'informeD' && (key === 'tipo' || key === 'criterio')) && hasInput(data[key]);
          });
        });
      });
    }
    if (blank && modelOf(doc).blankNodes) {
      var rangesBlank = { informeA: [62,66], informeB: [108,111], informeC: [112,116], informeD: [156,160], informeE: [161,165] };
      var blankRange = rangesBlank[doc.anexoFicha];
      return modelOf(doc).blankNodes.filter(function (b) {
        return !blankRange || b.index >= blankRange[0] && b.index <= blankRange[1];
      }).map(function (b) { return b.xml; }).join('');
    }
    var values = bindings(doc);
    var sigs = signatures(doc, index || 0);
    var nodes = modelOf(doc).nodes;
    // Los espaciadores tras la última nota del Anexo 5 no aportan contenido;
    // al crecer sus filas enviaban un párrafo vacío a una segunda página.
    if (doc.anexoModelo === 'anexo5') nodes = nodes.filter(function (b) { return b.index <= 10; });
    if (doc.anexoModelo === 'informe') nodes = nodes.filter(function (b) {
      return !(b.index >= 67 && b.index <= 107 || b.index >= 117 && b.index <= 155);
    });
    if (doc.anexoFicha) {
      var ranges = { informeA: [62,66], informeB: [108,111], informeC: [112,116], informeD: [156,160], informeE: [161,165] }, range = ranges[doc.anexoFicha];
      nodes = nodes.filter(function (b) { return b.index >= range[0] && b.index <= range[1]; });
    }
    return nodes.map(function (b) {
      var x = b.kind === 'p' ? fill(b.xml, values) : dataTable(b, doc, values);
      if (doc.anexoModelo === 'informe' && !doc.anexoFicha && [108,112,156,161].indexOf(b.index) >= 0) {
        x = x.replace('<w:pPr>', '<w:pPr><w:pageBreakBefore/>');
      }
      if (doc.anexoModelo === 'anexo3' && b.index === 26) x = x.replace('Nombre del prestador del servicio/proveedor', textXml(doc.anexoDatos.proveedorNombre || 'Nombre del prestador del servicio/proveedor'));
      if (doc.anexoModelo === 'anexo2' && b.index === 9) x = declaration2(b,values,doc.anexoDatos);
      if (doc.anexoModelo === 'informe' && b.index === 55) {
        activityNames(doc).slice(3).forEach(function (n, i) { x += fill(b.xml, { actividad3: 'Actividad ' + (i + 4) + ':\t' + n }); });
      }
      var signIndex = { anexo1: 23, anexo2: 21, anexo3: 25 }[doc.anexoModelo];
      if (b.kind === 'p' && b.index === signIndex && sigs.length) x = x.replace(/<w:r>/, signatureRun(sigs[0].id) + '<w:r>');
      if (doc.anexoModelo === 'anexo4' && b.kind === 'table' && b.table === 1) {
        var ci = -1;
        x = x.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, function (c) {
          ci++; var key = ci === 0 ? 'viajero' : ci === 2 ? 'rep' : '';
          var s = sigs.filter(function (a) { return a.key === key; })[0];
          return s ? c.replace(/<w:r>/, signatureRun(s.id) + '<w:r>') : c;
        });
      }
      return x;
    }).join('');
  }
  function attach(doc, id, data, ctx) {
    doc.anexoModelo = id;
    doc.title = title(id);
    var schema = RF.forms && RF.forms.SCHEMAS[id];
    // Referencia transitoria para exportar; no altera los defaults guardados.
    var defaults = schema && ctx ? schema.defaults(ctx) : {};
    Object.defineProperties(doc, { anexoDatos: { value: data }, anexoDefaults: { value: defaults }, anexoProyecto: { value: ctx && ctx.project || {} } });
    return doc;
  }
  function attachFicha(doc, kind, data) {
    var forms = {}; forms[kind] = [{ data: data }];
    attach(doc, 'informe', {}, { project: { forms: forms } }); doc.anexoFicha = kind; return doc;
  }
  function isModel(doc) { return !!(doc && (doc.anexoModelo || doc.anexoDocumentos && doc.anexoDocumentos.length)); }
  function docsOf(doc) { return doc.anexoDocumentos || [doc]; }
  function title(id) {
    var indices = id === 'anexo5' || id === 'informe' ? [2,3] : [0,1];
    return RF.anexoModelosDatos.models[id].nodes.filter(function (b) { return indices.indexOf(b.index) >= 0; }).map(function (b) {
      return (b.xml.match(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('');
    }).join(' ');
  }
  function documentXml(doc) {
    var documents = docsOf(doc);
    return '<w:document' + NS + '><w:body>' + documents.map(function (d, i) {
      var xml = body(d, i);
      return documents.length > 1 && d.anexoFicha ? xml.replace(/<w:numId w:val="25"/g, '<w:numId w:val="' + (1000 + i) + '"') : xml;
    }).join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>') + modelOf(documents[0]).section + '</w:body></w:document>';
  }
  function numberingXml(doc) {
    var documents = docsOf(doc), numbering = modelOf(documents[0]).numbering || '<w:numbering/>';
    var source = (numbering.match(/<w:num\b[^>]*w:numId="25"[^>]*>[\s\S]*?<\/w:num>/) || [''])[0];
    documents.forEach(function (d, i) {
      if (!d.anexoFicha) return;
      var start = ['informeA','informeB','informeC','informeD','informeE'].indexOf(d.anexoFicha) + 1;
      var list = source.replace('</w:num>', '<w:lvlOverride w:ilvl="3"><w:startOverride w:val="' + start + '"/></w:lvlOverride></w:num>');
      if (documents.length > 1) numbering = numbering.replace('</w:numbering>', list.replace('w:numId="25"', 'w:numId="' + (1000 + i) + '"') + '</w:numbering>');
      else if (start > 1) numbering = numbering.replace(source, list);
    });
    return numbering;
  }
  function packageFiles(doc) {
    var m = modelOf(docsOf(doc)[0]), utf = function (s) { return new TextEncoder().encode(s); };
    var numbering = numberingXml(doc);
    var sigs = [].concat.apply([], docsOf(doc).map(signatures));
    var types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>';
    var overrides = { 'document': 'document.main', 'styles': 'styles', 'numbering': 'numbering', 'settings': 'settings', 'header1': 'header', 'footer1': 'footer' };
    if (m.footnotes) overrides.footnotes = 'footnotes';
    Object.keys(overrides).forEach(function (k) { types += '<Override PartName="/word/' + k + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + overrides[k] + '+xml"/>'; });
    types += '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>';
    var rel = function (entries) { return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + entries.map(function (e) { return '<Relationship Id="' + e[0] + '" Type="' + R + '/' + e[1] + '" Target="' + e[2] + '"/>'; }).join('') + '</Relationships>'; };
    function rooted(s) { return s.replace(/^<([\w:]+)/, '<$1' + NS); }
    var map = {
      '[Content_Types].xml': types, '_rels/.rels': rel([['rIdDocument','officeDocument','word/document.xml']]),
      'word/document.xml': documentXml(doc), 'word/styles.xml': '<w:styles' + NS + '>' + m.styles + '</w:styles>',
      'word/numbering.xml': rooted(numbering), 'word/theme/theme1.xml': m.theme,
      'word/settings.xml': '<w:settings' + NS + '>' + m.settings + '<w:updateFields w:val="true"/></w:settings>',
      'word/header1.xml': rooted(m.header), 'word/footer1.xml': rooted(m.footer),
      'word/_rels/document.xml.rels': rel([['rIdHeader','header','header1.xml'],['rIdFooter','footer','footer1.xml'],['rIdStyles','styles','styles.xml'],['rIdNumbering','numbering','numbering.xml'],['rIdSettings','settings','settings.xml'],['rIdTheme','theme','theme/theme1.xml']].concat(m.footnotes ? [['rIdFootnotes','footnotes','footnotes.xml']] : []).concat(sigs.map(function (s) { return [s.id, 'image', 'media/firma-' + s.id + '.png']; }))),
      'word/_rels/header1.xml.rels': rel([['rIdLogo','image','media/cabecera.jpeg']])
    };
    if (m.footnotes) map['word/footnotes.xml'] = rooted(m.footnotes);
    var files = Object.keys(map).map(function (k) { return { name: k, data: utf(map[k]) }; });
    var bin = atob(m.logo), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    files.push({ name: 'word/media/cabecera.jpeg', data: bytes });
    sigs.forEach(function (s) { var b = atob(s.data.split(',')[1]), a = new Uint8Array(b.length); for (var j = 0; j < b.length; j++) a[j] = b.charCodeAt(j); files.push({ name: 'word/media/firma-' + s.id + '.png', data: a }); });
    return files;
  }
  RF.anexoModelos = { attach: attach, attachFicha: attachFicha, isModel: isModel, documentXml: documentXml, packageFiles: packageFiles, numberingXml: numberingXml, hasValue: value, title: title };
})(typeof window !== 'undefined' ? window : globalThis);
