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
5. **Vincular con Cronos y activar tu Perfil de Administrador:**
   * Copia la **URL de la aplicación web** que termina en `/exec`.
   * Abre Cronos en modo Administrador (`/#admin` o `/admin`), escribe el nombre de tu empresa/hoja, pega la URL, define un **PIN de Admin** (opcional) y presiona **Generar Acceso y Conectar Perfil**.
   * Presiona **Probar conexión** para verificar que se inserte una fila de prueba en tu hoja, e imprime el **Cartel QR** o comparte el **Magic Link por WhatsApp** con tu equipo.
6. **Crear nuevas hojas de Google Sheets en 1 clic (sin volver a tocar Apps Script):**
   * Una vez configurado tu conector por primera vez, desde la sección **Mis Hojas de Google Sheets** en `/admin` puedes escribir el nombre de un nuevo archivo (ej. *Asistencia Limpieza 2027*), elegir opcionalmente si deseas **copiar la pestaña `Trabajadores` de la hoja actual** (desmarcado por defecto, para que tú decidas si conservar los IDs de 8 dígitos, nombres congelados e historial de celulares) y presionar **`➕ Crear nuevo Google Sheets y generar QR`**.
   * El conector creará el nuevo archivo directamente en tu Google Drive con su pestaña mensual y directorio listos, y generará su nuevo código QR y enlace de invitación al instante.

### Pestañas Mensuales, Diseño Automático y Sello Criptográfico (`backend/Code.gs`)

El código completo del conector se encuentra en [`backend/Code.gs`](./backend/Code.gs) y también cuenta con botón **Copiar código** dentro del Panel de Administrador (`/admin`). Desde el **primer registro**, configura automáticamente tu libro de Google Sheets:

* **Privacidad de la hoja:** Tu archivo de Google Sheets permanece **100% privado** en tu Google Drive; `"Cualquier usuario"` únicamente habilita el envío al webhook `doPost`, sin dar permiso de lectura ni escritura directa sobre el archivo.
* **Organización automática por mes:** Cada registro se guarda en la pestaña del mes correspondiente según la hora oficial y zona horaria del Sheets (ej. `Octubre 2026`, `Noviembre 2026`...). Al iniciar un nuevo mes, en la primera marca recibida a partir del día 1 a las `00:00:00`, el script crea automáticamente la pestaña del nuevo mes y la coloca **al inicio (primera a la izquierda)** con pestaña en verde esmeralda (atenuando los meses anteriores a gris pizarra).
* **Directorio automático `Trabajadores` (ID de 8 dígitos + Nombre Congelado + Serie de Celular con índice fijo):**
  * Al registrarse por primera vez, a cada trabajador se le asigna un **ID único numérico de 8 dígitos** (ej. `4829-1034`) y su nombre completo queda **congelado** en la pestaña `Trabajadores` para evitar variaciones o errores de escritura.
  * El sistema registra el identificador único del celular titular de cada empleado (`CEL-XXXXXXXX`) y mantiene una columna tipo lista numerada (`1)`, `2)`, `3)`...) con todos los dispositivos únicos que han usado su ID.
  * Si un trabajador inicia sesión con su ID de 8 dígitos en el celular de un compañero (ej. porque se le descargó su teléfono o pidió que checaran por él), el registro **no se bloquea**, pero la columna **`Dispositivo / Auditoría`** señala claramente en rojo/ámbar de quién es el celular utilizado (`🚨 Celular de Juan Pérez`) o el número fijo del equipo adicional (`⚠️ Celular adicional #2`, `⚠️ Celular adicional #3`, conservando siempre el número asignado a cada dispositivo en la lista).
* **Diseño visual automático:** Encabezado oscuro congelado (`42 px`), filtros activos, anchos de columna holgados, filas de `34 px` con bandas alternadas, etiquetas de color automáticas (`ENTRADA` en verde, `SALIDA` en azul, `PRUEBA` en ámbar), precisión formateada en metros (`15 m`) y enlace limpio **`📍 Abrir en Maps`**.
* **Sello Criptográfico Encadenado por Mes (`HMAC-SHA256`):** Cada fila se firma en el servidor con una llave secreta privada guardada en `PropertiesService` (invisible desde la hoja), incluyendo año-mes, folio consecutivo, ID del trabajador, auditoría de dispositivo y el sello de la fila anterior (`🔒 CRN-202611-0001-...`).
  * **Detección inmediata (`onEdit`):** Si alguien con acceso al archivo edita manualmente cualquier celda o mueve filas entre meses, el sello se marca en **rojo** al instante con una alerta.
  * **Menú `🛡️ Cronos` en Google Sheets:** Permite ejecutar **🔍 Auditar pestaña actual (HMAC)**, **🗂️ Auditar todos los meses** y **🎨 Reaplicar diseño visual a esta pestaña**.

---

## Flujo del Trabajador

1. **Vinculación única:** El trabajador abre el **Magic Link** enviado por WhatsApp o escanea el **Código QR** de la empresa (funciona tanto desde la cámara nativa del celular como desde el lector integrado en Cronos).
2. **Registro local o inicio de sesión por ID:**
   * **Soy nuevo:** Ingresa su nombre completo, recibe su **ID numérico de 8 dígitos** (ej. `4829-1034`) y acepta el aviso de privacidad. Su nombre queda fijo para evitar variaciones.
   * **Ya tengo mi ID:** Si cambia de teléfono o necesita checar desde el celular de un compañero, solo ingresa sus **8 dígitos** y el sistema recupera automáticamente su nombre oficial desde la hoja.
3. **Uso diario:** Dos botones táctiles de alto contraste (**REGISTRAR ENTRADA** y **REGISTRAR SALIDA**) con protección contra doble toque accidental (< 5 min), GPS obligatorio y recibo visual con la **hora oficial del servidor de Google**.
4. **Menú de Opciones (3 acciones claras):**
   * **Cambiar QR / Hoja (`Mantiene tu sesión`):** Escanea un nuevo QR o enlace (ej. al pasar de la hoja *2026* a *2027*) conservando su sesión, nombre congelado e ID de 8 dígitos en un solo paso.
   * **Cambiar sesión (`Misma empresa`):** Permite que otro compañero ingrese con su ID de 8 dígitos dentro de la misma empresa sin perder la vinculación de la hoja.
   * **Cerrar sesión (`Borra datos`, en rojo):** Desvincula y borra del celular la empresa (QR/Sheets), el usuario y la sesión activa.

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
