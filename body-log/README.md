# 🥗 Body Log – 쿠쿠 식단 기록

개인의 식단 및 활동량을 체계적으로 기록하고, AI로 맞춤형 영양 피드백을 받는 Full-Stack 웹 애플리케이션입니다.

---

## 🚀 프로젝트 개요

- **목적**: 간편한 식단·활동량 기록과 AI 기반 개인 맞춤 피드백 제공
- **주요 타겟**: 체중 관리 및 식습관 개선을 목표로 하는 사용자
- **형태**: PWA (Progressive Web App) — 모바일 홈 화면에 설치 가능

---

## 🛠 기술 스택

### Frontend
| 항목 | 내용 |
|------|------|
| Framework | React 19 (Functional Components, Hooks) |
| Language | TypeScript (Strict Type Safety) |
| Bundler | Vite |
| Styling | Tailwind CSS 4.0 (Native CSS-in-JS utility blocks) |
| Animation | Framer Motion (`motion/react`) |
| PWA | Service Worker + Manifest 기반 모바일 웹 앱 지원 |

### Backend & Database
| 항목 | 내용 |
|------|------|
| Serverless Backend | Google Apps Script (GAS) |
| Database | Google Sheets (Spreadsheet DB) |
| 통신 방식 | REST API (doGet / doPost) 기반 비동기 통신 |

### AI
| 항목 | 내용 |
|------|------|
| AI 엔진 | Google Gemini 1.5 Flash (`@google/generative-ai`) |
| 분석 범위 | 식단 기록 + 활동 데이터 → 종합 리포트 생성 |
| 조언 기준 | TDEE(총 에너지 소비량) 기반 정밀 피드백 |

---

## 📋 핵심 기능

### 🍴 식단 기록 및 관리
- **끼니별 기록**: 아침 · 점심 · 간식 · 저녁 구분 입력
- **계획 vs 실제**: 식단 계획(PLANNED)과 실제 섭취(ACTUAL) 상태 분리 관리
- **영양 성분 자동 계산**: 즐겨찾기 기반 식재료 DB 연동 → 탄수화물·단백질·지방·당·식이섬유 자동 요약
- **일일 목표 설정**: 목표 칼로리 및 영양성분 설정, 전날 목표치를 오늘 초기값으로 자동 승계
- **매크로 자동 계산기**: 목표 칼로리 입력 시 탄:단:지 비율(단백질 120g 고정, 나머지 7:3 자동 배분)에 따라 각 영양소 자동 계산

### 🏃 활동 및 건강 일기
- **활동 로그**: 걸음 수, 활동 칼로리, 총 소모 칼로리 기록 및 사진 업로드 지원
- **건강 일기**: 텍스트 기반 일일 컨디션·일기 기록 (UUID 기반 업데이트)
- **메모 시스템**: 간단한 텍스트 메모 (무한 스크롤, 최신순 정렬)

### 🤖 AI 영양 추천
일일 섭취량 및 활동량을 기반으로 Gemini AI가 4개 섹션의 분석 리포트를 생성합니다.

| 섹션 | 내용 |
|------|------|
| `[총평]` | 오늘 하루 전반적인 식단·활동 총평 |
| `[활동량 평가]` | 걸음 수 및 소모 칼로리 기반 활동 평가 |
| `[식단 평가]` | 섭취 칼로리·영양 균형 평가 |
| `[응원과 추천]` | 맞춤형 개선 제안 및 응원 메시지 |

- 중복 요청 방지 로직(Ref / Refetch guard) 탑재
- 분석 결과 Google Sheets에 자동 저장

---

## 💾 데이터 아키텍처

Google Sheets를 DB로 사용하며, 시트별 역할은 다음과 같습니다.

| 시트 이름 | 설명 | 주요 필드 |
|:---|:---|:---|
| `meals` | 식단 기록 | uuid, date, type, status, kcal, carbs, protein, fat… |
| `ingredients` | 식재료 DB | uuid, name, base_amount, kcal, is_bookmarked… |
| `diaries` | 건강 일기 | uuid, date, content, updated_at |
| `activity_logs` | 활동 로그 | uuid, date, steps, calories, image_url… |
| `AI_Recommendations` | AI 조언 내역 | date, advice, created_at |
| `nutrient_targets` | 일일 영양 목표 | date, kcal, carbs, protein, fat |
| `memos` | 메모 | id, content, createdat |

---

## 📁 파일 구성

```
body-log/
├── index.html       ← PWA 메인 앱 (React SPA 진입점)
├── manifest.json    ← PWA 설치 설정
├── sw.js            ← Service Worker (오프라인 지원)
├── GAS.gs           ← Google Apps Script (백엔드 + DB 연동)
├── icon-192.png     ← 앱 아이콘 (192×192)
└── icon-512.png     ← 앱 아이콘 (512×512)
```

---

## 🚀 배포 방법

### 1단계: PWA 앱 배포

**방법 A: GitHub Pages (무료, 추천)**
1. GitHub 저장소 생성
2. 파일 전체 업로드
3. Settings → Pages → Source: `main` 브랜치 선택
4. 생성된 URL을 스마트폰 브라우저에서 열기
5. 브라우저 메뉴 → "홈 화면에 추가" → 앱 설치 완료 📱

**방법 B: 로컬 테스트**
```bash
# Python 3
python -m http.server 8080
# Node.js
npx serve .
```
> ⚠️ Service Worker는 HTTPS 또는 localhost에서만 작동합니다.

---

### 2단계: Google Sheets 연동

1. Google Drive에서 새 스프레드시트 생성
2. **확장 프로그램 → Apps Script** 진입
3. `GAS.gs` 내용 전체를 붙여넣고 저장
4. **배포 → 새 배포 → 웹 앱** 선택
   - 실행 사용자: 본인 계정
   - 액세스 권한: **모든 사용자 (익명 포함)**
5. 생성된 웹 앱 URL을 앱 설정에 입력

---

## ⚙️ 주요 기술 특이사항

- **KST 전용 날짜 처리**: 한국 표준시(UTC+9) 기준 정밀 날짜·시간 동기화
- **Optimistic UI**: GAS 응답 딜레이를 감안한 로컬 상태 선반영 + 로딩 처리
- **토스트 알림**: 저장·수정·복사 등 작업 결과를 즉각 피드백하는 UI
- **관리자 접근 제어**: 특정 UI 요소 다회 클릭을 통한 스프레드시트 링크 노출 로직

---

*Developed with Google AI Studio & Gemini API*
