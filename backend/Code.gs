/**
 * ============================================================================
 * CRONOS · Conector Serverless para Google Sheets
 * - Creación automática de pestaña por mes ("Octubre 2026", "Noviembre 2026"...)
 *   colocando siempre el mes en curso como primera pestaña a la izquierda
 * - Diseño ejecutivo automático desde el primer registro (columnas, colores, links)
 * - Sello criptográfico encadenado por mes (HMAC-SHA256) contra ediciones manuales
 * - Detección en tiempo real (onEdit) y auditoría por hoja o global desde menú "Cronos"
 * ============================================================================
 */

const CRONOS_LEGACY_SHEET_NAME = "Registros de Asistencia";

const CRONOS_MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const CRONOS_HEADERS = [
  "Fecha y Hora (Local)",
  "Trabajador",
  "Tipo de Registro",
  "Mapa (Ubicación)",
  "Precisión GPS",
  "Coordenadas",
  "Zona Horaria",
  "Timestamp (UTC)",
  "Sello Criptográfico (HMAC)"
];

const CRONOS_COL_WIDTHS = [
  175, // A: Fecha y Hora (Local)
  220, // B: Trabajador
  145, // C: Tipo de Registro
  165, // D: Mapa (Ubicación)
  130, // E: Precisión GPS
  195, // F: Coordenadas
  165, // G: Zona Horaria
  205, // H: Timestamp (UTC)
  275  // I: Sello Criptográfico (HMAC)
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
 * Webhook principal que recibe los registros desde la PWA Cronos.
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(12000);

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const data = JSON.parse(e.postData.contents);

    // Hora oficial generada en los servidores de Google (inmune al reloj del celular)
    const now = new Date();
    const utcTime = now.toISOString();
    const sheetTimeZone = spreadsheet.getSpreadsheetTimeZone();
    const localTime = Utilities.formatDate(now, sheetTimeZone, "yyyy-MM-dd HH:mm:ss");

    // Resolver (o crear automáticamente al cambiar de mes) la pestaña del mes actual
    const infoMes = resolverInfoMesDesdeFechaLocal_(localTime);
    const sheet = obtenerHojaMensualCronos_(spreadsheet, infoMes.nombreHoja);

    const secret = obtenerSecretoHmac_();
    const props = PropertiesService.getScriptProperties();
    const headKey = "CRONOS_CHAIN_HEAD_" + sheet.getSheetId();

    const workerName = String(data.workerName || "Sin nombre").trim();
    const type = String(data.type || "REGISTRO").trim().toUpperCase();
    const accuracy = Math.round(Number(data.accuracy) || 0);
    const lat = Number(data.lat || 0);
    const lng = Number(data.lng || 0);
    const coords = lat + "," + lng;
    const mapsUrl = "https://www.google.com/maps?q=" + coords;

    // Determinar secuencia y sello de la fila anterior dentro de la hoja del mes
    const lastRow = sheet.getLastRow();
    let seq = 1;
    let prevSeal = "GENESIS-" + infoMes.ymCodigo;

    if (lastRow >= 2) {
      seq = lastRow; // Fila 2 = registro #1 del mes, Fila 3 = registro #2...
      const prevCellVal = sheet.getRange(lastRow, 9).getValue();
      prevSeal = extraerCodigoSello_(prevCellVal) || "SIN_SELLO";
    }

    const seal = calcularSelloFila_(
      infoMes.ymCodigo,
      seq,
      prevSeal,
      {
        localTime: localTime,
        workerName: workerName,
        type: type,
        mapsUrl: mapsUrl,
        accuracy: accuracy,
        coords: coords,
        timeZone: sheetTimeZone,
        utcTime: utcTime
      },
      secret
    );

    const nextRow = lastRow + 1;
    const rowRange = sheet.getRange(nextRow, 1, 1, 9);

    // Fijar formatos antes de insertar para evitar que Sheets altere textos o fechas
    sheet.getRange(nextRow, 1, 1, 4).setNumberFormat("@");
    sheet.getRange(nextRow, 5).setNumberFormat('0" m"');
    sheet.getRange(nextRow, 6, 1, 4).setNumberFormat("@");

    rowRange.setValues([[
      localTime,
      workerName,
      type,
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
    sheet.getRange(nextRow, 4).setRichTextValue(mapRichText);

    // Aplicar estilo espacioso a la nueva fila
    estilizarFilaRegistro_(sheet, nextRow);

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
      'La pestaña actual ("' + sheet.getName() + '") no es una hoja de registros de Cronos.\n\n' +
      'Selecciona una pestaña mensual (ej. "Octubre 2026") o usa la opción "🗂️ Auditar todos los meses".',
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
 * Reaplica anchos, alturas y diseño visual a la pestaña activa.
 */
function reaplicarDisenoCronos() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  if (!esHojaCronos_(sheet)) {
    spreadsheet.toast("Selecciona primero una pestaña de registros de Cronos.", "🎨 Cronos", 5);
    return;
  }
  const esPrimeraCronos = obtenerPrimeraHojaCronos_(spreadsheet).getSheetId() === sheet.getSheetId();
  aplicarFormatoBaseHoja_(sheet, esPrimeraCronos ? "#10B981" : "#64748B");
  const lastRow = sheet.getLastRow();
  for (let r = 2; r <= lastRow; r++) {
    estilizarFilaRegistro_(sheet, r);
  }
  auditarFilasInterno_(sheet, false);
  spreadsheet.toast('Diseño visual reaplicado en "' + sheet.getName() + '".', "🎨 Cronos", 4);
}

/* ============================================================================
   Funciones Internas (Gestión Mensual, Diseño Visual y Criptografía HMAC)
   ============================================================================ */

/**
 * Extrae el nombre de pestaña mensual (ej. "Octubre 2026") y prefijo "202610"
 * directamente del string localTime ("yyyy-MM-dd HH:mm:ss") ya convertido a la
 * zona horaria oficial configurada en Google Sheets.
 */
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

/**
 * Si el nombre de la pestaña corresponde a un mes (ej. "Noviembre 2026"),
 * devuelve su código "202611"; si es una pestaña legada devuelve null.
 */
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
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 9) return false;
  return String(sheet.getRange(1, 9).getValue() || "") === CRONOS_HEADERS[8];
}

function obtenerPrimeraHojaCronos_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (esHojaCronos_(sheets[i])) return sheets[i];
  }
  return sheets[0];
}

