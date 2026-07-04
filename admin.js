// Shared helpers for the admin dashboard — plain fetch/DOM, no framework,
// same convention as production/web/scripts/liveness.js.

const ADMIN_API = '/api/v1/admin';

async function adminFetch(path, opts = {}) {
  const resp = await fetch(ADMIN_API + path, { credentials: 'same-origin', ...opts });
  if (resp.status === 401) {
    if (!location.pathname.endsWith('/admin/login')) {
      location.href = 'login';
    }
    throw new Error('not authenticated');
  }
  return resp;
}

function verdictBadgeClass(verified, verdict) {
  if (verified === true) return 'green';
  if (verified === false) return 'red';
  const v = (verdict || '').toLowerCase();
  if (v.includes('weak') || v.includes('warn')) return 'amber';
  return 'gray';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch (_) {
    return iso;
  }
}

function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
