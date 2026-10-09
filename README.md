# MediCore PWA

Sitio responsivo de MediCore preparado como Aplicación Web Progresiva (PWA).

## Funciones incluidas

- Diseño responsivo con HTML, CSS y JavaScript.
- Menú hamburguesa para pantallas pequeñas.
- Formulario de demostración para resumir una solicitud de cita (no guarda datos).
- `manifest.json` para nombre, colores, iconos, página de inicio y modo de visualización.
- Iconos PNG de 192 y 512 píxeles.
- `sw.js` con caché del shell de la aplicación y soporte básico sin conexión.
- Botón de instalación cuando el navegador emite el evento de instalación.
- Servidor Node sencillo para ejecutar localmente y en Railway.

## Ejecutar en local

Se requiere Node.js instalado.

```bash
npm start
```

Abre http://localhost:3000. El service worker no funcionará de forma confiable al abrir `index.html` mediante `file:///`; usa localhost o HTTPS.

## Revisar la PWA con F12

En Chrome o Edge:
1. Abre `http://localhost:3000`.
2. Presiona F12.
3. Abre Application / Aplicación.
4. Selecciona Manifest y revisa nombre, colores e iconos.
5. En Service Workers verifica que `sw.js` esté registrado.
6. En Network comprueba que `manifest.json` y los iconos respondan con estado 200.

## Desplegar en Railway

1. Sube esta carpeta a un repositorio de GitHub.
2. En Railway elige New Project → Deploy from GitHub repo.
3. Selecciona el repositorio y espera el despliegue.
4. En Settings → Networking genera un dominio público HTTPS.
5. Visita la página mediante ese dominio. El manifest y el service worker están referenciados con rutas relativas.

El servidor usa `process.env.PORT`, que es la variable que proporciona la plataforma.

## Nota sobre los recursos multimedia

La fotografía y el video de referencia están enlazados a Pexels y necesitan internet. La imagen y el video son recursos de referencia, no forman parte de la caché offline. El funcionamiento básico (HTML, CSS, JavaScript, iconos y manifest) se conserva después de la primera carga.

El formulario es demostrativo: no genera citas reales, no envía información a un consultorio y no almacena datos personales.
