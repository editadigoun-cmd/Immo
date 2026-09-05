(function () {
  "use strict";

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
  var ICONS = {
    home: SVG_OPEN + '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9.5a1 1 0 0 0 1 1h3.5v-6h3v6H17a1 1 0 0 0 1-1V10"/></svg>',
    user: SVG_OPEN + '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.8 4-6 7.5-6s6.7 2.2 7.5 6"/></svg>',
    users: SVG_OPEN + '<circle cx="9" cy="8" r="3"/><path d="M2.5 19.5c.6-3.2 3.2-5 6.5-5s5.9 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.8 14.7c2.3.4 4 2 4.5 4.8"/></svg>',
    building: SVG_OPEN + '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 8h1.2M13.8 8H15M9 12h1.2M13.8 12H15M9 16h1.2M13.8 16H15"/></svg>',
    file: SVG_OPEN + '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M9.5 13h5M9.5 17h5"/></svg>',
    cash: SVG_OPEN + '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
    alert: SVG_OPEN + '<path d="M12 3.5 21 19H3z"/><path d="M12 9.5v4.2"/><path d="M12 17v.01"/></svg>',
    calendar: SVG_OPEN + '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
    chart: SVG_OPEN + '<path d="M4 20V11M12 20V4M20 20v-6.5"/></svg>',
    report: SVG_OPEN + '<rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11.5h6M9 15.5h6"/></svg>',
    menu: SVG_OPEN + '<path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    history: SVG_OPEN + '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/><path d="M4 5v4h4"/><path d="M4.3 9a8.5 8.5 0 1 1-.5 4.5"/></svg>',
  };

  var LS_AUTH = "immo_auth";
  function loadAuth() { try { var r = localStorage.getItem(LS_AUTH); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function saveAuth(a) { if (a) localStorage.setItem(LS_AUTH, JSON.stringify(a)); else localStorage.removeItem(LS_AUTH); }

  var auth = loadAuth();
  var owners = [], properties = [], units = [], tenants = [], leases = [], payments = [], users = [], activity = [];
  var loaded = false;

  // ---------------- Formatting helpers ----------------
  function fmtMoney(n) { return Math.round(n || 0).toLocaleString("fr-FR") + " FCFA"; }
  function fmtDate(iso) { if (!iso) return ""; return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR"); }
  function fmtDateTime(iso) { if (!iso) return ""; return new Date(iso.replace(" ", "T") + "Z").toLocaleString("fr-FR"); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function currentPeriod() { return todayISO().slice(0, 7); }
  function fmtPeriod(p) { return new Date(p + "-01T00:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fullName(p) { return p ? (p.prenom ? p.prenom + " " + p.nom : p.nom) : ""; }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

  function addMonths(period, n) {
    var y = parseInt(period.slice(0, 4), 10), m = parseInt(period.slice(5, 7), 10);
    m += n;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + "-" + String(m).padStart(2, "0");
  }
  function periodRangeAsc(start, through) {
    var out = [], p = start;
    var guard = 0;
    while (p <= through && guard < 1200) { out.push(p); p = addMonths(p, 1); guard++; }
    return out;
  }

  // ---------------- API ----------------
  async function api(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    if (auth && auth.token) headers["Authorization"] = "Bearer " + auth.token;
    var res;
    try {
      res = await fetch(path, { method: options.method || "GET", headers: headers, body: options.body ? JSON.stringify(options.body) : undefined, cache: "no-store" });
    } catch (e) {
      throw new Error("Impossible de contacter le serveur. Vérifie ta connexion internet.");
    }
    if (res.status === 401 && path !== "/api/auth/login") { forceLogout(); throw new Error("Session expirée, merci de te reconnecter."); }
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("Erreur serveur (" + res.status + ")"));
    return data;
  }
  function showBanner(msg) { document.getElementById("bannerText").textContent = msg; document.getElementById("banner").hidden = false; }
  function hideBanner() { document.getElementById("banner").hidden = true; }

  // ---------------- Auth ----------------
  function isAdmin() { return auth && auth.user && auth.user.role === "administrateur"; }
  function canWrite(resource) {
    if (!auth || !auth.user) return false;
    if (auth.user.role === "administrateur") return true;
    if (auth.user.role === "gestionnaire") return ["tenants", "leases", "payments"].indexOf(resource) !== -1;
    return false;
  }
  function roleLabel(r) { return { administrateur: "Administrateur", gestionnaire: "Gestionnaire", comptable: "Comptable" }[r] || r; }

  function showLogin() { document.getElementById("loginView").hidden = false; document.getElementById("appView").hidden = true; document.getElementById("bottomNav").hidden = true; }
  function showApp() {
    document.getElementById("loginView").hidden = true;
    document.getElementById("appView").hidden = false;
    document.getElementById("bottomNav").hidden = false;
    document.getElementById("topbarEmail").textContent = auth.user.email;
    document.getElementById("topbarRole").textContent = roleLabel(auth.user.role);
    document.getElementById("navUsersLink").style.display = isAdmin() ? "" : "none";
    document.getElementById("navUsersLinkMobile").style.display = isAdmin() ? "" : "none";
  }
  function forceLogout() { auth = null; saveAuth(null); showLogin(); }

  document.getElementById("loginSubmit").addEventListener("click", async function () {
    var email = document.getElementById("loginEmail").value.trim();
    var password = document.getElementById("loginPassword").value;
    var errEl = document.getElementById("loginError");
    errEl.hidden = true;
    if (!email || !password) { errEl.textContent = "Merci de renseigner email et mot de passe."; errEl.hidden = false; return; }
    var btn = document.getElementById("loginSubmit");
    btn.disabled = true;
    try {
      var res = await api("/api/auth/login", { method: "POST", body: { email: email, password: password } });
      auth = { token: res.token, user: res.user };
      saveAuth(auth);
      showApp();
      loadData();
    } catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
    finally { btn.disabled = false; }
  });
  document.getElementById("loginPassword").addEventListener("keydown", function (e) { if (e.key === "Enter") document.getElementById("loginSubmit").click(); });
  async function doLogout() {
    try { await api("/api/auth/logout", { method: "POST" }); } catch (e) {}
    forceLogout();
  }
  document.getElementById("btnLogout").addEventListener("click", doLogout);
  document.getElementById("btnLogoutMobile").addEventListener("click", doLogout);
  document.getElementById("btnHome").addEventListener("click", function () { location.hash = "#/"; });
  document.getElementById("btnHomeMobile").addEventListener("click", function () { location.hash = "#/"; });

  // ---------------- Data load ----------------
  async function loadData() {
    try {
      var data = await api("/api/data");
      owners = data.owners || []; properties = data.properties || []; units = data.units || [];
      tenants = data.tenants || []; leases = data.leases || []; payments = data.payments || [];
      activity = data.activity || []; users = data.users || [];
      loaded = true;
      hideBanner();
      route();
    } catch (e) { showBanner(e.message); }
  }
  document.getElementById("btnBannerRetry").addEventListener("click", loadData);

  // ---------------- Lookups ----------------
  function ownerById(id) { return owners.find(function (o) { return o.id === id; }); }
  function propertyById(id) { return properties.find(function (p) { return p.id === id; }); }
  function unitById(id) { return units.find(function (u) { return u.id === id; }); }
  function tenantById(id) { return tenants.find(function (t) { return t.id === id; }); }
  function leaseById(id) { return leases.find(function (l) { return l.id === id; }); }
  function propertiesForOwner(id) { return properties.filter(function (p) { return p.owner_id === id; }); }
  function unitsForProperty(id) { return units.filter(function (u) { return u.property_id === id; }); }
  function leasesForUnit(id) { return leases.filter(function (l) { return l.unit_id === id; }); }
  function leasesForTenant(id) { return leases.filter(function (l) { return l.tenant_id === id; }); }
  function activeLeaseForUnit(id) { return leases.find(function (l) { return l.unit_id === id && l.statut === "actif"; }); }
  function paymentsForLease(id) { return payments.filter(function (p) { return p.lease_id === id; }); }

  // ---------------- Lease financial logic ----------------
  function leaseThroughPeriod(lease) {
    if (lease.statut !== "actif" && lease.date_fin) return lease.date_fin.slice(0, 7);
    return currentPeriod();
  }
  function leasePaidForPeriod(leaseId, period) {
    return paymentsForLease(leaseId).filter(function (p) { return p.period === period; }).reduce(function (s, p) { return s + p.amount; }, 0);
  }
  function leaseTotalPaid(leaseId) { return paymentsForLease(leaseId).reduce(function (s, p) { return s + p.amount; }, 0); }
  function leasePeriods(lease) {
    var start = lease.date_debut.slice(0, 7);
    var through = leaseThroughPeriod(lease);
    var latestPaid = paymentsForLease(lease.id).reduce(function (m, p) { return p.period > m ? p.period : m; }, "");
    if (latestPaid && latestPaid > through) through = latestPaid;
    return periodRangeAsc(start, through);
  }
  function leaseTotals(lease) {
    var periods = leasePeriods(lease);
    var due = periods.length * lease.rent;
    var paid = leaseTotalPaid(lease.id);
    var balance = due - paid;
    var status = balance > 0.5 ? "late" : (balance < -0.5 ? "credit" : "ok");
    return { periods: periods, due: due, paid: paid, balance: balance, status: status };
  }
  function badge(status) {
    if (status === "late") return '<span class="badge danger">En retard</span>';
    if (status === "credit") return '<span class="badge warn">Avance</span>';
    return '<span class="badge ok">À jour</span>';
  }
  function monthBadge(paid, due) {
    if (paid <= 0.5) return '<span class="badge danger">Impayé</span>';
    if (paid + 0.5 < due) return '<span class="badge warn">Partiel</span>';
    if (paid > due + 0.5) return '<span class="badge ok">Payé (+' + fmtMoney(paid - due) + ')</span>';
    return '<span class="badge ok">Payé</span>';
  }
  function unitStatutBadge(s) {
    if (s === "occupe") return '<span class="badge info">Occupé</span>';
    if (s === "maintenance") return '<span class="badge warn">Maintenance</span>';
    if (s === "reserve") return '<span class="badge neutral">Réservé</span>';
    return '<span class="badge ok">Disponible</span>';
  }
  function leaseStatutBadge(s) {
    if (s === "actif") return '<span class="badge ok">Actif</span>';
    if (s === "termine") return '<span class="badge neutral">Terminé</span>';
    if (s === "resilie") return '<span class="badge danger">Résilié</span>';
    return '<span class="badge warn">En attente</span>';
  }
  function ownerStatutBadge(s) { return s === "inactif" ? '<span class="badge neutral">Inactif</span>' : '<span class="badge ok">Actif</span>'; }

  // ============ ROUTER ============
  var CONTENT = null;
  function setBottomNavActive(section) {
    document.querySelectorAll(".bottom-nav .bn-item").forEach(function (el) { el.classList.toggle("active", el.getAttribute("data-section") === section); });
  }
  function setTopNavActive(hashPrefix) {
    document.querySelectorAll(".sidebar-nav a").forEach(function (a) {
      var h = a.getAttribute("href");
      a.classList.toggle("active", h === hashPrefix || (hashPrefix !== "#/" && h !== "#/" && (hashPrefix || "").indexOf(h) === 0));
    });
  }

  function route() {
    if (!loaded) return;
    CONTENT = document.getElementById("pageContent");
    var hash = location.hash || "#/";
    var m;

    if (hash === "#/plus") { document.getElementById("moreModal").hidden = false; history.back(); return; }

    if ((m = hash.match(/^#\/proprietaires\/([^/]+)$/))) { renderOwnerDetail(m[1]); setBottomNavActive("plus"); setTopNavActive("#/proprietaires"); }
    else if (hash === "#/proprietaires") { renderOwnersList(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if ((m = hash.match(/^#\/maisons\/([^/]+)$/))) { renderPropertyDetail(m[1]); setBottomNavActive("maisons"); setTopNavActive("#/maisons"); }
    else if (hash === "#/maisons") { renderPropertiesList(); setBottomNavActive("maisons"); setTopNavActive(hash); }
    else if ((m = hash.match(/^#\/locataires\/([^/]+)$/))) { renderTenantDetail(m[1]); setBottomNavActive("locataires"); setTopNavActive("#/locataires"); }
    else if (hash === "#/locataires") { renderTenantsList(); setBottomNavActive("locataires"); setTopNavActive(hash); }
    else if ((m = hash.match(/^#\/contrats\/([^/]+)$/))) { renderLeaseDetail(m[1]); setBottomNavActive("contrats"); setTopNavActive("#/contrats"); }
    else if (hash === "#/contrats") { renderLeasesList(); setBottomNavActive("contrats"); setTopNavActive(hash); }
    else if (hash === "#/paiements") { renderPaymentsPage(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if (hash === "#/impayes") { renderImpayesPage(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if (hash === "#/echeances") { renderEcheancesPage(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if (hash === "#/finances") { renderFinancesPage(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if (hash === "#/rapports") { renderRapportsPage(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if (hash === "#/historique") { renderHistoriquePage(); setBottomNavActive("plus"); setTopNavActive(hash); }
    else if (hash === "#/utilisateurs") {
      if (!isAdmin()) { location.hash = "#/"; return; }
      renderUsersPage(); setBottomNavActive("plus"); setTopNavActive(hash);
    } else { renderHome(); setBottomNavActive("home"); setTopNavActive("#/"); }
  }
  window.addEventListener("hashchange", route);
  document.getElementById("moreClose").addEventListener("click", function () { document.getElementById("moreModal").hidden = true; });
  document.getElementById("moreModal").addEventListener("click", function (e) { if (e.target.id === "moreModal") e.currentTarget.hidden = true; });
  document.querySelectorAll("#moreModal a").forEach(function (a) { a.addEventListener("click", function () { document.getElementById("moreModal").hidden = true; }); });

  // ============ HOME / DASHBOARD ============
  function renderHome() {
    var occupes = units.filter(function (u) { return u.statut === "occupe"; }).length;
    var disponibles = units.filter(function (u) { return u.statut === "disponible"; }).length;
    var maintenance = units.filter(function (u) { return u.statut === "maintenance"; }).length;
    var actifs = leases.filter(function (l) { return l.statut === "actif"; });
    var encaisseCeMois = payments.filter(function (p) { return p.period === currentPeriod(); }).reduce(function (s, p) { return s + p.amount; }, 0);
    var impayeCount = 0, impayeMontant = 0;
    actifs.forEach(function (l) { var t = leaseTotals(l); if (t.balance > 0.5) { impayeCount++; impayeMontant += t.balance; } });
    var soon = actifs.filter(function (l) { return l.date_fin && daysBetween(todayISO(), l.date_fin) >= 0 && daysBetween(todayISO(), l.date_fin) <= 30; });

    var alerts = [];
    if (impayeCount) alerts.push({ cls: "danger", text: impayeCount + " contrat(s) avec un loyer impayé, pour " + fmtMoney(impayeMontant) + "." });
    if (soon.length) alerts.push({ cls: "warn", text: soon.length + " contrat(s) arrivent à échéance dans les 30 jours." });
    if (disponibles) alerts.push({ cls: "info", text: disponibles + " logement(s) disponible(s)." });
    alerts.push({ cls: "info", text: fmtMoney(encaisseCeMois) + " encaissés ce mois-ci." });

    CONTENT.innerHTML =
      '<p class="subtitle">Vue d\'ensemble de la situation locative</p>' +
      '<div class="alert-list">' + alerts.map(function (a) { return '<div class="alert-item ' + a.cls + '">' + a.text + '</div>'; }).join("") + '</div>' +
      '<div class="stats">' +
        stat("Propriétaires", owners.length) +
        stat("Maisons", properties.length) +
        stat("Logements", units.length) +
        stat("Occupés", occupes, "ok") +
        stat("Disponibles", disponibles) +
        stat("Maintenance", maintenance, maintenance ? "warn" : "") +
        stat("Locataires", tenants.length) +
        stat("Contrats actifs", actifs.length) +
        stat("Encaissé ce mois", fmtMoney(encaisseCeMois), "ok") +
        stat("Impayés (contrats actifs)", fmtMoney(impayeMontant), impayeMontant > 0.5 ? "danger" : "ok") +
      '</div>' +
      '<div class="nav-cards">' +
        navCard("#/proprietaires", "user", "Propriétaires", "Gérer les propriétaires") +
        navCard("#/maisons", "building", "Biens", "Maisons et logements") +
        navCard("#/locataires", "users", "Locataires", "Fiches locataires") +
        navCard("#/contrats", "file", "Contrats", "Locations en cours") +
        navCard("#/paiements", "cash", "Paiements", "Enregistrer, historique") +
        navCard("#/impayes", "alert", "Impayés", "Loyers non réglés") +
        navCard("#/echeances", "calendar", "Échéances", "Prochains loyers à payer") +
        navCard("#/finances", "chart", "Finances", "Revenus, situation propriétaires") +
        navCard("#/rapports", "report", "Rapports", "Exports CSV") +
        navCard("#/historique", "history", "Historique", "Journal des opérations") +
      '</div>';
  }
  function stat(label, value, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
  }
  function navCard(href, iconName, title, desc) {
    return '<a href="' + href + '" class="nav-card"><span class="nav-card-icon">' + ICONS[iconName] + '</span><span class="nav-card-title">' + title + '</span><span class="nav-card-desc">' + desc + '</span></a>';
  }

  // ============ PROPRIÉTAIRES ============
  function renderOwnersList() {
    var q = "";
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Propriétaires</h2><p class="subtitle" style="margin:0;">' + owners.length + ' propriétaire(s)</p></div>' +
      (canWrite("owners") ? '<button class="primary" id="btnNewOwner">+ Nouveau propriétaire</button>' : '') + '</div>' +
      '<div class="toolbar"><input type="text" id="ownerSearch" placeholder="Rechercher un propriétaire..."></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Nom</th><th>Téléphone</th><th>Maisons</th><th>Logements</th><th>Occupés</th><th>Statut</th></tr></thead><tbody id="ownersBody"></tbody></table></div>' +
      '<div class="empty" id="ownersEmpty" hidden>Aucun propriétaire. Cliquez sur « + Nouveau propriétaire ».</div></div>';

    function draw() {
      var list = owners.filter(function (o) { return !q || o.nom.toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
      document.getElementById("ownersBody").innerHTML = list.map(function (o) {
        var props = propertiesForOwner(o.id);
        var us = [].concat.apply([], props.map(function (p) { return unitsForProperty(p.id); }));
        var occ = us.filter(function (u) { return u.statut === "occupe"; }).length;
        return '<tr class="clickable" data-go="#/proprietaires/' + o.id + '"><td>' + escapeHtml(o.nom) + '</td><td>' + escapeHtml(o.telephone || "—") + '</td><td>' + props.length + '</td><td>' + us.length + '</td><td>' + occ + '</td><td>' + ownerStatutBadge(o.statut) + '</td></tr>';
      }).join("");
      document.getElementById("ownersEmpty").hidden = owners.length > 0;
      bindRowNav();
    }
    draw();
    document.getElementById("ownerSearch").addEventListener("input", function (e) { q = e.target.value.trim().toLowerCase(); draw(); });
    var btn = document.getElementById("btnNewOwner");
    if (btn) btn.addEventListener("click", function () { openOwnerModal(null); });
  }
  function bindRowNav() {
    CONTENT.querySelectorAll("[data-go]").forEach(function (el) { el.addEventListener("click", function () { location.hash = el.getAttribute("data-go"); }); });
  }

  function renderOwnerDetail(id) {
    var o = ownerById(id);
    if (!o) { location.hash = "#/proprietaires"; return; }
    var props = propertiesForOwner(id);
    var us = [].concat.apply([], props.map(function (p) { return unitsForProperty(p.id); }));
    var occ = us.filter(function (u) { return u.statut === "occupe"; }).length;
    var disp = us.filter(function (u) { return u.statut === "disponible"; }).length;
    var leasesForOwner = [].concat.apply([], us.map(function (u) { return leasesForUnit(u.id); }));
    var attendu = 0, encaisse = 0;
    leasesForOwner.filter(function (l) { return l.statut === "actif"; }).forEach(function (l) { var t = leaseTotals(l); attendu += t.due; encaisse += t.paid; });

    CONTENT.innerHTML =
      '<a href="#/proprietaires" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>' + escapeHtml(o.nom) + '</h2><p class="subtitle" style="margin:0;">' + (o.telephone || "") + '</p></div>' +
      (canWrite("owners") ? '<div class="row-actions"><button id="ownerEditBtn">Modifier</button><button class="danger ghost" id="ownerDeleteBtn">Supprimer</button></div>' : '') + '</div>' +
      '<div class="card card-pad"><div class="info-grid">' +
        infoItem("Téléphone", o.telephone) + infoItem("Adresse", o.adresse) + infoItem("Email", o.email) + infoItem("Note", o.note) +
      '</div></div>' +
      '<div class="stats">' + stat("Maisons", props.length) + stat("Logements", us.length) + stat("Occupés", occ, "ok") + stat("Disponibles", disp) +
        stat("Loyers attendus", fmtMoney(attendu)) + stat("Encaissés", fmtMoney(encaisse), "ok") + stat("Impayés", fmtMoney(Math.max(0, attendu - encaisse)), (attendu - encaisse) > 0.5 ? "danger" : "ok") +
      '</div>' +
      '<div class="card"><div class="card-pad" style="padding-bottom:0;"><p class="section-title">Maisons</p></div><div class="table-scroll"><table><thead><tr><th>Nom</th><th>Ville</th><th>Logements</th><th>Statut</th></tr></thead><tbody>' +
        (props.length ? props.map(function (p) {
          return '<tr class="clickable" data-go="#/maisons/' + p.id + '"><td>' + escapeHtml(p.nom) + '</td><td>' + escapeHtml(p.ville || "—") + '</td><td>' + unitsForProperty(p.id).length + '</td><td>' + (p.statut === "inactif" ? '<span class="badge neutral">Inactif</span>' : '<span class="badge ok">Actif</span>') + '</td></tr>';
        }).join("") : '<tr><td colspan="4" class="empty">Aucune maison.</td></tr>') +
      '</tbody></table></div></div>';
    bindRowNav();
    var editBtn = document.getElementById("ownerEditBtn");
    if (editBtn) editBtn.addEventListener("click", function () { openOwnerModal(o.id); });
    var delBtn = document.getElementById("ownerDeleteBtn");
    if (delBtn) delBtn.addEventListener("click", async function () {
      if (!confirm('Supprimer "' + o.nom + '" ?')) return;
      try { await api("/api/owners/" + o.id, { method: "DELETE" }); owners = owners.filter(function (x) { return x.id !== o.id; }); location.hash = "#/proprietaires"; }
      catch (e) { showBanner(e.message); }
    });
  }
  function infoItem(label, value) { return '<div class="item"><div class="label">' + label + '</div><div class="value">' + (value ? escapeHtml(value) : "—") + '</div></div>'; }
  function infoItemRaw(label, html) { return '<div class="item"><div class="label">' + label + '</div><div class="value">' + html + '</div></div>'; }

  var ownerModal = document.getElementById("ownerModal");
  function openOwnerModal(id) {
    var o = id ? ownerById(id) : null;
    document.getElementById("ownerModalTitle").textContent = o ? "Modifier le propriétaire" : "Nouveau propriétaire";
    document.getElementById("ownerId").value = o ? o.id : "";
    document.getElementById("ownerNom").value = o ? o.nom : "";
    document.getElementById("ownerTelephone").value = o ? (o.telephone || "") : "";
    document.getElementById("ownerAdresse").value = o ? (o.adresse || "") : "";
    document.getElementById("ownerEmail").value = o ? (o.email || "") : "";
    document.getElementById("ownerNote").value = o ? (o.note || "") : "";
    document.getElementById("ownerStatut").value = o ? o.statut : "actif";
    ownerModal.hidden = false;
    document.getElementById("ownerNom").focus();
  }
  document.getElementById("ownerCancel").addEventListener("click", function () { ownerModal.hidden = true; });
  ownerModal.addEventListener("click", function (e) { if (e.target === ownerModal) ownerModal.hidden = true; });
  document.getElementById("ownerSave").addEventListener("click", async function () {
    var id = document.getElementById("ownerId").value;
    var nom = document.getElementById("ownerNom").value.trim();
    if (!nom) { alert("Le nom est obligatoire."); return; }
    var body = { nom: nom, telephone: document.getElementById("ownerTelephone").value.trim(), adresse: document.getElementById("ownerAdresse").value.trim(),
      email: document.getElementById("ownerEmail").value.trim(), note: document.getElementById("ownerNote").value.trim(), statut: document.getElementById("ownerStatut").value };
    var btn = document.getElementById("ownerSave"); btn.disabled = true;
    try {
      if (id) { var updated = await api("/api/owners/" + id, { method: "PUT", body: body }); var i = owners.findIndex(function (x) { return x.id === id; }); owners[i] = updated; }
      else { owners.push(await api("/api/owners", { method: "POST", body: body })); }
      ownerModal.hidden = true; route();
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
  });

  // ============ MAISONS (properties) ============
  function renderPropertiesList() {
    var q = "";
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Biens — Maisons</h2><p class="subtitle" style="margin:0;">' + properties.length + ' maison(s)</p></div>' +
      (canWrite("properties") ? '<button class="primary" id="btnNewProperty">+ Nouvelle maison</button>' : '') + '</div>' +
      '<div class="toolbar"><input type="text" id="propSearch" placeholder="Rechercher une maison..."></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Nom</th><th>Propriétaire</th><th>Ville</th><th>Logements</th><th>Occupés</th><th>Statut</th></tr></thead><tbody id="propsBody"></tbody></table></div>' +
      '<div class="empty" id="propsEmpty" hidden>Aucune maison. Cliquez sur « + Nouvelle maison ».</div></div>';

    function draw() {
      var list = properties.filter(function (p) { return !q || p.nom.toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
      document.getElementById("propsBody").innerHTML = list.map(function (p) {
        var us = unitsForProperty(p.id);
        var occ = us.filter(function (u) { return u.statut === "occupe"; }).length;
        var own = ownerById(p.owner_id);
        return '<tr class="clickable" data-go="#/maisons/' + p.id + '"><td>' + escapeHtml(p.nom) + '</td><td>' + (own ? escapeHtml(own.nom) : "—") + '</td><td>' + escapeHtml(p.ville || "—") + '</td><td>' + us.length + '</td><td>' + occ + '</td><td>' + (p.statut === "inactif" ? '<span class="badge neutral">Inactif</span>' : '<span class="badge ok">Actif</span>') + '</td></tr>';
      }).join("");
      document.getElementById("propsEmpty").hidden = properties.length > 0;
      bindRowNav();
    }
    draw();
    document.getElementById("propSearch").addEventListener("input", function (e) { q = e.target.value.trim().toLowerCase(); draw(); });
    var btn = document.getElementById("btnNewProperty");
    if (btn) btn.addEventListener("click", function () { openPropertyModal(null); });
  }

  function renderPropertyDetail(id) {
    var p = propertyById(id);
    if (!p) { location.hash = "#/maisons"; return; }
    var own = ownerById(p.owner_id);
    var us = unitsForProperty(id);
    var filter = "all";

    CONTENT.innerHTML =
      '<a href="#/maisons" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>' + escapeHtml(p.nom) + '</h2><p class="subtitle" style="margin:0;">' + (own ? 'Propriétaire : ' + escapeHtml(own.nom) : '') + '</p></div>' +
      (canWrite("properties") ? '<div class="row-actions"><button id="propEditBtn">Modifier</button><button class="danger ghost" id="propDeleteBtn">Supprimer</button></div>' : '') + '</div>' +
      '<div class="card card-pad"><div class="info-grid">' + infoItem("Référence", p.reference) + infoItem("Ville / quartier", p.ville) + infoItem("Adresse", p.adresse) + infoItem("Description", p.description) + '</div></div>' +
      '<div class="page-head"><p class="section-title" style="margin:0;">Logements (' + us.length + ')</p>' + (canWrite("units") ? '<button class="primary small" id="btnNewUnit">+ Logement</button>' : '') + '</div>' +
      '<div class="tabs" id="unitTabs">' +
        '<button class="active" data-f="all">Tous</button><button data-f="disponible">Disponibles</button><button data-f="occupe">Occupés</button><button data-f="maintenance">Maintenance</button>' +
      '</div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Numéro</th><th>Type</th><th>Loyer</th><th>Statut</th><th>Locataire actuel</th><th></th></tr></thead><tbody id="unitsBody"></tbody></table></div>' +
      '<div class="empty" id="unitsEmpty" hidden>Aucun logement.</div></div>';

    function draw() {
      var list = us.filter(function (u) { return filter === "all" || u.statut === filter; });
      document.getElementById("unitsBody").innerHTML = list.map(function (u) {
        var l = activeLeaseForUnit(u.id);
        var t = l ? tenantById(l.tenant_id) : null;
        return '<tr><td>' + escapeHtml(u.numero) + '</td><td>' + escapeHtml(u.type || "—") + '</td><td>' + fmtMoney(u.rent) + '</td><td>' + unitStatutBadge(u.statut) + '</td><td>' + (t ? '<a href="#/locataires/' + t.id + '">' + escapeHtml(fullName(t)) + '</a>' : "—") + '</td>' +
          '<td class="row-actions">' + (canWrite("units") ? '<button class="small" data-editunit="' + u.id + '">Modifier</button>' : '') + '</td></tr>';
      }).join("");
      document.getElementById("unitsEmpty").hidden = list.length > 0;
      CONTENT.querySelectorAll("[data-editunit]").forEach(function (b) { b.addEventListener("click", function () { openUnitModal(b.getAttribute("data-editunit"), p.id); }); });
    }
    draw();
    CONTENT.querySelectorAll("#unitTabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        CONTENT.querySelectorAll("#unitTabs button").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active"); filter = b.getAttribute("data-f"); draw();
      });
    });
    var editBtn = document.getElementById("propEditBtn");
    if (editBtn) editBtn.addEventListener("click", function () { openPropertyModal(p.id); });
    var delBtn = document.getElementById("propDeleteBtn");
    if (delBtn) delBtn.addEventListener("click", async function () {
      if (!confirm('Supprimer "' + p.nom + '" ?')) return;
      try { await api("/api/properties/" + p.id, { method: "DELETE" }); properties = properties.filter(function (x) { return x.id !== p.id; }); location.hash = "#/maisons"; }
      catch (e) { showBanner(e.message); }
    });
    var newUnitBtn = document.getElementById("btnNewUnit");
    if (newUnitBtn) newUnitBtn.addEventListener("click", function () { openUnitModal(null, p.id); });
  }

  var propertyModal = document.getElementById("propertyModal");
  function fillOwnerSelect(sel, selected) {
    sel.innerHTML = owners.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); }).map(function (o) {
      return '<option value="' + o.id + '"' + (o.id === selected ? " selected" : "") + '>' + escapeHtml(o.nom) + '</option>';
    }).join("");
  }
  function openPropertyModal(id) {
    var p = id ? propertyById(id) : null;
    document.getElementById("propertyModalTitle").textContent = p ? "Modifier la maison" : "Nouvelle maison";
    document.getElementById("propertyId").value = p ? p.id : "";
    document.getElementById("propertyNom").value = p ? p.nom : "";
    fillOwnerSelect(document.getElementById("propertyOwner"), p ? p.owner_id : (owners[0] && owners[0].id));
    document.getElementById("propertyReference").value = p ? (p.reference || "") : "";
    document.getElementById("propertyVille").value = p ? (p.ville || "") : "";
    document.getElementById("propertyAdresse").value = p ? (p.adresse || "") : "";
    document.getElementById("propertyDescription").value = p ? (p.description || "") : "";
    document.getElementById("propertyStatut").value = p ? p.statut : "actif";
    if (!owners.length) { alert("Crée d'abord un propriétaire."); return; }
    propertyModal.hidden = false;
  }
  document.getElementById("propertyCancel").addEventListener("click", function () { propertyModal.hidden = true; });
  propertyModal.addEventListener("click", function (e) { if (e.target === propertyModal) propertyModal.hidden = true; });
  document.getElementById("propertySave").addEventListener("click", async function () {
    var id = document.getElementById("propertyId").value;
    var nom = document.getElementById("propertyNom").value.trim();
    if (!nom) { alert("Le nom est obligatoire."); return; }
    var body = { nom: nom, owner_id: document.getElementById("propertyOwner").value, reference: document.getElementById("propertyReference").value.trim(),
      ville: document.getElementById("propertyVille").value.trim(), adresse: document.getElementById("propertyAdresse").value.trim(),
      description: document.getElementById("propertyDescription").value.trim(), statut: document.getElementById("propertyStatut").value };
    var btn = document.getElementById("propertySave"); btn.disabled = true;
    try {
      if (id) { var updated = await api("/api/properties/" + id, { method: "PUT", body: body }); var i = properties.findIndex(function (x) { return x.id === id; }); properties[i] = updated; }
      else { properties.push(await api("/api/properties", { method: "POST", body: body })); }
      propertyModal.hidden = true; route();
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
  });

  var unitModal = document.getElementById("unitModal");
  function openUnitModal(id, propertyId) {
    var u = id ? unitById(id) : null;
    document.getElementById("unitModalTitle").textContent = u ? "Modifier le logement" : "Nouveau logement";
    document.getElementById("unitId").value = u ? u.id : "";
    document.getElementById("unitPropertyId").value = propertyId;
    document.getElementById("unitNumero").value = u ? u.numero : "";
    document.getElementById("unitType").value = u ? (u.type || "") : "";
    document.getElementById("unitDescription").value = u ? (u.description || "") : "";
    document.getElementById("unitRent").value = u ? u.rent : "";
    document.getElementById("unitCaution").value = u ? (u.caution || "") : "";
    document.getElementById("unitStatut").value = u ? u.statut : "disponible";
    unitModal.hidden = false;
  }
  document.getElementById("unitCancel").addEventListener("click", function () { unitModal.hidden = true; });
  unitModal.addEventListener("click", function (e) { if (e.target === unitModal) unitModal.hidden = true; });
  document.getElementById("unitSave").addEventListener("click", async function () {
    var id = document.getElementById("unitId").value;
    var numero = document.getElementById("unitNumero").value.trim();
    var rent = parseFloat(document.getElementById("unitRent").value);
    if (!numero) { alert("Le numéro est obligatoire."); return; }
    if (!rent || rent <= 0) { alert("Merci de saisir un loyer valide."); return; }
    var body = { numero: numero, property_id: document.getElementById("unitPropertyId").value, type: document.getElementById("unitType").value.trim(),
      description: document.getElementById("unitDescription").value.trim(), rent: rent,
      caution: parseFloat(document.getElementById("unitCaution").value) || null, statut: document.getElementById("unitStatut").value };
    var btn = document.getElementById("unitSave"); btn.disabled = true;
    try {
      if (id) { var updated = await api("/api/units/" + id, { method: "PUT", body: body }); var i = units.findIndex(function (x) { return x.id === id; }); units[i] = updated; }
      else { units.push(await api("/api/units", { method: "POST", body: body })); }
      unitModal.hidden = true; route();
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
  });

  // ============ LOCATAIRES ============
  function renderTenantsList() {
    var q = "";
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Locataires</h2><p class="subtitle" style="margin:0;">' + tenants.length + ' locataire(s)</p></div>' +
      (canWrite("tenants") ? '<button class="primary" id="btnNewTenant">+ Nouveau locataire</button>' : '') + '</div>' +
      '<div class="toolbar"><input type="text" id="tenantSearch" placeholder="Rechercher un locataire..."></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Nom</th><th>Téléphone</th><th>Logement actuel</th><th>Statut</th></tr></thead><tbody id="tenantsBody"></tbody></table></div>' +
      '<div class="empty" id="tenantsEmpty" hidden>Aucun locataire.</div></div>';

    function draw() {
      var list = tenants.filter(function (t) { return !q || fullName(t).toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); });
      document.getElementById("tenantsBody").innerHTML = list.map(function (t) {
        var l = leasesForTenant(t.id).find(function (x) { return x.statut === "actif"; });
        var u = l ? unitById(l.unit_id) : null;
        return '<tr class="clickable" data-go="#/locataires/' + t.id + '"><td>' + escapeHtml(fullName(t)) + '</td><td>' + escapeHtml(t.telephone || "—") + '</td><td>' + (u ? escapeHtml(u.numero) : "—") + '</td><td>' + (l ? '<span class="badge ok">Locataire actif</span>' : '<span class="badge neutral">Sans contrat actif</span>') + '</td></tr>';
      }).join("");
      document.getElementById("tenantsEmpty").hidden = tenants.length > 0;
      bindRowNav();
    }
    draw();
    document.getElementById("tenantSearch").addEventListener("input", function (e) { q = e.target.value.trim().toLowerCase(); draw(); });
    var btn = document.getElementById("btnNewTenant");
    if (btn) btn.addEventListener("click", function () { openTenantModal(null); });
  }

  function renderTenantDetail(id) {
    var t = tenantById(id);
    if (!t) { location.hash = "#/locataires"; return; }
    var ls = leasesForTenant(id).sort(function (a, b) { return b.date_debut.localeCompare(a.date_debut); });

    CONTENT.innerHTML =
      '<a href="#/locataires" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>' + escapeHtml(fullName(t)) + '</h2><p class="subtitle" style="margin:0;">' + (t.telephone || "") + '</p></div>' +
      (canWrite("tenants") ? '<div class="row-actions"><button id="tenantEditBtn">Modifier</button><button class="danger ghost" id="tenantDeleteBtn">Supprimer</button></div>' : '') + '</div>' +
      '<div class="card card-pad"><div class="info-grid">' +
        infoItem("Téléphone", t.telephone) + infoItem("Email", t.email) + infoItem("Adresse", t.adresse) +
        infoItem("Pièce d'identité", t.piece_identite) + infoItem("N° pièce", t.numero_piece) + infoItem("Date de naissance", t.date_naissance ? fmtDate(t.date_naissance) : null) +
        infoItem("Contact d'urgence", t.contact_urgence_nom) + infoItem("Tél. urgence", t.contact_urgence_telephone) +
      '</div></div>' +
      '<div class="card"><div class="card-pad" style="padding-bottom:0;"><p class="section-title">Contrats</p></div><div class="table-scroll"><table><thead><tr><th>Logement</th><th>Début</th><th>Fin</th><th>Loyer</th><th>Statut</th></tr></thead><tbody>' +
        (ls.length ? ls.map(function (l) {
          var u = unitById(l.unit_id); var p = u ? propertyById(u.property_id) : null;
          return '<tr class="clickable" data-go="#/contrats/' + l.id + '"><td>' + (u ? escapeHtml((p ? p.nom + " — " : "") + u.numero) : "—") + '</td><td>' + fmtDate(l.date_debut) + '</td><td>' + (l.date_fin ? fmtDate(l.date_fin) : "—") + '</td><td>' + fmtMoney(l.rent) + '</td><td>' + leaseStatutBadge(l.statut) + '</td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty">Aucun contrat.</td></tr>') +
      '</tbody></table></div></div>';
    bindRowNav();
    var editBtn = document.getElementById("tenantEditBtn");
    if (editBtn) editBtn.addEventListener("click", function () { openTenantModal(t.id); });
    var delBtn = document.getElementById("tenantDeleteBtn");
    if (delBtn) delBtn.addEventListener("click", async function () {
      if (!confirm('Supprimer "' + fullName(t) + '" ?')) return;
      try { await api("/api/tenants/" + t.id, { method: "DELETE" }); tenants = tenants.filter(function (x) { return x.id !== t.id; }); location.hash = "#/locataires"; }
      catch (e) { showBanner(e.message); }
    });
  }

  var tenantModal = document.getElementById("tenantModal");
  function openTenantModal(id) {
    var t = id ? tenantById(id) : null;
    document.getElementById("tenantModalTitle").textContent = t ? "Modifier le locataire" : "Nouveau locataire";
    document.getElementById("tenantId").value = t ? t.id : "";
    document.getElementById("tenantNom").value = t ? t.nom : "";
    document.getElementById("tenantPrenom").value = t ? (t.prenom || "") : "";
    document.getElementById("tenantTelephone").value = t ? (t.telephone || "") : "";
    document.getElementById("tenantEmail").value = t ? (t.email || "") : "";
    document.getElementById("tenantAdresse").value = t ? (t.adresse || "") : "";
    document.getElementById("tenantPieceType").value = t ? (t.piece_identite || "") : "";
    document.getElementById("tenantPieceNumero").value = t ? (t.numero_piece || "") : "";
    document.getElementById("tenantNaissance").value = t ? (t.date_naissance || "") : "";
    document.getElementById("tenantUrgenceNom").value = t ? (t.contact_urgence_nom || "") : "";
    document.getElementById("tenantUrgenceTel").value = t ? (t.contact_urgence_telephone || "") : "";
    tenantModal.hidden = false;
    document.getElementById("tenantNom").focus();
  }
  document.getElementById("tenantCancel").addEventListener("click", function () { tenantModal.hidden = true; });
  tenantModal.addEventListener("click", function (e) { if (e.target === tenantModal) tenantModal.hidden = true; });
  document.getElementById("tenantSave").addEventListener("click", async function () {
    var id = document.getElementById("tenantId").value;
    var nom = document.getElementById("tenantNom").value.trim();
    if (!nom) { alert("Le nom est obligatoire."); return; }
    var body = {
      nom: nom, prenom: document.getElementById("tenantPrenom").value.trim(), telephone: document.getElementById("tenantTelephone").value.trim(),
      email: document.getElementById("tenantEmail").value.trim(), adresse: document.getElementById("tenantAdresse").value.trim(),
      piece_identite: document.getElementById("tenantPieceType").value.trim(), numero_piece: document.getElementById("tenantPieceNumero").value.trim(),
      date_naissance: document.getElementById("tenantNaissance").value, contact_urgence_nom: document.getElementById("tenantUrgenceNom").value.trim(),
      contact_urgence_telephone: document.getElementById("tenantUrgenceTel").value.trim(),
    };
    var btn = document.getElementById("tenantSave"); btn.disabled = true;
    try {
      if (id) { var updated = await api("/api/tenants/" + id, { method: "PUT", body: body }); var i = tenants.findIndex(function (x) { return x.id === id; }); tenants[i] = updated; return finishTenantSave(); }
      var created = await api("/api/tenants", { method: "POST", body: body }); tenants.push(created);
      finishTenantSave(created);
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
    function finishTenantSave(created) {
      tenantModal.hidden = true;
      if (window.__tenantPickCallback) { var cb = window.__tenantPickCallback; window.__tenantPickCallback = null; cb(created || tenantById(id)); }
      else route();
    }
  });

  // ============ CONTRATS (leases) ============
  function renderLeasesList() {
    var filter = "all", q = "";
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Contrats de location</h2><p class="subtitle" style="margin:0;">' + leases.length + ' contrat(s)</p></div>' +
      (canWrite("leases") ? '<button class="primary" id="btnNewLease">+ Nouveau contrat</button>' : '') + '</div>' +
      '<div class="tabs" id="leaseTabs"><button class="active" data-f="all">Tous</button><button data-f="actif">Actifs</button><button data-f="termine">Terminés</button><button data-f="resilie">Résiliés</button><button data-f="en_attente">En attente</button></div>' +
      '<div class="toolbar"><input type="text" id="leaseSearch" placeholder="Rechercher un locataire, un logement..."></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Locataire</th><th>Logement</th><th>Maison</th><th>Début</th><th>Loyer</th><th>Statut</th></tr></thead><tbody id="leasesBody"></tbody></table></div>' +
      '<div class="empty" id="leasesEmpty" hidden>Aucun contrat.</div></div>';

    function draw() {
      var list = leases.filter(function (l) {
        if (filter !== "all" && l.statut !== filter) return false;
        if (!q) return true;
        var t = tenantById(l.tenant_id), u = unitById(l.unit_id);
        var hay = ((t ? fullName(t) : "") + " " + (u ? u.numero : "")).toLowerCase();
        return hay.indexOf(q) !== -1;
      }).sort(function (a, b) { return b.date_debut.localeCompare(a.date_debut); });
      document.getElementById("leasesBody").innerHTML = list.map(function (l) {
        var t = tenantById(l.tenant_id), u = unitById(l.unit_id), p = u ? propertyById(u.property_id) : null;
        return '<tr class="clickable" data-go="#/contrats/' + l.id + '"><td>' + (t ? escapeHtml(fullName(t)) : "—") + '</td><td>' + (u ? escapeHtml(u.numero) : "—") + '</td><td>' + (p ? escapeHtml(p.nom) : "—") + '</td><td>' + fmtDate(l.date_debut) + '</td><td>' + fmtMoney(l.rent) + '</td><td>' + leaseStatutBadge(l.statut) + '</td></tr>';
      }).join("");
      document.getElementById("leasesEmpty").hidden = list.length > 0;
      bindRowNav();
    }
    draw();
    CONTENT.querySelectorAll("#leaseTabs button").forEach(function (b) {
      b.addEventListener("click", function () { CONTENT.querySelectorAll("#leaseTabs button").forEach(function (x) { x.classList.remove("active"); }); b.classList.add("active"); filter = b.getAttribute("data-f"); draw(); });
    });
    document.getElementById("leaseSearch").addEventListener("input", function (e) { q = e.target.value.trim().toLowerCase(); draw(); });
    var btn = document.getElementById("btnNewLease");
    if (btn) btn.addEventListener("click", function () { openLeaseModal(null); });
  }

  function renderLeaseDetail(id) {
    var l = leaseById(id);
    if (!l) { location.hash = "#/contrats"; return; }
    var t = tenantById(l.tenant_id), u = unitById(l.unit_id), p = u ? propertyById(u.property_id) : null;
    var totals = leaseTotals(l);
    var plist = paymentsForLease(l.id).slice().sort(function (a, b) { return (b.period + b.date).localeCompare(a.period + a.date); });

    CONTENT.innerHTML =
      '<a href="#/contrats" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Contrat ' + (l.numero ? escapeHtml(l.numero) : "#" + l.id.slice(0, 8)) + '</h2><p class="subtitle" style="margin:0;">' + (t ? escapeHtml(fullName(t)) : "") + (u ? " — " + escapeHtml(u.numero) : "") + '</p></div>' +
      '<div class="row-actions">' + (canWrite("payments") && l.statut === "actif" ? '<button class="primary" id="leasePayBtn">+ Paiement</button>' : '') +
        (canWrite("leases") ? '<button id="leaseEditBtn">Modifier</button><button class="danger ghost" id="leaseDeleteBtn">Supprimer</button>' : '') + '</div></div>' +
      '<div class="card card-pad"><div class="info-grid">' +
        infoItem("Locataire", t ? fullName(t) : null) + infoItem("Logement", u ? u.numero : null) + infoItem("Maison", p ? p.nom : null) +
        infoItem("Date de début", fmtDate(l.date_debut)) + infoItem("Date de fin", l.date_fin ? fmtDate(l.date_fin) : "—") +
        infoItem("Caution", l.caution ? fmtMoney(l.caution) : null) + infoItem("Jour de paiement", l.jour_paiement) + infoItemRaw("Statut", leaseStatutBadge(l.statut)) +
      '</div>' + (l.conditions ? '<p style="margin-top:12px;color:var(--text-muted);font-size:0.85rem;">' + escapeHtml(l.conditions) + '</p>' : '') + '</div>' +
      '<div class="stats">' + stat("Total dû", fmtMoney(totals.due)) + stat("Total payé", fmtMoney(totals.paid), "ok") +
        stat("Solde", totals.status === "credit" ? fmtMoney(Math.abs(totals.balance)) + " d'avance" : fmtMoney(totals.balance), totals.status === "late" ? "danger" : "ok") +
      '</div>' +
      '<div class="card"><div class="card-pad" style="padding-bottom:0;"><p class="section-title">Suivi mois par mois</p></div><div class="table-scroll"><table><thead><tr><th>Mois</th><th>Loyer dû</th><th>Payé</th><th>Solde</th><th>Statut</th><th></th></tr></thead><tbody>' +
        totals.periods.slice().reverse().map(function (per) {
          var paid = leasePaidForPeriod(l.id, per);
          return '<tr><td class="month-cell">' + capitalize(fmtPeriod(per)) + '</td><td>' + fmtMoney(l.rent) + '</td><td>' + fmtMoney(paid) + '</td><td>' + fmtMoney(Math.max(0, l.rent - paid)) + '</td><td>' + monthBadge(paid, l.rent) + '</td>' +
            '<td>' + (canWrite("payments") && paid + 0.5 < l.rent ? '<button class="small" data-payperiod="' + per + '">+ Paiement</button>' : '') + '</td></tr>';
        }).join("") +
      '</tbody></table></div></div>' +
      '<div class="card"><div class="card-pad" style="padding-bottom:0;"><p class="section-title">Historique des paiements</p></div><div class="table-scroll"><table><thead><tr><th>Mois</th><th>Payé le</th><th>Montant</th><th>Mode</th><th>Référence</th><th>Note</th><th></th></tr></thead><tbody>' +
        (plist.length ? plist.map(function (pay) {
          return '<tr><td class="month-cell">' + capitalize(fmtPeriod(pay.period)) + '</td><td>' + fmtDate(pay.date) + '</td><td>' + fmtMoney(pay.amount) + '</td><td>' + escapeHtml(pay.method || "—") + '</td><td>' + escapeHtml(pay.reference || "—") + '</td><td>' + escapeHtml(pay.note || "") + '</td>' +
            '<td>' + (canWrite("payments") ? '<button class="small danger ghost" data-delpay="' + pay.id + '">Suppr.</button>' : '') + '</td></tr>';
        }).join("") : '<tr><td colspan="7" class="empty">Aucun paiement.</td></tr>') +
      '</tbody></table></div></div>';

    CONTENT.querySelectorAll("[data-payperiod]").forEach(function (b) { b.addEventListener("click", function () { openPaymentModal(l.id, b.getAttribute("data-payperiod")); }); });
    CONTENT.querySelectorAll("[data-delpay]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Supprimer ce paiement ?")) return;
        try { await api("/api/payments/" + b.getAttribute("data-delpay"), { method: "DELETE" }); payments = payments.filter(function (x) { return x.id !== b.getAttribute("data-delpay"); }); renderLeaseDetail(l.id); }
        catch (e) { showBanner(e.message); }
      });
    });
    var payBtn = document.getElementById("leasePayBtn");
    if (payBtn) payBtn.addEventListener("click", function () { openPaymentModal(l.id, null); });
    var editBtn = document.getElementById("leaseEditBtn");
    if (editBtn) editBtn.addEventListener("click", function () { openLeaseModal(l.id); });
    var delBtn = document.getElementById("leaseDeleteBtn");
    if (delBtn) delBtn.addEventListener("click", async function () {
      if (!confirm("Supprimer ce contrat et tous ses paiements ?")) return;
      try {
        await api("/api/leases/" + l.id, { method: "DELETE" });
        leases = leases.filter(function (x) { return x.id !== l.id; });
        payments = payments.filter(function (x) { return x.lease_id !== l.id; });
        if (u) { var uu = unitById(u.id); if (uu) uu.statut = "disponible"; }
        location.hash = "#/contrats";
      } catch (e) { showBanner(e.message); }
    });
  }

  var leaseModal = document.getElementById("leaseModal");
  function fillUnitSelect(propertyId, selectedUnit) {
    var sel = document.getElementById("leaseUnit");
    var list = propertyId ? unitsForProperty(propertyId) : units;
    sel.innerHTML = list.map(function (u) {
      var busy = activeLeaseForUnit(u.id) && activeLeaseForUnit(u.id).id !== document.getElementById("leaseId").value;
      return '<option value="' + u.id + '"' + (u.id === selectedUnit ? " selected" : "") + '>' + escapeHtml(u.numero) + (busy ? " (occupé)" : "") + ' — ' + fmtMoney(u.rent) + '</option>';
    }).join("");
    var chosen = unitById(sel.value);
    if (chosen && !document.getElementById("leaseId").value) document.getElementById("leaseRent").value = chosen.rent;
  }
  function fillTenantSelect(selected) {
    var sel = document.getElementById("leaseTenant");
    sel.innerHTML = tenants.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); }).map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === selected ? " selected" : "") + '>' + escapeHtml(fullName(t)) + '</option>';
    }).join("");
  }
  function openLeaseModal(id, presetUnitId) {
    var l = id ? leaseById(id) : null;
    if (!units.length) { alert("Crée d'abord un logement."); return; }
    if (!tenants.length) { alert("Crée d'abord un locataire."); return; }
    document.getElementById("leaseModalTitle").textContent = l ? "Modifier le contrat" : "Nouveau contrat";
    document.getElementById("leaseId").value = l ? l.id : "";
    var propSel = document.getElementById("leasePropertyPicker");
    propSel.innerHTML = '<option value="">Toutes les maisons</option>' + properties.slice().sort(function (a, b) { return a.nom.localeCompare(b.nom, "fr"); }).map(function (p) { return '<option value="' + p.id + '">' + escapeHtml(p.nom) + '</option>'; }).join("");
    var initialUnit = l ? l.unit_id : presetUnitId;
    if (initialUnit) { var uu = unitById(initialUnit); if (uu) propSel.value = uu.property_id; }
    propSel.onchange = function () { fillUnitSelect(propSel.value || null, null); };
    fillUnitSelect(propSel.value || null, initialUnit);
    fillTenantSelect(l ? l.tenant_id : null);
    document.getElementById("leaseDateDebut").value = l ? l.date_debut : todayISO();
    document.getElementById("leaseDateFin").value = l ? (l.date_fin || "") : "";
    document.getElementById("leaseRent").value = l ? l.rent : (unitById(initialUnit) ? unitById(initialUnit).rent : "");
    document.getElementById("leaseCaution").value = l ? (l.caution || "") : "";
    document.getElementById("leaseJourPaiement").value = l ? (l.jour_paiement || "") : "";
    document.getElementById("leaseStatut").value = l ? l.statut : "actif";
    document.getElementById("leaseConditions").value = l ? (l.conditions || "") : "";
    document.getElementById("leaseUnit").onchange = function () {
      var uu = unitById(document.getElementById("leaseUnit").value);
      if (uu) document.getElementById("leaseRent").value = uu.rent;
    };
    leaseModal.hidden = false;
  }
  document.getElementById("leaseCancel").addEventListener("click", function () { leaseModal.hidden = true; });
  leaseModal.addEventListener("click", function (e) { if (e.target === leaseModal) leaseModal.hidden = true; });
  document.getElementById("leaseSave").addEventListener("click", async function () {
    var id = document.getElementById("leaseId").value;
    var rent = parseFloat(document.getElementById("leaseRent").value);
    var dateDebut = document.getElementById("leaseDateDebut").value;
    if (!dateDebut) { alert("La date de début est obligatoire."); return; }
    if (!rent || rent <= 0) { alert("Merci de saisir un loyer valide."); return; }
    var body = {
      tenant_id: document.getElementById("leaseTenant").value, unit_id: document.getElementById("leaseUnit").value,
      date_debut: dateDebut, date_fin: document.getElementById("leaseDateFin").value || null, rent: rent,
      caution: parseFloat(document.getElementById("leaseCaution").value) || null,
      jour_paiement: parseInt(document.getElementById("leaseJourPaiement").value, 10) || null,
      conditions: document.getElementById("leaseConditions").value.trim(), statut: document.getElementById("leaseStatut").value,
    };
    var btn = document.getElementById("leaseSave"); btn.disabled = true;
    try {
      var saved;
      if (id) { saved = await api("/api/leases/" + id, { method: "PUT", body: body }); var i = leases.findIndex(function (x) { return x.id === id; }); leases[i] = saved; }
      else { saved = await api("/api/leases", { method: "POST", body: body }); leases.push(saved); }
      var uu = unitById(body.unit_id);
      if (uu) uu.statut = body.statut === "actif" ? "occupe" : (activeLeaseForUnit(uu.id) ? "occupe" : "disponible");
      leaseModal.hidden = true;
      location.hash = "#/contrats/" + saved.id;
      route();
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
  });

  // ============ PAIEMENTS (page) ============
  var paymentModal = document.getElementById("paymentModal");
  function openPaymentModal(leaseId, presetPeriod) {
    var l = leaseById(leaseId);
    if (!l) return;
    var t = tenantById(l.tenant_id), u = unitById(l.unit_id);
    document.getElementById("payLeaseId").value = leaseId;
    document.getElementById("paymentLeaseInfo").textContent = (t ? fullName(t) : "") + (u ? " — " + u.numero : "");

    var periods = leasePeriods(l);
    var owed = periods.filter(function (per) { return leasePaidForPeriod(leaseId, per) + 0.5 < l.rent; });
    var future = [addMonths(periods[periods.length - 1] || currentPeriod(), 1), addMonths(periods[periods.length - 1] || currentPeriod(), 2)];
    var allPeriods = owed.concat(future);
    var defaultPeriod = presetPeriod || owed[0] || allPeriods[0];

    var sel = document.getElementById("payPeriod");
    sel.innerHTML = allPeriods.map(function (per) { return '<option value="' + per + '"' + (per === defaultPeriod ? " selected" : "") + '>' + capitalize(fmtPeriod(per)) + '</option>'; }).join("");
    function applyPeriod(per) {
      var remaining = Math.max(0, l.rent - leasePaidForPeriod(leaseId, per));
      document.getElementById("payAmount").value = remaining;
      document.getElementById("payAmount").max = remaining;
      document.getElementById("payRemainingHint").textContent = "Solde dû pour ce mois : " + fmtMoney(remaining);
    }
    sel.onchange = function () { applyPeriod(sel.value); };
    applyPeriod(defaultPeriod);
    document.getElementById("payDate").value = todayISO();
    document.getElementById("payMethod").value = "Espèces";
    document.getElementById("payReference").value = "";
    document.getElementById("payNote").value = "";
    paymentModal.hidden = false;
  }
  document.getElementById("paymentCancel").addEventListener("click", function () { paymentModal.hidden = true; });
  paymentModal.addEventListener("click", function (e) { if (e.target === paymentModal) paymentModal.hidden = true; });
  document.getElementById("paymentSave").addEventListener("click", async function () {
    var leaseId = document.getElementById("payLeaseId").value;
    var l = leaseById(leaseId);
    var period = document.getElementById("payPeriod").value;
    var amount = parseFloat(document.getElementById("payAmount").value);
    var date = document.getElementById("payDate").value;
    if (!amount || amount <= 0) { alert("Merci de saisir un montant valide."); return; }
    if (!date) { alert("Merci de saisir une date."); return; }
    var remaining = Math.max(0, l.rent - leasePaidForPeriod(leaseId, period));
    if (amount > remaining + 0.5) { alert("Ce montant dépasse le solde dû pour ce mois (" + fmtMoney(remaining) + " restant)."); return; }
    var body = { lease_id: leaseId, period: period, amount: amount, date: date, method: document.getElementById("payMethod").value, reference: document.getElementById("payReference").value.trim(), note: document.getElementById("payNote").value.trim() };
    var btn = document.getElementById("paymentSave"); btn.disabled = true;
    try {
      payments.push(await api("/api/payments", { method: "POST", body: body }));
      paymentModal.hidden = true;
      route();
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
  });

  var pickLeaseModal = document.getElementById("pickLeaseModal");
  function openPickLeaseModal() {
    var q = "";
    function draw() {
      var actives = leases.filter(function (l) { return l.statut === "actif"; });
      var list = actives.filter(function (l) {
        if (!q) return true;
        var t = tenantById(l.tenant_id), u = unitById(l.unit_id);
        return ((t ? fullName(t) : "") + " " + (u ? u.numero : "")).toLowerCase().indexOf(q) !== -1;
      });
      document.getElementById("pickLeaseList").innerHTML = list.length ? list.map(function (l) {
        var t = tenantById(l.tenant_id), u = unitById(l.unit_id), p = u ? propertyById(u.property_id) : null;
        return '<div class="listrow" style="cursor:pointer;" data-pick="' + l.id + '"><span>' + (t ? escapeHtml(fullName(t)) : "—") + ' — ' + (u ? escapeHtml(u.numero) : "") + (p ? " (" + escapeHtml(p.nom) + ")" : "") + '</span><span>' + fmtMoney(l.rent) + '</span></div>';
      }).join("") : '<p class="empty">Aucun contrat actif trouvé.</p>';
      document.getElementById("pickLeaseList").querySelectorAll("[data-pick]").forEach(function (el) {
        el.addEventListener("click", function () { pickLeaseModal.hidden = true; openPaymentModal(el.getAttribute("data-pick"), null); });
      });
    }
    document.getElementById("pickLeaseSearch").value = "";
    draw();
    document.getElementById("pickLeaseSearch").oninput = function (e) { q = e.target.value.trim().toLowerCase(); draw(); };
    pickLeaseModal.hidden = false;
  }
  document.getElementById("pickLeaseCancel").addEventListener("click", function () { pickLeaseModal.hidden = true; });
  pickLeaseModal.addEventListener("click", function (e) { if (e.target === pickLeaseModal) pickLeaseModal.hidden = true; });

  function renderPaymentsPage() {
    var q = "";
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Paiements</h2><p class="subtitle" style="margin:0;">Enregistrement et historique des loyers reçus</p></div>' +
      (canWrite("payments") ? '<button class="primary" id="btnRecordPayment">+ Enregistrer un paiement</button>' : '') + '</div>' +
      '<div class="toolbar"><input type="text" id="paySearch" placeholder="Rechercher un locataire, un logement..."></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Date</th><th>Mois</th><th>Locataire</th><th>Logement</th><th>Montant</th><th>Mode</th><th>Enregistré par</th></tr></thead><tbody id="paysBody"></tbody></table></div>' +
      '<div class="empty" id="paysEmpty" hidden>Aucun paiement enregistré.</div></div>';

    function draw() {
      var list = payments.slice().sort(function (a, b) { return (b.date + b.created_at).localeCompare(a.date + a.created_at); }).filter(function (pay) {
        if (!q) return true;
        var l = leaseById(pay.lease_id); var t = l ? tenantById(l.tenant_id) : null; var u = l ? unitById(l.unit_id) : null;
        return ((t ? fullName(t) : "") + " " + (u ? u.numero : "")).toLowerCase().indexOf(q) !== -1;
      });
      document.getElementById("paysBody").innerHTML = list.map(function (pay) {
        var l = leaseById(pay.lease_id); var t = l ? tenantById(l.tenant_id) : null; var u = l ? unitById(l.unit_id) : null;
        var usr = users.find(function (x) { return x.id === pay.user_id; });
        return '<tr class="clickable" data-go="#/contrats/' + (l ? l.id : "") + '"><td>' + fmtDate(pay.date) + '</td><td class="month-cell">' + capitalize(fmtPeriod(pay.period)) + '</td><td>' + (t ? escapeHtml(fullName(t)) : "—") + '</td><td>' + (u ? escapeHtml(u.numero) : "—") + '</td><td>' + fmtMoney(pay.amount) + '</td><td>' + escapeHtml(pay.method || "—") + '</td><td>' + (usr ? escapeHtml(usr.email) : "—") + '</td></tr>';
      }).join("");
      document.getElementById("paysEmpty").hidden = list.length > 0;
      bindRowNav();
    }
    draw();
    document.getElementById("paySearch").addEventListener("input", function (e) { q = e.target.value.trim().toLowerCase(); draw(); });
    var btn = document.getElementById("btnRecordPayment");
    if (btn) btn.addEventListener("click", openPickLeaseModal);
  }

  // ============ IMPAYÉS ============
  function renderImpayesPage() {
    var rows = [];
    leases.filter(function (l) { return l.statut === "actif"; }).forEach(function (l) {
      var t = tenantById(l.tenant_id), u = unitById(l.unit_id), p = u ? propertyById(u.property_id) : null;
      leasePeriods(l).forEach(function (per) {
        var paid = leasePaidForPeriod(l.id, per);
        if (paid + 0.5 < l.rent) {
          var dueDate = per + "-" + String(l.jour_paiement || 1).padStart(2, "0");
          rows.push({ lease: l, tenant: t, unit: u, property: p, period: per, due: l.rent, paid: paid, solde: l.rent - paid, retard: Math.max(0, daysBetween(dueDate, todayISO())) });
        }
      });
    });
    rows.sort(function (a, b) { return b.retard - a.retard; });

    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Impayés</h2><p class="subtitle" style="margin:0;">' + rows.length + ' mois impayé(s) ou partiel(s), pour ' + fmtMoney(rows.reduce(function (s, r) { return s + r.solde; }, 0)) + '</p></div></div>' +
      '<div class="toolbar"><input type="text" id="impSearch" placeholder="Rechercher..."></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Locataire</th><th>Maison</th><th>Logement</th><th>Mois</th><th>Dû</th><th>Payé</th><th>Solde</th><th>Retard</th></tr></thead><tbody id="impBody"></tbody></table></div>' +
      '<div class="empty" id="impEmpty" hidden>Aucun impayé — tout est à jour 🎉</div></div>';

    function draw(q) {
      var list = rows.filter(function (r) { if (!q) return true; return ((r.tenant ? fullName(r.tenant) : "") + " " + (r.unit ? r.unit.numero : "")).toLowerCase().indexOf(q) !== -1; });
      document.getElementById("impBody").innerHTML = list.map(function (r) {
        return '<tr class="clickable" data-go="#/contrats/' + r.lease.id + '"><td>' + (r.tenant ? escapeHtml(fullName(r.tenant)) : "—") + '</td><td>' + (r.property ? escapeHtml(r.property.nom) : "—") + '</td><td>' + (r.unit ? escapeHtml(r.unit.numero) : "—") + '</td><td class="month-cell">' + capitalize(fmtPeriod(r.period)) + '</td><td>' + fmtMoney(r.due) + '</td><td>' + fmtMoney(r.paid) + '</td><td class="amount-due">' + fmtMoney(r.solde) + '</td><td>' + r.retard + ' j.</td></tr>';
      }).join("");
      document.getElementById("impEmpty").hidden = rows.length > 0;
      bindRowNav();
    }
    draw("");
    document.getElementById("impSearch").addEventListener("input", function (e) { draw(e.target.value.trim().toLowerCase()); });
  }

  // ============ ÉCHÉANCES ============
  function renderEcheancesPage() {
    var rows = [];
    leases.filter(function (l) { return l.statut === "actif"; }).forEach(function (l) {
      var t = tenantById(l.tenant_id), u = unitById(l.unit_id);
      var cur = currentPeriod();
      var paid = leasePaidForPeriod(l.id, cur);
      var dueDate = cur + "-" + String(l.jour_paiement || 1).padStart(2, "0");
      rows.push({ lease: l, tenant: t, unit: u, period: cur, dueDate: dueDate, montant: Math.max(0, l.rent - paid), paid: paid >= l.rent - 0.5 });
    });
    rows = rows.filter(function (r) { return !r.paid; }).sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); });

    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Échéances</h2><p class="subtitle" style="margin:0;">Loyers du mois en cours restant à payer</p></div></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Locataire</th><th>Logement</th><th>Échéance</th><th>Montant</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (r) {
          return '<tr><td>' + (r.tenant ? escapeHtml(fullName(r.tenant)) : "—") + '</td><td>' + (r.unit ? escapeHtml(r.unit.numero) : "—") + '</td><td>' + fmtDate(r.dueDate) + '</td><td>' + fmtMoney(r.montant) + '</td><td>' + (canWrite("payments") ? '<button class="small" data-pay="' + r.lease.id + '">+ Paiement</button>' : '') + '</td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty">Aucune échéance en attente ce mois-ci.</td></tr>') +
      '</tbody></table></div></div>';
    CONTENT.querySelectorAll("[data-pay]").forEach(function (b) { b.addEventListener("click", function () { openPaymentModal(b.getAttribute("data-pay"), currentPeriod()); }); });
  }

  // ============ FINANCES ============
  function renderFinancesPage() {
    var actifs = leases.filter(function (l) { return l.statut === "actif"; });
    var totalAttendu = 0, totalEncaisse = 0;
    actifs.forEach(function (l) { var t = leaseTotals(l); totalAttendu += t.due; totalEncaisse += t.paid; });

    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Finances</h2><p class="subtitle" style="margin:0;">Revenus locatifs et situation des propriétaires</p></div></div>' +
      '<div class="stats">' + stat("Attendu (cumulé)", fmtMoney(totalAttendu)) + stat("Encaissé (cumulé)", fmtMoney(totalEncaisse), "ok") + stat("Impayé (cumulé)", fmtMoney(Math.max(0, totalAttendu - totalEncaisse)), (totalAttendu - totalEncaisse) > 0.5 ? "danger" : "ok") + '</div>' +
      '<div class="card"><div class="card-pad" style="padding-bottom:0;"><p class="section-title">Situation par propriétaire</p></div><div class="table-scroll"><table><thead><tr><th>Propriétaire</th><th>Maisons</th><th>Logements</th><th>Occupés</th><th>Attendu</th><th>Encaissé</th><th>Impayé</th></tr></thead><tbody>' +
        owners.map(function (o) {
          var props = propertiesForOwner(o.id);
          var us = [].concat.apply([], props.map(function (p) { return unitsForProperty(p.id); }));
          var occ = us.filter(function (u) { return u.statut === "occupe"; }).length;
          var ls = [].concat.apply([], us.map(function (u) { return leasesForUnit(u.id); })).filter(function (l) { return l.statut === "actif"; });
          var att = 0, enc = 0;
          ls.forEach(function (l) { var t = leaseTotals(l); att += t.due; enc += t.paid; });
          return '<tr class="clickable" data-go="#/proprietaires/' + o.id + '"><td>' + escapeHtml(o.nom) + '</td><td>' + props.length + '</td><td>' + us.length + '</td><td>' + occ + '</td><td>' + fmtMoney(att) + '</td><td>' + fmtMoney(enc) + '</td><td class="' + (att - enc > 0.5 ? "amount-due" : "amount-ok") + '">' + fmtMoney(Math.max(0, att - enc)) + '</td></tr>';
        }).join("") +
      '</tbody></table></div></div>';
    bindRowNav();
  }

  // ============ RAPPORTS ============
  function downloadCsv(filename, rows) {
    var csv = rows.map(function (r) { return r.map(function (c) { var s = String(c == null ? "" : c); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";"); }).join("\r\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function renderRapportsPage() {
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Rapports</h2><p class="subtitle" style="margin:0;">Exports CSV (compatibles Excel)</p></div></div>' +
      '<div class="nav-cards" style="margin-bottom:20px;">' +
        cardBtn("rptLoyers", "cash", "Rapport des loyers", "Encaissés, impayés, attendus") +
        cardBtn("rptLogements", "building", "Rapport des logements", "Occupés, disponibles, maintenance") +
        cardBtn("rptProprietaires", "user", "Rapport des propriétaires", "Biens, revenus, impayés") +
        cardBtn("rptLocataires", "users", "Rapport des locataires", "Actifs, sortis, historique paiements") +
      '</div>';

    function cardBtn(id, iconName, title, desc) {
      return '<button id="' + id + '" class="nav-card" style="text-align:left;"><span class="nav-card-icon">' + ICONS[iconName] + '</span><span class="nav-card-title">' + title + '</span><span class="nav-card-desc">' + desc + '</span></button>';
    }
    document.getElementById("rptLoyers").addEventListener("click", function () {
      var rows = [["Date", "Mois", "Locataire", "Logement", "Montant", "Mode"]];
      payments.forEach(function (p) { var l = leaseById(p.lease_id); var t = l ? tenantById(l.tenant_id) : null; var u = l ? unitById(l.unit_id) : null; rows.push([p.date, p.period, t ? fullName(t) : "", u ? u.numero : "", p.amount, p.method || ""]); });
      downloadCsv("rapport-loyers.csv", rows);
    });
    document.getElementById("rptLogements").addEventListener("click", function () {
      var rows = [["Numéro", "Maison", "Type", "Loyer", "Statut"]];
      units.forEach(function (u) { var p = propertyById(u.property_id); rows.push([u.numero, p ? p.nom : "", u.type || "", u.rent, u.statut]); });
      downloadCsv("rapport-logements.csv", rows);
    });
    document.getElementById("rptProprietaires").addEventListener("click", function () {
      var rows = [["Propriétaire", "Maisons", "Logements", "Attendu", "Encaissé", "Impayé"]];
      owners.forEach(function (o) {
        var props = propertiesForOwner(o.id); var us = [].concat.apply([], props.map(function (p) { return unitsForProperty(p.id); }));
        var ls = [].concat.apply([], us.map(function (u) { return leasesForUnit(u.id); })).filter(function (l) { return l.statut === "actif"; });
        var att = 0, enc = 0; ls.forEach(function (l) { var t = leaseTotals(l); att += t.due; enc += t.paid; });
        rows.push([o.nom, props.length, us.length, att, enc, Math.max(0, att - enc)]);
      });
      downloadCsv("rapport-proprietaires.csv", rows);
    });
    document.getElementById("rptLocataires").addEventListener("click", function () {
      var rows = [["Nom", "Téléphone", "Statut", "Total payé"]];
      tenants.forEach(function (t) {
        var ls = leasesForTenant(t.id); var actif = ls.some(function (l) { return l.statut === "actif"; });
        var totalPaid = ls.reduce(function (s, l) { return s + leaseTotalPaid(l.id); }, 0);
        rows.push([fullName(t), t.telephone || "", actif ? "Actif" : "Sorti", totalPaid]);
      });
      downloadCsv("rapport-locataires.csv", rows);
    });
  }

  // ============ HISTORIQUE ============
  function renderHistoriquePage() {
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Historique</h2><p class="subtitle" style="margin:0;">Historique des opérations effectuées dans l\'application</p></div></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th></tr></thead><tbody>' +
        (activity.length ? activity.map(function (a) { return '<tr><td>' + fmtDateTime(a.created_at) + '</td><td>' + escapeHtml(a.user_email || "—") + '</td><td>' + escapeHtml(a.action.replace(/_/g, " ")) + '</td></tr>'; }).join("") : '<tr><td colspan="3" class="empty">Aucune opération enregistrée.</td></tr>') +
      '</tbody></table></div></div>';
  }

  // ============ UTILISATEURS ============
  var userModal = document.getElementById("userModal");
  function renderUsersPage() {
    CONTENT.innerHTML =
      '<a href="#/" class="back-link">← Retour</a>' +
      '<div class="page-head"><div><h2>Utilisateurs</h2><p class="subtitle" style="margin:0;">Comptes ayant accès à l\'application</p></div>' +
      '<button class="primary" id="btnNewUser">+ Nouvel utilisateur</button></div>' +
      '<div class="card"><div class="table-scroll"><table><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th></th></tr></thead><tbody id="usersBody"></tbody></table></div></div>';
    draw();
    function draw() {
      document.getElementById("usersBody").innerHTML = users.map(function (u) {
        var isSelf = auth.user.id === u.id;
        return '<tr><td>' + escapeHtml((u.nom || "") + (u.prenom ? " " + u.prenom : "") || "—") + '</td><td>' + escapeHtml(u.email) + (isSelf ? " (toi)" : "") + '</td><td>' + roleLabel(u.role) + '</td><td>' + (u.statut === "inactif" ? '<span class="badge neutral">Inactif</span>' : '<span class="badge ok">Actif</span>') + '</td>' +
          '<td class="row-actions"><button class="small" data-edituser="' + u.id + '">Modifier</button><button class="small danger ghost" data-deluser="' + u.id + '"' + (users.length <= 1 ? " disabled" : "") + '>Suppr.</button></td></tr>';
      }).join("");
      CONTENT.querySelectorAll("[data-edituser]").forEach(function (b) { b.addEventListener("click", function () { openUserModal(b.getAttribute("data-edituser")); }); });
      CONTENT.querySelectorAll("[data-deluser]").forEach(function (b) {
        b.addEventListener("click", async function () {
          var id = b.getAttribute("data-deluser");
          if (!confirm("Supprimer cet utilisateur ?")) return;
          try { await api("/api/users/" + id, { method: "DELETE" }); users = users.filter(function (x) { return x.id !== id; }); draw(); }
          catch (e) { showBanner(e.message); }
        });
      });
    }
    document.getElementById("btnNewUser").addEventListener("click", function () { openUserModal(null); });
  }
  function openUserModal(id) {
    var u = id ? users.find(function (x) { return x.id === id; }) : null;
    document.getElementById("userModalTitle").textContent = u ? "Modifier l'utilisateur" : "Nouvel utilisateur";
    document.getElementById("userId").value = u ? u.id : "";
    document.getElementById("userNom").value = u ? (u.nom || "") : "";
    document.getElementById("userPrenom").value = u ? (u.prenom || "") : "";
    document.getElementById("userTelephone").value = u ? (u.telephone || "") : "";
    document.getElementById("userUsername").value = u ? (u.username || "") : "";
    document.getElementById("userEmail").value = u ? u.email : "";
    document.getElementById("userEmail").disabled = !!u;
    document.getElementById("userPassword").value = "";
    document.getElementById("userPasswordLabel").textContent = u ? "Nouveau mot de passe (laisser vide pour ne pas changer)" : "Mot de passe (6 caractères min.) *";
    document.getElementById("userRole").value = u ? u.role : "gestionnaire";
    document.getElementById("userStatut").value = u ? u.statut : "actif";
    userModal.hidden = false;
  }
  document.getElementById("userCancel").addEventListener("click", function () { userModal.hidden = true; });
  userModal.addEventListener("click", function (e) { if (e.target === userModal) userModal.hidden = true; });
  document.getElementById("userSave").addEventListener("click", async function () {
    var id = document.getElementById("userId").value;
    var email = document.getElementById("userEmail").value.trim();
    var password = document.getElementById("userPassword").value;
    if (!id && !email) { alert("L'email est obligatoire."); return; }
    if (!id && (!password || password.length < 6)) { alert("Le mot de passe doit faire au moins 6 caractères."); return; }
    var body = { nom: document.getElementById("userNom").value.trim(), prenom: document.getElementById("userPrenom").value.trim(),
      telephone: document.getElementById("userTelephone").value.trim(), username: document.getElementById("userUsername").value.trim(),
      role: document.getElementById("userRole").value, statut: document.getElementById("userStatut").value };
    if (!id) { body.email = email; body.password = password; }
    else if (password) body.password = password;
    var btn = document.getElementById("userSave"); btn.disabled = true;
    try {
      if (id) { var updated = await api("/api/users/" + id, { method: "PUT", body: body }); var i = users.findIndex(function (x) { return x.id === id; }); users[i] = updated; }
      else { users.push(await api("/api/users", { method: "POST", body: body })); }
      userModal.hidden = true; route();
    } catch (e) { showBanner(e.message); } finally { btn.disabled = false; }
  });

  // ---------------- Boot ----------------
  async function boot() {
    if (auth && auth.token) {
      try { var res = await api("/api/auth/me"); auth.user = res.user; saveAuth(auth); showApp(); loadData(); return; }
      catch (e) { /* fall through to login */ }
    }
    showLogin();
  }
  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
