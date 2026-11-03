/**
 * ============================================================================
 * CRONOS · Conector Serverless para Google Sheets
 * - Creación automática de pestaña por mes ("Octubre 2026", "Noviembre 2026"...)
 *   colocando siempre el mes en curso como primera pestaña a la izquierda
 * - Pestaña automática "📊 Resumen Mensual" con KPIs en vivo (horas trabajadas,
 *   turnos cerrados, trabajadores en turno y alertas)
 * - Pestaña automática "Trabajadores" con ID numérico de 8 dígitos, nombre
 *   congelado, historial numerado de celulares y columna desplegable "Estatus de Acceso"
 *   (🟢 Activo / 🟡 Pendiente / 🔴 Baja) para aprobación y bloqueo de ex-trabajadores
 * - Perfil de Administrador protegido contra fuerza bruta (límite de 5 intentos
 *   fallidos con bloqueo temporal exponencial) y creación de hojas en 1 clic
 * - Auditoría de telemetría GPS, soporte para Cola Offline y Modo Kiosco
 * - Sello criptográfico encadenado por mes (HMAC-SHA256) contra ediciones manuales
 * ============================================================================
 */

const CRONOS_LEGACY_SHEET_NAME = "Registros de Asistencia";
const CRONOS_WORKERS_SHEET_NAME = "Trabajadores";
const CRONOS_SUMMARY_SHEET_NAME = "📊 Resumen Mensual";

const CRONOS_WORKER_STATUS_ACTIVO = "🟢 Activo";
const CRONOS_WORKER_STATUS_PENDIENTE = "🟡 Pendiente";
const CRONOS_WORKER_STATUS_BAJA = "🔴 Baja";
const CRONOS_WORKER_STATUS_OPTIONS = [
  CRONOS_WORKER_STATUS_ACTIVO,
  CRONOS_WORKER_STATUS_PENDIENTE,
  CRONOS_WORKER_STATUS_BAJA
];

const CRONOS_ADMIN_MAX_ATTEMPTS = 5;
const CRONOS_ADMIN_BASE_LOCK_MINUTES = 15;

const CRONOS_MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const CRONOS_HEADERS = [
  "Fecha y Hora (Local)",
  "ID Trabajador",
  "Trabajador",
  "Tipo de Registro",
  "Dispositivo / Auditoría",
  "Mapa (Ubicación)",
  "Precisión GPS",
  "Coordenadas",
  "Zona Horaria",
  "Timestamp (UTC)",
  "Sello Criptográfico (HMAC)"
];

const CRONOS_COL_WIDTHS = [
  170, // A: Fecha y Hora (Local)
  125, // B: ID Trabajador
  210, // C: Trabajador
  135, // D: Tipo de Registro
  265, // E: Dispositivo / Auditoría
  155, // F: Mapa (Ubicación)
  120, // G: Precisión GPS
  185, // H: Coordenadas
  155, // I: Zona Horaria
  195, // J: Timestamp (UTC)
  265  // K: Sello Criptográfico (HMAC)
];

const CRONOS_WORKERS_HEADERS = [
  "ID de Acceso (8 dígitos)",
  "Nombre Completo (Congelado)",
  "Estado de Dispositivos",
  "Celular Titular (1er registro)",
  "Historial de Celulares Usados",
  "Fecha de Alta",
  "Último Registro",
  "Estatus de Acceso"
];

const CRONOS_WORKERS_COL_WIDTHS = [
  160, // A: ID de Acceso
  225, // B: Nombre Completo (Congelado)
  220, // C: Estado de Dispositivos
  230, // D: Celular Titular
  330, // E: Historial de Celulares Usados
  160, // F: Fecha de Alta
  200, // G: Último Registro
  170  // H: Estatus de Acceso (Dropdown: 🟢 Activo / 🟡 Pendiente / 🔴 Baja)
];

const CRONOS_SUMMARY_TABLE_HEADERS = [
  "ID Trabajador",
  "Trabajador",
  "Estatus de Acceso",
  "Días Asistidos",
  "Entradas",
  "Salidas",
  "Turnos Cerrados",
  "Horas Trabajadas (Mes)",
  "Promedio / Turno",
  "Alertas de Celular / GPS",
  "Estado Actual / Última Marca"
];

const CRONOS_SUMMARY_COL_WIDTHS = [
  135, // A: ID Trabajador
  215, // B: Trabajador
  155, // C: Estatus de Acceso
  130, // D: Días Asistidos
  110, // E: Entradas
  110, // F: Salidas
  135, // G: Turnos Cerrados
  175, // H: Horas Trabajadas (Mes)
  145, // I: Promedio / Turno
  190, // J: Alertas de Celular / GPS
  265  // K: Estado Actual / Última Marca
];

/**
 * Crea el menú superior "🛡️ Cronos" al abrir el archivo en Google Sheets.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🛡️ Cronos")
    .addItem("🔍 Auditar pestaña actual (HMAC)", "verificarIntegridadCronos")
    .addItem("🗂️ Auditar todos los meses", "verificarTodosLosMesesCronos")
    .addSeparator()
    .addItem("📊 Actualizar Resumen Mensual (KPIs)", "actualizarResumenMensualManualCronos")
    .addItem("🎨 Reaplicar diseño visual a esta pestaña", "reaplicarDisenoCronos")
    .addToUi();
}

/**
 * Webhook principal que recibe registros de asistencia, inicios de sesión por ID,
 * solicitudes de alta de trabajadores y comandos del Perfil de Administrador.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    const data = JSON.parse(e.postData.contents);
    const action = String(data.action || "checkin").trim().toLowerCase();

    // Resolver el archivo de Google Sheets destino (soporta múltiples hojas por Admin)
    const spreadsheet = resolverSpreadsheetObjetivo_(data);

    // Hora oficial generada en los servidores de Google (inmune al reloj del celular)
    const now = new Date();
    const utcTime = now.toISOString();
    const sheetTimeZone = spreadsheet.getSpreadsheetTimeZone();
    const localTime = Utilities.formatDate(now, sheetTimeZone, "yyyy-MM-dd HH:mm:ss");

    // 1. Flujo de Perfil de Administrador: Autenticación y listado de hojas + trabajadores
    if (action === "admin_auth") {
      const authRes = gestionarAutenticacionAdmin_(data, localTime);
      authRes.localTime = localTime;
      authRes.timeZone = sheetTimeZone;
      return ContentService.createTextOutput(JSON.stringify(authRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Flujo de Perfil de Administrador: Crear nuevo archivo de Google Sheets en 1 clic
    if (action === "admin_create_sheet") {
      const createRes = crearNuevaHojaDesdeAdmin_(data, localTime);
      createRes.localTime = localTime;
      createRes.timeZone = sheetTimeZone;
      return ContentService.createTextOutput(JSON.stringify(createRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3. Flujo de Administrador: Listar trabajadores y solicitudes de una hoja
    if (action === "admin_list_workers") {
      const listRes = listarTrabajadoresDesdeAdmin_(spreadsheet, data);
      listRes.localTime = localTime;
      listRes.timeZone = sheetTimeZone;
      return ContentService.createTextOutput(JSON.stringify(listRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 4. Flujo de Administrador: Aprobar, dar de baja o reactivar a un trabajador en 1 clic
    if (action === "admin_set_worker_status") {
      const statusRes = cambiarEstatusTrabajadorDesdeAdmin_(spreadsheet, data, localTime);
      statusRes.localTime = localTime;
      statusRes.timeZone = sheetTimeZone;
      return ContentService.createTextOutput(JSON.stringify(statusRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 5. Flujo de inicio de sesión por ID numérico de 8 dígitos ("Ya tengo mi ID" / Kiosco / Verificar aprobación)
    if (action === "login_worker") {
      const loginRes = iniciarSesionPorIdTrabajador_(spreadsheet, data, localTime);
      loginRes.localTime = localTime;
      loginRes.utcTime = utcTime;
      loginRes.timeZone = sheetTimeZone;
      return ContentService.createTextOutput(JSON.stringify(loginRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 6. Flujo de solicitud de alta / registro inicial de trabajador en pestaña "Trabajadores"
    if (action === "register_worker") {
      const regRes = sincronizarTrabajadorYDispositivo_(spreadsheet, data, localTime, "SOLICITUD");
      if (regRes.blocked) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "blocked",
          action: "register_worker",
          accountStatus: "baja",
          accountStatusLabel: CRONOS_WORKER_STATUS_BAJA,
          message: regRes.message,
          localTime: localTime,
          utcTime: utcTime,
          timeZone: sheetTimeZone
        })).setMimeType(ContentService.MimeType.JSON);
      }
      if (regRes.nameTaken) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "name_taken",
          action: "register_worker",
          message: regRes.message,
          localTime: localTime,
          utcTime: utcTime,
          timeZone: sheetTimeZone
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        action: "register_worker",
        workerId: regRes.workerId,
        formattedWorkerId: regRes.formattedWorkerId,
        workerName: regRes.workerName,
        accountStatus: regRes.accountStatus,
        accountStatusLabel: regRes.accountStatusLabel,
        deviceAudit: regRes.deviceAudit,
        deviceLevel: regRes.deviceLevel,
        localTime: localTime,
        utcTime: utcTime,
        timeZone: sheetTimeZone
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 7. Flujo de registro de asistencia (ENTRADA / SALIDA / PRUEBA)
    const infoMes = resolverInfoMesDesdeFechaLocal_(localTime);
    const sheet = obtenerHojaMensualCronos_(spreadsheet, infoMes.nombreHoja);

    const secret = obtenerSecretoHmac_();
    const props = PropertiesService.getScriptProperties();
    const headKey = obtenerClaveCabezaCadena_(spreadsheet, sheet);

    const type = String(data.type || "REGISTRO").trim().toUpperCase();
    const accuracy = Math.round(Number(data.accuracy) || 0);
    const lat = Number(data.lat || 0);
    const lng = Number(data.lng || 0);
    const coords = lat + "," + lng;
    const mapsUrl = "https://www.google.com/maps?q=" + coords;

    let workerId = "00000000";
    let formattedWorkerId = "ADMIN-TEST";
    let workerName = String(data.workerName || "Sin nombre").trim();
    let deviceAudit = "🧪 Prueba desde panel Admin";
    let deviceLevel = "test";
    let deviceNote = "";

    if (type !== "PRUEBA") {
      const syncInfo = sincronizarTrabajadorYDispositivo_(spreadsheet, data, localTime, type);

      // Si el trabajador o su dispositivo fue dado de baja -> rechazar sin escribir en la hoja del mes
      if (syncInfo.blocked) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "blocked",
          accountStatus: "baja",
          accountStatusLabel: CRONOS_WORKER_STATUS_BAJA,
          workerId: syncInfo.workerId || "",
          formattedWorkerId: syncInfo.formattedWorkerId || "",
          workerName: syncInfo.workerName || workerName,
          message: syncInfo.message || "Esta cuenta de trabajador fue dada de baja por el administrador."
        })).setMimeType(ContentService.MimeType.JSON);
      }

      // Si el trabajador está pendiente de aprobación -> rechazar sin escribir en la hoja del mes
      if (syncInfo.pending) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "pending_approval",
          accountStatus: "pendiente",
          accountStatusLabel: CRONOS_WORKER_STATUS_PENDIENTE,
          workerId: syncInfo.workerId || "",
          formattedWorkerId: syncInfo.formattedWorkerId || "",
          workerName: syncInfo.workerName || workerName,
          message: syncInfo.message || "Tu solicitud de acceso está pendiente de aprobación por el administrador."
        })).setMimeType(ContentService.MimeType.JSON);
      }

      workerId = syncInfo.workerId;
      formattedWorkerId = syncInfo.formattedWorkerId;
      workerName = syncInfo.workerName; // Nombre oficial congelado desde pestaña "Trabajadores"
      deviceAudit = syncInfo.deviceAudit;
      deviceLevel = syncInfo.deviceLevel;
      deviceNote = syncInfo.deviceNote || "";

      // Si proviene de Modo Kiosco
      if (data.isKiosk === true) {
        const cleanDev = extraerDeviceIdLimpio_(data.deviceId);
        deviceAudit = "🖥️ Kiosco (" + cleanDev + ")";
        deviceNote = (deviceNote ? deviceNote + "\n" : "") + "🖥️ Registro realizado desde terminal en Modo Kiosco.";
      }

      // Si proviene de la Cola Offline, anexar hora de captura original en auditoría
      if (data.offlineQueuedAt) {
        const qShort = String(data.offlineQueuedAt).replace("T", " ").slice(0, 16);
        deviceAudit += " · 📴 Offline (" + qShort + ")";
        deviceNote = (deviceNote ? deviceNote + "\n" : "") +
          "📴 COLA OFFLINE: Capturado sin internet el " + String(data.offlineQueuedAt) + " y sincronizado a las " + localTime + ".";
      }

      // Auditoría de telemetría GPS contra coordenadas estáticas/emuladas
      const gpsTelemetria = evaluarTelemetriaGps_(sheet, formattedWorkerId, coords, data);
      if (gpsTelemetria.suspicious) {
        deviceAudit += " · " + gpsTelemetria.badge;
        deviceNote = (deviceNote ? deviceNote + "\n" : "") + gpsTelemetria.note;
        if (deviceLevel === "primary") {
          deviceLevel = "secondary";
        }
      }
    }

    // Determinar secuencia y sello de la fila anterior dentro de la hoja del mes
    const lastRow = sheet.getLastRow();
    let seq = 1;
    let prevSeal = "GENESIS-" + infoMes.ymCodigo;

    if (lastRow >= 2) {
      seq = lastRow; // Fila 2 = registro #1 del mes, Fila 3 = registro #2...
      const prevCellVal = sheet.getRange(lastRow, 11).getValue();
      prevSeal = extraerCodigoSello_(prevCellVal) || "SIN_SELLO";
    }

    const seal = calcularSelloFila_(
      infoMes.ymCodigo,
      seq,
      prevSeal,
      {
        localTime: localTime,
        formattedWorkerId: formattedWorkerId,
        workerName: workerName,
        type: type,
        deviceAudit: deviceAudit,
        mapsUrl: mapsUrl,
        accuracy: accuracy,
        coords: coords,
        timeZone: sheetTimeZone,
        utcTime: utcTime
      },
      secret
    );

    const nextRow = lastRow + 1;
    const rowRange = sheet.getRange(nextRow, 1, 1, 11);

    // Fijar formatos antes de insertar para evitar que Sheets altere textos o códigos con guiones
    sheet.getRange(nextRow, 1, 1, 6).setNumberFormat("@");
    sheet.getRange(nextRow, 7).setNumberFormat('0" m"');
    sheet.getRange(nextRow, 8, 1, 4).setNumberFormat("@");

    rowRange.setValues([[
      localTime,
      formattedWorkerId,
      workerName,
      type,
      deviceAudit,
      "📍 Abrir en Maps",
      accuracy,
      coords,
      sheetTimeZone,
      utcTime,
      "🔒 " + seal
    ]]);

    // Convertir celda de Mapa en enlace clicable limpio
    const mapRichText = SpreadsheetApp.newRichTextValue()
      .setText("📍 Abrir en Maps")
      .setLinkUrl(mapsUrl)
      .build();
    sheet.getRange(nextRow, 6).setRichTextValue(mapRichText);

    // Aplicar estilo espacioso y semáforo de dispositivo a la nueva fila
    estilizarFilaRegistro_(sheet, nextRow, deviceLevel, deviceNote);

    // Guardar puntero oficial de cadena del mes para detectar si borran filas al final
    props.setProperty(
      headKey,
      JSON.stringify({ ym: infoMes.ymCodigo, sheetName: infoMes.nombreHoja, count: seq, lastSeal: seal })
    );

    // Actualizar pestaña automática "📊 Resumen Mensual" con KPIs en vivo
    if (type !== "PRUEBA") {
      try {
        actualizarHojaResumenMensual_(spreadsheet, sheet, localTime);
      } catch (_) {}
    }

    const folio = "#" + String(seq).padStart(4, "0");

    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      folio: folio,
      seq: seq,
      localTime: localTime,
      utcTime: utcTime,
      timeZone: sheetTimeZone,
      sheetName: infoMes.nombreHoja,
      sheetId: obtenerIdSpreadsheetSeguro_(spreadsheet),
      workerId: workerId,
      formattedWorkerId: formattedWorkerId,
      workerName: workerName,
      accountStatus: "activo",
      accountStatusLabel: CRONOS_WORKER_STATUS_ACTIVO,
      lastPunchType: type,
      deviceAudit: deviceAudit,
      deviceLevel: deviceLevel,
      seal: seal
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Evalúa telemetría GPS para detectar posibles coordenadas estáticas o emuladas desde PC.
 */
