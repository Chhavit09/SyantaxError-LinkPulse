"""Admin-only API. A takedown is a single UPDATE; the redirect route reads the
status on every request (no cache), so the very next visit is blocked."""
from __future__ import annotations

import sqlite3

from flask import Blueprint, abort, g, jsonify, request

from .db import get_db, now, transaction
from .security import admin_required
from .validation import normalize_url

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


def _json() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _disable(db, link_ids: list[int], reason: str) -> int:
    if not link_ids:
        return 0
    marks = ",".join("?" * len(link_ids))
    return db.execute(f"""UPDATE links SET status = 'disabled', flagged = 0, disabled_reason = ?,
                          disabled_by = ?, disabled_at = ?, updated_at = ?
                          WHERE id IN ({marks}) AND status != 'disabled'""",
                      (reason, g.user["id"], now(), now(), *link_ids)).rowcount


@bp.post("/links/<int:link_id>/disable")
@admin_required
def disable_link(link_id: int):
    reason = str(_json().get("reason", "")).strip()[:200] or "Violates platform policy"
    db = get_db()
    if not db.execute("SELECT 1 FROM links WHERE id = ?", (link_id,)).fetchone():
        abort(404)
    with transaction(db):
        _disable(db, [link_id], reason)
    return jsonify(ok=True)


@bp.post("/links/<int:link_id>/enable")
@admin_required
def enable_link(link_id: int):
    db = get_db()
    with transaction(db):
        n = db.execute("""UPDATE links SET status = 'active', flagged = 0, disabled_reason = NULL,
                          disabled_by = NULL, disabled_at = NULL, updated_at = ? WHERE id = ?""",
                       (now(), link_id)).rowcount
    if not n:
        abort(404)
    return jsonify(ok=True)


@bp.post("/links/<int:link_id>/dismiss-flag")
@admin_required
def dismiss_flag(link_id: int):
    n = get_db().execute("UPDATE links SET flagged = 0, updated_at = ? WHERE id = ?", (now(), link_id)).rowcount
    if not n:
        abort(404)
    return jsonify(ok=True)


# ------------------------------------------------------------------ blocklist
@bp.get("/blocklist")
@admin_required
def blocklist():
    rows = get_db().execute("""SELECT b.id, b.domain, b.reason, b.created_at, u.email AS added_by
                               FROM blocklist b LEFT JOIN users u ON u.id = b.added_by
                               ORDER BY b.created_at DESC""").fetchall()
    return jsonify(domains=[dict(r) for r in rows])


@bp.post("/blocklist")
@admin_required
def add_blocked_domain():
    data = _json()
    raw = str(data.get("domain", "")).strip().lower()
    _, host, errors, _ = normalize_url(raw if "://" in raw else "https://" + raw)
    if errors or not host:
        return jsonify(error="domain", message="Enter a domain like example.com."), 422
    host = host[4:] if host.startswith("www.") else host
    db = get_db()
    disabled = 0
    try:
        with transaction(db):
            db.execute("INSERT INTO blocklist (domain, reason, added_by, created_at) VALUES (?, ?, ?, ?)",
                       (host, str(data.get("reason", ""))[:200], g.user["id"], now()))
            if data.get("disable_existing"):
                ids = []
                for r in db.execute("SELECT id, destination FROM links WHERE status != 'disabled'"):
                    _, h, _, _ = normalize_url(r["destination"])
                    if h and (h == host or h.endswith("." + host)):
                        ids.append(r["id"])
                disabled = _disable(db, ids, f"Domain {host} is blocklisted")
    except sqlite3.IntegrityError:
        return jsonify(error="duplicate", message=f"{host} is already blocklisted."), 422
    return jsonify(ok=True, domain=host, links_disabled=disabled), 201


@bp.delete("/blocklist/<int:entry_id>")
@admin_required
def remove_blocked_domain(entry_id: int):
    if not get_db().execute("DELETE FROM blocklist WHERE id = ?", (entry_id,)).rowcount:
        abort(404)
    return jsonify(ok=True)


# ---------------------------------------------------------------------- users
@bp.get("/users")
@admin_required
def users():
    rows = get_db().execute("""SELECT u.id, u.email, u.role, u.created_at, COUNT(l.id) AS links
                               FROM users u LEFT JOIN links l ON l.user_id = u.id
                               GROUP BY u.id ORDER BY u.created_at""").fetchall()
    return jsonify(users=[dict(r) for r in rows])


@bp.post("/users/<int:user_id>/role")
@admin_required
def set_role(user_id: int):
    role = _json().get("role")
    if role not in ("user", "admin"):
        return jsonify(error="role", message="Role must be user or admin."), 422
    db = get_db()
    with transaction(db):
        if role == "user":
            admins = db.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != ?", (user_id,)).fetchone()[0]
            if admins == 0:
                return jsonify(error="last_admin", message="The platform needs at least one admin."), 422
        n = db.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id)).rowcount
    if not n:
        abort(404)
    return jsonify(ok=True)
