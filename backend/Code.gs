/**
 * ============================================================================
 * CRONOS · Conector Serverless para Google Sheets
 * - Creación automática de pestaña por mes ("Octubre 2026", "Noviembre 2026"...)
 *   colocando siempre el mes en curso como primera pestaña a la izquierda
 * - Pestaña automática "Trabajadores" con ID numérico de 8 dígitos, nombre
 *   congelado (sin variaciones) e historial numerado de celulares por empleado
 * - Perfil de Administrador con creación de nuevos archivos de Google Sheets en
 *   1 clic (con opción de migrar la tabla de Trabajadores al nuevo archivo)
 * - Diseño ejecutivo automático desde el primer registro (columnas, colores, links)
 * - Sello criptográfico encadenado por mes (HMAC-SHA256) contra ediciones manuales
 * - Detección en tiempo real (onEdit) y auditoría por hoja o global desde menú "Cronos"
 * ============================================================================
 */

const CRONOS_LEGACY_SHEET_NAME = "Registros de Asistencia";
const CRONOS_WORKERS_SHEET_NAME = "Trabajadores";

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
  255, // E: Dispositivo / Auditoría
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
  "Último Registro"
];

const CRONOS_WORKERS_COL_WIDTHS = [
  165, // A: ID de Acceso
  230, // B: Nombre Completo (Congelado)
  225, // C: Estado de Dispositivos
  235, // D: Celular Titular
  340, // E: Historial de Celulares Usados
  165, // F: Fecha de Alta
  205  // G: Último Registro
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
    .addItem("🎨 Reaplicar diseño visual a esta pestaña", "reaplicarDisenoCronos")
    .addToUi();
}

/**
 * Webhook principal que recibe registros de asistencia, inicios de sesión por ID
 * y comandos del Perfil de Administrador (creación de nuevas hojas en 1 clic).
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

    // 1. Flujo de Perfil de Administrador: Autenticación y listado de hojas
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

    // 3. Flujo de inicio de sesión por ID numérico de 8 dígitos ("Cambiar sesión")
    if (action === "login_worker") {
      const loginRes = iniciarSesionPorIdTrabajador_(spreadsheet, data, localTime);
      loginRes.localTime = localTime;
      loginRes.utcTime = utcTime;
      loginRes.timeZone = sheetTimeZone;
      return ContentService.createTextOutput(JSON.stringify(loginRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 4. Flujo de alta / sincronización de trabajador en la pestaña "Trabajadores"
    if (action === "register_worker") {
      const regRes = sincronizarTrabajadorYDispositivo_(spreadsheet, data, localTime, "ALTA");
      return ContentService.createTextOutput(JSON.stringify({
        status: "ok",
        action: "register_worker",
        workerId: regRes.workerId,
        formattedWorkerId: regRes.formattedWorkerId,
        workerName: regRes.workerName,
        deviceAudit: regRes.deviceAudit,
        deviceLevel: regRes.deviceLevel,
        localTime: localTime,
        utcTime: utcTime,
        timeZone: sheetTimeZone
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. Flujo de registro de asistencia (ENTRADA / SALIDA / PRUEBA)
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
      workerId = syncInfo.workerId;
      formattedWorkerId = syncInfo.formattedWorkerId;
      workerName = syncInfo.workerName; // Nombre oficial congelado desde pestaña "Trabajadores"
      deviceAudit = syncInfo.deviceAudit;
      deviceLevel = syncInfo.deviceLevel;
      deviceNote = syncInfo.deviceNote || "";
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

    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      localTime: localTime,
      utcTime: utcTime,
      timeZone: sheetTimeZone,
      sheetName: infoMes.nombreHoja,
      sheetId: obtenerIdSpreadsheetSeguro_(spreadsheet),
      workerId: workerId,
      formattedWorkerId: formattedWorkerId,
      workerName: workerName,
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
   Perfil de Administrador: Autenticación y Creación de Nuevas Hojas en 1 Clic
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

function gestionarAutenticacionAdmin_(data, localTime) {
  const props = PropertiesService.getScriptProperties();
  const secret = obtenerSecretoHmac_();
  const inputPin = String(data.adminPin || "").trim();
  const inputOrgName = String(data.orgName || "").trim();

  let profile = null;
  try {
    const rawProfile = props.getProperty("CRONOS_ADMIN_PROFILE");
    if (rawProfile) profile = JSON.parse(rawProfile);
  } catch (_) {
    profile = null;
  }

  // Si aún no existe perfil de Admin con PIN y enviaron un PIN nuevo -> registrarlo
  if (!profile || !profile.pinHash) {
    if (inputPin) {
      if (inputPin.length < 4) {
        return {
          status: "error",
          message: "El PIN o contraseña de administrador debe tener al menos 4 caracteres."
        };
      }
      profile = {
        pinHash: calcularHashPinAdmin_(inputPin, secret),
        createdAt: localTime
      };
      props.setProperty("CRONOS_ADMIN_PROFILE", JSON.stringify(profile));
    }
    const sheets = obtenerCatalogoHojasAdmin_(inputOrgName, localTime);
    return {
      status: "ok",
      action: "admin_auth",
      mode: inputPin ? "profile_created" : "unlocked",
      hasPin: !!(profile && profile.pinHash),
      sheets: sheets
    };
  }

  // Si ya tiene PIN configurado, validarlo
  if (!inputPin || calcularHashPinAdmin_(inputPin, secret) !== profile.pinHash) {
    return {
      status: "auth_error",
      hasPin: true,
      message: "PIN o contraseña de administrador incorrecta."
    };
  }

  const sheets = obtenerCatalogoHojasAdmin_(inputOrgName, localTime);
  return {
    status: "ok",
    action: "admin_auth",
    mode: "logged_in",
    hasPin: true,
    sheets: sheets
  };
}

/**
 * Crea un nuevo archivo de Google Sheets en el Drive del administrador en 1 clic,
 * inicializando la pestaña del mes actual y la pestaña "Trabajadores"
 * (copiando opcionalmente los trabajadores de la hoja anterior si copyWorkers === true).
 */