function evaluarTelemetriaGps_(sheet, formattedWorkerId, currentCoords, data) {
  const result = { suspicious: false, badge: "", note: "" };
  try {
    if (!data || data.rawAccuracy === undefined) return result;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return result;

    // Revisar las últimas marcas del mismo trabajador en la hoja del mes
    const startRow = Math.max(2, lastRow - 30);
    const numRows = lastRow - startRow + 1;
    const rows = sheet.getRange(startRow, 1, numRows, 8).getValues();

    for (let i = rows.length - 1; i >= 0; i--) {
      const rowWorkerId = String(rows[i][1] || "").trim();
      const prevCoords = String(rows[i][7] || "").trim();
      if (rowWorkerId === formattedWorkerId && prevCoords) {
        const rawAcc = Number(data.rawAccuracy);
        const isExactIntegerAcc = Number.isFinite(rawAcc) && rawAcc > 0 && Math.floor(rawAcc) === rawAcc;
        const isDesktop = /windows|macintosh|linux x86/i.test(String(data.deviceLabel || "")) && !data.isKiosk;

        if (prevCoords === currentCoords && isExactIntegerAcc && isDesktop) {
          result.suspicious = true;
          result.badge = "⚠️ GPS estático/emulado";
          result.note =
            "⚠️ TELEMETRÍA GPS: Las coordenadas (" + currentCoords + ") son idénticas (0.0 m de deriva) " +
            "respecto a la marca anterior de este trabajador y presentan firma de emulador de escritorio.";
        }
        break;
      }
    }
  } catch (_) {}
  return result;
}

/**
 * Resuelve el archivo Spreadsheet objetivo: si el payload especifica `sheetId`
 * (para hojas adicionales creadas desde el perfil de Admin), lo abre por ID;
 * de lo contrario usa el archivo contenedor principal.
 */
function resolverSpreadsheetObjetivo_(data) {
  const sid = String((data && data.sheetId) || "").trim();
  if (sid) {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active && obtenerIdSpreadsheetSeguro_(active) === sid) {
      return active;
    }
    return SpreadsheetApp.openById(sid);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function obtenerIdSpreadsheetSeguro_(spreadsheet) {
  try {
    return typeof spreadsheet.getId === "function" ? String(spreadsheet.getId() || "") : "";
  } catch (_) {
    return "";
  }
}

function obtenerUrlSpreadsheetSeguro_(spreadsheet) {
  try {
    if (typeof spreadsheet.getUrl === "function") return String(spreadsheet.getUrl() || "");
    const id = obtenerIdSpreadsheetSeguro_(spreadsheet);
    return id ? ("https://docs.google.com/spreadsheets/d/" + id + "/edit") : "";
  } catch (_) {
    return "";
  }
}

function obtenerNombreSpreadsheetSeguro_(spreadsheet) {
  try {
    return typeof spreadsheet.getName === "function" ? String(spreadsheet.getName() || "Asistencia Cronos") : "Asistencia Cronos";
  } catch (_) {
    return "Asistencia Cronos";
  }
}

function obtenerClaveCabezaCadena_(spreadsheet, sheet) {
  const props = PropertiesService.getScriptProperties();
  const ssId = obtenerIdSpreadsheetSeguro_(spreadsheet);
  const scopedKey = ssId ? ("CRONOS_CHAIN_HEAD_" + ssId + "_" + sheet.getSheetId()) : ("CRONOS_CHAIN_HEAD_" + sheet.getSheetId());
  const legacyKey = "CRONOS_CHAIN_HEAD_" + sheet.getSheetId();
  if (!props.getProperty(scopedKey) && props.getProperty(legacyKey)) {
    return legacyKey;
  }
  return scopedKey;
}

/* ============================================================================
   Perfil de Administrador: Protección Anti-Fuerza Bruta, Autenticación y Hojas
   ============================================================================ */

function calcularHashPinAdmin_(rawPin, secret) {
  const cleanPin = String(rawPin || "").trim();
  const sigBytes = Utilities.computeHmacSha256Signature(
    "CRONOS_ADMIN_PIN|" + cleanPin,
    secret,
    Utilities.Charset.UTF_8
  );
  return sigBytes
    .map(function (b) {
      const v = b < 0 ? b + 256 : b;
      return (v < 16 ? "0" : "") + v.toString(16);
    })
    .join("");
}

/**
 * Verifica si la cuenta de Administrador se encuentra bloqueada temporalmente por intentos fallidos,
 * o registra un nuevo intento fallido / exitoso en PropertiesService.
 */
function verificarEstadoBloqueoAdmin_() {
  const props = PropertiesService.getScriptProperties();
  const lockUntil = Number(props.getProperty("CRONOS_ADMIN_LOCKOUT_UNTIL") || "0");
  const nowMs = new Date().getTime();

  if (lockUntil > nowMs) {
    const remainingMin = Math.max(1, Math.ceil((lockUntil - nowMs) / 60000));
    return {
      locked: true,
      remainingMinutes: remainingMin,
      attemptsRemaining: 0,
      message:
        "🔒 Acceso de Administrador bloqueado temporalmente por seguridad tras múltiples intentos fallidos. " +
        "Intenta nuevamente en " + remainingMin + " minuto(s)."
    };
  }
  return { locked: false, remainingMinutes: 0 };
}

function registrarIntentoFallidoAdmin_(customPrefix) {
  const props = PropertiesService.getScriptProperties();
  const failCount = Number(props.getProperty("CRONOS_ADMIN_FAIL_COUNT") || "0") + 1;

  if (failCount >= CRONOS_ADMIN_MAX_ATTEMPTS) {
    const strikes = Number(props.getProperty("CRONOS_ADMIN_LOCKOUT_STRIKES") || "0") + 1;
    const lockMinutes = CRONOS_ADMIN_BASE_LOCK_MINUTES * Math.pow(2, Math.min(strikes - 1, 3));
    const lockUntil = new Date().getTime() + lockMinutes * 60000;

    props.setProperty("CRONOS_ADMIN_FAIL_COUNT", "0");
    props.setProperty("CRONOS_ADMIN_LOCKOUT_STRIKES", String(strikes));
    props.setProperty("CRONOS_ADMIN_LOCKOUT_UNTIL", String(lockUntil));

    return {
      status: "auth_locked",
      locked: true,
      hasPin: true,
      attemptsRemaining: 0,
      remainingMinutes: lockMinutes,
      message:
        "🔒 Se alcanzaron " + CRONOS_ADMIN_MAX_ATTEMPTS + " intentos fallidos. " +
        "Por seguridad, el acceso de Administrador y la creación de archivos quedaron bloqueados durante " +
        lockMinutes + " minutos."
    };
  }

  const remaining = CRONOS_ADMIN_MAX_ATTEMPTS - failCount;
  props.setProperty("CRONOS_ADMIN_FAIL_COUNT", String(failCount));

  return {
    status: "auth_error",
    locked: false,
    hasPin: true,
    attemptsRemaining: remaining,
    message:
      (customPrefix || "El PIN de 4 números de Administrador es incorrecto.") +
      " Intentos restantes antes del bloqueo temporal: " + remaining + "."
  };
}

function limpiarIntentosFallidosAdmin_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("CRONOS_ADMIN_FAIL_COUNT");
  props.deleteProperty("CRONOS_ADMIN_LOCKOUT_UNTIL");
  props.deleteProperty("CRONOS_ADMIN_LOCKOUT_STRIKES");
}

function validarCredencialesAdmin_(profile, inputPin, secret) {
  const lockCheck = verificarEstadoBloqueoAdmin_();
  if (lockCheck.locked) {
    return {
      ok: false,
      response: {
        status: "auth_locked",
        locked: true,
        hasPin: true,
        attemptsRemaining: 0,
        remainingMinutes: lockCheck.remainingMinutes,
        message: lockCheck.message
      }
    };
  }

  if (!inputPin || !/^\d{4}$/.test(inputPin) || calcularHashPinAdmin_(inputPin, secret) !== profile.pinHash) {
    return {
      ok: false,
      response: registrarIntentoFallidoAdmin_("El PIN de 4 números de Administrador es incorrecto.")
    };
  }

  limpiarIntentosFallidosAdmin_();
  return { ok: true };
}

