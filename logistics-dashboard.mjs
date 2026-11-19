const dayInSantoDomingo = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo" }).format(new Date());

const productKey = (name) =>
  name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("es");

export function initializeLogisticsDashboard(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_minimums(
      product_key TEXT NOT NULL,
      category TEXT NOT NULL,
      minimum INTEGER NOT NULL CHECK(minimum BETWEEN 0 AND 1000000),
      version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(product_key,category)
    );
    INSERT OR IGNORE INTO schema_migrations(id) VALUES ('logistics-dashboard-v1');
  `);
}

export function collectLogisticsDashboard(db, date = dayInSantoDomingo()) {
  const groups = new Map();
  const lots = db.prepare("SELECT id,name,category,quantity,expires,status FROM foods ORDER BY id").all();
  const settings = db.prepare("SELECT * FROM stock_minimums").all();
  const keyFor = (name, category) => JSON.stringify([productKey(name), category]);
  const configured = new Map(settings.map((row) => [JSON.stringify([row.product_key, row.category]), row]));
  const eligible = [];
  const expiryAlerts = [];
  let physicalUnits = 0;

  for (const lot of lots) {
    const key = keyFor(lot.name, lot.category);
    if (!groups.has(key)) {
      const setting = configured.get(key);
      groups.set(key, {
        food_id: lot.id, name: lot.name, category: lot.category,
        minimum: setting?.minimum ?? 0, version: setting?.version ?? 0,
        available: 0, replenishment_lot_id: null,
      });
    }
    const product = groups.get(key);
    if (lot.status !== "available" || lot.quantity <= 0) continue;
    physicalUnits += lot.quantity;
    const daysRemaining = Math.round((Date.parse(lot.expires) - Date.parse(date)) / 86400000);
    if (daysRemaining < 0) {
      expiryAlerts.push({ kind: "expired", ...lot, days_remaining: daysRemaining });
      continue;
    }
    product.available += lot.quantity;
    if (lot.quantity < 10000 && product.replenishment_lot_id === null)
      product.replenishment_lot_id = lot.id;
    eligible.push({ ...lot, days_remaining: daysRemaining });
    if (daysRemaining <= 7)
      expiryAlerts.push({ kind: "expiring", ...lot, days_remaining: daysRemaining });
  }

  eligible.sort((a, b) => a.expires.localeCompare(b.expires) || a.id - b.id);
  const productPositions = new Map();
  const priority = eligible.map((lot) => {
    const key = keyFor(lot.name, lot.category);
    const position = (productPositions.get(key) ?? 0) + 1;
    productPositions.set(key, position);
    return { ...lot, product_priority: position };
  });
  const products = [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "es") || a.category.localeCompare(b.category, "es"));
  const lowStock = products.filter((p) => p.minimum > 0 && p.available < p.minimum)
    .map((product) => ({ kind: "low", ...product, missing: product.minimum - product.available }));
  expiryAlerts.sort((a, b) => a.expires.localeCompare(b.expires) || a.id - b.id);
  const daily = db.prepare(`
    SELECT type,COUNT(*) movements,COALESCE(SUM(quantity),0) units
    FROM stock_movements
    WHERE type IN ('entry','exit') AND date(created_at,'-4 hours')=?
    GROUP BY type
  `).all(date);
  const entries = daily.find((row) => row.type === "entry");
  const exits = daily.find((row) => row.type === "exit");
  return {
    date, expiry_window_days: 7,
    summary: {
      physical_units: physicalUnits,
      available_units: products.reduce((sum, p) => sum + p.available, 0),
      expiring_lots: expiryAlerts.filter((a) => a.kind === "expiring").length,
      expired_lots: expiryAlerts.filter((a) => a.kind === "expired").length,
      low_stock_products: lowStock.length,
      entry_units_today: entries?.units ?? 0, entry_movements_today: entries?.movements ?? 0,
      exit_units_today: exits?.units ?? 0, exit_movements_today: exits?.movements ?? 0,
    },
    products, priority, alerts: [...expiryAlerts, ...lowStock],
  };
}

export function handleLogisticsDashboard(context) {
  const { req, path, db, body, user, requirePermission, fail, json, transaction, audit } = context;
  if (path === "/api/logistics/dashboard") {
    requirePermission("logistics.read");
    if (req.method !== "GET") fail(405, "Método no permitido");
    json(200, collectLogisticsDashboard(db));
    return true;
  }
  if (path !== "/api/logistics/minimums") return false;
  requirePermission("logistics.read");
  requirePermission("logistics.move");
  if (req.method !== "PUT") fail(405, "Método no permitido");
  const { food_id, minimum, expected_version } = body;
  if (Object.keys(body).some((key) => !["food_id", "minimum", "expected_version"].includes(key)) ||
      !Number.isSafeInteger(food_id) || food_id <= 0 ||
      !Number.isSafeInteger(minimum) || minimum < 0 || minimum > 1000000 ||
      !Number.isSafeInteger(expected_version) || expected_version < 0)
    fail(400, "Indica alimento, mínimo entero de 0 a 1 000 000 y versión actual");
  const result = transaction(() => {
    const food = db.prepare("SELECT name,category FROM foods WHERE id=?").get(food_id);
    if (!food) fail(404, "Alimento no encontrado");
    const key = productKey(food.name);
    const previous = db.prepare("SELECT minimum,version FROM stock_minimums WHERE product_key=? AND category=?")
      .get(key, food.category);
    if ((previous?.version ?? 0) !== expected_version)
      fail(409, "El mínimo cambió. Actualiza el panel antes de guardar");
    db.prepare(`
      INSERT INTO stock_minimums(product_key,category,minimum,updated_by) VALUES (?,?,?,?)
      ON CONFLICT(product_key,category) DO UPDATE SET
        minimum=excluded.minimum,version=stock_minimums.version+1,
        updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
    `).run(key, food.category, minimum, user.id);
    audit(user.id, "logistics.minimum.updated", JSON.stringify({
      food_id, category: food.category, before: previous?.minimum ?? 0, after: minimum,
    }), req.socket.remoteAddress);
    return { minimum, version: expected_version + 1 };
  });
  json(200, result);
  return true;
}
