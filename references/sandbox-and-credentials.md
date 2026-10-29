# 沙盒、金鑰與正式環境驗收

## 沙盒不用申請，是共用帳號

官方「沙盒環境串接資源」頁（docs.shoplinepayments.com/overview/sandboxResource/）列出一批**多人共用**的沙盒帳號
與同一組登入密碼。到 `login.shoplinepayments.com` 登入後：

- 設定 → 開發者管理 → **金鑰管理**：API Key（`sk_`）、Client Key（`pk_`）。
- 設定 → 開發者管理 → **Webhook 管理**：新增自己的 Webhook，取得 Sign Key。
- 列表裡有別人建的金鑰與 Webhook（名稱像 `dfdd`、`ktv`…），**不要動**；自己新增一把 API Key（可隨時刪）。
- 不要放任何真實資料；不要改共用密碼。
- `merchantId` 要用**你登入的那個帳號**對應的編號（官方頁的對照表）。

## 金鑰欄位最容易搞錯

金鑰管理表格有四欄：**ID、Key 名稱、類型、Key**。
- **ID 欄不是金鑰**（長長一串數字）。真正的值要點「Key」欄右邊的眼睛圖示顯示，`sk_…` 才是 API Key。
- 類型要選 **API Key**，不是 Client Key（`pk_`，給前端 SDK）。
- 複製時用複製按鈕，不要手選，避免截斷或多一個空白。

## 錯誤 2005 Access Denied

`{"code":"2005","msg":"Access Denied"}`：apiKey 與 merchantId 不是同一組，或環境不符。檢查：
1. 複製到的是 ID 欄而不是 Key 欄。
2. merchantId 屬於另一個帳號。
3. 沙盒金鑰打正式網址（或相反）。
4. 值前後有空白或引號。

## 沒有副作用的金鑰檢查

```bash
# 不存在的 sessionId：金鑰正確回 400 + code 1016（查無資料）；金鑰錯回 2005。不會建立任何交易。
node scripts/credential-probe.mjs production
```

## 沙盒測試規則（官方，以台幣金額為準）

- 金額是 **3 的倍數** → 進 3D 驗證模擬頁（可選成功／失敗）。例：NT$90、300。
- 其他金額：去掉末兩位 00 後，奇數成功、偶數失敗。例：101、501 成功；400、201 失敗。
- 測試卡（有效期限 03/30）：Visa、MasterCard、JCB，卡號見官方沙盒頁。
- LINE Pay／街口／ATM：沙盒跳模擬頁，可選成功／失敗／取消。

## 我們實際怎麼驗收

沙盒的共用帳號設定耗時，最後直接用**正式環境**驗收：
1. 先用 `credential-probe` 確認金鑰有效；2. 建單確認 302 到 `pay.shoplinepayments.com`（還沒扣款）；
3. 自己用真卡付最小金額（我們是 NT$90，信用卡與 Apple Pay 各一次）；4. 確認入帳、寄信、授權；
5. 到後台**手動退款**。上線前把「測試用訂單」與「正式訂單」分環境（`environment` 欄位），並把測試付款退掉。
