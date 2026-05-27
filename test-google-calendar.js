/**
 * 測試 Google Calendar 連線
 * 
 * 使用方式：
 * node test-google-calendar.js
 */

require('dotenv').config();
const { testGoogleCalendarConnection, syncEventToGoogleCalendar } = require('./google-calendar-service');

async function runTests() {
  console.log('🧪 開始測試 Google Calendar 整合...\n');

  // 測試 1: 連線測試
  console.log('📝 測試 1: 檢查 Google Calendar 連線');
  console.log('════════════════════════════════════');
  
  const connected = await testGoogleCalendarConnection();
  
  if (!connected) {
    console.log('\n❌ 連線失敗！請檢查：');
    console.log('   1. service-account.json 路徑是否正確');
    console.log('   2. GOOGLE_SERVICE_ACCOUNT_KEY 環境變數是否設定');
    console.log('   3. Service Account 是否有日曆編輯權限');
    process.exit(1);
  }

  console.log('\n✅ 連線成功！\n');

  // 測試 2: 建立測試事件
  console.log('📝 測試 2: 建立測試事件');
  console.log('════════════════════════════════════');

  const now = new Date();
  const startTime = new Date(now.getTime() + 60 * 60 * 1000); // 1小時後
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 2小時後

  const testEvent = {
    title: `🧪 測試事件 - ${new Date().toLocaleString('zh-TW')}`,
    description: '這是一個測試事件，用於驗證 Google Calendar 整合是否正常運作',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    location: '線上會議'
  };

  console.log('\n建立事件：');
  console.log(JSON.stringify(testEvent, null, 2));
  console.log('\n正在同步到 Google Calendar...');

  const result = await syncEventToGoogleCalendar(testEvent);

  if (result.success) {
    console.log('\n✅ 事件建立成功！');
    console.log(`   事件 ID: ${result.googleEventId}`);
    console.log(`   日曆連結: ${result.googleEventLink}`);
  } else {
    console.log('\n❌ 事件建立失敗！');
    console.log(`   錯誤: ${result.error}`);
    process.exit(1);
  }

  console.log('\n\n🎉 所有測試通過！Google Calendar 整合已就緒。\n');
  console.log('後續步驟：');
  console.log('1. 在 GitHub 上設定 GOOGLE_SERVICE_ACCOUNT_KEY 和 GOOGLE_CALENDAR_ID 為 Secrets');
  console.log('2. 修改你的事件建立端點，加入 syncEventToGoogleCalendar() 呼叫');
  console.log('3. 測試端到端流程（在 Rollcall 建立活動，檢查日曆）');
}

runTests().catch(error => {
  console.error('❌ 測試失敗:', error);
  process.exit(1);
});