function crearNuevaHojaDesdeAdmin_(data, localTime) {
  const props = PropertiesService.getScriptProperties();
  const secret = obtenerSecretoHmac_();
  const inputPin = String(data.adminPin || "").trim();
  const newOrgName = String(data.orgName || "").trim().replace(/\s+/g, " ");
  const copyWorkers = data.copyWorkers === true;
  const sourceSheetId = String(data.sourceSheetId || "").trim();

  if (newOrgName.length < 2) {
    return {
      status: "error",
      message: "Escribe el nombre para la nueva hoja de Google Sheets (ej. Asistencia Limpieza 2027)."
    };
  }

  // Verificar PIN si el perfil de Admin tiene uno configurado
  let profile = null;
  try {
    const rawProfile = props.getProperty("CRONOS_ADMIN_PROFILE");
    if (rawProfile) profile = JSON.parse(rawProfile);
  } catch (_) {}

  if (profile && profile.pinHash) {
    if (!inputPin || calcularHashPinAdmin_(inputPin, secret) !== profile.pinHash) {
      return {
        status: "auth_error",
        message: "PIN o contraseña de administrador incorrecta para crear una nueva hoja."
      };
    }
  } else if (inputPin && inputPin.length >= 4) {
    profile = {
      pinHash: calcularHashPinAdmin_(inputPin, secret),
      createdAt: localTime
    };
    props.setProperty("CRONOS_ADMIN_PROFILE", JSON.stringify(profile));
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

  // 3. Si el administrador marcó la opción, copiar los trabajadores (IDs de 8 dígitos, nombres congelados y celulares)
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
      const numWorkers = sourceWorkersSheet.getLastRow() - 1;
      const workerRows = sourceWorkersSheet.getRange(2, 1, numWorkers, 7).getValues();
      if (workerRows.length > 0) {
        const targetRange = newWorkersSheet.getRange(2, 1, workerRows.length, 7);
        targetRange.setNumberFormat("@");
        targetRange.setValues(workerRows);
        for (let i = 0; i < workerRows.length; i++) {
          const rIdx = i + 2;
          const stText = String(workerRows[i][2] || "");
          const lvl = stText.indexOf("🚨") !== -1 ? "shared" : (stText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
          estilizarFilaTrabajador_(newWorkersSheet, rIdx, lvl);
        }
        workersCopiedCount = workerRows.length;
      }
    }
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
    createdAt: localTime
  };
  sheets.push(newEntry);
  props.setProperty("CRONOS_ADMIN_SHEETS", JSON.stringify(sheets));

  return {
    status: "ok",
    action: "admin_create_sheet",
    newSheet: newEntry,
    sheets: sheets
  };
}

/**
 * Trigger automático: se dispara SOLO cuando un humano edita celdas manualmente
 * en Google Sheets (nunca cuando escribe el webhook doPost).
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
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
 * Reaplica anchos, alturas y diseño visual a la pestaña activa (sea mensual o de Trabajadores).
 */
