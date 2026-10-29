# 建立結帳交易（sessions/create）— 實際行為

`POST {base}/api/v1/trade/sessions/create`，base：沙盒 `https://api-sandbox.shoplinepayments.com`、
正式 `https://api.shoplinepayments.com`。

## Header

| Header | 說明 |
|---|---|
| `merchantId` / `apiKey` | 商店編號、API Key（`sk_` 開頭，伺服器端專用） |
| `requestId` | 每次請求唯一，**最長 32 字元**。用 16 bytes 隨機轉 32 位十六進位 |
| `idempotentKey` | 選填，最長 32 字元。用訂單編號，重試不會重複建單 |

## 最小可用的 Body（已用正式環境驗證）

```jsonc
{
  "referenceId": "<你的訂單編號，唯一>",
  "language": "zh-TW",                  // 或 "en"
  "amount": { "value": 9000, "currency": "TWD" },   // NT$90 → 9000（×100）
  "expireTime": 60,                     // 分鐘
  "returnUrl": "https://pay.example.com/thanks",
  "mode": "regular",
  "allowPaymentMethodList": ["CreditCard"],         // 或 ["ApplePay"]
  "order": {
    "products": [{ "id": "sku-1", "name": "Product", "quantity": 1,
                   "amount": { "value": 9000, "currency": "TWD" } }],
    "shipping": {                       // 數位商品也必填
      "shippingMethod": "digital", "carrier": "digital",
      "personalInfo": { "firstName": "Customer", "lastName": "Shop", "email": "buyer@example.com" },
      "address": { "countryCode": "TW", "street": "N/A" }
    }
  },
  "customer": {
    "referenceCustomerId": "<也放你的訂單編號>",   // 之後用它對應回訂單（見 SKILL.md 第 1 點）
    "personalInfo": { "firstName": "Customer", "lastName": "Shop", "email": "buyer@example.com" }
  },
  "billing": {
    "personalInfo": { "firstName": "Customer", "lastName": "Shop", "email": "buyer@example.com" },
    "address": { "countryCode": "TW", "street": "N/A" }     // 數位商品也必填
  },
  "client": { "ip": "<顧客 IP，Workers 用 CF-Connecting-IP>" }
}
```

注意：
- `personalInfo.lastName` 必填；`email` 與 `phone` 至少一個。
- `ApplePay`、`LinePay` 不支援 `paymentMethodOptions`。
- 金額永遠由伺服器端決定，不要接受前端傳來的金額。
- 回應的 `sessionUrl` 主機是 `pay.shoplinepayments.com`（沙盒為 `api-sandbox…`）。
  導轉前檢查主機以 `.shoplinepayments.com` 結尾，且 `referenceId`、`sessionId` 合理。
- 導轉用 302。官方建議不要 iframe／`window.open`；直接輸入網址或書籤可能因 `document.referrer` 為空而報錯。
- 建單後把 `sessionId`、`sessionUrl` 存進資料庫；同一張訂單再次開啟結帳連結時直接重用，不要再建 session。

## 查詢

- `POST /api/v1/trade/sessions/query` `{ "sessionId": "se_…" }` → `status`（`CREATED`/`PENDING`/`SUCCEEDED`/`EXPIRED`）與
  `paymentDetails[]`（`tradeOrderId`、`paymentStatus`）。
- `POST /api/v1/trade/payment/get` `{ "tradeOrderId": "…" }` → 見下表。

### payment/get 實際回傳（節錄）

| 欄位 | 內容 |
|---|---|
| `status` | `SUCCEEDED` 表示成功 |
| `sessionId` | 對應的 session，可和你存的比對 |
| `referenceOrderId` | **SHOPLINE 的 `RL…` 編號，不是你的** |
| `order.customer.referenceCustomerId` | 你建單時放的編號 ← 用這個對應 |
| `payment.paidAmount` | `{ value, currency }`，金額在這裡 |
| `payment.paymentMethod` | `CreditCard`／`ApplePay` |

入帳前必須檢查：`status==='SUCCEEDED'`、屬於這張訂單（`sessionId` 或 `referenceCustomerId` 相符）、
`paidAmount.value` 等於應收金額且幣別正確。
