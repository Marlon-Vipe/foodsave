import { openStore } from "./store.mjs";
const db = openStore(process.env.DATABASE_PATH ?? "app.sqlite");
try {
  if (db.prepare("SELECT id FROM operations LIMIT 1").get()) {
    console.log("Ya existen operaciones; se conservan los datos.");
  } else {
    const admin = db
      .prepare(
        "SELECT id FROM users WHERE role='administrador' AND active=1 ORDER BY id LIMIT 1",
      )
      .get();
    const owner = db
      .prepare(
        "SELECT u.id FROM users u JOIN roles r ON r.id=u.role WHERE u.active=1 AND r.permissions LIKE '%operations.manage%' ORDER BY CASE WHEN u.role='editor' THEN 0 ELSE 1 END,u.id LIMIT 1",
      )
      .get();
    if (!admin || !owner)
      throw new Error(
        "Ejecuta primero npm run demo o crea un administrador y un responsable operativo.",
      );
    const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Santo_Domingo",
      }),
      expires = new Date(Date.now() + 14 * 86400000).toLocaleDateString(
        "en-CA",
        { timeZone: "America/Santo_Domingo" },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const food = Number(
        db
          .prepare(
            "INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)",
          )
          .run("Arroz · demostración operativa", "Otros", 12, expires, admin.id)
          .lastInsertRowid,
      );
      for (const [title, type, quantity] of [
        ["DEMO · Consumo planificado", "consumo", 3],
        ["DEMO · Descarte por calidad", "descarte", 1],
      ]) {
        const id = Number(
          db
            .prepare(
              "INSERT INTO operations(title,type,food_id,quantity,responsible_id,scheduled_date,notes,created_by) VALUES (?,?,?,?,?,?,?,?)",
            )
            .run(
              title,
              type,
              food,
              quantity,
              owner.id,
              today,
              "Datos de ejemplo de gestión operativa.",
              admin.id,
            ).lastInsertRowid,
        );
        const operation = db
          .prepare("SELECT * FROM operations WHERE id=?")
          .get(id);
        db.prepare(
          "INSERT INTO operation_history(operation_id,actor_id,action,after_json,note) VALUES (?,?,?,?,?)",
        ).run(
          id,
          admin.id,
          "created",
          JSON.stringify(operation),
          "Preparación de demostración",
        );
        db.prepare(
          "INSERT INTO audit(actor_id,action,target,ip) VALUES (?,?,?,?)",
        ).run(
          admin.id,
          "operation.created",
          JSON.stringify({ id, demo: true }),
          "local-demo",
        );
      }
      db.exec("COMMIT");
      console.log(
        "Dos operaciones pendientes y un alimento de demostración creados.",
      );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
} finally {
  db.close();
}
