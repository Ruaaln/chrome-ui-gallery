/**
 * DevLens — Popup Controller
 */

(function () {
  'use strict';

  let settings = {
    hudVisible:  true,
    hudPosition: 'bottom-right',
    hudOpacity:  0.92,
    theme:       'dark',
    showErrors:  true,
    showWarns:   true,
    showLogs:    true,
    showNetwork: true
  };

  function loadAndRender() {
    chrome.storage.local.get('devlens_settings', function (res) {
      if (res && res.devlens_settings) Object.assign(settings, res.devlens_settings);
      renderUI();
    });
  }

  function renderUI() {
    document.getElementById('tog-hud').checked = settings.hudVisible;

    document.querySelectorAll('.pp-pos-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.pos === settings.hudPosition);
    });

    document.querySelectorAll('.pp-theme-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    const opacityPct = Math.round(settings.hudOpacity * 100);
    document.getElementById('pp-opacity').value = opacityPct;
    document.getElementById('opacity-val').textContent = opacityPct + '%';

    document.getElementById('chk-errors').checked  = settings.showErrors;
    document.getElementById('chk-warns').checked   = settings.showWarns;
    document.getElementById('chk-logs').checked    = settings.showLogs;
    document.getElementById('chk-network').checked = settings.showNetwork;
  }

  function saveAndApply() {
    chrome.storage.local.set({ devlens_settings: settings });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'updateSettings',
          settings: settings
        }).catch(() => {});
      }
    });
  }

  // ── Open panel ────────────────────────────────────────────────────────────
  document.getElementById('pp-open').addEventListener('click', function () {
    chrome.runtime.sendMessage({ action: 'openPanelFromPopup' });
    window.close();
  });

  // ── HUD toggle ────────────────────────────────────────────────────────────
  document.getElementById('tog-hud').addEventListener('change', function () {
    settings.hudVisible = this.checked;
    saveAndApply();
  });

  // ── Position ──────────────────────────────────────────────────────────────
  document.querySelectorAll('.pp-pos-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      settings.hudPosition = btn.dataset.pos;
      document.querySelectorAll('.pp-pos-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveAndApply();
    });
  });

  // ── Theme ─────────────────────────────────────────────────────────────────
  document.querySelectorAll('.pp-theme-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      settings.theme = btn.dataset.theme;
      document.querySelectorAll('.pp-theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      saveAndApply();
    });
  });

  // ── Opacity ───────────────────────────────────────────────────────────────
  document.getElementById('pp-opacity').addEventListener('input', function () {
    const v = parseInt(this.value, 10);
    document.getElementById('opacity-val').textContent = v + '%';
    settings.hudOpacity = v / 100;
    saveAndApply();
  });

  // ── Filter toggles ────────────────────────────────────────────────────────
  document.getElementById('chk-errors').addEventListener('change', function () {
    settings.showErrors = this.checked; saveAndApply();
  });
  document.getElementById('chk-warns').addEventListener('change', function () {
    settings.showWarns = this.checked; saveAndApply();
  });
  document.getElementById('chk-logs').addEventListener('change', function () {
    settings.showLogs = this.checked; saveAndApply();
  });
  document.getElementById('chk-network').addEventListener('change', function () {
    settings.showNetwork = this.checked; saveAndApply();
  });

  // ── Clear ─────────────────────────────────────────────────────────────────
  document.getElementById('pp-clear').addEventListener('click', function () {
    chrome.runtime.sendMessage({ action: 'clearLogs' });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'clearLogs' }).catch(() => {});
      }
    });
    const btn = document.getElementById('pp-clear');
    btn.textContent = '✓ Cleared!';
    setTimeout(function () { btn.textContent = '🗑 Clear Logs'; }, 1500);
  });

  loadAndRender();
})();
