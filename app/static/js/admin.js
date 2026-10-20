(() => {
  const { h, api, fmt } = LP;
  const $ = (id) => document.getElementById(id);
  const empty = (cols, text) => h("tr", {}, h("td", { colspan: cols, class: "text-secondary p-4", text }));
  const linkCell = (l) => h("td", {}, h("a", { href: `/links/${l.id}`, class: "text-decoration-none" }, h("span", { class: "code", text: `/${l.code}` })),
    l.title ? h("div", { class: "small text-secondary", text: l.title }) : null);
  const destCell = (l) => h("td", {}, h("div", { class: "lp-dest", title: l.destination, text: l.destination }));
  const btn = (label, cls, fn) => h("button", { class: `btn btn-sm ${cls}`, type: "button", onclick: fn }, label);

  async function disable(l) {
    const reason = window.prompt(`Disable /${l.code}? Reason shown to the owner:`, "Phishing or malware");
    if (reason === null) return;
    const { ok } = await api("POST", `/api/admin/links/${l.id}/disable`, { reason });
    if (ok) { LP.toast(`/${l.code} disabled. Redirects stopped.`); refresh(); }
  }
  async function enable(l) {
    const { ok } = await api("POST", `/api/admin/links/${l.id}/enable`);
    if (ok) { LP.toast(`/${l.code} restored.`); refresh(); }
  }
  async function dismiss(l) {
    const { ok } = await api("POST", `/api/admin/links/${l.id}/dismiss-flag`);
    if (ok) { LP.toast("Marked as safe."); refresh(); }
  }

  async function loadReview() {
    const { ok, data } = await api("GET", "/api/links?scope=all&flagged=1");
    if (!ok) return;
    $("flag-count").textContent = data.links.length || "";
    const body = $("review");
    body.replaceChildren(...(data.links.length ? data.links.map((l) => h("tr", {}, linkCell(l), destCell(l),
      h("td", { class: "small", text: `${Math.round((l.risk_score || 0) * 100)}% risk. ${l.risk_reasons || ""}` }),
      h("td", { class: "small", text: l.owner_email }),
      h("td", { class: "text-nowrap" }, btn("Disable", "btn-danger me-1", () => disable(l)), btn("Mark safe", "btn-outline-primary", () => dismiss(l)))))
      : [empty(5, "Nothing to review. Links the URL checker rates as high risk appear here.")]));
  }

  async function loadAll() {
    const q = $("q").value.trim();
    const { ok, data } = await api("GET", `/api/links?scope=all${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    if (!ok) return;
    $("all").replaceChildren(...(data.links.length ? data.links.map((l) => h("tr", {}, linkCell(l), destCell(l),
      h("td", { class: "small", text: l.owner_email }), h("td", {}, LP.status(l.effective_status)),
      h("td", { class: "lp-num", text: fmt.num(l.human_clicks) }),
      h("td", {}, l.status === "disabled" ? btn("Restore", "btn-outline-primary", () => enable(l)) : btn("Disable", "btn-outline-danger", () => disable(l)))))
      : [empty(6, "No links match.")]));
  }

  async function loadBlocklist() {
    const { ok, data } = await api("GET", "/api/admin/blocklist");
    if (!ok) return;
    $("blocklist").replaceChildren(...(data.domains.length ? data.domains.map((d) => h("tr", {},
      h("td", {}, h("span", { class: "code", text: d.domain })), h("td", { class: "small", text: d.reason }),
      h("td", { class: "small", text: d.added_by || "" }), h("td", { class: "small", text: fmt.day(d.created_at) }),
      h("td", {}, btn("Remove", "btn-outline-danger", async () => {
        if (!confirm(`Allow links to ${d.domain} again? Links that were disabled stay disabled.`)) return;
        if ((await api("DELETE", `/api/admin/blocklist/${d.id}`)).ok) loadBlocklist();
      }))))
      : [empty(5, "No blocked domains.")]));
  }

  async function loadUsers() {
    const { ok, data } = await api("GET", "/api/admin/users");
    if (!ok) return;
    $("users").replaceChildren(...data.users.map((u) => h("tr", {},
      h("td", { text: u.email }), h("td", { text: u.role === "admin" ? "Admin" : "User" }),
      h("td", { class: "lp-num", text: fmt.num(u.links) }), h("td", { class: "small", text: fmt.day(u.created_at) }),
      h("td", {}, btn(u.role === "admin" ? "Make user" : "Make admin", "btn-outline-primary", async () => {
        const { ok: done, data: d } = await api("POST", `/api/admin/users/${u.id}/role`, { role: u.role === "admin" ? "user" : "admin" });
        if (done) loadUsers(); else if (d.message) LP.toast(d.message, "danger");
      })))));
  }

  $("block-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("block-error").replaceChildren();
    const { ok, data } = await api("POST", "/api/admin/blocklist", { domain: $("domain").value, reason: $("reason").value,
      disable_existing: $("disable-existing").checked });
    if (!ok) { $("block-error").append(h("div", { class: "lp-issue error", text: data.message })); return; }
    LP.toast(`${data.domain} blocked. ${data.links_disabled} existing links disabled.`);
    e.target.reset();
    $("disable-existing").checked = true;
    refresh();
  });
  $("q").addEventListener("input", LP.debounce(loadAll, 300));

  function refresh() { loadReview(); loadAll(); loadBlocklist(); }
  refresh();
  loadUsers();
})();
