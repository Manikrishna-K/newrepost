/* Kartly storefront – single-page app with hash routing, no build step. */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const FREE_SHIPPING_ABOVE = 499, SHIPPING_FEE = 49;
const STATUSES = ['Placed', 'Packed', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled'];

/* ---------- state ---------- */
const safe = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
let user = null, categories = [];
const token = () => safe.get('kt');
const getCart = () => { try { return JSON.parse(safe.get('kc')) || []; } catch { return []; } };
const saveCart = (c) => { safe.set('kc', JSON.stringify(c)); updateCartBadge(); };
const updateCartBadge = () => { $('#cart-count').textContent = getCart().reduce((n, i) => n + i.qty, 0); };

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token()) headers.Authorization = 'Bearer ' + token();
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token()) { safe.del('kt'); user = null; renderAcct(); }
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
const go = (h) => { location.hash = h; };
const stars = (r, n) => `<span class="stars" aria-label="${r} out of 5">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}${n != null ? `<small>(${n})</small>` : ''}</span>`;
const pct = (p) => Math.round(((p.mrp - p.price) / p.mrp) * 100);
const priceHtml = (p) => `<div><span class="price">${inr(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${inr(p.mrp)}</span><span class="off">${pct(p)}% off</span>` : ''}</div>`;
const date = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const showError = (e) => { view.innerHTML = `<div class="panel empty"><h2>Something went wrong</h2><p class="err">${esc(e.message)}</p><a class="btn" href="#/">Back to home</a></div>`; };

/* ---------- shell ---------- */
function renderAcct() {
  $('#acct').innerHTML = user
    ? `<span>Hi, ${esc(user.name.split(' ')[0])}</span><a href="#/orders">Orders</a>${user.role === 'admin' ? '<a href="#/admin">Admin</a>' : ''}<button id="logout">Log out</button>`
    : '<a href="#/login">Log in</a><a href="#/register">Sign up</a>';
  const lo = $('#logout');
  if (lo) lo.onclick = () => { safe.del('kt'); user = null; renderAcct(); go('#/'); toast('Logged out'); };
}
async function boot() {
  updateCartBadge();
  try { categories = await api('/categories'); } catch {}
  $('#search-cat').innerHTML += categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('');
  $('#cats').innerHTML = categories.map((c) => `<a href="#/search?category=${esc(c.slug)}">${esc(c.name)}</a>`).join('');
  if (token()) { try { user = (await api('/auth/me')).user; } catch {} }
  renderAcct();
  route();
}
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  if ($('#search-q').value.trim()) p.set('q', $('#search-q').value.trim());
  if ($('#search-cat').value) p.set('category', $('#search-cat').value);
  go('#/search?' + p);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b) return;
  e.preventDefault();
  addToCart(Number(b.dataset.add), Number(b.dataset.qty || 1));
  if (b.dataset.buy) go('#/cart');
});
function addToCart(id, qty) {
  const cart = getCart(), line = cart.find((i) => i.id === id);
  if (line) line.qty = Math.min(line.qty + qty, 10); else cart.push({ id, qty });
  saveCart(cart); toast('Added to cart');
}

/* ---------- components ---------- */
const card = (p) => `<article class="card">
  <a href="#/product/${p.id}"><img src="/api/img/${p.id}.svg" alt="" loading="lazy"></a>
  <span class="brand">${esc(p.brand)}</span>
  <h3><a href="#/product/${p.id}">${esc(p.title)}</a></h3>
  ${stars(p.rating_avg, p.rating_count)}${priceHtml(p)}
  ${p.stock > 0 ? `<button class="btn sm" data-add="${p.id}">Add to cart</button>` : '<span class="err">Out of stock</span>'}
