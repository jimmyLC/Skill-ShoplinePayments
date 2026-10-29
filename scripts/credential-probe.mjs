// 檢查 SHOPLINE 金鑰是否有效，不建立任何交易。
// 用法：node --env-file=.dev.vars scripts/credential-probe.mjs [sandbox|production]
// 需要環境變數 SHOPLINE_MERCHANT_ID、SHOPLINE_API_KEY（不會被印出）。
const base = process.argv[2] === 'sandbox' ? 'https://api-sandbox.shoplinepayments.com' : 'https://api.shoplinepayments.com';
const requestId = [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
const response = await fetch(`${base}/api/v1/trade/sessions/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', merchantId: process.env.SHOPLINE_MERCHANT_ID, apiKey: process.env.SHOPLINE_API_KEY, requestId },
  body: JSON.stringify({ sessionId: 'se_00000000000000000000000000000' }),
});
const data = await response.json().catch(() => ({}));
if (data.code === '1016') console.log('OK：金鑰有效（查無此 session 是預期結果）');
else if (data.code === '2005') console.log('失敗 2005 Access Denied：apiKey 與 merchantId 不是同一組，或環境不符');
else console.log(`未預期的回應 ${response.status}：`, data);
