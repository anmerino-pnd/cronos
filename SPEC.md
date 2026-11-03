# Especificación Técnica y Hoja de Ruta: Cronos · Checador PWA Serverless

## 1. Visión General del Proyecto
Aplicación Web Progresiva (**PWA**) de uso libre y código abierto diseñada para el registro de asistencia (**Entrada / Salida**), auditoría de dispositivos y geolocalización GPS verificada con hora oficial de servidor para equipos de trabajo en campo (ej. PyMEs de limpieza, mantenimiento, construcción, seguridad o supervisión de rutas).

* **Costo de infraestructura:** `$0 USD` (100% Serverless, sin servidores intermedios ni suscripciones).
* **Alojamiento Frontend:** GitHub Pages / Cloudflare Pages / Vercel (Arquitectura *0-Build* en HTML5 + CSS3 + Vanilla JS ES2022).
* **Base de Datos y Backend:** Google Sheets + Google Apps Script (propiedad privada 100% en el Google Drive de cada administrador).
* **Plataformas soportadas:** Android y iOS vía navegador web e instalación directa en pantalla de inicio.

---

## 2. Arquitectura del Sistema y Flujo de Datos

El sistema opera sin una base de datos centralizada intermedia. La vinculación entre los trabajadores y las hojas de cálculo de la empresa se realiza codificando el identificador del webhook de Google Apps Script (`scriptId`), el nombre de la empresa/hoja (`org`) y opcionalmente el identificador del archivo de Google Sheets secundario (`sid`) en un **Código QR** y/o **Magic Link** (`?join=<BASE64URL_TOKEN>`).

### 2.1 Empaquetado de Configuración (Token de Empresa)
* **URL original de Google:** `https://script.google.com/macros/s/{SCRIPT_ID}/exec`
* **JSON de configuración (Hoja principal):**
  ```json
  {
    "id": "AKfycbx...",
    "org": "Limpieza HMO"
  }
  ```
* **JSON de configuración (Hoja adicional creada en 1 clic desde el panel Admin):**
  ```json
  {
    "id": "AKfycbx...",
    "org": "Asistencia Limpieza 2027",
    "sid": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
  }
  ```

---

## 3. Flujos de Usuario (UX/UI Actuales)

### 3.1 Panel de Administrador de 3 Columnas (`/admin` o `#admin`)
1. **Columna 1 — Perfil de Administrador y Conector (`#admin-form-card`):**
   * **Nombre completo del Administrador:** se congela en la pestaña `Trabajadores` para que el Admin también pueda checar asistencia si lo requiere.
   * **ID único de Administrador (8 dígitos, rango `9000-0000` a `9999-9999`):** nunca colisiona con los IDs de trabajadores (`1000-0000` a `8999-9999`).
   * **PIN de Seguridad (exactamente 4 dígitos numéricos `0–9`):** protege la creación de hojas adicionales y permite al Admin iniciar sesión desde cualquier celular o navegador usando *"Ya tengo mi ID"*.
   * **Acceso directo al Checador del Admin:** botón **`⏱️ Ir a mi Checador en: [Hoja seleccionada]`** que sincroniza automáticamente el Checador personal del Admin con la hoja elegida en la Columna 2.
2. **Columna 2 — Mis Hojas de Google Sheets y Creación en 1 Clic (`#admin-sheets-panel`):**
   * **Catálogo de hojas vinculadas:** permite cambiar en 1 clic la hoja activa tanto para el **Cartel QR / Magic Link** como para el **Checador personal del Admin**, con botón directo **`📊 Abrir Sheet`**.
   * **Creador de nuevas hojas en 1 clic (`admin_create_sheet`):** crea un nuevo archivo en Google Drive con la misma zona horaria y sin dejar pestañas `"Hoja 1"` sobrantes.
   * **Migración selectiva de `Trabajadores` (desmarcada por defecto):** al activarla, despliega un selector (`#new-sheet-source-select`) para que el Admin elija **en base a cuál hoja/empresa existente** desea copiar la lista de trabajadores (conservando sus IDs de 8 dígitos, nombres congelados e historial de celulares).
3. **Columna 3 — Cartel QR y Enlace Activo (`#admin-output-card`):**
   * Cartel QR listo para imprimir (`@media print`) o descargar en PNG, Magic Link para compartir por WhatsApp y botón **Probar conexión**.

### 3.2 Vista de Trabajador — Onboarding y Login por ID de 8 Dígitos
1. **Pestaña *"Soy nuevo"*:**
   * El trabajador escribe su nombre completo una sola vez y recibe su **ID único numérico de 8 dígitos** (ej. `4829-1034`).
   * Su nombre queda **congelado** en la pestaña `Trabajadores` para impedir variaciones o errores de escritura.
