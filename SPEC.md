# Especificación Técnica (MVP - Etapa 1): Checador PWA Serverless

## 1. Visión General del Proyecto
Aplicación Web Progresiva (PWA) de uso libre y código abierto diseñada para el registro de asistencia y geolocalización (Entrada/Salida) de trabajadores en campo (ej. PyMEs de limpieza). 

* **Costo de infraestructura:** $0 USD (100% Serverless).
* **Alojamiento Frontend:** GitHub Pages / Cloudflare Pages / Vercel.
* **Base de Datos y Backend:** Google Sheets + Google Apps Script (propiedad de cada administrador).
* **Plataformas soportadas:** Android y iOS vía navegador web e instalación en pantalla de inicio.

---

## 2. Arquitectura del Sistema y Flujo de Datos

El sistema opera sin una base de datos centralizada intermedia. La vinculación entre los trabajadores y la hoja de cálculo de la empresa se realiza codificando el identificador del webhook de Google Apps Script en un **Código QR** y/o **Magic Link** (URL con parámetros).

### 2.1 Empaquetado de Configuración (Token de Empresa)
Para evitar códigos QR densos o URLs demasiado largas, la aplicación extrae únicamente el `SCRIPT_ID` de la URL generada por Google Apps Script:
* **URL original de Google:** `https://script.google.com/macros/s/{SCRIPT_ID}/exec`
* **JSON de configuración:**
  ```json
  {
    "id": "AKfycbx...",
    "org": "Limpieza HMO"
  }
  ```
* **Token generado:** El JSON se convierte a `Base64` (URL-safe) y se distribuye de dos formas:
  1. **Código QR:** Renderizado en la vista del Administrador para escaneo presencial.
  2. **Magic Link (WhatsApp):** `https://<dominio-app>/?join=<BASE64_TOKEN>` para configuración remota en un clic.

---

## 3. Flujos de Usuario (UX/UI)

### 3.1 Vista de Administrador (`/admin` o pestaña de Configuración)
1. **Formulario de creación:**
   * Campo: *Nombre de la Empresa* (ej. `Limpieza Sonora`).
   * Campo: *URL del Web App de Google Apps Script*.
2. **Validación:** Al presionar "Generar Acceso", la app verifica que la URL tenga el formato válido de `script.google.com/macros/s/.../exec` y opcionalmente envía un `ping` de prueba.
3. **Salida:**
   * Muestra el **Código QR** listo para escanear o imprimir.
   * Botón **"Copiar enlace de invitación (WhatsApp)"** con el Magic Link.
   * Botón **"Probar conexión"** que inserta una fila de prueba en el Google Sheets.

### 3.2 Vista de Trabajador - Onboarding (Primera vez)
1. **Detección de invitación:**
   * Si el usuario entra mediante un **Magic Link** (`?join=...`), la app decodifica el token automáticamente y salta al paso 2.
   * Si entra a la URL raíz sin configuración previa, muestra las opciones: **"Escanear QR de mi empresa"** (usando la cámara del dispositivo) o **"Pegar código de invitación"**.
2. **Registro local del empleado:**
   * Muestra el nombre de la empresa detectada (ej. *"Te estás uniendo a: Limpieza HMO"*).
   * Campo de texto: *Nombre completo del trabajador*.
   * Casilla de verificación obligatoria: *Aceptación de aviso de privacidad (uso de ubicación únicamente al momento de presionar el botón de registro)*.
   * Al guardar, se almacena en `localStorage` y se limpia el parámetro `?join=` de la URL.
3. **Banner de instalación (PWA):**
   * En Android: Botón nativo para instalar app (`beforeinstallprompt`).
   * En iOS: Instrucción visual breve (*"Para no perder tu sesión, toca Compartir > Agregar a inicio"*).

### 3.3 Vista de Trabajador - Checador (Uso Diario)
Pantalla minimalista de alto contraste pensada para uso rápido:
1. **Encabezado:** Nombre de la empresa y nombre del trabajador (con un botón discreto de "Cambiar usuario / Salir").
2. **Acciones principales:**
   * Botón grande verde: **REGISTRAR ENTRADA**
   * Botón grande azul/ámbar: **REGISTRAR SALIDA**
