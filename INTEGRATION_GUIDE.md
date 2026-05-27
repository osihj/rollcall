# Google Calendar 整合完整指南

## 📋 目錄
1. [現有通知程式碼可刪除的部分](#刪除清單)
2. [整合步驟](#整合步驟)
3. [資料庫修改](#資料庫修改)
4. [部署到生產環境](#部署)
5. [常見問題](#常見問題)

---

## ❌ 刪除清單

根據你上傳的 GitHub 檔案列表，以下程式碼 **可以完全移除**：

### 1. **notification-manager.js** ❌
```
你的檔案：notification-manager.js
動作：可以完全刪除或棄用
```
**為什麼？** 這個檔案應該負責 Web Push / FCM 通知，現在 Google Calendar 會處理所有通知。

**刪除步驟：**
```bash
git rm notification-manager.js
git commit -m "Remove notification-manager.js - 通知由 Google Calendar 負責"
```

### 2. **sw.js（Service Worker）** ❌
```
你的檔案：sw.js
動作：可以移除或簡化
```
**為什麼？** Service Worker 主要用於 Web Push 和離線通知，現在用不到。

**刪除步驟：**
```bash
git rm sw.js
git commit -m "Remove Service Worker - 改由 Google Calendar 推播通知"
```

**但保留這些檔案用於其他功能：**
- 離線快取（如果有）→ 保留
- 背景同步（如果有）→ 保留

### 3. **index.html 中的 Service Worker 註冊代碼** ❌
```html
<!-- ❌ 刪除這些行 -->
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

### 4. **manifest.json** ⚠️ （部分移除）
```json
{
  "name": "Rollcall",
  "short_name": "Rollcall",
  
  // ✅ 保留：應用基本資訊
  "start_url": "/",
  "display": "standalone",
  "icons": [...],
  
  // ❌ 移除：通知相關
  "badge": "...",
  "screenshots": [...]  // 如果只用於通知
}
```

### 5. **任何 FCM / Firebase Cloud Messaging 相關代碼** ❌
搜尋並移除：
```javascript
// ❌ 刪除這些
import firebase from 'firebase/app';
import 'firebase/messaging';
const messaging = firebase.messaging();
messaging.onMessage((payload) => { ... });
```

### 6. **Web Push 訂閱相關代碼** ❌
搜尋並移除：
```javascript
// ❌ 刪除這些
async function subscribeToPushNotifications() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe(...);
  await sendSubscriptionToServer(subscription);
}
```

### 7. **通知權限申請** ⚠️ （轉移到 Google Calendar）
```javascript
// ❌ 不再需要在你的應用程式中申請
// Notification.requestPermission().then(permission => { ... });

// ✅ 取而代之：使用者應在 Google Calendar app 中設定通知
```

---

## 🔧 整合步驟

### 步驟 1: 安裝必要的套件

```bash
npm install googleapis dotenv --save

# 檢查是否已安裝
npm list googleapis dotenv
```

**更新 package.json：**
```json
{
  "dependencies": {
    "googleapis": "^118.0.0",
    "dotenv": "^16.3.1"
  }
}
```

---

### 步驟 2: 設定 .env 檔案

**在專案根目錄建立 .env（本機開發）：**
```bash
# Linux / macOS
touch .env

# Windows
type nul > .env
```

**填入內容：**
```
GOOGLE_CALENDAR_ID=tjmfamilyc0@gmail.com
GOOGLE_SERVICE_ACCOUNT_KEY=/Users/yourname/Rollcall-Secrets/service-account.json
NODE_ENV=development
PORT=3000
```

**更新 .gitignore：**
```bash
echo ".env" >> .gitignore
echo "service-account.json" >> .gitignore
```

---

### 步驟 3: 新增 google-calendar-service.js

將 `google-calendar-service.js` 複製到你的專案：
```bash
# 假設你的專案結構
Rollcall/
├── server.js
├── routes/
│   └── events.js
├── services/
│   └── google-calendar-service.js  ← 新增這個
├── package.json
└── .env
```

---

### 步驟 4: 修改事件建立路由

**原始代碼（假設）：**
```javascript
// routes/events.js
app.post('/api/events/create', async (req, res) => {
  // 1. 建立活動
  const event = await db.events.create(eventData);
  
  // 2. 傳送通知（舊）
  await notificationManager.sendPushNotifications(attendees);
  
  res.json({ success: true, event });
});
```

**修改後：**
```javascript
// routes/events.js
const { syncEventToGoogleCalendar } = require('../services/google-calendar-service');

app.post('/api/events/create', async (req, res) => {
  // 1. 建立活動
  const event = await db.events.create(eventData);
  
  // 2. 同步到 Google Calendar（新）
  const googleSync = await syncEventToGoogleCalendar({
    title: event.title,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location
  });
  
  // 3. 儲存 Google Event ID（如果同步成功）
  if (googleSync.success) {
    await db.events.update(event.id, {
      googleEventId: googleSync.googleEventId
    });
  }
  
  // ❌ 刪除舊的通知代碼：
  // await notificationManager.sendPushNotifications(attendees);
  
  res.json({ success: true, event, googleSync });
});
```

---

## 📊 資料庫修改

### 新增欄位用於追蹤 Google Calendar 同步

**MongoDB 範例：**
```javascript
// 在你的 events collection 中新增欄位
db.events.updateMany(
  {},
  {
    $set: {
      googleEventId: null,      // 存放 Google Calendar Event ID
      googleSynced: false,       // 是否已同步
      googleSyncError: null,     // 同步錯誤訊息
      lastSyncAt: null           // 最後同步時間
    }
  }
);
```

**Mongoose Schema 範例：**
```javascript
const eventSchema = new Schema({
  title: String,
  startTime: Date,
  endTime: Date,
  
  // 新增 Google Calendar 相關欄位
  googleEventId: {
    type: String,
    default: null
  },
  googleSynced: {
    type: Boolean,
    default: false
  },
  googleSyncError: {
    type: String,
    default: null
  },
  lastSyncAt: {
    type: Date,
    default: null
  }
});
```

---

## 🚀 部署到生產環境

### 選項 A: GitHub Actions （推薦）

**.github/workflows/deploy.yml**
```yaml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Install dependencies
      run: npm install
    
    - name: Set environment variables
      env:
        GOOGLE_SERVICE_ACCOUNT_KEY: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_KEY }}
        GOOGLE_CALENDAR_ID: ${{ secrets.GOOGLE_CALENDAR_ID }}
      run: |
        echo "GOOGLE_SERVICE_ACCOUNT_KEY=$GOOGLE_SERVICE_ACCOUNT_KEY" >> .env
        echo "GOOGLE_CALENDAR_ID=$GOOGLE_CALENDAR_ID" >> .env
    
    - name: Test Google Calendar connection
      run: npm run test:google-calendar
    
    - name: Deploy to server
      run: |
        # 你的部署指令
        npm run build
        npm start
```

**在 GitHub 上設定 Secrets：**
1. 前往 repo → Settings → Secrets and variables → Actions
2. 新增 `GOOGLE_SERVICE_ACCOUNT_KEY` → 貼上整個 JSON 檔案內容
3. 新增 `GOOGLE_CALENDAR_ID` → 貼上你的日曆 ID

### 選項 B: 手動部署到 VPS

```bash
# 登入伺服器
ssh user@your-server

# 建立安全目錄
mkdir -p ~/.config/rollcall/
chmod 700 ~/.config/rollcall/

# 上傳 service-account.json
scp service-account.json user@your-server:~/.config/rollcall/

# 設定權限
ssh user@your-server "chmod 600 ~/.config/rollcall/service-account.json"

# 在伺服器上設定 .env
ssh user@your-server "cat > ~/.bashrc << 'EOF'
export GOOGLE_SERVICE_ACCOUNT_KEY=~/.config/rollcall/service-account.json
export GOOGLE_CALENDAR_ID=tjmfamilyc0@gmail.com
export NODE_ENV=production
EOF"
```

---

## ❓ 常見問題

### Q1: 如何測試整合是否成功？

```bash
node test-google-calendar.js
```

應該看到：
```
✅ 連線成功！
✅ 事件建立成功！
```

### Q2: 金鑰過期或洩露怎麼辦？

```bash
# 1. 在 Google Cloud Console 刪除舊金鑰
# 2. 建立新金鑰
# 3. 更新本機 .env
# 4. 如果在 GitHub，更新 Secrets
# 5. 重新部署
```

### Q3: 如何測試端到端流程？

```bash
# 1. 確保本機 .env 設定正確
# 2. npm run dev
# 3. 在 Rollcall 建立一個測試活動
# 4. 檢查你的 Google Calendar 是否出現該活動
# 5. 檢查手機 Google Calendar app 是否收到通知
```

### Q4: 需要刪除舊的通知相關代碼嗎？

**立即刪除：**
- notification-manager.js
- sw.js（如果只用於通知）
- Service Worker 註冊代碼
- FCM / Firebase Messaging 代碼

**保留但棄用：**
- manifest.json（移除通知相關配置）
- index.html（移除通知權限申請）

### Q5: 如何在使用者端設定通知？

告訴使用者：
```
1. 開啟 Google Calendar App（iOS/Android）
2. 進入設定 → 通知
3. 確保 "Rollcall 官方行事曆" 已啟用通知
4. 設定通知時間（15分鐘前、1小時前等）
5. 完成！之後所有活動都會自動提醒
```

---

## ✅ 檢查清單

在部署前，確保你已完成：

- [ ] 安裝 `googleapis` 和 `dotenv`
- [ ] 建立 `.env` 檔案（本機）
- [ ] 將 `google-calendar-service.js` 加入專案
- [ ] 修改事件建立路由整合同步函式
- [ ] 運行 `npm run test:google-calendar` 測試連線
- [ ] 刪除舊的通知相關代碼
- [ ] 更新 `.gitignore` 排除 `.env` 和 `service-account.json`
- [ ] 在 GitHub 設定 Secrets（如果使用 GitHub Actions）
- [ ] 測試端到端流程（建立活動 → 檢查日曆 → 檢查手機通知）

---

## 📞 需要幫助？

如果整合過程中出現問題：
1. 檢查 `test-google-calendar.js` 的輸出
2. 確認 service-account.json 路徑正確
3. 確認 Service Account 有日曆編輯權限
4. 檢查 Node.js 版本 >= 14.0.0
