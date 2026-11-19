import { foodCategories, recordMovement, stockLimit } from "./logistics.mjs";
import { todayDO, validDate, validCents } from "./finance-store.mjs";

export function validateFood(data, fail) {
  if (typeof data.name !== "string" || data.name.trim().length < 2 || data.name.length > 100 ||
      !foodCategories.includes(data.category) || !Number.isInteger(data.quantity) ||
      data.quantity < 1 || data.quantity > stockLimit || !validDate(data.expires))
    fail(400, "Revisa nombre, categoría, cantidad entera y fecha de vencimiento");
  if (data.unit_cost_cents !== undefined && data.unit_cost_cents !== null && !validCents(data.unit_cost_cents))
    fail(400, "El costo unitario debe expresarse en centavos enteros de RD$");
  if (data.purchased_on !== undefined && (!validDate(data.purchased_on) || data.purchased_on > todayDO()))
    fail(400, "La fecha de compra debe ser válida y no puede ser futura");
}

// Caller owns the transaction so imports and single registrations share the same rules.
export function createFoodLot(db, data, actor, audit, ip, fail) {
  validateFood(data, fail);
  const foodId = Number(db.prepare("INSERT INTO foods(name,category,quantity,expires,created_by) VALUES (?,?,?,?,?)")
    .run(data.name.trim(), data.category, data.quantity, data.expires, actor).lastInsertRowid);
  if (data.unit_cost_cents !== undefined && data.unit_cost_cents !== null)
    db.prepare("INSERT INTO lot_costs(food_id,unit_cost_cents,actor_id) VALUES (?,?,?)")
      .run(foodId, data.unit_cost_cents, actor);
  recordMovement(db, { foodId, type: "entry", source: "inventory", before: 0, after: data.quantity,
    reason: data.imported ? "Registro desde lectura de imagen revisada" : "Registro de lote",
    actor, bookedOn: data.purchased_on ?? todayDO() });
  audit(actor, "food.created", foodId, ip);
  return foodId;
}