function obtenerCatalogoHojasAdmin_(defaultOrgName, localTime) {
  const props = PropertiesService.getScriptProperties();
  const primarySs = SpreadsheetApp.getActiveSpreadsheet();
  const primaryId = obtenerIdSpreadsheetSeguro_(primarySs);
  const primaryUrl = obtenerUrlSpreadsheetSeguro_(primarySs);
  const primaryTitle = obtenerNombreSpreadsheetSeguro_(primarySs);

  let list = [];
  try {
    const raw = props.getProperty("CRONOS_ADMIN_SHEETS");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch (_) {
    list = [];
  }

  // Asegurar que la hoja principal siempre esté registrada en la posición 0
  const hasPrimary = list.some(function (item) {
    return item && (item.isPrimary === true || (primaryId && item.sheetId === primaryId));
  });

  if (!hasPrimary) {
    list.unshift({
      sheetId: primaryId,
      orgName: String(defaultOrgName || primaryTitle || "Hoja Principal").trim(),
      sheetTitle: primaryTitle,
      sheetUrl: primaryUrl,
      isPrimary: true,
      workersCopied: 0,
      createdAt: localTime
    });
    props.setProperty("CRONOS_ADMIN_SHEETS", JSON.stringify(list));
  } else if (defaultOrgName && list[0] && list[0].isPrimary) {
    list[0].orgName = String(defaultOrgName).trim();
    if (primaryUrl) list[0].sheetUrl = primaryUrl;
    if (primaryId) list[0].sheetId = primaryId;
    props.setProperty("CRONOS_ADMIN_SHEETS", JSON.stringify(list));
  }

  return list;
}

function leerPerfilAdminGuardado_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty("CRONOS_ADMIN_PROFILE");
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function generarIdAdminUnico_(usedIdsMap) {
  const map = usedIdsMap || {};
  for (let attempt = 0; attempt < 50; attempt++) {
    const rest = Math.floor(Math.random() * 10000000);
    const candidate = "9" + String(rest).padStart(7, "0");
    if (!map[candidate]) return candidate;
  }
  return "9" + String(Math.floor(1000000 + Math.random() * 8999999));
}

function serializarDirectorioParaAdmin_(workersSheet) {
  const dir = leerDirectorioTrabajadores_(workersSheet);
  return dir.rows.map(function (r) {
    return {
      workerId: r.workerId,
      formattedWorkerId: r.formattedId,
      workerName: r.workerName,
      deviceStatus: r.statusText,
      primaryDevice: r.primaryCell,
      createdAt: r.createdAt,
      lastSeen: r.lastSeen,
      accountStatus: r.accountStatus,
      accountStatusLabel: r.accountStatusLabel,
      isAdmin: r.workerId.indexOf("9") === 0
    };
  });
}

function gestionarAutenticacionAdmin_(data, localTime) {
  const lockCheck = verificarEstadoBloqueoAdmin_();
  if (lockCheck.locked) {
    return {
      status: "auth_locked",
      locked: true,
      hasPin: true,
      attemptsRemaining: 0,
      remainingMinutes: lockCheck.remainingMinutes,
      message: lockCheck.message
    };
  }

  const props = PropertiesService.getScriptProperties();
  const secret = obtenerSecretoHmac_();
  const inputPin = String(data.adminPin || "").trim();
  const inputOrgName = String(data.orgName || "").trim();
  const inputAdminName = String(data.adminName || "").trim().replace(/\s+/g, " ");
  const requestedAdminId = normalizarIdTrabajador8_(data.adminId);
  const primarySs = SpreadsheetApp.getActiveSpreadsheet();

  // Inicializar primero la pestaña del mes en curso para reutilizar "Hoja 1" y que nunca quede sobrando
  const infoMesActual = resolverInfoMesDesdeFechaLocal_(localTime);
  obtenerHojaMensualCronos_(primarySs, infoMesActual.nombreHoja);

  const workersSheet = obtenerHojaTrabajadoresCronos_(primarySs);
  const dir = leerDirectorioTrabajadores_(workersSheet);

  let profile = leerPerfilAdminGuardado_();

  // Si aún no existe perfil completo de Admin y enviaron un PIN -> crear / completar perfil
  if (!profile || !profile.pinHash) {
    if (inputPin) {
      if (!/^\d{4}$/.test(inputPin)) {
        return {
          status: "error",
          message: "El PIN de administrador debe tener exactamente 4 números (ej. 1234)."
        };
      }
      if (inputAdminName && inputAdminName.length < 2) {
        return {
          status: "error",
          message: "Escribe tu nombre completo de Administrador (mínimo 2 caracteres)."
        };
      }

      // Garantizar que el ID de Admin de 8 dígitos nunca colisione con ningún trabajador existente
      let finalAdminId = requestedAdminId;
      if (!finalAdminId || (dir.byId[finalAdminId] && dir.byId[finalAdminId].workerName.toLowerCase() !== inputAdminName.toLowerCase())) {
        finalAdminId = generarIdAdminUnico_(dir.byId);
      }

      const finalAdminName = inputAdminName || "Administrador";

      profile = {
        adminId: finalAdminId,
        formattedAdminId: formatearIdTrabajador_(finalAdminId),
        adminName: finalAdminName,
        pinHash: calcularHashPinAdmin_(inputPin, secret),
        createdAt: localTime
      };
      props.setProperty("CRONOS_ADMIN_PROFILE", JSON.stringify(profile));
      limpiarIntentosFallidosAdmin_();

      // Registrar al Admin en la pestaña Trabajadores (siempre en 🟢 Activo)
      sincronizarTrabajadorYDispositivo_(
        primarySs,
        {
          workerId: finalAdminId,
          workerName: finalAdminName,
          deviceId: data.deviceId || "CEL-ADMIN001",
          deviceLabel: data.deviceLabel || "Admin",
          preserveExistingId: true,
          autoApprove: true
        },
        localTime,
        "ADMIN"
      );
    }

    const sheets = obtenerCatalogoHojasAdmin_(inputOrgName, localTime);
    return {
      status: "ok",
      action: "admin_auth",
      mode: inputPin ? "profile_created" : "unlocked",
      isAdmin: true,
      hasPin: !!(profile && profile.pinHash),
      adminId: profile ? (profile.adminId || "") : "",
      formattedAdminId: profile && profile.adminId ? formatearIdTrabajador_(profile.adminId) : "",
      adminName: profile ? (profile.adminName || "") : "",
      sheets: sheets,
      workers: serializarDirectorioParaAdmin_(workersSheet)
    };
  }

  // Si ya tiene PIN configurado, validar con protección anti-fuerza bruta
  const pinValidation = validarCredencialesAdmin_(profile, inputPin, secret);
  if (!pinValidation.ok) {
    return pinValidation.response;
  }

  // Si inició sesión por ID de Admin, verificar que coincida (o actualizar perfil heredado si no tenía adminId)
  if (!profile.adminId) {
    let upgradedId = requestedAdminId;
    if (!upgradedId || dir.byId[upgradedId]) {
      upgradedId = generarIdAdminUnico_(dir.byId);
    }
    profile.adminId = upgradedId;
    profile.formattedAdminId = formatearIdTrabajador_(upgradedId);
    profile.adminName = inputAdminName || profile.adminName || "Administrador";
    props.setProperty("CRONOS_ADMIN_PROFILE", JSON.stringify(profile));
  } else if (data.loginById === true && requestedAdminId && requestedAdminId !== profile.adminId) {
    return registrarIntentoFallidoAdmin_("El ID de Administrador de 8 dígitos no coincide con el registrado en este conector.");
  }

  // Sincronizar también en la pestaña Trabajadores para que el Admin pueda checar asistencia
  if (profile.adminId && profile.adminName) {
    sincronizarTrabajadorYDispositivo_(
      primarySs,
      {
        workerId: profile.adminId,
        workerName: profile.adminName,
        deviceId: data.deviceId || "CEL-ADMIN001",
        deviceLabel: data.deviceLabel || "Admin",
        preserveExistingId: true,
        autoApprove: true
      },
      localTime,
      "ADMIN"
    );
  }

  const sheets = obtenerCatalogoHojasAdmin_(inputOrgName, localTime);
  const targetSs = resolverSpreadsheetObjetivo_(data);
  const targetWorkersSheet = obtenerHojaTrabajadoresCronos_(targetSs);

  return {
    status: "ok",
    action: "admin_auth",
    mode: "logged_in",
    isAdmin: true,
    hasPin: true,
    adminId: profile.adminId,
    formattedAdminId: formatearIdTrabajador_(profile.adminId),
    adminName: profile.adminName,
    sheets: sheets,
    workers: serializarDirectorioParaAdmin_(targetWorkersSheet)
  };
}

/**
 * Crea un nuevo archivo de Google Sheets en el Drive del administrador en 1 clic,
 * inicializando la pestaña del mes actual y la pestaña "Trabajadores"
 * (copiando opcionalmente los trabajadores de la hoja origen elegida si copyWorkers === true).
 */
function crearNuevaHojaDesdeAdmin_(data, localTime) {
  const lockCheck = verificarEstadoBloqueoAdmin_();
  if (lockCheck.locked) {
    return {
      status: "auth_locked",
      locked: true,
      attemptsRemaining: 0,
      remainingMinutes: lockCheck.remainingMinutes,
      message: lockCheck.message
    };
  }

  const props = PropertiesService.getScriptProperties();
  const secret = obtenerSecretoHmac_();
  const inputPin = String(data.adminPin || "").trim();
  const newOrgName = String(data.newOrgName || data.orgName || "").trim().replace(/\s+/g, " ");
  const copyWorkers = data.copyWorkers === true;
  const sourceSheetId = String(data.sourceSheetId || "").trim();

  if (newOrgName.length < 2) {
    return {
      status: "error",
      message: "Escribe el nombre para la nueva hoja de Google Sheets (ej. Asistencia Limpieza 2027)."
    };
  }

  // Verificar PIN con límite de intentos fallidos si el perfil de Admin tiene uno configurado
  let profile = leerPerfilAdminGuardado_();

  if (profile && profile.pinHash) {
    const pinValidation = validarCredencialesAdmin_(profile, inputPin, secret);
    if (!pinValidation.ok) {
      return pinValidation.response;
    }
  } else if (inputPin && /^\d{4}$/.test(inputPin)) {
    profile = {
      adminId: normalizarIdTrabajador8_(data.adminId) || generarIdAdminUnico_({}),
      adminName: String(data.adminName || "Administrador").trim(),
      pinHash: calcularHashPinAdmin_(inputPin, secret),
      createdAt: localTime
    };
    profile.formattedAdminId = formatearIdTrabajador_(profile.adminId);
    props.setProperty("CRONOS_ADMIN_PROFILE", JSON.stringify(profile));
    limpiarIntentosFallidosAdmin_();
  }

  const primarySs = SpreadsheetApp.getActiveSpreadsheet();
  const baseTimeZone = primarySs.getSpreadsheetTimeZone();

  // 1. Crear el nuevo archivo de Google Sheets en Google Drive
  const newSs = SpreadsheetApp.create(newOrgName);
  try {
    newSs.setSpreadsheetTimeZone(baseTimeZone);
  } catch (_) {}

  // 2. Inicializar la pestaña del mes actual (queda en posición 0) y la pestaña "Trabajadores"
  const infoMes = resolverInfoMesDesdeFechaLocal_(localTime);
  obtenerHojaMensualCronos_(newSs, infoMes.nombreHoja);
  const newWorkersSheet = obtenerHojaTrabajadoresCronos_(newSs);

  // 3. Si el administrador marcó la opción, copiar los trabajadores de la hoja origen seleccionada
  let workersCopiedCount = 0;
  if (copyWorkers) {
    let sourceSs = primarySs;
    if (sourceSheetId) {
      try {
        sourceSs = resolverSpreadsheetObjetivo_({ sheetId: sourceSheetId });
      } catch (_) {
        sourceSs = primarySs;
      }
    }
    const sourceWorkersSheet = sourceSs.getSheetByName(CRONOS_WORKERS_SHEET_NAME);
    if (sourceWorkersSheet && sourceWorkersSheet.getLastRow() >= 2) {
      asegurarColumnaEstatusTrabajadores_(sourceWorkersSheet);
      const numWorkers = sourceWorkersSheet.getLastRow() - 1;
      const workerRows = sourceWorkersSheet.getRange(2, 1, numWorkers, 8).getValues();
      if (workerRows.length > 0) {
        const normalizedRows = workerRows.map(function (r) {
          const rowCopy = r.slice(0, 8);
          while (rowCopy.length < 8) rowCopy.push("");
          const stInfo = normalizarEstatusCuentaTrabajador_(rowCopy[7], rowCopy[0]);
          rowCopy[7] = stInfo.label;
          return rowCopy;
        });
        const targetRange = newWorkersSheet.getRange(2, 1, normalizedRows.length, 8);
        targetRange.setNumberFormat("@");
        targetRange.setValues(normalizedRows);
        aplicarValidacionEstatusTrabajadores_(newWorkersSheet, 2, normalizedRows.length);
        for (let i = 0; i < normalizedRows.length; i++) {
          const rIdx = i + 2;
          const stText = String(normalizedRows[i][2] || "");
          const lvl = stText.indexOf("🚨") !== -1 ? "shared" : (stText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
          const accInfo = normalizarEstatusCuentaTrabajador_(normalizedRows[i][7], normalizedRows[i][0]);
          estilizarFilaTrabajador_(newWorkersSheet, rIdx, lvl, accInfo.code);
        }
        workersCopiedCount = normalizedRows.length;
      }
    }
  } else if (profile && profile.adminId && profile.adminName) {
    // Asegurar que el Admin esté en la nueva hoja en estado 🟢 Activo para poder checar
    sincronizarTrabajadorYDispositivo_(
      newSs,
      {
        workerId: profile.adminId,
        workerName: profile.adminName,
        deviceId: data.deviceId || "CEL-ADMIN001",
        deviceLabel: data.deviceLabel || "Admin",
        preserveExistingId: true,
        autoApprove: true
      },
      localTime,
      "ADMIN"
    );
  }

  // 4. Registrar la nueva hoja en el catálogo del Admin
  const sheets = obtenerCatalogoHojasAdmin_("", localTime);
  const newEntry = {
    sheetId: obtenerIdSpreadsheetSeguro_(newSs),
    orgName: newOrgName,
    sheetTitle: newOrgName,
    sheetUrl: obtenerUrlSpreadsheetSeguro_(newSs),
    isPrimary: false,
    workersCopied: workersCopiedCount,
    copiedWorkersCount: workersCopiedCount,
    createdAt: localTime
  };
  sheets.push(newEntry);
  props.setProperty("CRONOS_ADMIN_SHEETS", JSON.stringify(sheets));

  return {
    status: "ok",
    action: "admin_create_sheet",
    sheetId: newEntry.sheetId,
    orgName: newOrgName,
    sheetUrl: newEntry.sheetUrl,
    copiedWorkersCount: workersCopiedCount,
    createdSheet: newEntry,
    newSheet: newEntry,
    sheets: sheets,
    workers: serializarDirectorioParaAdmin_(newWorkersSheet)
  };
}

/**
 * Lista los trabajadores y sus estatus de acceso para la hoja seleccionada en el Panel de Admin.
 */
function listarTrabajadoresDesdeAdmin_(spreadsheet, data) {
  const profile = leerPerfilAdminGuardado_();
  const secret = obtenerSecretoHmac_();
  const inputPin = String(data.adminPin || "").trim();

  if (profile && profile.pinHash) {
    const pinValidation = validarCredencialesAdmin_(profile, inputPin, secret);
    if (!pinValidation.ok) {
      return pinValidation.response;
    }
  }

  const workersSheet = obtenerHojaTrabajadoresCronos_(spreadsheet);
  return {
    status: "ok",
    action: "admin_list_workers",
    sheetId: obtenerIdSpreadsheetSeguro_(spreadsheet),
    workers: serializarDirectorioParaAdmin_(workersSheet)
  };
}

/**
 * Permite al Administrador aprobar (🟢 Activo), poner en espera (🟡 Pendiente)
 * o dar de baja (🔴 Baja) a un trabajador en 1 clic desde el Panel de Admin.
 */
function cambiarEstatusTrabajadorDesdeAdmin_(spreadsheet, data, localTime) {
  const profile = leerPerfilAdminGuardado_();
  const secret = obtenerSecretoHmac_();
  const inputPin = String(data.adminPin || "").trim();

  if (profile && profile.pinHash) {
    const pinValidation = validarCredencialesAdmin_(profile, inputPin, secret);
    if (!pinValidation.ok) {
      return pinValidation.response;
    }
  }

  const targetWorkerId = normalizarIdTrabajador8_(data.workerId);
  if (!targetWorkerId) {
    return {
      status: "error",
      message: "ID de trabajador inválido."
    };
  }

  if (targetWorkerId.indexOf("9") === 0) {
    return {
      status: "error",
      message: "El perfil de Administrador siempre permanece Activo."
    };
  }

  const workersSheet = obtenerHojaTrabajadoresCronos_(spreadsheet);
  const dir = leerDirectorioTrabajadores_(workersSheet);
  const record = dir.byId[targetWorkerId];

  if (!record) {
    return {
      status: "not_found",
      message: "No se encontró al trabajador con ID " + formatearIdTrabajador_(targetWorkerId) + " en esta hoja."
    };
  }

  const newStatusInfo = normalizarEstatusCuentaTrabajador_(data.newStatus || data.accountStatus, targetWorkerId);
  const statusTag =
    newStatusInfo.code === "baja"
      ? "BAJA POR ADMIN"
      : (newStatusInfo.code === "pendiente" ? "PENDIENTE" : "APROBADO POR ADMIN");

  workersSheet.getRange(record.rowIndex, 7).setValue(localTime + " (" + statusTag + ")");
  workersSheet.getRange(record.rowIndex, 8).setValue(newStatusInfo.label);
  aplicarValidacionEstatusTrabajadores_(workersSheet, record.rowIndex, 1);

  const lvl =
    record.statusText.indexOf("🚨") !== -1
      ? "shared"
      : (record.statusText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
  estilizarFilaTrabajador_(workersSheet, record.rowIndex, lvl, newStatusInfo.code);

  // Actualizar también la pestaña de Resumen Mensual si existe
  try {
    const infoMes = resolverInfoMesDesdeFechaLocal_(localTime);
    const monthSheet = spreadsheet.getSheetByName(infoMes.nombreHoja);
    if (monthSheet) {
      actualizarHojaResumenMensual_(spreadsheet, monthSheet, localTime);
    }
  } catch (_) {}

  return {
    status: "ok",
    action: "admin_set_worker_status",
    workerId: record.workerId,
    formattedWorkerId: record.formattedId,
    workerName: record.workerName,
    accountStatus: newStatusInfo.code,
    accountStatusLabel: newStatusInfo.label,
    workers: serializarDirectorioParaAdmin_(workersSheet)
  };
}

/**
 * Trigger automático: se dispara cuando un humano edita celdas manualmente en Google Sheets.
 * - Si edita la pestaña "Trabajadores" (ej. cambia el dropdown de Estatus a 🟢 Activo o 🔴 Baja),
 *   aplica el color correspondiente a la fila.
 * - Si edita una pestaña mensual de asistencia, audita el sello HMAC.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();

    if (esHojaTrabajadoresCronos_(sheet)) {
      const startRow = Math.max(2, e.range.getRow());
      const endRow = Math.min(sheet.getLastRow(), e.range.getLastRow());
      for (let r = startRow; r <= endRow; r++) {
        const rawId = normalizarIdTrabajador8_(sheet.getRange(r, 1).getValue());
        if (!rawId) continue;
        const stText = String(sheet.getRange(r, 3).getValue() || "");
        const lvl = stText.indexOf("🚨") !== -1 ? "shared" : (stText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
        const accInfo = normalizarEstatusCuentaTrabajador_(sheet.getRange(r, 8).getValue(), rawId);
        sheet.getRange(r, 8).setValue(accInfo.label);
        estilizarFilaTrabajador_(sheet, r, lvl, accInfo.code);
      }
      return;
    }

    if (!esHojaCronos_(sheet)) return;

    const startRow = Math.max(2, e.range.getRow());
    const endRow = Math.min(sheet.getLastRow(), e.range.getLastRow());
    if (startRow > endRow || sheet.getLastRow() < 2) return;

    const resultado = auditarFilasInterno_(sheet, false);
    if (!resultado.ok) {
      e.source.toast(
        'Se detectó una modificación manual en "' + sheet.getName() + '". El sello HMAC marcó en rojo las filas alteradas.',
        "⚠️ Cronos · Alerta de Integridad",
        8
      );
    }
  } catch (_) {
    // Silencioso en trigger simple onEdit
  }
}

/**
 * Audita la pestaña activa actualmente abierta por el administrador.
 */
function verificarIntegridadCronos() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();

  if (!esHojaCronos_(sheet)) {
    ui.alert(
      "Cronos · Auditoría",
      'La pestaña actual ("' + sheet.getName() + '") no es una hoja de registros de asistencia.\n\n' +
      'Selecciona una pestaña mensual (ej. "Noviembre 2026") o usa la opción "🗂️ Auditar todos los meses".',
      ui.ButtonSet.OK
    );
    return;
  }

  if (sheet.getLastRow() < 2) {
    ui.alert(
      "Cronos · Auditoría",
      'La pestaña "' + sheet.getName() + '" aún no tiene registros de asistencia para auditar.',
      ui.ButtonSet.OK
    );
    return;
  }

  const res = auditarFilasInterno_(sheet, true);
  if (res.ok) {
    ui.alert(
      "✅ Integridad Verificada · " + sheet.getName(),
      "Se verificaron criptográficamente " + res.total + " registro(s) en \"" + sheet.getName() + "\".\n\n" +
      "Todos los sellos HMAC-SHA256 y el encadenamiento secuencial coinciden. " +
      "Ninguna fila ha sido escrita a mano, editada ni eliminada.",
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      "⚠️ Alteración Detectada · " + sheet.getName(),
      "Se encontraron inconsistencias en \"" + sheet.getName() + "\":\n\n" +
      res.errores.slice(0, 8).join("\n") +
      (res.errores.length > 8 ? "\n...y " + (res.errores.length - 8) + " más." : "") +
      "\n\nLas filas afectadas fueron marcadas en ROJO en la columna 'Sello Criptográfico (HMAC)'.",
      ui.ButtonSet.OK
    );
  }
}

/**
 * Audita TODAS las pestañas mensuales de Cronos existentes en el archivo.
 */
function verificarTodosLosMesesCronos() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets().filter(esHojaCronos_);

  if (sheets.length === 0) {
    ui.alert("Cronos · Auditoría Global", "Aún no existen pestañas de asistencia de Cronos en este archivo.", ui.ButtonSet.OK);
    return;
  }

  let totalRegistros = 0;
  let hojasConDatos = 0;
  const erroresGlobales = [];

  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    if (s.getLastRow() < 2) continue;
    hojasConDatos++;
    const res = auditarFilasInterno_(s, true);
    totalRegistros += res.total;
    if (!res.ok) {
      for (let j = 0; j < res.errores.length; j++) {
        erroresGlobales.push("[" + s.getName() + "] " + res.errores[j].replace(/^•\s*/, ""));
      }
    }
  }

  if (hojasConDatos === 0) {
    ui.alert("Cronos · Auditoría Global", "Las pestañas de Cronos aún no contienen registros.", ui.ButtonSet.OK);
    return;
  }

  if (erroresGlobales.length === 0) {
    ui.alert(
      "✅ Todos los Meses Verificados (100% Auténtico)",
      "Se auditaron " + hojasConDatos + " pestaña(s) con un total de " + totalRegistros + " registro(s).\n\n" +
      "Todos los sellos criptográficos HMAC-SHA256 son auténticos y ninguna fila fue alterada ni eliminada.",
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      "⚠️ Alteraciones Detectadas en Auditoría Global",
      "Se detectaron " + erroresGlobales.length + " inconsistencia(s):\n\n" +
      erroresGlobales.slice(0, 8).map(function (msg) { return "• " + msg; }).join("\n") +
      (erroresGlobales.length > 8 ? "\n...y " + (erroresGlobales.length - 8) + " más." : "") +
      "\n\nRevisa las celdas marcadas en ROJO en las pestañas indicadas.",
      ui.ButtonSet.OK
    );
  }
}

