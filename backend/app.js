'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// Isi dengan URL project dan service role/anon key Supabase Anda.
// Simpan key dengan aman; jangan publikasikan server ini dengan service role key.
const SUPABASE_URL = 'https://kijuzmjndvsuvkerbcnj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_FV4se-KapOp-Lyx_-RVo6A_wAeaiCoi';
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const BUCKETS = ['Belum Jatuh Tempo', '1-30 Hari', '31-60 Hari', '61-90 Hari', '>90 Hari'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new HttpError(413, 'Ukuran permintaan terlalu besar.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'Format JSON tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

async function supabase(table, options = {}) {
  if (SUPABASE_URL.includes('YOUR_PROJECT') || SUPABASE_KEY === 'YOUR_SUPABASE_KEY') {
    throw new HttpError(503, 'Kredensial Supabase belum diisi di backend/app.js.');
  }

  const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.returning ? { Prefer: 'return=representation' } : {}),
      ...(options.headers || {})
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {})
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(502, 'Respons Supabase tidak dapat dibaca.');
    }
  }
  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 409 ? 409 :
      response.status === 401 || response.status === 403 ? 502 : 400;
    throw new HttpError(status, data?.message || data?.hint || 'Permintaan ke Supabase gagal.');
  }
  return data;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, `${label} harus lebih besar dari 0.`);
  return number;
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} wajib diisi.`);
  return value.trim();
}

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${label} harus berupa tanggal yang valid.`);
  }
  return value;
}

