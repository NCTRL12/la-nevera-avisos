# Avisos de avería · La Nevera

Web pública que muestra los avisos de avería que el equipo de La Nevera
registra en Airtable. Funciona sola: no necesita que nadie ni nada esté
ejecutándose, ni ninguna suscripción de IA.

## Cómo funciona

```
Airtable  ──(cada 5 min)──►  GitHub Actions  ──►  data.json  ──►  GitHub Pages
   ▲                                                                    │
   └──────────────  Cloudflare Worker  ◄────── botón "Eliminar" ─────────┘
                    (contraseña + token de escritura)
```

1. **Airtable** es la base de datos. El equipo sigue metiendo los avisos ahí.
2. **GitHub Actions** ejecuta `scripts/generate.mjs` cada 5 minutos: lee Airtable
   y escribe `data.json`. Si los datos no han cambiado **no toca el archivo**,
   así que no hay commit ni despliegue innecesarios.
3. **GitHub Pages** sirve `index.html`, que lee `data.json`.
4. **Cloudflare Worker** (`worker/`) es lo único que ve el token de Airtable con
   permiso de escritura. La web es pública: ahí nunca hay credenciales.

### Sobre el botón "Eliminar aviso"

No pide contraseña, a propósito: el equipo lo usa desde el móvil y tener que
teclear algo cada vez era un incordio. A cambio, **no borra nada de verdad**:
rellena el campo `eliminacion` del registro con la fecha de hoy, y la
sincronización deja de incluir esos avisos. En la web desaparece; en Airtable
sigue estando todo.

Para recuperar un aviso, basta con **vaciar la casilla `eliminacion`** en
Airtable. En la siguiente sincronización vuelve a salir.

Consecuencia que conviene tener clara: como no hay contraseña, cualquiera que
llegue a la web puede ocultar avisos. Nada se pierde y se deshace en un
segundo, pero si algún día molesta, en `worker/src/index.js` está preparado el
sitio donde volver a exigir una clave.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La web entera (un solo archivo) |
| `data.json` | Los avisos. Lo regenera GitHub Actions, no se toca a mano |
| `scripts/generate.mjs` | Lee Airtable y genera `data.json` |
| `.github/workflows/sincronizar-airtable.yml` | El cron de cada 5 minutos |
| `worker/src/index.js` | El Worker de Cloudflare que oculta avisos |
| `worker/wrangler.toml` | Configuración del Worker (aquí NO van secretos) |
| `assets/logo.png` | Logo para modo claro |
| `assets/logo-oscuro.png` | Logo para modo oscuro (logotipo en blanco) |

## Secretos que hay que crear a mano

Nunca están en el código. Se ponen en el panel correspondiente:

**En GitHub** (Settings → Secrets and variables → Actions):

- `AIRTABLE_TOKEN` — token de Airtable con permiso de **lectura**
  (`data.records:read`, `schema.bases:read`) sobre la base de La Nevera.

**En Cloudflare** (el Worker → Settings → Variables and Secrets):

- `AIRTABLE_TOKEN_RW` — token de Airtable con permiso de **escritura**
  (`data.records:write`), necesario para marcar el campo `eliminacion`.
- `AIRTABLE_BASE_ID` — `appOANzgalvLugPP1`
- `AIRTABLE_TABLE_ID` — `tblj3eagIgj8WOc5d`
- `ORIGENES_PERMITIDOS` — ya viene en `wrangler.toml`, no es secreto.

## Detalles que conviene recordar

- **El cron de GitHub Actions tarda en arrancar** la primera vez, a veces horas.
  No es un fallo: mientras tanto, Actions → el workflow → *Run workflow*.
- **Los enlaces de fotos y vídeos de Airtable caducan** a las pocas horas. Por eso
  la sincronización los refresca aunque el contenido no cambie, y la web lo avisa.
- **El Worker se despliega solo** al hacer push, porque está conectado a este
  repositorio (Cloudflare → el Worker → Settings → Builds → Git repository,
  con *Root directory* = `worker`). El editor web de Cloudflare no hace falta.
- **GitHub Pages necesita que el repositorio sea público** en cuentas gratuitas.
