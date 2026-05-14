/**
 * ================================================================
 *  Body Log – Google Apps Script 백엔드 v2
 *  https://9hyojeong-byte.github.io/body-log/
 * ================================================================
 *
 *  [시트 구조]
 *  ┌──────────────────────────────────────────────────────┐
 *  │ weight_log │ 날짜(PK) | 체중 | 허리 | 허벅지 | ...  │
 *  │ cycle_log  │ id(UUID) | 생리시작일 | 주기 | ...      │
 *  │ memo       │ 키       | 내용       | 수정일시        │
 *  └──────────────────────────────────────────────────────┘
 *
 *  [설계 원칙]
 *  - weight_log : 날짜(YYYY-MM-DD)가 PK — 하루 1건 보장
 *  - cycle_log  : UUID(id)가 PK — 시작일을 수정해도 행 추적 가능
 *
 *  [설치 방법]
 *  1. Google Sheets 새 문서 생성
 *  2. 확장프로그램 → Apps Script → 이 코드 전체 붙여넣기
 *  3. 저장 후 "배포" → "새 배포" → 유형: 웹 앱
 *     - 실행 계정: 나(본인)
 *     - 액세스: 모든 사용자(익명 포함)
 *  4. 배포 URL을 앱 ⚙️ 설정 > Google Sheets URL에 입력
 *
 *  [PWA → GAS action 목록]
 *  WEIGHT          체중 기록 저장/수정 (날짜 기준 UPSERT)
 *  WEIGHT_DELETE   체중 기록 삭제
 *  CYCLE_ADD       생리 시작일 추가 (UUID 포함)
 *  CYCLE_UPDATE    생리 시작일 수정 (UUID로 행 찾아서 수정)
 *  CYCLE_DELETE    생리 기록 삭제 (UUID 기준)
 *  MEMO_SAVE       메모 저장/수정 (단일 메모, 덮어쓰기)
 *  SYNC_ALL        앱 전체 데이터 → 시트 일괄 동기화
 *  GET_ALL         시트 전체 데이터 → 앱으로 반환
 * ================================================================
 */

const SHEET_WEIGHT = 'weight_log';
const SHEET_CYCLE  = 'cycle_log';
const SHEET_MEMO   = 'memo';
const TZ           = Session.getScriptTimeZone();

/* ════════════════════════════════════════
   GET: 전체 데이터 반환
════════════════════════════════════════ */
function doGet(e) {
  try {
    return respond({ status: 'ok', weight: getAllWeight(), cycles: getAllCycles(), memo: getMemo() });
  } catch (err) {
    return respond({ status: 'error', message: err.message });
  }
}

/* ════════════════════════════════════════
   POST: action 라우팅
════════════════════════════════════════ */
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    const date   = body.date;
    const data   = body.data || {};

    switch (action) {

      case 'WEIGHT':
        if (!date || !data.weight) throw new Error('date, data.weight 필수');
        upsertWeight(date, data);
        return respond({ status: 'ok', message: date + ' 체중 저장됨' });

      case 'WEIGHT_DELETE':
        if (!date) throw new Error('date 필수');
        deleteWeight(date);
        return respond({ status: 'ok', message: date + ' 체중 삭제됨' });

      case 'CYCLE_ADD':
        if (!date || !data.id) throw new Error('date, data.id 필수');
        addCycleRow(data.id, date);
        recalcCycles();
        return respond({ status: 'ok', message: date + ' 생리 기록 추가됨' });

      case 'CYCLE_UPDATE':
        if (!date || !data.id) throw new Error('date, data.id 필수');
        updateCycleRow(data.id, date);
        recalcCycles();
        return respond({ status: 'ok', message: data.id + ' 생리 기록 수정됨' });

      case 'CYCLE_DELETE':
        if (!data.id) throw new Error('data.id 필수');
        deleteCycleById(data.id);
        recalcCycles();
        return respond({ status: 'ok', message: data.id + ' 생리 기록 삭제됨' });

      case 'MEMO_SAVE':
        if (!data.id) throw new Error('data.id 필수');
        saveMemoSheet(data.id, data.content || '', data.updatedAt || '');
        return respond({ status: 'ok', message: '메모 저장됨' });

      case 'SYNC_ALL':
        syncAllWeight(body.weight || {});
        syncAllCycles(body.cycles || []);
        if (body.memo && body.memo.id) saveMemoSheet(body.memo.id, body.memo.content || '', body.memo.updatedAt || '');
        return respond({ status: 'ok', message: '전체 동기화 완료' });

      case 'GET_ALL':
        return respond({ status: 'ok', weight: getAllWeight(), cycles: getAllCycles(), memo: getMemo() });

      default:
        return respond({ status: 'error', message: '알 수 없는 action: ' + action });
    }
  } catch (err) {
    return respond({ status: 'error', message: err.message });
  }
}