function reaplicarDisenoCronos() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();

  if (esHojaTrabajadoresCronos_(sheet)) {
    aplicarFormatoBaseTrabajadores_(sheet);
    const lastW = sheet.getLastRow();
    for (let r = 2; r <= lastW; r++) {
      const statusText = String(sheet.getRange(r, 3).getValue() || "");
      const lvl = statusText.indexOf("🚨") !== -1 ? "shared" : (statusText.indexOf("⚠️") !== -1 ? "secondary" : "primary");
      estilizarFilaTrabajador_(sheet, r, lvl);
    }
    spreadsheet.toast('Diseño visual reaplicado en "Trabajadores".', "🎨 Cronos", 4);
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
   Directorio Automático de Trabajadores (ID de 8 dígitos + Serie de Celular)
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

function generarIdTrabajadorUnico_(usedIdsMap) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const first = Math.floor(1 + Math.random() * 9);
    const rest = Math.floor(Math.random() * 10000000);
    const candidate = String(first) + String(rest).padStart(7, "0");
    if (!usedIdsMap[candidate]) return candidate;
  }
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function extraerDeviceIdLimpio_(rawDeviceId) {
  const clean = String(rawDeviceId || "").trim().replace(/[^A-Za-z0-9\-_]/g, "").slice(0, 32);
  return clean || "CEL-DESCONOCIDO";
}

function extraerPrimerDeviceIdDeTexto_(cellText) {
  const m = String(cellText || "").match(/(CEL-[A-Za-z0-9\-_]+)/);
  return m ? m[1] : String(cellText || "").trim().split(/\s+/)[0] || "";
}

function esHojaTrabajadoresCronos_(sheet) {
  if (!sheet) return false;
  if (sheet.getName() === CRONOS_WORKERS_SHEET_NAME) return true;
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 5) {
    return String(sheet.getRange(1, 1).getValue() || "") === CRONOS_WORKERS_HEADERS[0];
  }
  return false;
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
  }
  return sheet;
}

function inicializarHojaTrabajadores_(sheet) {
  sheet.clear();
  const headerRange = sheet.getRange(1, 1, 1, 7);
  headerRange.setValues([CRONOS_WORKERS_HEADERS]);
  aplicarFormatoBaseTrabajadores_(sheet);
}

function aplicarFormatoBaseTrabajadores_(sheet) {
  try {
    sheet.setTabColor("#2563EB");
  } catch (_) {}

  const headerRange = sheet.getRange(1, 1, 1, 7);
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
      sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 7).createFilter();
    } catch (_) {}
  }
}

function estilizarFilaTrabajador_(sheet, rowIndex, level) {
  sheet.setRowHeight(rowIndex, 38);
  const rowBg = rowIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
  const rowRange = sheet.getRange(rowIndex, 1, 1, 7);

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
}

/**
 * Lee el directorio actual de la pestaña "Trabajadores".
 */
function leerDirectorioTrabajadores_(workersSheet) {
  const lastRow = workersSheet.getLastRow();
  const byId = {};
  const primaryDeviceOwner = {}; // deviceId -> { workerId, workerName }
  const rows = [];

  if (lastRow < 2) {
    return { byId: byId, primaryDeviceOwner: primaryDeviceOwner, rows: rows };
  }

  const values = workersSheet.getRange(2, 1, lastRow - 1, 7).getValues();
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

    if (!rawId) continue;

    const record = {
      rowIndex: rIdx,
      workerId: rawId,
      formattedId: formatearIdTrabajador_(rawId),
      workerName: workerName,
      statusText: statusText,
      primaryCell: primaryCell,
      primaryDeviceId: primaryDevId,
      historyText: historyText,
      createdAt: createdAt,
      lastSeen: lastSeen
    };

    byId[rawId] = record;
    rows.push(record);

    if (primaryDevId && !primaryDeviceOwner[primaryDevId]) {
      primaryDeviceOwner[primaryDevId] = {
        workerId: rawId,
        workerName: workerName
      };
    }
  }

  return {
    byId: byId,
    primaryDeviceOwner: primaryDeviceOwner,
    rows: rows
  };
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

  workersSheet.getRange(record.rowIndex, 1, 1, 7).setNumberFormat("@");
  workersSheet.getRange(record.rowIndex, 3).setValue(workerStatusText);
  workersSheet.getRange(record.rowIndex, 5).setValue(updatedHistory);
  workersSheet.getRange(record.rowIndex, 7).setValue(updatedLastSeen);
  estilizarFilaTrabajador_(workersSheet, record.rowIndex, workerRowLevel);

  return {
    workerId: record.workerId,
    formattedWorkerId: record.formattedId,
    workerName: record.workerName, // Nombre congelado
    deviceAudit: deviceAudit,
    deviceLevel: deviceLevel,
    deviceNote: deviceNote
  };
}

