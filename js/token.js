/**
 * Cronos — Token & Google Apps Script URL Utilities
 * Handles Base64URL (UTF-8 safe) encoding/decoding and URL validation.
 */

const SCRIPT_ID_PATTERN = /^[A-Za-z0-9_-]{20,160}$/;

/**
 * Extracts and validates the Google Apps Script deployment ID from a Web App URL.
 * Gives specific, actionable errors for common administrator mistakes.
 *
 * @param {string} rawUrl
 * @returns {{ ok: true, scriptId: string, canonicalUrl: string } | { ok: false, error: string }}
 */
export function parseAppsScriptUrl(rawUrl) {
  const input = (rawUrl || '').trim();
  if (!input) {
    return {
      ok: false,
      error: 'Ingresa la URL de la aplicación web generada en Google Apps Script.'
    };
  }

  if (/docs\.google\.com\/spreadsheets/i.test(input)) {
    return {
      ok: false,
      error: 'Pegaste el enlace de Google Sheets. Ve a Extensiones > Apps Script > Implementar > Aplicación web y copia la URL que termina en /exec.'
    };
  }

  if (/script\.google\.com\/home\/projects/i.test(input) || /\/edit(\?|$)/i.test(input)) {
    return {
      ok: false,
      error: 'Pegaste la URL del editor de código. Presiona el botón azul "Implementar > Nueva implementación" y copia la URL de la aplicación web (/exec).'
    };
  }

  if (/\/macros\/(?:a\/[^/]+\/)?s\/[A-Za-z0-9_-]+\/dev(\?|$)/i.test(input)) {
    return {
      ok: false,
      error: 'Pegaste la URL de prueba (/dev), que bloquea a los trabajadores. Copia la URL de implementación pública que termina en /exec.'
    };
  }

  // Match standard and Google Workspace Web App URLs:
  // https://script.google.com/macros/s/{SCRIPT_ID}/exec
  // https://script.google.com/a/macros/{DOMAIN}/s/{SCRIPT_ID}/exec
  const match = input.match(
    /^https:\/\/script\.google\.com\/(?:a\/)?macros\/(?:[^/]+\/)?s\/([A-Za-z0-9_-]+)\/exec(?:[/?#].*)?$/i
  );

  if (!match || !SCRIPT_ID_PATTERN.test(match[1])) {
    return {
      ok: false,
      error: 'El formato no es válido. Debe comenzar con https://script.google.com/macros/s/... y terminar en /exec.'
    };
  }

  const scriptId = match[1];
  return {
    ok: true,
    scriptId,
    canonicalUrl: buildWebhookUrl(scriptId)
  };
}

/**
 * Builds the canonical Google Apps Script POST endpoint from a scriptId.
 * @param {string} scriptId
 * @returns {string}
 */
export function buildWebhookUrl(scriptId) {
  return `https://script.google.com/macros/s/${encodeURIComponent(scriptId.trim())}/exec`;
}

/**
 * Encodes `{ id, org }` into a compact URL-safe Base64 token (UTF-8 compatible).
 * @param {string} scriptId
 * @param {string} orgName
 * @returns {string}
 */
export function encodeCompanyToken(scriptId, orgName) {
  const cleanId = (scriptId || '').trim();
  const cleanOrg = (orgName || '').trim();
  if (!SCRIPT_ID_PATTERN.test(cleanId)) {
    throw new Error('Identificador de script inválido.');
  }
  if (!cleanOrg) {
    throw new Error('El nombre de la empresa es obligatorio.');
  }

  const json = JSON.stringify({ id: cleanId, org: cleanOrg });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decodes an invitation input: accepts a raw Base64URL token, standard Base64,
 * a full Magic Link URL (`?join=...`), or a pasted WhatsApp message containing the link.
 *
 * @param {string} rawInput
 * @returns {{ ok: true, scriptId: string, orgName: string, token: string } | { ok: false, error: string }}
 */
export function decodeInviteInput(rawInput) {
  const text = (rawInput || '').trim();
  if (!text) {
    return {
      ok: false,
      error: 'Pega el enlace de invitación o el código proporcionado por tu empresa.'
    };
  }

  let candidate = text;

  // 1. Extract URL if embedded inside a full WhatsApp message
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    try {
      const parsedUrl = new URL(urlMatch[0]);
      const joinParam = parsedUrl.searchParams.get('join');
      if (joinParam) {
        candidate = joinParam.trim();
      } else {
        return {
          ok: false,
          error: 'El enlace pegado no contiene un código de invitación válido (?join=...).'
        };
      }
    } catch {
      // Fall through to query regex extraction
    }
  }

  // 2. Also handle partial query strings like "?join=eyJ..." or "join=eyJ..."
  if (candidate === text) {
    const paramMatch = text.match(/(?:^|[?&])join=([A-Za-z0-9+/_=-]+)/);
    if (paramMatch) {
      candidate = paramMatch[1];
    }
  }

  // Strip surrounding whitespace or accidental quotes
  candidate = candidate.replace(/^["'\s]+|["'\s]+$/g, '');
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Keep candidate as-is if not URI-encoded
  }

  // Validate Base64 characters
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(candidate)) {
    return {
      ok: false,
      error: 'El código de invitación tiene un formato no reconocido. Verifica que esté completo.'
    };
  }

  try {
    const standardB64 = candidate.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (standardB64.length % 4)) % 4;
    const padded = standardB64 + '='.repeat(padLen);

    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const decodedJson = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const payload = JSON.parse(decodedJson);

    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.id !== 'string' ||
      typeof payload.org !== 'string'
    ) {
      return {
        ok: false,
        error: 'El código de invitación está incompleto o dañado.'
      };
    }

    const scriptId = payload.id.trim();
    const orgName = payload.org.trim();

    if (!SCRIPT_ID_PATTERN.test(scriptId) || !orgName) {
      return {
        ok: false,
        error: 'Los datos de la empresa en el código no son válidos.'
      };
    }

    return {
      ok: true,
      scriptId,
      orgName,
      token: encodeCompanyToken(scriptId, orgName)
    };
  } catch {
    return {
      ok: false,
      error: 'No se pudo leer el código de invitación. Pide a tu administrador que reenvíe el enlace.'
    };
  }
}

/**
 * Builds the root Magic Link URL (`https://<domain>/<basePath>/?join=<token>`)
 * normalizing away `/admin`, `/admin/`, or `/index.html`.
 *
 * @param {string} token
 * @param {{ origin: string, pathname: string }} [loc]
 * @returns {string}
 */
export function buildMagicLink(token, loc = window.location) {
  let basePath = loc.pathname || '/';
  basePath = basePath
    .replace(/\/admin\/index\.html$/i, '/')
    .replace(/\/admin\/?$/i, '/')
    .replace(/\/index\.html$/i, '/');

  if (!basePath.endsWith('/')) {
    basePath += '/';
  }

  return `${loc.origin}${basePath}?join=${encodeURIComponent(token)}`;
}
