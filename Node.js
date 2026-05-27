// 1. 安裝
npm install googleapis --save

// 2. 在 Rollcall 建立活動成功後，新增同步函式
const { google } = require("googleapis");
const fs = require("fs");

async function syncToGoogleCalendar(eventData) {
  const auth = new google.auth.GoogleAuth({
    keyFile: "/path/to/service-account.json", // 放在安全的地方
    scopes: ["https://www.googleapis.com/auth/calendar"]
  });

  const calendar = google.calendar({ version: "v3", auth });

  try {
    await calendar.events.insert({
      calendarId: "tjmfamilyc0@gmail.com", // 你的日曆 ID
      requestBody: {
        summary: eventData.title, // Rollcall 活動名稱
        description: eventData.description,
        start: { dateTime: eventData.startTime }, // ISO 8601 格式
        end: { dateTime: eventData.endTime },
        // 可選：設定提醒
        reminders: {
          useDefault: true // 使用日曆預設提醒
        }
      }
    });
    console.log("✓ 已同步到 Google Calendar");
  } catch (error) {
    console.error("✗ 同步失敗：", error.message);
    // 不中斷 Rollcall 主流程
  }
}