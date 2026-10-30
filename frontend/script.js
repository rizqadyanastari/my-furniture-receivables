'use strict';

const BUCKETS = ['Belum Jatuh Tempo', '1-30 Hari', '31-60 Hari', '61-90 Hari', '>90 Hari'];
const BUCKET_COLORS = ['#89a17f', '#d2ad69', '#d98d61', '#c96e59', '#ad4d47'];
const state = { customers: [], invoices: [], aging: { customers: [], totals: {} } };
const money = value => `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
const dateText = value => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Permintaan gagal. Silakan coba kembali.');
  return data;
}

let toastTimer;
function notify(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3400);
}

function setTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tab}`));
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  const labels = { dashboard: 'Dashboard', customers: 'Customer', invoices: 'Invoice', payments: 'Pembayaran', aging: 'Aging Schedule' };
  document.querySelector('#page-title').textContent = labels[tab];
  document.querySelector('#page-crumb').textContent = labels[tab];
  if (tab === 'dashboard') drawChart();
}

document.querySelectorAll('.nav-link').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.go)));
document.querySelector('#today-label').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

async function refreshAll() {
  try {
    const [summary, customers, invoices, aging] = await Promise.all([
      api('/api/summary'), api('/api/customers'), api('/api/invoices'), api('/api/aging')
    ]);
    state.customers = customers;
    state.invoices = invoices;
    state.aging = aging;
    renderSummary(summary);
    renderCustomers();
    renderInvoices();
    renderAging();
    populateSelects();
    renderAttention();
    drawChart();
  } catch (error) {
    notify(error.message, true);
  }
}

function renderSummary(summary) {
  document.querySelector('#summary-receivables').textContent = money(summary.total_receivables);
  document.querySelector('#summary-due').textContent = money(summary.total_due);
  document.querySelector('#summary-customers').textContent = new Intl.NumberFormat('id-ID').format(summary.customers_with_receivables);
}

function renderCustomers() {
  document.querySelector('#customer-count').textContent = `${state.customers.length} customer terdaftar`;
  const body = document.querySelector('#customer-table');
  body.innerHTML = state.customers.length ? state.customers.map(customer => `
    <tr><td class="customer-name">${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.phone || '-')}</td>
    <td class="muted-cell">${escapeHtml(customer.address || '-')}</td><td>${money(customer.credit_limit)}</td></tr>`).join('') :
    '<tr><td colspan="4" class="empty-state">Belum ada customer.</td></tr>';
}

function statusBadge(status) {
  const styles = { Unpaid: 'status-unpaid', Partial: 'status-partial', Paid: 'status-paid' };
  const labels = { Unpaid: 'Belum Bayar', Partial: 'Sebagian', Paid: 'Lunas' };
  return `<span class="status ${styles[status] || ''}">${labels[status] || escapeHtml(status)}</span>`;
}

function renderInvoices() {
  const query = document.querySelector('#invoice-search').value.toLowerCase();
  const rows = state.invoices.filter(invoice => `${invoice.invoice_no} ${invoice.customer_name}`.toLowerCase().includes(query));
  const body = document.querySelector('#invoice-table');
  body.innerHTML = rows.length ? rows.map(invoice => `
    <tr><td class="customer-name">${escapeHtml(invoice.invoice_no)}</td><td>${escapeHtml(invoice.customer_name)}</td>
    <td>${dateText(invoice.invoice_date)}</td><td>${dateText(invoice.due_date)}</td><td>${money(invoice.total_amount)}</td>
    <td>${money(invoice.outstanding)}</td><td>${statusBadge(invoice.status)}</td>
    <td><button class="text-button" data-detail="${escapeHtml(invoice.id)}">Detail</button></td></tr>`).join('') :
    '<tr><td colspan="8" class="empty-state">Belum ada invoice yang cocok.</td></tr>';
}

function renderAging() {
  const body = document.querySelector('#aging-table');
  const customers = state.aging.customers || [];
  body.innerHTML = customers.length ? customers.map(customer => `
    <tr><td class="customer-name">${escapeHtml(customer.customer_name)}</td>
    ${BUCKETS.map(bucket => `<td>${money(customer.buckets[bucket])}</td>`).join('')}
    <td><strong>${money(customer.buckets.Total)}</strong></td></tr>`).join('') :
    '<tr><td colspan="7" class="empty-state">Belum ada piutang outstanding.</td></tr>';
  document.querySelector('#aging-total').innerHTML = `<tr><td>Total Piutang</td>${BUCKETS.map(bucket => `<td>${money(state.aging.totals?.[bucket])}</td>`).join('')}<td>${money(state.aging.totals?.Total)}</td></tr>`;
}

