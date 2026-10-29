function doPost(e) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getActiveSheet();
    
    // Si la hoja está vacía, crear encabezados automáticamente
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Fecha y Hora (Local)",
        "Timestamp (UTC)",
        "Zona Horaria",
        "Trabajador",
        "Tipo de Registro",
        "Mapa (Ubicación)",
        "Precisión GPS (metros)",
        "Coordenadas"
      ]);
      sheet.getRange(1, 1, 1, 8).setFontWeight("bold");
    }

    const data = JSON.parse(e.postData.contents);
    
    // La hora se genera en el servidor de Google (inmune a cambios de hora en el celular)
    const now = new Date();
    const utcTime = now.toISOString();
    
    // Toma dinámicamente la zona horaria configurada en el archivo de Google Sheets
    const sheetTimeZone = spreadsheet.getSpreadsheetTimeZone();
    const localTime = Utilities.formatDate(now, sheetTimeZone, "yyyy-MM-dd HH:mm:ss");
    
    const coords = `${data.lat},${data.lng}`;
    const mapsUrl = `https://www.google.com/maps?q=${coords}`;
    
    sheet.appendRow([
      localTime,
      utcTime,
      sheetTimeZone,
      data.workerName || "Sin nombre",
      data.type || "REGISTRO",
      mapsUrl,
      Math.round(data.accuracy || 0),
      coords
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      localTime: localTime,
      utcTime: utcTime,
      timeZone: sheetTimeZone
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
