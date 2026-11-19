export const financePermissions = ["finance.read", "finance.manage", "finance.report", "ai.use"];
export const todayDO = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());
export const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const validCents = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
export const validText = (value, min = 2, max = 200) =>
  typeof value === "string" && value.trim().length >= min && value.length <= max;

export function initializeFinance(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lot_costs(
        food_id INTEGER PRIMARY KEY REFERENCES foods(id),unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents BETWEEN 0 AND 100000000),
        actor_id INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS financial_movements(
        movement_id INTEGER PRIMARY KEY REFERENCES stock_movements(id),
        kind TEXT NOT NULL CHECK(kind IN ('purchase','consumption','waste','distribution')),
        unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
        total_cents INTEGER NOT NULL CHECK(total_cents>=0),booked_on TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monthly_budgets(
        month TEXT PRIMARY KEY,amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
        version INTEGER NOT NULL DEFAULT 1,actor_id INTEGER NOT NULL REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS economic_records(
        id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('aid','expense')),
        description TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
        booked_on TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),
        request_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS product_imports(
        id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL REFERENCES users(id),image_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('processing','review','committed','failed')),
        draft_json TEXT,result_json TEXT,created_at INTEGER NOT NULL,
        UNIQUE(actor_id,image_hash)
      );
      CREATE TABLE IF NOT EXISTS ai_requests(
        id INTEGER PRIMARY KEY,actor_id INTEGER NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS financial_booked ON financial_movements(booked_on);
      CREATE INDEX IF NOT EXISTS economic_booked ON economic_records(booked_on);
      CREATE INDEX IF NOT EXISTS ai_requests_actor_time ON ai_requests(actor_id,created_at);
    `);
    if (db.prepare("INSERT OR IGNORE INTO schema_migrations(id) VALUES ('finance-v1')").run().changes) {
      const defaults = {
        administrador: financePermissions,
        editor: ["finance.read", "finance.manage", "ai.use"],
        supervisor: ["finance.read", "finance.report", "ai.use"],
      };
      for (const [role, grants] of Object.entries(defaults)) {
        const row = db.prepare("SELECT permissions FROM roles WHERE id=?").get(role);
        if (!row) continue;
        db.prepare("UPDATE roles SET permissions=? WHERE id=?")
          .run(JSON.stringify([...new Set([...JSON.parse(row.permissions), ...grants])]), role);
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)").run(role);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordFinancialMovement(db, { movementId, foodId, type, source, operationId, quantity, bookedOn = todayDO() }) {
  if (type === "opening") return;
  const cost = db.prepare("SELECT unit_cost_cents FROM lot_costs WHERE food_id=?").get(foodId);
  if (!cost) return;
  let kind = "purchase";
  if (type === "exit") {
    if (operationId) {
      kind = db.prepare("SELECT type FROM operations WHERE id=?").get(operationId).type === "descarte" ? "waste" : "consumption";
    } else if (source === "inventory") {
      kind = db.prepare("SELECT status FROM foods WHERE id=?").get(foodId).status === "wasted" ? "waste" : "consumption";
    } else {
      kind = "distribution";
    }
  }
  db.prepare("INSERT INTO financial_movements VALUES (?,?,?,?,?)")
    .run(movementId, kind, cost.unit_cost_cents, cost.unit_cost_cents * quantity, bookedOn);
}

export function collectFinance(db, month = todayDO().slice(0, 7)) {
  const date = todayDO();
  const lots = db.prepare(`SELECT f.*,c.unit_cost_cents FROM foods f
    LEFT JOIN lot_costs c ON c.food_id=f.id ORDER BY f.expires,f.id`).all();
  const active = lots.filter((lot) => lot.status === "available" && lot.quantity > 0);
  const known = active.filter((lot) => lot.unit_cost_cents !== null);
  const missing = active.filter((lot) => lot.unit_cost_cents === null);
  const valuation = (list) => list.reduce((sum, lot) => sum + lot.quantity * lot.unit_cost_cents, 0);
  const expiring = known.filter((lot) => {
    const days = (Date.parse(lot.expires) - Date.parse(date)) / 86400000;
    return days >= 0 && days <= 7;
  });
  const expired = known.filter((lot) => lot.expires < date);
  const movements = db.prepare(`SELECT m.id,m.food_id,f.name,m.type,m.source,m.quantity,m.created_at,
      v.kind,v.unit_cost_cents,v.total_cents,COALESCE(v.booked_on,date(m.created_at,'-4 hours')) AS booked_on
    FROM stock_movements m JOIN foods f ON f.id=m.food_id
    LEFT JOIN financial_movements v ON v.movement_id=m.id
    WHERE substr(COALESCE(v.booked_on,date(m.created_at,'-4 hours')),1,7)=? AND m.type!='opening'
    ORDER BY m.id DESC`).all(month);
  const economic = db.prepare("SELECT * FROM economic_records WHERE substr(booked_on,1,7)=? ORDER BY booked_on DESC,id DESC").all(month);
  const sum = (rows) => rows.reduce((total, row) => total + row.amount_cents, 0);
  const purchases = movements.filter((row) => row.kind === "purchase").reduce((total, row) => total + row.total_cents, 0);
  const expenses = sum(economic.filter((row) => row.kind === "expense"));
  const aid = sum(economic.filter((row) => row.kind === "aid"));
  const waste = movements.filter((row) => row.kind === "waste").reduce((total, row) => total + row.total_cents, 0);
  const budget = db.prepare("SELECT amount_cents,version FROM monthly_budgets WHERE month=?").get(month);
  return {
    month, date, currency: "DOP", budget: budget ?? { amount_cents: null, version: 0 },
    summary: {
      purchases_cents: purchases, extra_expenses_cents: expenses, spending_cents: purchases + expenses,
      aid_cents: aid, out_of_pocket_cents: Math.max(0, purchases + expenses - aid),
      remaining_cents: budget ? budget.amount_cents + aid - purchases - expenses : null,
      inventory_value_cents: valuation(known), risk_cents: valuation(expiring),
      expired_value_cents: valuation(expired), waste_cents: waste,
      unpriced_lots: missing.length, unpriced_movements: movements.filter((row) => row.total_cents === null).length,
    },
    lots, movements, economic, at_risk: expiring, expired,
  };
}