function populateSelects() {
  const customerSelect = document.querySelector('#invoice-customer');
  const selectedCustomer = customerSelect.value;
  customerSelect.innerHTML = '<option value="">Pilih customer</option>' + state.customers.map(customer =>
    `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`).join('');
  customerSelect.value = selectedCustomer;
  const paymentSelect = document.querySelector('#payment-invoice');
  const selectedInvoice = paymentSelect.value;
  const outstandingInvoices = state.invoices.filter(invoice => Number(invoice.outstanding) > 0);
  paymentSelect.innerHTML = '<option value="">Pilih invoice</option>' + outstandingInvoices.map(invoice =>
    `<option value="${escapeHtml(invoice.id)}">${escapeHtml(invoice.invoice_no)} · ${escapeHtml(invoice.customer_name)} · ${money(invoice.outstanding)}</option>`).join('');
  paymentSelect.value = selectedInvoice;
  updatePaymentBalance();
}

function renderAttention() {
  const overdue = state.invoices.filter(invoice => Number(invoice.outstanding) > 0 && new Date(`${invoice.due_date}T00:00:00`) < new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).slice(0, 4);
  const container = document.querySelector('#attention-list');
  container.innerHTML = overdue.length ? overdue.map(invoice => {
    const days = Math.floor((Date.now() - new Date(`${invoice.due_date}T00:00:00`).getTime()) / 86400000);
    return `<div class="attention-row"><div><div class="attention-name">${escapeHtml(invoice.customer_name)}</div><div class="attention-meta">${escapeHtml(invoice.invoice_no)} · ${days} hari terlambat</div></div><span class="attention-amount">${money(invoice.outstanding)}</span></div>`;
  }).join('') : '<div class="empty-state">Tidak ada invoice jatuh tempo. Bagus!</div>';
}

function drawChart() {
  const canvas = document.querySelector('#aging-chart');
  if (!canvas || !document.querySelector('#tab-dashboard').classList.contains('active')) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const width = rect.width;
  const height = rect.height;
  const values = BUCKETS.map(bucket => Number(state.aging.totals?.[bucket] || 0));
  const max = Math.max(...values, 1);
  const left = 38, right = 10, top = 14, bottom = 35;
  const chartHeight = height - top - bottom;
  const chartWidth = width - left - right;
  ctx.font = '9px "DM Sans", sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const y = top + chartHeight * i / 3;
    ctx.strokeStyle = '#f0ece7'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
    ctx.fillStyle = '#a69c92';
    const labelValue = max * (1 - i / 3);
    ctx.fillText(labelValue >= 1000000 ? `${(labelValue / 1000000).toFixed(0)}jt` : `${Math.round(labelValue / 1000)}rb`, left - 7, y + 3);
  }
  const groupWidth = chartWidth / BUCKETS.length;
  const barWidth = Math.min(37, groupWidth * .48);
  BUCKETS.forEach((bucket, index) => {
    const barHeight = values[index] / max * chartHeight;
    const x = left + groupWidth * index + (groupWidth - barWidth) / 2;
    const y = top + chartHeight - barHeight;
    ctx.fillStyle = BUCKET_COLORS[index];
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barWidth, Math.max(barHeight, 2), [4, 4, 0, 0]);
    else ctx.rect(x, y, barWidth, Math.max(barHeight, 2));
    ctx.fill();
    ctx.fillStyle = '#8f857b';ctx.textAlign = 'center';
    ctx.fillText(['Belum jatuh', '1–30 hari', '31–60 hari', '61–90 hari', '>90 hari'][index], x + barWidth / 2, height - 12);
  });
  document.querySelector('#chart-legend').innerHTML = BUCKETS.map((bucket, index) =>
    `<span class="legend-item"><i class="legend-dot" style="background:${BUCKET_COLORS[index]}"></i>${bucket}</span>`).join('');
}

document.querySelector('#customer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    await api('/api/customers', { method: 'POST', body: JSON.stringify({ ...values, credit_limit: Number(values.credit_limit) }) });
    form.reset(); form.elements.credit_limit.value = 0;
    notify('Customer berhasil ditambahkan.');
    await refreshAll();
  } catch (error) { notify(error.message, true); }
});

const itemsContainer = document.querySelector('#invoice-items');
function addItemRow() {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `<label>Nama produk<input class="product-name" required placeholder="Contoh: Sofa minimalis"></label>
    <label>Qty<input class="item-qty" type="number" min="1" step="1" value="1" required></label>
    <label>Harga satuan<input class="item-price" type="number" min="0" step="1000" required placeholder="0"></label>
    <div><span class="item-subtotal">Rp 0</span></div>
    <button class="remove-item" type="button" aria-label="Hapus item">×</button>`;
  row.querySelectorAll('input').forEach(input => input.addEventListener('input', updateInvoiceTotal));
  row.querySelector('.remove-item').addEventListener('click', () => {
    if (itemsContainer.children.length > 1) row.remove();
    else { row.querySelector('.product-name').value = ''; row.querySelector('.item-price').value = ''; }
    updateInvoiceTotal();
  });
  itemsContainer.append(row);
}