/* ════════════════════════════════════════
   WEIGHT 시트
   PK: 날짜(A열) — 하루 1건
   컬럼: 날짜 | 체중 | 허리 | 허벅지 | 체지방률 | 메모 | 수정일시 | 생리주기단계
════════════════════════════════════════ */
function getOrCreateWeightSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_WEIGHT);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_WEIGHT);
    const h = ['날짜','체중(kg)','허리(cm)','허벅지(cm)','체지방률(%)','메모','수정일시','생리주기단계'];
    sheet.getRange(1,1,1,h.length).setValues([h])
         .setBackground('#1a1a1a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,110); sheet.setColumnWidth(6,200);
    sheet.setColumnWidth(7,160); sheet.setColumnWidth(8,120);
  }
  return sheet;
}

function findWeightRow(sheet, dateStr) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const vals = sheet.getRange(2,1,last-1,1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (fmtDate(vals[i][0]) === dateStr) return i + 2;
  }
  return -1;
}

function upsertWeight(dateStr, data) {
  const sheet    = getOrCreateWeightSheet();
  const stage    = getCycleStage(dateStr);
  const now      = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const row      = [dateStr, data.weight||'', data.waist||'', data.thigh||'',
                    data.bodyfat||'', data.memo||'', now, stage];
  const existing = findWeightRow(sheet, dateStr);
  if (existing > 0) {
    sheet.getRange(existing,1,1,row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    sortSheetByCol(sheet, 1);
  }
  applyWeightRowColor(sheet, dateStr, stage);
  SpreadsheetApp.flush();
}

function deleteWeight(dateStr) {
  const sheet = getOrCreateWeightSheet();
  const row   = findWeightRow(sheet, dateStr);
  if (row > 1) { sheet.deleteRow(row); SpreadsheetApp.flush(); }
}

function getAllWeight() {
  const sheet = getOrCreateWeightSheet();
  const last  = sheet.getLastRow();
  if (last < 2) return {};
  const rows = sheet.getRange(2,1,last-1,6).getValues();
  const out  = {};
  rows.forEach(r => {
    const d = fmtDate(r[0]);
    if (!d) return;
    out[d] = { weight: toNum(r[1]), waist: toNum(r[2]), thigh: toNum(r[3]),
               bodyfat: toNum(r[4]), memo: String(r[5]||'') };
  });
  return out;
}

function syncAllWeight(weightObj) {
  const sheet = getOrCreateWeightSheet();
  const last  = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last-1);
  Object.entries(weightObj).forEach(([d,data]) => upsertWeight(d, data));
}

/* ════════════════════════════════════════
   CYCLE 시트
   PK: id(UUID, A열) — 시작일 수정 시에도 행 추적 가능
   컬럼: id | 생리시작일 | 주기(일) | 생리기간(일) | 배란예정일
         | 황금기시작 | 황금기종료 | 다음생리예정 | 등록일시 | 수정일시
════════════════════════════════════════ */
function getOrCreateCycleSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CYCLE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CYCLE);
    const h = ['id(UUID)','생리시작일','주기(일)','생리기간(일)',
               '배란예정일','황금기시작','황금기종료','다음생리예정','등록일시','수정일시'];
    sheet.getRange(1,1,1,h.length).setValues([h])
         .setBackground('#1a1a1a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,260);  // UUID
    sheet.setColumnWidth(2,110);
    [5,6,7,8].forEach(c => sheet.setColumnWidth(c,120));
    sheet.setColumnWidth(9,160); sheet.setColumnWidth(10,160);
  }
  return sheet;
}

/** UUID로 행 번호 반환 */
function findCycleRowById(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const ids = sheet.getRange(2,1,last-1,1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === id) return i + 2;
  }
  return -1;
}

function addCycleRow(id, dateStr) {
  const sheet = getOrCreateCycleSheet();
  if (findCycleRowById(sheet, id) > 0) return; // 중복 방지
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([id, dateStr, '', '', '', '', '', '', now, '']);
  sortSheetByCol(sheet, 2); // 생리시작일 기준 정렬
  SpreadsheetApp.flush();
}

/** UUID로 행을 찾아서 생리시작일 수정 */
function updateCycleRow(id, newDateStr) {
  const sheet = getOrCreateCycleSheet();
  const row   = findCycleRowById(sheet, id);
  if (row < 2) throw new Error('ID를 찾을 수 없음: ' + id);
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  sheet.getRange(row, 2).setValue(newDateStr);  // 생리시작일만 수정
  sheet.getRange(row, 10).setValue(now);        // 수정일시 갱신
  sortSheetByCol(sheet, 2);
  SpreadsheetApp.flush();
}

