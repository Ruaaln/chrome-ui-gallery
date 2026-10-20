/* DevLens page-world collector. Runs as Manifest V3 MAIN-world content script. */
(function () {
  if (window.__devlens_console_patched__) return;
  window.__devlens_console_patched__ = true;

  const LEVELS = ['log','info','warn','error','debug','table','group','groupEnd','time','timeEnd','assert','trace'];
  const original = {};

  LEVELS.forEach(function(level) {
    if (typeof console[level] !== 'function') return;
    original[level] = console[level].bind(console);
    console[level] = function() {
      original[level].apply(console, arguments);
      const args = Array.from(arguments).map(function(a) {
        try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
        catch(e) { return String(a); }
      });
      window.dispatchEvent(new CustomEvent('__devlens_console__', {
        detail: { level: level, args: args, time: Date.now(), stack: (new Error()).stack }
      }));
    };
  });

  // Catch unhandled errors
  window.addEventListener('error', function(e) {
    window.dispatchEvent(new CustomEvent('__devlens_console__', {
      detail: {
        level: 'error',
        args: [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ':' + e.colno + ')' : '')],
        time: Date.now(),
        stack: e.error ? e.error.stack : '',
        source: 'uncaught'
      }
    }));
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    window.dispatchEvent(new CustomEvent('__devlens_console__', {
      detail: {
        level: 'error',
        args: ['Unhandled Promise Rejection: ' + (e.reason ? (e.reason.message || String(e.reason)) : 'unknown')],
        time: Date.now(),
        stack: e.reason && e.reason.stack ? e.reason.stack : '',
        source: 'promise'
      }
    }));
  });

  // ── Fetch patch ──────────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    const url    = typeof input === 'string' ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || 'GET';
    const start  = Date.now();
    const id     = Math.random().toString(36).slice(2);

    window.dispatchEvent(new CustomEvent('__devlens_network__', {
      detail: { id, type:'fetch', url, method, status:null, duration:null, time:start, phase:'start', size:null }
    }));

    return _fetch.apply(this, arguments).then(function(res) {
      let size = null;
      const lengthHeader = res.headers && res.headers.get('content-length');
      if (lengthHeader !== null) {
        const parsed = Number(lengthHeader);
        if (Number.isFinite(parsed) && parsed >= 0) size = parsed;
      }
      window.dispatchEvent(new CustomEvent('__devlens_network__', {
        detail: { id, type:'fetch', url, method, status:res.status,
          statusText:res.statusText, duration:Date.now()-start, time:start,
          phase:'done', size, ok:res.ok }
      }));
      return res;
    }).catch(function(err) {
      window.dispatchEvent(new CustomEvent('__devlens_network__', {
        detail: { id, type:'fetch', url, method, status:'ERR', error: err.message, duration: Date.now()-start, time:start, phase:'error' }
      }));
      throw err;
    });
  };

  // ── XHR patch ────────────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__dl_method__ = method;
    this.__dl_url__    = url;
    this.__dl_id__     = Math.random().toString(36).slice(2);
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    const self   = this;
    const start  = Date.now();
    const id     = this.__dl_id__;
    const url    = this.__dl_url__;
    const method = this.__dl_method__;

    window.dispatchEvent(new CustomEvent('__devlens_network__', {
      detail: { id, type:'xhr', url, method, status:null, duration:null, time:start, phase:'start' }
    }));

    self.addEventListener('load', function() {
      window.dispatchEvent(new CustomEvent('__devlens_network__', {
        detail: {
          id, type:'xhr', url, method,
          status: self.status,
          statusText: self.statusText,
          duration: Date.now() - start,
          time: start,
          phase: 'done',
          size: (function () { try { return (self.responseType === '' || self.responseType === 'text') ? (self.responseText || '').length : null; } catch (_) { return null; } })(),
          ok: self.status >= 200 && self.status < 300
        }
      }));
    });

    self.addEventListener('error', function() {
      window.dispatchEvent(new CustomEvent('__devlens_network__', {
        detail: { id, type:'xhr', url, method, status:'ERR', duration: Date.now()-start, time:start, phase:'error' }
      }));
    });

    return _send.apply(this, arguments);
  };
})();
