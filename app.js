/* Powerstyle-0rder — client-side restock ordering tool.
   Catalog, the active order draft, and order history all live in Firebase
   Firestore, so every device sees the same data in real time (with offline
   support baked in). See firebase-config.js + README.md for setup. */

import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, enableIndexedDbPersistence,
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch,
  serverTimestamp, addDoc, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* ---------------- Firebase setup ---------------- */

let db = null, auth = null, isFirebaseConfigured = true;
let productsColRef, activeOrderRef, historyColRef, metaRef;

function firebaseLooksConfigured() {
  return firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');
}

let PRODUCTS = [];
let ORDER = { items: {}, supplierName: '' };
let HISTORY = [];
let ACTIVE_CATEGORY = 'ALL';
let html5QrCode = null;
let lastPdfBlob = null;
let lastPdfFilename = null;
let productsLoadedOnce = false;
let orderWriteTimer = null;
let suppressNextOrderEcho = false;
let logoDataUrl = null;

async function preloadLogo() {
  try {
    const res = await fetch('assets/logo.jpg');
    const blob = await res.blob();
    logoDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) { /* PDF still works without the logo */ }
}

/* ---------------- Bootstrapping ---------------- */

async function init() {
  bindNav();
  bindOrderUI();
  bindCatalogUI();
  bindScanUI();
  bindShareUI();
  preloadLogo();

  if (!firebaseLooksConfigured()) {
    isFirebaseConfigured = false;
    setSyncStatus('offline-config');
    toast('Firebase isn\u2019t configured yet \u2014 see firebase-config.js and README.md');
    // Fall back to the bundled starter catalog so the UI still works locally.
    const res = await fetch('data/products.json');
    PRODUCTS = await res.json();
    renderCategoryChips();
    renderProductResults();
    renderOrderLines();
    renderHistory();
    return;
  }

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);

  try { await enableIndexedDbPersistence(db); } catch (e) { /* multiple tabs open, or unsupported browser — fine */ }

  productsColRef = collection(db, 'products');
  activeOrderRef = doc(db, 'state', 'activeOrder');
  metaRef = doc(db, 'state', 'meta');
  historyColRef = collection(db, 'orderHistory');

  setSyncStatus('connecting');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      setSyncStatus('online');
      startListeners();
    }
  });
  signInAnonymously(auth).catch((err) => {
    console.error(err);
    setSyncStatus('error');
    toast('Could not sign in to Firebase \u2014 check your project settings');
  });

  window.addEventListener('online', () => setSyncStatus('online'));
  window.addEventListener('offline', () => setSyncStatus('offline'));
}

function startListeners() {
  // Products catalog — real time across every device.
  onSnapshot(productsColRef, async (snap) => {
    if (snap.empty && !productsLoadedOnce) {
      productsLoadedOnce = true;
      await seedCatalog();
      return;
    }
    productsLoadedOnce = true;
    PRODUCTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    PRODUCTS.sort((a, b) => a.name.localeCompare(b.name));
    renderCategoryChips();
    renderProductResults();
    renderOrderLines();
    if (document.getElementById('tab-catalog').classList.contains('is-active')) renderCatalogList();
  }, (err) => {
    console.error(err);
    setSyncStatus('error');
  });

  // Active shared order draft — lets you start on one device and continue on another.
  onSnapshot(activeOrderRef, (snap) => {
    if (suppressNextOrderEcho) { suppressNextOrderEcho = false; return; }
    const data = snap.exists() ? snap.data() : { items: {}, supplierName: '' };
    ORDER = { items: data.items || {}, supplierName: data.supplierName || '' };
    const supplierInput = document.getElementById('supplierName');
    if (document.activeElement !== supplierInput) supplierInput.value = ORDER.supplierName;
    renderOrderLines();
  }, (err) => console.error(err));

  // Order history.
  const q = query(historyColRef, orderBy('date', 'desc'), limit(100));
  onSnapshot(q, (snap) => {
    HISTORY = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistory();
  }, (err) => console.error(err));
}

