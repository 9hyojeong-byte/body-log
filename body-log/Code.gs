/**
 * ================================================================
 *  🌸 사이클 트래커 – Google Apps Script 백엔드
 * ================================================================
 *  설치 방법:
 *  1. Google Drive에서 새 스프레드시트 생성
 *  2. 확장 프로그램 → Apps Script 열기
 *  3. 이 코드 전체를 붙여넣기 (기존 코드 교체)
 *  4. 저장 후 "배포" → "새 배포" → 유형: 웹 앱
 *  5. "실행 계정": 본인 계정, "액세스 권한": 모든 사용자(익명 포함)
 *  6. 배포 URL을 PWA 앱 설정 > Google Sheets URL에 붙여넣기
 * ================================================================
 */

/* ─── 시트 설정 ─── */
const SHEET_NAME   = '생리기록';
const COL_DATE     = 1;   // A열: 날짜
const COL_ADDED    = 2;   // B열: 등록일시
const COL_CYCLE    = 3;   // C열: 계산된 주기
const COL_OVUL     = 4;   // D열: 예상 배란일
const COL_GOLDEN_S = 5;   // E열: 황금기 시작
const COL_GOLDEN_E = 6;   // F열: 황금기 종료
const COL_NEXT     = 7;   // G열: 다음 생리 예정일
const COL_NOTE     = 8;   // H열: 비고

/* ─── CORS 허용 헤더 ─── */
function corsHeaders() {
  return ContentService.createTextOutput()
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================================================
   GET 요청: 전체 데이터 조회
================================================================ */
function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const data  = getAllRecords(sheet);
    return respond({ status: 'ok', data });
  } catch (err) {
    return respond({ status: 'error', message: err.message });
  }
}

/* ================================================================
   POST 요청: ADD / DELETE / SYNC_ALL 처리
================================================================ */
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    const sheet  = getOrCreateSheet();

    if (action === 'ADD') {
      addRecord(sheet, body.date);
      recalcAll(sheet);
      return respond({ status: 'ok', message: `${body.date} 추가 완료` });
    }

    if (action === 'DELETE') {
      deleteRecord(sheet, body.date);
      recalcAll(sheet);
      return respond({ status: 'ok', message: `${body.date} 삭제 완료` });
    }

    if (action === 'SYNC_ALL') {
      // 앱에서 전체 데이터 동기화 시 사용
      syncAll(sheet, body.cycles || []);
      return respond({ status: 'ok', message: '전체 동기화 완료' });
    }

    return respond({ status: 'error', message: `알 수 없는 action: ${action}` });

  } catch (err) {
    return respond({ status: 'error', message: err.message });
  }
}

/* ================================================================
   시트 초기화 / 헤더 생성
================================================================ */
function getOrCreateSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    setupHeader(sheet);
  } else if (sheet.getLastRow() === 0) {
    setupHeader(sheet);
  }

  return sheet;
}

function setupHeader(sheet) {
  const headers = [
    '생리 시작일', '등록 일시', '주기(일)', '예상 배란일',
    '황금기 시작', '황금기 종료', '다음 생리 예정', '비고'
  ];
  const headerRow = sheet.getRange(1, 1, 1, headers.length);
  headerRow.setValues([headers]);
  headerRow.setBackground('#f8e0ea');
  headerRow.setFontWeight('bold');
  headerRow.setHorizontalAlignment('center');

  // 열 너비 조정
  const widths = [120, 160, 80, 120, 120, 120, 130, 150];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // 헤더 고정
  sheet.setFrozenRows(1);
  SpreadsheetApp.flush();
}

/* ================================================================
   레코드 추가
================================================================ */
function addRecord(sheet, dateStr) {
  // 중복 체크
  const existing = findRow(sheet, dateStr);
  if (existing > 0) return; // 이미 있으면 무시

  const lastRow = sheet.getLastRow();
  const newRow  = lastRow + 1;

  sheet.getRange(newRow, COL_DATE).setValue(dateStr);
  sheet.getRange(newRow, COL_ADDED).setValue(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
  );

  // 날짜 열 숫자 형식 지정
  sheet.getRange(newRow, COL_DATE).setNumberFormat('yyyy-MM-dd');

  // 행 배경색 교대
  const bgColor = newRow % 2 === 0 ? '#fff5f8' : '#ffffff';
  sheet.getRange(newRow, 1, 1, COL_NOTE).setBackground(bgColor);
}

/* ================================================================
   레코드 삭제
================================================================ */
function deleteRecord(sheet, dateStr) {
  const row = findRow(sheet, dateStr);
  if (row > 1) sheet.deleteRow(row);
}

/* ================================================================
   전체 동기화 (앱 → 시트)
================================================================ */
function syncAll(sheet, cycles) {
  // 헤더 남기고 데이터 행 삭제
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

  // 재삽입
  cycles.forEach(c => addRecord(sheet, c.start));
  recalcAll(sheet);
}

