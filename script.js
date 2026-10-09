const menuToggle = document.getElementById("menu-toggle");
const mainNav = document.getElementById("main-nav");
const bookingForm = document.getElementById("booking-form");
const formMessage = document.getElementById("form-message");
const networkStatus = document.getElementById("network-status");
const installButtons = [
    document.getElementById("install-button"),
    document.getElementById("install-button-bottom")
];

let installPromptEvent = null;

// Menú adaptable para móviles.
menuToggle.addEventListener("click", () => {
    const isOpen = mainNav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
});

document.querySelectorAll("#main-nav a").forEach((link) => {
    link.addEventListener("click", () => {
        mainNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Abrir menú");
    });
});

// Demostración: el formulario presenta un resumen, pero no guarda ni envía una cita real.
bookingForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const specialty = document.getElementById("specialty").value;
    const date = document.getElementById("date").value;
    const time = document.getElementById("time").value;
    const mode = document.getElementById("mode").value;

    const readableDate = new Date(`${date}T12:00:00`).toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "long",
        year: "numeric"
    });

    formMessage.textContent =
        `Resumen de demostración: ${specialty}, ${readableDate}, ${time} h, modalidad ${mode}. No es una cita real.`;
});

// PWA: registrar el service worker para caché y vista básica sin conexión.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            await navigator.serviceWorker.register("./sw.js");
        } catch (error) {
            console.error("No se pudo registrar el service worker:", error);
        }
    });
}

// Mostrar los botones de instalación cuando el navegador ofrezca el evento.
window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptEvent = event;
    installButtons.forEach((button) => {
        if (button) button.hidden = false;
    });
});

installButtons.forEach((button) => {
    if (!button) return;
    button.addEventListener("click", async () => {
        if (!installPromptEvent) {
            if (networkStatus) {
                networkStatus.textContent =
                    "La instalación puede no estar disponible en este navegador. Usa el menú del navegador para buscar «Instalar aplicación» o «Agregar a pantalla de inicio».";
                window.setTimeout(() => { networkStatus.textContent = ""; }, 6000);
            }
            return;
        }

        installPromptEvent.prompt();
        await installPromptEvent.userChoice;
        installPromptEvent = null;
        installButtons.forEach((item) => {
            if (item) item.hidden = true;
        });
    });
});

window.addEventListener("appinstalled", () => {
    installButtons.forEach((button) => {
        if (button) button.hidden = true;
    });
    networkStatus.textContent = "MediCore se instaló correctamente.";
    window.setTimeout(() => { networkStatus.textContent = ""; }, 4500);
});

// Aviso al perder o recuperar conexión.
function updateConnectionStatus() {
    if (!networkStatus) return;
    if (!navigator.onLine) {
        networkStatus.textContent =
            "Estás sin conexión. La estructura principal de MediCore puede seguir disponible; el video requiere internet.";
    } else {
        networkStatus.textContent = "";
    }
}
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

// Notificaciones push: la clave pública llega desde el servidor; la privada nunca sale de Railway.
const notificationButton = document.getElementById("notification-button");
const notificationHelp = document.getElementById("notification-help");
let pushConfiguration = null;

function base64UrlToBytes(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
        bytes[index] = raw.charCodeAt(index);
    }
    return bytes;
}

function setNotificationMessage(message) {
    if (notificationHelp) notificationHelp.textContent = message;
}

async function loadPushConfiguration() {
    if (!notificationButton) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        notificationButton.disabled = true;
        setNotificationMessage("Este navegador no admite notificaciones push. Prueba con una versión reciente de Chrome, Edge o Firefox.");
        return;
    }

    try {
        const response = await fetch("./api/config", { cache: "no-store" });
        if (!response.ok) throw new Error("No se pudo leer la configuración de notificaciones.");
        const config = await response.json();

        if (!config.pushEnabled || !config.vapidPublicKey) {
            notificationButton.disabled = true;
            setNotificationMessage("El servicio de notificaciones todavía no está configurado en el servidor.");
            return;
        }

        pushConfiguration = config;
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        notificationButton.textContent = subscription
            ? "Enviar notificación de prueba"
            : "Activar notificaciones";
        notificationButton.disabled = false;

        if (Notification.permission === "denied") {
            setNotificationMessage("Las notificaciones están bloqueadas en el navegador. Permítelas en la configuración del sitio para activarlas.");
        } else if (subscription) {
            setNotificationMessage("Este dispositivo ya está suscrito a las notificaciones de MediCore.");
        } else {
            setNotificationMessage("Actívalas para recibir avisos de MediCore en este dispositivo.");
        }
    } catch (error) {
        notificationButton.disabled = true;
        setNotificationMessage("No se pudo comprobar el servicio push. Conéctate a internet y vuelve a intentarlo.");
        console.error("Error al cargar la configuración push:", error);
    }
}

if (notificationButton) {
    notificationButton.addEventListener("click", async () => {
        notificationButton.disabled = true;
        try {
            if (!pushConfiguration) await loadPushConfiguration();
            if (!pushConfiguration) return;

            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                    setNotificationMessage("No se concedió permiso para mostrar notificaciones.");
                    return;
                }

                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlToBytes(pushConfiguration.vapidPublicKey)
                });

                const saveResponse = await fetch("./api/push/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(subscription)
                });
                if (!saveResponse.ok) {
                    throw new Error("No se pudo guardar la suscripción de este dispositivo.");
                }
            }

            const testResponse = await fetch("./api/push/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: subscription.endpoint })
            });
            const result = await testResponse.json();
            if (!testResponse.ok) {
                throw new Error(result.error || "No se pudo enviar la notificación de prueba.");
            }

            notificationButton.textContent = "Enviar notificación de prueba";
            setNotificationMessage("Suscripción activa. Se envió una notificación push de prueba a este dispositivo.");
        } catch (error) {
            setNotificationMessage(error.message || "No se pudo activar la notificación. Comprueba tu conexión y vuelve a intentarlo.");
            console.error("Error al activar las notificaciones push:", error);
        } finally {
            notificationButton.disabled = false;
        }
    });
}

loadPushConfiguration();
