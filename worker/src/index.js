const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key,Authorization",
};

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const ROLES = ["administrateur", "gestionnaire", "comptable"];
const OWNER_STATUTS = ["actif", "inactif"];
const UNIT_STATUTS = ["disponible", "occupe", "maintenance", "reserve"];
const LEASE_STATUTS = ["actif", "termine", "resilie", "en_attente"];

function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...(init && init.headers),
    },
  });
}
function error(message, status) {
  return json({ error: message }, { status: status || 400 });
}

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function isPositiveNumber(v) { return typeof v === "number" && isFinite(v) && v > 0; }
function isNonNegNumber(v) { return typeof v === "number" && isFinite(v) && v >= 0; }
function isIsoDate(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isPeriod(v) { return typeof v === "string" && /^\d{4}-\d{2}$/.test(v); }
function isEmail(v) { return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }
function isOneOf(v, arr) { return arr.indexOf(v) !== -1; }

async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}
function checkApiKey(request, env) {
  if (!env.API_KEY) return true;
  return request.headers.get("X-Api-Key") === env.API_KEY;
}

function bufToBase64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function base64ToBuf(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? base64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return "pbkdf2$" + PBKDF2_ITERATIONS + "$" + bufToBase64(salt) + "$" + bufToBase64(bits);
}
async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const expected = await hashPassword(password, parts[2]);
  return timingSafeEqual(expected, stored);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function genId() { return crypto.randomUUID(); }

async function getSessionUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const row = await env.DB.prepare(
    "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id " +
    "WHERE sessions.token = ? AND sessions.expires_at > datetime('now')"
  ).bind(match[1]).first();
  if (!row || row.statut !== "actif") return null;
  return row;
}
async function currentToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return (auth.match(/^Bearer\s+(.+)$/i) || [])[1];
}

function canWrite(user, resource) {
  if (user.role === "administrateur") return true;
  if (user.role === "gestionnaire") return ["tenants", "leases", "payments"].indexOf(resource) !== -1;
  return false; // comptable: read-only
}

