/**
 * ============================================================================
 * CRONOS · Conector Serverless para Google Sheets
 * - Diseño ejecutivo automático desde el primer registro (columnas, colores, links)
 * - Sello criptográfico encadenado (HMAC-SHA256) contra ediciones manuales
 * - Detección en tiempo real (onEdit) y auditoría completa desde menú "Cronos"
 * ============================================================================
 */

const CRONOS_SHEET_NAME = "Registros de Asistencia";

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
  245  // I: Sello Criptográfico (HMAC)
];

/**
 * Crea el menú superior "Cronos" al abrir el archivo en Google Sheets.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🛡️ Cronos")
    .addItem("🔍 Auditar autenticidad de registros (HMAC)", "verificarIntegridadCronos")
    .addItem("🎨 Reaplicar diseño y formato visual", "reaplicarDisenoCronos")
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
    const sheet = obtenerHojaCronos_(spreadsheet);
    const secret = obtenerSecretoHmac_();
    const props = PropertiesService.getScriptProperties();
    const headKey = "CRONOS_CHAIN_HEAD_" + sheet.getSheetId();

    const data = JSON.parse(e.postData.contents);

    // Hora oficial generada en los servidores de Google (inmune al reloj del celular)
    const now = new Date();
    const utcTime = now.toISOString();
    const sheetTimeZone = spreadsheet.getSpreadsheetTimeZone();
    const localTime = Utilities.formatDate(now, sheetTimeZone, "yyyy-MM-dd HH:mm:ss");

    const workerName = String(data.workerName || "Sin nombre").trim();
    const type = String(data.type || "REGISTRO").trim().toUpperCase();
    const accuracy = Math.round(Number(data.accuracy) || 0);
    const lat = Number(data.lat || 0);
    const lng = Number(data.lng || 0);
    const coords = lat + "," + lng;
    const mapsUrl = "https://www.google.com/maps?q=" + coords;

    // Determinar secuencia y sello de la fila anterior para encadenar registros
    const lastRow = sheet.getLastRow();
    let seq = 1;
    let prevSeal = "GENESIS";

    if (lastRow >= 2) {
      seq = lastRow; // Fila 2 = registro #1, Fila 3 = registro #2...
      const prevCellVal = sheet.getRange(lastRow, 9).getValue();
      prevSeal = extraerCodigoSello_(prevCellVal) || "SIN_SELLO";
    }

    const seal = calcularSelloFila_(
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

    // Guardar puntero oficial de cadena para detectar si borran filas al final
    props.setProperty(headKey, JSON.stringify({ count: seq, lastSeal: seal }));

    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      localTime: localTime,
      utcTime: utcTime,
      timeZone: sheetTimeZone,
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
    if (sheet.getLastColumn() < 9) return;
    const headerSeal = String(sheet.getRange(1, 9).getValue() || "");
    if (headerSeal !== CRONOS_HEADERS[8]) return;

    const startRow = Math.max(2, e.range.getRow());
    const endRow = Math.min(sheet.getLastRow(), e.range.getLastRow());
    if (startRow > endRow || sheet.getLastRow() < 2) return;

    const resultado = auditarFilasInterno_(sheet, false);
    if (!resultado.ok) {
      e.source.toast(
        "Se detectó una modificación manual. El sello criptográfico HMAC marcó en rojo las filas alteradas.",
        "⚠️ Cronos · Alerta de Integridad",
        8
      );
    }
  } catch (_) {
    // Silencioso en trigger simple onEdit
  }
}

/**
 * Auditoría completa ejecutable desde el menú "🛡️ Cronos".
 */
function verificarIntegridadCronos() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CRONOS_SHEET_NAME) || spreadsheet.getActiveSheet();

  if (sheet.getLastRow() < 2) {
    ui.alert("Cronos · Auditoría", "Aún no hay registros de asistencia para auditar en esta hoja.", ui.ButtonSet.OK);
    return;
  }

  const res = auditarFilasInterno_(sheet, true);
  if (res.ok) {
    ui.alert(
      "✅ Integridad Verificada (100% Auténtico)",
      "Se verificaron criptográficamente " + res.total + " registro(s).\n\n" +
      "Todos los sellos HMAC-SHA256 y el encadenamiento secuencial coinciden. " +
      "Ninguna fila ha sido escrita a mano, editada ni eliminada.",
      ui.ButtonSet.OK
    );
  } else {
    ui.alert(
      "⚠️ Alteración Detectada en la Hoja",
      "Se encontraron inconsistencias en la cadena criptográfica:\n\n" +
      res.errores.slice(0, 8).join("\n") +
      (res.errores.length > 8 ? "\n...y " + (res.errores.length - 8) + " más." : "") +
      "\n\nLas filas afectadas fueron marcadas en ROJO en la columna 'Sello Criptográfico (HMAC)'.",
      ui.ButtonSet.OK
    );
  }
}

/**
 * Permite reaplicar anchos, alturas y diseño visual desde el menú superior.
 */
