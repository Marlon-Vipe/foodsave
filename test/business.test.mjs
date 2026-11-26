import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { hashPassword, openStore } from "../store.mjs";
import { businessToday } from "../business-utils.mjs";
const password = "Negocios-prueba-2026!", hash = await hashPassword(password), date = businessToday();
const day = (n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
async function setup(t) {
  const app = await createApp({ database: ":memory:", origin: "http://localhost:3000" });
  const users = {};
  for (const role of ["administrador", "editor", "supervisor", "lector"])
    users[role] = Number(app.db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)").run(role, role + "@example.test", hash, role).lastInsertRowid);
  app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
  t.after(async () => { await new Promise((r) => app.server.close(r)); app.db.close(); });
  const request = async (path, session = {}, method = "GET", body, extra = {}) => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method,
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", ...(session.cookie && { Cookie: session.cookie }), ...(session.csrf && { "X-CSRF-Token": session.csrf }), ...extra },
      ...(body && { body: JSON.stringify(body) }) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, body: r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text };
  };
  const login = async (role = "administrador") => { const r = await request("login", {}, "POST", { email: role + "@example.test", password }); assert.equal(r.status, 200); return { cookie: r.headers.get("set-cookie").split(";")[0], csrf: r.body.csrf }; };
  const admin = await login();
  const business = async (changes = {}) => {
    const r = await request("businesses", admin, "POST", { name: "Rescate de alimentos", description: "Programa de aprovechamiento del comedor", kind: "initiative", owner_id: users.editor, budget_cents: 250000, currency: "DOP", sdg_ids: [2, 12, 13], ...changes });
    assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.business;
  };
  const indicator = async (id, changes = {}) => { const r = await request(`businesses/${id}/indicators`, admin, "POST", { name: "Desperdicio mensual", dimension: "environmental", sdg_id: 12, unit: "kg", baseline: 100, target: 50, due_on: day(30), ...changes }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; };
  const software = async (changes = {}) => { const r = await request("licenses/software", admin, "POST", { name: "FoodSave Analítica", vendor: "Proveedor de prueba", ...changes }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; };
  const license = async (changes = {}) => { const softwareId = changes.software_id ?? await software({ name: "Software " + randomUUID() }); const r = await request("licenses", admin, "POST", { software_id: softwareId, reference: "DEMO-" + randomUUID(), seats: 3, starts_on: date, expires_on: day(7), cost_cents: 180000, currency: "DOP", ...changes }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; };
  const assign = (id, changes = {}) => request(`licenses/${id}/assignments`, admin, "POST", { user_id: users.editor, seats: 1, request_id: randomUUID(), ...changes });
  return { ...app, users, admin, request, login, business, indicator, software, license, assign };
}

test("GN-01 negocios, responsables con permisos, ODS y presupuesto válidos", async (t) => {
  const s = await setup(t), b = await s.business();
  assert.equal(b.status, "draft"); assert.deepEqual(b.sdg_ids, [2,12,13]);
  for (const patch of [{ sdg_ids: [] }, { sdg_ids: [12,12] }, { sdg_ids: [18] }, { owner_id: s.users.lector }, { budget_cents: 2.5 }, { currency: "EUR" }, { kind: "otro" }, { description: "a" }]) {
    const r = await s.request("businesses", s.admin, "POST", { ...b, ...patch });
    // Full response also contains server-only fields; send only writable fields.
    assert.equal(r.status, 400);
    const payload = Object.fromEntries(["name","description","kind","owner_id","budget_cents","currency","sdg_ids"].map((k) => [k,b[k]]));
    assert.equal((await s.request("businesses", s.admin, "POST", { ...payload, ...patch })).status, 400);
  }
  assert.equal((await s.request("businesses/options", s.admin)).body.sdgs.length, 17);
  const updated = await s.request("businesses/" + b.id, s.admin, "PATCH", { name: "Banco de alimentos", expected_version: 1 });
  assert.equal(updated.body.business.version, 2);
  assert.equal((await s.request("businesses/" + b.id, s.admin, "PATCH", { name: "Cambio obsoleto", expected_version: 1 })).status, 409);
  assert.equal((await s.request("businesses?sdg_id=12&status=draft", s.admin)).body.businesses.length, 1);
  assert.equal((await s.request("businesses?sdg_id=9", s.admin)).body.businesses.length, 0);
  for (const q of ["bad=1", "status=wrong", "sdg_id=18", "status=active&status=draft"]) assert.equal((await s.request("businesses?"+q, s.admin)).status, 400);
});

test("GN-02 ciclo de negocio/proyecto, fechas y cierre con pendientes", async (t) => {
  const s = await setup(t), b = await s.business(), path = "businesses/" + b.id;
  const payload = { name: "Comedor sostenible", owner_id: s.users.editor, starts_on: date, ends_on: day(10) };
  assert.equal((await s.request(path + "/projects", s.admin, "POST", { ...payload, ends_on: day(-1) })).status, 400);
  assert.equal((await s.request(path + "/projects", s.admin, "POST", { ...payload, starts_on: "2026-02-30" })).status, 400);
  const project = (await s.request(path + "/projects", s.admin, "POST", payload)).body.id, p = "businesses/projects/" + project;
  assert.equal((await s.request(p,s.admin,"PATCH",{ status:"active",expected_version:1 })).status,409);
  assert.equal((await s.request(path,s.admin,"PATCH",{ status:"completed",expected_version:1 })).status,409);
  assert.equal((await s.request(path,s.admin,"PATCH",{ status:"active",expected_version:1 })).status,200);
  assert.equal((await s.request(path,s.admin,"PATCH",{ status:"completed",expected_version:2 })).status,409);
  assert.equal((await s.request(p,s.admin,"PATCH",{ status:"completed",expected_version:1 })).status,409);
  assert.equal((await s.request(p,s.admin,"PATCH",{ status:"active",expected_version:1 })).status,200);
  assert.equal((await s.request(p,s.admin,"PATCH",{ status:"completed",expected_version:2 })).status,200);
  assert.equal((await s.request(path,s.admin,"PATCH",{ status:"completed",expected_version:2 })).status,200);
  assert.equal((await s.request(path + "/projects",s.admin,"POST",payload)).status,409);
  assert.equal((await s.request(path,s.admin,"PATCH",{ status:"archived",expected_version:3 })).status,200);
  assert.equal((await s.request(path,s.admin,"PATCH",{ name:"No editar archivo",expected_version:4 })).status,409);
  assert.equal((await s.request(path,s.admin,"PATCH",{ status:"draft",expected_version:4 })).status,200);
  const detail = (await s.request(path,s.admin)).body;
  assert.equal(detail.history.length,8); assert.equal(detail.projects[0].version,3);
});

test("GN-03 indicadores de tres dimensiones y relaciones ODS/proyecto íntegras", async (t) => {
  const s = await setup(t), b = await s.business(), other = await s.business();
  const p = (await s.request(`businesses/${other.id}/projects`,s.admin,"POST",{ name:"Proyecto ajeno",owner_id:s.users.editor,starts_on:date,ends_on:date })).body.id;
  const payload = { name:"Personas atendidas",dimension:"social",sdg_id:2,unit:"personas",baseline:0,target:100,due_on:day(10) };
  for (const patch of [{ project_id:p },{ sdg_id:8 },{ target:0 },{ baseline:-1 },{ dimension:"other" },{ due_on:"hoy" }]) assert.equal((await s.request(`businesses/${b.id}/indicators`,s.admin,"POST",{ ...payload,...patch })).status,400);
  await s.indicator(b.id);
  await s.indicator(b.id,{ ...payload });
  await s.indicator(b.id,{ name:"Ahorro en compras",dimension:"economic",unit:"DOP",baseline:0,target:10000 });
  assert.equal((await s.request(`businesses/${b.id}`,s.admin)).body.indicators.length,3);
  assert.equal((await s.request(`businesses/${b.id}`,s.admin,"PATCH",{ expected_version:1,sdg_ids:[2,13] })).status,409);
  assert.throws(() => s.db.prepare("INSERT INTO business_indicators(business_id,project_id,sdg_id,name,dimension,unit,baseline,target,due_on) VALUES (?,?,?,?,?,?,?,?,?)").run(b.id,p,12,"Ajeno","social","personas",0,10,date), /FOREIGN KEY/);
  assert.deepEqual(s.db.prepare("PRAGMA foreign_key_check").all(),[]);
});

test("GN-04 mediciones con evidencia, reducción, orden cronológico y reintentos", async (t) => {
  const s = await setup(t), b = await s.business(), i = await s.indicator(b.id,{ due_on:day(-1) }), path=`businesses/indicators/${i}/measurements`;
  const payload = { value:75,measured_on:date,evidence:"Pesaje del comedor acta 01",request_id:randomUUID() };
  const first = await s.request(path,s.admin,"POST",payload);
  assert.equal(first.status,201);
  assert.equal((await s.request(path,s.admin,"POST",payload)).body.id,first.body.id);
  assert.equal((await s.request(path,s.admin,"POST",{ ...payload,value:74 })).status,409);
  assert.equal((await s.request(path,s.admin,"POST",{ ...payload,value:10,measured_on:day(-2),request_id:randomUUID() })).status,201);
  let detail = (await s.request(`businesses/${b.id}`,s.admin)).body;
  assert.equal(detail.indicators[0].progress,50); assert.equal(detail.indicators[0].overdue,true);
  for (const patch of [{ measured_on:day(1) },{ evidence:"" },{ value:-1 },{ request_id:"wrong" }]) assert.equal((await s.request(path,s.admin,"POST",{ ...payload,request_id:randomUUID(),...patch })).status,400);
  assert.equal((await s.request(path,s.admin,"POST",{ ...payload,value:40,request_id:randomUUID() })).status,201);
  detail=(await s.request(`businesses/${b.id}`,s.admin)).body;
  assert.equal(detail.indicators[0].progress,100); assert.equal(detail.indicators[0].reached,true); assert.equal(detail.indicators[0].overdue,false);
  assert.equal(detail.measurements.length,3); assert.equal(detail.history.filter((r)=>r.action==="measurement.recorded").length,3);
  await s.request(`businesses/${b.id}`,s.admin,"PATCH",{status:"archived",expected_version:1});
  assert.equal((await s.request(path,s.admin,"POST",{...payload,request_id:randomUUID()})).status,409);
});

test("GN-05 avance ascendente, sin medición y metas fuera de rango", async (t) => {
  const s=await setup(t),b=await s.business(),i=await s.indicator(b.id,{baseline:0,target:100,dimension:"social",unit:"personas"});
  let detail=(await s.request(`businesses/${b.id}`,s.admin)).body;
  assert.equal(detail.indicators[0].progress,null); assert.equal(detail.indicators[0].current_value,null);
  for (const [value,progress] of [[25,25],[150,100],[0,0]]) {
    await s.request(`businesses/indicators/${i}/measurements`,s.admin,"POST",{value,measured_on:date,evidence:"Conteo del equipo de prueba",request_id:randomUUID()});
    detail=(await s.request(`businesses/${b.id}`,s.admin)).body; assert.equal(detail.indicators[0].progress,progress);
  }
});

test("GN-06 catálogo software/recursos, duplicados y contratos inválidos", async (t) => {
  const s=await setup(t),software=await s.software();
  assert.equal((await s.request("licenses/software",s.admin,"POST",{name:"foodsave analítica",vendor:"proveedor de prueba"})).status,409);
  const target={name:"Comedor central",kind:"area"};
  assert.equal((await s.request("licenses/targets",s.admin,"POST",target)).status,201);
  assert.equal((await s.request("licenses/targets",s.admin,"POST",target)).status,409);
  const payload={software_id:software,reference:"DEMO-001",seats:3,starts_on:date,expires_on:day(10),cost_cents:5000,currency:"USD"};
  for (const patch of [{seats:0},{seats:1.5},{software_id:9999},{expires_on:day(-1)},{cost_cents:-1},{currency:"EUR"},{business_id:9999}]) assert.equal((await s.request("licenses",s.admin,"POST",{...payload,...patch})).status,400);
  assert.equal((await s.request("licenses",s.admin,"POST",payload)).status,201);
  assert.equal((await s.request("licenses",s.admin,"POST",{...payload,reference:"demo-001"})).status,409);
});

test("GN-07 asignar a usuario, equipo y área; capacidad y liberación idempotente", async (t) => {
  const s=await setup(t),id=await s.license(),ids=[];
  for (const kind of ["equipment","area"]) ids.push((await s.request("licenses/targets",s.admin,"POST",{kind,name:"Destino "+kind})).body.id);
  const payload={user_id:s.users.editor,seats:1,request_id:randomUUID()};
  const assignment=await s.request(`licenses/${id}/assignments`,s.admin,"POST",payload);
  assert.equal(assignment.status,201);
  assert.equal((await s.request(`licenses/${id}/assignments`,s.admin,"POST",payload)).body.id,assignment.body.id);
  assert.equal((await s.request(`licenses/${id}/assignments`,s.admin,"POST",{...payload,seats:2})).status,409);
  assert.equal((await s.assign(id)).status,409);
  for (const target of ids) assert.equal((await s.assign(id,{user_id:undefined,target_id:target})).status,201);
  assert.equal((await s.assign(id,{user_id:s.users.supervisor})).status,409);
  let detail=(await s.request("licenses/"+id,s.admin)).body;
  assert.equal(detail.license.available,0); assert.equal(detail.license.assigned,3);
  assert.equal((await s.request("licenses/"+id,s.admin,"PATCH",{seats:2,expected_version:1})).status,409);
  const release=`licenses/assignments/${assignment.body.id}/release`;
  assert.equal((await s.request(release,s.admin,"POST",{note:""})).status,400);
  for (let n=0;n<2;n++) assert.equal((await s.request(release,s.admin,"POST",{note:"Fin de participación"})).status,200);
  detail=(await s.request("licenses/"+id,s.admin)).body;
  assert.equal(detail.license.available,1); assert.equal(detail.history.filter((r)=>r.action==="released").length,1);
  assert.equal((await s.assign(id)).status,201);
});

test("GN-08 asignaciones concurrentes no sobreasignan el último cupo", async (t) => {
  const s=await setup(t),id=await s.license({seats:1});
  const results=await Promise.all([s.assign(id),s.assign(id,{user_id:s.users.supervisor})]);
  assert.deepEqual(results.map((r)=>r.status).sort(),[201,409]);
  assert.equal((await s.request("licenses/"+id,s.admin)).body.license.assigned,1);
});

test("GN-09 vigencias inclusivas, renovaciones, deshabilitación y filtros", async (t) => {
  const s=await setup(t),valid=await s.license({expires_on:date}),expired=await s.license({starts_on:day(-5),expires_on:day(-1)}),future=await s.license({starts_on:day(1),expires_on:day(5)});
  assert.equal((await s.assign(valid)).status,201);
  for (const id of [expired,future]) assert.equal((await s.assign(id)).status,409);
  assert.equal((await s.request("licenses?state=expiring&days=1",s.admin)).body.licenses.length,1);
  assert.equal((await s.request("licenses/"+expired,s.admin)).body.license.available,0);
  assert.equal((await s.request("licenses/"+expired,s.admin,"PATCH",{expected_version:1,expires_on:day(365)})).status,200);
  assert.equal((await s.assign(expired)).status,201);
  assert.equal((await s.request("licenses/"+expired,s.admin,"PATCH",{expected_version:1,seats:5})).status,409);
  assert.equal((await s.request("licenses/"+valid,s.admin,"PATCH",{expected_version:1,enabled:0})).status,200);
  let l=(await s.request("licenses/"+valid,s.admin)).body.license;
  assert.equal(l.state,"disabled");assert.equal(l.available,0);assert.equal(l.assigned,1);
  assert.equal((await s.assign(valid,{user_id:s.users.supervisor})).status,409);
  for(const q of ["days=0","days=366","state=bad","software_id=-1","bad=1"]) assert.equal((await s.request("licenses?"+q,s.admin)).status,400);
});

test("GN-10 destinos inactivos/inexistentes y exactamente un destino", async(t)=>{
  const s=await setup(t),id=await s.license();
  s.db.prepare("UPDATE users SET active=0 WHERE id=?").run(s.users.editor);
  assert.equal((await s.assign(id)).status,400);
  assert.equal((await s.assign(id,{user_id:9999})).status,400);
  assert.equal((await s.assign(id,{target_id:9999})).status,400);
  assert.equal((await s.assign(id,{user_id:undefined,target_id:9999})).status,404);
  assert.equal((await s.assign(id,{user_id:undefined})).status,400);
});

test("GN-11 reportes filtrados de impacto, uso y vencimientos sin fórmulas ejecutables", async(t)=>{
  const s=await setup(t),b=await s.business({name:"=SUM(A1:A2)"}),i=await s.indicator(b.id),id=await s.license({business_id:b.id,reference:"+CONTRATO"});
  await s.request(`businesses/indicators/${i}/measurements`,s.admin,"POST",{value:75,measured_on:date,evidence:"Soporte con coma, salto\ny comillas \"",request_id:randomUUID()});
  await s.assign(id);
  let report=await s.request("businesses/export.csv?sdg_id=12",s.admin);
  assert.match(report.body,/"'=SUM/);assert.match(report.body,/"50"/);assert.match(report.body,/""/);assert.match(report.headers.get("content-disposition"),/attachment/);
  assert.doesNotMatch((await s.request("businesses/export.csv?sdg_id=9",s.admin)).body,/SUM/);
  report=await s.request("licenses/export.csv?business_id="+b.id,s.admin);
  assert.match(report.body,/"'\+CONTRATO"/);assert.match(report.body,/"2"/);
  assert.match((await s.request("licenses/usage.csv",s.admin)).body,/editor/);
  assert.equal((await s.request("licenses/usage.csv?state=expired",s.admin)).body.split("\r\n").length,2);
});

test("GN-12 autorización de API por rol y CSRF/origen en nuevas rutas",async(t)=>{
  const s=await setup(t),b=await s.business(),id=await s.license();
  for(const path of ["businesses","businesses/options","businesses/"+b.id,"licenses","licenses/options","licenses/"+id]){
    assert.equal((await s.request(path)).status,401);
    assert.equal((await s.request(path,await s.login("lector"))).status,403);
  }
  const editor=await s.login("editor"),supervisor=await s.login("supervisor");
  for(const path of ["businesses","licenses"]) {
    assert.equal((await s.request(path,editor)).status,200);assert.equal((await s.request(path,supervisor)).status,200);
    assert.equal((await s.request(path+"/export.csv",editor)).status,403);assert.equal((await s.request(path+"/export.csv",supervisor)).status,200);
    assert.equal((await s.request(path,supervisor,"POST",{})).status,403);
    assert.equal((await s.request(path,{cookie:s.admin.cookie},"POST",{})).status,403);
    assert.equal((await s.request(path,s.admin,"POST",{},{Origin:"https://evil.example"})).status,403);
  }
  assert.equal((await s.request("businesses/"+b.id,editor,"PATCH",{expected_version:1,name:"Editor autorizado"})).status,200);
  assert.equal((await s.request("licenses/"+id,editor,"PATCH",{expected_version:1,seats:10})).status,200);
});

test("GN-13 transacción revierte registro si falla su historial",async(t)=>{
  const s=await setup(t);
  s.db.exec("CREATE TRIGGER test_history_fail BEFORE INSERT ON business_history BEGIN SELECT RAISE(ABORT, 'historial no disponible'); END");
  const r=await s.request("businesses",s.admin,"POST",{name:"No debe persistir",description:"Fallo controlado del historial",kind:"service",owner_id:s.users.editor,budget_cents:0,currency:"DOP",sdg_ids:[12]});
  assert.equal(r.status,500);assert.equal(s.db.prepare("SELECT COUNT(*) n FROM businesses").get().n,0);assert.equal(s.db.prepare("SELECT COUNT(*) n FROM business_sdgs").get().n,0);
  const software=await s.software();
  s.db.exec("CREATE TRIGGER test_license_history_fail BEFORE INSERT ON license_history BEGIN SELECT RAISE(ABORT, 'historial no disponible'); END");
  const failed=await s.request("licenses",s.admin,"POST",{software_id:software,reference:"NO-PERSISTIR",seats:1,starts_on:date,expires_on:date,cost_cents:0,currency:"DOP"});
  assert.equal(failed.status,500);assert.equal(s.db.prepare("SELECT COUNT(*) n FROM business_licenses").get().n,0);
});

test("GN-14 migración idempotente conserva datos y personalización de permisos",async(t)=>{
  const dir=await mkdtemp(join(tmpdir(),"foodsave-business-"));t.after(()=>rm(dir,{recursive:true,force:true}));const filename=join(dir,"test.sqlite");
  let db=openStore(filename);
  db.prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)").run("Migración","migration@example.test",hash,"editor");
  db.prepare("INSERT INTO foods(name,category,quantity,expires,created_by) VALUES ('Arroz','Otros',7,?,1)").run(day(5));
  db.prepare("UPDATE roles SET permissions=? WHERE id='editor'").run(JSON.stringify(["inventory.read"]));
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run("old-session",1,"csrf",Date.now()+10000);
  db.exec("DELETE FROM schema_migrations WHERE id='business-v1'");db.close();
  db=openStore(filename);
  assert.deepEqual(JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id='editor'").get().permissions).sort(),["inventory.read","business.read","business.manage","licenses.read","licenses.manage"].sort());
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n,0);
  db.prepare("UPDATE roles SET permissions=? WHERE id='editor'").run(JSON.stringify(["inventory.read","business.read"]));db.close();
  db=openStore(filename);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sdgs").get().n,17);
  assert.equal(db.prepare("SELECT quantity FROM foods").get().quantity,7);
  assert.deepEqual(JSON.parse(db.prepare("SELECT permissions FROM roles WHERE id='editor'").get().permissions),["inventory.read","business.read"]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE id='business-v1'").get().n,1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);db.close();
});