async function log(env, user, action, details) {
  try {
    await env.DB.prepare("INSERT INTO activity_logs (id, user_email, action, details) VALUES (?, ?, ?, ?)")
      .bind(genId(), user ? user.email : null, action, JSON.stringify(details || {}))
      .run();
  } catch (e) { /* best-effort */ }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    if (!path.startsWith("/api")) return error("Not found", 404);
    if (!checkApiKey(request, env)) return error("Clé API invalide", 401);

    try {
      // ---- Auth (public) ----
      if (path === "/api/auth/login" && method === "POST") {
        const body = await readJson(request);
        if (!body || !isEmail(body.email) || !isNonEmptyString(body.password)) {
          return error("Email et mot de passe requis.");
        }
        const email = body.email.trim().toLowerCase();
        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
        if (!user || user.statut !== "actif" || !(await verifyPassword(body.password, user.password_hash))) {
          return error("Email ou mot de passe incorrect.", 401);
        }
        const token = generateToken();
        const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(token, user.id, expiresAt).run();
        await log(env, user, "connexion", {});
        return json({ token, user: mapUser(user) }, { status: 201 });
      }

      const currentUser = await getSessionUser(request, env);
      if (!currentUser) return error("Authentification requise.", 401);

      if (path === "/api/auth/logout" && method === "POST") {
        const token = await currentToken(request);
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
        return json({ ok: true });
      }
      if (path === "/api/auth/me" && method === "GET") {
        return json({ user: mapUser(currentUser) });
      }

      // ---- Consolidated data ----
      if (path === "/api/data" && method === "GET") {
        const [owners, properties, units, tenants, leases, payments, activity] = await Promise.all([
          env.DB.prepare("SELECT * FROM owners ORDER BY nom").all(),
          env.DB.prepare("SELECT * FROM properties ORDER BY nom").all(),
          env.DB.prepare("SELECT * FROM units ORDER BY numero").all(),
          env.DB.prepare("SELECT * FROM tenants ORDER BY nom").all(),
          env.DB.prepare("SELECT * FROM leases ORDER BY date_debut DESC").all(),
          env.DB.prepare("SELECT * FROM payments ORDER BY period DESC, date DESC").all(),
          env.DB.prepare("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100").all(),
        ]);
        const out = {
          owners: owners.results.map(mapOwner),
          properties: properties.results.map(mapProperty),
          units: units.results.map(mapUnit),
          tenants: tenants.results.map(mapTenant),
          leases: leases.results.map(mapLease),
          payments: payments.results.map(mapPayment),
          activity: activity.results.map(mapActivity),
        };
        if (currentUser.role === "administrateur") {
          const users = await env.DB.prepare("SELECT * FROM users ORDER BY created_at").all();
          out.users = users.results.map(mapUser);
        }
        return json(out);
      }

      // ================= OWNERS =================
      if (path === "/api/owners" && method === "POST") {
        if (!canWrite(currentUser, "owners")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.nom)) return error("Le nom du propriétaire est requis.");
        if (b.statut && !isOneOf(b.statut, OWNER_STATUTS)) return error("Statut invalide.");
        const id = genId();
        await env.DB.prepare(
          "INSERT INTO owners (id, nom, telephone, adresse, email, note, statut) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(id, b.nom.trim(), b.telephone || null, b.adresse || null, b.email || null, b.note || null, b.statut || "actif").run();
        const row = await env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(id).first();
        await log(env, currentUser, "creation_proprietaire", { id, nom: b.nom });
        return json(mapOwner(row), { status: 201 });
      }
      let m = path.match(/^\/api\/owners\/([^/]+)$/);
      if (m && method === "PUT") {
        if (!canWrite(currentUser, "owners")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.nom)) return error("Le nom du propriétaire est requis.");
        if (b.statut && !isOneOf(b.statut, OWNER_STATUTS)) return error("Statut invalide.");
        const r = await env.DB.prepare(
          "UPDATE owners SET nom=?, telephone=?, adresse=?, email=?, note=?, statut=? WHERE id=?"
        ).bind(b.nom.trim(), b.telephone || null, b.adresse || null, b.email || null, b.note || null, b.statut || "actif", m[1]).run();
        if (r.meta.changes === 0) return error("Propriétaire introuvable", 404);
        const row = await env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(m[1]).first();
        await log(env, currentUser, "modification_proprietaire", { id: m[1] });
        return json(mapOwner(row));
      }
      if (m && method === "DELETE") {
        if (!canWrite(currentUser, "owners")) return error("Action non autorisée pour ce rôle.", 403);
        const dep = await env.DB.prepare("SELECT COUNT(*) AS n FROM properties WHERE owner_id = ?").bind(m[1]).first();
        if (dep.n > 0) return error("Impossible de supprimer : ce propriétaire a encore des maisons rattachées.", 409);
        const r = await env.DB.prepare("DELETE FROM owners WHERE id = ?").bind(m[1]).run();
        if (r.meta.changes === 0) return error("Propriétaire introuvable", 404);
        await log(env, currentUser, "suppression_proprietaire", { id: m[1] });
        return json({ ok: true });
      }

      // ================= PROPERTIES (maisons) =================
      if (path === "/api/properties" && method === "POST") {
        if (!canWrite(currentUser, "properties")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.nom) || !isNonEmptyString(b.owner_id)) return error("Nom et propriétaire requis.");
        const owner = await env.DB.prepare("SELECT id FROM owners WHERE id = ?").bind(b.owner_id).first();
        if (!owner) return error("Propriétaire introuvable", 404);
        const id = genId();
        await env.DB.prepare(
          "INSERT INTO properties (id, reference, nom, owner_id, adresse, ville, description, statut) VALUES (?,?,?,?,?,?,?,?)"
        ).bind(id, b.reference || null, b.nom.trim(), b.owner_id, b.adresse || null, b.ville || null, b.description || null, b.statut || "actif").run();
        const row = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(id).first();
        await log(env, currentUser, "creation_maison", { id, nom: b.nom });
        return json(mapProperty(row), { status: 201 });
      }
      m = path.match(/^\/api\/properties\/([^/]+)$/);
      if (m && method === "PUT") {
        if (!canWrite(currentUser, "properties")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.nom) || !isNonEmptyString(b.owner_id)) return error("Nom et propriétaire requis.");
        const r = await env.DB.prepare(
          "UPDATE properties SET reference=?, nom=?, owner_id=?, adresse=?, ville=?, description=?, statut=? WHERE id=?"
        ).bind(b.reference || null, b.nom.trim(), b.owner_id, b.adresse || null, b.ville || null, b.description || null, b.statut || "actif", m[1]).run();
        if (r.meta.changes === 0) return error("Maison introuvable", 404);
        const row = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(m[1]).first();
        await log(env, currentUser, "modification_maison", { id: m[1] });
        return json(mapProperty(row));
      }
      if (m && method === "DELETE") {
        if (!canWrite(currentUser, "properties")) return error("Action non autorisée pour ce rôle.", 403);
        const dep = await env.DB.prepare("SELECT COUNT(*) AS n FROM units WHERE property_id = ?").bind(m[1]).first();
        if (dep.n > 0) return error("Impossible de supprimer : cette maison a encore des logements rattachés.", 409);
        const r = await env.DB.prepare("DELETE FROM properties WHERE id = ?").bind(m[1]).run();
        if (r.meta.changes === 0) return error("Maison introuvable", 404);
        await log(env, currentUser, "suppression_maison", { id: m[1] });
        return json({ ok: true });
      }

      // ================= UNITS (logements) =================
      if (path === "/api/units" && method === "POST") {
        if (!canWrite(currentUser, "units")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.numero) || !isNonEmptyString(b.property_id) || !isPositiveNumber(b.rent)) {
          return error("Numéro, maison et loyer (>0) requis.");
        }
        const prop = await env.DB.prepare("SELECT id FROM properties WHERE id = ?").bind(b.property_id).first();
        if (!prop) return error("Maison introuvable", 404);
        if (b.statut && !isOneOf(b.statut, UNIT_STATUTS)) return error("Statut invalide.");
        const id = genId();
        await env.DB.prepare(
          "INSERT INTO units (id, reference, property_id, numero, type, description, rent, caution, statut) VALUES (?,?,?,?,?,?,?,?,?)"
        ).bind(id, b.reference || null, b.property_id, b.numero.trim(), b.type || null, b.description || null, b.rent, b.caution || null, b.statut || "disponible").run();
        const row = await env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(id).first();
        await log(env, currentUser, "creation_logement", { id, numero: b.numero });
        return json(mapUnit(row), { status: 201 });
      }
      m = path.match(/^\/api\/units\/([^/]+)$/);
      if (m && method === "PUT") {
        if (!canWrite(currentUser, "units")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.numero) || !isNonEmptyString(b.property_id) || !isPositiveNumber(b.rent)) {
          return error("Numéro, maison et loyer (>0) requis.");
        }
        if (b.statut && !isOneOf(b.statut, UNIT_STATUTS)) return error("Statut invalide.");
        const r = await env.DB.prepare(
          "UPDATE units SET reference=?, property_id=?, numero=?, type=?, description=?, rent=?, caution=?, statut=? WHERE id=?"
        ).bind(b.reference || null, b.property_id, b.numero.trim(), b.type || null, b.description || null, b.rent, b.caution || null, b.statut || "disponible", m[1]).run();
        if (r.meta.changes === 0) return error("Logement introuvable", 404);
        const row = await env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(m[1]).first();
        await log(env, currentUser, "modification_logement", { id: m[1] });
        return json(mapUnit(row));
      }
      if (m && method === "DELETE") {
        if (!canWrite(currentUser, "units")) return error("Action non autorisée pour ce rôle.", 403);
        const dep = await env.DB.prepare("SELECT COUNT(*) AS n FROM leases WHERE unit_id = ?").bind(m[1]).first();
        if (dep.n > 0) return error("Impossible de supprimer : ce logement a des contrats rattachés.", 409);
        const r = await env.DB.prepare("DELETE FROM units WHERE id = ?").bind(m[1]).run();
        if (r.meta.changes === 0) return error("Logement introuvable", 404);
        await log(env, currentUser, "suppression_logement", { id: m[1] });
        return json({ ok: true });
      }

      // ================= TENANTS (locataires) =================
      if (path === "/api/tenants" && method === "POST") {
        if (!canWrite(currentUser, "tenants")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.nom)) return error("Le nom du locataire est requis.");
        const id = genId();
        await env.DB.prepare(
          "INSERT INTO tenants (id, nom, prenom, telephone, email, adresse, piece_identite, numero_piece, date_naissance, contact_urgence_nom, contact_urgence_telephone) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(id, b.nom.trim(), b.prenom || null, b.telephone || null, b.email || null, b.adresse || null,
          b.piece_identite || null, b.numero_piece || null, b.date_naissance || null,
          b.contact_urgence_nom || null, b.contact_urgence_telephone || null).run();
        const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first();
        await log(env, currentUser, "creation_locataire", { id, nom: b.nom });
        return json(mapTenant(row), { status: 201 });
      }
      m = path.match(/^\/api\/tenants\/([^/]+)$/);
      if (m && method === "PUT") {
        if (!canWrite(currentUser, "tenants")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.nom)) return error("Le nom du locataire est requis.");
        const r = await env.DB.prepare(
          "UPDATE tenants SET nom=?, prenom=?, telephone=?, email=?, adresse=?, piece_identite=?, numero_piece=?, date_naissance=?, contact_urgence_nom=?, contact_urgence_telephone=? WHERE id=?"
        ).bind(b.nom.trim(), b.prenom || null, b.telephone || null, b.email || null, b.adresse || null,
          b.piece_identite || null, b.numero_piece || null, b.date_naissance || null,
          b.contact_urgence_nom || null, b.contact_urgence_telephone || null, m[1]).run();
        if (r.meta.changes === 0) return error("Locataire introuvable", 404);
        const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(m[1]).first();
        await log(env, currentUser, "modification_locataire", { id: m[1] });
        return json(mapTenant(row));
      }
      if (m && method === "DELETE") {
        if (!canWrite(currentUser, "tenants")) return error("Action non autorisée pour ce rôle.", 403);
        const dep = await env.DB.prepare("SELECT COUNT(*) AS n FROM leases WHERE tenant_id = ?").bind(m[1]).first();
        if (dep.n > 0) return error("Impossible de supprimer : ce locataire a des contrats rattachés.", 409);
        const r = await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(m[1]).run();
        if (r.meta.changes === 0) return error("Locataire introuvable", 404);
        await log(env, currentUser, "suppression_locataire", { id: m[1] });
        return json({ ok: true });
      }

      // ================= LEASES (contrats) =================
      if (path === "/api/leases" && method === "POST") {
        if (!canWrite(currentUser, "leases")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.tenant_id) || !isNonEmptyString(b.unit_id) || !isIsoDate(b.date_debut) || !isPositiveNumber(b.rent)) {
          return error("Locataire, logement, date de début et loyer (>0) requis.");
        }
        const unit = await env.DB.prepare("SELECT * FROM units WHERE id = ?").bind(b.unit_id).first();
        if (!unit) return error("Logement introuvable", 404);
        const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(b.tenant_id).first();
        if (!tenant) return error("Locataire introuvable", 404);
        const statut = b.statut && isOneOf(b.statut, LEASE_STATUTS) ? b.statut : "actif";
        if (statut === "actif") {
          const activeConflict = await env.DB.prepare(
            "SELECT id FROM leases WHERE unit_id = ? AND statut = 'actif'"
          ).bind(b.unit_id).first();
          if (activeConflict) return error("Ce logement a déjà un contrat actif.", 409);
        }
        const id = genId();
        await env.DB.prepare(
          "INSERT INTO leases (id, numero, tenant_id, unit_id, date_debut, date_fin, rent, caution, jour_paiement, conditions, statut) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(id, b.numero || null, b.tenant_id, b.unit_id, b.date_debut, b.date_fin || null, b.rent,
          b.caution || null, b.jour_paiement || null, b.conditions || null, statut).run();
        if (statut === "actif") {
          await env.DB.prepare("UPDATE units SET statut = 'occupe' WHERE id = ?").bind(b.unit_id).run();
        }
        const row = await env.DB.prepare("SELECT * FROM leases WHERE id = ?").bind(id).first();
        await log(env, currentUser, "creation_contrat", { id, unit_id: b.unit_id, tenant_id: b.tenant_id });
        return json(mapLease(row), { status: 201 });
      }
      m = path.match(/^\/api\/leases\/([^/]+)$/);
      if (m && method === "PUT") {
        if (!canWrite(currentUser, "leases")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.tenant_id) || !isNonEmptyString(b.unit_id) || !isIsoDate(b.date_debut) || !isPositiveNumber(b.rent)) {
          return error("Locataire, logement, date de début et loyer (>0) requis.");
        }
        if (b.statut && !isOneOf(b.statut, LEASE_STATUTS)) return error("Statut invalide.");
        const statut = b.statut || "actif";
        if (statut === "actif") {
          const activeConflict = await env.DB.prepare(
            "SELECT id FROM leases WHERE unit_id = ? AND statut = 'actif' AND id != ?"
          ).bind(b.unit_id, m[1]).first();
          if (activeConflict) return error("Ce logement a déjà un contrat actif.", 409);
        }
        const r = await env.DB.prepare(
          "UPDATE leases SET numero=?, tenant_id=?, unit_id=?, date_debut=?, date_fin=?, rent=?, caution=?, jour_paiement=?, conditions=?, statut=? WHERE id=?"
        ).bind(b.numero || null, b.tenant_id, b.unit_id, b.date_debut, b.date_fin || null, b.rent,
          b.caution || null, b.jour_paiement || null, b.conditions || null, statut, m[1]).run();
        if (r.meta.changes === 0) return error("Contrat introuvable", 404);
        await env.DB.prepare("UPDATE units SET statut = ? WHERE id = ?")
          .bind(statut === "actif" ? "occupe" : "disponible", b.unit_id).run();
        const row = await env.DB.prepare("SELECT * FROM leases WHERE id = ?").bind(m[1]).first();
        await log(env, currentUser, "modification_contrat", { id: m[1], statut });
        return json(mapLease(row));
      }
      if (m && method === "DELETE") {
        if (!canWrite(currentUser, "leases")) return error("Action non autorisée pour ce rôle.", 403);
        const lease = await env.DB.prepare("SELECT * FROM leases WHERE id = ?").bind(m[1]).first();
        if (!lease) return error("Contrat introuvable", 404);
        await env.DB.prepare("DELETE FROM payments WHERE lease_id = ?").bind(m[1]).run();
        await env.DB.prepare("DELETE FROM leases WHERE id = ?").bind(m[1]).run();
        if (lease.statut === "actif") {
          await env.DB.prepare("UPDATE units SET statut = 'disponible' WHERE id = ?").bind(lease.unit_id).run();
        }
        await log(env, currentUser, "suppression_contrat", { id: m[1] });
        return json({ ok: true });
      }

      // ================= PAYMENTS (paiements) =================
      if (path === "/api/payments" && method === "POST") {
        if (!canWrite(currentUser, "payments")) return error("Action non autorisée pour ce rôle.", 403);
        const b = await readJson(request);
        if (!b || !isNonEmptyString(b.lease_id) || !isPositiveNumber(b.amount) || !isIsoDate(b.date) || !isPeriod(b.period)) {
          return error("Contrat, mois concerné (AAAA-MM), montant (>0) et date (AAAA-MM-JJ) requis.");
        }
        const lease = await env.DB.prepare("SELECT id, rent FROM leases WHERE id = ?").bind(b.lease_id).first();
        if (!lease) return error("Contrat introuvable", 404);
        const already = await env.DB.prepare(
          "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE lease_id = ? AND period = ?"
        ).bind(b.lease_id, b.period).first();
        const remaining = lease.rent - already.total;
        if (b.amount > remaining + 0.5) {
          return error("Ce montant dépasse le solde dû pour ce mois (" + remaining.toFixed(2) + " restant).");
        }
        const id = genId();
        await env.DB.prepare(
          "INSERT INTO payments (id, lease_id, period, amount, date, method, reference, note, user_id) VALUES (?,?,?,?,?,?,?,?,?)"
        ).bind(id, b.lease_id, b.period, b.amount, b.date, b.method || null, b.reference || null, b.note || null, currentUser.id).run();
        const row = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(id).first();
        await log(env, currentUser, "enregistrement_paiement", { id, lease_id: b.lease_id, period: b.period, amount: b.amount });
        return json(mapPayment(row), { status: 201 });
      }
      m = path.match(/^\/api\/payments\/([^/]+)$/);
      if (m && method === "DELETE") {
        if (!canWrite(currentUser, "payments")) return error("Action non autorisée pour ce rôle.", 403);
        const r = await env.DB.prepare("DELETE FROM payments WHERE id = ?").bind(m[1]).run();
        if (r.meta.changes === 0) return error("Paiement introuvable", 404);
        await log(env, currentUser, "suppression_paiement", { id: m[1] });
        return json({ ok: true });
      }

      // ================= USERS (admin only) =================
      if (path === "/api/users" && method === "POST") {
        if (currentUser.role !== "administrateur") return error("Réservé à l'administrateur.", 403);
        const b = await readJson(request);
        if (!b || !isEmail(b.email) || !isNonEmptyString(b.password) || b.password.length < 6) {
          return error("Email valide et mot de passe (6 caractères minimum) requis.");
        }
        if (b.role && !isOneOf(b.role, ROLES)) return error("Rôle invalide.");
        const email = b.email.trim().toLowerCase();
        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
        if (existing) return error("Un utilisateur avec cet email existe déjà.", 409);
        const id = genId();
        const hash = await hashPassword(b.password);
        await env.DB.prepare(
          "INSERT INTO users (id, nom, prenom, telephone, email, username, password_hash, role, statut) VALUES (?,?,?,?,?,?,?,?,?)"
        ).bind(id, b.nom || null, b.prenom || null, b.telephone || null, email, b.username || null, hash, b.role || "gestionnaire", "actif").run();
        const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
        await log(env, currentUser, "creation_utilisateur", { id, email });
        return json(mapUser(row), { status: 201 });
      }
      m = path.match(/^\/api\/users\/([^/]+)$/);
      if (m && method === "PUT") {
        if (currentUser.role !== "administrateur") return error("Réservé à l'administrateur.", 403);
        const b = await readJson(request);
        if (!b) return error("Requête invalide.");
        if (b.role && !isOneOf(b.role, ROLES)) return error("Rôle invalide.");
        if (b.statut && !isOneOf(b.statut, ["actif", "inactif"])) return error("Statut invalide.");
        let hashClause = "";
        const params = [b.nom || null, b.prenom || null, b.telephone || null, b.username || null, b.role || "gestionnaire", b.statut || "actif"];
        if (isNonEmptyString(b.password)) {
          if (b.password.length < 6) return error("Le mot de passe doit faire au moins 6 caractères.");
          hashClause = ", password_hash = ?";
          params.push(await hashPassword(b.password));
        }
        params.push(m[1]);
        const r = await env.DB.prepare(
          "UPDATE users SET nom=?, prenom=?, telephone=?, username=?, role=?, statut=?" + hashClause + " WHERE id=?"
        ).bind(...params).run();
        if (r.meta.changes === 0) return error("Utilisateur introuvable", 404);
        const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(m[1]).first();
        await log(env, currentUser, "modification_utilisateur", { id: m[1] });
        return json(mapUser(row));
      }
      if (m && method === "DELETE") {
        if (currentUser.role !== "administrateur") return error("Réservé à l'administrateur.", 403);
        const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
        if (count.n <= 1) return error("Impossible de supprimer le dernier utilisateur.", 400);
        await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(m[1]).run();
        const r = await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(m[1]).run();
        if (r.meta.changes === 0) return error("Utilisateur introuvable", 404);
        await log(env, currentUser, "suppression_utilisateur", { id: m[1] });
        return json({ ok: true });
      }

      return error("Not found", 404);
    } catch (e) {
      return error("Erreur serveur : " + e.message, 500);
    }
  },
};