/** UUID로 행 삭제 */
function deleteCycleById(id) {
  const sheet = getOrCreateCycleSheet();
  const row   = findCycleRowById(sheet, id);
  if (row > 1) { sheet.deleteRow(row); SpreadsheetApp.flush(); }
}

/**
 * 전체 생리 기록 재계산
 * 주기, 배란예정일, 황금기, 다음생리예정일 자동 업데이트
 */
function recalcCycles() {
  const sheet = getOrCreateCycleSheet();
  const last  = sheet.getLastRow();
  if (last < 2) return;

  const rows = sheet.getRange(2,1,last-1,2).getValues();
  const items = rows
    .map((r,i) => ({ row: i+2, id: String(r[0]).trim(), date: toDateObj(r[1]) }))
    .filter(x => x.date && x.id)
    .sort((a,b) => a.date - b.date);

  if (!items.length) return;

  // 평균 주기
  const diffs = [];
  for (let i = 1; i < items.length; i++) {
    const d = (items[i].date - items[i-1].date) / 86400000;
    if (d > 15 && d < 90) diffs.push(d);
  }
  const avgCycle = diffs.length
    ? Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length) : 28;
  const periodLen = 5;

  items.forEach((item, i) => {
    const start = item.date;

    // 이전 기록과의 주기
    const cycleLen = i > 0
      ? Math.round((start - items[i-1].date) / 86400000) : '—';

    const ovul   = addDays(start, Math.round(avgCycle/2) - 2);
    const gStart = addDays(start, periodLen);
    const gEnd   = addDays(gStart, 6);
    const next   = addDays(start, avgCycle);

    sheet.getRange(item.row, 3, 1, 6).setValues([[
      cycleLen, periodLen, fmt(ovul), fmt(gStart), fmt(gEnd), fmt(next)
    ]]);

    // 행 배경색 교대
    const bg = i % 2 === 0 ? '#ffffff' : '#fafafa';
    sheet.getRange(item.row,1,1,10).setBackground(bg);
    sheet.getRange(item.row,5).setBackground('#ede9fe'); // 배란예정일
    sheet.getRange(item.row,6).setBackground('#fff3e0'); // 황금기시작
    sheet.getRange(item.row,7).setBackground('#fff3e0'); // 황금기종료
  });

  sheet.getRange(1,3).setNote('평균 주기: ' + avgCycle + '일 (' + items.length + '회 기준)');
  SpreadsheetApp.flush();
}

/** 앱 형식으로 전체 생리 기록 반환: [{id, start}] */
function getAllCycles() {
  const sheet = getOrCreateCycleSheet();
  const last  = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2,1,last-1,2).getValues();
  return rows
    .map(r => {
      const id    = String(r[0]).trim();
      const start = fmtDate(r[1]);
      return (id && start) ? { id, start } : null;
    })
    .filter(Boolean);
}

function syncAllCycles(cyclesArr) {
  const sheet = getOrCreateCycleSheet();
  const last  = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last-1);
  cyclesArr.forEach(c => addCycleRow(c.id || Utilities.getUuid(), c.start));
  recalcCycles();
}

/* ════════════════════════════════════════
   MEMO 시트
   단일 메모 — UUID(A열)로 UPSERT
   컬럼: uuid | memo | updated
════════════════════════════════════════ */
function getOrCreateMemoSheet() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_MEMO);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MEMO);
    const h = ['uuid','memo','updated'];
    sheet.getRange(1,1,1,h.length).setValues([h])
         .setBackground('#1a1a1a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,280);
    sheet.setColumnWidth(2,420);
    sheet.setColumnWidth(3,160);
  }
  return sheet;
}

function saveMemoSheet(id, content, updatedAt) {
  const sheet = getOrCreateMemoSheet();
  const ts    = updatedAt || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const last  = sheet.getLastRow();
  if (last >= 2) {
    const uuids = sheet.getRange(2,1,last-1,1).getValues();
    for (let i = 0; i < uuids.length; i++) {
      if (String(uuids[i][0]).trim() === id) {
        sheet.getRange(i+2, 2, 1, 2).setValues([[content, ts]]);
        SpreadsheetApp.flush();
        return;
      }
    }
  }
  sheet.appendRow([id, content, ts]);
  SpreadsheetApp.flush();
}

function getMemo() {
  const sheet = getOrCreateMemoSheet();
  const last  = sheet.getLastRow();
  if (last < 2) return { id: '', content: '', updatedAt: '' };
  const rows = sheet.getRange(2,1,last-1,3).getValues();
  const r = rows[0];
  return { id: String(r[0]||''), content: String(r[1]||''), updatedAt: String(r[2]||'') };
}

