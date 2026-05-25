// ═══════════════════════════════════════════════════
//  notification-manager.js  ─  rollcall 站
//  依賴：window.firebaseDB 已由 Firebase module 初始化
// ═══════════════════════════════════════════════════

import {
  doc, getDoc, setDoc, onSnapshot, collection, addDoc, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NOTIF_DOC    = () => doc(window.firebaseDB, 'adminData', 'notifications');
const SCHEDULED_COL = () => collection(window.firebaseDB, 'adminData', 'notifications', 'scheduled');
const DEVICES_COL   = () => collection(window.firebaseDB, 'devices');

const APPS_SCRIPT_URL    = 'https://script.google.com/macros/s/AKfycbyrd2uQNkjTCHSn3XTNvGcuqMMgJn5bJ-0Mhs6hXk5GFNqqIERz_H8syK7CzE0aHJsb/exec';
const APPS_SCRIPT_SECRET = 'drum2024';

// ── FCM 推播（唯一出口）──────────────────────────────
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
// ── 1. 初始化 ────────────────────────────────────────
// ═══════════════════════════════════════════════════
export async function initNotifications() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[Notif] 此裝置不支援推播通知');
    return false;
  }

  // 註冊 SW
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('[SW] ✅ 註冊成功');
  } catch (e) {
    console.error('[SW] ❌ 註冊失敗:', e.message);
    return false;
  }

  // 申請通知授權
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      console.warn('[Notif] 使用者拒絕通知授權');
      return false;
    }
  }

  listenAndSync();
  startScheduledChecker();
  return true;
}

// ═══════════════════════════════════════════════════
// ── 2. 監聽 Firestore → 同步排程給 SW ──────────────
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
  navigator.serviceWorker.ready.then(reg => reg.active?.postMessage(message));
}

// ═══════════════════════════════════════════════════
// ── 3. 預約通知定時檢查器 ─────────────────────────
// ═══════════════════════════════════════════════════
const _firedIds = new Set();

function startScheduledChecker() {
  async function check() {
    const items = await loadScheduled();
    const now = Date.now();
    for (const item of items) {
      if (_firedIds.has(item.id)) continue;
      const triggerTime = new Date(item.datetime).getTime();
      if (triggerTime <= now && now - triggerTime < 60 * 1000) {
        _firedIds.add(item.id);
        console.log('[排程] ✅ 觸發預約通知:', item.title);
        await callFCM(item.title || '預約通知', item.message);
        await deleteScheduled(item.id);
      }
    }
  }
  check();
  setInterval(check, 60 * 1000);
}

// ═══════════════════════════════════════════════════
// ── 4. 管理員操作 API ─────────────────────────────
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

export async function sendInstant(message) {
  await setDoc(NOTIF_DOC(), { instant: { message, sentAt: Date.now() } }, { merge: true });
  await callFCM('臨時通知', message);
}

export async function loadSettings() {
  const snap = await getDoc(NOTIF_DOC());
  const base = snap.exists() ? snap.data() : {};
  const scheduled = await loadScheduled();
  return { ...base, scheduled };
}

// ═══════════════════════════════════════════════════
// ── 5. 全域暴露（供控制台使用）──────────────────────
// ═══════════════════════════════════════════════════
window.initNotifications  = initNotifications;
window.sendInstant        = sendInstant;
window.loadSettings       = loadSettings;
window.saveDailySettings  = saveDailySettings;
window.addScheduled       = addScheduled;
window.deleteScheduled    = deleteScheduled;

window.debugListDevices = async function() {
  try {
    const snap = await getDocs(DEVICES_COL());
    const devices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