async function seedCatalog() {
  const res = await fetch('data/products.json');
  const starter = await res.json();
  const batch = writeBatch(db);
  starter.forEach(p => {
    batch.set(doc(productsColRef, p.id), {
      sku: p.sku || '', name: p.name, category: p.category,
      barcode: p.barcode || '', unitsPerBox: p.unitsPerBox || 1, variations: p.variations || []
    });
  });
  await batch.commit();
}

function setSyncStatus(state) {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  dot.className = 'sync-dot sync-' + state;
  const labels = {
    connecting: 'Connecting\u2026',
    online: 'Synced',
    offline: 'Offline \u2014 will sync later',
    error: 'Sync error',
    'offline-config': 'Not connected (setup needed)'
  };
  text.textContent = labels[state] || state;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('is-show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('is-show'), 2600);
}

/* ---------------- Navigation ---------------- */

function bindNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('is-active');
      if (btn.dataset.tab === 'catalog') renderCatalogList();
      if (btn.dataset.tab === 'history') renderHistory();
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
  });
  document.getElementById('closeScanBtn').addEventListener('click', () => closeModal(document.getElementById('scanModal')));
  document.getElementById('closeEditBtn').addEventListener('click', () => closeModal(document.getElementById('editModal')));
  document.getElementById('closeShareBtn').addEventListener('click', () => closeModal(document.getElementById('shareModal')));
}

function openModal(modal) { modal.classList.add('is-open'); }
function closeModal(modal) {
  modal.classList.remove('is-open');
  if (modal.id === 'scanModal') stopScanner();
}

/* ---------------- Order tab: search + results ---------------- */

function bindOrderUI() {
  document.getElementById('searchInput').addEventListener('input', renderProductResults);
  document.getElementById('supplierName').addEventListener('input', (e) => {
    ORDER.supplierName = e.target.value;
    scheduleOrderWrite();
  });
  document.getElementById('clearOrderBtn').addEventListener('click', () => {
    if (!Object.keys(ORDER.items).length) return;
    if (confirm('Clear the current order on every device? This cannot be undone.')) {
      ORDER.items = {};
      writeOrderNow();
      renderOrderLines();
    }
  });
  document.getElementById('downloadPdfBtn').addEventListener('click', () => generatePdf({ download: true }));
  document.getElementById('shareBtn').addEventListener('click', () => {
    if (!Object.keys(ORDER.items).length) { toast('Add at least one item first'); return; }
    generatePdf({ download: false });
    refreshShareLinks();
    openModal(document.getElementById('shareModal'));
  });
}

function renderCategoryChips() {
  const cats = ['ALL', ...Array.from(new Set(PRODUCTS.map(p => p.category))).sort()];
  const wrap = document.getElementById('categoryChips');
  wrap.innerHTML = '';
  cats.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (cat === ACTIVE_CATEGORY ? ' is-active' : '');
    chip.textContent = cat === 'ALL' ? 'All categories' : cat;
    chip.addEventListener('click', () => { ACTIVE_CATEGORY = cat; renderCategoryChips(); renderProductResults(); });
    wrap.appendChild(chip);
  });
}

function renderProductResults() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const wrap = document.getElementById('productResults');
  let list = PRODUCTS;
  if (ACTIVE_CATEGORY !== 'ALL') list = list.filter(p => p.category === ACTIVE_CATEGORY);
  if (q) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }
  list = list.slice(0, 150);

  if (!list.length) {
    wrap.innerHTML = PRODUCTS.length ? '<div class="no-results">No products match that search.</div>' : '<div class="no-results">Loading catalog\u2026</div>';
    return;
  }

  wrap.innerHTML = '';
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'product-row';
    const unitsLabel = p.variations && p.variations.length ? `${p.variations.length} variations` : `${p.unitsPerBox} pcs / box`;
    row.innerHTML = `
      <div>
        <div class="pr-name">${escapeHtml(p.name)}</div>
        <div class="pr-meta">${escapeHtml(p.category)} &middot; ${unitsLabel}${p.sku ? ' &middot; SKU ' + escapeHtml(p.sku) : ''}</div>
      </div>
      <button class="pr-add" aria-label="Add to order">+</button>
    `;
    row.addEventListener('click', () => addProductToOrder(p.id));
    wrap.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Order lines ---------------- */

function findProduct(id) { return PRODUCTS.find(p => p.id === id); }

