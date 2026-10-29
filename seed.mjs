import { openStore, hashPassword } from "./store.mjs";
const db = openStore(process.env.DATABASE_PATH ?? "app.sqlite");
const email = process.env.ADMIN_EMAIL,
  password = process.env.ADMIN_PASSWORD;
if (
  !email ||
  !password ||
  password.length < 12 ||
  password.length > 128 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
) {
  console.error(
    "Define ADMIN_EMAIL válido y ADMIN_PASSWORD de 12–128 caracteres.",
  );
  process.exitCode = 1;
} else if (
  db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email.trim().toLowerCase())
) {
  console.error("El usuario ya existe; no se alteró su rol ni contraseña.");
  process.exitCode = 1;
} else {
  db.prepare(
    "INSERT INTO users(name,email,password,role) VALUES (?,?,?,'administrador')",
  ).run(
    "Administrador",
    email.trim().toLowerCase(),
    await hashPassword(password),
  );
  console.log("Administrador creado.");
}
db.close();
