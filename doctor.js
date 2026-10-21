
/* MediCore: agenda de un solo médico. Permisos comprobados por Supabase RLS. */
const doctorPanel = document.getElementById("panel-medico");
const doctorNav = document.getElementById("doctor-nav");
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
    if(item.status!=="confirmed"||item.modality!=="Videoconsulta"||!/^medicore-[a-f0-9]{36}$/.test(item.meeting_room||""))return null;
    const a=make("a","Entrar a videoconsulta","button primary");
    a.href="https://meet.jit.si/"+encodeURIComponent(item.meeting_room);
    a.target="_blank";a.rel="noopener noreferrer";
    return a;
}
function appendCalendarAndVideo(card,item){
    if(item.status!=="confirmed")return;
    const cal=make("a","Añadir a Google Calendar","button outline");
    cal.href=calendarLink(item);cal.target="_blank";cal.rel="noopener noreferrer";
    card.append(cal);
    const call=videoButton(item);if(call)card.append(call);
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
    const tokenId=++doctorEpoch;
    doctorActive=false;doctorPanel.hidden=true;doctorNav.hidden=true;
    doctorCards.replaceChildren();doctorStats.replaceChildren();
    if(!session?.access_token){loadNotices();return;}
    try{
        const enabled=await rpc("is_medicore_doctor",{});
        if(tokenId!==doctorEpoch)return;
        doctorActive===Boolean(enabled);
        doctorActive=enabled===true;
        doctorPanel.hidden=!doctorActive;doctorNav.hidden=!doctorActive;
        await Promise.all([loadNotices(),doctorActive?loadDoctorAppointments():Promise.resolve()]);
    }catch(e){if(tokenId===doctorEpoch){doctorFeedback.textContent="No se pudo comprobar el acceso médico.";loadNotices();}}
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
        card.append(make("h3",item.specialty));
        card.append(make("p",prettyDate(item.appointment_date)+" · "+item.appointment_time+" h"));
        card.append(make("p",item.modality+" · "+statusLabels[item.status]));
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