function scheduleOrderWrite() {
  clearTimeout(orderWriteTimer);
  orderWriteTimer = setTimeout(writeOrderNow, 450);
}

function writeOrderNow() {
  clearTimeout(orderWriteTimer);
  if (!isFirebaseConfigured) return;
  suppressNextOrderEcho = true;
  setDoc(activeOrderRef, { items: ORDER.items, supplierName: ORDER.supplierName || '', updatedAt: serverTimestamp() })
    .catch((e) => { console.error(e); suppressNextOrderEcho = false; });
}

function addProductToOrder(productId) {
  const product = findProduct(productId);
  if (!product) return;
  if (!ORDER.items[productId]) ORDER.items[productId] = { boxes: 0, variationBoxes: {} };
  if (!product.variations || !product.variations.length) {
    ORDER.items[productId].boxes = (ORDER.items[productId].boxes || 0) + 1;
  }
  writeOrderNow();
  renderOrderLines();
  toast(`${product.name} added`);
}

function removeFromOrder(productId) {
  delete ORDER.items[productId];
  writeOrderNow();
  renderOrderLines();
}

/** Remember which input (if any) inside #orderLines currently has focus,
 *  so a re-render (local typing or a remote sync update) doesn't yank
 *  focus/cursor away from someone mid-keystroke. */
function captureFocus(containerId) {
  const el = document.activeElement;
  const container = document.getElementById(containerId);
  if (!el || !container || !container.contains(el)) return null;
  return {
    pid: el.dataset.pid, vid: el.dataset.vid || '',
    start: el.selectionStart, end: el.selectionEnd
  };
}
function restoreFocus(containerId, captured) {
  if (!captured) return;
  const container = document.getElementById(containerId);
  const sel = `.ol-box-input[data-pid="${captured.pid}"]` + (captured.vid ? `[data-vid="${captured.vid}"]` : ':not([data-vid])');
  const el = container.querySelector(sel);
  if (el) {
    el.focus();
    try { el.setSelectionRange(captured.start, captured.end); } catch (e) {}
  }
}

