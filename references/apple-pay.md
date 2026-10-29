# Apple Pay 學到的事

## 症狀

付款頁只有 Apple Pay 一個選項（你的 `allowPaymentMethodList` 只放 `ApplePay`），按「Pay NT$xx」後出現紅色提示：

> Your payment cannot be processed at the moment. Please try again or use another payment method.

## 診斷（先確認不是你的程式）

1. `sessions/query` 該筆 session：`status` 仍是 `CREATED`，`paymentDetails` 為空 →
   **沒有任何付款嘗試被建立**，失敗發生在付款頁的 Apple Pay 步驟，不是你的建單資料。
2. 商家後台 → 商品 → 付款方式管理 → Apple Pay 顯示「已啟用」，**不代表可以收款**。

## 根因（我們的案例）

- 導轉式（SHOPLINE 託管付款頁）使用的是 SHOPLINE 自己的網域 `pay.shoplinepayments.com`。
  後台「設定 → 域名設定」裡，這個網域是在**第一次 Apple Pay 嘗試時才自動新增並驗證**
  （我們看到建立後約 1 分鐘出現「已驗證的付款方式：Apple Pay」）。
- 第一次嘗試剛好發生在驗證完成前 → 失敗。**約 1 分鐘後重建訂單再試，成功。**
- 域名設定裡自己的網域（沒有已驗證付款方式）**不影響**導轉式付款，不需要為它驗證，
  也不需要在自己的網站放驗證檔。

> 官方「Apple Pay 申請」說明（faq.shoplinepayments.com/faq/applepaySetting/）寫的是：啟用 Apple Pay、
> 審核通過、並在「域名設定」新增 Apple Pay 網域驗證，兩者都完成才算設定完成。它沒有說明導轉式是否需要
> 自己的網域。如果你的情況不同（例如自行內嵌 SDK，網域是你的），請依官方步驟為你的網域驗證。

## 顧客端條件（官方）

- 蘋果裝置、最新的 iOS／macOS、登入 iCloud、錢包裡有支援的卡。
- 不支援銀聯卡與中國大陸發行的卡；不支援信用卡分期；Apple Pay 交易 5 分鐘未完成會被取消。
- 桌機用 **Safari**；App 內開付款頁時指定用 Safari 開啟，Apple Pay 最穩定。

## 實作建議

- 同時提供信用卡與 Apple Pay 兩個入口，Apple Pay 出問題不影響收款。
- 上線前先自己用真卡付一筆 Apple Pay 驗收；第一次失敗就等 1–2 分鐘再試，不要馬上懷疑程式。
- 導轉用 302，不要把付款頁放進 iframe；`ApplePay` 不能帶 `paymentMethodOptions`。
- 想暫時關閉 Apple Pay：用環境變數（例如 `APPLE_PAY_ENABLED=false`）讓你的 `/config` 不再回報此付款方式，
  不必改程式。
- 沙盒 Apple Pay 測試用官方提供的共用沙盒 Apple ID（密碼在官方「沙盒環境串接資源」頁），
  錢包加入 Apple 官方測試卡；規則與信用卡相同（金額規則見 sandbox 文件）。
