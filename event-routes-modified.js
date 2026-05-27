/**
 * Rollcall 活動建立流程修改範例
 * 
 * 假設你現有的活動建立端點類似這樣：
 * app.post('/api/events/create', createEvent);
 * 
 * 以下展示如何整合 Google Calendar 同步
 */

const express = require('express');
const { syncEventToGoogleCalendar } = require('./google-calendar-service');

const router = express.Router();

/**
 * 修改後的活動建立端點
 * POST /api/events/create
 */
router.post('/api/events/create', async (req, res) => {
  try {
    const {
      title,
      description,
      startTime,      // 應該是 ISO 8601 格式: "2026-05-27T10:00:00+08:00"
      endTime,        // 應該是 ISO 8601 格式: "2026-05-27T11:00:00+08:00"
      location,
      // 其他 Rollcall 特有欄位...
      classId,
      organizerId,
      attendees
    } = req.body;

    // ===== 步驟 1: 驗證輸入 =====
    if (!title || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: '缺少必要欄位: title, startTime, endTime'
      });
    }

    // ===== 步驟 2: 在本地資料庫建立活動 =====
    let dbEvent;
    try {
      // 這是你現有的 Rollcall 流程
      dbEvent = await createEventInDatabase({
        title,
        description,
        startTime,
        endTime,
        location,
        classId,
        organizerId,
        attendees
      });
      
      console.log(`✅ 活動已在 Rollcall 建立: ${dbEvent.id}`);
    } catch (dbError) {
      console.error('❌ 資料庫建立失敗:', dbError.message);
      return res.status(500).json({
        success: false,
        message: '無法建立活動',
        error: dbError.message
      });
    }

    // ===== 步驟 3: 同步到 Google Calendar（非關鍵） =====
    let googleSyncResult = {
      success: false,
      message: '未同步'
    };

    try {
      googleSyncResult = await syncEventToGoogleCalendar({
        title,
        description,
        startTime,
        endTime,
        location
      });

      // 如果同步成功，保存 Google Calendar 的 Event ID
      if (googleSyncResult.success) {
        await saveGoogleEventIdToDatabase(dbEvent.id, googleSyncResult.googleEventId);
      }
    } catch (googleError) {
      // ⚠️ 重要：即使 Google Calendar 同步失敗，也不中斷主流程
      console.warn('⚠️ Google Calendar 同步失敗（不影響主流程）:', googleError.message);
      // 可選：在這裡記錄到日誌，稍後重試
    }

    // ===== 步驟 4: 不再需要 Web Push / FCM / Service Worker =====
    // ❌ 移除舊的通知邏輯：
    // await sendWebPushNotifications(attendees);
    // await sendFCMNotifications(attendees);
    // awaitServiceWorkerNotification(title, startTime);

    // ✅ 新的流程：Google Calendar 會自動推播通知

    // ===== 步驟 5: 回傳成功回應 =====
    return res.status(201).json({
      success: true,
      message: '活動已建立',
      data: {
        eventId: dbEvent.id,
        title,
        startTime,
        endTime,
        googleSync: {
          synced: googleSyncResult.success,
          googleEventId: googleSyncResult.googleEventId,
          message: googleSyncResult.message
        }
      }
    });

  } catch (error) {
    console.error('❌ 未預期的錯誤:', error);
    return res.status(500).json({
      success: false,
      message: '伺服器錯誤',
      error: error.message
    });
  }
});

/**
 * 修改活動端點（選擇性）
 * PUT /api/events/:eventId/update
 */
router.put('/api/events/:eventId/update', async (req, res) => {
  try {
    const { eventId } = req.params;
    const updateData = req.body;

    // 步驟 1: 更新本地資料庫
    const dbEvent = await updateEventInDatabase(eventId, updateData);

    // 步驟 2: 如果有 Google Event ID，同步更新
    if (dbEvent.googleEventId) {
      const { updateGoogleCalendarEvent } = require('./google-calendar-service');
      
      await updateGoogleCalendarEvent(dbEvent.googleEventId, {
        title: updateData.title,
        description: updateData.description,
        startTime: updateData.startTime,
        endTime: updateData.endTime
      });
    }

    return res.json({
      success: true,
      message: '活動已更新',
      data: dbEvent
    });

  } catch (error) {
    console.error('❌ 更新失敗:', error);
    return res.status(500).json({
      success: false,
      message: '無法更新活動',
      error: error.message
    });
  }
});

/**
 * 刪除活動端點
 * DELETE /api/events/:eventId
 */
router.delete('/api/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;

    // 步驟 1: 取得活動資訊（含 Google Event ID）
    const dbEvent = await getEventFromDatabase(eventId);

    // 步驟 2: 刪除 Google Calendar 中的事件
    if (dbEvent.googleEventId) {
      const { deleteGoogleCalendarEvent } = require('./google-calendar-service');
      
      await deleteGoogleCalendarEvent(dbEvent.googleEventId);
    }

    // 步驟 3: 刪除本地資料庫中的事件
    await deleteEventFromDatabase(eventId);

    return res.json({
      success: true,
      message: '活動已刪除'
    });

  } catch (error) {
    console.error('❌ 刪除失敗:', error);
    return res.status(500).json({
      success: false,
      message: '無法刪除活動',
      error: error.message
    });
  }
});

// ====================================
// 假設函式（你需要根據實際情況修改）
// ====================================

async function createEventInDatabase(eventData) {
  // 這是你現有的 Rollcall 資料庫邏輯
  // 應該返回包含 { id, title, startTime, endTime, ... } 的物件
  // 示範：
  return {
    id: 'event_' + Date.now(),
    ...eventData,
    createdAt: new Date()
  };
}

async function saveGoogleEventIdToDatabase(rollcallEventId, googleEventId) {
  // 將 Google Event ID 保存到你的資料庫
  // 以便未來更新或刪除時使用
  console.log(`保存 Google Event ID: ${googleEventId} 到事件 ${rollcallEventId}`);
}

async function updateEventInDatabase(eventId, updateData) {
  // 你的更新邏輯
  return { id: eventId, ...updateData };
}

async function deleteEventFromDatabase(eventId) {
  // 你的刪除邏輯
  console.log(`已刪除事件: ${eventId}`);
}

async function getEventFromDatabase(eventId) {
  // 你的查詢邏輯
  return { id: eventId, googleEventId: 'google_event_id' };
}

module.exports = router;