/* ════════════════════════════════════════
   유틸리티
════════════════════════════════════════ */
function sortSheetByCol(sheet, col) {
  const last = sheet.getLastRow();
  if (last < 3) return;
  sheet.getRange(2,1,last-1,sheet.getLastColumn()).sort({ column: col, ascending: true });
}

function toDateObj(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(String(val).trim());
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(val) {
  if (!val) return '';
  const d = toDateObj(val);
  return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : '';
}

function fmt(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toNum(v) { return v !== '' && v !== null ? Number(v) : null; }

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 날짜의 생리주기 단계 계산 */
function getCycleStage(dateStr) {
  const cycles = getAllCycles();
  if (!cycles.length) return '';
  const sorted = cycles.map(c => new Date(c.start)).sort((a,b) => b-a);
  const diffs  = [];
  for (let i = 0; i < sorted.length-1; i++) {
    const d = (sorted[i]-sorted[i+1])/86400000;
    if (d>15&&d<90) diffs.push(d);
  }
  const cl = diffs.length ? Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length) : 28;
  const pl = 5;
  const dt = new Date(dateStr);

  function check(start) {
    const day = Math.floor((dt-start)/86400000);
    if (day<0||day>=cl) return null;
    if (day===0)        return '생리시작';
    if (day<pl)         return '생리기간';
    if (day<pl+7)       return '황금기';
    const od = Math.round(cl/2)-2;
    if (day>=od-2&&day<=od+2) return day===od?'배란예정':'가임기';
    if (day>=cl-7)      return '체중측정비추';
    return '일반';
  }
  for (const s of sorted) { const r=check(s); if(r) return r; }
  for (let i=1;i<=3;i++) {
    const p=new Date(sorted[0]); p.setDate(sorted[0].getDate()+cl*i);
    const r=check(p); if(r) return r;
  }
  return '일반';
}

/** 체중 행 생리주기 단계별 배경색 */
function applyWeightRowColor(sheet, dateStr, stage) {
  const row = findWeightRow(sheet, dateStr);
  if (row < 2) return;
  const COLOR = {
    '황금기':'#fff3e0', '체중측정비추':'#fce4ec',
    '생리시작':'#f3e5f5', '생리기간':'#f3e5f5',
    '배란예정':'#ede9fe', '가임기':'#e8eaf6', '일반':'#ffffff', '':'#ffffff'
  };
  sheet.getRange(row,1,1,sheet.getLastColumn()).setBackground(COLOR[stage]||'#ffffff');
}

/* ════════════════════════════════════════
   스프레드시트 메뉴
════════════════════════════════════════ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏋️ Body Log')
    .addItem('시트 초기화',        'initSheets')
    .addItem('주기 재계산',        'recalcCycles')
    .addSeparator()
    .addItem('샘플 데이터 추가',   'addSampleData')
    .addItem('전체 데이터 초기화', 'clearAllData')
    .addToUi();
}

function initSheets() {
  getOrCreateWeightSheet();
  getOrCreateCycleSheet();
  getOrCreateMemoSheet();
  SpreadsheetApp.getUi().alert('✅ 시트 초기화 완료');
}

function addSampleData() {
  const ui  = SpreadsheetApp.getUi();
  const res = ui.alert('샘플 데이터를 추가할까요?\n(기존 데이터는 유지됩니다)', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  [['2025-02-01'],['2025-03-01'],['2025-03-30'],['2025-04-28'],['2025-05-26']]
    .forEach(([d]) => addCycleRow(Utilities.getUuid(), d));
  recalcCycles();
  [['2025-05-01',{weight:58.2,waist:72,thigh:54,bodyfat:24.1,memo:'컨디션 좋음'}],
   ['2025-05-10',{weight:58.5,waist:72,thigh:54,bodyfat:24.3,memo:'생리 전 부기'}],
   ['2025-05-15',{weight:57.2,waist:70,thigh:53,bodyfat:23.5,memo:'황금기'}],
   ['2025-05-20',{weight:57.5,waist:71,thigh:53,bodyfat:23.7,memo:''}]]
    .forEach(([d,data]) => upsertWeight(d,data));
  ui.alert('✅ 샘플 데이터 추가 완료');
}

function clearAllData() {
  const ui  = SpreadsheetApp.getUi();
  const res = ui.alert('⚠️ 모든 데이터를 삭제할까요?\n되돌릴 수 없습니다.', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  [SHEET_WEIGHT, SHEET_CYCLE].forEach(name => {
    const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (s) { const l=s.getLastRow(); if(l>1) s.deleteRows(2,l-1); }
  });
  ui.alert('✅ 초기화 완료');
}