/**
 * Permite actualizar manualmente la pestaña "📊 Resumen Mensual" desde el menú superior.
 */
function actualizarResumenMensualManualCronos() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const active = spreadsheet.getActiveSheet();
  const targetMonthSheet = esHojaCronos_(active) ? active : obtenerPrimeraHojaCronos_(spreadsheet);
  if (!targetMonthSheet || !esHojaCronos_(targetMonthSheet)) {
    spreadsheet.toast("Aún no existe una pestaña mensual de asistencia para resumir.", "📊 Cronos", 4);
    return;
  }
  const now = new Date();
  const localTime = Utilities.formatDate(now, spreadsheet.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
  actualizarHojaResumenMensual_(spreadsheet, targetMonthSheet, localTime);
  spreadsheet.toast('Pestaña "' + CRONOS_SUMMARY_SHEET_NAME + '" actualizada con los datos de "' + targetMonthSheet.getName() + '".', "📊 Cronos", 4);
}

/**
 * Reaplica anchos, alturas y diseño visual a la pestaña activa.
 */
function reaplicarDisenoCronos() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();

  if (esHojaTrabajadoresCronos_(sheet)) {
    asegurarColumnaEstatusTrabajadores_(sheet);
    aplicarFormatoBaseTrabajadores_(sheet);
    const lastW = sheet.getLastRow();
    for (let r = 2; r <= lastW; r++) {
      const statusText = String(sheet.getRange(r, 3).getValue() || "");
      const lvl = statusText.indexOf("🚨") !== -1 ? "shared" : (statusText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
      const accInfo = normalizarEstatusCuentaTrabajador_(sheet.getRange(r, 8).getValue(), sheet.getRange(r, 1).getValue());
      estilizarFilaTrabajador_(sheet, r, lvl, accInfo.code);
    }
    spreadsheet.toast('Diseño visual reaplicado en "Trabajadores".', "🎨 Cronos", 4);
    return;
  }

  if (esHojaResumenCronos_(sheet)) {
    actualizarResumenMensualManualCronos();
    return;
  }

  if (!esHojaCronos_(sheet)) {
    spreadsheet.toast("Selecciona primero una pestaña de Cronos.", "🎨 Cronos", 5);
    return;
  }

  if (sheet.getLastColumn() === 9) {
    migrarHoja9a11Columnas_(sheet);
  }

  const esPrimeraCronos = obtenerPrimeraHojaCronos_(spreadsheet).getSheetId() === sheet.getSheetId();
  aplicarFormatoBaseHoja_(sheet, esPrimeraCronos ? "#10B981" : "#64748B");
  const lastRow = sheet.getLastRow();
  for (let r = 2; r <= lastRow; r++) {
    const devText = String(sheet.getRange(r, 5).getValue() || "");
    const lvl = devText.indexOf("🚨") !== -1 ? "shared" : (devText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
    estilizarFilaRegistro_(sheet, r, lvl, "");
  }
  auditarFilasInterno_(sheet, false);
  spreadsheet.toast('Diseño visual reaplicado en "' + sheet.getName() + '".', "🎨 Cronos", 4);
}

/* ============================================================================
   Directorio Automático de Trabajadores (ID de 8 dígitos + Estatus de Acceso)
   ============================================================================ */

function normalizarIdTrabajador8_(raw) {
  const digits = String(raw || "").replace(/\D+/g, "");
  return digits.length === 8 ? digits : "";
}

function formatearIdTrabajador_(digits8) {
  const d = normalizarIdTrabajador8_(digits8);
  if (!d) return "SIN-ID";
  return d.slice(0, 4) + "-" + d.slice(4, 8);
}

function normalizarNombreComparacion_(name) {
  const s = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  try {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (_) {
    return s;
  }
}

/**
 * Normaliza el valor de la columna 8 ("Estatus de Acceso") de la pestaña Trabajadores.
 */
function normalizarEstatusCuentaTrabajador_(rawCell, rawId) {
  const cleanId = normalizarIdTrabajador8_(rawId);
  if (cleanId && cleanId.indexOf("9") === 0) {
    return { code: "activo", label: CRONOS_WORKER_STATUS_ACTIVO };
  }

  const txt = String(rawCell || "").trim().toLowerCase();
  if (!txt) {
    return { code: "activo", label: CRONOS_WORKER_STATUS_ACTIVO };
  }
  if (txt.indexOf("baja") !== -1 || txt.indexOf("bloquead") !== -1 || txt.indexOf("inactiv") !== -1 || txt.indexOf("rechazad") !== -1) {
    return { code: "baja", label: CRONOS_WORKER_STATUS_BAJA };
  }
  if (txt.indexOf("pendiente") !== -1 || txt.indexOf("solicitud") !== -1 || txt.indexOf("espera") !== -1) {
    return { code: "pendiente", label: CRONOS_WORKER_STATUS_PENDIENTE };
  }
  return { code: "activo", label: CRONOS_WORKER_STATUS_ACTIVO };
}

function generarIdTrabajadorUnico_(usedIdsMap) {
  const map = usedIdsMap || {};
  const adminProfile = leerPerfilAdminGuardado_();
  const reservedAdminId = adminProfile && adminProfile.adminId ? adminProfile.adminId : "";

  for (let attempt = 0; attempt < 50; attempt++) {
    // Los IDs de trabajadores empiezan con dígitos 1-8 (el prefijo 9 se reserva para Admin)
    const first = Math.floor(1 + Math.random() * 8);
    const rest = Math.floor(Math.random() * 10000000);
    const candidate = String(first) + String(rest).padStart(7, "0");
    if (!map[candidate] && candidate !== reservedAdminId) return candidate;
  }
  return String(Math.floor(10000000 + Math.random() * 80000000));
}

function extraerDeviceIdLimpio_(rawDeviceId) {
  const clean = String(rawDeviceId || "").trim().replace(/[^A-Za-z0-9\-_]/g, "").slice(0, 32);
  return clean || "CEL-DESCONOCIDO";
}

function extraerPrimerDeviceIdDeTexto_(cellText) {
  const m = String(cellText || "").match(/(CEL-[A-Za-z0-9\-_]+)/);
  return m ? m[1] : String(cellText || "").trim().split(/\s+/)[0] || "";
}

function extraerTodosLosDeviceIdsDeRegistro_(record) {
  const ids = {};
  if (record.primaryDeviceId) {
    ids[record.primaryDeviceId] = true;
  }
  const matches = String(record.historyText || "").match(/CEL-[A-Za-z0-9\-_]+/g) || [];
  for (let i = 0; i < matches.length; i++) {
    ids[matches[i]] = true;
  }
  return Object.keys(ids);
}

function esHojaTrabajadoresCronos_(sheet) {
  if (!sheet) return false;
  if (sheet.getName() === CRONOS_WORKERS_SHEET_NAME) return true;
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 5) {
    return String(sheet.getRange(1, 1).getValue() || "") === CRONOS_WORKERS_HEADERS[0];
  }
  return false;
}

function esHojaResumenCronos_(sheet) {
  if (!sheet) return false;
  return sheet.getName() === CRONOS_SUMMARY_SHEET_NAME;
}

function obtenerHojaTrabajadoresCronos_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CRONOS_WORKERS_SHEET_NAME);
  if (!sheet) {
    const totalSheets = spreadsheet.getSheets().length;
    sheet = spreadsheet.insertSheet(CRONOS_WORKERS_SHEET_NAME, totalSheets);
    inicializarHojaTrabajadores_(sheet);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    inicializarHojaTrabajadores_(sheet);
  } else {
    asegurarColumnaEstatusTrabajadores_(sheet);
  }
  return sheet;
}

function inicializarHojaTrabajadores_(sheet) {
  sheet.clear();
  const headerRange = sheet.getRange(1, 1, 1, 8);
  headerRange.setValues([CRONOS_WORKERS_HEADERS]);
  aplicarFormatoBaseTrabajadores_(sheet);
}

/**
 * Migra de forma transparente cualquier pestaña "Trabajadores" de 7 columnas a 8 columnas
 * añadiendo "Estatus de Acceso" con desplegable nativo (🟢 Activo por defecto para filas previas).
 */
function asegurarColumnaEstatusTrabajadores_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return;
  const col8Header = String(sheet.getRange(1, 8).getValue() || "").trim();
  if (col8Header !== CRONOS_WORKERS_HEADERS[7]) {
    sheet.getRange(1, 8).setValue(CRONOS_WORKERS_HEADERS[7]);
    aplicarFormatoBaseTrabajadores_(sheet);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const numRows = lastRow - 1;
    const col8Range = sheet.getRange(2, 8, numRows, 1);
    const vals = col8Range.getValues();
    const ids = sheet.getRange(2, 1, numRows, 1).getValues();
    let changed = false;
    for (let i = 0; i < numRows; i++) {
      if (!String(vals[i][0] || "").trim()) {
        const st = normalizarEstatusCuentaTrabajador_("", ids[i][0]);
        vals[i][0] = st.label;
        changed = true;
      }
    }
    if (changed) {
      col8Range.setValues(vals);
    }
    aplicarValidacionEstatusTrabajadores_(sheet, 2, numRows);
  }
}

