const PAGE_SIZE = 25;

const state = { page: 1, total: 0 };

const rowsEl   = document.getElementById('rows');
const emptyEl  = document.getElementById('empty');
const totalEl  = document.getElementById('total-count');
const pageEl   = document.getElementById('page-label');

function currentFilters() {
  const f = {};
  const verified = document.getElementById('f-verified').value;
  const docType  = document.getElementById('f-doc-type').value;
  const country  = document.getElementById('f-country').value.trim();
  const dateFrom = document.getElementById('f-date-from').value;
  const dateTo   = document.getElementById('f-date-to').value;
  const q        = document.getElementById('f-q').value.trim();

  if (verified) f.verified  = verified;
  if (docType)  f.doc_type  = docType;
  // Only a resolved 2-letter code is a valid filter value — ignore partial
  // text the admin typed but never picked from the country dropdown.
  if (country && country.length === 2) f.country = country.toUpperCase();
  if (dateFrom) f.date_from = dateFrom;
  if (dateTo)   f.date_to   = dateTo;
  if (q)        f.q         = q;
  return f;
}

attachCountryAutocomplete(document.getElementById('f-country'));

// Name/user search typeahead — as the admin types, show matching people
// from the same search the "Filter" button already uses, and let a click
// jump straight to that verification's detail page.
attachAutocomplete(document.getElementById('f-q'), {
  minChars: 2,
  debounceMs: 200,
  fetchItems: async (q) => {
    const params = new URLSearchParams({ page: '1', page_size: '8', q });
    try {
      const resp = await adminFetch(`/verifications?${params}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.items || [];
    } catch (_) {
      return [];
    }
  },
  renderItem: (row, q) => {
    const extracted = (row.extracted_id_data && row.extracted_id_data[0]) || {};
    const name = extracted.full_name || row.user_ref || 'Unknown';
    const meta = [row.country, (row.doc_type || '').replace(/_/g, ' '), fmtDate(row.created_at)].filter(Boolean).join(' · ');
    return `<span class="ac-item-main">${highlightMatch(name, q)}</span><span class="ac-item-sub">${escapeHtml(meta)}</span>`;
  },
  onSelect: (row) => { location.href = `detail?id=${row.id}`; },
});

function renderSkeletonRows(count = 8) {
  const cols = 6;
  rowsEl.innerHTML = Array.from({ length: count }, () => `
    <tr class="skel-row">
      ${Array.from({ length: cols }, () => `<td><span class="skel skel-text medium"></span></td>`).join('')}
    </tr>
  `).join('');
}

async function loadPage(page = 1) {
  state.page = page;
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...currentFilters(),
  });

  renderSkeletonRows();
  emptyEl.style.display = 'none';
  totalEl.innerHTML = `<span class="skel skel-text short" style="height:0.85em"></span>`;

  let data;
  try {
    const resp = await adminFetch(`/verifications?${params}`);
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      totalEl.textContent = body.detail || `Error ${resp.status}`;
      return;
    }
    data = await resp.json();
  } catch (_) {
    return; // adminFetch already redirected to login on 401
  }

  state.total = data.total || 0;
  totalEl.textContent = `${state.total} verification${state.total === 1 ? '' : 's'}`;
  pageEl.textContent = `Page ${page} of ${Math.max(1, Math.ceil(state.total / PAGE_SIZE))}`;

  rowsEl.innerHTML = '';

  if (!data.items || data.items.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  for (const row of data.items) {
    const extracted = (row.extracted_id_data && row.extracted_id_data[0]) || {};
    const name = extracted.full_name || '—';
    const badgeClass = verdictBadgeClass(row.verified, row.overall_verdict);
    const badgeText  = (row.overall_verdict || (row.verified ? 'verified' : 'pending')).replace(/_/g, ' ');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(fmtDate(row.created_at))}</td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(row.country || '—')}</td>
      <td>${escapeHtml((row.doc_type || '—').replace(/_/g, ' '))}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span></td>
      <td>${fmtPct(row.confidence_score)}</td>
    `;
    tr.addEventListener('click', () => { location.href = `detail?id=${row.id}`; });
    rowsEl.appendChild(tr);
  }
}

document.getElementById('apply-btn').addEventListener('click', () => loadPage(1));
document.getElementById('prev-btn').addEventListener('click', () => {
  if (state.page > 1) loadPage(state.page - 1);
});
document.getElementById('next-btn').addEventListener('click', () => {
  if (state.page * PAGE_SIZE < state.total) loadPage(state.page + 1);
});
document.getElementById('logout-btn').addEventListener('click', async () => {
  await adminFetch('/logout', { method: 'POST' }).catch(() => {});
  location.href = 'login';
});

loadPage(1);
