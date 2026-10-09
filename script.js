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