function aplicarValidacionEstatusTrabajadores_(sheet, startRow, numRows) {
  if (!sheet || numRows < 1) return;
  try {
    if (typeof SpreadsheetApp.newDataValidation === "function") {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(CRONOS_WORKER_STATUS_OPTIONS, true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(startRow, 8, numRows, 1).setDataValidation(rule);
    }
  } catch (_) {}
}

function aplicarFormatoBaseTrabajadores_(sheet) {
  try {
    sheet.setTabColor("#2563EB");
  } catch (_) {}

  const headerRange = sheet.getRange(1, 1, 1, 8);
  headerRange
    .setBackground("#0F172A")
    .setFontColor("#FFFFFF")
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.getRange(1, 2).setHorizontalAlignment("left");
  sheet.getRange(1, 5).setHorizontalAlignment("left");
  sheet.setRowHeight(1, 42);
  sheet.setFrozenRows(1);

  for (let i = 0; i < CRONOS_WORKERS_COL_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, CRONOS_WORKERS_COL_WIDTHS[i]);
  }

  if (!sheet.getFilter()) {
    try {
      sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 8).createFilter();
    } catch (_) {}
  }

  // Reglas de formato condicional para la columna H (Estatus de Acceso)
  try {
    const maxRows = Math.max(sheet.getMaxRows() - 1, 500);
    const accStatusRange = sheet.getRange(2, 8, maxRows, 1);

    const ruleActivo = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(CRONOS_WORKER_STATUS_ACTIVO)
      .setBackground("#D1FAE5")
      .setFontColor("#065F46")
      .setBold(true)
      .setRanges([accStatusRange])
      .build();

    const rulePendiente = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(CRONOS_WORKER_STATUS_PENDIENTE)
      .setBackground("#FEF3C7")
      .setFontColor("#92400E")
      .setBold(true)
      .setRanges([accStatusRange])
      .build();

    const ruleBaja = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(CRONOS_WORKER_STATUS_BAJA)
      .setBackground("#FEE2E2")
      .setFontColor("#991B1B")
      .setBold(true)
      .setRanges([accStatusRange])
      .build();

    sheet.setConditionalFormatRules([ruleActivo, rulePendiente, ruleBaja]);
    aplicarValidacionEstatusTrabajadores_(sheet, 2, maxRows);
  } catch (_) {}
}

function estilizarFilaTrabajador_(sheet, rowIndex, level, accountStatusCode) {
  sheet.setRowHeight(rowIndex, 38);
  const rowBg = rowIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
  const rowRange = sheet.getRange(rowIndex, 1, 1, 8);

  rowRange
    .setBackground(rowBg)
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontColor("#0F172A")
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("center")
    .setBorder(false, false, true, false, false, false, "#E2E8F0", SpreadsheetApp.BorderStyle.SOLID);

  // Col A: ID de Acceso (8 dígitos)
  sheet.getRange(rowIndex, 1)
    .setFontFamily("Roboto Mono")
    .setFontWeight("bold")
    .setBackground("#EFF6FF")
    .setFontColor("#1E3A8A");

  // Col B: Nombre Completo (Congelado)
  sheet.getRange(rowIndex, 2)
    .setHorizontalAlignment("left")
    .setFontWeight("bold");

  // Col C: Estado de Dispositivos
  const statusCell = sheet.getRange(rowIndex, 3);
  if (level === "shared") {
    statusCell.setBackground("#FEE2E2").setFontColor("#991B1B").setFontWeight("bold");
  } else if (level === "secondary") {
    statusCell.setBackground("#FEF3C7").setFontColor("#92400E").setFontWeight("bold");
  } else {
    statusCell.setBackground("#D1FAE5").setFontColor("#065F46").setFontWeight("bold");
  }

  // Col D: Celular Titular
  sheet.getRange(rowIndex, 4)
    .setFontFamily("Roboto Mono")
    .setFontSize(9)
    .setFontColor("#334155");

  // Col E: Historial de Celulares Usados (lista)
  sheet.getRange(rowIndex, 5)
    .setHorizontalAlignment("left")
    .setFontFamily("Roboto Mono")
    .setFontSize(9)
    .setFontColor("#334155")
    .setWrap(true);

  // Col H: Estatus de Acceso (🟢 Activo / 🟡 Pendiente / 🔴 Baja)
  const accCell = sheet.getRange(rowIndex, 8);
  accCell.setFontWeight("bold");
  if (accountStatusCode === "baja") {
    accCell.setBackground("#FEE2E2").setFontColor("#991B1B");
  } else if (accountStatusCode === "pendiente") {
    accCell.setBackground("#FEF3C7").setFontColor("#92400E");
  } else {
    accCell.setBackground("#D1FAE5").setFontColor("#065F46");
  }
}

/**
 * Lee el directorio actual de la pestaña "Trabajadores", incluyendo el estatus de acceso
 * y el mapa de dispositivos bloqueados (asociados a ex-trabajadores dados de baja).
 */
function leerDirectorioTrabajadores_(workersSheet) {
  asegurarColumnaEstatusTrabajadores_(workersSheet);
  const lastRow = workersSheet.getLastRow();
  const byId = {};
  const primaryDeviceOwner = {}; // deviceId -> { workerId, workerName, accountStatus }
  const blockedDevices = {}; // deviceId -> { workerId, workerName }
  const rows = [];

  if (lastRow < 2) {
    return {
      byId: byId,
      primaryDeviceOwner: primaryDeviceOwner,
      blockedDevices: blockedDevices,
      rows: rows
    };
  }

  const values = workersSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (let i = 0; i < values.length; i++) {
    const rIdx = i + 2;
    const rawId = normalizarIdTrabajador8_(values[i][0]);
    const workerName = String(values[i][1] || "").trim();
    const statusText = String(values[i][2] || "").trim();
    const primaryCell = String(values[i][3] || "").trim();
    const primaryDevId = extraerPrimerDeviceIdDeTexto_(primaryCell);
    const historyText = String(values[i][4] || "").trim();
    const createdAt = String(values[i][5] || "").trim();
    const lastSeen = String(values[i][6] || "").trim();
    const accInfo = normalizarEstatusCuentaTrabajador_(values[i][7], rawId);

    if (!rawId) continue;

    const record = {
      rowIndex: rIdx,
      workerId: rawId,
      formattedId: formatearIdTrabajador_(rawId),
      workerName: workerName,
      normalizedName: normalizarNombreComparacion_(workerName),
      statusText: statusText,
      primaryCell: primaryCell,
      primaryDeviceId: primaryDevId,
      historyText: historyText,
      createdAt: createdAt,
      lastSeen: lastSeen,
      accountStatus: accInfo.code,
      accountStatusLabel: accInfo.label
    };

    byId[rawId] = record;
    rows.push(record);

    if (primaryDevId && !primaryDeviceOwner[primaryDevId]) {
      primaryDeviceOwner[primaryDevId] = {
        workerId: rawId,
        workerName: workerName,
        accountStatus: accInfo.code
      };
    }

    if (accInfo.code === "baja") {
      const devList = extraerTodosLosDeviceIdsDeRegistro_(record);
      for (let d = 0; d < devList.length; d++) {
        if (devList[d] && devList[d] !== "CEL-DESCONOCIDO") {
          blockedDevices[devList[d]] = {
            workerId: rawId,
            workerName: workerName
          };
        }
      }
    }
  }

  return {
    byId: byId,
    primaryDeviceOwner: primaryDeviceOwner,
    blockedDevices: blockedDevices,
    rows: rows
  };
}

/**
 * Obtiene la última marca (ENTRADA o SALIDA) de un trabajador en la pestaña del mes actual
 * para sincronizar el Estado Inteligente de los botones en el teléfono.
 */
function obtenerUltimaMarcaTrabajadorMes_(spreadsheet, formattedWorkerId, localTime) {
  try {
    const infoMes = resolverInfoMesDesdeFechaLocal_(localTime);
    const monthSheet = spreadsheet.getSheetByName(infoMes.nombreHoja);
    if (!monthSheet || monthSheet.getLastRow() < 2) return null;

    const lastRow = monthSheet.getLastRow();
    const startRow = Math.max(2, lastRow - 80);
    const numRows = lastRow - startRow + 1;
    const vals = monthSheet.getRange(startRow, 1, numRows, 4).getValues();

    for (let i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][1] || "").trim() === formattedWorkerId) {
        const punchType = String(vals[i][3] || "").trim().toUpperCase();
        if (punchType === "ENTRADA" || punchType === "SALIDA") {
          return {
            lastPunchType: punchType,
            lastPunchTime: String(vals[i][0] || "").trim()
          };
        }
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Evalúa la relación entre el trabajador actual y el celular desde el que se conecta,
 * conservando el número de orden fijo de cada celular (#1 Titular, #2 Adicional #2, #3 Adicional #3...).
 */
function evaluarYActualizarDispositivoTrabajador_(workersSheet, dir, record, deviceId, deviceLabel, localTime, eventTag) {
  const etiquetaEquipo = deviceLabel ? (deviceId + " (" + deviceLabel + ")") : deviceId;
  const ownerOfDevice = dir.primaryDeviceOwner[deviceId];
  const belongsToOtherWorker = ownerOfDevice && ownerOfDevice.workerId !== record.workerId;
  const isWorkerPrimary = (deviceId === record.primaryDeviceId) && !belongsToOtherWorker;

  // Extraer lista de líneas previas de historial
  const lines = record.historyText
    ? record.historyText.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)
    : [];

  // Mapear cada dispositivo único a su número de orden fijo (1, 2, 3...)
  const deviceOrderMap = {};
  let totalUniqueDevices = 0;

  if (record.primaryDeviceId) {
    totalUniqueDevices = 1;
    deviceOrderMap[record.primaryDeviceId] = 1;
  }

  for (let i = 0; i < lines.length; i++) {
    const devInLine = extraerPrimerDeviceIdDeTexto_(lines[i]);
    if (devInLine && !deviceOrderMap[devInLine]) {
      totalUniqueDevices++;
      deviceOrderMap[devInLine] = totalUniqueDevices;
    }
  }

  const isNewDeviceForWorker = !deviceOrderMap[deviceId];
  if (isNewDeviceForWorker) {
    totalUniqueDevices++;
    deviceOrderMap[deviceId] = totalUniqueDevices;
    const numOrden = deviceOrderMap[deviceId];
    const notaDueno = belongsToOtherWorker
      ? (" · Celular de: " + ownerOfDevice.workerName)
      : (" · Adicional #" + numOrden);
    lines.push(
      numOrden + ") " + etiquetaEquipo + " [Visto " + localTime.slice(0, 10) + notaDueno + "]"
    );
  }

  const specificDeviceNumber = deviceOrderMap[deviceId] || totalUniqueDevices;

  // Determinar resultado de auditoría usando el número específico de ese celular (specificDeviceNumber)
  let deviceLevel = "primary";
  let deviceAudit = "✅ Celular titular (" + deviceId + ")";
  let deviceNote = "";

  if (belongsToOtherWorker) {
    deviceLevel = "shared";
    deviceAudit = "🚨 Celular de " + ownerOfDevice.workerName + " (" + deviceId + ")";
    deviceNote =
      "⚠️ DISPOSITIVO COMPARTIDO: Este registro de " + record.workerName +
      " se envió desde el celular registrado como titular de " + ownerOfDevice.workerName +
      " (" + etiquetaEquipo + ").";
  } else if (!isWorkerPrimary) {
    deviceLevel = "secondary";
    deviceAudit = "⚠️ Celular adicional #" + specificDeviceNumber + " (" + deviceId + ")";
    deviceNote =
      "ℹ️ DISPOSITIVO ADICIONAL #" + specificDeviceNumber + ": El celular titular de " + record.workerName +
      " es " + record.primaryDeviceId + ", pero este registro se envió desde su dispositivo #" + specificDeviceNumber + " (" + etiquetaEquipo + ").";
  }

  // Determinar estado resumen en la pestaña "Trabajadores"
  let workerStatusText = "✅ 1 celular (Habitual)";
  let workerRowLevel = "primary";
  const sharedMatch = lines.join(" ").match(/Celular de:\s*([^\]]+)/);

  if (belongsToOtherWorker || sharedMatch) {
    const otroNombre = belongsToOtherWorker ? ownerOfDevice.workerName : sharedMatch[1].trim();
    workerStatusText = "🚨 " + totalUniqueDevices + " cel. (Compartido con " + otroNombre + ")";
    workerRowLevel = "shared";
  } else if (totalUniqueDevices > 1) {
    workerStatusText = "⚠️ " + totalUniqueDevices + " celulares usados";
    workerRowLevel = "secondary";
  }

  const updatedHistory = lines.join("\n");
  const updatedLastSeen = localTime + " (" + eventTag + ")";

  workersSheet.getRange(record.rowIndex, 1, 1, 8).setNumberFormat("@");
  workersSheet.getRange(record.rowIndex, 3).setValue(workerStatusText);
  workersSheet.getRange(record.rowIndex, 5).setValue(updatedHistory);
  workersSheet.getRange(record.rowIndex, 7).setValue(updatedLastSeen);
  workersSheet.getRange(record.rowIndex, 8).setValue(record.accountStatusLabel);
  aplicarValidacionEstatusTrabajadores_(workersSheet, record.rowIndex, 1);
  estilizarFilaTrabajador_(workersSheet, record.rowIndex, workerRowLevel, record.accountStatus);

  return {
    workerId: record.workerId,
    formattedWorkerId: record.formattedId,
    workerName: record.workerName, // Nombre congelado
    accountStatus: record.accountStatus,
    accountStatusLabel: record.accountStatusLabel,
    deviceAudit: deviceAudit,
    deviceLevel: deviceLevel,
    deviceNote: deviceNote
  };
}

/**
 * Busca un ID de 8 dígitos en la pestaña "Trabajadores" para iniciar sesión ("Ya tengo mi ID" / Kiosco)
 * validando primero si la cuenta está en 🔴 Baja o 🟡 Pendiente antes de tocar dispositivos.
 */
