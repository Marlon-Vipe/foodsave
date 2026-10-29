import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const permissions = [
  "users.read",
  "users.manage",
  "roles.manage",
  "audit.read",
  "inventory.read",
  "inventory.manage",
  "reports.read",
];
export const defaults = {
  administrador: permissions,
  editor: ["inventory.read", "inventory.manage"],
  supervisor: ["inventory.read", "reports.read"],
  lector: ["inventory.read"],
};
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(password, salt, 64)).toString("hex");
}
export async function verifyPassword(password, encoded) {
  const [salt, hash] = encoded.split(":");
  return timingSafeEqual(
    Buffer.from(hash, "hex"),
    await scrypt(password, salt, 64),
  );
}
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, permissions TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL REFERENCES roles(id), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS foods (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, quantity INTEGER NOT NULL, expires TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'available', created_by INTEGER NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
  for (const [id, p] of Object.entries(defaults))
    db.prepare("INSERT OR IGNORE INTO roles VALUES (?,?)").run(
      id,
      JSON.stringify(p),
    );
  return db;
}
export function publicUser(user) {
  const { password, ...safe } = user;
  return safe;
}