/**
 * Busca un ID de 8 dígitos en la pestaña "Trabajadores" para iniciar sesión ("Cambiar sesión")
 * y registra el dispositivo utilizado.
 */
function iniciarSesionPorIdTrabajador_(spreadsheet, data, localTime) {
  const rawId = normalizarIdTrabajador8_(data.workerId);
  if (!rawId) {
    return {
      status: "error",
      message: "El ID de trabajador debe contener exactamente 8 dígitos numéricos."
    };
  }

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

  return {
    status: "ok",
    action: "login_worker",
    workerId: evalRes.workerId,
    formattedWorkerId: evalRes.formattedWorkerId,
    workerName: evalRes.workerName,
    deviceAudit: evalRes.deviceAudit,
    deviceLevel: evalRes.deviceLevel
  };
}

/**
 * Registra o sincroniza al trabajador en la pestaña "Trabajadores", congelando su nombre
 * al primer registro y auditando la serie del celular utilizado.
 */
function sincronizarTrabajadorYDispositivo_(spreadsheet, data, localTime, eventTag) {
  const workersSheet = obtenerHojaTrabajadoresCronos_(spreadsheet);
  const dir = leerDirectorioTrabajadores_(workersSheet);

  let rawId = normalizarIdTrabajador8_(data.workerId);
  const inputName = String(data.workerName || "Sin nombre").trim().replace(/\s+/g, " ");
  const deviceId = extraerDeviceIdLimpio_(data.deviceId);
  const deviceLabel = String(data.deviceLabel || "").trim().slice(0, 40);
  const etiquetaEquipo = deviceLabel ? (deviceId + " (" + deviceLabel + ")") : deviceId;

  // Si enviaron un workerId ya existente en la hoja:
  if (rawId && dir.byId[rawId]) {
    const existing = dir.byId[rawId];
    const samePersonOrDevice =
      existing.workerName.toLowerCase() === inputName.toLowerCase() ||
      existing.primaryDeviceId === deviceId;

    if (eventTag === "ALTA" && !samePersonOrDevice && !data.preserveExistingId) {
      rawId = generarIdTrabajadorUnico_(dir.byId);
    } else {
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

  // Si no tenía workerId (o no estaba en la hoja), revisar si el mismo nombre + mismo celular titular ya existe
  for (let i = 0; i < dir.rows.length; i++) {
    const r = dir.rows[i];
    if (
      r.workerName.toLowerCase() === inputName.toLowerCase() &&
      r.primaryDeviceId === deviceId
    ) {
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
  }

  if (!rawId) {
    rawId = generarIdTrabajadorUnico_(dir.byId);
  }

  const formattedId = formatearIdTrabajador_(rawId);
  const ownerOfDevice = dir.primaryDeviceOwner[deviceId];
  const belongsToOtherWorker = ownerOfDevice && ownerOfDevice.workerName.toLowerCase() !== inputName.toLowerCase();

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
  const rowRange = workersSheet.getRange(nextRow, 1, 1, 7);
  rowRange.setNumberFormat("@");
  rowRange.setValues([[
    formattedId,
    inputName,
    statusText,
    etiquetaEquipo,
    firstHistoryLine,
    localTime,
    localTime + " (" + eventTag + ")"
  ]]);

  estilizarFilaTrabajador_(workersSheet, nextRow, rowLevel);

  return {
    workerId: rawId,
    formattedWorkerId: formattedId,
    workerName: inputName,
    deviceAudit: deviceAudit,
    deviceLevel: rowLevel,
    deviceNote: deviceNote
  };
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
  if (!sheet || esHojaTrabajadoresCronos_(sheet) || sheet.getLastRow() < 1) return false;
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

    if (allSheets.length === 1 && allSheets[0].getLastRow() === 0 && !esHojaTrabajadoresCronos_(allSheets[0])) {
      sheet = allSheets[0];
      try {
        sheet.setName(nombreMesHoja);
      } catch (_) {}
    } else {
      sheet = spreadsheet.insertSheet(nombreMesHoja, 0);
    }

    inicializarHojaCronos_(sheet, spreadsheet);
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