function renderOrderLines() {
  const focus = captureFocus('orderLines');
  const wrap = document.getElementById('orderLines');
  const ids = Object.keys(ORDER.items);
  if (!ids.length) {
    wrap.innerHTML = '<p class="empty-hint">No items yet. Search or scan a product to add it to the order.</p>';
    updateSummary();
    return;
  }

  wrap.innerHTML = '';
  ids.forEach(pid => {
    const product = findProduct(pid);
    if (!product) return;
    const entry = ORDER.items[pid];
    const hasVariations = product.variations && product.variations.length > 0;

    const line = document.createElement('div');
    line.className = 'order-line';

    let totalBoxes = 0, totalPieces = 0;
    if (hasVariations) {
      product.variations.forEach(v => {
        const b = entry.variationBoxes[v.id] || 0;
        totalBoxes += b;
        totalPieces += b * (v.unitsPerBox || product.unitsPerBox || 1);
      });
    } else {
      totalBoxes = entry.boxes || 0;
      totalPieces = totalBoxes * (product.unitsPerBox || 1);
    }

    line.innerHTML = `
      <div class="ol-top">
        <div>
          <div class="ol-name">${escapeHtml(product.name)}</div>
          <div class="ol-cat">${escapeHtml(product.category)}</div>
        </div>
        <button class="ol-remove" data-pid="${pid}">Remove</button>
      </div>
      ${hasVariations ? '' : `
        <div class="ol-qty-row">
          <label>Boxes</label>
          <input type="number" min="0" step="1" class="ol-box-input" data-pid="${pid}" value="${entry.boxes || 0}">
          <span class="ol-piece-readout">${totalPieces} pcs total</span>
        </div>
      `}
      ${hasVariations ? `
        <div class="ol-qty-row">
          <span class="ol-piece-readout">Total: ${totalBoxes} box &middot; ${totalPieces} pcs</span>
        </div>
        <div class="ol-variations">
          ${product.variations.map(v => {
            const b = entry.variationBoxes[v.id] || 0;
            const pcs = b * (v.unitsPerBox || product.unitsPerBox || 1);
            return `
              <div class="ol-variation-row">
                <span class="vname">${escapeHtml(v.name)}</span>
                <label>Boxes</label>
                <input type="number" min="0" step="1" class="ol-box-input" data-pid="${pid}" data-vid="${v.id}" value="${b}">
                <span class="ol-piece-readout">${pcs} pcs</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}
    `;
    wrap.appendChild(line);
  });

  wrap.querySelectorAll('.ol-remove').forEach(btn => btn.addEventListener('click', () => removeFromOrder(btn.dataset.pid)));
  wrap.querySelectorAll('.ol-box-input').forEach(input => {
    input.addEventListener('input', () => {
      const pid = input.dataset.pid;
      const vid = input.dataset.vid;
      const val = Math.max(0, parseInt(input.value || '0', 10) || 0);
      if (vid) ORDER.items[pid].variationBoxes[vid] = val;
      else ORDER.items[pid].boxes = val;
      updateSummary();
      scheduleOrderWrite();
    });
  });

  restoreFocus('orderLines', focus);
  updateSummary();
}

function getOrderTotals() {
  let lines = 0, boxes = 0, pieces = 0;
  const items = [];
  Object.keys(ORDER.items).forEach(pid => {
    const product = findProduct(pid);
    if (!product) return;
    const entry = ORDER.items[pid];
    const hasVariations = product.variations && product.variations.length > 0;
    let lineBoxes = 0, linePieces = 0;
    const variationDetails = [];
    if (hasVariations) {
      product.variations.forEach(v => {
        const b = entry.variationBoxes[v.id] || 0;
        if (b > 0) {
          const pcs = b * (v.unitsPerBox || product.unitsPerBox || 1);
          lineBoxes += b; linePieces += pcs;
          variationDetails.push({ name: v.name, boxes: b, pieces: pcs });
        }
      });
    } else {
      lineBoxes = entry.boxes || 0;
      linePieces = lineBoxes * (product.unitsPerBox || 1);
    }
    if (lineBoxes > 0) {
      lines += 1; boxes += lineBoxes; pieces += linePieces;
      items.push({ product, boxes: lineBoxes, pieces: linePieces, variations: variationDetails });
    }
  });
  return { lines, boxes, pieces, items };
}

function updateSummary() {
  const t = getOrderTotals();
  document.getElementById('sumLines').textContent = t.lines;
  document.getElementById('sumBoxes').textContent = t.boxes;
  document.getElementById('sumPieces').textContent = t.pieces;
}

/* ---------------- Catalog tab ---------------- */

function bindCatalogUI() {
  document.getElementById('catalogSearch').addEventListener('input', renderCatalogList);
  document.getElementById('addProductBtn').addEventListener('click', () => openEditModal(null));
  document.getElementById('exportCatalogBtn').addEventListener('click', exportCatalog);
  document.getElementById('importCatalogBtn').addEventListener('click', () => document.getElementById('importCatalogFile').click());
  document.getElementById('importCatalogFile').addEventListener('change', importCatalog);
}

function exportCatalog() {
  const blob = new Blob([JSON.stringify(PRODUCTS, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `powerstyle-catalog-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importCatalog(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('bad format');
      if (!isFirebaseConfigured) { toast('Connect Firebase first \u2014 see README.md'); return; }
      const batch = writeBatch(db);
      data.forEach(p => {
        batch.set(doc(productsColRef, p.id), {
          sku: p.sku || '', name: p.name, category: p.category || 'UNCATEGORISED',
          barcode: p.barcode || '', unitsPerBox: p.unitsPerBox || 1, variations: p.variations || []
        });
      });
      await batch.commit();
      toast('Catalog imported and synced');
    } catch (err) {
      console.error(err);
      toast('That file doesn\u2019t look like a valid catalog export');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function renderCatalogList() {
  const q = document.getElementById('catalogSearch').value.trim().toLowerCase();
  const wrap = document.getElementById('catalogList');
  let list = PRODUCTS;
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
  list = list.slice(0, 200);
  wrap.innerHTML = '';
  if (!list.length) { wrap.innerHTML = '<div class="empty-state">No products yet. Use "+ Add product" above.</div>'; return; }
  list.forEach(p => {
    const row = document.createElement('div');
    row.className = 'catalog-row';
    row.innerHTML = `
      <div class="cr-info">
        <div class="cr-name">${escapeHtml(p.name)}${p.variations.length ? `<span class="cr-badge">${p.variations.length} variations</span>` : ''}</div>
        <div class="cr-meta">${escapeHtml(p.category)} &middot; ${p.unitsPerBox} pcs / box${p.barcode ? ' &middot; barcode ' + escapeHtml(p.barcode) : ''}</div>
      </div>
      <button class="cr-edit" data-pid="${p.id}">Edit</button>
    `;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('.cr-edit').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.pid)));
}

let editingVariations = [];
let editingPid = null;

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function openEditModal(pid) {
  const isNew = !pid;
  const product = isNew
    ? { id: null, sku: '', name: '', category: '', barcode: '', unitsPerBox: 1, variations: [] }
    : findProduct(pid);
  if (!product) return;
  editingPid = pid;
  editingVariations = (product.variations || []).map(v => ({ ...v }));

  document.getElementById('editModalTitle').textContent = isNew ? 'Add product' : product.name;
  renderEditModalBody(product, isNew);
  openModal(document.getElementById('editModal'));
}

function renderEditModalBody(product, isNew) {
  const body = document.getElementById('editModalBody');
  const categories = Array.from(new Set(PRODUCTS.map(p => p.category))).sort();
  body.innerHTML = `
    ${isNew ? `
      <div class="field-row">
        <label>Product name</label>
        <input type="text" id="editName" placeholder="e.g. TSF Shaving Gel 1000ml" value="${escapeHtml(product.name)}">
      </div>
      <div class="field-row">
        <label>Category</label>
        <input type="text" id="editCategory" list="categoryOptions" placeholder="e.g. SHAVING" value="${escapeHtml(product.category)}">
        <datalist id="categoryOptions">${categories.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
      </div>
      <div class="field-row">
        <label>SKU (optional)</label>
        <input type="text" id="editSku" value="${escapeHtml(product.sku)}">
      </div>
    ` : ''}
    <div class="field-row">
      <label>Units per box (default, used when there are no variations)</label>
      <input type="number" min="1" step="1" id="editUnitsPerBox" value="${product.unitsPerBox}">
    </div>
    <div class="field-row">
      <label>Barcode</label>
      <input type="text" id="editBarcode" placeholder="Scan or type a barcode" value="${escapeHtml(product.barcode || '')}">
    </div>
    <div class="variation-editor">
      <h4>Variations (optional, e.g. colours or scents)</h4>
      <div id="variationList"></div>
      <button class="add-variation-btn" id="addVariationBtn" type="button">+ Add variation</button>
    </div>
    <div class="modal-save-row">
      ${!isNew ? '<button class="btn btn-ghost" id="deleteProductBtn" type="button">Delete product</button>' : ''}
      <button class="btn btn-ghost" id="cancelEditBtn" type="button">Cancel</button>
      <button class="btn btn-primary" id="saveEditBtn" type="button">${isNew ? 'Add product' : 'Save changes'}</button>
    </div>
  `;
  renderVariationList();

  document.getElementById('addVariationBtn').addEventListener('click', () => {
    editingVariations.push({ id: 'v' + Date.now() + Math.floor(Math.random() * 999), name: '', unitsPerBox: product.unitsPerBox });
    renderVariationList();
  });
  document.getElementById('cancelEditBtn').addEventListener('click', () => closeModal(document.getElementById('editModal')));
  document.getElementById('saveEditBtn').addEventListener('click', () => saveEditModal(isNew));
  const delBtn = document.getElementById('deleteProductBtn');
  if (delBtn) delBtn.addEventListener('click', () => deleteProduct(editingPid));
}

function renderVariationList() {
  const wrap = document.getElementById('variationList');
  wrap.innerHTML = '';
  editingVariations.forEach((v, idx) => {
    const row = document.createElement('div');
    row.className = 'variation-item';
    row.innerHTML = `
      <input type="text" placeholder="Variation name (e.g. Sapphire)" value="${escapeHtml(v.name)}" data-idx="${idx}" data-field="name">
      <input type="number" min="1" step="1" class="v-units" placeholder="pcs/box" value="${v.unitsPerBox}" data-idx="${idx}" data-field="unitsPerBox">
      <button class="v-remove" data-idx="${idx}" type="button" aria-label="Remove variation">&times;</button>
    `;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.idx, 10);
      const field = inp.dataset.field;
      editingVariations[idx][field] = field === 'unitsPerBox' ? (parseInt(inp.value, 10) || 1) : inp.value;
    });
  });
  wrap.querySelectorAll('.v-remove').forEach(btn => btn.addEventListener('click', () => { editingVariations.splice(parseInt(btn.dataset.idx, 10), 1); renderVariationList(); }));
}

async function saveEditModal(isNew) {
  if (!isFirebaseConfigured) { toast('Connect Firebase first \u2014 see README.md'); return; }
  const units = Math.max(1, parseInt(document.getElementById('editUnitsPerBox').value, 10) || 1);
  const barcode = document.getElementById('editBarcode').value.trim();
  const variations = editingVariations.filter(v => v.name && v.name.trim())
    .map(v => ({ id: v.id, name: v.name.trim(), unitsPerBox: Math.max(1, v.unitsPerBox || units) }));

  let pid = editingPid;
  let data;
  if (isNew) {
    const name = document.getElementById('editName').value.trim();
    const category = document.getElementById('editCategory').value.trim() || 'UNCATEGORISED';
    const sku = document.getElementById('editSku').value.trim();
    if (!name) { toast('Product name is required'); return; }
    pid = sku ? sku : slugify(name) + '-' + Date.now().toString(36);
    data = { sku, name, category, barcode, unitsPerBox: units, variations };
  } else {
    const product = findProduct(pid);
    data = { sku: product.sku || '', name: product.name, category: product.category, barcode, unitsPerBox: units, variations };
  }

  try {
    await setDoc(doc(productsColRef, pid), data, { merge: false });
    closeModal(document.getElementById('editModal'));
    toast(isNew ? 'Product added' : 'Product updated');
  } catch (e) {
    console.error(e);
    toast('Could not save \u2014 check your connection');
  }
}

async function deleteProduct(pid) {
  if (!confirm('Delete this product from the catalog on every device?')) return;
  try {
    await deleteDoc(doc(productsColRef, pid));
    closeModal(document.getElementById('editModal'));
    toast('Product deleted');
  } catch (e) {
    console.error(e);
    toast('Could not delete \u2014 check your connection');
  }
}

/* ---------------- Barcode scanning ---------------- */

function bindScanUI() {
  document.getElementById('scanBtn').addEventListener('click', startScanner);
}

function startScanner() {
  openModal(document.getElementById('scanModal'));
  const statusEl = document.getElementById('scanStatus');
  statusEl.textContent = 'Starting camera\u2026';

  if (typeof Html5Qrcode === 'undefined') {
    statusEl.textContent = 'Scanner library failed to load. Check your internet connection.';
    return;
  }

  html5QrCode = new Html5Qrcode('scanReader');
  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  html5QrCode.start(
    { facingMode: 'environment' }, config,
    (decodedText) => onScanSuccess(decodedText),
    () => {}
  ).then(() => { statusEl.textContent = 'Point the camera at a product barcode.'; })
   .catch(() => { statusEl.textContent = 'Could not access the camera. Check permissions and try again.'; });
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => html5QrCode.clear()).catch(() => {});
    html5QrCode = null;
  }
}

function onScanSuccess(code) {
  const statusEl = document.getElementById('scanStatus');
  const match = PRODUCTS.find(p => p.barcode && p.barcode === code);
  if (match) {
    stopScanner();
    closeModal(document.getElementById('scanModal'));
    addProductToOrder(match.id);
    document.getElementById('searchInput').value = '';
    renderProductResults();
  } else {
    statusEl.textContent = `No product has barcode "${code}" yet. Assign it from the Catalog tab, or keep scanning.`;
    document.getElementById('searchInput').value = code;
    renderProductResults();
  }
}

/* ---------------- PDF generation ---------------- */

function buildOrderFilename() {
  const stamp = new Date().toISOString().slice(0, 10);
  const supplier = document.getElementById('supplierName').value.trim();
  const suffix = supplier ? '-' + supplier.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : '';
  return `powerstyle-order-${stamp}${suffix}.pdf`;
}

function generatePdf({ download }) {
  const totals = getOrderTotals();
  if (!totals.items.length) { toast('Add at least one item first'); return null; }

  const { jsPDF } = window.jspdf;
  const doc_ = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 48;
  let y = 56;

  // Brand header band
  doc_.setFillColor(27, 24, 21);
  doc_.rect(0, 0, 595, 86, 'F');
  if (logoDataUrl) {
    try { doc_.addImage(logoDataUrl, 'JPEG', marginX, 14, 58, 58); } catch (e) { /* ignore malformed image */ }
  }
  const textX = logoDataUrl ? marginX + 70 : marginX;
  doc_.setTextColor(216, 154, 42);
  doc_.setFont('helvetica', 'bold');
  doc_.setFontSize(17);
  doc_.text('Powerstyle-0rder', textX, 42);
  doc_.setTextColor(230, 222, 204);
  doc_.setFont('helvetica', 'normal');
  doc_.setFontSize(10.5);
  doc_.text('Restock Order', textX, 60);
  doc_.setTextColor(20, 20, 20);
  y = 116;
  doc_.setFontSize(10);
  const supplier = document.getElementById('supplierName').value.trim();
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  doc_.text(`Date: ${dateStr}`, marginX, y);
  if (supplier) doc_.text(`Supplier: ${supplier}`, marginX, y + 14);
  y += supplier ? 32 : 18;

  doc_.setDrawColor(180, 170, 150);
  doc_.line(marginX, y, 595 - marginX, y);
  y += 18;

  doc_.setFont('helvetica', 'bold');
  doc_.setFontSize(11);
  doc_.text('Product', marginX, y);
  doc_.text('Order quantity', 400, y);
  y += 8;
  doc_.setDrawColor(220, 210, 190);
  doc_.line(marginX, y, 595 - marginX, y);
  y += 16;

  doc_.setFont('helvetica', 'normal');
  totals.items.forEach(item => {
    if (y > 760) { doc_.addPage(); y = 56; }
    doc_.setFont('helvetica', 'bold');
    doc_.setFontSize(11);
    const nameLines = doc_.splitTextToSize(item.product.name, 330);
    doc_.text(nameLines, marginX, y);
    doc_.setFont('helvetica', 'normal');
    doc_.text(`${item.boxes} box (${item.pieces} pcs)`, 400, y);
    y += nameLines.length * 14;

    if (item.variations.length) {
      doc_.setFontSize(9.5);
      item.variations.forEach(v => {
        if (y > 770) { doc_.addPage(); y = 56; }
        doc_.setTextColor(90, 85, 75);
        doc_.text(`- ${v.name}`, marginX + 12, y);
        doc_.text(`${v.boxes} box (${v.pieces} pcs)`, 400, y);
        doc_.setTextColor(20, 20, 20);
        y += 13;
      });
      doc_.setFontSize(11);
    }
    y += 8;
  });

  y += 6;
  doc_.setDrawColor(180, 170, 150);
  doc_.line(marginX, y, 595 - marginX, y);
  y += 18;
  doc_.setFont('helvetica', 'bold');
  doc_.setFontSize(11);
  doc_.text(`Total: ${totals.lines} products, ${totals.boxes} boxes, ${totals.pieces} pieces`, marginX, y);

  const filename = buildOrderFilename();
  if (download) doc_.save(filename);
  lastPdfBlob = doc_.output('blob');
  lastPdfFilename = filename;
  return { blob: lastPdfBlob, filename };
}

/* ---------------- Sharing ---------------- */

function bindShareUI() {
  document.getElementById('shareSystemBtn').addEventListener('click', shareViaSystem);
  document.getElementById('shareWhatsappBtn').addEventListener('click', () => saveToHistory());
  document.getElementById('shareEmailBtn').addEventListener('click', () => saveToHistory());
}

function buildOrderTextSummary() {
  const totals = getOrderTotals();
  const supplier = document.getElementById('supplierName').value.trim();
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  let lines = [`Powerstyle-0rder \u2014 Restock Order`, `Date: ${dateStr}`];
  if (supplier) lines.push(`Supplier: ${supplier}`);
  lines.push('');
  totals.items.forEach(item => {
    lines.push(`${item.product.name}: ${item.boxes} box (${item.pieces} pcs)`);
    item.variations.forEach(v => lines.push(`   - ${v.name}: ${v.boxes} box (${v.pieces} pcs)`));
  });
  lines.push('');
  lines.push(`Total: ${totals.lines} products, ${totals.boxes} boxes, ${totals.pieces} pieces`);
  return lines.join('\n');
}

async function shareViaSystem() {
  if (!lastPdfBlob) generatePdf({ download: false });
  if (!lastPdfBlob) return;
  const file = new File([lastPdfBlob], lastPdfFilename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Powerstyle-0rder', text: 'Restock order attached.' });
      saveToHistory();
      closeModal(document.getElementById('shareModal'));
    } catch (e) { /* user cancelled */ }
  } else {
    toast('Your browser can\u2019t attach files to share. Downloading the PDF instead \u2014 attach it manually.');
    generatePdf({ download: true });
  }
}

function refreshShareLinks() {
  const text = encodeURIComponent(buildOrderTextSummary());
  document.getElementById('shareWhatsappBtn').href = `https://wa.me/?text=${text}`;
  document.getElementById('shareEmailBtn').href = `mailto:?subject=${encodeURIComponent('Powerstyle-0rder \u2014 Restock Order')}&body=${text}`;
}

/* ---------------- History ---------------- */

async function saveToHistory() {
  const totals = getOrderTotals();
  if (!totals.items.length || !isFirebaseConfigured) return;
  const supplier = document.getElementById('supplierName').value.trim();
  try {
    await addDoc(historyColRef, {
      date: serverTimestamp(),
      supplier,
      lines: totals.lines, boxes: totals.boxes, pieces: totals.pieces,
      items: totals.items.map(i => ({ name: i.product.name, boxes: i.boxes, pieces: i.pieces, variations: i.variations }))
    });
  } catch (e) { console.error(e); }
}

function renderHistory() {
  const wrap = document.getElementById('historyList');
  if (!isFirebaseConfigured) {
    wrap.innerHTML = '<div class="empty-state">Connect Firebase to start saving order history across devices \u2014 see README.md.</div>';
    return;
  }
  if (!HISTORY.length) {
    wrap.innerHTML = '<div class="empty-state">No orders sent yet. Orders are saved here after you share them.</div>';
    return;
  }
  wrap.innerHTML = '';
  HISTORY.forEach(order => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const when = order.date && order.date.toDate ? order.date.toDate() : new Date();
    const dateStr = when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    card.innerHTML = `
      <div class="hc-top">
        <strong>${order.supplier ? escapeHtml(order.supplier) : 'Order'}</strong>
        <span>${dateStr}</span>
      </div>
      <div class="hc-lines">${order.lines} products &middot; ${order.boxes} boxes &middot; ${order.pieces} pieces</div>
      <div class="hc-actions">
        <button class="btn btn-outline" data-act="reload" data-id="${order.id}">Reload into order</button>
        <button class="btn btn-ghost" data-act="delete" data-id="${order.id}">Delete</button>
      </div>
    `;
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('[data-act="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => { await deleteDoc(doc(historyColRef, btn.dataset.id)); });
  });
  wrap.querySelectorAll('[data-act="reload"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const order = HISTORY.find(o => o.id === btn.dataset.id);
      if (order) reloadOrderFromHistory(order);
    });
  });
}

function reloadOrderFromHistory(order) {
  const newItems = {};
  order.items.forEach(item => {
    const product = PRODUCTS.find(p => p.name === item.name);
    if (!product) return;
    if (item.variations && item.variations.length) {
      const vb = {};
      item.variations.forEach(v => {
        const pv = product.variations.find(x => x.name === v.name);
        if (pv) vb[pv.id] = v.boxes;
      });
      newItems[product.id] = { boxes: 0, variationBoxes: vb };
    } else {
      newItems[product.id] = { boxes: item.boxes, variationBoxes: {} };
    }
  });
  ORDER.items = newItems;
  ORDER.supplierName = order.supplier || '';
  document.getElementById('supplierName').value = ORDER.supplierName;
  writeOrderNow();
  document.querySelector('.tab-btn[data-tab="order"]').click();
  renderOrderLines();
  toast('Order reloaded \u2014 edit and share again');
}

init();