function iniciarSesionPorIdTrabajador_(spreadsheet, data, localTime) {
  const rawId = normalizarIdTrabajador8_(data.workerId);
  if (!rawId) {
    return {
      status: "error",
      message: "El ID debe contener exactamente 8 dígitos numéricos."
    };
  }

  // 1. Verificar si el ID de 8 dígitos pertenece al Perfil de Administrador
  const adminProfile = leerPerfilAdminGuardado_();
  if (adminProfile && adminProfile.adminId && adminProfile.adminId === rawId) {
    const lockCheck = verificarEstadoBloqueoAdmin_();
    if (lockCheck.locked) {
      return {
        status: "auth_locked",
        isAdmin: true,
        locked: true,
        attemptsRemaining: 0,
        remainingMinutes: lockCheck.remainingMinutes,
        message: lockCheck.message
      };
    }

    const inputPin = String(data.adminPin || "").trim();
    if (!inputPin) {
      return {
        status: "admin_pin_required",
        isAdmin: true,
        workerId: adminProfile.adminId,
        formattedWorkerId: formatearIdTrabajador_(adminProfile.adminId),
        workerName: adminProfile.adminName || "Administrador",
        message: "ID de Administrador reconocido. Ingresa tu PIN de 4 números para continuar."
      };
    }

    const secret = obtenerSecretoHmac_();
    const pinValidation = validarCredencialesAdmin_(adminProfile, inputPin, secret);
    if (!pinValidation.ok) {
      const failRes = pinValidation.response;
      failRes.isAdmin = true;
      failRes.workerId = adminProfile.adminId;
      failRes.formattedWorkerId = formatearIdTrabajador_(adminProfile.adminId);
      failRes.workerName = adminProfile.adminName || "Administrador";
      if (failRes.status === "auth_error") {
        failRes.status = "admin_pin_invalid";
      }
      return failRes;
    }

    // PIN de Admin válido: sincronizar en Trabajadores (siempre en 🟢 Activo) y devolver catálogo de hojas
    const syncAdmin = sincronizarTrabajadorYDispositivo_(
      spreadsheet,
      {
        workerId: adminProfile.adminId,
        workerName: adminProfile.adminName || "Administrador",
        deviceId: data.deviceId,
        deviceLabel: data.deviceLabel,
        preserveExistingId: true,
        autoApprove: true
      },
      localTime,
      "SESIÓN ADMIN"
    );
    const sheets = obtenerCatalogoHojasAdmin_("", localTime);
    const lastPunchInfo = obtenerUltimaMarcaTrabajadorMes_(spreadsheet, syncAdmin.formattedWorkerId, localTime);

    return {
      status: "ok",
      action: "login_worker",
      isAdmin: true,
      workerId: syncAdmin.workerId,
      formattedWorkerId: syncAdmin.formattedWorkerId,
      workerName: syncAdmin.workerName,
      accountStatus: "activo",
      accountStatusLabel: CRONOS_WORKER_STATUS_ACTIVO,
      lastPunchType: lastPunchInfo ? lastPunchInfo.lastPunchType : "",
      lastPunchTime: lastPunchInfo ? lastPunchInfo.lastPunchTime : "",
      deviceAudit: syncAdmin.deviceAudit,
      deviceLevel: syncAdmin.deviceLevel,
      sheets: sheets
    };
  }

  // 2. Flujo normal de trabajador en pestaña "Trabajadores"
  const workersSheet = obtenerHojaTrabajadoresCronos_(spreadsheet);
  const dir = leerDirectorioTrabajadores_(workersSheet);
  const record = dir.byId[rawId];

  if (!record) {
    return {
      status: "not_found",
      workerId: rawId,
      formattedWorkerId: formatearIdTrabajador_(rawId),
      message: "El ID " + formatearIdTrabajador_(rawId) + " aún no está registrado en esta hoja de asistencia."
    };
  }

  // ÁNGULO 1 CUBIERTO: Si el trabajador está dado de 🔴 Baja, rechazar el inicio de sesión de inmediato
  // (incluso desde una PC o desde el celular de un compañero activo, sin contaminar el celular del compañero)
  if (record.accountStatus === "baja") {
    return {
      status: "blocked",
      accountStatus: "baja",
      accountStatusLabel: CRONOS_WORKER_STATUS_BAJA,
      workerId: record.workerId,
      formattedWorkerId: record.formattedId,
      workerName: record.workerName,
      message:
        "Esta cuenta de trabajador (" + record.formattedId + " · " + record.workerName + ") " +
        "fue dada de baja por el administrador y no tiene permiso para iniciar sesión ni registrar asistencia."
    };
  }

  // Si está en 🟡 Pendiente, informar su estado sin permitirle checar todavía
  if (record.accountStatus === "pendiente") {
    return {
      status: "pending_approval",
      accountStatus: "pendiente",
      accountStatusLabel: CRONOS_WORKER_STATUS_PENDIENTE,
      workerId: record.workerId,
      formattedWorkerId: record.formattedId,
      workerName: record.workerName,
      deviceAudit: "🟡 Solicitud en revisión",
      deviceLevel: "secondary",
      message:
        "Hola, " + record.workerName + ". Tu solicitud de acceso (" + record.formattedId + ") " +
        "aún está pendiente de aprobación por el administrador."
    };
  }

  const deviceId = extraerDeviceIdLimpio_(data.deviceId);
  const deviceLabel = String(data.deviceLabel || "").trim().slice(0, 40);

  const evalRes = evaluarYActualizarDispositivoTrabajador_(
    workersSheet,
    dir,
    record,
    deviceId,
    deviceLabel,
    localTime,
    "SESIÓN"
  );

  const lastPunchInfo = obtenerUltimaMarcaTrabajadorMes_(spreadsheet, evalRes.formattedWorkerId, localTime);

  return {
    status: "ok",
    action: "login_worker",
    isAdmin: false,
    workerId: evalRes.workerId,
    formattedWorkerId: evalRes.formattedWorkerId,
    workerName: evalRes.workerName,
    accountStatus: "activo",
    accountStatusLabel: CRONOS_WORKER_STATUS_ACTIVO,
    lastPunchType: lastPunchInfo ? lastPunchInfo.lastPunchType : "",
    lastPunchTime: lastPunchInfo ? lastPunchInfo.lastPunchTime : "",
    deviceAudit: evalRes.deviceAudit,
    deviceLevel: evalRes.deviceLevel
  };
}

/**
 * Registra o sincroniza al trabajador en la pestaña "Trabajadores", congelando su nombre
 * al primer registro, validando estatus (🟢 Activo / 🟡 Pendiente / 🔴 Baja) y auditando celulares.
 */
function sincronizarTrabajadorYDispositivo_(spreadsheet, data, localTime, eventTag) {
  const workersSheet = obtenerHojaTrabajadoresCronos_(spreadsheet);
  const dir = leerDirectorioTrabajadores_(workersSheet);

  let rawId = normalizarIdTrabajador8_(data.workerId);
  const inputName = String(data.workerName || "Sin nombre").trim().replace(/\s+/g, " ");
  const normInputName = normalizarNombreComparacion_(inputName);
  const deviceId = extraerDeviceIdLimpio_(data.deviceId);
  const deviceLabel = String(data.deviceLabel || "").trim().slice(0, 40);
  const etiquetaEquipo = deviceLabel ? (deviceId + " (" + deviceLabel + ")") : deviceId;
  const isAdminOperation =
    eventTag === "ADMIN" ||
    eventTag === "SESIÓN ADMIN" ||
    (rawId && rawId.indexOf("9") === 0) ||
    data.autoApprove === true;

  // Caso A: Si enviaron un workerId ya existente en la hoja:
  if (rawId && dir.byId[rawId]) {
    const existing = dir.byId[rawId];

    // Si es una cuenta dada de 🔴 Baja -> bloquear cualquier acción o chequeo
    if (existing.accountStatus === "baja" && !isAdminOperation) {
      return {
        blocked: true,
        accountStatus: "baja",
        accountStatusLabel: CRONOS_WORKER_STATUS_BAJA,
        workerId: existing.workerId,
        formattedWorkerId: existing.formattedId,
        workerName: existing.workerName,
        message: "La cuenta de " + existing.workerName + " (" + existing.formattedId + ") fue dada de baja por el administrador."
      };
    }

    const samePersonOrDevice =
      existing.normalizedName === normInputName ||
      existing.primaryDeviceId === deviceId;

    if ((eventTag === "ALTA" || eventTag === "SOLICITUD") && !samePersonOrDevice && !data.preserveExistingId) {
      rawId = generarIdTrabajadorUnico_(dir.byId);
    } else {
      // Si intenta hacer ENTRADA/SALIDA pero sigue en 🟡 Pendiente -> bloquear escritura en hoja mensual
      if (existing.accountStatus === "pendiente" && eventTag !== "ALTA" && eventTag !== "SOLICITUD" && !isAdminOperation) {
        return {
          pending: true,
          accountStatus: "pendiente",
          accountStatusLabel: CRONOS_WORKER_STATUS_PENDIENTE,
          workerId: existing.workerId,
          formattedWorkerId: existing.formattedId,
          workerName: existing.workerName,
          message: "Tu perfil (" + existing.formattedId + ") aún está pendiente de aprobación por el administrador."
        };
      }

      return evaluarYActualizarDispositivoTrabajador_(
        workersSheet,
        dir,
        existing,
        deviceId,
        deviceLabel,
        localTime,
        eventTag
      );
    }
  }

  // Caso B: Es un intento de nuevo registro o búsqueda por nombre/dispositivo
  if (!isAdminOperation) {
    // 1. Verificar si el dispositivo (CEL-XXXX) pertenece a un ex-trabajador dado de 🔴 Baja
    if (dir.blockedDevices[deviceId]) {
      const blockedOwner = dir.blockedDevices[deviceId];
      return {
        blocked: true,
        accountStatus: "baja",
        accountStatusLabel: CRONOS_WORKER_STATUS_BAJA,
        workerId: blockedOwner.workerId,
        formattedWorkerId: formatearIdTrabajador_(blockedOwner.workerId),
        workerName: blockedOwner.workerName,
        message:
          "Este dispositivo (" + deviceId + ") está vinculado a una cuenta dada de baja (" +
          blockedOwner.workerName + ") y no tiene permiso para crear nuevos perfiles ni registrar asistencia."
      };
    }

    // 2. Verificar si el nombre ingresado coincide con algún trabajador existente
    for (let i = 0; i < dir.rows.length; i++) {
      const r = dir.rows[i];
      if (r.normalizedName && r.normalizedName === normInputName) {
        if (r.accountStatus === "baja") {
          return {
            blocked: true,
            accountStatus: "baja",
            accountStatusLabel: CRONOS_WORKER_STATUS_BAJA,
            workerId: r.workerId,
            formattedWorkerId: r.formattedId,
            workerName: r.workerName,
            message:
              "El perfil de " + r.workerName + " (" + r.formattedId + ") fue dado de baja por el administrador. " +
              "No es posible crear un nuevo perfil con este nombre."
          };
        }

        // Si es el mismo celular titular, recuperar su registro existente
        if (r.primaryDeviceId === deviceId) {
          if (r.accountStatus === "pendiente" && eventTag !== "ALTA" && eventTag !== "SOLICITUD") {
            return {
              pending: true,
              accountStatus: "pendiente",
              accountStatusLabel: CRONOS_WORKER_STATUS_PENDIENTE,
              workerId: r.workerId,
              formattedWorkerId: r.formattedId,
              workerName: r.workerName,
              message: "Tu solicitud (" + r.formattedId + ") sigue pendiente de aprobación por el administrador."
            };
          }
          return evaluarYActualizarDispositivoTrabajador_(
            workersSheet,
            dir,
            r,
            deviceId,
            deviceLabel,
            localTime,
            eventTag
          );
        }

        // Si intenta registrar el mismo nombre desde otro celular en el flujo de solicitud ("register_worker")
        if (eventTag === "SOLICITUD" || eventTag === "ALTA") {
          return {
            nameTaken: true,
            message:
              'Ya existe un trabajador registrado como "' + r.workerName + '". ' +
              'Si eres tú, toca la pestaña "Ya tengo mi ID" e ingresa tu ID de 8 dígitos.'
          };
        }
      }
    }

    // 3. Anti-spam de solicitudes: si este celular ya tiene una solicitud 🟡 Pendiente activa, devolver esa misma
    if (eventTag === "SOLICITUD" || eventTag === "ALTA") {
      for (let i = 0; i < dir.rows.length; i++) {
        const r = dir.rows[i];
        if (r.primaryDeviceId === deviceId && r.accountStatus === "pendiente") {
          return {
            workerId: r.workerId,
            formattedWorkerId: r.formattedId,
            workerName: r.workerName,
            accountStatus: "pendiente",
            accountStatusLabel: CRONOS_WORKER_STATUS_PENDIENTE,
            deviceAudit: "🟡 Solicitud en revisión (" + deviceId + ")",
            deviceLevel: "secondary",
            deviceNote: ""
          };
        }
      }
    }
  }

  if (!rawId) {
    rawId = generarIdTrabajadorUnico_(dir.byId);
  }

  const formattedId = formatearIdTrabajador_(rawId);
  const ownerOfDevice = dir.primaryDeviceOwner[deviceId];
  const belongsToOtherWorker = ownerOfDevice && normalizarNombreComparacion_(ownerOfDevice.workerName) !== normInputName;

  // Determinar estatus inicial:
  // - Solicitudes de registro ("SOLICITUD") nacen en 🟡 Pendiente hasta que el Admin las apruebe
  // - Admin o registros directos autorizados nacen en 🟢 Activo
  const initialStatusInfo =
    (eventTag === "SOLICITUD" && !isAdminOperation)
      ? { code: "pendiente", label: CRONOS_WORKER_STATUS_PENDIENTE }
      : { code: "activo", label: CRONOS_WORKER_STATUS_ACTIVO };

  let statusText = "✅ 1 celular (Habitual)";
  let rowLevel = "primary";
  let deviceAudit = "✅ Celular titular (" + deviceId + ")";
  let deviceNote = "";
  let firstHistoryLine = "1) " + etiquetaEquipo + " [Titular · " + localTime.slice(0, 10) + "]";

  if (belongsToOtherWorker) {
    statusText = "🚨 1 cel. (Compartido con " + ownerOfDevice.workerName + ")";
    rowLevel = "shared";
    deviceAudit = "🚨 Celular de " + ownerOfDevice.workerName + " (" + deviceId + ")";
    deviceNote =
      "⚠️ DISPOSITIVO COMPARTIDO: Este trabajador se registró usando el celular titular de " +
      ownerOfDevice.workerName + " (" + etiquetaEquipo + ").";
    firstHistoryLine =
      "1) " + etiquetaEquipo + " [Visto " + localTime.slice(0, 10) + " · Celular de: " + ownerOfDevice.workerName + "]";
  }

  const nextRow = workersSheet.getLastRow() + 1;
  const rowRange = workersSheet.getRange(nextRow, 1, 1, 8);
  rowRange.setNumberFormat("@");
  rowRange.setValues([[
    formattedId,
    inputName,
    statusText,
    etiquetaEquipo,
    firstHistoryLine,
    localTime,
    localTime + " (" + eventTag + ")",
    initialStatusInfo.label
  ]]);

  aplicarValidacionEstatusTrabajadores_(workersSheet, nextRow, 1);
  estilizarFilaTrabajador_(workersSheet, nextRow, rowLevel, initialStatusInfo.code);

  return {
    workerId: rawId,
    formattedWorkerId: formattedId,
    workerName: inputName,
    accountStatus: initialStatusInfo.code,
    accountStatusLabel: initialStatusInfo.label,
    deviceAudit: deviceAudit,
    deviceLevel: rowLevel,
    deviceNote: deviceNote
  };
}

/* ============================================================================
   Pestaña Automática de KPIs: "📊 Resumen Mensual"
   ============================================================================ */