function reaplicarDisenoCronos() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CRONOS_SHEET_NAME) || spreadsheet.getActiveSheet();
  aplicarFormatoBaseHoja_(sheet);
  const lastRow = sheet.getLastRow();
  for (let r = 2; r <= lastRow; r++) {
    estilizarFilaRegistro_(sheet, r);
  }
  auditarFilasInterno_(sheet, false);
  SpreadsheetApp.getActiveSpreadsheet().toast("Diseño visual reaplicado correctamente.", "🎨 Cronos", 4);
}

/* ============================================================================
   Funciones Internas (Diseño Visual y Criptografía HMAC-SHA256)
   ============================================================================ */

function obtenerHojaCronos_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CRONOS_SHEET_NAME);

  if (!sheet) {
    const active = spreadsheet.getActiveSheet();
    if (active.getLastRow() === 0) {
      sheet = active;
      try {
        sheet.setName(CRONOS_SHEET_NAME);
      } catch (_) {}
    } else if (
      active.getLastColumn() >= 9 &&
      String(active.getRange(1, 9).getValue()) === CRONOS_HEADERS[8]
    ) {
      sheet = active;
    } else {
      sheet = spreadsheet.insertSheet(CRONOS_SHEET_NAME, 0);
    }
  }

  if (sheet.getLastRow() === 0) {
    inicializarHojaCronos_(sheet);
  } else if (sheet.getLastRow() === 1) {
    // Si el admin borró las filas de prueba dejando solo el encabezado, reiniciar cabeza de cadena
    PropertiesService.getScriptProperties().deleteProperty("CRONOS_CHAIN_HEAD_" + sheet.getSheetId());
  }

  return sheet;
}

function inicializarHojaCronos_(sheet) {
  sheet.clear();
  PropertiesService.getScriptProperties().deleteProperty("CRONOS_CHAIN_HEAD_" + sheet.getSheetId());

  const headerRange = sheet.getRange(1, 1, 1, 9);
  headerRange.setValues([CRONOS_HEADERS]);

  aplicarFormatoBaseHoja_(sheet);
}

function aplicarFormatoBaseHoja_(sheet) {
  try {
    sheet.setTabColor("#10B981");
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

  // Crear filtro si aún no existe
  if (!sheet.getFilter()) {
    try {
      sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 9).createFilter();
    } catch (_) {}
  }

  // Reglas de formato condicional para "Tipo de Registro" (Columna C)
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

  // Col B: Trabajador alineado a la izquierda y en negrita
  sheet.getRange(rowIndex, 2)
    .setHorizontalAlignment("left")
    .setFontWeight("bold");

  // Col D: Enlace de Google Maps estilizado
  sheet.getRange(rowIndex, 4)
    .setFontColor("#1D4ED8")
    .setFontWeight("bold");

  // Col F & H: Coordenadas y Timestamp UTC en tipografía monoespaciada
  sheet.getRange(rowIndex, 6).setFontFamily("Roboto Mono").setFontSize(9).setFontColor("#475569");
  sheet.getRange(rowIndex, 7).setFontSize(9).setFontColor("#475569");
  sheet.getRange(rowIndex, 8).setFontFamily("Roboto Mono").setFontSize(9).setFontColor("#64748B");

  // Col I: Sello criptográfico válido en verde esmeralda suave
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

function calcularSelloFila_(seq, prevSeal, campos, secret) {
  const seqPad = String(seq).padStart(4, "0");
  const canonical = [
    seqPad,
    prevSeal,
    campos.localTime,
    campos.workerName,
    campos.type,
    campos.mapsUrl,
    String(campos.accuracy),
    campos.coords,
    campos.timeZone,
    campos.utcTime
  ].join("|");

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

  return "CRN-" + seqPad + "-" + hex;
}

function auditarFilasInterno_(sheet, checkDeletedTail) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, total: 0, errores: [] };

  const numRows = lastRow - 1;
  const dataRange = sheet.getRange(2, 1, numRows, 9);
  const values = dataRange.getValues();
  const displayValues = dataRange.getDisplayValues();
  const richValues = sheet.getRange(2, 4, numRows, 1).getRichTextValues();

  const secret = obtenerSecretoHmac_();
  const errores = [];
  let prevSeal = "GENESIS";

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

    const expectedSeal = calcularSelloFila_(
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
    if (!storedSeal || storedSeal !== expectedSeal) {
      errores.push("• Fila " + sheetRow + " (" + (workerName || "Sin nombre") + "): Sello inválido o fila editada manualmente.");
      sealCell
        .setBackground("#FEE2E2")
        .setFontColor("#991B1B")
        .setFontWeight("bold")
        .setNote("⚠️ ALERTA CRONOS: Esta fila fue escrita o modificada manualmente en Google Sheets (o se eliminó una fila previa). El sello HMAC-SHA256 no coincide con el registro original del servidor.");
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
            "• Se detectaron filas eliminadas al final de la hoja: el servidor registró " +
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
