/**
 * Google Calendar 同步服務
 * 負責將 Rollcall 活動同步到 Google Calendar
 * 
 * 使用方式：
 * const { syncEventToGoogleCalendar } = require('./google-calendar-service');
 * 
 * await syncEventToGoogleCalendar({
 *   title: '英文課點名',
 *   description: '...',
 *   startTime: '2026-05-27T10:00:00+08:00',
 *   endTime: '2026-05-27T11:00:00+08:00'
 * });
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// 取得 Service Account 金鑰路徑
function getServiceAccountKeyPath() {
  // 優先順序：環境變數 > 預設路徑
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  }
  
  // 備用路徑（伺服器部署時）
  const defaultPath = path.join(process.env.HOME || '/root', '.config/rollcall/service-account.json');
  
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  
  throw new Error('Google Service Account 金鑰未找到。請設定 GOOGLE_SERVICE_ACCOUNT_KEY 環境變數或將金鑰放在 ~/.config/rollcall/service-account.json');
}

// 初始化 Google Calendar API 認證
async function getCalendarAuth() {
  try {
    const keyFilePath = getServiceAccountKeyPath();
    
    const auth = new google.auth.GoogleAuth({
      keyFile: keyFilePath,
      scopes: ['https://www.googleapis.com/auth/calendar']
    });
    
    return auth;
  } catch (error) {
    console.error('❌ Google Calendar 認證失敗:', error.message);
    throw error;
  }
}

/**
 * 將活動同步到 Google Calendar
 * @param {Object} eventData - 活動資料
 * @param {string} eventData.title - 活動標題（必需）
 * @param {string} eventData.description - 活動描述（可選）
 * @param {string} eventData.startTime - 開始時間 ISO 8601 格式（必需）
 * @param {string} eventData.endTime - 結束時間 ISO 8601 格式（必需）
 * @param {string} eventData.location - 地點（可選）
 * @returns {Promise<Object>} Google Calendar 事件資料
 */
async function syncEventToGoogleCalendar(eventData) {
  try {
    // 驗證必要欄位
    if (!eventData.title || !eventData.startTime || !eventData.endTime) {
      throw new Error('缺少必要欄位: title, startTime, endTime');
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    
    const auth = await getCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    // 構建 Google Calendar 事件物件
    const googleEvent = {
      summary: eventData.title,
      description: eventData.description || '',
      start: {
        dateTime: eventData.startTime, // 必須是 ISO 8601 格式，含時區
        timeZone: 'Asia/Taipei' // 台灣時區
      },
      end: {
        dateTime: eventData.endTime,
        timeZone: 'Asia/Taipei'
      },
      reminders: {
        useDefault: true // 使用 Google Calendar 的預設提醒設定
      }
    };

    // 如果有地點資訊，加入
    if (eventData.location) {
      googleEvent.location = eventData.location;
    }

    // 寫入 Google Calendar
    const response = await calendar.events.insert({
      calendarId: calendarId,
      requestBody: googleEvent
    });

    console.log(`✅ 事件已同步到 Google Calendar: ${response.data.id}`);
    
    return {
      success: true,
      googleEventId: response.data.id,
      googleEventLink: response.data.htmlLink,
      message: `活動 "${eventData.title}" 已同步到日曆`
    };

  } catch (error) {
    console.error('❌ Google Calendar 同步失敗:', error.message);
    
    // 返回失敗資訊，但不中斷主流程
    return {
      success: false,
      error: error.message,
      message: '無法同步到 Google Calendar，但本地活動已建立'
    };
  }
}

/**
 * 更新 Google Calendar 中的事件
 * @param {string} googleEventId - Google Calendar 事件 ID
 * @param {Object} updateData - 更新資料
 * @returns {Promise<Object>}
 */
async function updateGoogleCalendarEvent(googleEventId, updateData) {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const auth = await getCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const googleEvent = {};
    if (updateData.title) googleEvent.summary = updateData.title;
    if (updateData.description) googleEvent.description = updateData.description;
    if (updateData.startTime) {
      googleEvent.start = {
        dateTime: updateData.startTime,
        timeZone: 'Asia/Taipei'
      };
    }
    if (updateData.endTime) {
      googleEvent.end = {
        dateTime: updateData.endTime,
        timeZone: 'Asia/Taipei'
      };
    }

    const response = await calendar.events.update({
      calendarId: calendarId,
      eventId: googleEventId,
      requestBody: googleEvent
    });

    console.log(`✅ Google Calendar 事件已更新: ${googleEventId}`);
    return { success: true, data: response.data };

  } catch (error) {
    console.error('❌ Google Calendar 更新失敗:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 從 Google Calendar 刪除事件
 * @param {string} googleEventId - Google Calendar 事件 ID
 * @returns {Promise<Object>}
 */
async function deleteGoogleCalendarEvent(googleEventId) {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const auth = await getCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId: calendarId,
      eventId: googleEventId
    });

    console.log(`✅ Google Calendar 事件已刪除: ${googleEventId}`);
    return { success: true, message: '事件已從日曆移除' };

  } catch (error) {
    console.error('❌ Google Calendar 刪除失敗:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 測試 Google Calendar 連線
 * @returns {Promise<boolean>}
 */
async function testGoogleCalendarConnection() {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
    const auth = await getCalendarAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    // 嘗試取得日曆資訊
    const response = await calendar.calendars.get({
      calendarId: calendarId
    });

    console.log(`✅ Google Calendar 連線成功: ${response.data.summary}`);
    return true;

  } catch (error) {
    console.error('❌ Google Calendar 連線失敗:', error.message);
    return false;
  }
}

module.exports = {
  syncEventToGoogleCalendar,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  testGoogleCalendarConnection
};
