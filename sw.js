// ═══════════════════════════════════════════════════
//  sw.js  ─  rollcall Service Worker
//  ⚠️ Service Worker 不能用 import，所有邏輯直接寫在這裡
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'rollcall-v1';

// ── 安裝 ──────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
});

// ── 啟動 ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// ── 接收主頁訊息（排程設定）──────────────────────
let dailyTimer = null;
let scheduledTimers = [];

self.addEventListener('message', event => {
  const { type, settings } = event.data || {};
  if (type !== 'SCHEDULE') return;

  // 清除舊的計時器
  if (dailyTimer) { clearTimeout(dailyTimer); dailyTimer = null; }
  scheduledTimers.forEach(t => clearTimeout(t));
  scheduledTimers = [];

  if (!settings) return;

  // ── 每日定時通知 ──
  if (settings.dailyEnabled && settings.dailyTime) {
    scheduleDailyNotif(settings.dailyTime, settings.dailyMessage || '記得今日打卡！');
  }

  // ── 預約通知 ──
  if (Array.isArray(settings.scheduled)) {
    settings.scheduled.forEach(item => {
      const delay = new Date(item.datetime).getTime() - Date.now();
      if (delay > 0 && delay < 7 * 24 * 60 * 60 * 1000) { // 7天內才排
        const t = setTimeout(() => {
          showNotif(item.title || '預約通知', item.message || '');
        }, delay);
        scheduledTimers.push(t);
      }
    });
  }
});

function scheduleDailyNotif(timeStr, message) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();

  dailyTimer = setTimeout(function fire() {
    showNotif('自律動起來', message);
    // 隔 24 小時再觸發
    dailyTimer = setTimeout(fire, 24 * 60 * 60 * 1000);
  }, delay);
}

function showNotif(title, body) {
  self.registration.showNotification(title, {
    body,
    icon: '/rollcall/icon-192.png',
    badge: '/rollcall/icon-192.png',
    tag: 'rollcall-notif',
    renotify: true
  });
}

// ── 點擊通知 ──────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('https://osihj.github.io/rollcall/');
    })
  );
});

// ── Push 事件（FCM 推播）──────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch(e) {}
  const title = data.title || '自律動起來';
  const body  = data.body  || data.message || '';
  event.waitUntil(showNotif(title, body));
});
