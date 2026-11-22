# Pizarra Familiar

Pizarra digital familiar **multiplataforma** (móvil, tableta, ordenador y pantallas táctiles con navegador), inspirada en las funciones de los calendarios de pared tipo Cozyla Calendar+. Es una PWA sin servidor: HTML + CSS + JavaScript, instalable y con funcionamiento sin conexión. Proyecto independiente, no afiliado a Cozyla.

## Funciones

| Función | Qué hace |
|---|---|
| **Panel de inicio** | Reloj, fecha, tiempo (Open-Meteo), agenda de hoy, tareas, menú del día y compra en un vistazo |
| **Calendario** | Vistas mes / semana / día, hasta 8 perfiles con colores, filtro por persona, eventos con repetición, importar/exportar `.ics` (Google, Apple, Outlook) |
| **Tareas y rutinas** | Tareas por persona y momento del día, repetición por días, puntos ⭐ |
| **Premios** | Tienda de recompensas que se canjean con estrellas |
| **Comidas** | Planificador semanal (desayuno/comida/cena), enlace a receta o vídeo |
| **Compra y despensa** | Ingredientes del menú → lista de la compra (ignora lo que ya tienes en la despensa) |
| **Listas** | Listas libres con casillas |
| **Marco de fotos** | Sube fotos y se usan como salvapantallas con reloj |
| **Modo reposo** | Pantalla negra entre la hora de dormir y de despertar |
| **Voz / texto rápido** | «cita con el dentista el martes a las 5», «añade leche a la compra» |
| **Modo pizarra** | Pantalla completa + pantalla siempre encendida |
| **Temas** | Claro / oscuro / automático y color principal |
| **Copia de seguridad** | Exportar/restaurar todo en JSON |
| **Sincronización en la nube** | Login con email (Supabase); solo los emails autorizados leen/editan. Sincroniza datos, ajustes y fotos entre dispositivos |

## Usar

Abre `index.html` con cualquier servidor estático, por ejemplo:

```bash
python3 -m http.server 8080   # y visita http://localhost:8080
```

Publicada en GitHub Pages (Settings → Pages → rama `main`, carpeta `/`) se puede instalar como app desde el navegador.

## Datos y privacidad

Sin iniciar sesión, todo se guarda solo en el dispositivo (`localStorage` e `IndexedDB`). Con sesión iniciada se sincroniza con Supabase: tabla `pf_state` y bucket privado `pf-photos`, protegidos por la lista `pf_allowed` y emails confirmados (ver `supabase/setup.sql`). También se consulta el tiempo a Open-Meteo.

## Limitaciones

- Los cambios simultáneos sobre un mismo dato se resuelven a favor del último dispositivo que sincroniza.
- La importación de un `.ics` por URL depende de que el servidor permita CORS; si no, descarga el archivo e impórtalo.
- El dictado por voz usa la API del navegador (Chrome, Edge, Safari).

## Estructura

```
index.html · manifest.webmanifest · sw.js
css/style.css · js/app.js · icons/
```
