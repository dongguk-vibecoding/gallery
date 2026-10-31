/* dc-lite: a small standalone runtime for the exported design demos.
   Renders the page template with the page's Component logic, re-renders on setState,
   and patches the DOM in place so running animations are not restarted. */
(function () {
  'use strict';

  var root, tpl, Comp, inst, handlers = [], pending = false;

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function schedule() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), cur = scope;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function attrOf(openTag, name) {
    var m = openTag.match(new RegExp('\\s' + name + '="([^"]*)"'));
    return m ? m[1] : null;
  }

  function holeOrLiteral(raw, scope) {
    var m = raw && raw.match(/^\s*\{\{([^{}]+)\}\}\s*$/);
    return m ? lookup(m[1], scope) : raw;
  }

  // Expand <sc-for> / <sc-if> blocks, then fill {{holes}} in what remains.
  function renderStr(str, scope) {
    var out = '', i = 0, re = /<(sc-for|sc-if)\b/g, m;
    while ((m = re.exec(str))) {
      var tag = m[1], start = m.index;
      var openEnd = str.indexOf('>', start) + 1;
      var openTag = str.slice(start, openEnd);
      var depth = 1, pos = openEnd, scan = new RegExp('<(/?)' + tag + '\\b', 'g');
      scan.lastIndex = openEnd;
      var s;
      while (depth > 0 && (s = scan.exec(str))) {
        depth += s[1] ? -1 : 1;
        pos = s.index;
      }
      var inner = str.slice(openEnd, pos);
      var closeEnd = str.indexOf('>', pos) + 1;
      out += fill(str.slice(i, start), scope);
      if (tag === 'sc-for') {
        var list = holeOrLiteral(attrOf(openTag, 'list'), scope) || [];
        var as = attrOf(openTag, 'as') || 'item';
        for (var k = 0; k < list.length; k++) {
          var child = Object.create(scope);
          child[as] = list[k];
          child.$index = k;
          out += renderStr(inner, child);
        }
      } else if (holeOrLiteral(attrOf(openTag, 'value'), scope)) {
        out += renderStr(inner, scope);
      }
      i = closeEnd;
      re.lastIndex = closeEnd;
    }
    return out + fill(str.slice(i), scope);
  }

  function fill(str, scope) {
    // whole-value attributes: events become delegated handlers, others keep raw values
    str = str.replace(/\s([A-Za-z_:][-\w:.]*)="\{\{([^{}]+)\}\}"/g, function (all, name, expr) {
      var v = lookup(expr, scope);
      if (/^on[A-Z]/.test(name)) {
        if (typeof v !== 'function') return '';
        handlers.push(v);
        return ' data-dc-on-' + name.slice(2).toLowerCase() + '="' + (handlers.length - 1) + '"';
      }
      if (v === false || v == null) return '';
      return ' ' + name + '="' + esc(v === true ? '' : v) + '"';
    });
    return str.replace(/\{\{([^{}]+)\}\}/g, function (all, expr) {
      var v = lookup(expr, scope);
      return v == null ? '' : esc(v);
    });
  }

  function syncAttrs(a, b) {
    var i, at;
    for (i = a.attributes.length - 1; i >= 0; i--) {
      at = a.attributes[i];
      if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    }
    for (i = 0; i < b.attributes.length; i++) {
      at = b.attributes[i];
      if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
    }
  }

  function morph(a, b) {
    var ac = Array.prototype.slice.call(a.childNodes);
    var bc = Array.prototype.slice.call(b.childNodes);
    for (var i = 0; i < bc.length; i++) {
      var x = ac[i], y = bc[i];
      if (!x) { a.appendChild(y); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); continue; }
      if (x.nodeType === 1) { syncAttrs(x, y); morph(x, y); }
      else if (x.data !== y.data) x.data = y.data;
    }
    for (var j = ac.length - 1; j >= bc.length; j--) a.removeChild(ac[j]);
  }

  function render() {
    handlers = [];
    var vals = inst.renderVals ? inst.renderVals() : {};
    var tmp = document.createElement('div');
    tmp.innerHTML = renderStr(tpl, vals);
    morph(root, tmp);
  }

  function delegate(type) {
    root.addEventListener(type, function (e) {
      var attr = 'data-dc-on-' + type;
      var el = e.target.closest('[' + attr + ']');
      if (!el || !root.contains(el)) return;
      var fn = handlers[Number(el.getAttribute(attr))];
      if (fn) fn(e);
    });
  }

  function boot() {
    root = document.getElementById('dc-root');
    tpl = document.getElementById('dc-template').textContent;
    var logic = document.getElementById('dc-logic');
    var spec = JSON.parse(logic.getAttribute('data-props') || '{}');
    var props = {};
    Object.keys(spec).forEach(function (k) {
      if (k.charAt(0) !== '$' && spec[k] && 'default' in spec[k]) props[k] = spec[k].default;
    });
    Comp = new Function('DCLogic', logic.textContent + '\nreturn Component;')(DCLogic);
    inst = new Comp(props);
    if (!inst.props) inst.props = props;
    if (!inst.state) inst.state = {};
    ['click', 'input', 'change'].forEach(delegate);
    render();
    if (inst.componentDidMount) inst.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
