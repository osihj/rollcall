// ═══════════════════════════════════════════════════
//  sw.js  ─  自律打卡 Service Worker
//  負責：背景排程定時通知 + 接收臨時即時通知 + FCM 推播
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'jilv-v1';
const NOTIF_ICON = '/icon-96x96.png';

// ── 安裝 & 啟動 ──────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── 接收 FCM 推播（背景通知）────────────────────────
self.addEventListener('push', event => {
  let title = '自律動起來';
  let body = '你有一則新通知';
  let icon = NOTIF_ICON;
  let url = '/';

  try {
    const data = event.data?.json();
    if (data?.notification) {
      title = data.notification.title || title;
      body  = data.notification.body  || body;
      icon  = data.notification.icon  || icon;
    }
    if (data?.webpush?.fcm_options?.link) {
      url = data.webpush.fcm_options.link;
    }
  } catch (e) {
    // 如果不是 JSON，用純文字
    body = event.data?.text() || body;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: NOTIF_ICON,
      tag: 'fcm-push',
      data: { url },
    })
  );
});

// ── 接收主執行緒傳來的通知設定 ────────────────────────
self.addEventListener('message', event => {
  const { type, settings } = event.data || {};
  if (type === 'SCHEDULE') {
    applySettings(settings);
  }
  // ✅ 已移除 INSTANT 處理
  // 原本這裡會再顯示一次通知，與 FCM 推播重複，造成通知出現兩次
});

// ── 排程管理 ─────────────────────────────────────────
let _dailyTimer    = null;
let _scheduledTimers = [];

function clearAll() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _scheduledTimers.forEach(t => clearTimeout(t));
  _scheduledTimers = [];
}

function applySettings(settings) {
  clearAll();
  if (!settings) return;

  // 1. 每日定時
  if (settings.dailyEnabled && settings.dailyTime) {
    scheduleDailyNotif(settings.dailyTime, settings.dailyMessage || '記得今日打卡！');
  }

  // 2. 預約通知
  (settings.scheduled || []).forEach(item => {
    const delay = new Date(item.datetime).getTime() - Date.now();
    if (delay > 0) {
      const t = setTimeout(() => {
        showNotif('自律動起來', item.message, 'scheduled');
      }, delay);
      _scheduledTimers.push(t);
    }
  });
}

// 每日定時：算出今天或明天的目標時間
function scheduleDailyNotif(timeStr, message) {
  const [h, m] = timeStr.split(':').map(Number);
  const now  = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();
  _dailyTimer = setTimeout(() => {
    showNotif('自律動起來', message, 'daily');
    scheduleDailyNotif(timeStr, message);
  }, delay);
}

// ── 顯示系統通知 ──────────────────────────────────────
function showNotif(title, body, tag = 'general') {
  self.registration.showNotification(title, {
    body,
    icon:  NOTIF_ICON,
    badge: NOTIF_ICON,
    tag,
    data:  { url: '/' },
  });
}

// ── 點擊通知：開啟 app ────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(target));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    })
  );
});
