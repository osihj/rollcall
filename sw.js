// ═══════════════════════════════════════════════════
//  notification-manager.js  ─  rollcall 站
//  依賴：window.firebaseDB 已由 Firebase module 初始化
// ═══════════════════════════════════════════════════

import {
  doc, getDoc, setDoc, onSnapshot, collection, addDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const NOTIF_DOC = () => doc(window.firebaseDB, 'adminData', 'notifications');
const SCHEDULED_COL = () => collection(window.firebaseDB, 'adminData', 'notifications', 'scheduled');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyrd2uQNkjTCHSn3XTNvGcuqMMgJn5bJ-0Mhs6hXk5GFNqqIERz_H8syK7CzE0aHJsb/exec';
const APPS_SCRIPT_SECRET = 'drum2024';

// ── 1. 初始化 ────────────────────────────────────────
export async function initNotifications() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[Notif] 此裝置不支援推播通知');
    return false;
  }

  try {
    await navigator.serviceWorker.register('/rollcall/sw.js');
  } catch (e) {
    console.error('[SW] 註冊失敗', e);
    return false;
  }

  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      console.warn('[Notif] 使用者拒絕通知授權');
      return false;
    }
  }

  listenAndSync();
  return true;
}

// ── 2. 監聽 Firestore → 同步排程給 SW ──────────────
// ✅ 只處理排程設定，不處理 instant（避免重複通知）
function listenAndSync() {
  onSnapshot(NOTIF_DOC(), async snap => {
    const settings = snap.exists() ? snap.data() : {};
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

// ── 3. 管理員操作 API ─────────────────────────────────
export async function saveDailySettings({ enabled, time, message }) {
  await setDoc(NOTIF_DOC(), { dailyEnabled: enabled, dailyTime: time, dailyMessage: message }, { merge: true });
}

export async function addScheduled(item) {
  await addDoc(SCHEDULED_COL(), { ...item, createdAt: Date.now() });
}

export async function deleteScheduled(id) {
  await deleteDoc(doc(window.firebaseDB, 'adminData', 'notifications', 'scheduled', id));
}

// ── 臨時立即推播 ──────────────────────────────────────
// 流程：寫入 Firestore（drum 靠 onSnapshot 收到）→ FCM（推給背景/手機用戶）
// ✅ 不再 sendToSW(INSTANT)，避免 rollcall 自己又顯示一次
export async function sendInstant(message) {
  // 寫入 Firestore → drum 的 onSnapshot 會收到並顯示通知
  await setDoc(NOTIF_DOC(), {
    instant: { message, sentAt: Date.now() }
  }, { merge: true });

  // FCM 推播給背景/手機用戶
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        title: '自律動起來',
        message,
        secret: APPS_SCRIPT_SECRET
      })
    });
    const result = await res.json();
    console.log('[FCM] 推送結果:', result);
  } catch (err) {
    console.warn('[FCM] 推送失敗:', err.message);
  }
}

// ── 4. 讀取設定（供 UI 顯示用）──────────────────────
export async function loadSettings() {
  const snap = await getDoc(NOTIF_DOC());
  const base = snap.exists() ? snap.data() : {};
  const scheduled = await loadScheduled();
  return { ...base, scheduled };
}