/**
 * Obtiene la pestaña del mes correspondiente (ej. "Noviembre 2026").
 * - Si el archivo es nuevo (1 sola hoja vacía), la renombra directamente al mes actual.
 * - Si cambia el mes (o ya existe "Registros de Asistencia" con datos), conserva
 *   intactas las hojas previas y crea la nueva pestaña mensual en la posición 0
 *   (primera a la izquierda) para que Google Sheets abra directo en el mes en curso.
 */
function obtenerHojaMensualCronos_(spreadsheet, nombreMesHoja) {
  let sheet = spreadsheet.getSheetByName(nombreMesHoja);

  if (!sheet) {
    const allSheets = spreadsheet.getSheets();

    // Atenuar el color de pestañas anteriores de Cronos a gris pizarra (#64748B)
    for (let i = 0; i < allSheets.length; i++) {
      if (esHojaCronos_(allSheets[i])) {
        try {
          allSheets[i].setTabColor("#64748B");
        } catch (_) {}
      }
    }

    if (allSheets.length === 1 && allSheets[0].getLastRow() === 0) {
      sheet = allSheets[0];
      try {
        sheet.setName(nombreMesHoja);
      } catch (_) {}
    } else {
      // Crear nueva pestaña del mes al inicio (posición 0 = primera a la izquierda)
      sheet = spreadsheet.insertSheet(nombreMesHoja, 0);
    }

    inicializarHojaCronos_(sheet);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    inicializarHojaCronos_(sheet);
  } else if (sheet.getLastRow() === 1) {
    // Si el admin borró filas de prueba dejando solo el encabezado, reiniciar cabeza de cadena de este mes
    PropertiesService.getScriptProperties().deleteProperty("CRONOS_CHAIN_HEAD_" + sheet.getSheetId());
  }

  return sheet;
}

function inicializarHojaCronos_(sheet) {
  sheet.clear();
  PropertiesService.getScriptProperties().deleteProperty("CRONOS_CHAIN_HEAD_" + sheet.getSheetId());

  const headerRange = sheet.getRange(1, 1, 1, 9);
  headerRange.setValues([CRONOS_HEADERS]);

  aplicarFormatoBaseHoja_(sheet, "#10B981");
}

function aplicarFormatoBaseHoja_(sheet, tabColorHex) {
  try {
    sheet.setTabColor(tabColorHex || "#10B981");
  } catch (_) {}

  const headerRange = sheet.getRange(1, 1, 1, 9);
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
  sheet.setRowHeight(1, 42);
  sheet.setFrozenRows(1);

  for (let i = 0; i < CRONOS_COL_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, CRONOS_COL_WIDTHS[i]);
  }

  if (!sheet.getFilter()) {
    try {
      sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 9).createFilter();
    } catch (_) {}
  }

  const maxRows = Math.max(sheet.getMaxRows() - 1, 500);
  const typeRange = sheet.getRange(2, 3, maxRows, 1);

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