function mapUser(row) {
  return { id: row.id, nom: row.nom, prenom: row.prenom, telephone: row.telephone, email: row.email,
    username: row.username, role: row.role, statut: row.statut, created_at: row.created_at };
}
function mapOwner(row) {
  return { id: row.id, nom: row.nom, telephone: row.telephone, adresse: row.adresse, email: row.email,
    note: row.note, statut: row.statut, created_at: row.created_at };
}
function mapProperty(row) {
  return { id: row.id, reference: row.reference, nom: row.nom, owner_id: row.owner_id, adresse: row.adresse,
    ville: row.ville, description: row.description, statut: row.statut, created_at: row.created_at };
}
function mapUnit(row) {
  return { id: row.id, reference: row.reference, property_id: row.property_id, numero: row.numero, type: row.type,
    description: row.description, rent: row.rent, caution: row.caution, statut: row.statut, created_at: row.created_at };
}
function mapTenant(row) {
  return { id: row.id, nom: row.nom, prenom: row.prenom, telephone: row.telephone, email: row.email, adresse: row.adresse,
    piece_identite: row.piece_identite, numero_piece: row.numero_piece, date_naissance: row.date_naissance,
    contact_urgence_nom: row.contact_urgence_nom, contact_urgence_telephone: row.contact_urgence_telephone,
    created_at: row.created_at };
}
function mapLease(row) {
  return { id: row.id, numero: row.numero, tenant_id: row.tenant_id, unit_id: row.unit_id, date_debut: row.date_debut,
    date_fin: row.date_fin, rent: row.rent, caution: row.caution, jour_paiement: row.jour_paiement,
    conditions: row.conditions, statut: row.statut, created_at: row.created_at };
}
function mapPayment(row) {
  return { id: row.id, lease_id: row.lease_id, period: row.period, amount: row.amount, date: row.date,
    method: row.method, reference: row.reference, note: row.note, user_id: row.user_id, created_at: row.created_at };
}
function mapActivity(row) {
  var details = {};
  try { details = JSON.parse(row.details); } catch (e) {}
  return { id: row.id, user_email: row.user_email, action: row.action, details: details, created_at: row.created_at };
}
