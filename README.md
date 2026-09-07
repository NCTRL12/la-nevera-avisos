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
4. **Cloudflare Worker** (`worker/`) es lo único que ve la contraseña de borrado
   y el token de Airtable con permiso de escritura. La web es pública: ahí nunca
   hay credenciales.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La web entera (un solo archivo) |
| `data.json` | Los avisos. Lo regenera GitHub Actions, no se toca a mano |
| `scripts/generate.mjs` | Lee Airtable y genera `data.json` |
| `.github/workflows/sincronizar-airtable.yml` | El cron de cada 5 minutos |
| `worker/src/index.js` | El Worker de Cloudflare que borra avisos |
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
  (`data.records:write`), necesario para borrar registros.
- `PASSWORD_BORRADO` — la contraseña que protege el botón "Eliminar aviso".
- `AIRTABLE_BASE_ID` — `appOANzgalvLugPP1`
- `AIRTABLE_TABLE_ID` — `tblj3eagIgj8WOc5d`

## Detalles que conviene recordar

- **El cron de GitHub Actions tarda en arrancar** la primera vez, a veces horas.
  No es un fallo: mientras tanto, Actions → el workflow → *Run workflow*.
- **Los enlaces de fotos y vídeos de Airtable caducan** a las pocas horas. Por eso
  la sincronización los refresca aunque el contenido no cambie, y la web lo avisa.
- **El Worker se despliega solo** al hacer push, porque está conectado a este
  repositorio (Cloudflare → el Worker → Settings → Builds → Git repository,
  con *Root directory* = `worker`). El editor web de Cloudflare no hace falta.
- **GitHub Pages necesita que el repositorio sea público** en cuentas gratuitas.
