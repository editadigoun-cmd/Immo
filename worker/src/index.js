const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
};

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
      // GET /api/data - everything the app needs in one call
      if (path === "/api/data" && method === "GET") {
        const tenants = await env.DB.prepare("SELECT * FROM tenants ORDER BY name").all();
        const payments = await env.DB.prepare("SELECT * FROM payments ORDER BY date DESC").all();
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

      // POST /api/payments
      if (path === "/api/payments" && method === "POST") {
        const body = await readJson(request);
        if (!body || !isNonEmptyString(body.tenantId) || !isPositiveNumber(body.amount) || !isIsoDate(body.date)) {
          return error("Champs invalides : locataire, montant (>0) et date (AAAA-MM-JJ) sont requis.");
        }
        const tenant = await env.DB.prepare("SELECT id FROM tenants WHERE id = ?").bind(body.tenantId).first();
        if (!tenant) return error("Locataire introuvable", 404);
        const id = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO payments (id, tenant_id, date, amount, method, note) VALUES (?, ?, ?, ?, ?, ?)"
        )
          .bind(id, body.tenantId, body.date, body.amount, body.method || null, body.note || null)
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
    date: row.date,
    amount: row.amount,
    method: row.method,
    note: row.note,
  };
}
