// ═══════════════════════════════════════════════════
//  notification-manager.js  ─  rollcall 站
//  🔧 完整修正版（GitHub Pages + FCM Token）
//  依賴：window.firebaseDB 已由 Firebase module 初始化
// ═══════════════════════════════════════════════════

import {
  doc, getDoc, setDoc, onSnapshot, collection, addDoc, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NOTIF_DOC = () => doc(window.firebaseDB, 'adminData', 'notifications');
const SCHEDULED_COL = () => collection(window.firebaseDB, 'adminData', 'notifications', 'scheduled');
const DEVICES_COL = () => collection(window.firebaseDB, 'devices');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyrd2uQNkjTCHSn3XTNvGcuqMMgJn5bJ-0Mhs6hXk5GFNqqIERz_H8syK7CzE0aHJsb/exec';
const APPS_SCRIPT_SECRET = 'drum2024';

let messaging = null;

// ═══════════════════════════════════════════════════
// 🆕 新增：Firebase Messaging 初始化
// ═══════════════════════════════════════════════════
async function initializeMessaging() {
  try {
    const messaging_module = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
    messaging = messaging_module.getMessaging();
    return messaging;
  } catch (err) {
    console.warn('[FCM] Firebase Messaging 初始化失敗:', err);
    return null;
  }
}

// 🆕 新增：獲取 FCM Token
async function getTokenInternal(msg) {
  try {
    const token = await msg.getToken({
      vapidKey: 'BM_r6z7-dGtDamxfNqJq5-9RhW8pFzcUIVJxK9EJyNDCLXQdA1oHEXLPw5nDwM_fpKiJDxHEp5sJGDMr_dL-IpQ'
    });
    return token;
  } catch (err) {
    console.error('[FCM] getToken 失敗:', err);
    throw err;
  }
}

// 🆕 新增：監聽 token 刷新
function listenTokenRefresh(msg) {
  msg.onTokenRefresh(async () => {
    try {
      const newToken = await getTokenInternal(msg);
      console.log('[FCM] ✅ Token 已刷新');
      await registerDeviceToken(newToken);
    } catch (err) {
      console.warn('[FCM] Token 刷新失敗:', err);
    }
  });
}

// 🆕 新增：向 Firestore 註冊裝置 token
async function registerDeviceToken(token) {
  try {
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const user = getAuth().currentUser;
    if (!user) {
      console.warn('[Device] 使用者未登入');
      return;
    }

    const deviceId = `web_${user.uid}_${getPlatform()}`;
    const db = window.firebaseDB;

    await setDoc(
      doc(db, 'devices', deviceId),
      {
        token: token,
        userId: user.uid,
        userEmail: user.email,
        type: 'web',
        platform: getPlatform(),
        userAgent: navigator.userAgent,
        registeredAt: new Date(),
        lastSeen: new Date()
      },
      { merge: true }
    );

    console.log('[Device] ✅ Token 已註冊:', deviceId);
  } catch (err) {
    console.error('[Device] 註冊失敗:', err);
  }
}

// 🆕 新增：取得瀏覽器平台
function getPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg')) return 'edge';
  if (ua.includes('chrome')) return 'chrome';
  if (ua.includes('safari') && !ua.includes('chrome')) return 'safari';
  if (ua.includes('firefox')) return 'firefox';
  return 'unknown';
}

// ── FCM 推播（所有通知的唯一出口）─────────────────
async function callFCM(title, message) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ title, message, secret: APPS_SCRIPT_SECRET })
    });
    const result = await res.json();
    console.log('[FCM] ✅ 推送結果:', result);
  } catch (err) {
    console.warn('[FCM] ❌ 推送失敗:', err.message);
  }
}

// ═══════════════════════════════════════════════════
// ── 1. 初始化：申請通知權限 + 註冊 SW ────────────────
// ═══════════════════════════════════════════════════
export async function initNotifications() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[Notif] 此裝置不支援推播通知');
    return false;
  }

  // 🔧 修復：使用相對路徑而非絕對路徑
  try {
    await navigator.serviceWorker.register('./sw.js', {
      scope: './'  // 相對於目前頁面的根目錄
    });
    console.log('[SW] ✅ 註冊成功');
  } catch (e) {
    console.error('[SW] ❌ 註冊失敗:', e.message);
    return false;
  }

  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      console.warn('[Notif] 使用者拒絕通知授權');
      return false;
    }
  }

  // 🆕 新增：初始化 FCM Token 的邏輯
  const msg = await initializeMessaging();
  if (msg) {
    try {
      const token = await getTokenInternal(msg);
      if (token) {
        console.log('[FCM] ✅ Token 已獲取');
        await registerDeviceToken(token);
      }
    } catch (err) {
      console.warn('[FCM] Token 取得失敗:', err.message);
    }
    listenTokenRefresh(msg);
  }

  listenAndSync();
  startScheduledChecker(); // ✅ 啟動預約通知定時檢查器
  return true;
}

