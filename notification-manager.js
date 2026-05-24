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

// ── FCM 推播（所有通知的唯一出口）─────────────────
async function callFCM(title, message) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ title, message, secret: APPS_SCRIPT_SECRET })
    });
    const result = await res.json();
    console.log('[FCM] 推送結果:', result);
  } catch (err) {
    console.warn('[FCM] 推送失敗:', err.message);
  }
}

// ── 1. 初始化：申請通知權限 + 註冊 SW ────────────────
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
  startScheduledChecker(); // ✅ 啟動預約通知定時檢查器
  return true;
}

// ── 2. 監聽 Firestore → 同步排程給 SW ──────────────
// 只同步每日定時設定，臨時通知不走這條路
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

// ── 3. 預約通知定時檢查器 ─────────────────────────
// 每分鐘檢查一次，到期則發 FCM 並從 Firestore 刪除
// 用 _firedIds 防止同一則通知在同一個 tab 被重複觸發
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
        console.log('[排程] 觸發預約通知:', item.title, item.message);
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

// ── 4. 管理員操作 API ─────────────────────────────────
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
// 只走 FCM，標題固定「臨時通知」，只發一次
export async function sendInstant(message) {
  // 寫入 Firestore（紀錄用）
  await setDoc(NOTIF_DOC(), {
    instant: { message, sentAt: Date.now() }
  }, { merge: true });

  // FCM 推播，這是唯一的通知來源
  await callFCM('臨時通知', message);
}

// ── 5. 讀取設定（供 UI 顯示用）──────────────────────
export async function loadSettings() {
  const snap = await getDoc(NOTIF_DOC());
  const base = snap.exists() ? snap.data() : {};
  const scheduled = await loadScheduled();
  return { ...base, scheduled };
}