2. **Pestaña *"Ya tengo mi ID"*:**
   * **Trabajador:** ingresa sus 8 dígitos y recupera automáticamente su nombre oficial desde Google Sheets (ideal si cambia de celular o necesita registrar asistencia desde el teléfono de un compañero).
   * **Administrador:** si ingresa su ID de Admin (`9XXX-XXXX`), la app solicita su **PIN de 4 números** y desbloquea tanto su **Checador** como la barra superior **Modo Administrador** con selector rápido de hoja.

### 3.3 Vista de Checador Diario y Menú de Opciones Simplificado
1. **Checador de alto contraste:**
   * Encabezado con empresa activa, nombre congelado, chip copiable con su ID de 8 dígitos y botón **Opciones**.
   * Dos botones táctiles (**REGISTRAR ENTRADA** y **REGISTRAR SALIDA**) con prevención de doble registro accidental (< 5 min), GPS obligatorio y recibo digital con hora oficial del servidor y sello criptográfico.
2. **Menú de Opciones (3 acciones claras):**
   * **Cambiar QR / Hoja (`Mantiene tu sesión`):** escanea otro QR o enlace (ej. cambio de hoja anual) en 1 solo paso manteniendo su sesión e ID.
   * **Cambiar sesión (`Misma empresa`):** permite que otro compañero ingrese con su ID de 8 dígitos en ese mismo teléfono.
   * **Cerrar sesión (`Borra datos`, en rojo con confirmación en 2 toques):** desvincula la empresa, el usuario y la sesión del dispositivo.

---

## 4. Automatización en Google Sheets (`backend/Code.gs`)

1. **Cero pestañas `"Hoja 1"` sobrantes:** tanto en la hoja principal como en las hojas adicionales creadas desde el panel Admin, el script reutiliza o limpia cualquier pestaña vacía por defecto (`Hoja 1` / `Sheet1`) para que el libro solo contenga las pestañas mensuales y `Trabajadores`.
2. **Pestañas mensuales automáticas:** crea una pestaña por mes (`Octubre 2026`, `Noviembre 2026`...) según la hora oficial del servidor y coloca siempre el mes en curso como primera pestaña a la izquierda con color esmeralda (`#10B981`).
3. **Directorio `Trabajadores` y auditoría de celulares con índice fijo:**
   * Asocia `ID de 8 dígitos -> Nombre congelado -> Celular titular -> Lista numerada de dispositivos (1, 2, 3...)`.
   * Si un empleado usa un celular adicional, la columna **`Dispositivo / Auditoría`** muestra siempre el número fijo que ocupa ese equipo en su historial (`⚠️ Celular adicional #2`, `⚠️ Celular adicional #3`) o alerta en rojo si el celular pertenece a otro compañero (`🚨 Celular de Juan Pérez`).
4. **Sello Criptográfico Encadenado (`HMAC-SHA256`):** firma cada fila con una llave privada en `PropertiesService`, detecta ediciones manuales con `onEdit` y ofrece auditoría completa desde el menú **`🛡️ Cronos`**.

---

## 5. Análisis Estratégico y Zonas de Oportunidad (UX/UI y Valor para PMs y Dueños de Empresas)

Para que **Cronos** convenza de inmediato a **Project Managers (PMs)**, supervisores de operaciones y dueños de PyMEs frente a alternativas de pago, estas son las principales áreas de oportunidad identificadas:

### 5.1 Experiencia del Administrador / PM (Visibilidad y Toma de Decisiones)
1. **Pestaña Automática de `Resumen / KPIs` en Google Sheets:**
   * **Oportunidad:** Hoy el Admin ve la bitácora cronológica y el directorio `Trabajadores`, pero para pagar nómina o facturar horas a un cliente necesita saber cuántas horas trabajó cada persona, cuántos días asistió y cuántas incidencias de celular compartido tuvo en el mes.
   * **Propuesta:** Generar automáticamente una pestaña **`📊 Resumen Mensual`** (o comando en el menú `🛡️ Cronos`) con fórmulas nativas de Sheets que calculen por trabajador: *Total de Entradas, Total de Salidas, Horas estimadas trabajadas, Días asistidos y Alertas de dispositivo*.