function updateInvoiceTotal() {
  let total = 0;
  itemsContainer.querySelectorAll('.item-row').forEach(row => {
    const qty = Number(row.querySelector('.item-qty').value) || 0;
    const price = Number(row.querySelector('.item-price').value) || 0;
    const subtotal = qty * price;
    row.querySelector('.item-subtotal').textContent = money(subtotal);
    total += subtotal;
  });
  document.querySelector('#invoice-total').textContent = money(total);
}
document.querySelector('#add-item').addEventListener('click', addItemRow);
addItemRow();

document.querySelector('#invoice-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const items = [...itemsContainer.querySelectorAll('.item-row')].map(row => ({
    product_name: row.querySelector('.product-name').value.trim(),
    qty: Number(row.querySelector('.item-qty').value),
    unit_price: Number(row.querySelector('.item-price').value)
  }));
  try {
    await api('/api/invoices', { method: 'POST', body: JSON.stringify({ ...values, items }) });
    form.reset();
    itemsContainer.innerHTML = '';
    addItemRow();
    setDateDefaults();
    notify('Invoice berhasil disimpan.');
    await refreshAll();
  } catch (error) { notify(error.message, true); }
});

document.querySelector('#invoice-search').addEventListener('input', renderInvoices);
document.querySelector('#invoice-table').addEventListener('click', async event => {
  const button = event.target.closest('[data-detail]');
  if (!button) return;
  try {
    const invoice = await api(`/api/invoices/${encodeURIComponent(button.dataset.detail)}`);
    showInvoiceDetail(invoice);
  } catch (error) { notify(error.message, true); }
});

function showInvoiceDetail(invoice) {
  document.querySelector('#detail-title').textContent = invoice.invoice_no;
  const items = invoice.items.map(item => `<div class="detail-list-row"><span>${escapeHtml(item.product_name)} × ${item.qty}</span><span>${money(item.subtotal)}</span></div>`).join('');
  const payments = invoice.payments.length ? invoice.payments.map(payment =>
    `<div class="detail-list-row"><span>${dateText(payment.payment_date)} · ${escapeHtml(payment.method)}${payment.note ? ` · ${escapeHtml(payment.note)}` : ''}</span><span>${money(payment.amount)}</span></div>`).join('') :
    '<div class="detail-list-row"><span>Belum ada pembayaran</span><span>—</span></div>';
  document.querySelector('#detail-content').innerHTML = `
    <div class="detail-meta"><div><small>Customer</small><strong>${escapeHtml(invoice.customer_name)}</strong></div>
    <div><small>Tanggal invoice</small><strong>${dateText(invoice.invoice_date)}</strong></div>
    <div><small>Jatuh tempo</small><strong>${dateText(invoice.due_date)}</strong></div></div>
    <div class="detail-list">${items}<div class="detail-list-row"><strong>Total invoice</strong><strong>${money(invoice.total_amount)}</strong></div></div>
    <h3 class="dialog-section-title">Riwayat Pembayaran</h3><div class="detail-list">${payments}</div>`;
  document.querySelector('#detail-dialog').showModal();
}
document.querySelector('#close-dialog').addEventListener('click', () => document.querySelector('#detail-dialog').close());
document.querySelector('#detail-dialog').addEventListener('click', event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});

function updatePaymentBalance() {
  const invoice = state.invoices.find(row => String(row.id) === document.querySelector('#payment-invoice').value);
  document.querySelector('#payment-balance').textContent = invoice ? `Sisa piutang: ${money(invoice.outstanding)} · ${invoice.invoice_no}` : 'Pilih invoice untuk melihat sisa piutang.';
  const amountInput = document.querySelector('#payment-form [name="amount"]');
  if (invoice) amountInput.max = invoice.outstanding;
  else amountInput.removeAttribute('max');
}
document.querySelector('#payment-invoice').addEventListener('change', updatePaymentBalance);
document.querySelector('#payment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await api('/api/payments', { method: 'POST', body: JSON.stringify({ ...values, amount: Number(values.amount) }) });
    event.currentTarget.reset();
    setDateDefaults();
    notify('Pembayaran berhasil dicatat.');
    await refreshAll();
  } catch (error) { notify(error.message, true); }
});

function setDateDefaults() {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.querySelectorAll('input[type="date"]').forEach(input => { if (!input.value) input.value = date; });
  const due = document.querySelector('#invoice-form [name="due_date"]');
  if (!due.value) {
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);
    due.value = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
  }
}

window.addEventListener('resize', drawChart);
setDateDefaults();
refreshAll();
