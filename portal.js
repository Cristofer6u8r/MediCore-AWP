"use strict";
(() => {
const SB_URL = "https://pjayxdpuseaidlovkrpz.supabase.co";
const SB_KEY = "sb_publishable_iRaiRLXFVCIkKevN-PqZng_Gaxe1sw8";
const STORAGE = "medicore-auth";
const page = document.body.dataset.page || "home";
const $ = (id) => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
let session;
try { session = JSON.parse(localStorage.getItem(STORAGE) || "null"); } catch { session = null; }
let isDoctor = false;
let pushConfiguration = null;
let appointments = [];
const statusText = { requested:"Pendiente", confirmed:"Confirmada", cancelled:"Cancelada" };
function message(id, value) { const target = $(id); if (target) target.textContent = value; }
function saveSession(next) {
  session = next;
  if (next) localStorage.setItem(STORAGE, JSON.stringify(next));
  else localStorage.removeItem(STORAGE);
}
function requireLoginText(id) {
  message(id, 'Para continuar, inicia sesión en Mi cuenta.');
}
async function authRequest(path, data) {
  const r = await fetch(SB_URL + "/auth/v1/" + path, {
    method:"POST", headers:{ apikey:SB_KEY, "Content-Type":"application/json" }, body:JSON.stringify(data)
  });
  const payload = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(payload.msg || payload.error_description || payload.message || "No fue posible iniciar sesión.");
  return payload;
}
async function token() {
  if (!session?.access_token) throw Error("Inicia sesión primero.");
  if (!session.expires_at || Date.now() / 1000 >= session.expires_at - 60) {
    const result = await authRequest("token?grant_type=refresh_token", {refresh_token:session.refresh_token});
    saveSession(result);
  }
  return session.access_token;
}
async function api(tableAndQuery, method="GET", body) {
  const bearer = await token();
  const r = await fetch(SB_URL + "/rest/v1/" + tableAndQuery, {
    method, headers: { apikey:SB_KEY, Authorization:"Bearer " + bearer, "Content-Type":"application/json", Prefer:"return=representation" },
    body:body === undefined ? undefined : JSON.stringify(body), cache:"no-store"
  });
  const payload = await r.json().catch(() => null);
  if (!r.ok) throw Error(payload?.message || "No se pudo completar la operación. Inténtalo de nuevo.");
  return payload;
}
async function rpc(functionName, payload={}) {
  const bearer = await token();
  const r = await fetch(SB_URL + "/rest/v1/rpc/" + functionName, {
    method:"POST", headers:{apikey:SB_KEY, Authorization:"Bearer " + bearer, "Content-Type":"application/json"},
    body:JSON.stringify(payload), cache:"no-store"
  });
  const result = await r.json().catch(() => null);
  if (!r.ok) throw Error(result?.message || "No se pudo completar la operación.");
  return result;
}
function dateToday() {
  const format = new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"});
  const parts = Object.fromEntries(format.formatToParts(new Date()).filter(x=>x.type !== "literal").map(x=>[x.type,x.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}
function prettyDate(value) {
  return new Date(value + "T12:00:00").toLocaleDateString("es-MX", {day:"numeric",month:"long",year:"numeric"});
}
function calendarUrl(appointment) {
  const date = appointment.appointment_date.replaceAll("-","");
  const start = date + "T" + appointment.appointment_time.replace(":","") + "00";
  const minutes = Number(appointment.appointment_time.slice(0,2))*60 + Number(appointment.appointment_time.slice(3,5)) + 30;
  const end = date+"T"+String(Math.floor(minutes/60)).padStart(2,"0")+String(minutes%60).padStart(2,"0")+"00";
  const p = new URLSearchParams({action:"TEMPLATE",text:"Cita MediCore - "+appointment.specialty,
    dates:start+"/"+end,ctz:"America/Mexico_City",
    details:"Consulta confirmada. Revisa los detalles y el enlace de videoconsulta en MediCore."});
  return "https://calendar.google.com/calendar/render?" + p;
}
function addCallActions(card,item,forDoctor) {
  if (item.status !== "confirmed") return;
  const group = make("div",null,"card-actions");
  const cal = make("a","Añadir a Google Calendar","button outline");
  cal.href=calendarUrl(item);cal.target="_blank";cal.rel="noopener noreferrer";group.append(cal);
  if(item.modality==="Videoconsulta" && /^medicore-[a-f0-9-]{36}$/i.test(item.meeting_room || "")) {
    const link=make("a",forDoctor?"Iniciar videoconsulta":"Entrar a videoconsulta","button primary");
    link.href="https://meet.jit.si/"+encodeURIComponent(item.meeting_room);
    link.target="_blank";link.rel="noopener noreferrer";
    group.append(link);
    card.append(group,make("p",forDoctor
      ?"Para comenzar, inicia sesión en Jitsi como moderador. Después podrá entrar el paciente."
      :"Entra cuando el médico haya iniciado la reunión.", "appointment-help"));
    return;
  }
  card.append(group);
}
function addDetail(card,iconLabel,label) {
  const line=make("div",null,"appointment-detail");
  const icon=make("span",iconLabel,"detail-symbol");icon.setAttribute("aria-hidden","true");
  line.append(icon,make("span",label));card.append(line);
}
function addAppointmentCard(item,asDoctor=false) {
  const card=make("article",null,"saved-appointment");
  const head=make("div",null,"appointment-card-header");
  head.append(make("h3",item.specialty),make("span",statusText[item.status]||item.status,"appointment-status "+item.status));
  card.append(head);
  addDetail(card,"▦",prettyDate(item.appointment_date));
  addDetail(card,"◷",item.appointment_time+" h");
  addDetail(card,"⌁",item.modality);
  if (asDoctor) addDetail(card,"ID","Paciente · "+item.user_id.slice(0,8)+"…");
  if (!asDoctor && item.status==="requested") {
    card.append(make("p","Esta solicitud está pendiente de revisión.","appointment-help"));
    const cancel=make("button","Cancelar solicitud","button outline");
    cancel.type="button";
    cancel.addEventListener("click", async()=>{
      if(!window.confirm("¿Cancelar esta solicitud pendiente?"))return;
      cancel.disabled=true;
      try {
        const result=await api("appointments?id=eq."+encodeURIComponent(item.id)+"&status=eq.requested","PATCH",{status:"cancelled"});
        if (!Array.isArray(result)||result.length!==1) throw Error("Esta solicitud ya no está pendiente.");
        if(page==="home")await loadHome();else await loadPatientAppointments();
      } catch(e){message("appointments-feedback",e.message);cancel.disabled=false;}
    });
    card.append(cancel);
  }
  if (asDoctor && item.status==="requested") {
    const actions=make("div",null,"card-actions");
    for(const [name,action] of [["Confirmar","confirm"],["Rechazar","reject"]]){
      const b=make("button",name,action==="confirm"?"button primary":"button outline");
      b.type="button";
      b.addEventListener("click",async()=>{
        if (action==="reject"&&!window.confirm("¿Rechazar esta solicitud?"))return;
        b.disabled=true;
        await changeDoctorAppointment(item,action);
        b.disabled=false;
      });
      actions.append(b);
    }
    card.append(actions);
  }
  if(asDoctor && item.status!=="cancelled"){
    const form=make("form",null,"reschedule-form");
    const date=make("input");date.type="date";date.value=item.appointment_date;date.min=dateToday();date.required=true;
    date.setAttribute("aria-label","Fecha nueva");
    const time=make("select");time.setAttribute("aria-label","Horario nuevo");
    for(const hour of ["09:00","10:30","12:00","16:00"]){
      const option=make("option",hour);option.value=hour;time.append(option);
    }
    time.value=item.appointment_time;
    const b=make("button","Reprogramar","button outline");b.type="submit";
    form.append(date,time,b);
    form.addEventListener("submit",async(e)=>{
      e.preventDefault();b.disabled=true;
      await changeDoctorAppointment(item,"reschedule",{p_date:date.value,p_time:time.value});
      b.disabled=false;
    });
    card.append(form);
  }
  addCallActions(card,item,asDoctor);
  return card;
}
function showSummary(target, stats) {
  if(!target)return;
  target.replaceChildren();
  for(const [label,value] of stats){
    const tile=make("div",null,"overview-tile");
    tile.append(make("strong",value),make("span",label));
    target.append(tile);
  }
}
async function loadPatientAppointments() {
  const container=$("appointments-list");
  if(!container)return;
  if(!session){requireLoginText("appointments-feedback");return;}
  message("appointments-feedback","Cargando tus citas…");
  try {
    const data=await api("appointments?select=id,specialty,appointment_date,appointment_time,modality,status,meeting_room&order=appointment_date.desc&limit=100");
    container.replaceChildren();
    const today=dateToday();
    showSummary($("patient-overview"),[
      ["Solicitudes",data.length],
      ["Próximas",data.filter(x=>x.appointment_date>=today&&x.status!=="cancelled").length],
      ["Confirmadas",data.filter(x=>x.status==="confirmed").length]
    ]);
    for(const item of data)container.append(addAppointmentCard(item));
    message("appointments-feedback",data.length?"Consulta tus horarios, estados y accesos de videoconsulta.":"No tienes citas todavía. Puedes crear una desde Agendar cita.");
  }catch(e){message("appointments-feedback",e.message);}
}
async function loadHome(){
  const container=$("home-upcoming");
  if(!container)return;
  if(!session){container.replaceChildren(make("p","Inicia sesión para consultar tus próximas citas."));return;}
  try{
    const today=dateToday();
    const data=await api("appointments?select=id,specialty,appointment_date,appointment_time,modality,status,meeting_room&appointment_date=gte."+today+"&status=neq.cancelled&order=appointment_date.asc,appointment_time.asc&limit=2");
    container.replaceChildren();
    if (!data.length)container.append(make("p","No tienes consultas próximas. Puedes solicitar una cita cuando lo necesites."));
    else data.forEach(item=>container.append(addAppointmentCard(item)));
  }catch(e){container.replaceChildren(make("p",e.message));}
}
async function loadNotices(){
  const container=$("notices-list");
  if(!container)return;
  if(!session){requireLoginText("notices-feedback");return;}
  message("notices-feedback","Cargando tus avisos…");
  try{
    const data=await api("appointment_notices?select=id,message,created_at,read_at&order=created_at.desc&limit=50");
    container.replaceChildren();
    for(const item of data){
      const card=make("article",null,"saved-appointment");
      card.append(make("h3",item.read_at?"Actualización":"Aviso reciente"),make("p",item.message),
        make("small",new Date(item.created_at).toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"})));
      container.append(card);
    }
    message("notices-feedback",data.length?"Aquí aparecen los cambios de tus citas.":"Aún no tienes avisos.");
  }catch(e){message("notices-feedback",e.message);}
}
async function changeDoctorAppointment(item,action,params={}){
  message("doctor-feedback","Actualizando cita…");
  try{
    await rpc("doctor_update_appointment",{p_appointment_id:item.id,p_action:action,
      p_date:params.p_date||null,p_time:params.p_time||null});
    await loadDoctorAppointments();
    message("doctor-feedback","Cita actualizada correctamente.");
  }catch(e){message("doctor-feedback",e.message);}
}
function renderDoctorAppointments(){
  const target=$("doctor-appointments");
  if(!target)return;
  const query=($("doctor-search")?.value||"").toLowerCase().trim();
  const state=$("doctor-filter")?.value||"";
  const selected=appointments.filter(x=>(!state||x.status===state) &&
    (!query||[x.specialty,x.appointment_date,x.appointment_time,x.modality,x.status,x.user_id.slice(0,8)]
      .join(" ").toLowerCase().includes(query)));
  target.replaceChildren();
  for(const item of selected)target.append(addAppointmentCard(item,true));
  if(!selected.length)message("doctor-feedback","No hay citas con esos filtros.");
}
async function loadDoctorAppointments(){
  if(!isDoctor)return;
  message("doctor-feedback","Cargando agenda…");
  try{
    appointments=await api("appointments?select=id,user_id,specialty,appointment_date,appointment_time,modality,status,meeting_room&order=appointment_date.asc,appointment_time.asc&limit=300");
    const today=dateToday();
    showSummary($("doctor-stats"),[
      ["Total",appointments.length],
      ["Hoy",appointments.filter(x=>x.appointment_date===today && x.status!=="cancelled").length],
      ["Pendientes",appointments.filter(x=>x.status==="requested").length],
      ["Confirmadas",appointments.filter(x=>x.status==="confirmed").length],
      ["Canceladas",appointments.filter(x=>x.status==="cancelled").length]
    ]);
    renderDoctorAppointments();
    if(appointments.length)message("doctor-feedback","Gestiona las solicitudes y revisa los horarios.");
  }catch(e){message("doctor-feedback",e.message);}
}
async function initBooking(){
  const form=$("booking-form");
  if(!form)return;
  const input=$("date");
  input.min=dateToday();
  const button=$("save-appointment");
  if(!session){button.disabled=true;button.textContent="Inicia sesión para agendar";message("form-message","Accede a Mi cuenta antes de solicitar una cita.");return;}
  form.addEventListener("submit",async(e)=>{
    e.preventDefault();
    const date=input.value;
    if(!date||date<dateToday()){message("form-message","Selecciona una fecha válida.");return;}
    button.disabled=true;message("form-message","Registrando solicitud…");
    try{
      const result=await api("appointments","POST",{
        user_id:session.user.id,specialty:$("specialty").value,appointment_date:date,
        appointment_time:$("time").value,modality:$("mode").value,status:"requested"
      });
      if(!result?.length)throw Error("No fue posible guardar la solicitud.");
      form.reset();
      message("form-message","Solicitud enviada. Está pendiente hasta que el médico la confirme.");
    }catch(e){message("form-message",e.message);}finally{button.disabled=false;}
  });
}
async function initAccount(){
  const form=$("auth-form");
  if(!form)return;
  const signed=$("signed-in");
  form.hidden=Boolean(session);signed.hidden=!session;
  if(session){message("signed-email",session.user?.email||"Cuenta activa");message("auth-feedback","Sesión iniciada. Puedes navegar por las demás páginas.");}
  async function login(register){
    if(!form.reportValidity())return;
    const email=$("auth-email").value.trim(),password=$("auth-password").value;
    message("auth-feedback","Comprobando datos…");
    for(const b of form.querySelectorAll("button"))b.disabled=true;
    try{
      const result=await authRequest(register?"signup":"token?grant_type=password",{email,password});
      $("auth-password").value="";
      if(!result.access_token){message("auth-feedback","Confirma el correo de registro e inicia sesión.");return;}
      saveSession(result);
      const authorized=await rpc("is_medicore_doctor");
      window.location.replace(authorized===true?"./medico.html":"./citas.html");
    }catch(e){message("auth-feedback",e.message);}
    finally{for(const b of form.querySelectorAll("button"))b.disabled=false;}
  }
  form.addEventListener("submit",(e)=>{e.preventDefault();void login(false);});
  $("register-button")?.addEventListener("click",()=>void login(true));
  $("logout-button")?.addEventListener("click",async()=>{
    const old=session;
    saveSession(null);
    message("auth-feedback","Cerraste sesión.");
    try{await unlinkDevice(old);}catch{}
    if(old?.access_token)fetch(SB_URL+"/auth/v1/logout",{method:"POST",headers:{apikey:SB_KEY,Authorization:"Bearer "+old.access_token}}).catch(()=>{});
    window.location.replace("./index.html");
  });
}
const notificationButton=$("notification-button");
const notificationHelp=$("notification-help");
function note(messageValue){if(notificationHelp)notificationHelp.textContent=messageValue;}
function decodeVapid(value){
  const padded=value+"=".repeat((4-value.length%4)%4);
  const b64=padded.replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
}
async function registerDevice(subscription){
  const t=await token();
  const r=await fetch("./api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify(subscription)});
  if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||"No se pudo vincular el dispositivo.");}
}
async function syncDevice(){
  if(!session?.access_token || !("serviceWorker" in navigator) || !("PushManager" in window))return;
  try{
    if(Notification.permission!=="granted")return;
    const reg=await navigator.serviceWorker.ready;
    const subscribed=await reg.pushManager.getSubscription();
    if(subscribed)await registerDevice(subscribed);
  }catch(e){console.warn("No se pudo sincronizar este dispositivo.",e.message);}
}
async function unlinkDevice(previous){
  if(!previous?.access_token||!("serviceWorker" in navigator))return;
  const reg=await navigator.serviceWorker.ready;
  const sub=await reg.pushManager.getSubscription();
  if(!sub)return;
  await sub.unsubscribe();
  await fetch("./api/push/subscribe",{method:"DELETE",headers:{"Content-Type":"application/json",Authorization:"Bearer "+previous.access_token},body:JSON.stringify({endpoint:sub.endpoint})});
}
async function initPush(){
  if(!notificationButton)return;
  if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator)){
    notificationButton.disabled=true;note("Este navegador no admite notificaciones push.");return;
  }
  if(!session){notificationButton.disabled=true;note("Inicia sesión para activar las notificaciones.");return;}
  try{
    const response=await fetch("./api/config",{cache:"no-store"});
    const cfg=await response.json();
    if(!response.ok||!cfg.pushEnabled||!cfg.vapidPublicKey)throw Error("El servicio push no está disponible.");
    pushConfiguration=cfg;
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    notificationButton.textContent=subscription?"Enviar notificación de prueba":"Activar notificaciones";
    if(Notification.permission==="denied")note("Permite las notificaciones en la configuración del navegador.");
    else if(subscription)note("Dispositivo vinculado. Recibirás los avisos de tus citas.");
    else note("Actívalas para recibir avisos de cambios, incluso con la PWA cerrada.");
  }catch(e){notificationButton.disabled=true;note(e.message);}
  notificationButton.addEventListener("click",async()=>{
    if(!pushConfiguration)return;
    notificationButton.disabled=true;
    try{
      if(Notification.permission!=="granted"){
        const granted=await Notification.requestPermission();
        if(granted!=="granted")throw Error("El navegador no concedió permiso de notificaciones.");
      }
      const reg=await navigator.serviceWorker.ready;
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapid(pushConfiguration.vapidPublicKey)});
      await registerDevice(sub);
      const t=await token();
      const response=await fetch("./api/push/test",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify({endpoint:sub.endpoint})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||"Error al enviar notificación de prueba.");
      notificationButton.textContent="Enviar notificación de prueba";
      note("Notificaciones activadas para esta cuenta y este dispositivo.");
    }catch(e){note(e.message);}
    finally{notificationButton.disabled=false;}
  });
}
function initInstall(){
  const buttons=[...document.querySelectorAll(".install-button")];
  let prompt=null;
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();prompt=event;
    for(const btn of buttons)btn.hidden=false;
  });
  for(const btn of buttons)btn.addEventListener("click",async()=>{
    if(!prompt)return;prompt.prompt();await prompt.userChoice;prompt=null;btn.hidden=true;
  });
  window.addEventListener("appinstalled",()=>buttons.forEach(b=>b.hidden=true));
}
function initMenu(){
  const toggle=$("menu-toggle"),nav=$("main-nav");
  toggle?.addEventListener("click",()=>{
    const opened=nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded",String(opened));
    toggle.setAttribute("aria-label",opened?"Cerrar menú":"Abrir menú");
  });
}
function configureNavigation(){
  document.body.classList.toggle("doctor-mode",isDoctor);
  const patientLinks=document.querySelectorAll("[data-role='patient']");
  const doctorLinks=document.querySelectorAll("[data-role='doctor']");
  for(const el of patientLinks)el.hidden=isDoctor;
  for(const el of doctorLinks)el.hidden=!isDoctor;
  const currentPage=isDoctor?"medico":page;
  if(isDoctor){
    document.querySelector(".brand")?.setAttribute("href","./medico.html");
    const brandSmall=document.querySelector(".brand-text small");
    if(brandSmall)brandSmall.textContent="Administración de citas";
  }
  for(const link of document.querySelectorAll(".main-nav a")){
    const path=link.getAttribute("href")||"";
    if((!isDoctor&&path === "./"+page+".html")||(isDoctor&&path === "./"+page+".html"))link.setAttribute("aria-current","page");
  }
}
async function boot(){
  // Enlaces guardados y antiguas notificaciones de la versión de una sola pantalla.
  if(page==="home" && location.hash){
    const legacy={
      "#avisos-citas":"avisos.html","#mis-citas":"citas.html",
      "#solicitar-cita":"agendar.html","#agenda":"agendar.html",
      "#cuenta":"cuenta.html","#panel-medico":"medico.html",
      "#videoconsulta":"informacion.html","#clima":"informacion.html","#catalogo":"informacion.html"
    };
    const target=legacy[location.hash.toLowerCase()];
    if(target){window.location.replace("./"+target);return;}
  }
  initMenu();initInstall();
  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(console.warn));
    navigator.serviceWorker.addEventListener("message",(event)=>{
      if(event.data?.type==="MEDICORE_APPOINTMENT_NOTICE"&&page==="avisos")void loadNotices();
    });
  }
  const banner=$("network-status");
  function onlineStatus(){if(banner)banner.textContent=navigator.onLine?"":"No tienes conexión. Los cambios de citas requieren internet.";}
  window.addEventListener("online",onlineStatus);
  window.addEventListener("offline",onlineStatus);
  onlineStatus();
  if(session?.access_token){
    try{
      const t=await token();
      const response=await fetch(SB_URL+"/auth/v1/user",{headers:{apikey:SB_KEY,Authorization:"Bearer "+t},cache:"no-store"});
      if(!response.ok)throw Error("Sesión caducada.");
      session.user=await response.json();saveSession(session);
      isDoctor=(await rpc("is_medicore_doctor"))===true;
    }catch(e){
      if(navigator.onLine){saveSession(null);isDoctor=false;message("auth-feedback","Tu sesión caducó. Vuelve a iniciar sesión.");}
    }
  }
  configureNavigation();
  document.body.classList.remove("role-pending");
  if(isDoctor && page!=="medico" && page!=="avisos" && page!=="cuenta"){
    window.location.replace("./medico.html");return;
  }
  if(!isDoctor && page==="medico"){
    window.location.replace("./cuenta.html");return;
  }
  if(page==="cuenta")await initAccount();
  if(page==="agendar")await initBooking();
  if(page==="citas")await loadPatientAppointments();
  if(page==="home")await loadHome();
  if(page==="avisos")await loadNotices();
  if(page==="medico"){
    const panel=$("panel-medico");if(panel)panel.hidden=false;
    $("doctor-refresh")?.addEventListener("click",()=>void loadDoctorAppointments());
    $("doctor-search")?.addEventListener("input",renderDoctorAppointments);
    $("doctor-filter")?.addEventListener("change",renderDoctorAppointments);
    await loadDoctorAppointments();
  }
  if(page==="cuenta"||page==="medico")await initPush();
  if(session?.access_token)void syncDevice();
}
void boot();
})();