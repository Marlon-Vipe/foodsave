import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { openStore, hashPassword } from "./store.mjs";
const db = openStore(process.env.DATABASE_PATH ?? "app.sqlite");
const credentials = [];
for (const [role, name] of Object.entries({
  administrador: "Ana Martínez",
  editor: "Carlos Méndez",
  supervisor: "Laura Gómez",
  lector: "Sofía Reyes",
})) {
  const email = role + "@foodsave.test";
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) {
    console.log(email + ": ya existe; se conserva su contraseña.");
    continue;
  }
  const password = randomBytes(15).toString("base64url") + "!";
  const r = db
    .prepare("INSERT INTO users(name,email,password,role) VALUES (?,?,?,?)")
    .run(name, email, await hashPassword(password), role);
  credentials.push({ role, email, password });
  if (
    role === "administrador" &&
    !db.prepare("SELECT id FROM foods LIMIT 1").get()
  ) {
    for (const [name, category, quantity, days] of [
      ["Pollo", "Carnes", 1, 1],
      ["Yogur natural", "Lácteos", 2, 2],
      ["Lechuga", "Frutas y verduras", 1, 3],
      ["Leche entera", "Lácteos", 1, 4],
      ["Pan de molde", "Panadería", 1, 6],
    ]) {
      const date = new Date();
      date.setDate(date.getDate() + days);
      db.prepare(
        "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
      ).run(
        name,
        category,
        quantity,
        date.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }),
        Number(r.lastInsertRowid),
      );
    }
  }
}
if (credentials.length) {
  await writeFile(
    ".demo-credentials.json",
    JSON.stringify(credentials, null, 2),
    { mode: 0o600 },
  );
  console.log("Cuentas locales de demostración; contraseñas aleatorias:");
  for (const c of credentials)
    console.log(`${c.role}: ${c.email} / ${c.password}`);
  console.log("Guardadas en .demo-credentials.json (excluido de Git).");
}
db.close();