3. **Flujo al presionar un botón:**
   * Estado de carga: *"Obteniendo ubicación GPS..."* (solicita permisos de `navigator.geolocation.getCurrentPosition` con `enableHighAccuracy: true`).
   * Estado de envío: *"Enviando registro..."*
   * Confirmación visual clara (pantalla completa o modal): *"¡Entrada registrada con éxito a las 08:02 AM!"* mostrando la hora oficial devuelta por el servidor de Google.

---

## 4. Especificación de Datos y API

### 4.1 Almacenamiento Local (`localStorage`)
```json
{
  "checador_config": {
    "scriptId": "AKfycbx...",
    "orgName": "Limpieza HMO",
    "workerName": "Juan Pérez",
    "privacyAccepted": true,
    "configuredAt": "2026-10-29T17:00:00.000Z"
  },
  "last_checkin": {
    "type": "ENTRADA",
    "serverTime": "2026-10-29 08:01:22"
  }
}
```

### 4.2 Petición HTTP (Frontend -> Google Apps Script)
* **Método:** `POST`
* **URL:** `https://script.google.com/macros/s/{scriptId}/exec`
* **Headers:** `Content-Type: text/plain;charset=utf-8` *(Importante: Se usa `text/plain` deliberadamente para evitar el bloqueo de preflight `OPTIONS` por políticas CORS de Google Apps Script).*
* **Payload (Body JSON serializado como texto):**
  ```json
  {
    "workerName": "Juan Pérez",
    "type": "ENTRADA",
    "lat": 29.072967,
    "lng": -110.955919,
    "accuracy": 14.5
  }
  ```

### 4.3 Respuesta HTTP (Google Apps Script -> Frontend)
```json
{
  "status": "ok",
  "localTime": "2026-10-29 08:01:22",
  "utcTime": "2026-10-29T15:01:22.120Z",
  "timeZone": "America/Hermosillo"
}
```

---

## 5. Código del Backend (Google Apps Script)

Este es el script íntegro que el Administrador pegará en su archivo de Google Sheets (*Extensiones > Apps Script*):

```javascript
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
```

---

## 6. Guía Rápida para el Administrador (Para incluir en el README)

1. **Crear la hoja:** Entra a [Google Sheets](https://sheets.new) y crea una hoja de cálculo nueva. Ponle nombre (ej. *Asistencia Limpieza*).
2. **Verificar tu Zona Horaria:** Ve a **Archivo > Configuración > General > Zona horaria** y asegúrate de que esté en tu región (ej. *(GMT-07:00) Hermosillo* o la ciudad donde opere el negocio).
3. **Pegar el código conector:**
   * En el menú superior, haz clic en **Extensiones > Apps Script**.
   * Borra el código que aparece por defecto y pega el código del bloque **Sección 5**.
   * Presiona el ícono del disquete (**Guardar**).
4. **Publicar como Web App:**
   * Arriba a la derecha, haz clic en el botón azul **Implementar > Nueva implementación**.
   * En "Seleccionar tipo" (ícono de engrane), elige **Aplicación web**.
   * En *Ejecutar como*, selecciona **Yo** (tu correo).
   * En *Quién tiene acceso*, selecciona **Cualquier persona** *(Importante para que los celulares de los trabajadores no pidan cuenta de Google)*.
   * Haz clic en **Implementar**, autoriza los permisos con tu cuenta de Google (*Configuración avanzada > Ir a proyecto*).
5. **Vincular con la App:**
   * Copia la **URL de la aplicación web** que te entrega Google.
   * Abre la app del Checador en modo Administrador, pega la URL, escribe el nombre de tu negocio y comparte el **Código QR** o el **Link de WhatsApp** con tu equipo.

---

## 7. Stack Tecnológico Recomendado (Etapa 1)
* **Frontend:** HTML5 + Vanilla JavaScript (o React/Vite ligero) + Tailwind CSS (vía CDN o compilado) para mantener el peso total por debajo de 100 KB.
* **Librería de QR (Generación y Lectura):**
  * Generación (Admin): `qrcode.js` o API ligera en canvas.
  * Escaneo (Trabajador): `html5-qrcode` (solo se carga si el usuario elige escanear con cámara; si entra por Magic Link de WhatsApp ni siquiera necesita permisos de cámara).
* **PWA:** `manifest.json` + `sw.js` (Service Worker básico para cachear la interfaz estática y permitir la instalación en el teléfono).