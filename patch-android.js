/**
 * Ajusta el proyecto Android generado por `npx cap add android`:
 *  - copia iconos, icono de notificación y pantallas de arranque
 *  - añade permisos de alarmas exactas y notificaciones
 *  - pone versionCode/versionName según el número de compilación de GitHub
 *  - color de fondo del arranque en Android 12+
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'android', 'app');
const resDst = path.join(appDir, 'src', 'main', 'res');
const resSrc = path.join(root, 'resources', 'android', 'res');

if (!fs.existsSync(appDir)) {
  console.error('No existe android/. Ejecuta antes: npx cap add android');
  process.exit(1);
}

// 1) Recursos gráficos
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
copyDir(resSrc, resDst);
console.log('✔ Iconos y splash copiados');

// 2) Permisos
const manifestPath = path.join(appDir, 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
const perms = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
];
for (const p of perms) {
  const name = p.match(/name="([^"]+)"/)[1];
  if (!manifest.includes(`"${name}"`)) {
    manifest = manifest.replace('</manifest>', `    ${p}\n</manifest>`);
  }
}
// La actividad debe reajustarse al abrir el teclado
if (!manifest.includes('windowSoftInputMode')) {
  manifest = manifest.replace(/(<activity\b[^>]*?)(\s*>)/, '$1\n            android:windowSoftInputMode="adjustResize"$2');
}
fs.writeFileSync(manifestPath, manifest);
console.log('✔ Permisos y teclado ajustados en el AndroidManifest');

// 3) Versión
const gradlePath = path.join(appDir, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const build = parseInt(process.env.VERSION_CODE || '1', 10);
const base = require(path.join(root, 'package.json')).version.split('.').slice(0, 2).join('.');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${build}`)
               .replace(/versionName\s+"[^"]*"/, `versionName "${base}.${build}"`);
fs.writeFileSync(gradlePath, gradle);
console.log(`✔ Versión ${base}.${build} (code ${build})`);

// 4) Fondo claro del splash de Android 12+
const stylesPath = path.join(resDst, 'values', 'styles.xml');
let styles = fs.readFileSync(stylesPath, 'utf8');
if (!styles.includes('windowSplashScreenBackground')) {
  styles = styles.replace(
    /(<style name="AppTheme.NoActionBarLaunch"[^>]*>)/,
    `$1\n        <item name="windowSplashScreenBackground">#ffffff</item>`
  );
  fs.writeFileSync(stylesPath, styles);
}
console.log('✔ Estilo de arranque ajustado');
