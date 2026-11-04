# Especificación Técnica: Cronos · Checador PWA Serverless

## 1. Visión General y Principios de Diseño
Aplicación Web Progresiva (**PWA**) de código abierto para el control de asistencia (**Entrada / Salida**), auditoría de dispositivos y geolocalización GPS verificada con hora oficial de servidor sobre **Google Sheets** y **Google Apps Script**.

* **Infraestructura `$0 USD` (100% Serverless):** Sin bases de datos intermedias; cada organización es dueña de sus hojas de cálculo en su propio Google Drive.
* **Arquitectura 0-Build:** HTML5 + CSS3 + Vanilla JavaScript ES2022 (`< 65 KB` en carga inicial).
* **Sistema Visual Optical Liquid Glass:**
  * Lienzo mineral luminoso (`#EBF0F6`) con refracción ambiental multicapa, contenedores translúcidos (`backdrop-filter: blur(28px) saturate(190%)`) con borde especular interno (`inset 0 1px 0 rgba(255, 255, 255, 0.96)`), pozos ópticos recedidos para campos y diales horológicos, e indicadores geométricos CSS (`.status-pip`).
  * Tipografía intencional: `Instrument Sans` (encabezados), `DM Sans` (cuerpo y controles) y `JetBrains Mono` (reloj tabular, IDs de 8 dígitos y sellos criptográficos).
  * **Cero emojis** tanto en la interfaz web como en las hojas, menús y estados generados por Google Apps Script.

---

## 2. Arquitectura de Datos y Token de Invitación

La vinculación entre dispositivos y hojas de cálculo codifica el `scriptId` del despliegue de Google Apps Script, el nombre de la organización (`org`) y opcionalmente el `sheetId` secundario (`sid`) en un token `Base64URL` dentro del **Código QR** y del **Enlace directo** (`?join=<TOKEN>`).

```json
{
  "id": "AKfycbx...",
  "org": "Asistencia 2027",
  "sid": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
}
```

---

## 3. Flujos de Usuario (UI/UX)

### 3.1 Panel de Administrador de 3 Columnas (`/admin` o `#admin`)
1. **Columna 1 — Perfil Admin y Conexión (`#admin-form-card`):**
   * **Identidad de Administrador:** Nombre completo + ID de 8 dígitos serie `9XXX-XXXX` + PIN de seguridad de exactamente 4 números.
   * **Protección antibrute-force:** Límite de 5 intentos fallidos de PIN con bloqueo exponencial (`15 min → 30 min → 60 min`) en `PropertiesService`.
   * **Sincronización con Checador personal:** Botón directo `Ir a mi Checador` sincronizado con la hoja activa.
2. **Columna 2 — Hojas de Google Sheets y Personal (`#admin-sheets-panel`):**
   * **Catálogo de hojas:** Selección en 1 clic de la hoja activa para el póster QR y el checador del administrador, con enlace directo `Abrir Sheet`.
   * **Nueva hoja en Drive (1 clic):** Crea hojas adicionales en Google Drive sin dejar `"Hoja 1"` sobrante y permite copiar opcionalmente el directorio de `Trabajadores` eligiendo la hoja de origen (`#new-sheet-source-select`).
   * **Personal de la hoja activa (`#admin-workers-box`):** Aprobación de solicitudes (`Pendiente` → `Activo`), baja (`Baja`) y reactivación en 1 clic.
3. **Columna 3 — Código QR y Enlace (`#admin-output-card`):**
   * Póster QR imprimible (`@media print`) y descargable en PNG, enlace directo para WhatsApp y prueba de conexión en vivo.

### 3.2 Acceso del Personal y Checador Diario
1. **Registro e inicio de sesión (`#view-register`):**
   * **Soy nuevo:** Asigna un ID numérico de 8 dígitos (`1000-0000` a `8999-9999`), vincula el nombre de forma permanente y registra la solicitud en estado `Pendiente` hasta la aprobación del administrador.
   * **Ya tengo mi ID:** Recupera el perfil oficial desde `Trabajadores` al ingresar los 8 dígitos (o desbloquea el modo Administrador al ingresar un ID serie `9` + PIN de 4 números).
2. **Checador diario (`#view-checador`):**
   * **Estado inteligente de turno (`#smart-shift-banner`):** Sugiere `SALIDA` tras una `ENTRADA` activa y viceversa.
   * **Cola Offline (`cronos_offline_queue`):** Captura coordenadas GPS satelitales cuando no hay red de datos y sincroniza automáticamente al recuperar conexión.
   * **Últimos registros (`#worker-history-box`) y Recibo firmado:** Muestra los últimos 5 registros locales con folio mensual (`#0001`), sello `HMAC-SHA256` y copia de comprobante en 1 clic (`Recibo`).
   * **Modo Kiosco (`#modal-kiosk`):** Teclado numérico para terminales compartidas o casetas de vigilancia por ID de 8 dígitos.

---

## 4. Motor Backend en Google Apps Script (`backend/Code.gs`)

1. **Gestión automática de pestañas:**
   * Crea pestañas mensuales (`Octubre 2026`, `Noviembre 2026`...) colocadas siempre en la primera posición a la izquierda y elimina cualquier `"Hoja 1"` vacía por defecto.
   * Genera y actualiza en cada marca la pestaña **`Resumen Mensual`** con KPIs globales y tabla por empleado (*Días asistidos, Entradas, Salidas, Turnos cerrados, Horas trabajadas, Promedio/turno, Alertas y Estado actual*).
2. **Directorio `Trabajadores` (8 columnas) y Bloqueo en 5 Ángulos:**
   * Columnas: `ID Empleado (8 dígitos)`, `Nombre Completo (Congelado)`, `Estatus de Dispositivos`, `Celular Principal (Serie #1)`, `Historial de Celulares Usados`, `Primer Registro`, `Última Actividad` y `Estatus de Acceso` (`Activo`, `Pendiente`, `Baja`).
   * Bloquea en los 5 ángulos cualquier cuenta marcada como `Baja` sin contaminar dispositivos de terceros.
3. **Cadena Criptográfica `HMAC-SHA256`:**
   * Firma cada fila encadenándola con el sello inmediato anterior del mismo mes (`CRN-YYYYMM-XXXX-...`), verifica integridad al editar (`onEdit`) y expone el menú **`Cronos`** en Google Sheets.