async function getAgingRows() {
  return await supabase('v_aging_schedule', {
    query: { select: 'invoice_id,invoice_no,customer_id,customer_name,due_date,outstanding,days_overdue,bucket' }
  }) || [];
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/customers' && req.method === 'GET') {
    return sendJson(res, 200, await supabase('customers', {
      query: { select: '*', order: 'name.asc' }
    }));
  }
  if (pathname === '/api/customers' && req.method === 'POST') {
    const body = await readBody(req);
    const customer = {
      name: requiredText(body.name, 'Nama customer'),
      phone: String(body.phone || '').trim(),
      address: String(body.address || '').trim(),
      credit_limit: Number(body.credit_limit || 0)
    };
    if (!Number.isFinite(customer.credit_limit) || customer.credit_limit < 0) {
      throw new HttpError(400, 'Limit kredit tidak boleh negatif.');
    }
    const rows = await supabase('customers', { method: 'POST', body: customer, returning: true });
    return sendJson(res, 201, rows[0]);
  }
  if (pathname === '/api/invoices' && req.method === 'GET') {
    const [invoices, agingRows] = await Promise.all([
      supabase('invoices', { query: { select: '*,customers(name)', order: 'invoice_date.desc' } }),
      getAgingRows()
    ]);
    const outstanding = new Map(agingRows.map(row => [String(row.invoice_id), Number(row.outstanding)]));
    return sendJson(res, 200, invoices.map(invoice => ({
      ...invoice,
      customer_name: invoice.customers?.name || '',
      outstanding: outstanding.get(String(invoice.id)) || 0
    })));
  }
  if (pathname === '/api/invoices' && req.method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpError(400, 'Invoice harus memiliki minimal satu item.');
    }
    const items = body.items.map(item => {
      const qty = positiveNumber(item.qty, 'Kuantitas');
      if (!Number.isInteger(qty)) throw new HttpError(400, 'Kuantitas harus berupa bilangan bulat.');
      const unitPrice = Number(item.unit_price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new HttpError(400, 'Harga satuan tidak valid.');
      return {
        product_name: requiredText(item.product_name, 'Nama produk'),
        qty,
        unit_price: unitPrice,
        subtotal: qty * unitPrice
      };
    });
    const invoice = {
      invoice_no: requiredText(body.invoice_no, 'Nomor invoice'),
      customer_id: positiveNumber(body.customer_id, 'Customer'),
      invoice_date: validDate(body.invoice_date, 'Tanggal invoice'),
      due_date: validDate(body.due_date, 'Tanggal jatuh tempo'),
      total_amount: items.reduce((total, item) => total + item.subtotal, 0),
      status: 'Unpaid'
    };
    if (invoice.total_amount <= 0) throw new HttpError(400, 'Total invoice harus lebih besar dari 0.');
    const inserted = await supabase('invoices', { method: 'POST', body: invoice, returning: true });
    try {
      await supabase('invoice_items', {
        method: 'POST',
        body: items.map(item => ({ ...item, invoice_id: inserted[0].id }))
      });
    } catch (error) {
      await supabase('invoices', {
        method: 'DELETE',
        query: { id: `eq.${inserted[0].id}` }
      }).catch(cleanupError => console.error('Gagal menghapus invoice parsial:', cleanupError.message));
      throw error;
    }
    return sendJson(res, 201, { ...inserted[0], items });
  }
  const invoiceMatch = pathname.match(/^\/api\/invoices\/([^/]+)$/);
  if (invoiceMatch && req.method === 'GET') {
    const id = decodeURIComponent(invoiceMatch[1]);
    const rows = await supabase('invoices', { query: { select: '*,customers(name)', id: `eq.${id}` } });
    if (!rows.length) throw new HttpError(404, 'Invoice tidak ditemukan.');
    const [items, payments] = await Promise.all([
      supabase('invoice_items', { query: { select: '*', invoice_id: `eq.${id}`, order: 'id.asc' } }),
      supabase('payments', { query: { select: '*', invoice_id: `eq.${id}`, order: 'payment_date.desc' } })
    ]);
    return sendJson(res, 200, {
      ...rows[0],
      customer_name: rows[0].customers?.name || '',
      items,
      payments
    });
  }
  if (pathname === '/api/payments' && req.method === 'POST') {
    const body = await readBody(req);
    const invoiceId = positiveNumber(body.invoice_id, 'Invoice');
    const amount = positiveNumber(body.amount, 'Jumlah pembayaran');
    const invoiceRows = await supabase('invoices', { query: { select: 'id,total_amount', id: `eq.${invoiceId}` } });
    if (!invoiceRows.length) throw new HttpError(404, 'Invoice tidak ditemukan.');
    const payments = await supabase('payments', {
      query: { select: 'amount', invoice_id: `eq.${invoiceId}` }
    });
    const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const total = Number(invoiceRows[0].total_amount);
    const outstanding = total - paid;
    if (amount > outstanding) throw new HttpError(400, 'Pembayaran melebihi sisa piutang.');

    const payment = {
      invoice_id: invoiceId,
      payment_date: validDate(body.payment_date, 'Tanggal pembayaran'),
      amount,
      method: body.method,
      note: String(body.note || '').trim()
    };
    if (!['Cash', 'Transfer'].includes(payment.method)) throw new HttpError(400, 'Metode pembayaran tidak valid.');
    const inserted = await supabase('payments', { method: 'POST', body: payment, returning: true });
    try {
      const newPaid = paid + amount;
      const status = newPaid >= total ? 'Paid' : 'Partial';
      await supabase('invoices', {
        method: 'PATCH',
        query: { id: `eq.${invoiceId}` },
        body: { status }
      });
    } catch (error) {
      await supabase('payments', {
        method: 'DELETE',
        query: { id: `eq.${inserted[0].id}` }
      }).catch(cleanupError => console.error('Gagal menghapus pembayaran parsial:', cleanupError.message));
      throw error;
    }
    return sendJson(res, 201, inserted[0]);
  }
  if (pathname === '/api/aging' && req.method === 'GET') {
    const rows = await getAgingRows();
    const customers = new Map();
    const totals = Object.fromEntries([...BUCKETS, 'Total'].map(bucket => [bucket, 0]));
    for (const row of rows) {
      if (!customers.has(String(row.customer_id))) {
        customers.set(String(row.customer_id), {
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          buckets: Object.fromEntries([...BUCKETS, 'Total'].map(bucket => [bucket, 0]))
        });
      }
      const customer = customers.get(String(row.customer_id));
      const bucket = BUCKETS.includes(row.bucket) ? row.bucket : '>90 Hari';
      customer.buckets[bucket] += Number(row.outstanding);
      customer.buckets.Total += Number(row.outstanding);
      totals[bucket] += Number(row.outstanding);
      totals.Total += Number(row.outstanding);
    }
    return sendJson(res, 200, { customers: [...customers.values()], totals });
  }
  if (pathname === '/api/summary' && req.method === 'GET') {
    const rows = await getAgingRows();
    const totalReceivables = rows.reduce((sum, row) => sum + Number(row.outstanding), 0);
    const dueReceivables = rows
      .filter(row => row.bucket !== 'Belum Jatuh Tempo')
      .reduce((sum, row) => sum + Number(row.outstanding), 0);
    return sendJson(res, 200, {
      total_receivables: totalReceivables,
      total_due: dueReceivables,
      customers_with_receivables: new Set(rows.map(row => String(row.customer_id))).size
    });
  }
  throw new HttpError(404, 'Endpoint tidak ditemukan.');
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(FRONTEND_DIR, requested);
  if (!filePath.startsWith(`${path.resolve(FRONTEND_DIR)}${path.sep}`)) {
    throw new HttpError(403, 'Akses file tidak diizinkan.');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: 'File tidak ditemukan.' });
      return;
    }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET') {
      serveStatic(req, res, url);
    } else {
      throw new HttpError(405, 'Metode tidak diizinkan.');
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { error: error.message || 'Terjadi kesalahan pada server.' });
  }
});

server.listen(PORT, () => {
  console.log(`My Furniture Receivables berjalan di http://localhost:${PORT}`);
});
