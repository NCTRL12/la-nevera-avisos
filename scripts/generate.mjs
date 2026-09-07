#!/usr/bin/env node
/**
 * generate.mjs — Lee la tabla de avisos de Airtable y escribe data.json.
 *
 * Regla de oro: si los datos NO han cambiado, NO se toca data.json.
 * Así GitHub Actions no genera un commit y un despliegue cada 5 minutos.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = resolve(ROOT, 'data.json');

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

if (!TOKEN || !BASE_ID || !TABLE_ID) {
  console.error('Faltan variables de entorno: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID');
  process.exit(1);
}

/** Decide si un adjunto es foto, vídeo u otra cosa. */
function claseAdjunto(a) {
  const mime = (a.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('video/')) return 'video';
  const ext = (a.filename || '').toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'bmp'].includes(ext)) return 'imagen';
  if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp', 'qt'].includes(ext)) return 'video';
  return 'otro';
}

async function traerTodos() {
  const registros = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) {
      throw new Error(`Airtable respondió ${r.status}: ${await r.text()}`);
    }
    const json = await r.json();
    registros.push(...json.records);
    offset = json.offset;
  } while (offset);
  return registros;
}

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

function huella(avisos) {
  // Las URLs de los adjuntos de Airtable caducan y se regeneran solas.
  // Si las incluyéramos en la comparación, "cambiarían" en cada ejecución
  // y volveríamos a tener un commit cada 5 minutos.
  const sinUrls = avisos.map((a) => ({
    ...a,
    adjuntos: a.adjuntos.map(({ nombre, clase, mime, tamano }) => ({ nombre, clase, mime, tamano })),
  }));
  return JSON.stringify(sinUrls);
}

const registros = await traerTodos();
const avisos = registros
  .map(mapear)
  .sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0));

let anterior = null;
if (existsSync(SALIDA)) {
  try {
    anterior = JSON.parse(readFileSync(SALIDA, 'utf8'));
  } catch {
    anterior = null;
  }
}

const cambiaronDatos = !anterior || huella(anterior.avisos || []) !== huella(avisos);

// Las URLs caducan a las pocas horas: aunque el contenido "de fondo" no cambie,
// hay que refrescarlas de vez en cuando o los adjuntos dejarán de verse.
const HORAS_REFRESCO = 3;
const generadoAntes = anterior?.generado ? Date.parse(anterior.generado) : 0;
const urlsViejas =
  avisos.some((a) => a.adjuntos.length > 0) &&
  Date.now() - generadoAntes > HORAS_REFRESCO * 60 * 60 * 1000;

if (!cambiaronDatos && !urlsViejas) {
  console.log(`Sin cambios: ${avisos.length} avisos. No se toca data.json.`);
  process.exit(0);
}

const salida = {
  generado: new Date().toISOString(),
  total: avisos.length,
  avisos,
};

writeFileSync(SALIDA, JSON.stringify(salida, null, 2) + '\n', 'utf8');
console.log(
  cambiaronDatos
    ? `Datos nuevos: ${avisos.length} avisos escritos en data.json.`
    : `Refrescando URLs de adjuntos (caducan a las pocas horas): ${avisos.length} avisos.`
);
