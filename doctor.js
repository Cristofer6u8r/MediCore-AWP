
/* MediCore: agenda de un solo médico. Permisos comprobados por Supabase RLS. */
const doctorPanel = document.getElementById("panel-medico");
const doctorNav = document.getElementById("doctor-nav");
const doctorNoticesNav = document.getElementById("doctor-notices-nav");
const doctorAccountNav = document.getElementById("doctor-account-nav");
const roleLoading = document.getElementById("role-loading");
const doctorPushSlot = document.getElementById("doctor-push-slot");
const patientPushSlot = document.querySelector(".install-actions");
function positionPushControl(doctorMode) {
    if (!doctorPushSlot || !patientPushSlot || !notificationButton || !notificationHelp) return;
    doctorPushSlot.hidden = !doctorMode;
    const destination = doctorMode ? doctorPushSlot : patientPushSlot;
    destination.append(notificationButton, notificationHelp);
}
const brandLink = document.querySelector("a.brand");
const brandTagline = document.querySelector(".brand-text small");
const originalBrandTagline = brandTagline?.textContent || "Gestión clínica inteligente";

function cleanBrowserAddress(removeHash = false) {
    const target = new URL(window.location.href);
    for (const key of Array.from(target.searchParams.keys())) {
        if (/^(utm_[a-z0-9_]+|fbclid|gclid|msclkid)$/i.test(key)) {
            target.searchParams.delete(key);
        }
    }
    if (removeHash) target.hash = "";
    const cleanPath = target.pathname + target.search + target.hash;
    if (cleanPath !== location.pathname + location.search + location.hash) {
        history.replaceState(history.state, "", cleanPath);
    }
}

// Los anclajes aún desplazan la página; después ocultamos el fragmento de la barra.
window.addEventListener("hashchange", () => {
    window.requestAnimationFrame(() => cleanBrowserAddress(true));
});
window.addEventListener("load", () => {
    const anchor = window.location.hash.slice(1);
    if (anchor && !document.body.classList.contains("doctor-mode")) {
        try {
            document.getElementById(decodeURIComponent(anchor))?.scrollIntoView({block:"start"});
        } catch { /* Un hash inválido no debe impedir cargar la página. */ }
    }
    cleanBrowserAddress(true);
});

function setRoleLoading(enabled) {
    document.body.classList.toggle("role-checking", Boolean(enabled));
    if (roleLoading) roleLoading.hidden = !enabled;
}

function showDoctorWorkspace(enabled) {
    const wasDoctor = document.body.classList.contains("doctor-mode");
    document.body.classList.toggle("doctor-mode", Boolean(enabled));
    doctorPanel.hidden = !enabled;
    positionPushControl(enabled);
    for (const item of [doctorNav, doctorNoticesNav, doctorAccountNav]) {
        if (item) item.hidden = !enabled;
    }
    if (brandLink) brandLink.href = enabled ? "#panel-medico" : "#inicio";
    if (brandTagline) brandTagline.textContent = enabled
        ? "Administración de citas" : originalBrandTagline;
    document.title = enabled ? "MediCore | Panel médico" : "MediCore | Agenda médica inteligente";
    const noticesTitle = document.querySelector("#avisos-citas h2");
    if (noticesTitle) noticesTitle.textContent = enabled ? "Avisos del consultorio" : "Avisos de tus citas";
    if (enabled !== wasDoctor) {
        cleanBrowserAddress(true);
        window.scrollTo(0, 0);
        mainNav.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.setAttribute("aria-label", "Abrir menú");
    }
}

