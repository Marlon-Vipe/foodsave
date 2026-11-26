import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createApp } from "../server.mjs";
import { hashPassword } from "../store.mjs";
import { businessToday } from "../business-utils.mjs";
const probe=createServer().listen(0,"127.0.0.1");await once(probe,"listening");const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,date=businessToday(),day=(n)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
const app=await createApp({database:":memory:",origin}),password="Negocios-browser-2026!",hash=await hashPassword(password);
const users={};for(const role of ["administrador","editor","supervisor","lector"])users[role]=Number(app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)").run("Demo "+role,role+"@example.test",hash,role).lastInsertRowid);
app.server.listen(port,"127.0.0.1");await once(app.server,"listening");
const evidence=process.env.FOODSAVE_EVIDENCE_DIR??"docs/business/evidence";await mkdir(evidence,{recursive:true});
let browser;
try{
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000},locale:"es-DO"});const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const button=(name)=>page.getByRole("button",{name,exact:true});
 const login=async(role)=>{await page.getByLabel("Correo electrónico").fill(role+"@example.test");await page.getByLabel("Contraseña",{exact:true}).fill(password);await button("Entrar").click();await button("Cerrar sesión").waitFor();};
 const go=async(name)=>{if(await page.locator("#menu-toggle").isVisible())await page.locator("#menu-toggle").click();await button(name).click();await page.locator("main h1").waitFor();};
 const open=async(summary)=>{const el=page.getByText(summary,{exact:true});await el.click();};
 const fill=async(selector,data)=>{const form=page.locator(selector);for(const[name,value]of Object.entries(data)){const el=form.locator(`[name="${name}"]`);if(await el.evaluate(e=>e.tagName==="SELECT"))await el.selectOption(String(value));else await el.fill(String(value));}};
 const save=async(selector,label)=>{await page.locator(selector).getByRole("button",{name:label,exact:true}).click();await page.getByText("Cambios guardados.",{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('form button[type="submit"]:disabled'));};
 const screenshot=async(name)=>{await page.screenshot({path:`${evidence}/${name}.png`});};
 await page.goto(origin);await login("administrador");await go("Negocios e impacto");await open("+ Registrar negocio");
 await fill("#business-create",{name:"Comedor circular FoodSave",kind:"initiative",owner_id:users.editor,amount:"2500",description:"Recuperar alimentos y mejorar el acceso a comidas del comedor.",currency:"DOP"});
 await page.locator('#business-create [name="sdg"][value="2"]').check();await page.locator('#business-create [name="sdg"][value="12"]').check();await save("#business-create","Crear negocio");
 const business=app.db.prepare("SELECT * FROM businesses").get();assert.equal(business.status,"draft");
 await open("+ Crear proyecto");await fill("#project-create",{name:"Plan semanal de rescate",owner_id:users.editor,starts_on:date,ends_on:day(7)});await save("#project-create","Crear proyecto");
 await open("Editar datos y ciclo de vida");await fill("#business-edit",{status:"active"});await save("#business-edit","Guardar negocio");
 const project=app.db.prepare("SELECT * FROM business_projects").get();await open("Plan semanal de rescate · Planificado");await fill(`#project-${project.id}`,{status:"active"});await save(`#project-${project.id}`,"Guardar proyecto");
 for(const m of [{name:"Alimentos recuperados",dimension:"environmental",unit:"kg",target:"100",value:"40",sdg_id:"12"},{name:"Comidas entregadas",dimension:"social",unit:"comidas",target:"200",value:"80",sdg_id:"2"},{name:"Ahorro registrado",dimension:"economic",unit:"DOP",target:"5000",value:"1800",sdg_id:"12"}]){
  await open("+ Definir indicador");await fill("#indicator-create",{name:m.name,dimension:m.dimension,unit:m.unit,target:m.target,baseline:"0",sdg_id:m.sdg_id,project_id:project.id,due_on:day(7)});await save("#indicator-create","Definir indicador");
  const i=app.db.prepare("SELECT id FROM business_indicators WHERE name=?").get(m.name).id;
  await page.locator(`#measurement-${i}`).locator("..").getByText("Registrar medición",{exact:true}).click();
  await fill(`#measurement-${i}`,{value:m.value,measured_on:date,evidence:"Registro sintético de demostración del comedor; acta DEMO-01."});await save(`#measurement-${i}`,"Guardar medición");
 }
 await page.getByRole("heading",{name:"Indicadores de impacto",exact:true}).scrollIntoViewIfNeeded();await screenshot("01-indicadores-impacto");
 const detail=app.db.prepare("SELECT COUNT(*) n FROM indicator_measurements").get();assert.equal(detail.n,3);
 const downloadImpact=page.waitForEvent("download");await page.getByRole("link",{name:"Reporte de impacto CSV"}).click();assert.match(await readFile(await(await downloadImpact).path(),"utf8"),/Alimentos recuperados/);
 await page.getByText("Historial de cambios",{exact:false}).first().click();await page.locator(".business-history").scrollIntoViewIfNeeded();await screenshot("02-historial-negocio");
 await go("Software y licencias");await open("+ Registrar software");await fill("#software-create",{name:"FoodSave Analítica DEMO",vendor:"Proveedor de demostración"});await save("#software-create","Guardar software");
 for(const kind of ["equipment","area"]){await open("+ Registrar equipo o área");await fill("#target-create",{kind,name:kind==="equipment"?"Equipo comedor 01":"Área de logística"});await save("#target-create","Guardar recurso");}
 await open("+ Registrar licencia");await fill("#license-create",{reference:"DEMO-LICENCIA-001",seats:"3",starts_on:date,expires_on:day(7),amount:"1800",business_id:business.id});await save("#license-create","Guardar licencia");
 const license=app.db.prepare("SELECT * FROM business_licenses").get();
 const targets=app.db.prepare("SELECT * FROM license_targets ORDER BY id").all();
 for(const destination of ["user:"+users.editor,...targets.map(t=>"target:"+t.id)]){await open("+ Asignar licencia");await fill("#assignment-create",{destination,seats:"1"});await save("#assignment-create","Asignar cupos");}
 assert.equal(await page.locator("#assignment-create").count(),0);
 await page.getByRole("heading",{name:"Asignaciones",exact:true}).scrollIntoViewIfNeeded();await screenshot("03-asignaciones-sin-cupos");
 // A direct API attempt demonstrates server enforcement beyond hidden UI controls.
 const blocked=await page.evaluate(async({id,user_id})=>{const me=await(await fetch('/api/me')).json();const r=await fetch(`/api/licenses/${id}/assignments`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({user_id,seats:1,request_id:crypto.randomUUID()})});return r.status;},{id:license.id,user_id:users.supervisor});assert.equal(blocked,409);
 const assignment=app.db.prepare("SELECT id FROM license_assignments WHERE user_id IS NOT NULL").get().id;
 await page.locator(`#release-${assignment}`).locator("..").getByText("Liberar cupos",{exact:true}).click();await fill(`#release-${assignment}`,{note:"Cierre de participación del usuario de demostración"});await save(`#release-${assignment}`,"Liberar asignación");
 await open("Renovar o editar licencia");await fill("#license-edit",{expires_on:day(90)});await save("#license-edit","Actualizar licencia");
 assert.equal(app.db.prepare("SELECT expires_on FROM business_licenses").get().expires_on,day(90));
 await fill("#license-filters",{state:"expiring",days:"30"});await button("Filtrar licencias").click();await page.getByText("Licencias y disponibilidad",{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll("[data-license]").length===0);
 await fill("#license-filters",{state:"",days:"120"});await button("Filtrar licencias").click();await page.locator("[data-license]").waitFor();await screenshot("04-renovacion-y-vigencias");
 for(const name of ["Reporte de vencimientos CSV","Reporte de uso CSV"]){const download=page.waitForEvent("download");await page.getByRole("link",{name,exact:true}).click();const text=await readFile(await(await download).path(),"utf8");assert.match(text,/DEMO-LICENCIA-001/);}
 await page.locator("[data-license]").click();await page.getByText("Historial de cambios",{exact:false}).first().click();await page.locator(".business-history").scrollIntoViewIfNeeded();await screenshot("05-historial-licencia");
 for(const [width,height]of [[320,568],[390,844],[768,800],[1440,900]]){
  await page.setViewportSize({width,height});for(const module of ["Negocios e impacto","Software y licencias"]){await go(module);await page.locator(module==="Negocios e impacto"?"[data-business]":"[data-license]").click();await page.locator(module==="Negocios e impacto"?"#business-detail":"#license-detail").waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"Desborde en "+module+width);
   assert(await page.locator("#logout").evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
   if(width===390){await page.evaluate(()=>window.scrollTo(0,0));await screenshot(module==="Negocios e impacto"?"06-negocios-movil":"07-licencias-movil");}
  }
 }
 await button("Cerrar sesión").click();await login("supervisor");await go("Negocios e impacto");assert.equal(await page.getByText("+ Registrar negocio",{exact:true}).count(),0);assert.equal(await page.getByRole("link",{name:"Reporte de impacto CSV"}).count(),1);await screenshot("08-perfil-supervisor");
 await button("Cerrar sesión").click();await login("editor");await go("Software y licencias");assert.equal(await page.getByText("+ Registrar licencia",{exact:true}).count(),1);assert.equal(await page.getByRole("link",{name:"Reporte de uso CSV"}).count(),0);
 await button("Cerrar sesión").click();await login("lector");assert.equal(await button("Negocios e impacto").count(),0);assert.equal(await button("Software y licencias").count(),0);
 assert.deepEqual(errors,[]);console.log("GN navegador aprobado: negocio, proyecto, tres dimensiones ODS, evidencia, reportes CSV, software, usuario/equipo/área, cupos agotados, liberación, renovación, filtros, historial, roles y 4 tamaños.");
}finally{await browser?.close();await new Promise(r=>app.server.close(r));app.db.close();}