/* ================================================================
   전체 재계산 (주기, 배란일, 황금기, 다음 생리)
================================================================ */
function recalcAll(sheet) {
  const data = getAllRecords(sheet); // [{date, row}, ...]
  if (!data.length) return;

  // 날짜 기준 정렬 (오래된 것 먼저)
  data.sort((a, b) => new Date(a.date) - new Date(b.date));

  const avgLen = calcAvgCycleLength(data);

  data.forEach((rec, i) => {
    const startDate  = new Date(rec.date);
    const periodLen  = 5; // 기본 생리 기간

    // 주기 계산 (이전 기록과의 차이)
    let cycleLen = '';
    if (i > 0) {
      const prev = new Date(data[i - 1].date);
      cycleLen   = Math.round((startDate - prev) / 86400000);
    }

    // 예상 배란일 (시작일 + 주기/2 - 14)
    const effectiveCycle = typeof cycleLen === 'number' && cycleLen > 0
      ? cycleLen : avgLen;
    const ovulDate    = new Date(startDate);
    ovulDate.setDate(startDate.getDate() + Math.round(effectiveCycle / 2) - 2);

    // 황금기 (생리 종료 다음날 ~ +7일)
    const goldenStart = new Date(startDate);
    goldenStart.setDate(startDate.getDate() + periodLen);
    const goldenEnd   = new Date(goldenStart);
    goldenEnd.setDate(goldenStart.getDate() + 6);

    // 다음 생리 예정일
    const nextPeriod  = new Date(startDate);
    nextPeriod.setDate(startDate.getDate() + effectiveCycle);

    const fmt = d => Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');

    const row = rec.row;
    sheet.getRange(row, COL_CYCLE).setValue(cycleLen || '—');
    sheet.getRange(row, COL_OVUL).setValue(fmt(ovulDate));
    sheet.getRange(row, COL_GOLDEN_S).setValue(fmt(goldenStart));
    sheet.getRange(row, COL_GOLDEN_E).setValue(fmt(goldenEnd));
    sheet.getRange(row, COL_NEXT).setValue(fmt(nextPeriod));

    // 배란일 셀 보라색 강조
    sheet.getRange(row, COL_OVUL).setBackground('#e8d5f5');
    // 황금기 셀 황금색 강조
    sheet.getRange(row, COL_GOLDEN_S).setBackground('#fef3c7');
    sheet.getRange(row, COL_GOLDEN_E).setBackground('#fef3c7');
  });

  SpreadsheetApp.flush();
}

/* ================================================================
   평균 주기 계산
================================================================ */
function calcAvgCycleLength(sortedData) {
  if (sortedData.length < 2) return 28;
  const diffs = [];
  for (let i = 1; i < sortedData.length; i++) {
    const d = Math.round(
      (new Date(sortedData[i].date) - new Date(sortedData[i - 1].date)) / 86400000
    );
    if (d > 15 && d < 90) diffs.push(d);
  }
  if (!diffs.length) return 28;
  return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
}

/* ================================================================
   전체 레코드 조회
================================================================ */
function getAllRecords(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const records = [];
  for (let r = 2; r <= lastRow; r++) {
    const val = sheet.getRange(r, COL_DATE).getValue();
    if (!val) continue;
    const dateStr = (val instanceof Date)
      ? Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(val).trim();
    records.push({ date: dateStr, row: r });
  }
  return records;
}

/* ================================================================
   특정 날짜 행 번호 찾기
================================================================ */
function findRow(sheet, dateStr) {
  const lastRow = sheet.getLastRow();
  for (let r = 2; r <= lastRow; r++) {
    const val = sheet.getRange(r, COL_DATE).getValue();
    if (!val) continue;
    const d = (val instanceof Date)
      ? Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(val).trim();
    if (d === dateStr) return r;
  }
  return -1;
}

/* ================================================================
   응답 헬퍼
================================================================ */
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================================================
   스프레드시트 메뉴 추가 (수동 실행용)
================================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🌸 사이클 트래커')
    .addItem('헤더 재설정', 'resetHeader')
    .addItem('전체 재계산', 'manualRecalc')
    .addItem('샘플 데이터 추가', 'addSampleData')
    .addToUi();
}

function resetHeader() {
  const sheet = getOrCreateSheet();
  setupHeader(sheet);
  SpreadsheetApp.getUi().alert('헤더가 재설정되었습니다.');
}

function manualRecalc() {
  const sheet = getOrCreateSheet();
  recalcAll(sheet);
  SpreadsheetApp.getUi().alert('재계산이 완료되었습니다.');
}

function addSampleData() {
  const sheet = getOrCreateSheet();
  const samples = [
    '2025-01-05', '2025-02-02', '2025-03-02',
    '2025-03-30', '2025-04-27', '2025-05-25'
  ];
  samples.forEach(d => addRecord(sheet, d));
  recalcAll(sheet);
  SpreadsheetApp.getUi().alert('샘플 데이터가 추가되었습니다.');
}
