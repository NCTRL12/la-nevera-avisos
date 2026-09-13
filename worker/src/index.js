/**
 * Worker de ocultado de avisos para la web de La Nevera.
 *
 * La web es pública y no pide contraseña, así que este Worker solo sabe hacer
 * tres cosas concretas, y ninguna destruye nada:
 *
 *   ocultar   -> rellena "eliminacion" con la fecha de hoy; la web deja de
 *                mostrar el aviso. Se recupera vaciando esa casilla en Airtable.
 *   terminar  -> pone Estado = "Terminado".
 *   reabrir   -> pone Estado = "Pendiente".
 *
 * Cualquier otra cosa se rechaza. Aunque alguien de fuera llame a este Worker,
 * no puede escribir en ningún otro campo ni borrar un registro.
 *
 * El token de Airtable con permiso de escritura vive aquí como secreto de
 * Cloudflare y nunca sale de este Worker.
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

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