// ═══════════════════════════════════════════════════
// ── 2. 監聽 Firestore → 同步排程給 SW ──────────────
// 只同步每日定時設定，臨時通知不走這條路
// ═══════════════════════════════════════════════════
function listenAndSync() {
  onSnapshot(NOTIF_DOC(), async snap => {
    const settings = snap.exists() ? snap.data() : {};
    const scheduled = await loadScheduled();
    sendToSW({ type: 'SCHEDULE', settings: { ...settings, scheduled } });
    console.log('[Sync] ✅ 設定已同步');
  });
}

async function loadScheduled() {
  const snap = await getDocs(SCHEDULED_COL());
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function sendToSW(message) {
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage(message);
  });
}

// ═══════════════════════════════════════════════════
// ── 3. 預約通知定時檢查器 ─────────────────────────
// 每分鐘檢查一次，到期則發 FCM 並從 Firestore 刪除
// 用 _firedIds 防止同一則通知在同一個 tab 被重複觸發
// ═══════════════════════════════════════════════════
const _firedIds = new Set();

function startScheduledChecker() {
  async function check() {
    const items = await loadScheduled();
    const now = Date.now();
    for (const item of items) {
      if (_firedIds.has(item.id)) continue;
      const triggerTime = new Date(item.datetime).getTime();
      // 到期（允許 1 分鐘的誤差視窗）
      if (triggerTime <= now && now - triggerTime < 60 * 1000) {
        _firedIds.add(item.id);
        console.log('[排程] ✅ 觸發預約通知:', item.title, item.message);
        await callFCM(item.title || '預約通知', item.message);
        // 刪除已發送的預約通知
        await deleteScheduled(item.id);
      }
    }
  }

  // 立即執行一次，之後每分鐘執行
  check();
  setInterval(check, 60 * 1000);
}

// ═══════════════════════════════════════════════════
// ── 4. 管理員操作 API ─────────────────────────────────
// ═══════════════════════════════════════════════════
export async function saveDailySettings({ enabled, time, message }) {
  await setDoc(NOTIF_DOC(), { dailyEnabled: enabled, dailyTime: time, dailyMessage: message }, { merge: true });
}

export async function addScheduled(item) {
  await addDoc(SCHEDULED_COL(), { ...item, createdAt: Date.now() });
}

export async function deleteScheduled(id) {
  await deleteDoc(doc(window.firebaseDB, 'adminData', 'notifications', 'scheduled', id));
}

// ═══════════════════════════════════════════════════
// ── 臨時立即推播 ──────────────────────────────────────
// 只走 FCM，標題固定「臨時通知」，只發一次
// ═══════════════════════════════════════════════════
export async function sendInstant(message) {
  // 寫入 Firestore（紀錄用）
  await setDoc(NOTIF_DOC(), {
    instant: { message, sentAt: Date.now() }
  }, { merge: true });

  // FCM 推播，這是唯一的通知來源
  await callFCM('臨時通知', message);
}

// ═══════════════════════════════════════════════════
// ── 5. 讀取設定（供 UI 顯示用）──────────────────────
// ═══════════════════════════════════════════════════
export async function loadSettings() {
  const snap = await getDoc(NOTIF_DOC());
  const base = snap.exists() ? snap.data() : {};
  const scheduled = await loadScheduled();
  return { ...base, scheduled };
}

// ═══════════════════════════════════════════════════
// 🆕 暴露全域函式（供控制台使用）
// ═══════════════════════════════════════════════════

window.initNotifications = initNotifications;
window.sendInstant = sendInstant;
window.loadSettings = loadSettings;
window.saveDailySettings = saveDailySettings;
window.addScheduled = addScheduled;
window.deleteScheduled = deleteScheduled;

// 🆕 新增：debugListDevices 全域函式
window.debugListDevices = async function() {
  try {
    const db = window.firebaseDB;
    const snap = await getDocs(DEVICES_COL());
    const devices = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
    console.log('✅ 已註冊的裝置數:', devices.length);
    console.table(devices);
    return devices;
  } catch (err) {
    console.error('[Devices] ❌ 列表讀取失敗:', err);
    return [];
  }
};

console.log('%c✅ Notification Manager 已載入', 'color: green; font-weight: bold;');
console.log('可用函式：sendInstant() | debugListDevices() | initNotifications()');
