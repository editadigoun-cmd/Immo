const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key,Authorization",
};

const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;

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

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isPositiveNumber(v) {
  return typeof v === "number" && isFinite(v) && v > 0;
}
function isIsoDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isPeriod(v) {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}
function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

function checkApiKey(request, env) {
  if (!env.API_KEY) return true;
  return request.headers.get("X-Api-Key") === env.API_KEY;
}

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

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
  const saltB64 = parts[2];
  const expected = await hashPassword(password, saltB64);
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

async function getSessionUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];
  const row = await env.DB.prepare(
    "SELECT user_email, expires_at FROM sessions WHERE token = ?"
  )
    .bind(token)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_email;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (!path.startsWith("/api")) {
      return error("Not found", 404);
    }

    if (!checkApiKey(request, env)) {
      return error("Clé API invalide", 401);
    }

    try {
      // ---- Auth (public) ----
      if (path === "/api/auth/login" && method === "POST") {
        const body = await readJson(request);
        if (!body || !isEmail(body.email) || !isNonEmptyString(body.password)) {
          return error("Email et mot de passe requis.");
        }
        const email = body.email.trim().toLowerCase();
        const user = await env.DB.prepare("SELECT email, password_hash FROM users WHERE email = ?")
          .bind(email)
          .first();
        if (!user || !(await verifyPassword(body.password, user.password_hash))) {
          return error("Email ou mot de passe incorrect.", 401);
        }
        const token = generateToken();
        const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare("INSERT INTO sessions (token, user_email, expires_at) VALUES (?, ?, ?)")
          .bind(token, email, expiresAt)
          .run();
        return json({ token, email }, { status: 201 });
      }

      // ---- Everything below requires a valid session ----
      const currentUser = await getSessionUser(request, env);
      if (!currentUser) return error("Authentification requise.", 401);

      if (path === "/api/auth/logout" && method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        const token = (auth.match(/^Bearer\s+(.+)$/i) || [])[1];
        if (token) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
        return json({ ok: true });
      }

      if (path === "/api/auth/me" && method === "GET") {
        return json({ email: currentUser });
      }

      // ---- Users management ----
      if (path === "/api/users" && method === "GET") {
        const users = await env.DB.prepare("SELECT email, created_at FROM users ORDER BY created_at").all();
        return json({ users: users.results });
      }

      if (path === "/api/users" && method === "POST") {
        const body = await readJson(request);
        if (!body || !isEmail(body.email) || !isNonEmptyString(body.password) || body.password.length < 6) {
          return error("Email valide et mot de passe (6 caractères minimum) requis.");
        }
        const email = body.email.trim().toLowerCase();
        const existing = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
        if (existing) return error("Un utilisateur avec cet email existe déjà.", 409);
        const hash = await hashPassword(body.password);
        await env.DB.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").bind(email, hash).run();
        return json({ email }, { status: 201 });
      }

      const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userMatch && method === "DELETE") {
        const email = decodeURIComponent(userMatch[1]).toLowerCase();
        const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
        if (count.n <= 1) return error("Impossible de supprimer le dernier utilisateur.", 400);
        await env.DB.prepare("DELETE FROM sessions WHERE user_email = ?").bind(email).run();
        const result = await env.DB.prepare("DELETE FROM users WHERE email = ?").bind(email).run();
        if (result.meta.changes === 0) return error("Utilisateur introuvable", 404);
        return json({ ok: true });
      }

      // ---- Data ----
      if (path === "/api/data" && method === "GET") {
        const tenants = await env.DB.prepare("SELECT * FROM tenants ORDER BY name").all();
        const payments = await env.DB.prepare("SELECT * FROM payments ORDER BY period DESC, date DESC").all();
        return json({
          tenants: tenants.results.map(mapTenant),
          payments: payments.results.map(mapPayment),
        });
      }

      // POST /api/tenants
      if (path === "/api/tenants" && method === "POST") {
        const body = await readJson(request);
        if (!body || !isNonEmptyString(body.name) || !isPositiveNumber(body.rent) || !isIsoDate(body.start)) {
          return error("Champs invalides : nom, loyer (>0) et date de début (AAAA-MM-JJ) sont requis.");
        }
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO tenants (id, name, property, rent, start_date, note) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(id, body.name.trim(), body.property || null, body.rent, body.start, body.note || null)
          .run();
        const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first();
        return json(mapTenant(row), { status: 201 });
      }

      // PUT /api/tenants/:id
      const tenantMatch = path.match(/^\/api\/tenants\/([^/]+)$/);
      if (tenantMatch && method === "PUT") {
        const id = tenantMatch[1];
        const body = await readJson(request);
        if (!body || !isNonEmptyString(body.name) || !isPositiveNumber(body.rent) || !isIsoDate(body.start)) {
          return error("Champs invalides : nom, loyer (>0) et date de début (AAAA-MM-JJ) sont requis.");
        }
        const result = await env.DB.prepare(
          "UPDATE tenants SET name = ?, property = ?, rent = ?, start_date = ?, note = ? WHERE id = ?"
        )
          .bind(body.name.trim(), body.property || null, body.rent, body.start, body.note || null, id)
          .run();
        if (result.meta.changes === 0) return error("Locataire introuvable", 404);
        const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first();
        return json(mapTenant(row));
      }

      // DELETE /api/tenants/:id (also removes their payments)
      if (tenantMatch && method === "DELETE") {
        const id = tenantMatch[1];
        await env.DB.prepare("DELETE FROM payments WHERE tenant_id = ?").bind(id).run();
        const result = await env.DB.prepare("DELETE FROM tenants WHERE id = ?").bind(id).run();
        if (result.meta.changes === 0) return error("Locataire introuvable", 404);
        return json({ ok: true });
      }

      // POST /api/payments - now targets a specific month ("period")
      if (path === "/api/payments" && method === "POST") {
        const body = await readJson(request);
        if (
          !body ||
          !isNonEmptyString(body.tenantId) ||
          !isPositiveNumber(body.amount) ||
          !isIsoDate(body.date) ||
          !isPeriod(body.period)
        ) {
          return error("Champs invalides : locataire, mois concerné (AAAA-MM), montant (>0) et date (AAAA-MM-JJ) sont requis.");
        }
        const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(body.tenantId).first();
        if (!tenant) return error("Locataire introuvable", 404);
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO payments (id, tenant_id, period, date, amount, method, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(id, body.tenantId, body.period, body.date, body.amount, body.method || null, body.note || null)
          .run();
        const row = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(id).first();
        return json(mapPayment(row), { status: 201 });
      }

      // DELETE /api/payments/:id
      const paymentMatch = path.match(/^\/api\/payments\/([^/]+)$/);
      if (paymentMatch && method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM payments WHERE id = ?").bind(paymentMatch[1]).run();
        if (result.meta.changes === 0) return error("Paiement introuvable", 404);
        return json({ ok: true });
      }

      return error("Not found", 404);
    } catch (e) {
      return error("Erreur serveur : " + e.message, 500);
    }
  },
};

function mapTenant(row) {
  return {
    id: row.id,
    name: row.name,
    property: row.property,
    rent: row.rent,
    start: row.start_date,
    note: row.note,
  };
}
function mapPayment(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    period: row.period,
    date: row.date,
    amount: row.amount,
    method: row.method,
    note: row.note,
  };
}