2. **Geocercas Visuales (Radio de Sitio de Trabajo Opcional):**
   * **Oportunidad:** El GPS actual guarda coordenadas exactas y link a Google Maps, pero el supervisor tiene que abrir el link para saber si el trabajador estaba en el sitio o a 3 km.
   * **Propuesta:** Permitir definir opcionalmente en `/admin` las coordenadas del sitio (con un botón *"Usar mi ubicación actual como centro"* o pegando coordenadas) y un radio permitido (ej. `150 m`). Al checar, el sistema nunca bloquea al empleado, pero marca en el Sheets: `✅ En sitio (a 18 m)` vs. `⚠️ Fuera de geocerca (a 1.4 km)`.
3. **Catálogo de Hojas con Etiquetas de Estado (Archivar / Activa) y QR Múltiple en PDF:**
   * **Oportunidad:** Cuando un PM maneja 5 o 10 cuadrillas/clientes distintos desde un mismo conector, la lista de hojas crece.
   * **Propuesta:** Buscador rápido en la Columna 2 (`Mis Hojas`), opción de ocultar/archivar hojas de años cerrados sin borrarlas de Drive y descarga de cartel QR con instrucciones personalizadas.

### 5.2 Experiencia del Trabajador en Campo (Practicidad y Cero Fricción)
1. **Cola Offline con Firma de Tiempo Diferida (Resiliencia en Sótanos o Zonas sin Señal):**
   * **Oportunidad:** En sótanos, bodegas industriales o zonas rurales donde se pierde momentáneamente la red celular, el trabajador sí tiene señal GPS satelital pero falla el `POST` HTTP.
   * **Propuesta:** Guardar el intento con sus coordenadas GPS en `localStorage` cifrado y enviarlo automáticamente en cuanto regrese la conexión, marcando en el Sheets tanto la hora de captura GPS como la hora oficial de recepción en servidor (`📶 Diferido por falta de señal`).
2. **Historial Local de los Últimos 5 Registros en el Celular del Trabajador:**
   * **Oportunidad:** Actualmente el pie de tarjeta muestra solo el *"Último registro"*. A veces el trabajador duda si checó el día anterior o a qué hora salió.
   * **Propuesta:** Al tocar la barra inferior *"Último registro"*, desplegar los últimos 5 registros guardados en ese teléfono con su folio de sello criptográfico como comprobante personal.
3. **Sugerencia Inteligente de Acción (Entrada vs. Salida):**
   * **Oportunidad:** Reducir aún más los errores de dedo cuando el trabajador tiene prisa.
   * **Propuesta:** Si el último registro del día fue una `ENTRADA`, resaltar sutilmente el botón de `SALIDA` como siguiente acción esperada (sin bloquear `ENTRADA` por si olvidó marcar salida el día anterior).

---

## 6. Hoja de Ruta Propuesta (Roadmap)

| Fase | Enfoque | Entregables Clave | Impacto para PMs / Jefes |
| :--- | :--- | :--- | :--- |
| **Fase 1 (Completada)** | **Núcleo Serverless & Seguridad** | PWA 0-Build, QR/Magic Link, GPS obligatorio, Pestañas mensuales automáticas y Sello Criptográfico `HMAC-SHA256`. | Cero costo mensual (`$0`), privacidad total en su propio Google Drive e inmutabilidad ante ediciones manuales. |
| **Fase 2 (Completada)** | **Identidad, Dispositivos y Multi-Hoja** | Directorio `Trabajadores` con ID de 8 dígitos, nombre congelado, rastreo de celulares (`#1`, `#2`...), Perfil de Admin (`ID 9XXX-XXXX` + `PIN de 4 dígitos` + Checador sincronizado), UI de 3 columnas y creación de nuevas hojas en 1 clic con migración selectiva. | Control total de suplantación ("checar por el compañero") y gestión multianual / multisucursal sin tocar código. |
| **Fase 3 (Siguiente)** | **Inteligencia Operativa (Geocercas & KPIs)** | 1) Geocerca opcional por hoja (`✅ En sitio` / `⚠️ A X metros`).<br>2) Generador de pestaña **`📊 Resumen de Horas y Asistencia`** en el menú `🛡️ Cronos`.<br>3) Historial local de los últimos 5 registros en el teléfono del empleado. | Ahorro del 80% del tiempo al auditar nómina semanal/quincenal y validación instantánea de ubicación sin abrir mapa por mapa. |
| **Fase 4 (Futuro)** | **Resiliencia en Campo & Notas** | 1) Cola de envío offline para sótanos/zonas sin cobertura.<br>2) Campo opcional de nota corta o incidencia al checar (ej. *"Tráfico por lluvia"*, *"Material entregado"*). | Operación ininterrumpida en sitios difíciles y contexto inmediato para supervisores. |
