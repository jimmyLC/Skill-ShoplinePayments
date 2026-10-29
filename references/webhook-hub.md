# Webhook 與收款中樞

## 在後台建立 Webhook

商家後台 → 設定 → 開發者管理 → Webhook 管理 → 新增 Webhook。

| 欄位 | 填法 |
|---|---|
| 名稱 | 自訂，例如 `my-shop` |
| URL | 輸入框已預填 `https://`，**只貼後面的主機與路徑**（例如 `pay.example.com/shopline/webhook`） |
| 訂閱事件 | 至少 `trade.succeeded`；可全選「付款交易」，多收的事件只回 200、不處理即可 |
| Sign Key | 留空讓系統產生（16–32 位英數字），建立後在列表點眼睛圖示複製 |

- **一個 Webhook 一把 Sign Key；帳號最多 20 個 Webhook。**
- 共用沙盒帳號的 Webhook 列表裡有別人的，不要動；自己新增一個。
- 沙盒收不到通知時，先回後台確認 URL 沒被覆蓋。

## 驗簽

```
payload  = `${timestamp}.${原始 body 字串}`
expected = HMAC-SHA256(key = signKey, payload) → 十六進位小寫
```

- Header：`timestamp`（毫秒）、`sign`、`apiVersion`。
- 用常數時間比對（Workers 可用 `crypto.subtle.verify` 比對 HMAC，不要用 `===`）。
- 時間戳超過 ±5 分鐘拒絕（401）。
- 必須用請求原始字串；先 `JSON.parse` 再 `stringify` 會讓簽章對不上。

## 處理規則

1. 簽章或時間戳錯 → 401。
2. 簽章正確但事件不處理（`trade.failed`、`session.*` 等）→ 200，什麼都不做。
3. `trade.succeeded` → **不直接信 body**：用 `tradeOrderId` 呼叫 `payment/get`，驗證狀態、歸屬、金額，再入帳。
4. 查詢失敗或資料庫暫時錯誤 → 回非 200（例如 502），讓 SHOPLINE 重送。
5. 重送一定會發生：入帳用 `UPDATE … WHERE status='pending'`，只有 `changes===1` 才寄信或發授權。

### 找出對應的訂單

Webhook body 的訂單識別欄位形狀，我們**沒有直接抓到實際 payload**；`payment/get` 的實測形狀見 `checkout.md`。
程式同時嘗試下列欄位，並以 `sessionId` 備援（`scripts/checkout-worker.mjs` 的 `orderCandidates`）：

```
data.order.customer.referenceCustomerId   ← 你放進去的訂單編號（優先）
data.referenceOrderId                      ← 可能是 SHOPLINE 的 RL… 編號
data.order.referenceOrderId
data.sessionId
```

## 為什麼還要「補查」

Webhook 可能延遲、被擋或格式和預期不同。App／前端查詢**待付款**訂單時，Worker 主動呼叫
`sessions/query`：`status==='SUCCEEDED'` 且 `paymentDetails` 內有成功的 `tradeOrderId`，再走同一個
`payment/get` 驗證流程入帳。這是最後一道保險，我們就是靠它讓第一筆測試付款入帳的。

## 收款中樞（多產品共用一個 Webhook）

20 個名額不夠用、或想「一個網域一個 Webhook」時：

- 獨立一個小 Worker 掛在自己的網域（例如 `pay.example.com/shopline/webhook`），後台只登記它。
- 中樞驗簽與時間戳，依**訂單編號前綴**（每個產品不同字母）用 service binding 轉給對應產品的 Worker，
  **原樣轉送 body 與 `timestamp`、`sign`**；產品 Worker 以同一把 Sign Key 再驗一次。
- 不認得的前綴：回 200（確認收到，不重試）。產品端失敗：中樞回 502。
- 取訂單編號時，同樣要看 `order.customer.referenceCustomerId`，不能只看 `referenceOrderId`
  （它是 `RL…`，前綴永遠不是你的）。
- 範例：`scripts/webhook-hub.mjs`。同一網域下的產品共用一把 Sign Key；另一個網域的產品另建自己的 Webhook。
