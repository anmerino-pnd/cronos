# Cronos · Checador PWA Serverless

Aplicación Web Progresiva (**PWA**) de uso libre y código abierto diseñada para el registro de asistencia (**Entrada / Salida**) con geolocalización GPS verificada y hora oficial de servidor para equipos de trabajo en campo (ej. PyMEs de limpieza, mantenimiento, seguridad o rutas).

* **Costo de infraestructura:** `$0 USD` (100% Serverless, sin servidores intermedios ni suscripciones).
* **Privacidad y propiedad de datos:** Cada empresa conecta su propia hoja de **Google Sheets** mediante **Google Apps Script**.
* **Arquitectura 0-Build:** HTML5 + CSS + Vanilla JavaScript (ES Modules), lista para publicar directamente en **GitHub Pages**, **Cloudflare Pages** o **Vercel**.
* **Ultraligera:** Carga inicial menor a **65 KB**, con carga diferida (*lazy-load*) de módulos de código QR únicamente cuando se utilizan.
* **Multiplataforma:** Funciona e instala en pantalla de inicio tanto en **Android** como en **iOS**.

---

## Guía Rápida para el Administrador (Configurar en 3 minutos)

También puedes seguir esta misma guía interactiva directamente desde el **Panel de Administrador** de la aplicación (`/admin` o `#admin`).

1. **Crear la hoja de asistencia y revisar tu Zona Horaria:**
   * Entra a [Google Sheets (`sheets.new`)](https://sheets.new) y crea una hoja de cálculo nueva. Ponle un nombre identificable (por ejemplo: *Asistencia Limpieza*).
   * Ve a **Archivo > Configuración > General > Zona horaria** y asegúrate de que corresponda a tu región (ej. *(GMT-07:00) Hermosillo* o la ciudad donde opere tu equipo).
2. **Nombrar y guardar el conector en Apps Script:**
   * En el menú superior, haz clic en **Extensiones > Apps Script**.
   * Arriba a la izquierda haz clic donde dice **Proyecto sin título** y cámbiale el nombre copiando y pegando: `Cronos - Conector de Asistencia`.
   * Borra todo el código que aparece por defecto en el editor y pega íntegramente el código de [`backend/Code.gs`](./backend/Code.gs) (también incluido abajo).
   * Arriba del editor, presiona el ícono del disquete llamado **Guardar proyecto en Drive** (o `Ctrl + S`).
3. **Configurar la Nueva implementación:**
   * Arriba a la derecha, haz clic en el botón azul **Implementar > Nueva implementación**.
   * En la ventana emergente, haz clic en el **botón de engranaje (⚙️)** junto a *"Seleccionar tipo"* y elige **Aplicación web**.
   * En **Descripción**, escribe o pega: `Conector de asistencia Cronos`.
   * En **Ejecutar como**, selecciona **Yo** (tu correo).
   * En **Quién tiene acceso**, selecciona **Cualquier usuario** *(indispensable para que los teléfonos de los trabajadores puedan registrar sin pedir cuenta de Google)*.
   * Haz clic en **Implementar**.
4. **Autorizar permisos (Aviso normal de verificación de Google):**
   * Presiona **Autorizar acceso** y elige tu cuenta de Google.
   * Aparecerá una pantalla advirtiendo que **"Google no ha verificado esta aplicación"**. **Esto es completamente normal** porque el script acaba de ser creado por ti mismo en tu propio Google Drive y no es una app comercial externa.
   * Haz clic abajo a la izquierda en **Avanzado** (o **Configuración avanzada**).
   * Haz clic abajo en **Ir a Cronos - Conector de Asistencia (unsafe)** / **(no seguro)**.
   * Presiona **Continuar** (o **Permitir**).
5. **Vincular con Cronos:**
   * Copia la **URL de la aplicación web** que termina en `/exec`.
   * Abre Cronos en modo Administrador (`/#admin` o `/admin`), escribe el nombre de tu empresa, pega la URL y presiona **Generar Acceso**.
   * Presiona **Probar conexión** para verificar que se inserte una fila de prueba en tu hoja, e imprime el **Cartel QR** o comparte el **Magic Link por WhatsApp** con tu equipo.

### Código de Google Apps Script (`backend/Code.gs`)

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

## Flujo del Trabajador

1. **Vinculación única:** El trabajador abre el **Magic Link** enviado por WhatsApp o escanea el **Código QR** de la empresa (funciona tanto desde la cámara nativa del celular como desde el lector integrado en Cronos).
2. **Registro local:** Ingresa su nombre completo y acepta el aviso de privacidad (la ubicación GPS se consulta **únicamente** al presionar *Registrar Entrada* o *Registrar Salida*, nunca en segundo plano).
3. **Uso diario:** Dos botones táctiles de alto contraste (**REGISTRAR ENTRADA** y **REGISTRAR SALIDA**) con protección contra doble toque accidental (< 5 min), GPS obligatorio y recibo visual con la **hora oficial del servidor de Google**.
4. **Cambio de usuario o salida:** El menú *Cambiar usuario / Salir* permite **cambiar únicamente el nombre del trabajador** (conservando la empresa vinculada, ideal para corregir errores o compartir teléfono) o **desvincular la empresa** por completo.

---

## Estructura del Proyecto

```text
cronos/
├── index.html                  # Interfaz principal SPA (Onboarding, Checador y Panel Admin)
├── admin/
│   └── index.html              # Redirección estática para soportar la ruta /admin sin servidor
├── css/
│   └── styles.css              # Sistema de diseño de alto contraste + hoja de impresión (@media print)
├── js/
│   ├── app.js                  # Controlador principal, estado local, GPS obligatorio, API y PWA
│   ├── token.js                # Codificador/decodificador Base64URL (UTF-8) y validador de URLs
│   ├── qr-gen.js               # Generador QR en Canvas + exportador PNG (carga diferida en Admin)
│   └── gas-template.js         # Plantilla copiable del script de Google Apps Script
├── vendor/
│   └── html5-qrcode.min.js     # Lector QR por cámara (se descarga solo si el usuario abre el escáner)
├── icons/                      # Íconos SVG y PNG (180, 192, 512 y maskable) para Android e iOS
├── backend/
│   └── Code.gs                 # Script de referencia para Google Apps Script
├── manifest.json               # Web App Manifest instalable
├── sw.js                       # Service Worker para cachear la interfaz estática
└── SPEC.md                     # Especificación técnica del proyecto
```

---

## Ejecución Local y Despliegue

Al no requerir paso de compilación (*0-build*), cualquier servidor de archivos estáticos funciona de inmediato:

```bash
# Con Node.js:
npx serve .

# O con Python 3:
python -m http.server 8080
```

* **GitHub Pages:** En tu repositorio ve a *Settings > Pages*, elige `Deploy from a branch` (`main` / `/root`) y guarda. Funciona automáticamente en subrutas (`https://usuario.github.io/cronos/`).
* **Cloudflare Pages / Vercel:** Conecta el repositorio sin comando de build (`Build command: (vacío)`, `Output directory: .`).

---

## Licencia

Distribuido bajo la licencia incluida en [LICENSE](./LICENSE).
