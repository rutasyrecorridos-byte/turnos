# Turnos · gestión de turnos, anotaciones y alertas

App Android (Capacitor 7) basada en `calendario.html`. Funciona **sin cobertura**: no depende de Tailwind, Lucide ni Google Fonts por CDN; todo va dentro del APK.

## Qué hace

- **Calendario mensual y anual** con colores por tipo de turno, abreviatura en cada día y marcas de nota (•), alerta (• ámbar) y horas extra.
- **Modo Pintar**: eliges un turno y vas tocando días para asignarlo rápido.
- **Ciclos de turnos**: define una secuencia (p. ej. 7 Servicio + 7 Libre) y aplícala a un periodo.
- **Anotaciones** por día y **horas extra**.
- **Alertas programadas** (notificaciones locales, suenan con la app cerrada y el móvil bloqueado):
  - Recordatorios con día, hora, antelación (a la hora … 2 días antes) y repetición (diaria, semanal, mensual, anual).
  - **Aviso antes de cada turno** si el tipo de turno tiene hora de entrada.
  - Se reprograman solas al reiniciar el móvil y cada vez que abres la app (ventana de 60 días).
- **Resumen** anual/mensual de horas, días trabajados y horas extra.
- **Copia de seguridad** exportable (menú Compartir → Drive, WhatsApp, Archivos…) e importable. Lee también las copias JSON de la versión web anterior.

## Estructura

```
www/                  → la app (HTML + CSS + JS, sin dependencias externas)
resources/            → icono.svg, capas del icono adaptativo, icono de notificación
resources/android/res → PNG ya generados (iconos, splash, icono de notificación)
scripts/patch-android.js   → copia iconos, añade permisos y pone la versión
scripts/generate_icons.py  → regenera los PNG si cambias el SVG
keystore/debug.keystore    → firma fija para poder actualizar sin desinstalar
.github/workflows/android.yml → compilación automática del APK
```

La carpeta `android/` **no se sube**: GitHub Actions la crea en cada compilación.

## Compilar en GitHub

1. Crea un repositorio nuevo (recomendado **privado**) y sube todo el contenido de esta carpeta, incluida la carpeta `.github`.
2. Cada `push` a `main` lanza **Actions → Compilar APK Android** (unos 5–8 min). También puedes lanzarlo a mano con *Run workflow*.
3. Descarga el APK en la ejecución terminada → **Artifacts** → `Turnos-1.0.N` (viene en un .zip).
4. Para publicar una versión con el APK adjunto: crea una etiqueta `v1.0.0` (Releases → *Draft a new release*).

## Instalar y primer uso

1. Instala el APK (permite *instalar apps de origen desconocido* si lo pide).
2. Al abrir, acepta **Notificaciones**.
3. En **Ajustes → Alertas** pulsa *Probar (10 s)* y bloquea el móvil para comprobarlo.
4. Recomendado: Ajustes de Android → Aplicaciones → Turnos → Batería → **Sin restricciones** (algunas marcas como Xiaomi, Huawei o Samsung retrasan avisos si no).
5. Pon la **hora de entrada** en cada tipo de turno si quieres aviso antes de empezar.

## Actualizaciones

Todas las compilaciones se firman con `keystore/debug.keystore`, así que el APK nuevo se instala **encima** del anterior y conserva los datos. Si borras o cambias ese archivo, tendrás que desinstalar (y perderías los datos: exporta antes una copia).

## Cambiar el icono

Edita `resources/icon.svg` (y, si quieres, `icon-foreground.svg`, `icon-monochrome.svg`, `notification.svg`) y ejecuta:

```
pip install cairosvg pillow
python scripts/generate_icons.py
```

## Probar en el ordenador

Abre `www/index.html` en el navegador: todo funciona salvo las alertas (solo suenan en Android).
