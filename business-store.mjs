export const businessPermissions = ["business.read", "business.manage", "business.report"];
export const licensePermissions = ["licenses.read", "licenses.manage", "licenses.report"];
export const sdgNames = [
  "Fin de la pobreza", "Hambre cero", "Salud y bienestar", "Educación de calidad",
  "Igualdad de género", "Agua limpia y saneamiento", "Energía asequible y no contaminante",
  "Trabajo decente y crecimiento económico", "Industria, innovación e infraestructura",
  "Reducción de las desigualdades", "Ciudades y comunidades sostenibles",
  "Producción y consumo responsables", "Acción por el clima", "Vida submarina",
  "Vida de ecosistemas terrestres", "Paz, justicia e instituciones sólidas", "Alianzas para lograr los objetivos",
];
export function initializeBusiness(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sdgs(id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 17),name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS businesses(
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('initiative','product','service')),
        owner_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','archived')),
        budget_cents INTEGER NOT NULL CHECK(budget_cents>=0), currency TEXT NOT NULL CHECK(currency IN ('DOP','USD')),
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS business_sdgs(
        business_id INTEGER NOT NULL REFERENCES businesses(id),sdg_id INTEGER NOT NULL REFERENCES sdgs(id),
        PRIMARY KEY(business_id,sdg_id)
      );
      CREATE TABLE IF NOT EXISTS business_projects(
        id INTEGER PRIMARY KEY,business_id INTEGER NOT NULL REFERENCES businesses(id),
        name TEXT NOT NULL,owner_id INTEGER NOT NULL REFERENCES users(id),
        starts_on TEXT NOT NULL,ends_on TEXT NOT NULL CHECK(ends_on>=starts_on),
        status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed')),
        version INTEGER NOT NULL DEFAULT 1,UNIQUE(id,business_id)
      );
      CREATE TABLE IF NOT EXISTS business_indicators(
        id INTEGER PRIMARY KEY,business_id INTEGER NOT NULL REFERENCES businesses(id),
        project_id INTEGER,sdg_id INTEGER NOT NULL REFERENCES sdgs(id),
        name TEXT NOT NULL,dimension TEXT NOT NULL CHECK(dimension IN ('economic','social','environmental')),
        unit TEXT NOT NULL,baseline REAL NOT NULL CHECK(baseline>=0),
        target REAL NOT NULL CHECK(target>=0 AND target!=baseline),
        due_on TEXT NOT NULL,
        FOREIGN KEY(project_id,business_id) REFERENCES business_projects(id,business_id),
        FOREIGN KEY(business_id,sdg_id) REFERENCES business_sdgs(business_id,sdg_id)
      );
      CREATE TABLE IF NOT EXISTS indicator_measurements(
        id INTEGER PRIMARY KEY,indicator_id INTEGER NOT NULL REFERENCES business_indicators(id),
        value REAL NOT NULL CHECK(value>=0),measured_on TEXT NOT NULL,
        evidence TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        request_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS business_history(
        id INTEGER PRIMARY KEY,business_id INTEGER NOT NULL REFERENCES businesses(id),
        actor_id INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,
        before_json TEXT,after_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS business_software(
        id INTEGER PRIMARY KEY,name TEXT NOT NULL,vendor TEXT NOT NULL,
        UNIQUE(name COLLATE NOCASE,vendor COLLATE NOCASE)
      );
      CREATE TABLE IF NOT EXISTS license_targets(
        id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('equipment','area')),
        name TEXT NOT NULL,UNIQUE(kind,name COLLATE NOCASE)
      );
      CREATE TABLE IF NOT EXISTS business_licenses(
        id INTEGER PRIMARY KEY,software_id INTEGER NOT NULL REFERENCES business_software(id),
        business_id INTEGER REFERENCES businesses(id),reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
        seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 10000),
        starts_on TEXT NOT NULL,expires_on TEXT NOT NULL CHECK(expires_on>=starts_on),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        cost_cents INTEGER NOT NULL CHECK(cost_cents>=0),currency TEXT NOT NULL CHECK(currency IN ('DOP','USD')),
        version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS license_assignments(
        id INTEGER PRIMARY KEY,license_id INTEGER NOT NULL REFERENCES business_licenses(id),
        user_id INTEGER REFERENCES users(id),target_id INTEGER REFERENCES license_targets(id),
        seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 10000),
        assigned_by INTEGER NOT NULL REFERENCES users(id),assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_by INTEGER REFERENCES users(id),released_at TEXT,release_note TEXT,request_id TEXT NOT NULL UNIQUE,
        CHECK((user_id IS NOT NULL AND target_id IS NULL) OR (user_id IS NULL AND target_id IS NOT NULL)),
        CHECK((released_at IS NULL AND released_by IS NULL AND release_note IS NULL)
          OR (released_at IS NOT NULL AND released_by IS NOT NULL AND release_note IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS license_history(
        id INTEGER PRIMARY KEY,license_id INTEGER NOT NULL REFERENCES business_licenses(id),
        actor_id INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,
        before_json TEXT,after_json TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS license_history_parent ON license_history(license_id,id);
      CREATE UNIQUE INDEX IF NOT EXISTS license_assigned_user ON license_assignments(license_id,user_id) WHERE released_at IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS license_assigned_target ON license_assignments(license_id,target_id) WHERE released_at IS NULL;
      CREATE INDEX IF NOT EXISTS licenses_expiration ON business_licenses(expires_on);
      CREATE INDEX IF NOT EXISTS assignments_license ON license_assignments(license_id,released_at);
      CREATE INDEX IF NOT EXISTS projects_business ON business_projects(business_id);
      CREATE INDEX IF NOT EXISTS indicators_business ON business_indicators(business_id);
      CREATE INDEX IF NOT EXISTS measurements_latest ON indicator_measurements(indicator_id,measured_on DESC);
      CREATE INDEX IF NOT EXISTS business_history_parent ON business_history(business_id,id);
    `);
    const insertSDG = db.prepare("INSERT OR IGNORE INTO sdgs VALUES (?,?)");
    sdgNames.forEach((name, index) => insertSDG.run(index + 1, name));
    if (db.prepare("INSERT OR IGNORE INTO schema_migrations(id) VALUES ('business-v1')").run().changes) {
      const read = ["business.read", "licenses.read"];
      const manage = ["business.manage", "licenses.manage"];
      const report = ["business.report", "licenses.report"];
      const defaults = {
        administrador: [...read, ...manage, ...report],
        editor: [...read, ...manage],
        supervisor: [...read, ...report],
      };
      for (const [role, grants] of Object.entries(defaults)) {
        const record = db.prepare("SELECT permissions FROM roles WHERE id=?").get(role);
        if (!record) continue;
        db.prepare("UPDATE roles SET permissions=? WHERE id=?")
          .run(JSON.stringify([...new Set([...JSON.parse(record.permissions), ...grants])]), role);
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role=?)").run(role);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