</article>`;

/* ---------- routes ---------- */
const routes = [
  [/^\/$/, home], [/^\/search$/, search], [/^\/product\/(\d+)$/, product], [/^\/cart$/, cart],
  [/^\/checkout$/, checkout], [/^\/login$/, () => authForm('login')], [/^\/register$/, () => authForm('register')],
  [/^\/orders$/, orders], [/^\/order\/(\d+)$/, orderDetail], [/^\/admin$/, adminView],
];
async function route() {
  const [pathPart, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  for (const [re, fn] of routes) {
    const m = re.exec(pathPart);
    if (m) {
      view.innerHTML = '<p class="muted">Loading…</p>';
      try { await fn(params, ...m.slice(1)); } catch (e) { showError(e); }
      window.scrollTo(0, 0); view.focus({ preventScroll: true });
      return;
    }
  }
  view.innerHTML = '<div class="panel empty"><h2>Page not found</h2><a class="btn" href="#/">Go home</a></div>';
}
window.addEventListener('hashchange', route);

async function home() {
  const [deals, top] = await Promise.all([api('/products?sort=discount&limit=8'), api('/products?sort=rating&limit=8')]);
  view.innerHTML = `
  <section class="hero"><h1>Everything you need, delivered to your door.</h1>
    <p>Electronics, books, fashion, home and more. Free delivery on orders above ${inr(FREE_SHIPPING_ABOVE)}.</p>
    <a class="btn" href="#/search?sort=discount">Shop top deals</a></section>
  <section class="tiles" aria-label="Shop by category">${categories.map((c) => `<a class="tile" style="--h:${c.hue}" href="#/search?category=${esc(c.slug)}"><span>${c.icon}</span>${esc(c.name)}</a>`).join('')}</section>
  <section class="section"><h2>Biggest discounts</h2><div class="grid">${deals.items.map(card).join('')}</div></section>
  <section class="section"><h2>Top rated</h2><div class="grid">${top.items.map(card).join('')}</div></section>`;
}

async function search(params) {
  const q = params.get('q') || '', category = params.get('category') || '', sort = params.get('sort') || 'relevance';
  const min = params.get('min') || '', max = params.get('max') || '', page = params.get('page') || '1';
  const qs = new URLSearchParams({ sort, page }); if (q) qs.set('q', q); if (category) qs.set('category', category); if (min) qs.set('min', min); if (max) qs.set('max', max);
  const r = await api('/products?' + qs);
  const link = (over) => { const p = new URLSearchParams(params); Object.entries(over).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k))); p.delete('page'); return '#/search?' + p; };
  const title = q ? `Results for “${esc(q)}”` : category ? esc((categories.find((c) => c.slug === category) || {}).name || 'Products') : 'All products';
  view.innerHTML = `<div class="layout">
    <aside class="panel filters"><h3>Category</h3>
      <label><a href="${link({ category: '' })}">${category ? '' : '<b>'}All categories${category ? '' : '</b>'}</a></label>
      ${categories.map((c) => `<label><a href="${link({ category: c.slug })}">${c.slug === category ? '<b>' : ''}${esc(c.name)}${c.slug === category ? '</b>' : ''}</a></label>`).join('')}
      <h3 style="margin-top:1rem">Price (₹)</h3>
      <form id="price"><input type="number" min="0" name="min" placeholder="Min" value="${esc(min)}" aria-label="Minimum price"> – <input type="number" min="0" name="max" placeholder="Max" value="${esc(max)}" aria-label="Maximum price">
      <button class="btn sm alt" style="margin-top:.6rem">Apply</button></form></aside>
    <section><div class="toolbar"><div><h2 style="margin:0">${title}</h2><span class="muted">${r.total} item${r.total === 1 ? '' : 's'}</span></div>
      <label>Sort by <select id="sort">${[['relevance', 'Popular'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['rating', 'Rating'], ['discount', 'Discount'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      ${r.items.length ? `<div class="grid">${r.items.map(card).join('')}</div>` : '<div class="panel empty"><h3>No products found</h3><p class="muted">Try a different search or remove filters.</p></div>'}
      ${r.pages > 1 ? `<div class="pager">${Array.from({ length: r.pages }, (_, i) => `<button data-page="${i + 1}" ${r.page === i + 1 ? 'aria-current="true"' : ''}>${i + 1}</button>`).join('')}</div>` : ''}
    </section></div>`;
  $('#sort').onchange = (e) => go(link({ sort: e.target.value }));
  $('#price').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); go(link({ min: f.get('min'), max: f.get('max') })); };
  view.querySelectorAll('[data-page]').forEach((b) => (b.onclick = () => { const p = new URLSearchParams(params); p.set('page', b.dataset.page); go('#/search?' + p); }));
}

async function product(params, id) {
  const p = await api('/products/' + id);
  const maxQty = Math.min(p.stock, 10);
  view.innerHTML = `<div class="panel detail">
    <img src="/api/img/${p.id}.svg" alt="${esc(p.title)}">
    <div><p class="brand"><a href="#/search?category=${esc(p.category_slug)}">${esc(p.category)}</a> · ${esc(p.brand)}</p><h1>${esc(p.title)}</h1>
      ${stars(p.rating_avg, p.rating_count)}<hr style="border:0;border-top:1px solid var(--line);margin:.8rem 0">${priceHtml(p)}
      <p class="muted" style="font-size:.85rem">Inclusive of all taxes</p><h3>About this item</h3><p>${esc(p.description)}</p></div>
    <div class="buybox"><div class="price">${inr(p.price)}</div>
      <div>${p.price >= FREE_SHIPPING_ABOVE ? '<span class="ok">Free delivery</span>' : `Delivery ${inr(SHIPPING_FEE)}`}</div>
      ${p.stock > 0 ? `<div class="${p.stock <= 10 ? 'err' : 'ok'}">${p.stock <= 10 ? `Only ${p.stock} left in stock` : 'In stock'}</div>
        <label>Quantity <select id="qty">${Array.from({ length: maxQty }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></label>
        <button class="btn" id="add">Add to cart</button><button class="btn alt" id="buy">Buy now</button>` : '<div class="err">Currently unavailable</div>'}
    </div></div>
    <section class="panel" style="margin-top:1.2rem"><h2>Customer reviews</h2>
      ${p.reviews.length ? p.reviews.map((r) => `<div class="review">${stars(r.rating)} <b>${esc(r.title)}</b><div class="muted" style="font-size:.85rem">${esc(r.user)} · ${date(r.created_at)}</div><p>${esc(r.body)}</p></div>`).join('') : '<p class="muted">No reviews yet.</p>'}
      <h3 style="margin-top:1rem">Write a review</h3>
      ${user ? `<form id="rf" style="max-width:480px"><div class="field"><label for="rr">Rating</label><select id="rr" name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n} star${n > 1 ? 's' : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="rt">Headline</label><input id="rt" name="title" maxlength="100"></div>
        <div class="field"><label for="rb">Review</label><textarea id="rb" name="body" rows="3" maxlength="1000"></textarea></div>
        <button class="btn alt">Submit review</button><p class="err" id="re"></p></form>` : '<p><a href="#/login">Log in</a> to write a review.</p>'}</section>`;
  const qty = () => Number($('#qty').value);
  if ($('#add')) { $('#add').onclick = () => addToCart(p.id, qty()); $('#buy').onclick = () => { addToCart(p.id, qty()); go('#/cart'); }; }
  if ($('#rf')) $('#rf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api(`/products/${p.id}/reviews`, { method: 'POST', body: Object.fromEntries(f) }); toast('Review saved'); route(); }
    catch (er) { $('#re').textContent = er.message; }
  };
}

async function loadCartLines() {
  const cart = getCart();
  if (!cart.length) return { lines: [], subtotal: 0 };
  const r = await api('/products?limit=50&ids=' + cart.map((i) => i.id).join(','));
  const byId = Object.fromEntries(r.items.map((p) => [p.id, p]));
  const clean = cart.filter((i) => byId[i.id]).map((i) => ({ ...i, qty: Math.min(i.qty, Math.max(byId[i.id].stock, 1)) }));
  if (clean.length !== cart.length) saveCart(clean);
  const lines = clean.map((i) => ({ ...i, p: byId[i.id] }));
  return { lines, subtotal: lines.reduce((s, l) => s + l.p.price * l.qty, 0) };
}
const shippingFor = (sub) => (sub === 0 || sub >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE);
const summary = (sub) => `<div class="sum"><div><span>Items</span><span>${inr(sub)}</span></div><div><span>Delivery</span><span>${shippingFor(sub) ? inr(shippingFor(sub)) : 'Free'}</span></div><div class="tot"><span>Total</span><span>${inr(sub + shippingFor(sub))}</span></div></div>`;

async function cart() {
  const { lines, subtotal } = await loadCartLines();
  if (!lines.length) { view.innerHTML = '<div class="panel empty"><h2>Your cart is empty</h2><p class="muted">Add something you like.</p><a class="btn" href="#/">Start shopping</a></div>'; return; }
  view.innerHTML = `<div class="two"><section class="panel lines"><h1>Shopping cart</h1>${lines.map((l) => `<div class="line">
      <a href="#/product/${l.p.id}"><img src="/api/img/${l.p.id}.svg" alt=""></a>
      <div><a href="#/product/${l.p.id}"><b>${esc(l.p.title)}</b></a>${l.p.stock <= 10 ? `<div class="err" style="font-size:.85rem">Only ${l.p.stock} left</div>` : ''}
        <div><label>Qty <select data-qty="${l.id}">${Array.from({ length: Math.min(l.p.stock, 10) }, (_, i) => `<option ${i + 1 === l.qty ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
        <button class="btn ghost sm" data-rm="${l.id}">Remove</button></div></div><div class="price">${inr(l.p.price * l.qty)}</div></div>`).join('')}</section>
    <aside class="panel"><h2>Order summary</h2>${summary(subtotal)}<a class="btn" style="display:block;margin-top:1rem" href="#/checkout">Proceed to checkout</a></aside></div>`;
  view.querySelectorAll('[data-qty]').forEach((s) => (s.onchange = () => { const c = getCart(); c.find((i) => i.id === Number(s.dataset.qty)).qty = Number(s.value); saveCart(c); cart(); }));
  view.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { saveCart(getCart().filter((i) => i.id !== Number(b.dataset.rm))); cart(); }));
}

async function checkout() {
  if (!user) { toast('Log in to check out'); safe.set('next', '#/checkout'); return go('#/login'); }
  const { lines, subtotal } = await loadCartLines();
  if (!lines.length) return go('#/cart');
  view.innerHTML = `<div class="two"><form class="panel" id="co"><h1>Checkout</h1><h3>Delivery address</h3>
    <div class="field"><label for="n">Full name</label><input id="n" name="name" required value="${esc(user.name)}"></div>
    <div class="row"><div class="field"><label for="ph">Phone (10 digits)</label><input id="ph" name="phone" inputmode="numeric" maxlength="10" required></div>
    <div class="field"><label for="pin">PIN code</label><input id="pin" name="pincode" inputmode="numeric" maxlength="6" required></div></div>
    <div class="field"><label for="ad">Address</label><textarea id="ad" name="address" rows="2" required></textarea></div>
    <div class="field"><label for="ci">City</label><input id="ci" name="city" required></div>
    <h3>Payment</h3>
    <label><input type="radio" name="payment" value="cod" checked> Cash on delivery</label><br>
    <label><input type="radio" name="payment" value="upi"> UPI (demo)</label><br>
    <label><input type="radio" name="payment" value="card"> Credit / debit card (demo)</label>
    <p class="muted" style="font-size:.85rem">No real payment is taken in this demo.</p>
    <button class="btn" id="place">Place order</button><p class="err" id="ce"></p></form>
    <aside class="panel"><h2>Order summary</h2>${lines.map((l) => `<div class="sum"><div><span>${esc(l.p.title)} × ${l.qty}</span><span>${inr(l.p.price * l.qty)}</span></div></div>`).join('')}${summary(subtotal)}</aside></div>`;
  $('#co').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    $('#place').disabled = true;
    try {
      const r = await api('/orders', { method: 'POST', body: { items: lines.map((l) => ({ id: l.id, qty: l.qty })), payment: f.payment, shipping: f } });
      saveCart([]); toast('Order placed!'); go('#/order/' + r.id);
    } catch (er) { $('#ce').textContent = er.message; $('#place').disabled = false; }
  };
}

function authForm(mode) {
  const reg = mode === 'register';
  view.innerHTML = `<form class="panel form" id="af"><h1>${reg ? 'Create account' : 'Log in'}</h1>
    ${reg ? '<div class="field"><label for="an">Your name</label><input id="an" name="name" required autocomplete="name"></div>' : ''}
    <div class="field"><label for="ae">Email</label><input id="ae" name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label for="ap">Password</label><input id="ap" name="password" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}"></div>
    <button class="btn" style="width:100%">${reg ? 'Create account' : 'Log in'}</button><p class="err" id="ae2"></p>
    <p>${reg ? 'Already have an account? <a href="#/login">Log in</a>' : 'New here? <a href="#/register">Create an account</a>'}</p>
    ${reg ? '' : '<p class="muted" style="font-size:.85rem">Demo shopper: demo@kartly.test / demo123<br>Admin: admin@kartly.test / admin123</p>'}</form>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/' + mode, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      safe.set('kt', r.token); user = r.user; renderAcct(); toast('Welcome, ' + user.name.split(' ')[0]);
      const next = safe.get('next'); safe.del('next'); go(next || '#/');
    } catch (er) { $('#ae2').textContent = er.message; }
  };
}

const statusPill = (s) => `<span class="pill">${esc(s)}</span>`;
async function orders() {
  if (!user) { safe.set('next', '#/orders'); return go('#/login'); }
  const list = await api('/orders');
  view.innerHTML = `<h1>Your orders</h1>${list.length ? list.map((o) => `<div class="panel" style="margin-bottom:1rem">
    <div class="toolbar"><div><b>Order #${o.id}</b> · ${date(o.created_at)}</div><div>${statusPill(o.status)} <b>${inr(o.total)}</b> <a href="#/order/${o.id}">Details</a></div></div>
    ${o.items.map((i) => `<div>${esc(i.title)} × ${i.qty}</div>`).join('')}</div>`).join('') : '<div class="panel empty"><p class="muted">You have not placed any orders yet.</p><a class="btn" href="#/">Start shopping</a></div>'}`;
}
async function orderDetail(params, id) {
  if (!user) return go('#/login');
  const o = await api('/orders/' + id), idx = STATUSES.indexOf(o.status);
  view.innerHTML = `<div class="panel"><h1>Order #${o.id}</h1>
    <p class="ok">${o.status === 'Placed' ? 'Thank you! Your order has been placed.' : 'Status: ' + esc(o.status)}</p>
    <p class="muted">Placed on ${date(o.created_at)} · ${o.payment_method.toUpperCase()} · ${esc(o.payment_status)}</p>
    ${o.status !== 'Cancelled' ? `<p>${STATUSES.slice(0, 5).map((s, i) => (i <= idx ? `<b>${s}</b>` : `<span class="muted">${s}</span>`)).join(' → ')}</p>` : ''}
    <div class="two"><div>${o.items.map((i) => `<div class="line" style="display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--line)"><span>${i.product_id ? `<a href="#/product/${i.product_id}">${esc(i.title)}</a>` : esc(i.title)} × ${i.qty}</span><b>${inr(i.price * i.qty)}</b></div>`).join('')}
      <h3 style="margin-top:1rem">Delivering to</h3><p>${esc(o.name)}<br>${esc(o.address)}<br>${esc(o.city)} ${esc(o.pincode)}<br>Phone: ${esc(o.phone)}</p></div>
    <div class="sum"><div><span>Items</span><span>${inr(o.subtotal)}</span></div><div><span>Delivery</span><span>${o.shipping ? inr(o.shipping) : 'Free'}</span></div><div class="tot"><span>Total</span><span>${inr(o.total)}</span></div>
      ${['Placed', 'Packed'].includes(o.status) ? '<button class="btn ghost" id="cancel" style="margin-top:1rem">Cancel order</button>' : ''}</div></div></div>`;
  if ($('#cancel')) $('#cancel').onclick = async () => { if (confirm('Cancel this order?')) { await api(`/orders/${o.id}/cancel`, { method: 'POST' }); toast('Order cancelled'); route(); } };
}

/* ---------- admin ---------- */
async function adminView(params) {
  if (!user || user.role !== 'admin') { view.innerHTML = '<div class="panel empty"><h2>Admins only</h2><a class="btn" href="#/login">Log in as admin</a></div>'; return; }
  const tab = params.get('tab') || 'dashboard';
  const tabs = `<div class="tabs" role="tablist">${['dashboard', 'products', 'orders'].map((t) => `<button role="tab" aria-selected="${t === tab}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`;
  let body = '';
  if (tab === 'dashboard') {
    const s = await api('/admin/stats');
    body = `<div class="stats">${[['Orders', s.orders], ['Revenue', inr(s.revenue)], ['Customers', s.customers], ['Products', s.products]].map(([l, v]) => `<div class="panel stat"><b>${v}</b>${l}</div>`).join('')}</div>
      <div class="panel"><h3>Low stock</h3>${s.lowStock.length ? `<table><tr><th>Product</th><th>Stock</th></tr>${s.lowStock.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.stock}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing running low.</p>'}</div>`;
  } else if (tab === 'products') {
    const r = await api('/products?limit=50&sort=newest');
    body = `<div class="panel" style="margin-bottom:1rem"><h3 id="pf-title">Add product</h3><form id="pf"><input type="hidden" name="id">
      <div class="row"><div class="field"><label>Title</label><input name="title" required></div><div class="field"><label>Brand</label><input name="brand" required></div></div>
      <div class="row"><div class="field"><label>Category</label><select name="category_id">${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>Stock</label><input name="stock" type="number" min="0" value="20" required></div></div>
      <div class="row"><div class="field"><label>Price (₹)</label><input name="price" type="number" min="1" required></div><div class="field"><label>MRP (₹)</label><input name="mrp" type="number" min="1" required></div></div>
      <div class="field"><label>Description</label><textarea name="description" rows="2"></textarea></div>
      <button class="btn alt">Save product</button> <button type="button" class="btn ghost" id="pf-reset">Clear</button> <span class="err" id="pf-err"></span></form></div>
      <div class="panel table-wrap"><table><tr><th>ID</th><th>Title</th><th>Price</th><th>Stock</th><th></th></tr>${r.items.map((p) => `<tr><td>${p.id}</td><td>${esc(p.title)}</td><td>${inr(p.price)}</td><td>${p.stock}</td>
        <td><button class="btn ghost sm" data-edit="${p.id}">Edit</button> <button class="btn ghost sm" data-del="${p.id}">Delete</button></td></tr>`).join('')}</table>${r.pages > 1 ? '<p class="muted">Showing the 50 newest products.</p>' : ''}</div>`;
  } else {
    const list = await api('/admin/orders');
    body = `<div class="panel table-wrap"><table><tr><th>#</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr>${list.map((o) => `<tr><td>${o.id}<br><small class="muted">${date(o.created_at)}</small></td>
      <td>${esc(o.name)}<br><small class="muted">${esc(o.email)}</small></td><td>${o.items.map((i) => `${esc(i.title)} × ${i.qty}`).join('<br>')}</td><td>${inr(o.total)}<br><small class="muted">${esc(o.payment_status)}</small></td>
      <td><select data-status="${o.id}">${STATUSES.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`).join('')}</table></div>`;
  }
  view.innerHTML = `<h1>Admin</h1>${tabs}${body}`;
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go('#/admin?tab=' + b.dataset.tab)));
  view.querySelectorAll('[data-status]').forEach((s) => (s.onchange = async () => { try { await api('/admin/orders/' + s.dataset.status, { method: 'PATCH', body: { status: s.value } }); toast('Status updated'); } catch (e) { toast(e.message); } }));
  if (tab === 'products') {
    const form = $('#pf');
    const clear = () => { form.reset(); form.elements.id.value = ''; $('#pf-title').textContent = 'Add product'; };
    $('#pf-reset').onclick = clear;
    form.onsubmit = async (e) => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(form)); const id = f.id; delete f.id;
      try { await api(id ? '/admin/products/' + id : '/admin/products', { method: id ? 'PUT' : 'POST', body: f }); toast('Product saved'); adminView(params); }
      catch (er) { $('#pf-err').textContent = er.message; }
    };
    view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
      const p = await api('/products/' + b.dataset.edit);
      const f = form.elements; f.id.value = p.id; f.title.value = p.title; f.brand.value = p.brand; f.stock.value = p.stock; f.price.value = p.price; f.mrp.value = p.mrp; f.description.value = p.description;
      f.category_id.value = (categories.find((c) => c.slug === p.category_slug) || {}).id; $('#pf-title').textContent = 'Edit product #' + p.id; form.scrollIntoView({ behavior: 'smooth' });
    }));
    view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('Delete this product?')) { await api('/admin/products/' + b.dataset.del, { method: 'DELETE' }); toast('Deleted'); adminView(params); } }));
  }
}

boot();