function obtenerHojaResumenCronos_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CRONOS_SUMMARY_SHEET_NAME);
  if (!sheet) {
    // Colocar justo antes de "Trabajadores" (o en posición 1 después del mes activo)
    const allSheets = spreadsheet.getSheets();
    let insertIdx = allSheets.length;
    for (let i = 0; i < allSheets.length; i++) {
      if (esHojaTrabajadoresCronos_(allSheets[i])) {
        insertIdx = i;
        break;
      }
    }
    sheet = spreadsheet.insertSheet(CRONOS_SUMMARY_SHEET_NAME, insertIdx);
  }
  return sheet;
}

function formatearMinutosAHorasTexto_(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h + "h " + String(m).padStart(2, "0") + "m";
}

function parsearFechaLocalMs_(localTimeStr) {
  const clean = String(localTimeStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(clean)) return NaN;
  const iso = clean.replace(/\s+/, "T") + "Z";
  return Date.parse(iso);
}

/**
 * Calcula y actualiza en tiempo real los KPIs del mes en la pestaña "📊 Resumen Mensual".
 */
function actualizarHojaResumenMensual_(spreadsheet, monthSheet, localTime) {
  if (!spreadsheet || !monthSheet) return;

  const summarySheet = obtenerHojaResumenCronos_(spreadsheet);
  const workersSheet = obtenerHojaTrabajadoresCronos_(spreadsheet);
  const dir = leerDirectorioTrabajadores_(workersSheet);
  const monthName = monthSheet.getName();

  const statsById = {};
  const workerOrder = [];

  for (let i = 0; i < dir.rows.length; i++) {
    const w = dir.rows[i];
    statsById[w.formattedId] = {
      formattedId: w.formattedId,
      workerName: w.workerName,
      accountStatus: w.accountStatus,
      accountStatusLabel: w.accountStatusLabel,
      daysSet: {},
      entradas: 0,
      salidas: 0,
      closedShifts: 0,
      totalMinutes: 0,
      openInMs: null,
      openInTimeStr: "",
      alertsCount: 0,
      lastType: "",
      lastTime: ""
    };
    workerOrder.push(w.formattedId);
  }

  let totalEntradasMes = 0;
  let totalSalidasMes = 0;
  let totalAlertasMes = 0;

  const lastRow = monthSheet.getLastRow();
  if (lastRow >= 2) {
    const numRows = lastRow - 1;
    const values = monthSheet.getRange(2, 1, numRows, 5).getValues();
    const displayValues = monthSheet.getRange(2, 1, numRows, 5).getDisplayValues();

    for (let i = 0; i < numRows; i++) {
      const rTime = String(displayValues[i][0] || values[i][0] || "").trim();
      const rId = String(values[i][1] || "").trim();
      const rName = String(values[i][2] || "").trim();
      const rType = String(values[i][3] || "").trim().toUpperCase();
      const rAudit = String(values[i][4] || "").trim();

      if (rType === "PRUEBA" || !rId) continue;

      if (!statsById[rId]) {
        statsById[rId] = {
          formattedId: rId,
          workerName: rName || "Trabajador",
          accountStatus: "activo",
          accountStatusLabel: CRONOS_WORKER_STATUS_ACTIVO,
          daysSet: {},
          entradas: 0,
          salidas: 0,
          closedShifts: 0,
          totalMinutes: 0,
          openInMs: null,
          openInTimeStr: "",
          alertsCount: 0,
          lastType: "",
          lastTime: ""
        };
        workerOrder.push(rId);
      }

      const st = statsById[rId];
      if (rTime.length >= 10) {
        st.daysSet[rTime.slice(0, 10)] = true;
      }

      if (rAudit.indexOf("🚨") !== -1 || rAudit.indexOf("⚠️") !== -1) {
        st.alertsCount++;
        totalAlertasMes++;
      }

      const tMs = parsearFechaLocalMs_(rTime);

      if (rType === "ENTRADA") {
        st.entradas++;
        totalEntradasMes++;
        st.openInMs = Number.isFinite(tMs) ? tMs : null;
        st.openInTimeStr = rTime;
        st.lastType = "ENTRADA";
        st.lastTime = rTime;
      } else if (rType === "SALIDA") {
        st.salidas++;
        totalSalidasMes++;
        if (st.openInMs !== null && Number.isFinite(tMs) && tMs >= st.openInMs) {
          const diffMin = Math.round((tMs - st.openInMs) / 60000);
          if (diffMin <= 24 * 60) {
            st.totalMinutes += diffMin;
            st.closedShifts++;
          }
          st.openInMs = null;
          st.openInTimeStr = "";
        }
        st.lastType = "SALIDA";
        st.lastTime = rTime;
      }
    }
  }

  let activosCount = 0;
  let pendientesBajasCount = 0;
  let totalTurnosCerrados = 0;
  let totalMinutosEquipo = 0;
  let enTurnoAhoraCount = 0;

  const workerTableRows = [];
  for (let i = 0; i < workerOrder.length; i++) {
    const fid = workerOrder[i];
    const st = statsById[fid];
    if (st.accountStatus === "activo") {
      activosCount++;
    } else {
      pendientesBajasCount++;
    }

    totalTurnosCerrados += st.closedShifts;
    totalMinutosEquipo += st.totalMinutes;

    const daysCount = Object.keys(st.daysSet).length;
    const avgMinutes = st.closedShifts > 0 ? Math.round(st.totalMinutes / st.closedShifts) : 0;
    const alertLabel = st.alertsCount > 0 ? ("⚠️ " + st.alertsCount + " alerta(s)") : "✅ 0 alertas";

    let currentStatusText = "⚪ Sin registros en el mes";
    if (st.lastType === "ENTRADA") {
      enTurnoAhoraCount++;
      currentStatusText = "🟢 En turno (Entrada " + st.lastTime.slice(5, 16) + ")";
    } else if (st.lastType === "SALIDA") {
      currentStatusText = "🔵 Fuera de turno (Salida " + st.lastTime.slice(5, 16) + ")";
    }

    workerTableRows.push([
      st.formattedId,
      st.workerName,
      st.accountStatusLabel,
      daysCount,
      st.entradas,
      st.salidas,
      st.closedShifts,
      formatearMinutosAHorasTexto_(st.totalMinutes),
      formatearMinutosAHorasTexto_(avgMinutes),
      alertLabel,
      currentStatusText
    ]);
  }

  summarySheet.clear();
  try {
    summarySheet.setTabColor("#7C3AED");
  } catch (_) {}

  // Fila 1: Banner de título ejecutivo
  const bannerRow = new Array(11).fill("");
  bannerRow[0] = "📊 RESUMEN EJECUTIVO Y KPIs DE ASISTENCIA · " + monthName.toUpperCase();
  bannerRow[9] = "Actualizado:";
  bannerRow[10] = localTime;

  // Fila 2: Encabezados de KPIs globales del mes
  const kpiHeaders = [
    "Trabajadores Activos",
    "Pendientes / Bajas",
    "Total Entradas (Mes)",
    "Total Salidas (Mes)",
    "Turnos Cerrados",
    "Horas Totales Equipo",
    "En Turno Ahora",
    "Alertas Celular / GPS",
    "Mes Auditado",
    "Última Marca",
    "Estado del Sello HMAC"
  ];

  // Fila 3: Valores de KPIs globales del mes
  const kpiValues = [
    activosCount,
    pendientesBajasCount,
    totalEntradasMes,
    totalSalidasMes,
    totalTurnosCerrados,
    formatearMinutosAHorasTexto_(totalMinutosEquipo),
    enTurnoAhoraCount,
    totalAlertasMes,
    monthName,
    localTime,
    "🔒 Protegido"
  ];

  const topMatrix = [
    bannerRow,
    kpiHeaders,
    kpiValues,
    CRONOS_SUMMARY_TABLE_HEADERS
  ];

  summarySheet.getRange(1, 1, 4, 11).setNumberFormat("@");
  summarySheet.getRange(1, 1, 4, 11).setValues(topMatrix);

  // Estilo de Banner (Fila 1) y Tarjetas KPI (Filas 2 y 3)
  summarySheet.getRange(1, 1, 1, 11)
    .setBackground("#1E1B4B")
    .setFontColor("#FFFFFF")
    .setFontFamily("Arial")
    .setFontSize(11)
    .setFontWeight("bold")
    .setVerticalAlignment("middle");
  summarySheet.setRowHeight(1, 38);

  summarySheet.getRange(2, 1, 1, 11)
    .setBackground("#F1F5F9")
    .setFontColor("#475569")
    .setFontFamily("Arial")
    .setFontSize(9)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  summarySheet.setRowHeight(2, 28);

  summarySheet.getRange(3, 1, 1, 11)
    .setBackground("#EEF2FF")
    .setFontColor("#1E1B4B")
    .setFontFamily("Arial")
    .setFontSize(11)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  summarySheet.setRowHeight(3, 36);

  // Fila 4: Encabezado de tabla por trabajador
  summarySheet.getRange(4, 1, 1, 11)
    .setBackground("#0F172A")
    .setFontColor("#FFFFFF")
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
  summarySheet.setRowHeight(4, 40);
  summarySheet.setFrozenRows(4);

  for (let c = 0; c < CRONOS_SUMMARY_COL_WIDTHS.length; c++) {
    summarySheet.setColumnWidth(c + 1, CRONOS_SUMMARY_COL_WIDTHS[c]);
  }

  if (workerTableRows.length > 0) {
    const dataRange = summarySheet.getRange(5, 1, workerTableRows.length, 11);
    dataRange.setNumberFormat("@");
    dataRange.setValues(workerTableRows);

    for (let i = 0; i < workerTableRows.length; i++) {
      const rIdx = i + 5;
      summarySheet.setRowHeight(rIdx, 34);
      const bg = i % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
      summarySheet.getRange(rIdx, 1, 1, 11)
        .setBackground(bg)
        .setFontFamily("Arial")
        .setFontSize(10)
        .setFontColor("#0F172A")
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle")
        .setBorder(false, false, true, false, false, false, "#E2E8F0", SpreadsheetApp.BorderStyle.SOLID);

      summarySheet.getRange(rIdx, 1).setFontFamily("Roboto Mono").setFontWeight("bold").setFontColor("#1E3A8A");
      summarySheet.getRange(rIdx, 2).setHorizontalAlignment("left").setFontWeight("bold");
      summarySheet.getRange(rIdx, 8).setBackground("#ECFDF5").setFontColor("#065F46").setFontWeight("bold");
    }
  }
}

/* ============================================================================
   Funciones Internas (Gestión Mensual, Diseño Visual y Criptografía HMAC)
   ============================================================================ */

function resolverInfoMesDesdeFechaLocal_(localTimeStr) {
  const anio = localTimeStr.slice(0, 4);
  const mesStr = localTimeStr.slice(5, 7);
  const mesIdx = parseInt(mesStr, 10) - 1;
  const nombreMes = CRONOS_MESES_ES[mesIdx] || ("Mes " + mesStr);
  return {
    nombreHoja: nombreMes + " " + anio,
    ymCodigo: anio + mesStr
  };
}

function parsearYmDesdeNombreHoja_(sheetName) {
  const m = String(sheetName || "").trim().match(/^([A-Za-záéíóúÁÉÍÓÚ]+)\s+(\d{4})$/);
  if (!m) return null;
  const nombreLower = m[1].toLowerCase();
  for (let i = 0; i < CRONOS_MESES_ES.length; i++) {
    if (CRONOS_MESES_ES[i].toLowerCase() === nombreLower) {
      return m[2] + String(i + 1).padStart(2, "0");
    }
  }
  return null;
}

function esHojaCronos_(sheet) {
  if (!sheet || esHojaTrabajadoresCronos_(sheet) || esHojaResumenCronos_(sheet) || sheet.getLastRow() < 1) return false;
  const lastCol = sheet.getLastColumn();
  if (lastCol >= 11 && String(sheet.getRange(1, 11).getValue() || "") === CRONOS_HEADERS[10]) {
    return true;
  }
  if (lastCol >= 9 && String(sheet.getRange(1, 9).getValue() || "") === CRONOS_HEADERS[10]) {
    return true;
  }
  return false;
}

function obtenerPrimeraHojaCronos_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (esHojaCronos_(sheets[i])) return sheets[i];
  }
  return sheets[0];
}

function migrarHoja9a11Columnas_(sheet) {
  if (sheet.getLastColumn() >= 11 && String(sheet.getRange(1, 11).getValue() || "") === CRONOS_HEADERS[10]) {
    return;
  }
  if (sheet.getLastColumn() < 9 || String(sheet.getRange(1, 9).getValue() || "") !== CRONOS_HEADERS[10]) {
    return;
  }

  const lastRow = sheet.getLastRow();
  const ymHoja = parsearYmDesdeNombreHoja_(sheet.getName()) || "";
  const secret = obtenerSecretoHmac_();
  const props = PropertiesService.getScriptProperties();
  const headKey = obtenerClaveCabezaCadena_(sheet.getParent ? sheet.getParent() : SpreadsheetApp.getActiveSpreadsheet(), sheet);

  const oldRows = [];
  const oldLinks = [];

  if (lastRow >= 2) {
    const numRows = lastRow - 1;
    const vals = sheet.getRange(2, 1, numRows, 9).getValues();
    const disp = sheet.getRange(2, 1, numRows, 9).getDisplayValues();
    const rich = sheet.getRange(2, 4, numRows, 1).getRichTextValues();
    for (let i = 0; i < numRows; i++) {
      const linkUrl = (rich[i] && rich[i][0] && rich[i][0].getLinkUrl()) || ("https://www.google.com/maps?q=" + String(vals[i][5] || ""));
      oldLinks.push(linkUrl);
      oldRows.push({
        localTime: String(disp[i][0] || "").trim(),
        workerName: String(vals[i][1] || "").trim(),
        type: String(vals[i][2] || "").trim(),
        accuracy: Math.round(Number(vals[i][4]) || 0),
        coords: String(vals[i][5] || "").trim(),
        timeZone: String(vals[i][6] || "").trim(),
        utcTime: String(vals[i][7] || "").trim()
      });
    }
  }

  sheet.clear();
  sheet.getRange(1, 1, 1, 11).setValues([CRONOS_HEADERS]);
  aplicarFormatoBaseHoja_(sheet, "#10B981");

  let prevSeal = ymHoja ? ("GENESIS-" + ymHoja) : "GENESIS";
  for (let i = 0; i < oldRows.length; i++) {
    const r = oldRows[i];
    const seq = i + 1;
    const rowIdx = i + 2;
    const formattedWorkerId = "REG-PREVIO";
    const deviceAudit = "✅ Registro previo";
    const mapsUrl = oldLinks[i];

    const seal = calcularSelloFila_(
      ymHoja,
      seq,
      prevSeal,
      {
        localTime: r.localTime,
        formattedWorkerId: formattedWorkerId,
        workerName: r.workerName,
        type: r.type,
        deviceAudit: deviceAudit,
        mapsUrl: mapsUrl,
        accuracy: r.accuracy,
        coords: r.coords,
        timeZone: r.timeZone,
        utcTime: r.utcTime
      },
      secret
    );
    prevSeal = seal;

    sheet.getRange(rowIdx, 1, 1, 6).setNumberFormat("@");
    sheet.getRange(rowIdx, 7).setNumberFormat('0" m"');
    sheet.getRange(rowIdx, 8, 1, 4).setNumberFormat("@");

    sheet.getRange(rowIdx, 1, 1, 11).setValues([[
      r.localTime,
      formattedWorkerId,
      r.workerName,
      r.type,
      deviceAudit,
      "📍 Abrir en Maps",
      r.accuracy,
      r.coords,
      r.timeZone,
      r.utcTime,
      "🔒 " + seal
    ]]);

    const mapRichText = SpreadsheetApp.newRichTextValue()
      .setText("📍 Abrir en Maps")
      .setLinkUrl(mapsUrl)
      .build();
    sheet.getRange(rowIdx, 6).setRichTextValue(mapRichText);
    estilizarFilaRegistro_(sheet, rowIdx, "primary", "");
  }

  if (oldRows.length > 0) {
    props.setProperty(
      headKey,
      JSON.stringify({ ym: ymHoja, sheetName: sheet.getName(), count: oldRows.length, lastSeal: prevSeal })
    );
  } else {
    props.deleteProperty(headKey);
  }
}

