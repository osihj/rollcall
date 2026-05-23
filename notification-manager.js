// ═══════════════════════════════════════════════════
//  notification-manager.js
//  貼入活動行事曆 HTML 的 <script type="module"> 區塊內
//  依賴：window.firebaseDB 已由 Firebase module 初始化
// ═══════════════════════════════════════════════════

import {
  doc, getDoc, setDoc, onSnapshot, collection, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firestore 路徑
//   adminData/notifications        → 全域設定（每日定時）
//   adminData/notifications/scheduled → 子集合（預約通知清單）
const NOTIF_DOC = () => doc(window.firebaseDB, 'adminData', 'notifications');
const SCHEDULED_COL = () => collection(window.firebaseDB, 'adminData', 'notifications', 'scheduled');

// ── 1. 初始化：申請通知權限 + 註冊 SW ────────────────
export async function initNotifications() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[Notif] 此裝置不支援推播通知');
    return false;
  }

  // 註冊 Service Worker（路徑需對應 GitHub Pages 的實際位置）
  // GitHub Pages: osihj.github.io/rollcall/ → sw.js 放在 /rollcall/sw.js
  const swPath = '/drum/sw.js';
  try {
    await navigator.serviceWorker.register(swPath);
  } catch (e) {
    console.error('[SW] 註冊失敗', e);
    return false;
  }

  // 申請授權（只在使用者互動後呼叫，例如點按鈕時）
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      console.warn('[Notif] 使用者拒絕通知授權');
      return false;
    }
  }

  // 監聽 Firestore 設定變化，推送給 SW
  listenAndSync();
  return true;
}

// ── 2. 即時監聽 Firestore → 傳給 SW ────────────────
function listenAndSync() {
  onSnapshot(NOTIF_DOC(), async snap => {
    const settings = snap.exists() ? snap.data() : {};
    // 讀取預約通知子集合
    const scheduled = await loadScheduled();
    sendToSW({ type: 'SCHEDULE', settings: { ...settings, scheduled } });
  });
}

async function loadScheduled() {
  const { getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const snap = await getDocs(SCHEDULED_COL());
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function sendToSW(message) {
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage(message);
  });
}

// ── 3. 管理員操作 API ────────────────────────────────

// 儲存每日定時設定
export async function saveDailySettings({ enabled, time, message }) {
  await setDoc(NOTIF_DOC(), { dailyEnabled: enabled, dailyTime: time, dailyMessage: message }, { merge: true });
}

// 新增預約通知
// item = { title, message, datetime: '2025-06-14T09:30' }
export async function addScheduled(item) {
  await addDoc(SCHEDULED_COL(), { ...item, createdAt: Date.now() });
}

// 刪除預約通知
export async function deleteScheduled(id) {
  await deleteDoc(doc(window.firebaseDB, 'adminData', 'notifications', 'scheduled', id));
}

// 臨時立即推播（寫入 Firestore + 直接通知本機 SW）
export async function sendInstant(message) {
  // 寫入 Firestore 讓其他使用者的 SW 也能透過 onSnapshot 收到
  await setDoc(NOTIF_DOC(), {
    instant: { message, sentAt: Date.now() }
  }, { merge: true });
  // 同時通知本機 SW（管理員自己也看到）
  sendToSW({ type: 'INSTANT', message });
}

// ── 4. 讀取目前設定（供 UI 顯示用）─────────────────
export async function loadSettings() {
  const snap = await getDoc(NOTIF_DOC());
  const base = snap.exists() ? snap.data() : {};
  const scheduled = await loadScheduled();
  return { ...base, scheduled };
}
