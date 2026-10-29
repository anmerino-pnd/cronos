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
  pendingCompany: null, // { scriptId, orgName, isNameChange: boolean }
  lastAttemptedPunchType: null, // 'ENTRADA' | 'SALIDA'
  pendingRepeatType: null,
  unlinkConfirmArmed: false,
  deferredInstallPrompt: null,
  clockTimerId: null,
  qrScanner: null,
  qrScannerRunning: false,
  html5QrScriptPromise: null,
  adminModulesPromise: null,
  activeAdminAccess: null // { scriptId, orgName, token, magicLink }
};

// Cached DOM References
const el = {};

function cacheElements() {
  const ids = [
    'app-main', 'brand-link', 'topbar-mode-tag',
    'btn-go-admin', 'btn-exit-admin', 'btn-worker-menu', 'offline-banner',
    // View 1: Welcome
    'view-welcome', 'welcome-error', 'btn-open-scanner', 'scanner-panel',
    'qr-reader', 'scanner-status-msg', 'qr-file-input', 'btn-close-scanner',
    'form-paste-invite', 'input-invite-code', 'btn-paste-clipboard',
    // View 2: Register
    'view-register', 'register-kicker', 'register-org-name',
    'register-switch-notice', 'register-error', 'form-worker-register',
    'input-worker-name', 'input-privacy-accept', 'btn-save-worker', 'btn-cancel-register',
    // View 3: Checador
    'view-checador', 'checador-org-name', 'checador-worker-name',
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
    'admin-org-name', 'admin-script-url', 'btn-generate-access',
    'admin-output-card', 'poster-org-title', 'admin-qr-canvas',
    'admin-magic-link', 'btn-copy-magic-link', 'btn-share-whatsapp',
    'btn-download-qr', 'btn-print-qr', 'btn-test-connection', 'test-connection-result',
    // Modals & Toast
    'modal-success', 'success-banner', 'success-stamp', 'success-time-big',
    'success-headline', 'success-worker', 'success-org', 'success-server-time',
    'success-timezone', 'success-accuracy', 'btn-close-success',
    'modal-confirm-repeat', 'repeat-message', 'btn-confirm-repeat-yes', 'btn-confirm-repeat-no',
    'modal-account', 'account-modal-sub', 'btn-change-worker', 'desc-change-worker',
    'btn-unlink-company', 'title-unlink-company', 'desc-unlink-company', 'btn-close-account',
    'app-toast'
  ];

  for (const id of ids) {
    el[id] = document.getElementById(id);
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
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
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
  // Stop camera scanner when leaving welcome view without delaying DOM transition
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

  // Admin shortcut ONLY shown on unconfigured welcome screen (hidden for active workers)
  el['btn-go-admin'].hidden = viewName !== 'welcome';
  el['btn-exit-admin'].hidden = viewName !== 'admin';
  el['btn-worker-menu'].hidden = viewName !== 'checador';

  // Live clock only runs while on Checador view
  if (viewName === 'checador') {
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
      // If already configured for this exact company, clean URL and open daily checador
      if (existingConfig && existingConfig.scriptId === decoded.scriptId) {
        cleanJoinQueryFromUrl();
        showToast(`Empresa activa: ${existingConfig.orgName}`);
        switchView('checador');
        return;
      }

      openRegistrationForCompany({
        scriptId: decoded.scriptId,
        orgName: decoded.orgName,
        isNameChange: false
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
   View 1: Welcome — QR Scanner (Lazy-Loaded) & Paste Invite
   ========================================================================== */

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
      openRegistrationForCompany({
        scriptId: parsed.scriptId,
        orgName: parsed.orgName,
        isNameChange: false
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
      // Fallback for laptops / front-only cameras
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

    openRegistrationForCompany({
      scriptId: parsed.scriptId,
      orgName: parsed.orgName,
      isNameChange: false
    });
  } catch {
    showWelcomeError('No se detectó un código QR legible en la imagen seleccionada.');
  } finally {
    event.target.value = '';
  }
}

/* ==========================================================================
   View 2: Worker Onboarding — Registration & Privacy Consent
   ========================================================================== */

function openRegistrationForCompany({ scriptId, orgName, isNameChange = false }) {
  const existing = loadConfig();
  state.pendingCompany = { scriptId, orgName, isNameChange };

  el['register-error'].hidden = true;
  el['register-kicker'].textContent = isNameChange
    ? 'Cambiar trabajador en:'
    : 'Te estás uniendo a:';
  el['register-org-name'].textContent = orgName;

  if (!isNameChange && existing && existing.scriptId !== scriptId) {
    el['register-switch-notice'].textContent =
      `Este dispositivo estaba vinculado a "${existing.orgName}". Al guardar quedarás vinculado a "${orgName}".`;
    el['register-switch-notice'].hidden = false;
  } else {
    el['register-switch-notice'].hidden = true;
  }

  if (isNameChange && existing) {
    el['input-worker-name'].value = existing.workerName;
    el['input-privacy-accept'].checked = true;
  } else if (existing && existing.workerName) {
    el['input-worker-name'].value = existing.workerName;
    el['input-privacy-accept'].checked = false;
  } else {
    el['input-worker-name'].value = '';
    el['input-privacy-accept'].checked = false;
  }

  switchView('register');
  setTimeout(() => {
    el['input-worker-name'].focus();
    if (isNameChange) el['input-worker-name'].select();
  }, 50);
}

function handleSaveWorkerRegistration(event) {
  event.preventDefault();
  el['register-error'].hidden = true;

  if (!state.pendingCompany) {
    switchView('welcome');
    return;
  }

  const workerName = (el['input-worker-name'].value || '').trim().replace(/\s+/g, ' ');
  const privacyAccepted = el['input-privacy-accept'].checked;

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

  const prev = loadConfig();
  const isDifferentWorkerOrOrg =
    !prev ||
    prev.scriptId !== state.pendingCompany.scriptId ||
    prev.workerName.toLowerCase() !== workerName.toLowerCase();

  const newConfig = {
    scriptId: state.pendingCompany.scriptId,
    orgName: state.pendingCompany.orgName,
    workerName,
    privacyAccepted: true,
    configuredAt: new Date().toISOString()
  };

  saveConfig(newConfig);

  // Reset last_checkin if switching worker or company so the ticket strip starts fresh
  if (isDifferentWorkerOrOrg) {
    localStorage.removeItem(STORAGE_LAST_CHECKIN_KEY);
  }

  cleanJoinQueryFromUrl();
  state.pendingCompany = null;

  showToast('Perfil guardado correctamente');
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
    // Code 1 = PERMISSION_DENIED -> fail immediately with permission unlock guide
    if (err && err.code === 1) {
      throw err;
    }
    // Code 2 (POSITION_UNAVAILABLE) or Code 3 (TIMEOUT) -> 1 fallback attempt
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

async function sendWebhookPost(scriptId, payload) {
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

  // Step 2: HTTP POST to Google Apps Script
  el['punch-loading-title'].textContent = 'Enviando registro…';
  el['punch-loading-sub'].textContent = 'Confirmando hora oficial con el servidor de Google.';

  try {
    const result = await sendWebhookPost(config.scriptId, {
      workerName: config.workerName,
      type,
      lat,
      lng,
      accuracy
    });

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
      orgName: config.orgName,
      localTime: result.localTime,
      timeZone: result.timeZone || 'Local',
      accuracy
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

function showSuccessReceiptModal({ type, workerName, orgName, localTime, timeZone, accuracy }) {
  const isEntrada = type === 'ENTRADA';
  const parts = formatServerTimeParts(localTime);

  el['success-banner'].classList.toggle('is-out', !isEntrada);
  el['success-stamp'].textContent = isEntrada ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA';
  el['success-time-big'].textContent = parts.time12h;
  el['success-headline'].textContent = isEntrada
    ? `¡Entrada registrada con éxito a las ${parts.time12h}!`
    : `¡Salida registrada con éxito a las ${parts.time12h}!`;

  el['success-worker'].textContent = workerName;
  el['success-org'].textContent = orgName;
  el['success-server-time'].textContent = localTime;
  el['success-timezone'].textContent = timeZone;
  el['success-accuracy'].textContent = `±${Math.round(accuracy)} m`;

  openModal('modal-success', 'btn-close-success');
}

/* ==========================================================================
   View 4: Administrator Panel (/admin)
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

async function initAdminPanel() {
  try {
    const [, gasMod] = await loadAdminModules();
    el['gas-code-preview'].textContent = gasMod.GAS_BACKEND_CODE;
  } catch {
    el['gas-code-preview'].textContent =
      '// Revisa el archivo backend/Code.gs o el README.md para copiar el código.';
  }

  // Restore draft orgName/URL if previously used on this browser
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

  const orgName = (el['admin-org-name'].value || '').trim().replace(/\s+/g, ' ');
  const rawUrl = (el['admin-script-url'].value || '').trim();

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
    const [qrMod] = await loadAdminModules();
    const token = encodeCompanyToken(parsedUrl.scriptId, orgName);
    const magicLink = buildMagicLink(token);

    state.activeAdminAccess = {
      scriptId: parsedUrl.scriptId,
      orgName,
      token,
      magicLink
    };

    try {
      sessionStorage.setItem(
        STORAGE_ADMIN_DRAFT_KEY,
        JSON.stringify({ orgName, scriptUrl: parsedUrl.canonicalUrl })
      );
    } catch {
      // Ignore storage quota errors
    }

    el['poster-org-title'].textContent = orgName;
    el['admin-magic-link'].value = magicLink;

    el['admin-output-card'].hidden = false;
    el['admin-grid'].classList.add('has-output');
    el['admin-setup-guide'].open = false;

    // Render crisp QR encoding the Magic Link (works both with native phone camera & in-app scanner!)
    qrMod.renderQRToCanvas(el['admin-qr-canvas'], magicLink, {
      size: 256,
      quietZone: 4,
      ecLevel: 'M'
    });

    showToast('Código QR y enlace generados');
    el['admin-output-card'].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    el['admin-form-error'].textContent =
      (err && err.message) || 'Ocurrió un error al generar el código QR.';
    el['admin-form-error'].hidden = false;
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
      workerName: 'Prueba de Conexión (Cronos)',
      type: 'PRUEBA',
      lat: 29.072967,
      lng: -110.955919,
      accuracy: 5
    });

    out.className = 'alert alert-success';
    out.textContent =
      `¡Conexión exitosa! Se insertó una fila de prueba en tu Google Sheets. Hora oficial: ${result.localTime} (${result.timeZone || 'Zona local'}).`;
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
   Modals & Account Menu ("Cambiar usuario / Salir")
   ========================================================================== */

function openModal(modalId, focusId) {
  const modal = el[modalId];
  if (!modal) return;
  if (el['app-toast']) el['app-toast'].hidden = true;
  modal.hidden = false;
  if (focusId && el[focusId]) {
    setTimeout(() => el[focusId].focus(), 30);
  }
}

function closeModal(modalId) {
  const modal = el[modalId];
  if (!modal) return;
  modal.hidden = true;
  if (modalId === 'modal-account') {
    resetUnlinkConfirmationState();
  }
}

function resetUnlinkConfirmationState() {
  state.unlinkConfirmArmed = false;
  el['title-unlink-company'].textContent = 'Desvincular empresa';
  el['desc-unlink-company'].textContent =
    'Borra toda la configuración guardada. Necesitarás escanear el código QR o abrir el enlace de invitación otra vez.';
}

function openAccountModal() {
  const config = loadConfig();
  if (!config) return;

  resetUnlinkConfirmationState();
  el['account-modal-sub'].textContent = `${config.workerName} · ${config.orgName}`;
  el['desc-change-worker'].textContent =
    `Mantiene el vínculo con "${config.orgName}". Útil para corregir tu nombre o si otro compañero usará este teléfono.`;

  openModal('modal-account', 'btn-change-worker');
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
    openRegistrationForCompany({
      scriptId: decoded.scriptId,
      orgName: decoded.orgName,
      isNameChange: false
    });
  });

  // View 2: Worker Registration
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

  // Modal 3: Account Menu (Change Worker Name vs Full Unlink)
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
      isNameChange: true
    });
  });

  el['btn-unlink-company'].addEventListener('click', () => {
    if (!state.unlinkConfirmArmed) {
      state.unlinkConfirmArmed = true;
      el['title-unlink-company'].textContent = '¿Confirmar desvinculación? Toca de nuevo';
      el['desc-unlink-company'].textContent =
        'Se borrarán empresa y trabajador de este teléfono de forma inmediata.';
      return;
    }
    clearAllWorkerData();
    closeModal('modal-account');
    showToast('Empresa desvinculada de este dispositivo');
    switchView('welcome');
  });

  el['btn-close-account'].addEventListener('click', () => closeModal('modal-account'));

  // Close modals on Escape key or backdrop click
  for (const modalId of ['modal-success', 'modal-confirm-repeat', 'modal-account']) {
    el[modalId].addEventListener('click', (e) => {
      if (e.target === el[modalId]) {
        closeModal(modalId);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const modalId of ['modal-success', 'modal-confirm-repeat', 'modal-account']) {
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
  bindEvents();
  registerServiceWorker();
  routeFromCurrentState();
}

init();
