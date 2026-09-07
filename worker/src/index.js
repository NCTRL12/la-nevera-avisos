/**
 * Worker de borrado para la web de avisos de La Nevera.
 *
 * Existe por una razón: la web es pública, así que la contraseña y el token
 * de Airtable con permiso de escritura no pueden estar en el HTML. Viven aquí,
 * como secretos de Cloudflare, y este Worker es el único que los ve.
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

/** Comparación en tiempo constante, para no filtrar la contraseña por el tiempo de respuesta. */
function iguales(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a || '');
  const y = enc.encode(b || '');
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
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

    const { password, recordId } = cuerpo || {};

    if (!iguales(password, env.PASSWORD_BORRADO)) {
      // Pequeño retardo para que probar contraseñas a lo bruto sea incómodo.
      await new Promise((r) => setTimeout(r, 700));
      return json({ ok: false, error: 'Contraseña incorrecta' }, 401, cors);
    }

    if (!/^rec[A-Za-z0-9]{14}$/.test(recordId || '')) {
      return json({ ok: false, error: 'Identificador de aviso no válido' }, 400, cors);
    }

    const url = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}/${recordId}`;
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN_RW}` },
    });

    if (!r.ok) {
      const detalle = await r.text();
      return json(
        { ok: false, error: `Airtable no pudo borrar el aviso (${r.status})`, detalle },
        502,
        cors
      );
    }

    return json({ ok: true, borrado: recordId }, 200, cors);
  },
};
