// ═══════════════════════════════════════════════════
//  sw.js  ─  rollcall Service Worker
// ═══════════════════════════════════════════════════

const NOTIF_ICON = '/rollcall/icon-96x96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── 接收 FCM 推播 ─────────────────────────────────
// ✅ 從 webpush.data 讀取 title/body（Apps Script 改用 data 欄位後）
// 瀏覽器不會自動顯示，只由這裡顯示一次
self.addEventListener('push', event => {
  let title = '臨時通知';
  let body = '你有一則新通知';
  let url = '/rollcall/';

  try {
    const payload = event.data?.json();
    // Apps Script 現在用 webpush.data 傳資料
    title = payload?.data?.title || payload?.notification?.title || title;
    body  = payload?.data?.body  || payload?.notification?.body  || body;
    if (payload?.webpush?.fcm_options?.link) {
      url = payload.webpush.fcm_options.link;
    }
  } catch (e) {
    body = event.data?.text() || body;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: NOTIF_ICON,
      badge: NOTIF_ICON,
      tag: 'fcm-push',
      data: { url },
    })
  );
});

// ── 接收主執行緒傳來的排程設定 ───────────────────────
self.addEventListener('message', event => {
  const { type, settings } = event.data || {};
  if (type === 'SCHEDULE') {
    applySettings(settings);
  }
});

// ── 排程管理 ──────────────────────────────────────
// 注意：每日定時和預約通知都在這裡處理
// 預約通知另外也透過 FCM 推送（確保背景也能收到），見 notification-manager.js
let _dailyTimer = null;
let _scheduledTimers = [];

function clearAll() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _scheduledTimers.forEach(t => clearTimeout(t));
  _scheduledTimers = [];
}

function applySettings(settings) {
  clearAll();
  if (!settings) return;

  if (settings.dailyEnabled && settings.dailyTime) {
    scheduleDailyNotif(settings.dailyTime, settings.dailyMessage || '記得今日打卡！');
  }

  // 預約通知：網頁開著時由 SW timer 處理，背景由 FCM 處理
  (settings.scheduled || []).forEach(item => {
    const delay = new Date(item.datetime).getTime() - Date.now();
    if (delay > 0) {
      const t = setTimeout(() => {
        showNotif('預約通知', item.message, 'scheduled');
      }, delay);
      _scheduledTimers.push(t);
    }
  });
}

function scheduleDailyNotif(timeStr, message) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();
  _dailyTimer = setTimeout(() => {
    showNotif('每日提醒', message, 'daily');
    scheduleDailyNotif(timeStr, message);
  }, delay);
}

function showNotif(title, body, tag = 'general') {
  self.registration.showNotification(title, {
    body,
    icon: NOTIF_ICON,
    badge: NOTIF_ICON,
    tag,
    data: { url: '/rollcall/' },
  });
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/rollcall/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(target));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