function limpiarHojasPorDefectoVacias_(spreadsheet) {
  try {
    const sheets = spreadsheet.getSheets();
    if (sheets.length <= 1) return;
    for (let i = sheets.length - 1; i >= 0; i--) {
      const s = sheets[i];
      const name = String(s.getName() || "").trim();
      if (
        s.getLastRow() === 0 &&
        /^(Hoja\s*\d+|Sheet\s*\d+|Página\s*\d+)$/i.test(name) &&
        spreadsheet.getSheets().length > 1
      ) {
        spreadsheet.deleteSheet(s);
      }
    }
  } catch (_) {}
}

function obtenerHojaMensualCronos_(spreadsheet, nombreMesHoja) {
  let sheet = spreadsheet.getSheetByName(nombreMesHoja);

  if (!sheet) {
    const allSheets = spreadsheet.getSheets();

    for (let i = 0; i < allSheets.length; i++) {
      if (esHojaCronos_(allSheets[i])) {
        try {
          allSheets[i].setTabColor("#64748B");
        } catch (_) {}
      }
    }

    // Buscar cualquier pestaña vacía por defecto (ej. "Hoja 1" o "Sheet1") para reutilizarla
    // incluso si la pestaña "Trabajadores" ya fue creada previamente
    let reusableEmptySheet = null;
    for (let i = 0; i < allSheets.length; i++) {
      const candidate = allSheets[i];
      if (
        candidate.getLastRow() === 0 &&
        !esHojaTrabajadoresCronos_(candidate) &&
        !esHojaResumenCronos_(candidate) &&
        !esHojaCronos_(candidate)
      ) {
        reusableEmptySheet = candidate;
        break;
      }
    }

    if (reusableEmptySheet) {
      sheet = reusableEmptySheet;
      try {
        sheet.setName(nombreMesHoja);
      } catch (_) {}
    } else {
      sheet = spreadsheet.insertSheet(nombreMesHoja, 0);
    }

    inicializarHojaCronos_(sheet, spreadsheet);
    limpiarHojasPorDefectoVacias_(spreadsheet);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    inicializarHojaCronos_(sheet, spreadsheet);
  } else {
    if (sheet.getLastColumn() === 9 && String(sheet.getRange(1, 9).getValue() || "") === CRONOS_HEADERS[10]) {
      migrarHoja9a11Columnas_(sheet);
    }
    if (sheet.getLastRow() === 1) {
      PropertiesService.getScriptProperties().deleteProperty(obtenerClaveCabezaCadena_(spreadsheet, sheet));
    }
  }

  limpiarHojasPorDefectoVacias_(spreadsheet);
  return sheet;
}

function inicializarHojaCronos_(sheet, spreadsheet) {
  sheet.clear();
  if (spreadsheet) {
    PropertiesService.getScriptProperties().deleteProperty(obtenerClaveCabezaCadena_(spreadsheet, sheet));
  }

  const headerRange = sheet.getRange(1, 1, 1, 11);
  headerRange.setValues([CRONOS_HEADERS]);

  aplicarFormatoBaseHoja_(sheet, "#10B981");
}

function aplicarFormatoBaseHoja_(sheet, tabColorHex) {
  try {
    sheet.setTabColor(tabColorHex || "#10B981");
  } catch (_) {}

  const headerRange = sheet.getRange(1, 1, 1, 11);
  headerRange
    .setBackground("#0F172A")
    .setFontColor("#FFFFFF")
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);

  sheet.getRange(1, 3).setHorizontalAlignment("left");
  sheet.setRowHeight(1, 42);
  sheet.setFrozenRows(1);

  for (let i = 0; i < CRONOS_COL_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, CRONOS_COL_WIDTHS[i]);
  }

  if (!sheet.getFilter()) {
    try {
      sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 11).createFilter();
    } catch (_) {}
  }

  const maxRows = Math.max(sheet.getMaxRows() - 1, 500);
  const typeRange = sheet.getRange(2, 4, maxRows, 1);

  const ruleEntrada = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("ENTRADA")
    .setBackground("#D1FAE5")
    .setFontColor("#065F46")
    .setBold(true)
    .setRanges([typeRange])
    .build();

  const ruleSalida = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("SALIDA")
    .setBackground("#DBEAFE")
    .setFontColor("#1E40AF")
    .setBold(true)
    .setRanges([typeRange])
    .build();

  const rulePrueba = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("PRUEBA")
    .setBackground("#FEF3C7")
    .setFontColor("#92400E")
    .setBold(true)
    .setRanges([typeRange])
    .build();

  sheet.setConditionalFormatRules([ruleEntrada, ruleSalida, rulePrueba]);
}

function estilizarFilaRegistro_(sheet, rowIndex, deviceLevel, deviceNote) {
  sheet.setRowHeight(rowIndex, 34);

  const rowBg = rowIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
  const rowRange = sheet.getRange(rowIndex, 1, 1, 11);

  rowRange
    .setBackground(rowBg)
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontColor("#0F172A")
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("center")
    .setBorder(false, false, true, false, false, false, "#E2E8F0", SpreadsheetApp.BorderStyle.SOLID);

  // Col B: ID Trabajador (8 dígitos)
  sheet.getRange(rowIndex, 2)
    .setFontFamily("Roboto Mono")
    .setFontSize(9)
    .setFontWeight("bold")
    .setFontColor("#1E3A8A");

  // Col C: Nombre del trabajador (congelado)
  sheet.getRange(rowIndex, 3)
    .setHorizontalAlignment("left")
    .setFontWeight("bold");

  // Col E: Dispositivo / Auditoría
  const devCell = sheet.getRange(rowIndex, 5);
  devCell.setFontFamily("Arial").setFontSize(9).setFontWeight("bold");
  if (deviceLevel === "shared") {
    devCell.setBackground("#FEE2E2").setFontColor("#991B1B");
  } else if (deviceLevel === "secondary") {
    devCell.setBackground("#FEF3C7").setFontColor("#92400E");
  } else if (deviceLevel === "test") {
    devCell.setBackground("#F1F5F9").setFontColor("#475569");
  } else {
    devCell.setBackground("#ECFDF5").setFontColor("#065F46");
  }

  if (deviceNote) {
    devCell.setNote(deviceNote);
  } else {
    devCell.clearNote();
  }

  // Col F: Mapa
  sheet.getRange(rowIndex, 6)
    .setFontColor("#1D4ED8")
    .setFontWeight("bold");

  // Col H, I, J: Coordenadas, Zona Horaria, Timestamp UTC
  sheet.getRange(rowIndex, 8).setFontFamily("Roboto Mono").setFontSize(9).setFontColor("#475569");
  sheet.getRange(rowIndex, 9).setFontSize(9).setFontColor("#475569");
  sheet.getRange(rowIndex, 10).setFontFamily("Roboto Mono").setFontSize(9).setFontColor("#64748B");

  // Col K: Sello Criptográfico (HMAC)
  sheet.getRange(rowIndex, 11)
    .setBackground("#ECFDF5")
    .setFontColor("#065F46")
    .setFontFamily("Roboto Mono")
    .setFontSize(9)
    .setFontWeight("bold")
    .clearNote();
}

function obtenerSecretoHmac_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("CRONOS_HMAC_SECRET");
  if (!secret) {
    secret = Utilities.getUuid() + "-" + Utilities.getUuid() + "-" + new Date().getTime();
    props.setProperty("CRONOS_HMAC_SECRET", secret);
  }
  return secret;
}

function extraerCodigoSello_(rawCell) {
  return String(rawCell || "")
    .replace(/^🔒\s*/, "")
    .replace(/^⚠️\s*/, "")
    .trim();
}

function calcularSelloFila_(ymCodigo, seq, prevSeal, campos, secret) {
  const seqPad = String(seq).padStart(4, "0");
  const partes = ymCodigo ? [ymCodigo, seqPad] : [seqPad];
  const canonical = partes.concat([
    prevSeal,
    campos.localTime,
    campos.formattedWorkerId || "",
    campos.workerName,
    campos.type,
    campos.deviceAudit || "",
    campos.mapsUrl,
    String(campos.accuracy),
    campos.coords,
    campos.timeZone,
    campos.utcTime
  ]).join("|");

  const sigBytes = Utilities.computeHmacSha256Signature(
    canonical,
    secret,
    Utilities.Charset.UTF_8
  );

  const hex = sigBytes
    .map(function (b) {
      const v = b < 0 ? b + 256 : b;
      return (v < 16 ? "0" : "") + v.toString(16);
    })
    .join("")
    .slice(0, 16);

  return ymCodigo
    ? ("CRN-" + ymCodigo + "-" + seqPad + "-" + hex)
    : ("CRN-" + seqPad + "-" + hex);
}

function auditarFilasInterno_(sheet, checkDeletedTail) {
  if (sheet.getLastColumn() === 9 && String(sheet.getRange(1, 9).getValue() || "") === CRONOS_HEADERS[10]) {
    migrarHoja9a11Columnas_(sheet);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, total: 0, errores: [] };

  const numRows = lastRow - 1;
  const dataRange = sheet.getRange(2, 1, numRows, 11);
  const values = dataRange.getValues();
  const displayValues = dataRange.getDisplayValues();
  const richValues = sheet.getRange(2, 6, numRows, 1).getRichTextValues();

  const ymHoja = parsearYmDesdeNombreHoja_(sheet.getName());
  const secret = obtenerSecretoHmac_();
  const errores = [];

  let prevSeal = ymHoja ? ("GENESIS-" + ymHoja) : "GENESIS";

  for (let i = 0; i < numRows; i++) {
    const sheetRow = i + 2;
    const seq = i + 1;
    const localTime = String(displayValues[i][0] || "").trim();
    const formattedWorkerId = String(values[i][1] || "").trim();
    const workerName = String(values[i][2] || "").trim();
    const type = String(values[i][3] || "").trim();
    const deviceAudit = String(values[i][4] || "").trim();
    const richLink = richValues[i][0] ? richValues[i][0].getLinkUrl() : null;
    const mapsUrl = richLink || String(values[i][5] || "").trim();
    const accuracy = values[i][6];
    const coords = String(values[i][7] || "").trim();
    const timeZone = String(values[i][8] || "").trim();
    const utcTime = String(values[i][9] || "").trim();
    const storedSeal = extraerCodigoSello_(values[i][10]);

    let ymEsperado = ymHoja;
    if (!ymEsperado) {
      const mSeal = storedSeal.match(/^CRN-(\d{6})-\d{4}-[0-9a-f]{16}$/);
      ymEsperado = mSeal ? mSeal[1] : "";
      if (i === 0 && ymEsperado) {
        prevSeal = "GENESIS-" + ymEsperado;
      }
    }

    const rowYm = localTime.length >= 7 ? (localTime.slice(0, 4) + localTime.slice(5, 7)) : "";
    const mesCoincide = !ymHoja || (rowYm === ymHoja);

    const expectedSeal = calcularSelloFila_(
      ymEsperado,
      seq,
      prevSeal,
      {
        localTime: localTime,
        formattedWorkerId: formattedWorkerId,
        workerName: workerName,
        type: type,
        deviceAudit: deviceAudit,
        mapsUrl: mapsUrl,
        accuracy: accuracy,
        coords: coords,
        timeZone: timeZone,
        utcTime: utcTime
      },
      secret
    );

    const sealCell = sheet.getRange(sheetRow, 11);
    if (!storedSeal || !mesCoincide || storedSeal !== expectedSeal) {
      const motivo = !mesCoincide
        ? "La fecha de la fila no pertenece al mes de esta pestaña (" + sheet.getName() + ")."
        : "Sello inválido o fila editada manualmente.";
      errores.push("• Fila " + sheetRow + " (" + (workerName || "Sin nombre") + "): " + motivo);
      sealCell
        .setBackground("#FEE2E2")
        .setFontColor("#991B1B")
        .setFontWeight("bold")
        .setNote("⚠️ ALERTA CRONOS: " + motivo + " El sello HMAC-SHA256 no coincide con el registro original del servidor.");
    } else {
      sealCell
        .setBackground("#ECFDF5")
        .setFontColor("#065F46")
        .setFontWeight("bold")
        .clearNote();
    }

    prevSeal = storedSeal || "SIN_SELLO";
  }

  if (checkDeletedTail) {
    const props = PropertiesService.getScriptProperties();
    const ss = sheet.getParent ? sheet.getParent() : SpreadsheetApp.getActiveSpreadsheet();
    const headRaw = props.getProperty(obtenerClaveCabezaCadena_(ss, sheet));
    if (headRaw) {
      try {
        const head = JSON.parse(headRaw);
        if (head.count > numRows) {
          errores.push(
            "• Faltan filas al final de \"" + sheet.getName() + "\": se habían registrado " + head.count +
            " asistencias pero la hoja solo tiene " + numRows + " (posible borrado manual)."
          );
        } else if (head.count === numRows && head.lastSeal !== prevSeal) {
          errores.push("• El último sello de \"" + sheet.getName() + "\" no coincide con el último registro oficial guardado por el servidor.");
        }
      } catch (_) {}
    }
  }

  return {
    ok: errores.length === 0,
    total: numRows,
    errores: errores
  };
}
