// 收款中樞：SHOPLINE 後台只登記這一個 Webhook，依訂單編號前綴轉給各產品 Worker（service binding）。
// wrangler.jsonc：
//   "routes": [{ "pattern": "pay.example.com", "custom_domain": true }],
//   "services": [{ "binding": "SHOP_A", "service": "shop-a-payments" }]
// 並用 `wrangler secret` 設定 SHOPLINE_SIGN_KEY（和產品 Worker 同一把）。
import { verifyWebhookSignature } from './checkout-worker.mjs';
const ROUTES = { A: 'SHOP_A' }; // 訂單編號第一個字 → binding 名稱；每個產品用不同字母

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/shopline/webhook' || request.method !== 'POST') return new Response('not found', { status: 404 });
    const timestamp = request.headers.get('timestamp') ?? '', sign = request.headers.get('sign');
    const raw = await request.text();
    if (raw.length > 65536) return new Response('too large', { status: 413 });
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return new Response('timestamp', { status: 401 });
    if (!env.SHOPLINE_SIGN_KEY || !await verifyWebhookSignature(timestamp, raw, sign, env.SHOPLINE_SIGN_KEY)) return new Response('signature', { status: 401 });
    let data; try { data = JSON.parse(raw)?.data; } catch { return new Response('invalid json', { status: 400 }); }
    // 注意：referenceOrderId 是 SHOPLINE 的 RL… 編號，你的編號在 order.customer.referenceCustomerId。
    const ids = [data?.order?.customer?.referenceCustomerId, data?.referenceOrderId, data?.order?.referenceOrderId].map(v => String(v ?? ''));
    const binding = ids.map(id => ROUTES[id[0]]).find(Boolean);
    if (!binding || !env[binding]) return new Response('OK'); // 不認得：確認收到，不重試
    const forwarded = await env[binding].fetch('https://internal/shopline/webhook',
      { method: 'POST', headers: { 'Content-Type': 'application/json', timestamp, sign }, body: raw }); // 原樣轉送
    return forwarded.ok ? new Response('OK') : new Response('upstream', { status: 502 }); // 502 → SHOPLINE 重送
  },
};
