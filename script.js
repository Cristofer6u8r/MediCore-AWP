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

const SB_URL="https://pjayxdpuseaidlovkrpz.supabase.co";
const SB_KEY="sb_publishable_iRaiRLXFVCIkKevN-PqZng_Gaxe1sw8";
const SESSION_KEY="medicore-auth";
let session=null;
try{session=JSON.parse(localStorage.getItem(SESSION_KEY)||"null");}catch{localStorage.removeItem(SESSION_KEY);}
const authForm=document.getElementById("auth-form");
const authFeedback=document.getElementById("auth-feedback");
const appointmentsFeedback=document.getElementById("appointments-feedback");
const appointmentsList=document.getElementById("appointments-list");
const saveButton=document.getElementById("save-appointment");
function saveSession(s){session=s;if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SESSION_KEY);renderAuth();}
function renderAuth(){const active=Boolean(session?.access_token&&session?.user);authForm.hidden=active;document.getElementById("signed-in").hidden=!active;document.getElementById("signed-email").textContent=active?session.user.email:"";saveButton.disabled=!active;saveButton.textContent=active?"Guardar solicitud":"Inicia sesión para guardar";if(!active){appointmentsList.replaceChildren();appointmentsFeedback.textContent="Inicia sesión para ver tus citas.";}}
async function authCall(path,body){const r=await fetch(SB_URL+"/auth/v1/"+path,{method:"POST",headers:{"apikey":SB_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.msg||data.error_description||data.message||"Error de autenticación");return data;}
async function accessToken(){if(!session)throw Error("Inicia sesión primero");if(!session.expires_at||Date.now()/1000>session.expires_at-60){const fresh=await authCall("token?grant_type=refresh_token",{refresh_token:session.refresh_token});saveSession(fresh);}return session.access_token;}
async function login(register){if(!authForm.reportValidity())return;const email=document.getElementById("auth-email").value.trim(),password=document.getElementById("auth-password").value;authFeedback.textContent="Procesando...";const buttons=authForm.querySelectorAll("button");buttons.forEach(b=>b.disabled=true);try{const result=await authCall(register?"signup":"token?grant_type=password",{email,password});document.getElementById("auth-password").value="";if(result.access_token){saveSession(result);authFeedback.textContent="Sesión iniciada.";await loadAppointments();}else authFeedback.textContent="Comprueba tu correo electrónico para confirmar tu registro antes de iniciar sesión.";}catch(e){authFeedback.textContent=e.message;}finally{buttons.forEach(b=>b.disabled=false);}}
authForm.addEventListener("submit",e=>{e.preventDefault();login(false);});
document.getElementById("register-button").addEventListener("click",()=>login(true));
document.getElementById("logout-button").addEventListener("click",()=>{const old=session;saveSession(null);authFeedback.textContent="Sesión cerrada.";if(old?.access_token)fetch(SB_URL+"/auth/v1/logout",{method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+old.access_token}}).catch(()=>{});});
async function dbCall(path,method="GET",body){const token=await accessToken();const r=await fetch(SB_URL+"/rest/v1/appointments"+path,{method,headers:{apikey:SB_KEY,Authorization:"Bearer "+token,"Content-Type":"application/json",Prefer:"return=representation"},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>null);if(!r.ok)throw Error("No se pudo completar la solicitud. Inténtalo de nuevo.");return data;}
function prettyDate(d){return new Date(d+"T12:00:00").toLocaleDateString("es-MX",{year:"numeric",month:"long",day:"numeric"});}
function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
document.getElementById("date").min=today();
async function loadAppointments(){if(!session)return;appointmentsFeedback.textContent="Cargando tus citas...";try{const data=await dbCall("?select=id,specialty,appointment_date,appointment_time,modality,status&order=appointment_date.desc&limit=50");appointmentsList.replaceChildren();for(const item of data){const card=document.createElement("article");card.className="saved-appointment";const title=document.createElement("h3");title.textContent=item.specialty;card.append(title);for(const line of [prettyDate(item.appointment_date),item.appointment_time+" h",item.modality,({requested:"Pendiente",confirmed:"Confirmada",cancelled:"Cancelada"})[item.status]||"Pendiente"]){const p=document.createElement("p");p.textContent=line;card.append(p);}if(item.status==="requested"){const btn=document.createElement("button");btn.className="button outline";btn.textContent="Cancelar solicitud";btn.onclick=async()=>{if(!confirm("¿Cancelar esta solicitud?"))return;btn.disabled=true;try{const changed=await dbCall("?id=eq."+encodeURIComponent(item.id)+"&status=eq.requested","PATCH",{status:"cancelled"});if(changed.length!==1)throw Error("Ya no puede cancelarse.");await loadAppointments();}catch(e){appointmentsFeedback.textContent=e.message;btn.disabled=false;}};card.append(btn);}appointmentsList.append(card);}appointmentsFeedback.textContent=data.length?"Estas son tus solicitudes:":"Todavía no tienes solicitudes de cita.";}catch(e){appointmentsFeedback.textContent=e.message;}}
bookingForm.addEventListener("submit",async e=>{e.preventDefault();if(!session){formMessage.textContent="Inicia sesión primero.";return;}const date=document.getElementById("date").value;if(!date||date<today()){formMessage.textContent="Selecciona una fecha válida, de hoy en adelante.";return;}saveButton.disabled=true;formMessage.textContent="Enviando tu solicitud...";try{const created=await dbCall("","POST",{user_id:session.user.id,specialty:document.getElementById("specialty").value,appointment_date:date,appointment_time:document.getElementById("time").value,modality:document.getElementById("mode").value,status:"requested"});if(created?.length!==1)throw Error("No se pudo completar tu solicitud.");formMessage.textContent="¡Solicitud registrada correctamente! Estado: pendiente. Puedes consultar los detalles en Mis citas.";bookingForm.reset();await loadAppointments();}catch(e){formMessage.textContent=e.message;}finally{saveButton.disabled=false;}});
renderAuth();
(async()=>{if(!session)return;try{const token=await accessToken();const r=await fetch(SB_URL+"/auth/v1/user",{headers:{apikey:SB_KEY,Authorization:"Bearer "+token}});if(!r.ok)throw Error("Sesión expirada");session.user=await r.json();saveSession(session);await loadAppointments();}catch(e){if(navigator.onLine){saveSession(null);authFeedback.textContent="Vuelve a iniciar sesión.";}}})();
