/**
 * Cronos · Checador PWA Serverless
 * Core Application Controller (Vanilla ES Module, 0-build)
 */

import {
  parseAppsScriptUrl,
  buildWebhookUrl,
  encodeCompanyToken,
  decodeInviteInput,
  buildMagicLink
} from './token.js';

const STORAGE_CONFIG_KEY = 'checador_config';
const STORAGE_LAST_CHECKIN_KEY = 'last_checkin';
const STORAGE_DEVICE_ID_KEY = 'cronos_device_id';
const STORAGE_KNOWN_WORKERS_KEY = 'cronos_known_workers';
const STORAGE_PWA_DISMISSED_KEY = 'cronos_pwa_dismissed_at';
const STORAGE_ADMIN_DRAFT_KEY = 'cronos_admin_draft';

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PWA_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const MONTHS_SHORT_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
];

// Application Runtime State
const state = {
  currentView: null, // 'welcome' | 'register' | 'checador' | 'admin'
  quickSwitchMode: false, // true when active worker taps "Cambiar QR / Hoja" keeping their session & ID
  registerAuthTab: 'new', // 'new' | 'id'
  pendingNewWorkerId: '', // 8-digit ID pre-generated for "Soy nuevo"
  pendingCompany: null, // { scriptId, orgName, sheetId, isSessionSwitch: boolean }
  lastAttemptedPunchType: null, // 'ENTRADA' | 'SALIDA'
  pendingRepeatType: null,
  unlinkConfirmArmed: false,
  deferredInstallPrompt: null,
  clockTimerId: null,
  qrScanner: null,
  qrScannerRunning: false,
  html5QrScriptPromise: null,
  adminModulesPromise: null,
  activeAdminAccess: null, // { scriptId, orgName, sheetId, sheetUrl, token, magicLink }
  adminSheetsCatalog: [], // [{ sheetId, orgName, sheetUrl, createdAt, isPrimary }]
  adminPin: '',
  deviceId: '' // Persistent phone identifier (CEL-XXXXXXXX)
};

// Cached DOM References
const el = {};

function cacheElements() {
  const ids = [
    'app-main', 'brand-link', 'topbar-mode-tag',
    'btn-go-admin', 'btn-exit-admin', 'btn-worker-menu', 'offline-banner',
    // View 1: Welcome
    'view-welcome', 'welcome-eyebrow', 'welcome-heading', 'welcome-lead',
    'welcome-error', 'btn-open-scanner', 'label-open-scanner', 'scanner-panel',
    'qr-reader', 'scanner-status-msg', 'qr-file-input', 'btn-close-scanner',
    'form-paste-invite', 'input-invite-code', 'btn-paste-clipboard',
    'btn-cancel-quick-switch',
    // View 2: Register / Session Login (New Worker or 8-Digit ID)
    'view-register', 'register-kicker', 'register-org-name',
    'register-switch-notice', 'register-error',
    'auth-mode-tabs', 'tab-auth-new', 'tab-auth-id',
    'pane-auth-new', 'pane-auth-id',
    'form-worker-register', 'input-worker-name',
    'register-generated-id', 'btn-copy-register-id',
    'input-worker-id', 'login-bind-name-box', 'input-bind-worker-name',
    'input-privacy-accept', 'btn-save-worker', 'btn-cancel-register',
    // View 3: Checador
    'view-checador', 'checador-org-name', 'checador-worker-name',
    'checador-worker-id', 'btn-copy-worker-id', 'worker-id-copy-tag',
    'btn-card-options',
    'live-clock-time', 'live-clock-date', 'btn-punch-in', 'btn-punch-out',
    'punch-loading-box', 'punch-loading-title', 'punch-loading-sub',
    'punch-error-box', 'punch-error-title', 'punch-error-desc', 'punch-error-steps',
    'btn-retry-punch', 'last-checkin-value',
    // PWA Banner
    'pwa-install-banner', 'pwa-android-box', 'pwa-ios-box',
    'btn-pwa-install', 'btn-pwa-dismiss',
    // View 4: Admin
    'view-admin', 'admin-setup-guide', 'btn-copy-gas', 'gas-code-preview',
    'admin-grid', 'admin-form-card', 'admin-form-error', 'form-admin-generate',
    'admin-org-name', 'admin-script-url', 'admin-pin', 'btn-generate-access',
    'admin-sheets-panel', 'admin-sheets-count-badge', 'admin-sheets-list',
    'admin-create-sheet-status', 'form-admin-create-sheet', 'new-sheet-org-name',
    'new-sheet-copy-workers', 'btn-create-new-sheet',
    'admin-output-card', 'poster-org-title', 'admin-qr-canvas',
    'btn-open-active-sheet', 'admin-magic-link', 'btn-copy-magic-link', 'btn-share-whatsapp',
    'btn-download-qr', 'btn-print-qr', 'btn-test-connection', 'test-connection-result',
    // Modals & Toast
    'modal-success', 'success-banner', 'success-stamp', 'success-time-big',
    'success-headline', 'success-worker', 'success-worker-id', 'success-org',
    'success-server-time', 'success-timezone', 'success-accuracy',
    'success-seal-row', 'success-seal', 'btn-close-success',
    'modal-confirm-repeat', 'repeat-message', 'btn-confirm-repeat-yes', 'btn-confirm-repeat-no',
    'modal-account', 'account-modal-sub', 'btn-switch-qr', 'desc-switch-qr',
    'btn-change-worker', 'desc-change-worker',
    'btn-unlink-company', 'title-unlink-company', 'desc-unlink-company', 'btn-close-account',
    'modal-worker-id', 'modal-id-worker-name', 'modal-id-digits',
    'btn-modal-copy-id', 'btn-close-worker-id',
    'app-toast'
  ];

  for (const id of ids) {
    el[id] = document.getElementById(id);
  }
}

/* ==========================================================================
   Persistent Device Identity (CEL-XXXXXXXX) & 8-Digit Worker ID Helpers
   ========================================================================== */

function generateRandomHex8() {
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint8Array(4);
    window.crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return Math.floor(0x10000000 + Math.random() * 0xefffffff)
    .toString(16)
    .toUpperCase()
    .slice(0, 8);
}

