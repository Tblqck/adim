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

// ── Generic autocomplete dropdown ────────────────────────────────────────
// Attaches a searchable dropdown to a text input. Works for both a static
// list (countries) and an async server query (user/name search) — pass
// fetchItems as either a sync filter or an async function.
//
//   attachAutocomplete(input, {
//     fetchItems: (query) => Item[] | Promise<Item[]>,
//     renderItem: (item, query) => htmlString,
//     onSelect:   (item, input) => void,
//     minChars:   1,      // don't query below this length
//     debounceMs: 150,    // only matters for async fetchItems
//   });

function attachAutocomplete(input, opts) {
  const {
    fetchItems,
    renderItem,
    onSelect,
    minChars = 1,
    debounceMs = 150,
  } = opts;

  let wrap = input.closest('.ac-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  const list = document.createElement('ul');
  list.className = 'ac-list';
  wrap.appendChild(list);

  let items = [];
  let activeIdx = -1;
  let debounceTimer = null;
  let requestId = 0;

  function open()  { list.classList.add('is-open'); }
  function close() { list.classList.remove('is-open'); activeIdx = -1; }

  function render(query) {
    if (!items.length) {
      list.innerHTML = '<li class="ac-empty">No matches</li>';
      return;
    }
    list.innerHTML = items.map((item, i) =>
      `<li class="ac-item" data-idx="${i}">${renderItem(item, query)}</li>`
    ).join('');
  }

  function updateActive() {
    [...list.children].forEach((el, i) => el.classList.toggle('active', i === activeIdx));
  }

  async function runQuery(query) {
    const myRequest = ++requestId;
    const result = await fetchItems(query);
    if (myRequest !== requestId) return; // stale response, a newer query superseded it
    items = result || [];
    activeIdx = -1;
    render(query);
    open();
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < minChars) { close(); return; }
    debounceTimer = setTimeout(() => runQuery(q), debounceMs);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q.length >= minChars) runQuery(q);
  });

  input.addEventListener('blur', () => setTimeout(close, 180));

  input.addEventListener('keydown', (e) => {
    if (!list.classList.contains('is-open')) return;
    const n = items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(n - 1, activeIdx + 1); updateActive(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); updateActive(); }
    if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      onSelect(items[activeIdx], input);
      close();
    }
    if (e.key === 'Escape') close();
  });

  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.ac-item');
    if (!li) return;
    e.preventDefault();
    onSelect(items[Number(li.dataset.idx)], input);
    close();
  });
}

// ── Country autocomplete (reuses window.COUNTRIES from /scripts/countries.js) ──
// Keeps the input's visible value as the plain 2-letter code (backward
// compatible with existing filter/query logic that reads input.value
// directly), while data-country-name carries the full name for display.

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>'
    + escapeHtml(text.slice(idx + query.length));
}

function attachCountryAutocomplete(input) {
  const countries = window.COUNTRIES || [];
  const flag = window.countryFlag || (() => '');

  function filterCountries(q) {
    if (!q) return countries.slice(0, 50);
    const lq = q.toLowerCase();
    return countries.filter(c =>
      c.name.toLowerCase().includes(lq) || c.code2.toLowerCase() === lq || c.code3.toLowerCase().includes(lq)
    ).slice(0, 50);
  }

  attachAutocomplete(input, {
    minChars: 0,
    fetchItems: (q) => filterCountries(q),
    renderItem: (c, q) =>
      `<span class="ac-item-flag">${flag(c.code2)}</span>` +
      `<span class="ac-item-main">${highlightMatch(c.name, q)}</span>` +
      `<span class="ac-item-sub">${escapeHtml(c.code2)}</span>`,
    onSelect: (c, el) => {
      el.value = c.code2;
      el.dataset.countryName = c.name;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
}
