# Body Log

체중·생리주기를 함께 기록하고 호르몬 흐름과 연계해 분석하는 여성 건강 트래커 PWA.

---

## 프로젝트 개요

Body Log는 체중 변화를 생리주기 단계와 함께 시각화하여, 호르몬에 의한 체중 변동을 구분할 수 있도록 돕는 개인 건강 기록 앱입니다. 별도의 서버 인프라 없이 **Google Sheets를 백엔드 DB**로 활용하며, 앱 자체는 GitHub Pages에서 정적으로 제공됩니다. 오프라인에서도 동작하며 홈 화면에 설치 가능한 PWA로 구현되어 있습니다.

---

## 기술 스택

### 프론트엔드

| 항목 | 내용 |
|------|------|
| 구조 | Vanilla HTML/CSS/JS (단일 파일 `index.html`) |
| 폰트 | DM Sans, DM Serif Display (Google Fonts) |
| 차트 | Canvas API 직접 구현 (체중 트렌드, 호르몬 주기 그래프) |
| PWA | Web App Manifest + Service Worker (`sw.js`) |
| 캐싱 전략 | HTML → Network-first / 정적 자산 → Cache-first |
| 오프라인 저장 | `localStorage` (앱 상태 전체 캐시) |
| 배포 | GitHub Pages (`/body-log/`) |

### 백엔드

| 항목 | 내용 |
|------|------|
| 런타임 | Google Apps Script (GAS) |
| 데이터 저장소 | Google Sheets (3개 시트) |
| API 방식 | GAS 웹 앱 배포 → HTTP GET / POST 엔드포인트 |
| 인증 | 익명 공개 접근 (개인 사용 목적) |
| 파일 | `GAS.gs` |

---

## 핵심 기능

### 홈 탭
- **오늘 카드**: 날짜, 생리주기 단계 배지, 수분저류 확률 바 표시
- **측정 추천 배너**: 주기 단계에 따라 "황금기(측정 최적)", "체중측정 비추" 등 맥락 안내
- **인라인 입력 폼**: 체중·허리·허벅지 + 메모를 접이식 폼으로 간편 입력
- **트렌드 차트**: 30일 / 3개월 / 6개월 체중 추이 (Canvas)
- **통계 스트립**: 황금기 평균 체중, 전월 대비 변화, 이번 달 기록 횟수
- **메모**: 자유 텍스트 메모, Google Sheets에 단독 동기화 가능

### 달력 탭
- **생리주기 컬러 달력**: 황금기(주황), 생리기간(회색), 배란예정(초록), 가임기, 황체기 등 단계별 색상 구분
- **호르몬 주기 그래프**: 에스트로겐·프로게스테론·수분저류·체중 4개 레이어 Canvas 그래프, 레이어 개별 토글 가능
- **날짜 선택 인터랙션**: 달력 날짜 클릭 → 해당일 주기 단계·체중 기록 바로 입력

### 기록 탭
- 전체 체중 기록 목록
- **황금기만 보기** 필터 토글
- 최저 체중 행 하이라이트 표시

### 주기 탭
- 생리 시작일 입력 및 삭제·수정
- 평균 주기·생리 기간·기록 횟수 통계
- 과거 기록 기반 평균 주기 자동 산출 (15~90일 범위의 간격만 사용)

### 설정 & 동기화
- 기본 주기·생리 기간 커스텀 설정
- Google Sheets URL 연동 → 양방향 실시간 동기화
- 로고 트리플 클릭 → Google Sheets 직접 열기

---

## 데이터 아키텍처

### 흐름 개요

```
[PWA / localStorage]  <--->  [Google Apps Script Web App]  <--->  [Google Sheets]
     (클라이언트 캐시)           (HTTP GET/POST 라우터)              (영구 저장소)
```

앱 실행 시 `localStorage`에서 즉시 렌더링하고, 백그라운드에서 GAS 엔드포인트를 호출해 최신 데이터를 가져옵니다. 변경 사항은 GAS로 POST되어 시트에 반영됩니다.

### Google Sheets 시트 구조

#### `weight_log` — 체중 기록

| 컬럼 | 설명 |
|------|------|
| 날짜 (PK) | `YYYY-MM-DD`, 하루 1건 보장 (UPSERT) |
| 체중 (kg) | |
| 허리 (cm) | |
| 허벅지 (cm) | |
| 체지방률 (%) | |
| 메모 | |
| 수정일시 | |
| 생리주기단계 | 저장 시점에 자동 계산하여 기록 |
| uuid | 행 추적용 UUID |

#### `cycle_log` — 생리주기 기록

| 컬럼 | 설명 |
|------|------|
| id (UUID, PK) | 시작일 수정 시에도 행 추적 가능 |
| 생리시작일 | |
| 주기 (일) | `recalcCycles()` 자동 계산 |
| 생리기간 (일) | |
| 배란예정일 | 평균 주기 ÷ 2 − 2일 |
| 황금기 시작/종료 | 생리 종료 후 7일 구간 |
| 다음 생리 예정 | |
| 등록일시 / 수정일시 | |

#### `memo` — 단일 메모

| 컬럼 | 설명 |
|------|------|
| uuid | UPSERT 키 |
| memo | 메모 내용 |
| updated | 수정일시 |

### GAS API 액션 목록

| Action | 메서드 | 설명 |
|--------|--------|------|
| `GET_ALL` | GET | 시트 전체 데이터 → 앱으로 반환 |
| `WEIGHT` | POST | 체중 기록 저장/수정 (날짜 기준 UPSERT) |
| `WEIGHT_DELETE` | POST | 체중 기록 삭제 |
| `CYCLE_ADD` | POST | 생리 시작일 추가 (UUID 포함) |
| `CYCLE_UPDATE` | POST | 생리 시작일 수정 (UUID로 행 찾아 수정) |
| `CYCLE_DELETE` | POST | 생리 기록 삭제 (UUID 기준) |
| `MEMO_SAVE` | POST | 메모 저장/수정 (단일, 덮어쓰기) |
| `SYNC_ALL` | POST | 앱 전체 데이터 → 시트 일괄 동기화 |

### 로컬 상태 구조 (`localStorage`)

```json
{
  "weight": {
    "2025-05-15": { "id": "uuid", "weight": 57.2, "waist": 70, "thigh": 53, "bodyfat": 23.5, "memo": "황금기" }
  },
  "cycles": [
    { "id": "uuid", "start": "2025-05-26" }
  ],
  "settings": { "defaultCycleLen": 28, "defaultPeriodLen": 5 },
  "memo": { "id": "uuid", "content": "...", "updatedAt": "2025-05-15 10:00:00" }
}
```

---

## 설치 방법 (GAS 백엔드)

1. Google Sheets 새 문서 생성
2. 확장프로그램 → Apps Script → `GAS.gs` 전체 붙여넣기
3. 저장 후 **배포 → 새 배포 → 유형: 웹 앱**
   - 실행 계정: 나(본인)
   - 액세스: 모든 사용자(익명 포함)
4. 배포 URL을 앱 설정 패널의 Google Sheets URL 입력란에 입력
