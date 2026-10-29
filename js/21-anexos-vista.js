/* Vista de impresión derivada del mismo OOXML; Word es la salida de referencia. */
(function (root) {
  'use strict';
  var RF = root.RF = root.RF || {};
  function decode(s) { return String(s).replace(/&(?:amp|lt|gt|quot|apos);/g, function (x) { return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[x]; }); }
  function parse(s) {
    var rootNode = { name: '', attrs: {}, children: [] }, stack = [rootNode];
    (s.match(/<[^>]+>|[^<]+/g) || []).forEach(function (t) {
      if (/^<\?|^<!/.test(t)) return;
      if (/^<\//.test(t)) { stack.pop(); return; }
      var parent = stack[stack.length - 1];
      if (t.charAt(0) !== '<') { if (t.trim() || parent.name === 'w:t') parent.children.push({ text: decode(t) }); return; }
      var n = { name: t.match(/^<([^\s/>]+)/)[1], attrs: {}, children: [] };
      (t.match(/[\w:]+="[^"]*"/g) || []).forEach(function (a) { var i = a.indexOf('='); n.attrs[a.slice(0,i)] = decode(a.slice(i + 2, -1)); });
      parent.children.push(n); if (!/\/>$/.test(t)) stack.push(n);
    });
    return rootNode;
  }
  function child(n, name) { return (n && n.children || []).filter(function (c) { return c.name === name; })[0]; }
  function kids(n, name) { return (n && n.children || []).filter(function (c) { return c.name === name; }); }
  function attr(n, key) { return n && n.attrs[key]; }
  function val(n, name) { return attr(child(n, name), 'w:val'); }
  function pt(n) { return Number(n || 0) / 20 + 'pt'; }
  function txt(n) { return n.text != null ? n.text : (n.children || []).map(txt).join(''); }
  function descendants(n, name) {
    return (n && n.children || []).reduce(function (out, c) { return out.concat(c.name === name ? [c] : descendants(c, name)); }, []);
  }
  function choice(n) { return n.name === 'mc:AlternateContent' ? child(n,'mc:Choice') || child(n,'mc:Fallback') : n; }
  function visibleText(n) {
    if (n.name === 'mc:AlternateContent') return visibleText(choice(n));
    if (n.name === 'w:instrText') return '';
    if (n.name === 'w:footnoteReference') return '[' + attr(n, 'w:id') + ']';
    if (n.name === 'w:br') return '\n';
    if (n.name === 'w:tab') return '\t';
    return n.text != null ? n.text : (n.children || []).map(visibleText).join('');
  }
  function contentNodes(n) {
    return (n.children || []).reduce(function (out, c) {
      return out.concat(c.name === 'w:sdt' ? contentNodes(child(c, 'w:sdtContent') || { children: [] }) : [c]);
    }, []);
  }
  function footnotes(model, body) {
    var ids = descendants(body, 'w:footnoteReference').map(function (n) { return attr(n, 'w:id'); });
    return kids(parse(model.footnotes || '<w:footnotes/>').children[0], 'w:footnote').filter(function (n) {
      return ids.indexOf(attr(n, 'w:id')) >= 0 && !attr(n, 'w:type');
    });
  }
  function css(pr) {
    if (!pr) return '';
    var s = '', f = child(pr, 'w:rFonts'), font = attr(f, 'w:ascii') || attr(f, 'w:hAnsi');
    if (font) s += 'font-family:' + font.replace(/[";'<>]/g, '') + ';';
    if (child(pr, 'w:sz')) s += 'font-size:' + Number(val(pr, 'w:sz')) / 2 + 'pt;';
    ['b','i'].forEach(function (k) { if (child(pr, 'w:' + k)) s += (k === 'b' ? 'font-weight:' : 'font-style:') + (val(pr,'w:' + k) === '0' ? 'normal' : k === 'b' ? 'bold' : 'italic') + ';'; });
    if (child(pr, 'w:u')) s += 'text-decoration:' + (val(pr,'w:u') === 'none' ? 'none' : 'underline') + ';';
    var color = val(pr, 'w:color'); if (/^[A-Fa-f0-9]{6}$/.test(color || '')) s += 'color:#' + color + ';';
    var jc = val(pr, 'w:jc'); if (jc) s += 'text-align:' + (jc === 'both' ? 'justify' : jc) + ';';
    var sp = child(pr, 'w:spacing');
    if (sp) {
      if (attr(sp, 'w:before')) s += 'margin-top:' + pt(attr(sp, 'w:before')) + ';';
      if (attr(sp, 'w:after')) s += 'margin-bottom:' + pt(attr(sp, 'w:after')) + ';';
      if (attr(sp, 'w:line')) s += 'line-height:' + (attr(sp, 'w:lineRule') === 'auto' || !attr(sp, 'w:lineRule') ? Number(attr(sp, 'w:line')) / 240 : pt(attr(sp, 'w:line'))) + ';';
    }
    var ind = child(pr, 'w:ind');
    if (ind) {
      if (attr(ind, 'w:left')) s += 'margin-left:' + pt(attr(ind, 'w:left')) + ';';
      if (attr(ind, 'w:right')) s += 'margin-right:' + pt(attr(ind, 'w:right')) + ';';
      if (attr(ind, 'w:firstLine')) s += 'text-indent:' + pt(attr(ind, 'w:firstLine')) + ';';
      else if (attr(ind, 'w:hanging')) s += 'text-indent:-' + pt(attr(ind, 'w:hanging')) + ';';
    }
    if (child(pr, 'w:pageBreakBefore')) s += 'break-before:page;';
    var sh = child(pr,'w:shd'), fill = attr(sh, 'w:fill'); if (/^[A-Fa-f0-9]{6}$/.test(fill || '')) s += 'background:#' + fill + ';';
    return s;
  }
  function listPrefix(numberingXml) {
    var numbering = parse(numberingXml).children[0], nums = {}, starts = {}, abstracts = {}, counters = {};
    kids(numbering,'w:abstractNum').forEach(function (a) { abstracts[attr(a,'w:abstractNumId')] = a; });
    kids(numbering,'w:num').forEach(function (n) { var id = attr(n,'w:numId'); nums[id] = val(n,'w:abstractNumId'); kids(n,'w:lvlOverride').forEach(function (lv) { starts[id + ':' + attr(lv,'w:ilvl')] = Number(val(lv,'w:startOverride')); }); });
    return function (pr) {
      var np = child(pr,'w:numPr'), id = val(np,'w:numId'), level = val(np,'w:ilvl') || '0';
      if (!id || id === '0') return '';
      var a = abstracts[nums[id]], lv = kids(a,'w:lvl').filter(function (l) { return attr(l,'w:ilvl') === level; })[0]; if (!lv) return '';
      var key = id + ':' + level, count = counters[key] == null ? (starts[key] || Number(val(lv,'w:start') || 1)) : counters[key] + 1; counters[key] = count;
      var fmt = val(lv,'w:numFmt'), n = fmt === 'upperRoman' ? ['','I','II','III','IV','V','VI','VII','VIII','IX','X'][count] || count : fmt === 'upperLetter' ? String.fromCharCode(64 + count) : fmt === 'lowerLetter' ? String.fromCharCode(96 + count) : count;
      return RF.util.esc((val(lv,'w:lvlText') || '').replace(/%\d/g, n)) + '\t';
    };
  }
  function html(doc, bodyOnly) {
    var model = RF.anexoModelos, data = RF.anexoModelosDatos;
    var ds = doc.anexoDocumentos || [doc], first = Object.assign({}, data.common, data.models[ds[0].anexoModelo]);
    var stylesRoot = parse('<w:styles>' + first.styles + '</w:styles>').children[0], styles = {};
    kids(stylesRoot, 'w:style').forEach(function (s) { styles[attr(s, 'w:styleId')] = s; });
    function style(id, prop, seen) {
      var s = styles[id]; seen = seen || {}; if (!s || seen[id]) return '';
      seen[id] = true; return style(val(s, 'w:basedOn'), prop, seen) + css(child(s, prop));
    }
    var imgs = {};
    ds.forEach(function (d, i) { Object.keys(d.anexoDatos.firmas || {}).forEach(function (k) { imgs['rIdSig' + i + k] = d.anexoDatos.firmas[k]; }); });
    function run(r, base) {
      var s = base + style(val(child(r, 'w:rPr'), 'w:rStyle'), 'w:rPr') + css(child(r, 'w:rPr'));
      return '<span style="' + RF.util.esc(s) + '">' + r.children.map(function (c) {
        if (c.name === 'mc:AlternateContent') return shape(choice(c));
        if (c.name === 'w:t') return RF.util.esc(txt(c));
        if (c.name === 'w:footnoteReference') return '<sup>' + RF.util.esc(attr(c, 'w:id')) + '</sup>';
        if (c.name === 'w:tab') return '&emsp;';
        if (c.name === 'w:br') return attr(c,'w:type') === 'page' ? '<span class="anexo-salto"></span>' : '<br>';
        if (c.name === 'w:drawing') {
          var inline = child(c,'wp:inline'), g = child(child(child(inline,'a:graphic'),'a:graphicData'),'pic:pic'), blip = child(child(g,'pic:blipFill'),'a:blip');
          var image = imgs[attr(blip,'r:embed')]; return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image || '') ? '<img alt="Firma registrada" style="width:141.7pt;height:47.2pt" src="' + image + '">' : '';
        }
        return '';
      }).join('') + '</span>';
    }
    function shape(n) {
      var anchor = descendants(n,'wp:anchor')[0]; if (!anchor) return '';
      var extent = child(anchor,'wp:extent'), hpos = child(anchor,'wp:positionH'), vpos = child(anchor,'wp:positionV');
      var x = Number(txt(child(hpos,'wp:posOffset') || {children:[]})) / 12700;
      var y = Number(txt(child(vpos,'wp:posOffset') || {children:[]})) / 12700;
      var width = Number(attr(extent,'cx')) / 12700, height = Number(attr(extent,'cy')) / 12700;
      var wsp = descendants(anchor,'wps:wsp')[0], sp = child(wsp,'wps:spPr'), line = child(sp,'a:ln');
      var rgb = child(child(line,'a:solidFill'),'a:srgbClr'), color = attr(rgb,'val') || '000000';
      var shade = Number(val(rgb,'a:shade') || 100000) / 100000;
      if (/^[a-f0-9]{6}$/i.test(color)) color = color.match(/../g).map(function (part) { return Math.round(parseInt(part,16)*shade).toString(16).padStart(2,'0'); }).join('');
      var box = descendants(wsp,'w:txbxContent')[0], content = box ? kids(box,'w:p').map(function (p) { return paragraph(p,true); }).join('') : '';
      var align = txt(child(hpos,'wp:align') || {children:[]}), position = align === 'center' ? 'left:50%;transform:translateX(-50%);' : 'left:' + x + 'pt;';
      var style = position + 'top:' + y + 'pt;width:' + width + 'pt;min-height:' + height + 'pt;border:' + Number(attr(line,'w') || 6350)/12700 + 'pt solid #' + color + ';';
      return '<span class="anexo-marco" style="' + RF.util.esc(style) + '">' + content + '</span>';
    }
    var prefix = listPrefix(model.numberingXml(doc));
    function paragraph(p, withinShape) {
      var pr = child(p,'w:pPr'), sid = val(pr,'w:pStyle') || 'Normal';
      var pcss = style(sid,'w:pPr') + css(pr), rcss = style(sid,'w:rPr') + css(child(pr,'w:rPr'));
      function inline(n) {
        return (n.children || []).map(function (r) {
          return r.name === 'w:r' ? run(r, rcss) : r.name === 'mc:AlternateContent' ? shape(choice(r)) : r.name === 'w:hyperlink' ? inline(r) : '';
        }).join('');
      }
      var out = prefix(pr).replace(/\t/g, '&emsp;') + inline(p);
      var tag = withinShape === true ? 'span' : 'p';
      return '<' + tag + ' style="display:block;position:relative;' + RF.util.esc(pcss) + '">' + (out || '&nbsp;') + '</' + tag + '>';
    }
    function borders(pr) {
      var b = child(pr,'w:tcBorders') || child(pr,'w:tblBorders'), s = '';
      ['top','right','bottom','left'].forEach(function (side) {
        var e = child(b,'w:' + side); if (!e) return;
        var type = attr(e,'w:val'), color = attr(e,'w:color');
        s += 'border-' + side + ':' + (type === 'nil' || type === 'none' ? '0' : Number(attr(e,'w:sz') || 4) / 8 + 'pt ' + (type === 'double' ? 'double' : type === 'dotted' ? 'dotted' : type === 'dashed' ? 'dashed' : 'solid') + ' ' + (/^[a-f0-9]{6}$/i.test(color || '') ? '#' + color : '#000')) + ';';
      }); return s;
    }
    function table(t) {
      var pr = child(t,'w:tblPr'), rows = kids(t,'w:tr'), grid = kids(child(t,'w:tblGrid'),'w:gridCol');
      var sid = val(pr,'w:tblStyle'), st = styles[sid], stpr = child(st,'w:tblPr'), border = borders(stpr) + borders(pr);
      var tw = grid.reduce(function (sum,g) { return sum + Number(attr(g,'w:w')); },0), indent = attr(child(pr,'w:tblInd'),'w:w');
      var out = '<table style="width:' + pt(tw) + ';margin-left:' + pt(indent) + '"><colgroup>' + grid.map(function (g) { return '<col style="width:' + pt(attr(g,'w:w')) + '">'; }).join('') + '</colgroup>';
      rows.forEach(function (row, ri) {
        out += '<tr>'; var col = 0;
        kids(row,'w:tc').forEach(function (c) {
          var cp = child(c,'w:tcPr'), span = Number(val(cp,'w:gridSpan') || 1), vm = child(cp,'w:vMerge'), at = col; col += span;
          if (vm && attr(vm,'w:val') !== 'restart') return;
          var rowspan = 1;
          if (vm) for (var j = ri + 1; j < rows.length; j++) {
            var cc = 0, match = null; kids(rows[j],'w:tc').forEach(function (c2) { if (cc === at) match = c2; cc += Number(val(child(c2,'w:tcPr'),'w:gridSpan') || 1); });
            var v2 = child(child(match,'w:tcPr'),'w:vMerge'); if (!v2 || attr(v2,'w:val') === 'restart') break; rowspan++;
          }
          var valign = val(cp,'w:vAlign') || 'top';
          out += '<td colspan="' + span + '" rowspan="' + rowspan + '" style="' + RF.util.esc(border + borders(cp) + css(cp)) + 'vertical-align:' + (valign === 'center' ? 'middle' : valign) + '">' + kids(c,'w:p').map(paragraph).join('') + '</td>';
        }); out += '</tr>';
      }); return out + '</table>';
    }
    var docTree = parse(model.documentXml(doc)), b = child(child(docTree,'w:document'),'w:body');
    var extent = first.header.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    var offsets = [], offsetPattern = /<wp:posOffset>(-?\d+)<\/wp:posOffset>/g, offsetMatch;
    while ((offsetMatch = offsetPattern.exec(first.header)) !== null) offsets.push(Number(offsetMatch[1]) / 12700);
    var cropTag = first.header.match(/<a:srcRect([^>]*)\/>/), crop = parse('<a:srcRect' + (cropTag ? cropTag[1] : '') + '/>').children[0];
    var left = Number(attr(crop,'l') || 0) / 100000, right = Number(attr(crop,'r') || 0) / 100000;
    var top = Number(attr(crop,'t') || 0) / 100000, bottom = Number(attr(crop,'b') || 0) / 100000;
    var hw = extent ? Number(extent[1]) / 12700 : 408, hh = extent ? Number(extent[2]) / 12700 : 66;
    var iw = hw / (1 - left - right), ih = hh / (1 - top - bottom);
    var header = '<header style="left:' + (offsets[0] || 0) + 'pt;top:' + (-49.6 + (offsets[1] || 0)) + 'pt"><span style="display:block;position:relative;overflow:hidden;width:' + hw + 'pt;height:' + hh + 'pt"><img alt="Cabecera institucional" src="data:image/jpeg;base64,' + first.logo + '" style="position:absolute;width:' + iw + 'pt;height:' + ih + 'pt;left:' + (-left * iw) + 'pt;top:' + (-top * ih) + 'pt"></span></header>';
    var content = '<div class="anexo-modelo">' + header + contentNodes(b).map(function (n) { return n.name === 'w:p' ? paragraph(n) : n.name === 'w:tbl' ? table(n) : ''; }).join('') + footnotes(first, b).map(function (n) {
      return '<div class="anexo-nota"><sup>' + RF.util.esc(attr(n, 'w:id')) + '</sup>' + kids(n, 'w:p').map(paragraph).join('') + '</div>';
    }).join('') + '</div>';
    var cssText = '@page{size:215.9mm 279.4mm;margin:30.00375mm;@bottom-center{content:counter(page);font:10pt Arial}} .anexo-modelo{position:relative;font:11pt/1 Arial,sans-serif;color:#000}.anexo-modelo p{margin:0;min-height:11pt}.anexo-modelo table{border-collapse:collapse;table-layout:fixed}.anexo-modelo td{padding:0 5.4pt}.anexo-modelo td p{margin:0}.anexo-modelo header{height:0;position:absolute}.anexo-marco{position:absolute;display:block;box-sizing:border-box;pointer-events:none}.anexo-salto{display:block;break-before:page}@media print{.anexo-modelo header{position:fixed}}@media screen{.anexo-modelo{margin:30.00375mm auto;width:155.8925mm}}';
    if (bodyOnly) return '<style>' + cssText + '</style>' + content;
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + RF.util.esc(doc.title) + '</title><style>body{margin:0;padding:0}' + cssText + '</style></head><body>' + content + '</body></html>';
  }
  RF.anexoModelos.html = html;
  // Solo las celdas completas con marcador monetario/porcentual son numéricas.
  // Los folios, RUT, fechas y números dentro de relatos conservan su texto.
  function exportCell(text) {
    var s = text.trim();
    if (/^\$\s*-?\d[\d.]*$/.test(s)) return { v: RF.util.parseCLP(s), s: 'money', text: text };
    if (/^-?\d+(?:[.,]\d+)?\s*%$/.test(s)) return { v: Number(s.replace('%', '').trim().replace(',', '.')) / 100, s: 'percent', text: text };
    return text;
  }
  RF.anexoModelos.asDocument = function (doc) {
    var tree = parse(RF.anexoModelos.documentXml(doc)), body = child(child(tree,'w:document'),'w:body'), blocks = [], prefix = listPrefix(RF.anexoModelos.numberingXml(doc));
    contentNodes(body).forEach(function (n) {
      if (n.name === 'w:p' && visibleText(n).trim()) blocks.push({ t: 'p', text: prefix(child(n,'w:pPr')) + visibleText(n) });
      if (n.name === 'w:tbl') {
        var rows = kids(n,'w:tr').map(function (r) {
          var out = [];
          kids(r,'w:tc').forEach(function (c) {
            out.push(exportCell(kids(c,'w:p').map(visibleText).join('\n')));
            var span = Number(val(child(c,'w:tcPr'),'w:gridSpan') || 1); for (var i = 1; i < span; i++) out.push('');
          }); return out;
        });
        blocks.push({ t: 'table', head: [], rows: rows });
      }
    });
    var first = (doc.anexoDocumentos || [doc])[0];
    var m = Object.assign({}, RF.anexoModelosDatos.common, RF.anexoModelosDatos.models[first.anexoModelo]);
    footnotes(m, body).forEach(function (n) {
      blocks.push({ t: 'p', text: '[' + attr(n, 'w:id') + '] ' + kids(n, 'w:p').map(visibleText).join('\n').trim() });
    });
    return { title: doc.title, sheet: doc.sheet, blocks: blocks };
  };
})(typeof window !== 'undefined' ? window : globalThis);