function readDeviceCookie() {
  try {
    const m = document.cookie.match(/(?:^|;\s*)cronos_device_id=([A-Za-z0-9\-]+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function writeDeviceCookie(devId) {
  try {
    document.cookie = `cronos_device_id=${devId}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    // Ignore cookie errors in restricted contexts
  }
}

function syncDeviceIdWithIndexedDb(currentId) {
  try {
    if (!('indexedDB' in window)) return;
    const req = window.indexedDB.open('cronos_device_db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      const getReq = store.get('deviceId');
      getReq.onsuccess = () => {
        const idbVal = getReq.result;
        if (idbVal && typeof idbVal === 'string' && /^CEL-[A-Z0-9]{8}$/.test(idbVal)) {
          state.deviceId = idbVal;
          try {
            localStorage.setItem(STORAGE_DEVICE_ID_KEY, idbVal);
          } catch {}
          writeDeviceCookie(idbVal);
        } else if (currentId) {
          store.put(currentId, 'deviceId');
        }
      };
    };
  } catch {
    // Ignore IndexedDB restrictions
  }
}

function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  let os = 'Móvil';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iPhone';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS/i.test(ua)) os = 'Mac';

  let browser = 'Web';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return `${os} · ${browser}`;
}

function getDeviceIdentity() {
  if (!state.deviceId) {
    let stored = '';
    try {
      stored = localStorage.getItem(STORAGE_DEVICE_ID_KEY) || '';
    } catch {}
    if (!/^CEL-[A-Z0-9]{8}$/.test(stored)) {
      stored = readDeviceCookie();
    }
    if (!/^CEL-[A-Z0-9]{8}$/.test(stored)) {
      stored = `CEL-${generateRandomHex8()}`;
    }
    state.deviceId = stored;
    try {
      localStorage.setItem(STORAGE_DEVICE_ID_KEY, stored);
    } catch {}
    writeDeviceCookie(stored);
    syncDeviceIdWithIndexedDb(stored);
  }
  return {
    deviceId: state.deviceId,
    deviceLabel: getDeviceLabel()
  };
}

function normalizeWorkerId8(raw) {
  const digits = String(raw || '').replace(/\D+/g, '');
  return digits.length === 8 ? digits : '';
}

function formatWorkerId8(raw) {
  const digits = normalizeWorkerId8(raw);
  if (!digits) return '----';
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
}

function formatPartialWorkerIdInput(raw) {
  const digits = String(raw || '').replace(/\D+/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function generateRandomWorkerId8() {
  if (window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    window.crypto.getRandomValues(arr);
    const num = 10000000 + (arr[0] % 90000000);
    return String(num);
  }
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function rememberWorkerLocally(workerId, workerName) {
  const cleanId = normalizeWorkerId8(workerId);
  if (!cleanId || !workerName) return;
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KNOWN_WORKERS_KEY) || '{}');
    map[cleanId] = workerName;
    localStorage.setItem(STORAGE_KNOWN_WORKERS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

function lookupLocalWorkerName(workerId) {
  const cleanId = normalizeWorkerId8(workerId);
  if (!cleanId) return '';
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KNOWN_WORKERS_KEY) || '{}');
    return typeof map[cleanId] === 'string' ? map[cleanId] : '';
  } catch {
    return '';
  }
}

/* ==========================================================================
   Storage Helpers
   ========================================================================== */

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.scriptId === 'string' &&
      parsed.scriptId.trim() &&
      typeof parsed.orgName === 'string' &&
      parsed.orgName.trim() &&
      typeof parsed.workerName === 'string' &&
      parsed.workerName.trim() &&
      parsed.privacyAccepted === true
    ) {
      parsed.sheetId = typeof parsed.sheetId === 'string' ? parsed.sheetId.trim() : '';
      // Auto-assign an 8-digit workerId if migrating from an older localStorage config
      if (!normalizeWorkerId8(parsed.workerId)) {
        parsed.workerId = generateRandomWorkerId8();
        saveConfig(parsed);
      }
      rememberWorkerLocally(parsed.workerId, parsed.workerName);
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isSameSheetTarget(a, b) {
  if (!a || !b) return false;
  return (
    a.scriptId === b.scriptId &&
    (a.sheetId || '') === (b.sheetId || '') &&
    a.orgName === b.orgName
  );
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
  if (config && config.workerId && config.workerName) {
    rememberWorkerLocally(config.workerId, config.workerName);
  }
}

function loadLastCheckin() {
  try {
    const raw = localStorage.getItem(STORAGE_LAST_CHECKIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === 'string' && typeof parsed.serverTime === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveLastCheckin(record) {
  localStorage.setItem(STORAGE_LAST_CHECKIN_KEY, JSON.stringify(record));
}

function clearAllWorkerData() {
  localStorage.removeItem(STORAGE_CONFIG_KEY);
  localStorage.removeItem(STORAGE_LAST_CHECKIN_KEY);
}

/* ==========================================================================
   Formatting & UI Helpers
   ========================================================================== */

let toastTimer = null;
function showToast(message, durationMs = 2800) {
  if (!el['app-toast']) return;
  el['app-toast'].textContent = message;
  el['app-toast'].hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el['app-toast'].hidden = true;
  }, durationMs);
}

/**
 * Formats server `localTime` ("YYYY-MM-DD HH:mm:ss") without using `new Date()`
 * so the official server timezone is never shifted by a misconfigured phone clock.
 */
function formatServerTimeParts(serverTimeStr) {
  const str = (serverTimeStr || '').trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    return {
      time12h: str || '--:--',
      shortDate: '',
      compact: str || '—'
    };
  }

  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const hour24 = parseInt(m[4], 10);
  const minute = m[5];

  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const hour12Pad = String(hour12).padStart(2, '0');
  const monthLabel = MONTHS_SHORT_ES[monthIdx] || m[2];

  const time12h = `${hour12Pad}:${minute} ${period}`;
  const shortDate = `${day} ${monthLabel} ${year}`;

  return {
    time12h,
    shortDate,
    compact: `${time12h} · ${day} ${monthLabel}`
  };
}

function cleanJoinQueryFromUrl() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('join')) {
    url.searchParams.delete('join');
    const cleanSearch = url.searchParams.toString();
    const nextUrl =
      url.pathname +
      (cleanSearch ? `?${cleanSearch}` : '') +
      url.hash;
    window.history.replaceState({}, document.title, nextUrl);
  }
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand('copy') if Clipboard API permission is denied
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

/* ==========================================================================
   View Router & Navigation
   ========================================================================== */

function isRequestedAdminRoute() {
  const hash = (window.location.hash || '').toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname || '';
  return (
    hash === '#admin' ||
    hash === '#/admin' ||
    params.has('admin') ||
    /\/admin\/?$/i.test(path)
  );
}

async function switchView(viewName) {
  if (viewName !== 'welcome') {
    stopQrScanner();
  }

  state.currentView = viewName;

  // Toggle view sections
  el['view-welcome'].hidden = viewName !== 'welcome';
  el['view-register'].hidden = viewName !== 'register';
  el['view-checador'].hidden = viewName !== 'checador';
  el['view-admin'].hidden = viewName !== 'admin';

  // Layout width
  el['app-main'].classList.toggle('is-wide', viewName === 'admin');

  // Topbar contextual buttons & tag
  const isAdmin = viewName === 'admin';
  el['topbar-mode-tag'].textContent = isAdmin ? 'ADMIN' : 'CHECADOR';
  el['topbar-mode-tag'].classList.toggle('is-admin', isAdmin);

  // Admin shortcut ONLY shown on unconfigured welcome screen (hidden for active workers & quick-switch)
  const isQuickSwitch = viewName === 'welcome' && state.quickSwitchMode && !!loadConfig();
  el['btn-go-admin'].hidden = viewName !== 'welcome' || isQuickSwitch;
  el['btn-exit-admin'].hidden = viewName !== 'admin';
  el['btn-worker-menu'].hidden = viewName !== 'checador';

  if (viewName === 'welcome') {
    renderWelcomeView();
  }

  // Live clock only runs while on Checador view
  if (viewName === 'checador') {
    state.quickSwitchMode = false;
    startLiveClock();
    renderChecadorView();
  } else {
    stopLiveClock();
  }

  // PWA install prompt banner shown on Onboarding Step 2 & Checador (not Admin)
  updatePwaBannerVisibility();

  if (viewName === 'admin') {
    await initAdminPanel();
  }
}

function routeFromCurrentState() {
  if (isRequestedAdminRoute()) {
    switchView('admin');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const joinToken = params.get('join');
  const existingConfig = loadConfig();

  if (joinToken) {
    const decoded = decodeInviteInput(joinToken);
    if (decoded.ok) {
      if (state.quickSwitchMode && existingConfig) {
        applyDecodedInvite({
          scriptId: decoded.scriptId,
          orgName: decoded.orgName,
          sheetId: decoded.sheetId || ''
        });
        return;
      }

      // If already configured for this exact company & sheet, clean URL and open daily checador
      if (existingConfig && isSameSheetTarget(existingConfig, decoded)) {
        cleanJoinQueryFromUrl();
        showToast(`Empresa activa: ${existingConfig.orgName}`);
        switchView('checador');
        return;
      }

      openRegistrationForCompany({
        scriptId: decoded.scriptId,
        orgName: decoded.orgName,
        sheetId: decoded.sheetId || '',
        isSessionSwitch: false
      });
      return;
    } else {
      cleanJoinQueryFromUrl();
      showWelcomeError(decoded.error);
      switchView('welcome');
      return;
    }
  }

  if (existingConfig) {
    switchView('checador');
  } else {
    switchView('welcome');
  }
}

/* ==========================================================================
   View 1: Welcome — QR Scanner (Lazy-Loaded), Paste Invite & 1-Step QR Switch
   ========================================================================== */

function renderWelcomeView() {
  const existing = loadConfig();
  const isQuickSwitch = state.quickSwitchMode && !!existing;

  showWelcomeError('');

  if (isQuickSwitch) {
    el['welcome-eyebrow'].textContent = 'Cambio de hoja · Manteniendo tu sesión';
    el['welcome-heading'].textContent = 'Vincular nuevo QR o enlace';
    el['welcome-lead'].textContent =
      `Escanea el nuevo código QR o pega el nuevo enlace (por ejemplo, nueva hoja anual). Seguirás en tu sesión como "${existing.workerName}" (ID ${formatWorkerId8(existing.workerId)}).`;
    el['label-open-scanner'].textContent = 'Escanear nuevo código QR';
    el['btn-cancel-quick-switch'].hidden = false;
  } else {
    el['welcome-eyebrow'].textContent = 'Vinculación de trabajador';
    el['welcome-heading'].textContent = 'Conecta con tu empresa';
    el['welcome-lead'].textContent =
      'Escanea el código QR de tu lugar de trabajo o pega el enlace de invitación recibido por WhatsApp.';
    el['label-open-scanner'].textContent = 'Escanear QR de mi empresa';
    el['btn-cancel-quick-switch'].hidden = true;
  }
}

/**
 * Applies a decoded company invite. If the worker launched "Cambiar QR / Hoja"
 * (`state.quickSwitchMode`), switches the linked Google Sheet in 1 step while
 * preserving their saved `workerName`, 8-digit `workerId`, and privacy consent.
 */
function applyDecodedInvite({ scriptId, orgName, sheetId = '' }) {
  const existing = loadConfig();
  const cleanSheetId = (sheetId || '').trim();

  if (state.quickSwitchMode && existing) {
    const isSameSheet = isSameSheetTarget(existing, {
      scriptId,
      orgName,
      sheetId: cleanSheetId
    });
    const updatedConfig = {
      scriptId,
      orgName,
      sheetId: cleanSheetId,
      workerId: existing.workerId,
      workerName: existing.workerName,
      privacyAccepted: true,
      configuredAt: new Date().toISOString()
    };
    saveConfig(updatedConfig);
    if (!isSameSheet) {
      localStorage.removeItem(STORAGE_LAST_CHECKIN_KEY);
    }
    state.quickSwitchMode = false;
    cleanJoinQueryFromUrl();
    switchView('checador');
    showToast(`Conectado a "${orgName}" como ${existing.workerName}`, 3400);
    return;
  }

  openRegistrationForCompany({
    scriptId,
    orgName,
    sheetId: cleanSheetId,
    isSessionSwitch: false
  });
}

function showWelcomeError(msg) {
  if (!msg) {
    el['welcome-error'].hidden = true;
    el['welcome-error'].textContent = '';
    return;
  }
  el['welcome-error'].textContent = msg;
  el['welcome-error'].hidden = false;
}

function loadHtml5QrcodeScript() {
  if (window.Html5Qrcode) {
    return Promise.resolve(window.Html5Qrcode);
  }
  if (state.html5QrScriptPromise) {
    return state.html5QrScriptPromise;
  }

  state.html5QrScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/html5-qrcode.min.js';
    script.async = true;
    script.onload = () => {
      if (window.Html5Qrcode) {
        resolve(window.Html5Qrcode);
      } else {
        state.html5QrScriptPromise = null;
        reject(new Error('No se pudo inicializar el lector QR.'));
      }
    };
    script.onerror = () => {
      state.html5QrScriptPromise = null;
      reject(new Error('Error al cargar el módulo de cámara. Revisa tu conexión.'));
    };
    document.head.appendChild(script);
  });

  return state.html5QrScriptPromise;
}

async function startQrScanner() {
  showWelcomeError('');
  el['scanner-panel'].hidden = false;
  el['scanner-status-msg'].hidden = false;
  el['scanner-status-msg'].textContent = 'Cargando lector QR…';

  try {
    const Html5Qrcode = await loadHtml5QrcodeScript();

    if (state.qrScannerRunning) return;

    el['scanner-status-msg'].textContent = 'Solicitando permiso de cámara…';

    if (!state.qrScanner) {
      state.qrScanner = new Html5Qrcode('qr-reader');
    }

    const scanConfig = {
      fps: 10,
      qrbox: { width: 220, height: 220 },
      aspectRatio: 1.0
    };

    const onScanSuccess = async (decodedText) => {
      const parsed = decodeInviteInput(decodedText);
      if (!parsed.ok) {
        showWelcomeError('Ese código QR no pertenece a Cronos. Escanea el QR generado por tu empresa.');
        return;
      }
      if (navigator.vibrate) navigator.vibrate(60);
      await stopQrScanner();
      applyDecodedInvite({
        scriptId: parsed.scriptId,
        orgName: parsed.orgName,
        sheetId: parsed.sheetId || ''
      });
    };

    try {
      await state.qrScanner.start(
        { facingMode: 'environment' },
        scanConfig,
        onScanSuccess,
        () => {}
      );
      state.qrScannerRunning = true;
    } catch {
      await state.qrScanner.start(
        { facingMode: 'user' },
        scanConfig,
        onScanSuccess,
        () => {}
      );
      state.qrScannerRunning = true;
    }
  } catch (err) {
    state.qrScannerRunning = false;
    el['scanner-status-msg'].hidden = false;
    el['scanner-status-msg'].textContent =
      'No se pudo acceder a la cámara. Puedes subir una foto del QR o pegar el enlace de WhatsApp.';
    showWelcomeError(
      err && err.message && !/Permission|NotAllowed/i.test(String(err))
        ? String(err.message || err)
        : 'Permiso de cámara denegado o cámara no disponible. Usa "Subir imagen de QR" o pega el código de invitación.'
    );
  }
}

async function stopQrScanner() {
  if (state.qrScanner && state.qrScannerRunning) {
    try {
      await state.qrScanner.stop();
    } catch {
      // Ignore stop errors if stream already ended
    }
    state.qrScannerRunning = false;
  }
  if (el['scanner-panel']) {
    el['scanner-panel'].hidden = true;
  }
}

async function handleQrImageUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  showWelcomeError('');

  try {
    const Html5Qrcode = await loadHtml5QrcodeScript();
    if (state.qrScannerRunning) {
      await stopQrScanner();
    }
    if (!state.qrScanner) {
      state.qrScanner = new Html5Qrcode('qr-reader');
    }

    const decodedText = await state.qrScanner.scanFile(file, false);
    const parsed = decodeInviteInput(decodedText);
    if (!parsed.ok) {
      showWelcomeError(parsed.error);
      return;
    }

    applyDecodedInvite({
      scriptId: parsed.scriptId,
      orgName: parsed.orgName,
      sheetId: parsed.sheetId || ''
    });
  } catch {
    showWelcomeError('No se detectó un código QR legible en la imagen seleccionada.');
  } finally {
    event.target.value = '';
  }
}

/* ==========================================================================
   View 2: Worker Onboarding & Session Login (New Worker or 8-Digit ID)
   ========================================================================== */

function setRegisterAuthTab(mode) {
  const isNew = mode !== 'id';
  state.registerAuthTab = isNew ? 'new' : 'id';

  el['tab-auth-new'].classList.toggle('is-active', isNew);
  el['tab-auth-new'].setAttribute('aria-selected', String(isNew));

  el['tab-auth-id'].classList.toggle('is-active', !isNew);
  el['tab-auth-id'].setAttribute('aria-selected', String(!isNew));

  el['pane-auth-new'].hidden = !isNew;
  el['pane-auth-id'].hidden = isNew;

  el['register-error'].hidden = true;
  el['btn-save-worker'].textContent = isNew
    ? 'Crear mi ID y entrar'
    : 'Iniciar sesión con mi ID';
}

function openRegistrationForCompany({ scriptId, orgName, sheetId = '', isSessionSwitch = false }) {
  const existing = loadConfig();
  const cleanSheetId = (sheetId || '').trim();
  state.pendingCompany = { scriptId, orgName, sheetId: cleanSheetId, isSessionSwitch };
  state.pendingNewWorkerId = generateRandomWorkerId8();

  el['register-error'].hidden = true;
  el['login-bind-name-box'].hidden = true;
  el['input-bind-worker-name'].value = '';
  el['input-worker-id'].value = '';
  el['register-generated-id'].textContent = formatWorkerId8(state.pendingNewWorkerId);

  el['register-kicker'].textContent = isSessionSwitch
    ? 'Cambiar sesión en:'
    : 'Te estás uniendo a:';
  el['register-org-name'].textContent = orgName;

  if (!isSessionSwitch && existing && !isSameSheetTarget(existing, { scriptId, orgName, sheetId: cleanSheetId })) {
    el['register-switch-notice'].textContent =
      `Este dispositivo estaba vinculado a "${existing.orgName}". Al guardar quedarás vinculado a "${orgName}".`;
    el['register-switch-notice'].hidden = false;
  } else if (isSessionSwitch && existing) {
    el['register-switch-notice'].textContent =
      `Ingresa tu ID de 8 dígitos para iniciar tu sesión en "${orgName}" (o elige "Soy nuevo" si aún no tienes ID).`;
    el['register-switch-notice'].hidden = false;
  } else {
    el['register-switch-notice'].hidden = true;
  }

  if (isSessionSwitch) {
    el['input-worker-name'].value = '';
    el['input-privacy-accept'].checked = true;
    setRegisterAuthTab('id');
  } else if (existing && existing.workerName) {
    el['input-worker-name'].value = existing.workerName;
    el['input-privacy-accept'].checked = existing.privacyAccepted === true;
    setRegisterAuthTab('new');
  } else {
    el['input-worker-name'].value = '';
    el['input-privacy-accept'].checked = false;
    setRegisterAuthTab('new');
  }

  switchView('register');
  setTimeout(() => {
    if (state.registerAuthTab === 'id') {
      el['input-worker-id'].focus();
    } else {
      el['input-worker-name'].focus();
    }
  }, 50);
}

async function handleSaveWorkerRegistration(event) {
  event.preventDefault();
  el['register-error'].hidden = true;

  if (!state.pendingCompany) {
    switchView('welcome');
    return;
  }

  const privacyAccepted = el['input-privacy-accept'].checked;

  // MODE A: New Worker Registration ("Soy nuevo")
  if (state.registerAuthTab === 'new') {
    const workerName = (el['input-worker-name'].value || '').trim().replace(/\s+/g, ' ');
    if (workerName.length < 2) {
      el['register-error'].textContent = 'Escribe tu nombre completo (mínimo 2 caracteres).';
      el['register-error'].hidden = false;
      el['input-worker-name'].focus();
      return;
    }

    if (!privacyAccepted) {
      el['register-error'].textContent =
        'Debes aceptar el aviso de privacidad sobre el uso puntual de tu ubicación GPS para continuar.';
      el['register-error'].hidden = false;
      el['input-privacy-accept'].focus();
      return;
    }

    const workerId = normalizeWorkerId8(state.pendingNewWorkerId) || generateRandomWorkerId8();
    completeWorkerSessionLogin({
      scriptId: state.pendingCompany.scriptId,
      orgName: state.pendingCompany.orgName,
      sheetId: state.pendingCompany.sheetId || '',
      workerId,
      workerName,
      toastMsg: `Perfil guardado correctamente · ID ${formatWorkerId8(workerId)}`
    });
    return;
  }

  // MODE B: Existing Worker Login by 8-Digit Numeric ID ("Ya tengo mi ID")
  const digits8 = normalizeWorkerId8(el['input-worker-id'].value);
  if (!digits8) {
    el['register-error'].textContent =
      'Ingresa tu ID completo de 8 dígitos numéricos (ej. 4829-1034).';
    el['register-error'].hidden = false;
    el['input-worker-id'].focus();
    return;
  }

  if (!privacyAccepted) {
    el['register-error'].textContent =
      'Debes aceptar el aviso de privacidad sobre el uso puntual de tu ubicación GPS para continuar.';
    el['register-error'].hidden = false;
    el['input-privacy-accept'].focus();
    return;
  }

  // If the sheet is brand-new and we already prompted them to confirm their name once:
  if (!el['login-bind-name-box'].hidden) {
    const boundName = (el['input-bind-worker-name'].value || '').trim().replace(/\s+/g, ' ');
    if (boundName.length < 2) {
      el['register-error'].textContent =
        'Escribe tu nombre completo para vincular tu ID de 8 dígitos a esta hoja.';
      el['register-error'].hidden = false;
      el['input-bind-worker-name'].focus();
      return;
    }

    completeWorkerSessionLogin({
      scriptId: state.pendingCompany.scriptId,
      orgName: state.pendingCompany.orgName,
      sheetId: state.pendingCompany.sheetId || '',
      workerId: digits8,
      workerName: boundName,
      toastMsg: `Sesión iniciada: ${boundName} (ID ${formatWorkerId8(digits8)})`
    });
    return;
  }

  // Query Google Sheets ("Trabajadores" tab) to resolve frozen workerName from 8-digit ID
  const btn = el['btn-save-worker'];
  const origBtnText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verificando ID…';

  try {
    const device = getDeviceIdentity();
    const res = await sendWebhookPost(
      state.pendingCompany.scriptId,
      {
        action: 'login_worker',
        sheetId: state.pendingCompany.sheetId || '',
        workerId: digits8,
        deviceId: device.deviceId,
        deviceLabel: device.deviceLabel
      },
      { allowNotFound: true }
    );

    if (res && res.status === 'ok' && res.workerName) {
      completeWorkerSessionLogin({
        scriptId: state.pendingCompany.scriptId,
        orgName: state.pendingCompany.orgName,
        sheetId: state.pendingCompany.sheetId || '',
        workerId: normalizeWorkerId8(res.workerId) || digits8,
        workerName: res.workerName,
        toastMsg: `Sesión activa: ${res.workerName} (ID ${formatWorkerId8(digits8)})`
      });
      return;
    }

    // Fallback if this phone already knows this 8-digit ID locally
    const cachedName = lookupLocalWorkerName(digits8);
    if (cachedName) {
      completeWorkerSessionLogin({
        scriptId: state.pendingCompany.scriptId,
        orgName: state.pendingCompany.orgName,
        sheetId: state.pendingCompany.sheetId || '',
        workerId: digits8,
        workerName: cachedName,
        toastMsg: `Sesión activa: ${cachedName} (ID ${formatWorkerId8(digits8)})`
      });
      return;
    }

    // If not found in this Sheet yet (e.g., brand-new annual Sheet), ask for name once keeping their 8-digit ID
    el['login-bind-name-box'].hidden = false;
    el['register-switch-notice'].textContent =
      `El ID ${formatWorkerId8(digits8)} aún no aparece en la pestaña Trabajadores de "${state.pendingCompany.orgName}". Escribe tu nombre completo abajo una sola vez para vincular tu mismo ID.`;
    el['register-switch-notice'].hidden = false;
    el['input-bind-worker-name'].focus();
  } catch (err) {
    const cachedName = lookupLocalWorkerName(digits8);
    if (cachedName) {
      completeWorkerSessionLogin({
        scriptId: state.pendingCompany.scriptId,
        orgName: state.pendingCompany.orgName,
        sheetId: state.pendingCompany.sheetId || '',
        workerId: digits8,
        workerName: cachedName,
        toastMsg: `Sesión activa: ${cachedName} (ID ${formatWorkerId8(digits8)})`
      });
      return;
    }

    el['register-error'].textContent =
      (err && err.message) || 'No se pudo verificar el ID. Revisa tu conexión a internet.';
    el['register-error'].hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = origBtnText;
  }
}

function completeWorkerSessionLogin({ scriptId, orgName, sheetId = '', workerId, workerName, toastMsg }) {
  const prev = loadConfig();
  const cleanSheetId = (sheetId || '').trim();
  const isDifferentWorkerOrOrg =
    !prev ||
    !isSameSheetTarget(prev, { scriptId, orgName, sheetId: cleanSheetId }) ||
    prev.workerId !== workerId ||
    prev.workerName.toLowerCase() !== workerName.toLowerCase();

  const newConfig = {
    scriptId,
    orgName,
    sheetId: cleanSheetId,
    workerId,
    workerName,
    privacyAccepted: true,
    configuredAt: new Date().toISOString()
  };

  saveConfig(newConfig);

  if (isDifferentWorkerOrOrg) {
    localStorage.removeItem(STORAGE_LAST_CHECKIN_KEY);
  }

  cleanJoinQueryFromUrl();
  state.pendingCompany = null;

  showToast(toastMsg || 'Perfil guardado correctamente');
  switchView('checador');
}

/* ==========================================================================
   View 3: Daily Worker Checador, Live Clock & Mandatory GPS Punch
   ========================================================================== */

function updateLiveClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  el['live-clock-time'].textContent = `${hh}:${mm}:${ss}`;

  try {
    const rawDate = now.toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
    el['live-clock-date'].textContent = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  } catch {
    el['live-clock-date'].textContent = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
  }
}

function startLiveClock() {
  updateLiveClock();
  if (state.clockTimerId) clearInterval(state.clockTimerId);
  state.clockTimerId = setInterval(updateLiveClock, 1000);
}

function stopLiveClock() {
  if (state.clockTimerId) {
    clearInterval(state.clockTimerId);
    state.clockTimerId = null;
  }
}

function renderChecadorView() {
  const config = loadConfig();
  if (!config) {
    switchView('welcome');
    return;
  }

  el['checador-org-name'].textContent = config.orgName;
  el['checador-worker-name'].textContent = config.workerName;
  el['checador-worker-id'].textContent = formatWorkerId8(config.workerId);
  el['punch-loading-box'].hidden = true;
  el['punch-error-box'].hidden = true;
  setPunchButtonsDisabled(false);

  renderLastCheckinFooter();
}

function renderLastCheckinFooter() {
  const last = loadLastCheckin();
  const container = el['last-checkin-value'];
  container.textContent = '';

  if (!last) {
    container.textContent = 'Sin registros previos';
    return;
  }

  const badge = document.createElement('span');
  const isEntrada = last.type === 'ENTRADA';
  badge.className = `badge-type ${isEntrada ? 'is-in' : 'is-out'}`;
  badge.textContent = last.type;

  const timeSpan = document.createElement('span');
  const parts = formatServerTimeParts(last.serverTime);
  timeSpan.textContent = parts.compact;

  container.appendChild(badge);
  container.appendChild(timeSpan);
}

function setPunchButtonsDisabled(disabled) {
  el['btn-punch-in'].disabled = disabled;
  el['btn-punch-out'].disabled = disabled;
}

/**
 * Initiates check-in (`ENTRADA` or `SALIDA`), guarding against accidental
 * duplicate taps of the same type within 5 minutes.
 */
function requestPunch(type, bypassDuplicateCheck = false) {
  const last = loadLastCheckin();
  if (
    !bypassDuplicateCheck &&
    last &&
    last.type === type &&
    typeof last.recordedAtMs === 'number' &&
    Date.now() - last.recordedAtMs < DUPLICATE_WINDOW_MS
  ) {
    state.pendingRepeatType = type;
    const parts = formatServerTimeParts(last.serverTime);
    el['repeat-message'].textContent =
      `Ya registraste una ${type} hace menos de 5 minutos (${parts.time12h}). ¿Confirmas que deseas registrar otra ${type}?`;
    openModal('modal-confirm-repeat', 'btn-confirm-repeat-no');
    return;
  }

  executePunch(type);
}

function getPositionPromise(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Acquires mandatory GPS coordinates.
 * Tries high-accuracy satellite GPS first; if indoor concrete causes TIMEOUT/UNAVAILABLE,
 * performs one network/Wi-Fi geolocation fallback (still requiring real coordinates).
 */
async function acquireMandatoryGps() {
  if (!('geolocation' in navigator)) {
    const err = new Error('Tu navegador no soporta geolocalización GPS.');
    err.customKind = 'UNSUPPORTED';
    throw err;
  }

  try {
    return await getPositionPromise({
      enableHighAccuracy: true,
      timeout: 14000,
      maximumAge: 0
    });
  } catch (err) {
    if (err && err.code === 1) {
      throw err;
    }
    return await getPositionPromise({
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 0
    });
  }
}

function renderPunchError({ title, description, steps = [] }) {
  el['punch-loading-box'].hidden = true;
  el['punch-error-title'].textContent = title;
  el['punch-error-desc'].textContent = description;

  const list = el['punch-error-steps'];
  list.innerHTML = '';
  if (steps.length > 0) {
    for (const stepText of steps) {
      const li = document.createElement('li');
      li.textContent = stepText;
      list.appendChild(li);
    }
    list.hidden = false;
  } else {
    list.hidden = true;
  }

  el['punch-error-box'].hidden = false;
}

function buildGpsFailureGuidance(err) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (err && err.code === 1) {
    return {
      title: 'Permiso de ubicación bloqueado (GPS obligatorio)',
      description: 'Para registrar tu asistencia es indispensable permitir el acceso a tu ubicación actual.',
      steps: isIOS
        ? [
            'Toca el ícono "aA" o de controles junto a la barra de dirección en Safari.',
            'Entra a Configuración del sitio web > Ubicación y elige "Permitir".',
            'Si sigue bloqueado, revisa Ajustes de iPhone > Privacidad > Localización > Sitios web de Safari.'
          ]
        : [
            'Toca el ícono de candado o ajustes junto a la dirección web arriba.',
            'Entra a "Permisos" y activa "Ubicación".',
            'Verifica también que el GPS / Ubicación del teléfono esté encendido en la barra superior.'
          ]
    };
  }

  if (err && (err.code === 2 || err.code === 3)) {
    return {
      title: 'No se logró obtener señal GPS',
      description: 'El registro requiere ubicación válida y el teléfono no pudo determinar tus coordenadas a tiempo.',
      steps: [
        'Verifica que la "Ubicación / GPS" de tu celular esté encendida.',
        'Acércate a una ventana o espacio abierto por unos segundos.',
        'Presiona "Reintentar registro".'
      ]
    };
  }

  return {
    title: 'Geolocalización no disponible',
    description: (err && err.message) || 'Tu dispositivo o navegador no permitió consultar el GPS.',
    steps: [
      'Abre el enlace en Google Chrome (Android) o Safari (iPhone) con conexión segura (HTTPS).'
    ]
  };
}

async function sendWebhookPost(scriptId, payload, { allowNotFound = false } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 22000);

  try {
    const response = await fetch(buildWebhookUrl(scriptId), {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(
        'La hoja de la empresa no devolvió una respuesta válida. Verifica con el administrador que en Apps Script "Quién tiene acceso" esté en "Cualquier usuario".'
      );
    }

    if (allowNotFound && data && data.status === 'not_found') {
      return data;
    }

    if (!response.ok || !data || data.status !== 'ok') {
      throw new Error(
        (data && data.message) || 'El servidor de Google Sheets reportó un error al guardar la fila.'
      );
    }

    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('La conexión tardó demasiado. Verifica tu señal de internet e intenta de nuevo.');
    }
    if (!navigator.onLine) {
      throw new Error('Sin conexión a internet. Activa tus datos móviles o Wi-Fi.');
    }
    if (err instanceof TypeError) {
      throw new Error(
        'No se pudo conectar con Google Apps Script. Revisa tu conexión a internet o confirma con tu administrador que el script esté implementado con acceso para "Cualquier usuario".'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function executePunch(type) {
  const config = loadConfig();
  if (!config) {
    switchView('welcome');
    return;
  }

  state.lastAttemptedPunchType = type;
  el['punch-error-box'].hidden = true;

  if (!navigator.onLine) {
    renderPunchError({
      title: 'Sin conexión a internet',
      description: 'Necesitas conexión de datos móviles o Wi-Fi para registrar la hora oficial en el servidor.',
      steps: ['Activa tus datos móviles o conéctate a una red Wi-Fi y presiona Reintentar.']
    });
    return;
  }

  setPunchButtonsDisabled(true);

  // Step 1: GPS Acquisition
  el['punch-loading-title'].textContent = 'Obteniendo ubicación GPS…';
  el['punch-loading-sub'].textContent = 'Autoriza el permiso si tu navegador lo solicita.';
  el['punch-loading-box'].hidden = false;

  let position;
  try {
    position = await acquireMandatoryGps();
  } catch (gpsErr) {
    setPunchButtonsDisabled(false);
    renderPunchError(buildGpsFailureGuidance(gpsErr));
    return;
  }

  const lat = Number(position.coords.latitude.toFixed(6));
  const lng = Number(position.coords.longitude.toFixed(6));
  const accuracy = Number((position.coords.accuracy || 0).toFixed(1));
  const device = getDeviceIdentity();

  // Step 2: HTTP POST to Google Apps Script
  el['punch-loading-title'].textContent = 'Enviando registro…';
  el['punch-loading-sub'].textContent = 'Confirmando hora oficial con el servidor de Google.';

  try {
    const result = await sendWebhookPost(config.scriptId, {
      sheetId: config.sheetId || '',
      workerId: config.workerId,
      workerName: config.workerName,
      deviceId: device.deviceId,
      deviceLabel: device.deviceLabel,
      type,
      lat,
      lng,
      accuracy
    });

    // If the server returned the canonical frozen workerName or workerId from the Trabajadores tab, sync locally
    const resolvedWorkerName = result.workerName || config.workerName;
    const resolvedWorkerId = normalizeWorkerId8(result.workerId) || config.workerId;
    if (resolvedWorkerName !== config.workerName || resolvedWorkerId !== config.workerId) {
      config.workerName = resolvedWorkerName;
      config.workerId = resolvedWorkerId;
      saveConfig(config);
      el['checador-worker-name'].textContent = config.workerName;
      el['checador-worker-id'].textContent = formatWorkerId8(config.workerId);
    }

    const checkinRecord = {
      type,
      serverTime: result.localTime,
      timeZone: result.timeZone || '',
      recordedAtMs: Date.now()
    };
    saveLastCheckin(checkinRecord);

    el['punch-loading-box'].hidden = true;
    setPunchButtonsDisabled(false);
    renderLastCheckinFooter();

    if (navigator.vibrate) navigator.vibrate([45, 50, 45]);
    showSuccessReceiptModal({
      type,
      workerName: config.workerName,
      workerId: config.workerId,
      orgName: config.orgName,
      localTime: result.localTime,
      timeZone: result.timeZone || 'Local',
      accuracy,
      seal: result.seal || ''
    });
  } catch (netErr) {
    setPunchButtonsDisabled(false);
    renderPunchError({
      title: 'No se pudo enviar el registro',
      description: (netErr && netErr.message) || 'Ocurrió un problema de red al contactar Google Sheets.',
      steps: []
    });
  }
}

function showSuccessReceiptModal({ type, workerName, workerId, orgName, localTime, timeZone, accuracy, seal }) {
  const isEntrada = type === 'ENTRADA';
  const parts = formatServerTimeParts(localTime);

  el['success-banner'].classList.toggle('is-out', !isEntrada);
  el['success-stamp'].textContent = isEntrada ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA';
  el['success-time-big'].textContent = parts.time12h;
  el['success-headline'].textContent = isEntrada
    ? `¡Entrada registrada con éxito a las ${parts.time12h}!`
    : `¡Salida registrada con éxito a las ${parts.time12h}!`;

  el['success-worker'].textContent = workerName;
  el['success-worker-id'].textContent = formatWorkerId8(workerId);
  el['success-org'].textContent = orgName;
  el['success-server-time'].textContent = localTime;
  el['success-timezone'].textContent = timeZone;
  el['success-accuracy'].textContent = `±${Math.round(accuracy)} m`;

  if (seal) {
    el['success-seal'].textContent = seal;
    el['success-seal-row'].hidden = false;
  } else {
    el['success-seal-row'].hidden = true;
  }

  openModal('modal-success', 'btn-close-success');
}

/* ==========================================================================
   View 4: Administrator Panel (/admin) — Profile, Catalog & 1-Click Sheet Creator
   ========================================================================== */

function loadAdminModules() {
  if (!state.adminModulesPromise) {
    state.adminModulesPromise = Promise.all([
      import('./qr-gen.js'),
      import('./gas-template.js')
    ]);
  }
  return state.adminModulesPromise;
}

function getLocalAdminCatalogKey(scriptId) {
  return `cronos_admin_catalog_${scriptId}`;
}

function loadLocalAdminCatalog(scriptId) {
  if (!scriptId) return [];
  try {
    const raw = localStorage.getItem(getLocalAdminCatalogKey(scriptId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalAdminCatalog(scriptId, sheets) {
  if (!scriptId || !Array.isArray(sheets)) return;
  try {
    localStorage.setItem(getLocalAdminCatalogKey(scriptId), JSON.stringify(sheets));
  } catch {
    // Ignore storage errors
  }
}

async function setActiveAdminSheet(sheetEntry, { scrollToPoster = false } = {}) {
  if (!state.activeAdminAccess || !sheetEntry) return;
  const [qrMod] = await loadAdminModules();
  const scriptId = state.activeAdminAccess.scriptId;
  const orgName = (sheetEntry.orgName || state.activeAdminAccess.orgName || 'Empresa').trim();
  // Primary sheet uses empty sid for compact backward-compatible QR unless it's a secondary sheet
  const sheetId = sheetEntry.isPrimary ? '' : (sheetEntry.sheetId || '').trim();
  const sheetUrl = (sheetEntry.sheetUrl || '').trim();

  const token = encodeCompanyToken(scriptId, orgName, sheetId);
  const magicLink = buildMagicLink(token);

  state.activeAdminAccess = {
    scriptId,
    orgName,
    sheetId,
    rawSheetId: (sheetEntry.sheetId || '').trim(),
    sheetUrl,
    token,
    magicLink
  };

  el['poster-org-title'].textContent = orgName;
  el['admin-magic-link'].value = magicLink;

  if (sheetUrl) {
    el['btn-open-active-sheet'].href = sheetUrl;
    el['btn-open-active-sheet'].hidden = false;
  } else {
    el['btn-open-active-sheet'].hidden = true;
  }

  el['admin-output-card'].hidden = false;
  el['admin-grid'].classList.add('has-output');
  el['admin-setup-guide'].open = false;

  qrMod.renderQRToCanvas(el['admin-qr-canvas'], magicLink, {
    size: 256,
    quietZone: 4,
    ecLevel: 'M'
  });

  renderAdminSheetsCatalog();

  if (scrollToPoster) {
    el['admin-output-card'].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderAdminSheetsCatalog() {
  const listEl = el['admin-sheets-list'];
  const panelEl = el['admin-sheets-panel'];
  const badgeEl = el['admin-sheets-count-badge'];
  if (!listEl || !panelEl) return;

  const sheets = state.adminSheetsCatalog || [];
  if (!state.activeAdminAccess || sheets.length === 0) {
    panelEl.hidden = true;
    return;
  }

  panelEl.hidden = false;
  badgeEl.textContent = sheets.length === 1 ? '1 hoja' : `${sheets.length} hojas`;
  listEl.innerHTML = '';

  const activeOrg = state.activeAdminAccess.orgName;
  const activeRawSid = state.activeAdminAccess.rawSheetId || state.activeAdminAccess.sheetId || '';

  for (const item of sheets) {
    const isCurrent =
      (activeRawSid && item.sheetId === activeRawSid) ||
      (!activeRawSid && item.orgName === activeOrg);

    const row = document.createElement('div');
    row.className = `admin-sheet-item${isCurrent ? ' is-active' : ''}`;
    row.setAttribute('role', 'listitem');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'admin-sheet-select-btn';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'admin-sheet-name';
    nameSpan.textContent = `${isCurrent ? '● ' : ''}${item.orgName}`;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'admin-sheet-meta';
    const roleTag = item.isPrimary ? 'Hoja principal' : 'Hoja adicional';
    const dateTag = item.createdAt ? ` · ${item.createdAt}` : '';
    metaSpan.textContent = `${roleTag}${dateTag} · Ver QR`;

    selectBtn.appendChild(nameSpan);
    selectBtn.appendChild(metaSpan);
    selectBtn.addEventListener('click', () => {
      setActiveAdminSheet(item, { scrollToPoster: false });
      showToast(`QR activo: ${item.orgName}`);
    });

    row.appendChild(selectBtn);

    if (item.sheetUrl) {
      const openLink = document.createElement('a');
      openLink.href = item.sheetUrl;
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.className = 'admin-sheet-open-link';
      openLink.textContent = '📊 Abrir Sheet';
      row.appendChild(openLink);
    }

    listEl.appendChild(row);
  }
}

async function initAdminPanel() {
  try {
    const [, gasMod] = await loadAdminModules();
    el['gas-code-preview'].textContent = gasMod.GAS_BACKEND_CODE;
  } catch {
    el['gas-code-preview'].textContent =
      '// Revisa el archivo backend/Code.gs o el README.md para copiar el código.';
  }

  // Ensure copyWorkers checkbox is always unchecked by default
  if (el['new-sheet-copy-workers']) {
    el['new-sheet-copy-workers'].checked = false;
  }

  if (!el['admin-org-name'].value && !el['admin-script-url'].value) {
    try {
      const savedDraft = JSON.parse(sessionStorage.getItem(STORAGE_ADMIN_DRAFT_KEY) || 'null');
      if (savedDraft && savedDraft.orgName && savedDraft.scriptUrl) {
        el['admin-org-name'].value = savedDraft.orgName;
        el['admin-script-url'].value = savedDraft.scriptUrl;
      }
    } catch {
      // Ignore draft parse errors
    }
  }
}

async function handleAdminGenerate(event) {
  event.preventDefault();
  el['admin-form-error'].hidden = true;
  el['test-connection-result'].hidden = true;
  if (el['admin-create-sheet-status']) {
    el['admin-create-sheet-status'].hidden = true;
  }

  const orgName = (el['admin-org-name'].value || '').trim().replace(/\s+/g, ' ');
  const rawUrl = (el['admin-script-url'].value || '').trim();
  const adminPin = (el['admin-pin'] && el['admin-pin'].value ? el['admin-pin'].value : '').trim();

  if (orgName.length < 2) {
    el['admin-form-error'].textContent = 'Escribe el nombre de la empresa (ej. Limpieza Sonora).';
    el['admin-form-error'].hidden = false;
    el['admin-org-name'].focus();
    return;
  }

  const parsedUrl = parseAppsScriptUrl(rawUrl);
  if (!parsedUrl.ok) {
    el['admin-form-error'].textContent = parsedUrl.error;
    el['admin-form-error'].hidden = false;
    el['admin-script-url'].focus();
    return;
  }

  try {
    await loadAdminModules();
    state.adminPin = adminPin;

    const cachedCatalog = loadLocalAdminCatalog(parsedUrl.scriptId);
    const fallbackPrimary = {
      sheetId: '',
      orgName,
      sheetUrl: '',
      createdAt: '',
      isPrimary: true
    };

    state.adminSheetsCatalog = cachedCatalog.length > 0 ? cachedCatalog : [fallbackPrimary];
    state.activeAdminAccess = {
      scriptId: parsedUrl.scriptId,
      orgName,
      sheetId: '',
      rawSheetId: '',
      sheetUrl: '',
      token: '',
      magicLink: ''
    };

    try {
      sessionStorage.setItem(
        STORAGE_ADMIN_DRAFT_KEY,
        JSON.stringify({ orgName, scriptUrl: parsedUrl.canonicalUrl })
      );
    } catch {
      // Ignore storage quota errors
    }

    await setActiveAdminSheet(state.adminSheetsCatalog[0], { scrollToPoster: true });
    showToast('Código QR y perfil de administrador listos');

    // Sync Admin Profile & Sheets Catalog with Google Apps Script in background
    try {
      const authRes = await sendWebhookPost(parsedUrl.scriptId, {
        action: 'admin_auth',
        orgName,
        adminPin
      });
      if (authRes && authRes.status === 'ok' && Array.isArray(authRes.sheets) && authRes.sheets.length > 0) {
        state.adminSheetsCatalog = authRes.sheets;
        saveLocalAdminCatalog(parsedUrl.scriptId, authRes.sheets);
        await setActiveAdminSheet(authRes.sheets[0], { scrollToPoster: false });
      }
    } catch (syncErr) {
      // If PIN was incorrect, surface it clearly to the admin
      if (syncErr && /PIN/i.test(String(syncErr.message || ''))) {
        el['admin-form-error'].textContent = syncErr.message;
        el['admin-form-error'].hidden = false;
      }
    }
  } catch (err) {
    el['admin-form-error'].textContent =
      (err && err.message) || 'Ocurrió un error al generar el código QR.';
    el['admin-form-error'].hidden = false;
  }
}

async function handleAdminCreateSheet(event) {
  event.preventDefault();
  if (!state.activeAdminAccess) return;

  const statusBox = el['admin-create-sheet-status'];
  statusBox.hidden = true;

  const newOrgName = (el['new-sheet-org-name'].value || '').trim().replace(/\s+/g, ' ');
  const copyWorkers = el['new-sheet-copy-workers'].checked === true;
  const adminPin = (el['admin-pin'] && el['admin-pin'].value ? el['admin-pin'].value : state.adminPin || '').trim();

  if (newOrgName.length < 2) {
    statusBox.className = 'alert alert-error';
    statusBox.textContent = 'Escribe el nombre para la nueva hoja de Google Sheets (ej. Asistencia Limpieza 2027).';
    statusBox.hidden = false;
    el['new-sheet-org-name'].focus();
    return;
  }

  const btn = el['btn-create-new-sheet'];
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creando Google Sheets en tu Drive…';

  statusBox.className = 'alert alert-amber';
  statusBox.textContent = 'Creando archivo en Google Drive y configurando pestañas…';
  statusBox.hidden = false;

  try {
    const sourceSheetId = state.activeAdminAccess.rawSheetId || state.activeAdminAccess.sheetId || '';
    const result = await sendWebhookPost(state.activeAdminAccess.scriptId, {
      action: 'admin_create_sheet',
      newOrgName,
      copyWorkers,
      sourceSheetId,
      adminPin
    });

    if (Array.isArray(result.sheets) && result.sheets.length > 0) {
      state.adminSheetsCatalog = result.sheets;
      saveLocalAdminCatalog(state.activeAdminAccess.scriptId, result.sheets);
    } else if (result.createdSheet) {
      state.adminSheetsCatalog.push(result.createdSheet);
      saveLocalAdminCatalog(state.activeAdminAccess.scriptId, state.adminSheetsCatalog);
    }

    const createdEntry = result.createdSheet || {
      sheetId: result.sheetId,
      orgName: newOrgName,
      sheetUrl: result.sheetUrl || '',
      createdAt: '',
      isPrimary: false
    };

    await setActiveAdminSheet(createdEntry, { scrollToPoster: true });

    // Reset form fields and keep copyWorkers unchecked by default
    el['new-sheet-org-name'].value = '';
    el['new-sheet-copy-workers'].checked = false;

    const workersNote = copyWorkers
      ? ` Se copiaron ${result.copiedWorkersCount || 0} trabajador(es) con sus IDs y celulares.`
      : ' Se creó con la pestaña Trabajadores limpia.';

    statusBox.className = 'alert alert-success';
    statusBox.textContent = `¡Hoja "${newOrgName}" creada en tu Google Drive!${workersNote} El código QR y Magic Link de la derecha ya apuntan a esta nueva hoja.`;
    statusBox.hidden = false;

    showToast(`Nueva hoja creada: ${newOrgName}`, 3400);
  } catch (err) {
    statusBox.className = 'alert alert-error';
    statusBox.textContent =
      (err && err.message) || 'No se pudo crear la nueva hoja. Verifica que tu script tenga el código actualizado.';
    statusBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function handleAdminTestConnection() {
  if (!state.activeAdminAccess) return;

  const btn = el['btn-test-connection'];
  const out = el['test-connection-result'];
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Enviando fila de prueba…';

  out.className = 'alert alert-amber';
  out.textContent = 'Conectando con Google Apps Script…';
  out.hidden = false;

  try {
    const result = await sendWebhookPost(state.activeAdminAccess.scriptId, {
      sheetId: state.activeAdminAccess.sheetId || '',
      workerName: 'Prueba de Conexión (Cronos)',
      type: 'PRUEBA',
      lat: 29.072967,
      lng: -110.955919,
      accuracy: 5
    });

    out.className = 'alert alert-success';
    const sheetInfo = result.sheetName ? ` en la pestaña "${result.sheetName}"` : ' en tu Google Sheets';
    const sealInfo = result.seal ? ` · Sello: ${result.seal}` : '';
    out.textContent =
      `¡Conexión exitosa! Se insertó una fila de prueba con formato automático${sheetInfo}. Hora oficial: ${result.localTime} (${result.timeZone || 'Zona local'})${sealInfo}.`;
  } catch (err) {
    out.className = 'alert alert-error';
    out.textContent =
      (err && err.message) ||
      'No se pudo completar la prueba. Verifica que en la implementación "Quién tiene acceso" diga "Cualquier usuario".';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ==========================================================================
   Modals & Account Menu (Cambiar QR/Hoja, Cambiar sesión, Cerrar sesión)
   ========================================================================== */

const MODAL_IDS = ['modal-success', 'modal-confirm-repeat', 'modal-account', 'modal-worker-id'];

function syncBodyModalLock() {
  const anyOpen = MODAL_IDS.some((id) => el[id] && !el[id].hidden);
  document.body.classList.toggle('modal-open', anyOpen);
}

function openModal(modalId, focusId) {
  const modal = el[modalId];
  if (!modal) return;
  if (el['app-toast']) el['app-toast'].hidden = true;
  modal.hidden = false;
  modal.scrollTop = 0;
  syncBodyModalLock();
  if (focusId && el[focusId]) {
    setTimeout(() => el[focusId].focus({ preventScroll: true }), 30);
  }
}

function closeModal(modalId) {
  const modal = el[modalId];
  if (!modal) return;
  modal.hidden = true;
  syncBodyModalLock();
  if (modalId === 'modal-account') {
    resetUnlinkConfirmationState();
  }
}

function resetUnlinkConfirmationState() {
  state.unlinkConfirmArmed = false;
  el['btn-unlink-company'].classList.remove('is-armed');
  el['title-unlink-company'].textContent = 'Cerrar sesión';
  el['desc-unlink-company'].textContent =
    'Borra y desvincula de este celular la empresa (QR/Sheets), tu usuario y tu sesión.';
}

function openAccountModal() {
  const config = loadConfig();
  if (!config) return;

  resetUnlinkConfirmationState();
  const formattedId = formatWorkerId8(config.workerId);
  el['account-modal-sub'].textContent = `${config.workerName} · ID ${formattedId} · ${config.orgName}`;
  el['desc-switch-qr'].textContent =
    `Escanea otro QR (ej. nueva hoja anual) conservando tu sesión como "${config.workerName}" (ID ${formattedId}).`;
  el['desc-change-worker'].textContent =
    `Permite que otro trabajador ingrese con su ID de 8 dígitos dentro de "${config.orgName}".`;

  openModal('modal-account', 'btn-switch-qr');
}

function openWorkerIdModal() {
  const config = loadConfig();
  if (!config) return;
  el['modal-id-worker-name'].textContent = config.workerName;
  el['modal-id-digits'].textContent = formatWorkerId8(config.workerId);
  openModal('modal-worker-id', 'btn-modal-copy-id');
}

/* ==========================================================================
   PWA Installation Banner (Android beforeinstallprompt & iOS Visual Guide)
   ========================================================================== */

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIosSafariCandidate() {
  const ua = window.navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIOS && !isStandaloneMode();
}

function wasPwaBannerRecentlyDismissed() {
  try {
    const ts = Number(localStorage.getItem(STORAGE_PWA_DISMISSED_KEY) || 0);
    return ts > 0 && Date.now() - ts < PWA_DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function updatePwaBannerVisibility() {
  const banner = el['pwa-install-banner'];
  if (!banner) return;

  const eligibleView =
    state.currentView === 'register' || state.currentView === 'checador';

  if (!eligibleView || isStandaloneMode() || wasPwaBannerRecentlyDismissed()) {
    banner.hidden = true;
    return;
  }

  if (state.deferredInstallPrompt) {
    el['pwa-android-box'].hidden = false;
    el['pwa-ios-box'].hidden = true;
    banner.hidden = false;
  } else if (isIosSafariCandidate()) {
    el['pwa-android-box'].hidden = true;
    el['pwa-ios-box'].hidden = false;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

/* ==========================================================================
   Event Wiring & Service Worker Registration
   ========================================================================== */

function bindEvents() {
  // Topbar navigation
  el['brand-link'].addEventListener('click', (e) => {
    if (state.currentView === 'admin') {
      e.preventDefault();
      exitAdminMode();
    }
  });

  el['btn-go-admin'].addEventListener('click', () => {
    window.location.hash = 'admin';
  });

  el['btn-exit-admin'].addEventListener('click', () => {
    exitAdminMode();
  });

  el['btn-worker-menu'].addEventListener('click', () => {
    openAccountModal();
  });

  el['btn-card-options'].addEventListener('click', () => {
    openAccountModal();
  });

  el['btn-copy-worker-id'].addEventListener('click', async () => {
    const config = loadConfig();
    if (!config) return;
    const formatted = formatWorkerId8(config.workerId);
    await copyTextToClipboard(formatted);
    openWorkerIdModal();
  });

  window.addEventListener('hashchange', () => {
    routeFromCurrentState();
  });

  // Online / Offline connectivity indicator
  const syncOnlineBanner = () => {
    el['offline-banner'].hidden = navigator.onLine;
  };
  window.addEventListener('online', syncOnlineBanner);
  window.addEventListener('offline', syncOnlineBanner);
  syncOnlineBanner();

  // View 1: QR Scanner & Paste Invite
  el['btn-open-scanner'].addEventListener('click', () => {
    if (state.qrScannerRunning) {
      stopQrScanner();
    } else {
      startQrScanner();
    }
  });

  el['btn-close-scanner'].addEventListener('click', () => {
    stopQrScanner();
  });

  el['qr-file-input'].addEventListener('change', handleQrImageUpload);

  el['btn-paste-clipboard'].addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip) {
          el['input-invite-code'].value = clip.trim();
          showWelcomeError('');
          showToast('Texto pegado');
          return;
        }
      }
      el['input-invite-code'].focus();
      showToast('Mantén presionado el campo y elige Pegar');
    } catch {
      el['input-invite-code'].focus();
      showToast('Mantén presionado el campo y elige Pegar');
    }
  });

  el['form-paste-invite'].addEventListener('submit', (e) => {
    e.preventDefault();
    showWelcomeError('');
    const decoded = decodeInviteInput(el['input-invite-code'].value);
    if (!decoded.ok) {
      showWelcomeError(decoded.error);
      el['input-invite-code'].focus();
      return;
    }
    el['input-invite-code'].value = '';
    applyDecodedInvite({
      scriptId: decoded.scriptId,
      orgName: decoded.orgName,
      sheetId: decoded.sheetId || ''
    });
  });

  el['btn-cancel-quick-switch'].addEventListener('click', () => {
    state.quickSwitchMode = false;
    if (loadConfig()) {
      switchView('checador');
    } else {
      renderWelcomeView();
    }
  });

  // View 2: Worker Onboarding & 8-Digit Session Login
  el['tab-auth-new'].addEventListener('click', () => {
    setRegisterAuthTab('new');
    el['input-worker-name'].focus();
  });

  el['tab-auth-id'].addEventListener('click', () => {
    setRegisterAuthTab('id');
    el['input-worker-id'].focus();
  });

  el['input-worker-id'].addEventListener('input', () => {
    el['input-worker-id'].value = formatPartialWorkerIdInput(el['input-worker-id'].value);
  });

  el['btn-copy-register-id'].addEventListener('click', async () => {
    const formatted = formatWorkerId8(state.pendingNewWorkerId);
    await copyTextToClipboard(formatted);
    showToast(`ID ${formatted} copiado al portapapeles`);
  });

  el['form-worker-register'].addEventListener('submit', handleSaveWorkerRegistration);

  el['btn-cancel-register'].addEventListener('click', () => {
    cleanJoinQueryFromUrl();
    const existing = loadConfig();
    state.pendingCompany = null;
    if (existing) {
      switchView('checador');
    } else {
      switchView('welcome');
    }
  });

  // View 3: Checador Punch Actions
  el['btn-punch-in'].addEventListener('click', () => requestPunch('ENTRADA'));
  el['btn-punch-out'].addEventListener('click', () => requestPunch('SALIDA'));
  el['btn-retry-punch'].addEventListener('click', () => {
    const retryType = state.lastAttemptedPunchType || 'ENTRADA';
    requestPunch(retryType, true);
  });

  // View 4: Admin Panel Actions
  el['view-admin'].addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-copy-text]');
    if (!chip) return;
    const textToCopy = chip.getAttribute('data-copy-text');
    if (!textToCopy) return;
    try {
      await copyTextToClipboard(textToCopy);
      const originalLabel = chip.dataset.origLabel || chip.textContent;
      chip.dataset.origLabel = originalLabel;
      chip.textContent = '¡Copiado!';
      chip.classList.add('is-copied');
      showToast(`Copiado: "${textToCopy}"`);
      setTimeout(() => {
        chip.textContent = originalLabel;
        chip.classList.remove('is-copied');
      }, 2000);
    } catch {
      showToast('No se pudo copiar automáticamente');
    }
  });

  el['btn-copy-gas'].addEventListener('click', async () => {
    try {
      const [, gasMod] = await loadAdminModules();
      await copyTextToClipboard(gasMod.GAS_BACKEND_CODE);
      const btn = el['btn-copy-gas'];
      const prev = btn.textContent;
      btn.textContent = '¡Código copiado!';
      showToast('Código Apps Script copiado al portapapeles');
      setTimeout(() => {
        btn.textContent = prev;
      }, 2200);
    } catch {
      showToast('Selecciona el código manualmente para copiarlo');
    }
  });

  el['form-admin-generate'].addEventListener('submit', handleAdminGenerate);
  el['form-admin-create-sheet'].addEventListener('submit', handleAdminCreateSheet);

  el['btn-copy-magic-link'].addEventListener('click', async () => {
    if (!state.activeAdminAccess) return;
    await copyTextToClipboard(state.activeAdminAccess.magicLink);
    showToast('Enlace de invitación copiado');
  });

  el['btn-share-whatsapp'].addEventListener('click', () => {
    if (!state.activeAdminAccess) return;
    const msg =
      `Hola equipo de *${state.activeAdminAccess.orgName}*, ` +
      `entren a este enlace para registrar su Entrada y Salida en Cronos:\n` +
      state.activeAdminAccess.magicLink;
    const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  });

  el['btn-download-qr'].addEventListener('click', async () => {
    if (!state.activeAdminAccess) return;
    const [qrMod] = await loadAdminModules();
    const dataUrl = qrMod.exportQRCardPNG(
      el['admin-qr-canvas'],
      state.activeAdminAccess.orgName
    );
    const link = document.createElement('a');
    const safeSlug = state.activeAdminAccess.orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'empresa';
    link.download = `qr-cronos-${safeSlug}.png`;
    link.href = dataUrl;
    link.click();
    showToast('Imagen QR descargada');
  });

  el['btn-print-qr'].addEventListener('click', () => {
    window.print();
  });

  el['btn-test-connection'].addEventListener('click', handleAdminTestConnection);

  // Modal 1: Receipt Success
  el['btn-close-success'].addEventListener('click', () => closeModal('modal-success'));

  // Modal 2: Duplicate Confirmation
  el['btn-confirm-repeat-yes'].addEventListener('click', () => {
    const type = state.pendingRepeatType;
    state.pendingRepeatType = null;
    closeModal('modal-confirm-repeat');
    if (type) executePunch(type);
  });

  el['btn-confirm-repeat-no'].addEventListener('click', () => {
    state.pendingRepeatType = null;
    closeModal('modal-confirm-repeat');
  });

  // Modal 3: Account Menu (1. Cambiar QR / Hoja, 2. Cambiar sesión, 3. Cerrar sesión [Rojo])
  el['btn-switch-qr'].addEventListener('click', () => {
    const config = loadConfig();
    closeModal('modal-account');
    if (!config) {
      state.quickSwitchMode = false;
      switchView('welcome');
      return;
    }
    state.quickSwitchMode = true;
    switchView('welcome');
  });

  el['btn-change-worker'].addEventListener('click', () => {
    const config = loadConfig();
    closeModal('modal-account');
    if (!config) {
      switchView('welcome');
      return;
    }
    openRegistrationForCompany({
      scriptId: config.scriptId,
      orgName: config.orgName,
      sheetId: config.sheetId || '',
      isSessionSwitch: true
    });
  });

  el['btn-unlink-company'].addEventListener('click', () => {
    if (!state.unlinkConfirmArmed) {
      state.unlinkConfirmArmed = true;
      el['btn-unlink-company'].classList.add('is-armed');
      el['title-unlink-company'].textContent = 'Confirmar cierre total';
      el['desc-unlink-company'].textContent =
        'Toca de nuevo para confirmar: se borrará la empresa (QR/Sheets), tu usuario y tu sesión de este celular.';
      return;
    }
    state.quickSwitchMode = false;
    clearAllWorkerData();
    closeModal('modal-account');
    showToast('Sesión cerrada y empresa desvinculada de este celular.');
    switchView('welcome');
  });

  el['btn-close-account'].addEventListener('click', () => closeModal('modal-account'));

  // Modal 4: Worker 8-Digit ID Card
  el['btn-modal-copy-id'].addEventListener('click', async () => {
    const config = loadConfig();
    if (!config) return;
    const formatted = formatWorkerId8(config.workerId);
    await copyTextToClipboard(formatted);
    showToast(`ID ${formatted} copiado`);
  });

  el['btn-close-worker-id'].addEventListener('click', () => closeModal('modal-worker-id'));

  // Close modals on Escape key or backdrop click
  for (const modalId of MODAL_IDS) {
    el[modalId].addEventListener('click', (e) => {
      if (e.target === el[modalId]) {
        closeModal(modalId);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const modalId of MODAL_IDS) {
        if (!el[modalId].hidden) {
          closeModal(modalId);
        }
      }
    }
  });

  // PWA Install Events
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    updatePwaBannerVisibility();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    updatePwaBannerVisibility();
    showToast('Cronos instalado en tu pantalla de inicio');
  });

  el['btn-pwa-install'].addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    try {
      await state.deferredInstallPrompt.userChoice;
    } finally {
      state.deferredInstallPrompt = null;
      updatePwaBannerVisibility();
    }
  });

  el['btn-pwa-dismiss'].addEventListener('click', () => {
    try {
      localStorage.setItem(STORAGE_PWA_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Ignore storage error
    }
    el['pwa-install-banner'].hidden = true;
  });
}

function exitAdminMode() {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.delete('admin');
  const cleanSearch = url.searchParams.toString();
  const nextPath = url.pathname.replace(/\/admin\/?$/i, '/');
  window.history.replaceState(
    {},
    document.title,
    nextPath + (cleanSearch ? `?${cleanSearch}` : '')
  );
  routeFromCurrentState();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Non-fatal in restricted local preview environments
      });
    });
  }
}

function init() {
  cacheElements();
  getDeviceIdentity();
  bindEvents();
  registerServiceWorker();
  routeFromCurrentState();
}

init();
