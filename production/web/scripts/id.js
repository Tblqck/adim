import { getState, saveSelection } from './state.js';

const COUNTRIES   = window.COUNTRIES   || [];
const countryFlag = window.countryFlag || (() => '');

const countryInput    = document.getElementById('country-input');
const countryList     = document.getElementById('country-list');
const selectedTag     = document.getElementById('selected-country-tag');
const selFlag         = document.getElementById('sel-flag');
const selName         = document.getElementById('sel-name');
const clearCountryBtn = document.getElementById('clear-country');
const docTypeCards    = document.querySelectorAll('.doc-type-card');
const beginBtn        = document.getElementById('begin-btn');

let selectedCountry = null;
let selectedDocType = null;
let hoveredIdx      = -1;

function openList()  { countryList.classList.add('is-open'); }
function closeList() { countryList.classList.remove('is-open'); }

function highlight(text, query) {
  if (!query) return escHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escHtml(text);
  return escHtml(text.slice(0, idx))
    + '<mark>' + escHtml(text.slice(idx, idx + query.length)) + '</mark>'
    + escHtml(text.slice(idx + query.length));
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderList(items, query) {
  hoveredIdx = -1;
  countryList.innerHTML = '';
  if (!items.length) {
    countryList.innerHTML = '<li class="country-empty">No countries found</li>';
    return;
  }
  items.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'country-item';
    li.dataset.idx = i;
    li.innerHTML =
      `<span class="ci-flag">${countryFlag(c.code2)}</span>` +
      `<span class="ci-name">${highlight(c.name, query)}</span>` +
      `<span class="ci-code">${c.code3}</span>`;
    li.addEventListener('mousedown', e => { e.preventDefault(); pickCountry(c); });
    countryList.appendChild(li);
  });
}

function filterCountries(q) {
  if (!q) return COUNTRIES;
  const lq = q.toLowerCase();
  return COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(lq) || c.code3.toLowerCase().includes(lq)
  ).slice(0, 50);
}

function pickCountry(c) {
  selectedCountry = c;
  selFlag.textContent  = countryFlag(c.code2);
  selName.textContent  = c.name;
  selectedTag.hidden   = false;
  countryInput.value   = '';
  countryInput.style.display = 'none';
  closeList();
  updateBeginBtn();
}

function clearCountry() {
  selectedCountry            = null;
  selectedTag.hidden         = true;
  countryInput.style.display = '';
  countryInput.value         = '';
  countryInput.focus();
  renderList(COUNTRIES, '');
  openList();
  updateBeginBtn();
}

function moveHover(delta) {
  const items = countryList.querySelectorAll('.country-item');
  if (!items.length) return;
  hoveredIdx = Math.max(0, Math.min(items.length - 1, hoveredIdx + delta));
  items.forEach((el, i) => el.classList.toggle('hovered', i === hoveredIdx));
  items[hoveredIdx]?.scrollIntoView({ block: 'nearest' });
}

function selectHovered() {
  const items = countryList.querySelectorAll('.country-item');
  if (hoveredIdx >= 0 && items[hoveredIdx]) items[hoveredIdx].dispatchEvent(new MouseEvent('mousedown'));
}

function updateBeginBtn() {
  beginBtn.disabled = !(selectedCountry && selectedDocType);
}

function initSelection() {
  countryInput.addEventListener('focus', () => {
    if (selectedCountry) return;
    renderList(filterCountries(countryInput.value.trim()), countryInput.value.trim());
    openList();
  });

  countryInput.addEventListener('input', () => {
    const q = countryInput.value.trim();
    renderList(filterCountries(q), q);
    openList();
  });

  countryInput.addEventListener('keydown', e => {
    if (!countryList.classList.contains('is-open')) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveHover(1); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveHover(-1); }
    if (e.key === 'Enter')      { e.preventDefault(); selectHovered(); }
    if (e.key === 'Escape')     { closeList(); }
  });

  countryInput.addEventListener('blur', () => setTimeout(closeList, 180));
  clearCountryBtn.addEventListener('click', clearCountry);

  docTypeCards.forEach(card => {
    card.addEventListener('click', () => {
      docTypeCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedDocType = card.dataset.type;
      updateBeginBtn();
    });
  });

  beginBtn.addEventListener('click', () => {
    saveSelection({ country: selectedCountry, docType: selectedDocType });
    window.location.href = 'id-capture.html';
  });

  // Restore prior selection if user came back
  const stored = getState();
  if (stored.country) {
    const match = COUNTRIES.find(c => c.code3 === stored.country.code3);
    if (match) pickCountry(match);
  }
  if (stored.docType) {
    const card = document.querySelector(`.doc-type-card[data-type="${stored.docType}"]`);
    if (card) { card.classList.add('selected'); selectedDocType = stored.docType; }
  }
  updateBeginBtn();
}

initSelection();