function estilizarFilaRegistro_(sheet, rowIndex) {
  sheet.setRowHeight(rowIndex, 34);

  const rowBg = rowIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC";
  const rowRange = sheet.getRange(rowIndex, 1, 1, 9);

  rowRange
    .setBackground(rowBg)
    .setFontFamily("Arial")
    .setFontSize(10)
    .setFontColor("#0F172A")
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("center")
    .setBorder(false, false, true, false, false, false, "#E2E8F0", SpreadsheetApp.BorderStyle.SOLID);

  sheet.getRange(rowIndex, 2)
    .setHorizontalAlignment("left")
    .setFontWeight("bold");

  sheet.getRange(rowIndex, 4)
    .setFontColor("#1D4ED8")
    .setFontWeight("bold");

  sheet.getRange(rowIndex, 6).setFontFamily("Roboto Mono").setFontSize(9).setFontColor("#475569");
  sheet.getRange(rowIndex, 7).setFontSize(9).setFontColor("#475569");
  sheet.getRange(rowIndex, 8).setFontFamily("Roboto Mono").setFontSize(9).setFontColor("#64748B");

  sheet.getRange(rowIndex, 9)
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

/**
 * Calcula el sello HMAC-SHA256 encadenado.
 * Si ymCodigo está presente (pestañas mensuales), genera "CRN-YYYYMM-XXXX-<16hex>".
 * Si ymCodigo es vacío (compatibilidad con hoja legada "Registros de Asistencia"), genera "CRN-XXXX-<16hex>".
 */
function calcularSelloFila_(ymCodigo, seq, prevSeal, campos, secret) {
  const seqPad = String(seq).padStart(4, "0");
  const partes = ymCodigo ? [ymCodigo, seqPad] : [seqPad];
  const canonical = partes.concat([
    prevSeal,
    campos.localTime,
    campos.workerName,
    campos.type,
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
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, total: 0, errores: [] };

  const numRows = lastRow - 1;
  const dataRange = sheet.getRange(2, 1, numRows, 9);
  const values = dataRange.getValues();
  const displayValues = dataRange.getDisplayValues();
  const richValues = sheet.getRange(2, 4, numRows, 1).getRichTextValues();

  const ymHoja = parsearYmDesdeNombreHoja_(sheet.getName());
  const secret = obtenerSecretoHmac_();
  const errores = [];

  // Soportar tanto génesis mensual ("GENESIS-202610") como génesis legado ("GENESIS")
  let prevSeal = ymHoja ? ("GENESIS-" + ymHoja) : "GENESIS";

  for (let i = 0; i < numRows; i++) {
    const sheetRow = i + 2;
    const seq = i + 1;
    const localTime = String(displayValues[i][0] || "").trim();
    const workerName = String(values[i][1] || "").trim();
    const type = String(values[i][2] || "").trim();
    const richLink = richValues[i][0] ? richValues[i][0].getLinkUrl() : null;
    const mapsUrl = richLink || String(values[i][3] || "").trim();
    const accuracy = values[i][4];
    const coords = String(values[i][5] || "").trim();
    const timeZone = String(values[i][6] || "").trim();
    const utcTime = String(values[i][7] || "").trim();
    const storedSeal = extraerCodigoSello_(values[i][8]);

    // Determinar prefijo YM esperado para esta fila
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
        workerName: workerName,
        type: type,
        mapsUrl: mapsUrl,
        accuracy: accuracy,
        coords: coords,
        timeZone: timeZone,
        utcTime: utcTime
      },
      secret
    );

    const sealCell = sheet.getRange(sheetRow, 9);
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

    prevSeal = storedSeal || "CORRUPTO";
  }

  if (checkDeletedTail) {
    const headRaw = PropertiesService.getScriptProperties().getProperty("CRONOS_CHAIN_HEAD_" + sheet.getSheetId());
    if (headRaw) {
      try {
        const head = JSON.parse(headRaw);
        if (head.count > numRows) {
          errores.push(
            "• Se detectaron filas eliminadas al final de \"" + sheet.getName() + "\": el servidor registró " +
            head.count + " marca(s), pero actualmente solo existen " + numRows + "."
          );
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
