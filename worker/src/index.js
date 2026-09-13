/**
 * Worker de La Nevera: lectura en vivo + acciones sobre los avisos.
 *
 * La web es pública y no pide contraseña, así que este Worker solo sabe hacer
 * cuatro cosas concretas, y ninguna destruye nada:
 *
 *   leer      -> devuelve los avisos tal cual están AHORA en Airtable, con el
 *                mismo formato que data.json. Es lo que hace que un borrado o
 *                un "terminado" se vea al instante, sin esperar a GitHub.
 *   ocultar   -> rellena "eliminacion" con la fecha de hoy; la web deja de
 *                mostrar el aviso. Se recupera vaciando esa casilla en Airtable.
 *   terminar  -> pone Estado = "Terminado".
 *   reabrir   -> pone Estado = "Pendiente".
 *
 * Cualquier otra cosa se rechaza. Aunque alguien de fuera llame a este Worker,
 * no puede escribir en ningún otro campo ni borrar un registro.
 *
 * El token de Airtable vive aquí como secreto de Cloudflare y nunca sale.
 */

function cabecerasCors(request, env) {
  const permitidos = (env.ORIGENES_PERMITIDOS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const origen = request.headers.get('Origin') || '';
  const ok = permitidos.includes(origen);

  return {
    'Access-Control-Allow-Origin': ok ? origen : permitidos[0] || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(cuerpo, estado, cors) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors,
    },
  });
}

/* ---------- Lectura ---------- */

/** Decide si un adjunto es foto, vídeo u otra cosa. Igual que generate.mjs. */
function claseAdjunto(a) {
  const mime = (a.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  const ext = (a.filename || '').toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'bmp'].includes(ext)) return 'imagen';
  if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', 'qt'].includes(ext)) return 'video';
  return 'otro';
}

/** Un registro de Airtable -> un aviso de la web. Igual que generate.mjs. */
function mapear(rec) {
  const f = rec.fields || {};
  const adjuntos = (f['Foto/Vídeo'] || []).map((a) => ({
    nombre: a.filename || 'adjunto',
    url: a.url,
    mime: a.type || '',
    clase: claseAdjunto(a),
    miniatura: a.thumbnails?.large?.url || a.thumbnails?.small?.url || null,
    tamano: a.size || 0,
  }));

  return {
    id: rec.id,
    numero: f['ID'] ?? null,
    cliente: (f['Cliente'] || '').trim(),
    emplazamiento: (f['Lugar'] || f['Emplazamiento'] || '').trim(),
    maquina: (f['Máquina/Dispositivo'] || '').trim(),
    fecha: f['Fecha/Hora'] || null,
    estado: (f['Estado'] || 'Pendiente').trim(),
    paro: (f['Avería con paro'] || '') === 'Sí',
    descripcion: (f['Descripción'] || '').trim(),
    identificado: (f['Identifícate'] || '').trim(),
    urlPublica: (f['URL Imagen Pública'] || '').trim(),
    adjuntos,
  };
}

async function leerAvisos(env) {
  const registros = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN_RW}` },
    });
    if (!r.ok) {
      throw new Error(`Airtable respondió ${r.status}`);
    }
    const datos = await r.json();
    registros.push(...datos.records);
    offset = datos.offset;
  } while (offset);

  return registros
    // Los avisos con fecha en "eliminacion" los ha ocultado alguien desde la web.
    .filter((rec) => !(rec.fields || {})['eliminacion'])
    .map(mapear)
    .sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0));
}

/* ---------- Punto de entrada ---------- */

export default {
  async fetch(request, env) {
    const cors = cabecerasCors(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Método no permitido' }, 405, cors);
    }

    // No es autenticación de verdad (un script puede saltárselo), pero corta
    // el uso casual desde otras webs. La red de seguridad real es que esto
    // no borra: marca. Todo se puede deshacer desde Airtable.
    const permitidos = (env.ORIGENES_PERMITIDOS || '').split(',').map((o) => o.trim());
    const origen = request.headers.get('Origin') || '';
    if (origen && !permitidos.includes(origen)) {
      return json({ ok: false, error: 'Origen no autorizado' }, 403, cors);
    }

    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      return json({ ok: false, error: 'Petición mal formada' }, 400, cors);
    }

    const { recordId, accion } = cuerpo || {};

    // Lectura en vivo: no lleva recordId y no escribe nada.
    if (accion === 'leer') {
      try {
        const avisos = await leerAvisos(env);
        return json(
          { ok: true, generado: new Date().toISOString(), total: avisos.length, avisos },
          200, cors
        );
      } catch (err) {
        return json({ ok: false, error: `No se pudo leer Airtable · ${err.message}` }, 502, cors);
      }
    }

    if (!/^rec[A-Za-z0-9]{14}$/.test(recordId || '')) {
      return json({ ok: false, error: 'Identificador de aviso no válido' }, 400, cors);
    }

    // Lista blanca: esto es lo único que este Worker puede escribir.
    const hoy = new Date().toISOString().slice(0, 10);
    const CAMBIOS = {
      ocultar: { eliminacion: hoy },
      terminar: { Estado: 'Terminado' },
      reabrir: { Estado: 'Pendiente' },
    };

    // Sin "accion" se asume ocultar, para no romper nada que ya llame así.
    const cambio = CAMBIOS[accion || 'ocultar'];
    if (!cambio) {
      return json({ ok: false, error: 'Acción no permitida' }, 400, cors);
    }

    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}/${recordId}`;

    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN_RW}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: cambio }),
    });

    if (!r.ok) {
      const detalle = await r.text();
      return json(
        { ok: false, error: `Airtable no aceptó el cambio (${r.status})`, detalle },
        502, cors
      );
    }

    return json({ ok: true, recordId, accion: accion || 'ocultar', cambio }, 200, cors);
  },
};