const doctorCards = document.getElementById("doctor-appointments");
const doctorStats = document.getElementById("doctor-stats");
const doctorFeedback = document.getElementById("doctor-feedback");
const noticesList = document.getElementById("notices-list");
const noticesFeedback = document.getElementById("notices-feedback");
let doctorAppointments = [];
let doctorActive = false;
let doctorEpoch = 0;
const statusLabels = {requested:"Pendiente",confirmed:"Confirmada",cancelled:"Cancelada"};
const make = (tag,text,cls) => {
    const el=document.createElement(tag);
    if(text!==undefined&&text!==null)el.textContent=String(text);
    if(cls)el.className=cls;
    return el;
};
function calendarLink(item){
    // Sólo las citas confirmadas pueden añadirse como un evento real.
    const start=item.appointment_date.replaceAll("-","")+"T"+item.appointment_time.replace(":","")+"00";
    const h=Number(item.appointment_time.slice(0,2));
    const m=Number(item.appointment_time.slice(3,5));
    const endMinutes=h*60+m+30;
    const end=item.appointment_date.replaceAll("-","")+"T"+String(Math.floor(endMinutes/60)).padStart(2,"0")+String(endMinutes%60).padStart(2,"0")+"00";
    const p=new URLSearchParams({action:"TEMPLATE",text:"Consulta MediCore - "+item.specialty,dates:start+"/"+end,ctz:"America/Mexico_City",details:item.modality==="Videoconsulta"?"Cita confirmada. Consulta tu enlace en MediCore.":"Cita confirmada. Consulta los datos en MediCore."});
    return "https://calendar.google.com/calendar/render?"+p.toString();
}
function videoButton(item){
    if(item.status!=="confirmed"||item.modality!=="Videoconsulta"||!/^medicore-[a-f0-9-]{36}$/.test(item.meeting_room||""))return null;
    const a=make("a",doctorActive?"Iniciar videoconsulta":"Entrar a videoconsulta","button primary");
    a.href="https://meet.jit.si/"+encodeURIComponent(item.meeting_room);
    a.target="_blank";a.rel="noopener noreferrer";
    a.title=doctorActive?"Inicia sesión en Jitsi para comenzar la reunión.":"La reunión comienza cuando entra el médico.";
    return a;
}
function appendCalendarAndVideo(card,item){
    if(item.status!=="confirmed")return;
    const cal=make("a","Añadir a Google Calendar","button outline");
    cal.href=calendarLink(item);cal.target="_blank";cal.rel="noopener noreferrer";
    card.append(cal);
    const call=videoButton(item);
    if(call){
        card.append(call);
        const tip=make("small",doctorActive
            ?"Para comenzar la reunión, Jitsi puede pedirte iniciar sesión como moderador. Después el paciente podrá unirse."
            :"Podrás unirte cuando el médico haya iniciado la reunión.",
            "appointment-help "+(doctorActive?"doctor-help":"patient-help"));
        card.append(tip);
    }
}
async function rpc(name,payload){
    const token=await accessToken();
    const response=await fetch(SB_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload||{})});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Error((data&&data.message)||"No se pudo procesar la operación.");
    return data;
}
async function noticesCall(){
    const token=await accessToken();
    const response=await fetch(SB_URL+"/rest/v1/appointment_notices?select=id,message,created_at,read_at&order=created_at.desc&limit=30",{headers:{apikey:SB_KEY,Authorization:"Bearer "+token}});
    if(!response.ok)throw Error("No se pudieron cargar los avisos.");
    return response.json();
}
async function loadNotices(){
    if(!session?.access_token){noticesList.replaceChildren();noticesFeedback.textContent="Inicia sesión para ver tus avisos.";return;}
    try{
        const notices=await noticesCall();
        noticesList.replaceChildren();
        for(const n of notices){
            const card=make("article",null,"saved-appointment");
            card.append(make("h3",n.read_at?"Actualización":"Nuevo aviso"));
            card.append(make("p",n.message));
            card.append(make("small",new Date(n.created_at).toLocaleString("es-MX")));
            noticesList.append(card);
        }
        noticesFeedback.textContent=notices.length?"Avisos recientes de tu cuenta.":"Todavía no tienes avisos.";
    }catch(e){noticesFeedback.textContent=e.message;}
}
async function syncDoctorUI(){
    const requestId = ++doctorEpoch;
    const signedIn = Boolean(session?.access_token);
    if (!signedIn) {
        doctorActive = false;
        doctorAppointments = [];
        doctorCards.replaceChildren();
        doctorStats.replaceChildren();
        showDoctorWorkspace(false);
        setRoleLoading(false);
        await loadNotices();
        return;
    }
    if (!doctorActive) setRoleLoading(true);
    try {
        const enabled = await rpc("is_medicore_doctor", {});
        if (requestId !== doctorEpoch) return;
        doctorActive = enabled === true;
        showDoctorWorkspace(doctorActive);
        setRoleLoading(false);
        if (!doctorActive) {
            doctorCards.replaceChildren();
            doctorStats.replaceChildren();
            doctorAppointments = [];
        }
        await Promise.all([loadNotices(), doctorActive ? loadDoctorAppointments() : Promise.resolve()]);
    } catch (error) {
        if (requestId === doctorEpoch) {
            doctorActive = false;
            showDoctorWorkspace(false);
            setRoleLoading(false);
            doctorFeedback.textContent = "No se pudo comprobar el acceso médico. Intenta actualizar la página.";
            await loadNotices();
        }
    } finally {
        if (requestId === doctorEpoch) setRoleLoading(false);
    }
}
function renderDoctorStats(){
    const now=today();
    const summaries=[
        ["Total",doctorAppointments.length],
        ["Hoy",doctorAppointments.filter(x=>x.appointment_date===now&&x.status!=="cancelled").length],
        ["Pendientes",doctorAppointments.filter(x=>x.status==="requested").length],
        ["Confirmadas",doctorAppointments.filter(x=>x.status==="confirmed").length],
        ["Canceladas",doctorAppointments.filter(x=>x.status==="cancelled").length]
    ];
    doctorStats.replaceChildren();
    for(const [label,num] of summaries){const s=make("div",null,"doctor-stat");s.append(make("strong",num),make("span",label));doctorStats.append(s);}
}
async function changeDoctorAppointment(item,action,fields={}){
    if(!doctorActive)return;
    doctorFeedback.textContent="Actualizando cita...";
    try{
        await rpc("doctor_update_appointment",{p_appointment_id:item.id,p_action:action,p_date:fields.date||null,p_time:fields.time||null});
        doctorFeedback.textContent="Cita actualizada correctamente.";
        await Promise.all([loadDoctorAppointments(),loadNotices()]);
    }catch(e){doctorFeedback.textContent=e.message;}
}
function renderDoctorAppointments(){
    if(!doctorActive)return;
    const search=document.getElementById("doctor-search").value.toLowerCase().trim();
    const status=document.getElementById("doctor-filter").value;
    doctorCards.replaceChildren();
    const selected=doctorAppointments.filter(x=>(!status||x.status===status)&&
        (!search||[x.specialty,x.modality,x.appointment_date,x.appointment_time,statusLabels[x.status],x.user_id.slice(0,8)].join(" ").toLowerCase().includes(search)));
    for(const item of selected){
        const card=make("article",null,"saved-appointment");
        const header=make("div",null,"appointment-card-header");
        header.append(make("h3",item.specialty),make("span",statusLabels[item.status],"appointment-status "+item.status));
        card.append(header);
        card.append(make("p",prettyDate(item.appointment_date)+" · "+item.appointment_time+" h"));
        card.append(make("p",item.modality));
        card.append(make("p","Paciente: "+item.user_id.slice(0,8)+"…"));
        if(item.status==="requested"){
            const confirm=make("button","Confirmar cita","button primary");
            confirm.type="button";confirm.onclick=()=>changeDoctorAppointment(item,"confirm");
            const reject=make("button","Rechazar","button outline");
            reject.type="button";reject.onclick=()=>{if(window.confirm("¿Rechazar esta solicitud?"))changeDoctorAppointment(item,"reject");};
            card.append(confirm,reject);
        }
        if(item.status!=="cancelled"){
            const form=make("form",null,"reschedule-form");
            const date=make("input");date.type="date";date.min=today();date.value=item.appointment_date;date.required=true;date.setAttribute("aria-label","Nueva fecha");
            const time=make("select");time.setAttribute("aria-label","Nuevo horario");
            for(const value of ["09:00","10:30","12:00","16:00"]){const option=make("option",value);option.value=value;time.append(option);}time.value=item.appointment_time;
            const button=make("button","Reprogramar","button outline");button.type="submit";
            form.append(date,time,button);
            form.addEventListener("submit",async e=>{e.preventDefault();button.disabled=true;await changeDoctorAppointment(item,"reschedule",{date:date.value,time:time.value});button.disabled=false;});
            card.append(form);
        }
        appendCalendarAndVideo(card,item);
        doctorCards.append(card);
    }
    doctorFeedback.textContent=selected.length?"Gestiona cada cita desde las tarjetas.":"No hay citas con esos filtros.";
}
async function loadDoctorAppointments(){
    if(!doctorActive)return;
    doctorFeedback.textContent="Cargando agenda del médico...";
    try{
        doctorAppointments=await dbCall("?select=id,user_id,specialty,appointment_date,appointment_time,modality,status,meeting_room&order=appointment_date.asc,appointment_time.asc&limit=300");
        renderDoctorStats();renderDoctorAppointments();
    }catch(e){doctorFeedback.textContent=e.message;}
}
document.getElementById("doctor-search").addEventListener("input",renderDoctorAppointments);
document.getElementById("doctor-filter").addEventListener("change",renderDoctorAppointments);
document.getElementById("doctor-refresh").addEventListener("click",()=>Promise.all([loadDoctorAppointments(),loadNotices()]));
// Extendemos la vista existente de paciente, sin reemplazar la lógica de inicio de sesión.
const baseLoadAppointments=loadAppointments;
loadAppointments=async function(){
    await baseLoadAppointments();
    if(!session?.access_token)return;
    try{
        const data=await dbCall("?select=id,specialty,appointment_date,appointment_time,modality,status,meeting_room&order=appointment_date.desc&limit=50");
        const cards=appointmentsList.querySelectorAll(".saved-appointment");
        for(let index=0;index<Math.min(cards.length,data.length);index++)appendCalendarAndVideo(cards[index],data[index]);
    }catch(e){console.warn("No se pudieron cargar los enlaces de consulta:",e);}
    await loadNotices();
    if(doctorActive)await loadDoctorAppointments();
};
syncDoctorUI();
