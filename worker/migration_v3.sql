-- Migration v3 : passage au modèle complet du cahier des charges
-- (Propriétaires -> Maisons -> Logements -> Contrats -> Locataires -> Paiements,
--  rôles utilisateurs, historique des opérations).
--
-- Les tables v1/v2 (tenants/payments/users/sessions simplifiées) sont
-- remplacées : il n'y avait que des données de test dedans, rien à
-- préserver. Exécuter une seule fois dans la Console D1 de "immo-loyers".

DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS leases;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS units;
DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS owners;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS activity_logs;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  nom TEXT,
  prenom TEXT,
  telephone TEXT,
  email TEXT NOT NULL UNIQUE,
  username TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'administrateur',
  statut TEXT NOT NULL DEFAULT 'actif',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE owners (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  telephone TEXT,
  adresse TEXT,
  email TEXT,
  note TEXT,
  statut TEXT NOT NULL DEFAULT 'actif',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  reference TEXT,
  nom TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  adresse TEXT,
  ville TEXT,
  description TEXT,
  statut TEXT NOT NULL DEFAULT 'actif',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  reference TEXT,
  property_id TEXT NOT NULL REFERENCES properties(id),
  numero TEXT NOT NULL,
  type TEXT,
  description TEXT,
  rent REAL NOT NULL,
  caution REAL,
  statut TEXT NOT NULL DEFAULT 'disponible',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT,
  telephone TEXT,
  email TEXT,
  adresse TEXT,
  piece_identite TEXT,
  numero_piece TEXT,
  date_naissance TEXT,
  contact_urgence_nom TEXT,
  contact_urgence_telephone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  numero TEXT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  date_debut TEXT NOT NULL,
  date_fin TEXT,
  rent REAL NOT NULL,
  caution REAL,
  jour_paiement INTEGER,
  conditions TEXT,
  statut TEXT NOT NULL DEFAULT 'actif',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  method TEXT,
  reference TEXT,
  note TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE activity_logs (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_properties_owner ON properties(owner_id);
CREATE INDEX idx_units_property ON units(property_id);
CREATE INDEX idx_leases_tenant ON leases(tenant_id);
CREATE INDEX idx_leases_unit ON leases(unit_id);
CREATE INDEX idx_payments_lease ON payments(lease_id);
CREATE INDEX idx_payments_period ON payments(period);
CREATE INDEX idx_activity_created ON activity_logs(created_at);

-- Compte administrateur initial : editadigoun@gmail.com / fanati09
-- (mot de passe stocké hashé PBKDF2, jamais en clair)
INSERT INTO users (id, email, password_hash, role, statut) VALUES (
  '1b6ca784-f6bd-4c52-9cd3-2e637adbdb35',
  'editadigoun@gmail.com',
  'pbkdf2$100000$HNj40yuXXWa8099cglHNmA==$MpIfRZVAwFDesAzR6Pclbqbji7TXgW2LaVmR8ZaQHWo=',
  'administrateur',
  'actif'
);
