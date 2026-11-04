# Cronos · Checador PWA Serverless

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/es/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)](https://developer.mozilla.org/es/docs/Web/CSS)
[![JavaScript ES2022](https://img.shields.io/badge/JavaScript_ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=0F172A)](https://developer.mozilla.org/es/docs/Web/JavaScript)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](./manifest.json)
[![Google Apps Script](https://img.shields.io/badge/Google_Apps_Script-4285F4?style=for-the-badge&logo=google&logoColor=white)](./backend/Code.gs)
[![Google Sheets](https://img.shields.io/badge/Google_Sheets-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)](https://sheets.new)
[![HMAC-SHA256](https://img.shields.io/badge/Seguridad-HMAC--SHA256-059669?style=for-the-badge&logo=shield&logoColor=white)](./backend/Code.gs)
[![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub_Pages-181717?style=for-the-badge&logo=github&logoColor=white)](https://anmerino-pnd.github.io/cronos/)
[![License](https://img.shields.io/badge/Licencia-Apache_2.0-D22128?style=for-the-badge&logo=apache&logoColor=white)](./LICENSE)

Aplicación Web Progresiva (**PWA**) de uso libre y código abierto diseñada para el registro de asistencia (**Entrada / Salida**) con geolocalización GPS verificada, auditoría de dispositivos y hora oficial de servidor para equipos de trabajo en campo (ej. PyMEs de limpieza, mantenimiento, seguridad o rutas).

* **Costo de infraestructura:** `$0 USD` (100% Serverless, sin servidores intermedios ni suscripciones).
* **Privacidad y propiedad de datos:** Cada empresa conecta su propia hoja de **Google Sheets** mediante **Google Apps Script**.
* **Arquitectura 0-Build:** HTML5 + CSS3 + Vanilla JavaScript (ES Modules), lista para publicar directamente en **GitHub Pages**, **Cloudflare Pages** o **Vercel**.
* **Diseño Optical Liquid Glass:** Interfaz minimalista con física óptica translúcida, tipografía de precisión (`Instrument Sans`, `DM Sans` y `JetBrains Mono`) y cero emojis en interfaz y hojas de cálculo.
* **Ultraligera y Multiplataforma:** Carga inicial menor a **65 KB** con carga diferida (*lazy-load*) de módulos QR, instalable en **Android** e **iOS**.

---

## Guía Rápida para el Administrador (Configuración única en 3 minutos)

También puedes seguir esta guía interactiva directamente desde el **Panel de Administrador** de la aplicación (`/admin` o `#admin`).

1. **Crear la hoja base y verificar la Zona Horaria:**
   * Abre [Google Sheets (`sheets.new`)](https://sheets.new) y nómbralo (ej. *Asistencia 2026*).
   * En **Archivo > Configuración > General > Zona horaria**, confirma que corresponda a tu ciudad o región.
2. **Pegar el motor en Apps Script:**
   * En el menú superior, abre **Extensiones > Apps Script**.
   * Borra el contenido de `Código.gs`, pega íntegramente el código de [`backend/Code.gs`](./backend/Code.gs) y presiona **Guardar** (`Ctrl + S`).
3. **Publicar como Aplicación Web:**
   * Haz clic en **Implementar > Nueva implementación**, selecciona el engrane **Aplicación web** y configura:
     * **Descripción:** `Checador Cronos`
     * **Ejecutar como:** `Yo` (tu cuenta de Google).
     * **Quién tiene acceso:** `Cualquier usuario` *(indispensable para que los teléfonos del personal registren sin iniciar sesión de Google)*.
   * Haz clic en **Implementar** y autoriza el acceso (*Autorizar acceso > Avanzado > Ir a proyecto (no seguro) > Permitir*).
4. **Configurar tu Perfil de Administrador (Columna 1 en `/admin`):**
   * Copia la **URL de la aplicación web** terminada en `/exec`.
   * Abre Cronos en modo Administrador (`/#admin` o `/admin`, distribuido en **3 columnas**: *1. Perfil Admin y Conexión*, *2. Hojas de Google Sheets* y *3. Código QR y Enlace*) y completa:
     * **Tu nombre de Administrador** y tu **ID único de Administrador (8 dígitos, serie `9XXX-XXXX`)**.
     * **PIN de seguridad de exactamente 4 números** (ej. `2580`).
     * **Nombre de la hoja principal** y **URL de Apps Script (`/exec`)**.
   * Presiona **Guardar Perfil y Conectar**. Tu perfil queda vinculado y habilita el acceso directo entre tu **Checador personal** y el **Panel de Administrador**.
   * Para entrar como Administrador desde cualquier otro teléfono o navegador, toca **"Ya tengo mi ID"**, ingresa tu **ID serie 9** + tu **PIN de 4 números** y se desbloqueará tu sesión completa.
5. **Crear nuevas hojas en Google Drive con 1 clic (Columna 2 en `/admin`):**
   * Escribe el nombre de la nueva hoja (ej. *Asistencia 2027* o *Sucursal Norte*), elige opcionalmente si deseas **Copiar directorio de Trabajadores** (desmarcado por defecto) y selecciona desde cuál hoja deseas copiarlos.
   * Presiona **Crear hoja en mi Drive**. El sistema creará el nuevo archivo en tu Google Drive sin dejar `"Hoja 1"` sobrante y sincronizará el código QR y tu checador.

---

## Automatización y Auditoría en Google Sheets (`backend/Code.gs`)

* **Organización mensual automática y pestaña `Resumen Mensual`:**
  * Crea una pestaña por mes (`Octubre 2026`, `Noviembre 2026`...) según la hora oficial del servidor y coloca siempre el mes en curso como primera pestaña a la izquierda.
  * Mantiene actualizada en vivo la pestaña **`Resumen Mensual`** con KPIs globales y métricas por trabajador (*Días asistidos, Entradas, Salidas, Turnos cerrados, Horas trabajadas `Xh YYm`, Promedio por turno, Alertas de dispositivo y Estado actual `En turno` / `Fuera de turno`*).
* **Directorio `Trabajadores` (8 columnas) y Aprobación de Acceso:**
  * Cada trabajador nuevo recibe un **ID numérico de 8 dígitos** (`1000-0000` a `8999-9999`), su nombre queda congelado y su cuenta inicia como **`Pendiente`** hasta que el Administrador la apruebe (`Activo`).
  * El Administrador puede gestionar el estatus desde el menú desplegable nativo (`Activo`, `Pendiente`, `Baja`) en la columna 8 de `Trabajadores` o con **1 clic** desde la columna 2 del panel `/admin`.
  * **Bloqueo en 5 ángulos para cuentas en `Baja`:** impide que un ex-trabajador inicie sesión por ID desde cualquier dispositivo (sin bloquear el teléfono de un compañero activo), registre con una sesión abierta, cree un perfil nuevo con su dispositivo registrado o su mismo nombre, o sincronice registros pendientes en cola offline.
  * **Auditoría de dispositivos con índice fijo:** mantiene el historial numerado (`1)`, `2)`, `3)`...) de dispositivos por empleado (`Celular titular`, `Celular adicional #2`, `Celular de [Compañero]`, `Kiosco`, `Offline` o `GPS estático/emulado`).
* **Protección contra Fuerza Bruta en PIN de Admin:** limita a **5** los intentos fallidos del PIN de 4 números y aplica bloqueo temporal progresivo (`15 min → 30 min → 60 min`).
* **Sello Criptográfico Encadenado (`HMAC-SHA256`) y Comprobante Bilateral:**
  * Cada fila se firma con una llave privada en `PropertiesService` incluyendo año-mes, folio consecutivo, ID, auditoría de dispositivo y el sello de la fila anterior (`CRN-202611-0001-...`).
  * Incluye disparador automático `onEdit` que marca en rojo cualquier edición manual y menú **`Cronos`** en Google Sheets (*Auditar pestaña actual (HMAC)*, *Auditar todos los meses*, *Actualizar Resumen Mensual (KPIs)* y *Reaplicar diseño visual a esta pestaña*).

---

## Flujo del Trabajador

1. **Vinculación:** Escanea el **Código QR** de su centro de trabajo o abre el enlace directo de WhatsApp.
2. **Registro o acceso por ID:**
   * **Soy nuevo:** Escribe su nombre completo, guarda su **ID de 8 dígitos** y solicita acceso (`Pendiente`).
   * **Ya tengo mi ID:** Ingresa sus **8 dígitos** para cargar su perfil oficial en cualquier dispositivo.
3. **Checador diario:**
   * **Sugerencia inteligente de turno:** Resalta automáticamente **REGISTRAR SALIDA** cuando tiene un turno abierto (y **REGISTRAR ENTRADA** al iniciar jornada).
   * **Cola Offline con GPS satelital:** Si no hay cobertura de datos móviles, captura las coordenadas GPS reales, guarda el registro localmente y lo sincroniza al reconectar.
   * **Últimos registros y Recibo firmado:** Muestra las últimas 5 marcas en el dispositivo con su folio (`#0001`), sello `HMAC-SHA256` y botón **Recibo** para copiar el comprobante firmado.
   * **Modo Kiosco (Caseta / Tablet):** Permite que varios trabajadores registren su Entrada o Salida marcando su ID de 8 dígitos en un teclado numérico compartido.

---

## Estructura del Proyecto

```text
cronos/
├── index.html                  # Interfaz principal SPA (Bienvenida, Registro, Checador y Admin)
├── admin/
│   └── index.html              # Redirección estática para soportar la ruta /admin sin servidor
├── css/
│   └── styles.css              # Sistema de diseño Optical Liquid Glass + hoja de impresión (@media print)
├── js/
│   ├── app.js                  # Controlador principal, estado local, cola offline, kiosco y PWA
│   ├── token.js                # Codificador/decodificador Base64URL (UTF-8) y validador de URLs
│   ├── qr-gen.js               # Generador QR en Canvas + exportador PNG (carga diferida en Admin)
│   └── gas-template.js         # Plantilla copiable del motor de Google Apps Script
├── vendor/
│   └── html5-qrcode.min.js     # Lector QR por cámara (carga diferida bajo demanda)
├── icons/                      # Logotipo vectorial horológico e íconos PWA (180, 192, 512 y maskable)
├── backend/
│   └── Code.gs                 # Motor de Google Apps Script (pestañas, KPIs, aprobaciones y HMAC)
├── manifest.json               # Web App Manifest instalable
├── sw.js                       # Service Worker para cachear la interfaz estática
└── SPEC.md                     # Especificación técnica del proyecto
```

---

## Licencia

Distribuido bajo la licencia Apache 2.0 incluida en [LICENSE](./LICENSE).
