# MediCore PWA

MediCore es una aplicación web progresiva (PWA) responsiva para mostrar el concepto de gestión clínica: agenda de demostración, videoconsulta, recomendaciones contextuales y catálogo informativo.

## Funciones

- Diseño adaptable a escritorio, tablet y móvil.
- PWA instalable con manifest e iconos.
- Caché de la interfaz principal para reabrirla sin conexión tras la primera visita.
- Notificaciones web push con suscripción del navegador, notificación de prueba y endpoint de envío protegido.
- Dominio de Railway con HTTPS/TLS automático.
- El formulario de citas sigue siendo una demostración: no genera citas reales ni almacena información personal.

## Ejecutar en local

Se requiere Node.js 18 o posterior.

```bash
npm install
npm start
```

Abre http://localhost:3000. Para probar push localmente también hacen falta las variables VAPID y un directorio de datos con permisos de escritura.

## Configuración de notificaciones push

Configura estas variables de entorno en Railway (no las guardes en el código ni en GitHub):

- `VAPID_PUBLIC_KEY`: clave pública VAPID que la interfaz solicita a `GET /api/config`.
- `VAPID_PRIVATE_KEY`: clave privada VAPID; solo debe existir en el servidor.
- `VAPID_SUBJECT`: contacto en formato `mailto:correo-que-administres@dominio`.
- `PUSH_ADMIN_TOKEN`: token secreto requerido para enviar notificaciones generales.
- `DATA_DIR=/data`: directorio persistente donde se guardan las suscripciones.

La clave privada y el token administrativo nunca se exponen a la interfaz. Railway monta un volumen persistente en `/data`; sin él las suscripciones podrían perderse al reemplazar el contenedor.

### Activar y probar

1. Abre el sitio desde su dominio HTTPS.
2. Ve a la sección “MediCore PWA” y pulsa “Activar notificaciones”.
3. Acepta el permiso del navegador. MediCore guardará la suscripción y solicitará una notificación push de prueba.
4. Si bloqueaste el permiso anteriormente, habilítalo desde la configuración del sitio del navegador.

### Enviar una notificación a las suscripciones registradas

Llama a `POST /api/push/send` desde un backend confiable o una herramienta administrativa. Incluye el token en el encabezado `Authorization`; nunca lo incluyas en `script.js`, HTML, parámetros URL o una app pública.

```http
POST /api/push/send
Authorization: Bearer <PUSH_ADMIN_TOKEN>
Content-Type: application/json

{
  "title": "Recordatorio de MediCore",
  "body": "Tienes un aviso nuevo.",
  "url": "/#agenda"
}
```

La respuesta contiene cantidades de notificaciones aceptadas, fallidas y suscripciones caducadas eliminadas. El servicio de push del navegador confirma la recepción del mensaje, pero no garantiza que el usuario lo vea inmediatamente.

## Funcionamiento offline

El service worker almacena los recursos propios (HTML, CSS, JavaScript, manifest e iconos) y muestra la interfaz básica después de la primera carga. Las llamadas API no se guardan en caché. El video externo y otros recursos alojados en terceros requieren internet. Las funciones que envían notificaciones también necesitan conexión en el momento del envío.

## HTTPS y despliegue

El dominio actual de Railway es:

https://medicore-awp-production.up.railway.app

Railway administra el certificado TLS para su dominio `up.railway.app`. El servidor redirige HTTP a HTTPS en ese dominio. Un dominio personalizado requiere su propia configuración DNS dentro de Railway, que gestiona su certificado automáticamente.

Los despliegues de la rama `main` se construyen con `npm install` y arrancan con `npm start`. Railway proporciona el puerto mediante `PORT`.

## Comprobaciones

- Confirma en DevTools → Application que el manifest y el service worker estén activos.
- Después de abrir el sitio al menos una vez, prueba el modo offline desde DevTools.
- En DevTools → Application → Service Workers, confirma que la versión de caché es `medicore-pwa-v2`.
- Prueba una suscripción push con un navegador que admita Push API y permisos de notificación.


## Citas persistidas en Supabase

Se usa el proyecto existente Medi_core. La tabla public.appointments registra solicitudes asociadas a cuentas de Supabase Auth. La clave publicable se usa en el navegador; no se usan claves secretas. Las políticas RLS restringen datos por usuario. El estado inicial es requested y la cancelación permite pasar a cancelled. Esta app no confirma citas reales. Para confirmación de correos configura en Supabase Auth > URL Configuration el sitio https://medicore-awp-production.up.railway.app y las Redirect URLs válidas. El modo sin conexión cubre la interfaz; guardar citas requiere internet.
