# ④ 전체 연결과 검증

## 얼굴 보정 여백과 인접 부위 보호 — 2026-11-14

메인이 [MASTER_SPEC의 부위별 여백](../../MASTER_SPEC.md#로컬-얼굴-보정--승인된-추가-범위)을 보정 엔진에 적용한다. 보간 좌표 회귀 검사와 동일 사진의 Chrome 렌더링 전후 비교로 검증하고 결과는 STATE에 기록한다.

## 개인 얼굴 분석 재시도 — 2026-11-13

메인이 개인 보정기와 브라우저 Worker 호출을 담당한다. [MASTER_SPEC](../../MASTER_SPEC.md#협업-보정방--별도-경로에-보존)의 재시도·터치 전환 규칙을 적용하고, 오류·얼굴 없음·마스크 밖 얼굴 및 저장 경로를 브라우저에서 검사한다.

## iOS 얼굴 분석 초기화 — 2026-11-13

메인이 보정 Worker의 캔버스 전달과 진단 분류를 담당한다. [MASTER_SPEC](../../MASTER_SPEC.md#협업-보정방--별도-경로에-보존)의 기록 범위에 따라 실제 모델·WASM의 초기화/선택 영역 분석과 브라우저→서버 실패 로그를 검사한다.

## 사진 내부 확대 — 2026-11-12

메인이 `core/photo-viewport.ts`와 영역 편집·보정기의 사진 제스처만 연결한다. 범위는 [사진 내부 확대](../../MASTER_SPEC.md#사진-내부-확대--2026-11-12)를 따르며 좌표·이동 제한 단위 검사와 `retouch-photo-zoom.spec.ts`·`playwright.photo-zoom.config.ts`의 모바일 설정 및 기존 선택 흐름으로 검증한다. Chrome의 CDP 터치와 WebKit의 합성 포인터 검증 범위를 구분한다. 변경 파일·결과·미확인 항목은 STATE에 기록한다.

## 얼굴 분석 실패 로그 — 2026-11-10

메인이 얼굴 분석 Worker·클라이언트와 `/api/retouch/diagnostics`의 실패 로그만 추가한다. 기록 범위는 [MASTER_SPEC](../../MASTER_SPEC.md#협업-보정방--별도-경로에-보존)을 따르며 분석·UI·복구 동작은 바꾸지 않는다. 실패 단계·개인정보 제외·로그 저장/전송 실패의 비간섭을 집중 검사하고 결과는 STATE에 기록한다.

## 선택 ROI 얼굴 검출 — 2026-11-10

메인이 `public/retouch/detect.worker.js`, `face-retouch/detection/`, `image-io/room-mask.ts`와 보정기 호출을 최소 수정한다. 제품 규칙은 [협업 보정방](../../MASTER_SPEC.md#협업-보정방--별도-경로에-보존)을 따른다. Worker 회귀와 얼굴 선택·공동방 브라우저 검사로 좌표 환산·중복 제거·주변 얼굴 보호·내 얼굴 박스·독립 보정 경로를 확인한다. 실제 검사 결과와 남은 일은 STATE에 기록한다.

## 내 얼굴 선택·확대 보정 분담 — 2026-11-08

- 구현 세션 1개(Sol High): `src/features/face-retouch/ui/`, `tests/e2e/retouch-face-selection.spec.ts`. 메인: `CollaborativeRoom.tsx`의 뒤로 가기 연결, 기존 회귀 검사·공통 문서·최종 검증과 Git. 같은 main checkout에서 담당 경로를 분리한다.
- 제품 동작은 [협업 보정방 규칙](../../MASTER_SPEC.md#협업-보정방--별도-경로에-보존)을 따른다. `RoomEditorProps.onBackHandlerChange`로 상세→전체 보기 처리 여부를 부모에 연결하며 API·DB·검출·보정 엔진은 변경하지 않는다.

## 계정 기능 분담 — 2026-11-08

- A: `features/account-auth/ui/`, `(account)/login,signup,forgot-password,reset-password` 화면·인증자산. C: `features/account-auth/`의 ui 외, `api/account/`의 인증 API, `auth/callback/route.ts`, 새 계정 migration 초안. B: `features/my-page/`, `(account)/mypage/`, `features/account-profile/`, `api/account/{rooms,profile,feedback,delete}`.
- 메인: 홈·기존 방 생성/참여 연결, 실제 설정/DB 적용, 공통 문서, 통합검증/Git/배포. 하위는 분리된 경로만 수정하고 패키지·DB 적용·Git·공유 빌드/서버는 메인 담당이다.

## 오류 상태 재점검 분담 — 2026-11-07

- 기존 A/B/C 분담을 유지하되 `region-editor/` 전체와 CollaborativeRoom의 검출 구독·재시도·선택 완료 action 연결은 메인이 담당한다. C는 `face-retouch/ui/`만 수정한다.
- B는 합성 상태 재접속 복구에 필요한 collaboration GET 응답과 관련 서버 테스트도 최소 수정한다. SQL·공통 계약 변경은 메인과 조율한다.

## 현재 Figma 전체 정합 작업 — 2026-11-07

- 사용자 요청: 현재 Figma에 홈·병합·공동방·개인/전체 보정·결과를 맞추고 실제 연결 검증 후 배포한다. 제품 규칙은 MASTER_SPEC을 따른다.
- 이번 분담은 아래 경로만 병렬 편집한다. 같은 main checkout을 사용한다. 하위 에이전트는 커밋·push·패키지 설치·공통 문서 수정·추가 에이전트 생성을 하지 않는다.
- 화면 A: `src/features/home/FeatureHome.tsx`, `home.module.css`, `src/app/sessions/new/page.tsx`, `src/features/merge-flow/`, `src/features/mobile-flow/SessionFlow.tsx`, `tests/e2e/merge-ui.spec.ts`, 홈 테스트, `public/images/figma-current/home/`, `merge/`.
- 화면 B: `src/features/retouch-room-entry/`, `src/features/retouch-room-flow/`, `src/features/mobile-flow/SessionEntry.tsx`, `CollaborativeRoom.tsx`, `ParticipantStatus.tsx`, `room-deletion.tsx`, `tests/e2e/retouch-room*.spec.ts`, `public/images/figma-current/room/`.
- 화면 C: `src/features/face-retouch/ui/`, `src/features/region-editor/`, `tests/e2e/retouch-ui.spec.ts`, `public/images/figma-current/editor/`.
- 메인: 공통 theme·components·globals·메타데이터·공용 브랜드 에셋·명세/상태·테스트 DB 준비·실제 연결 검증·Git/배포. 화면 간 계약 변경은 메인과 먼저 조율한다.
- 실제 Figma 노드별 get_design_context와 스크린샷을 확인하고 재사용 가능한 기존 자산을 우선한다. 결과 보고에 변경 파일·검사·부족한 부분을 남긴다.


## 홈·retouch UI 두 세션 — 2026-11-06

- 제품 범위는 [MASTER_SPEC의 UI 개편](../../MASTER_SPEC.md#기능-선택-홈과-보정-ui-개편--2026-11-06)을 따른다. 지금은 ①→② 순서로 진행하며 사진 합치기 UI는 후속 세션 ③으로 남긴다. 모델은 사용자가 요청한 Astra high, 속도 우선 설정을 사용한다.
- 세션 ①: `src/app/page.tsx`, `src/features/home/`(신규), `src/components/splash-screen.tsx`, `src/app/sessions/new/page.tsx`의 스플래시 제거 부분, `public/images/home/`(신규), `tests/e2e/home.spec.ts`(신규)만 수정한다. 기능 선택 홈을 구현하고 Figma에서 확인한 최소 CSS 변수·재사용 UI를 `src/features/home/` 안에 둔다. 기존 사진 합치기 화면의 내용은 바꾸지 않는다.
- 세션 ②: ① 완료 뒤 `src/app/retouch/`, `src/features/retouch-room-entry/`, `src/features/face-retouch/ui/`, `src/features/mobile-flow/SessionEntry.tsx`, `CollaborativeRoom.tsx`, `ParticipantStatus.tsx`, 신규 `src/features/retouch-room-flow/`, `public/images/retouch-ui/`(신규), `tests/e2e/retouch*.spec.ts`만 수정한다. ①의 스타일·UI를 읽고 재사용하며 별도 테마를 만들지 않는다. 보정 엔진·서버·저장 계약은 유지한다.
- 위 UI 경로만 이번 세션에 위임한다. 메인은 공통 문서·설정·의존성·`src/core/`·나머지 공유 파일과 최종 검증을 맡는다. ①/②는 같은 main checkout을 사용하고 worktree·추가 에이전트/채팅·설치·커밋·push·배포·DB 변경을 하지 않는다. 기존 미커밋 변경을 보존한다.
- Figma 실제 하위 프레임의 디자인 데이터·에셋을 확인하고 402px 기준 화면 비교 및 320/390px 조작을 확인한다. 새 기능·범용 디자인 시스템·보정 품질/성능 재개발로 확대하지 않는다. 각 세션은 변경 파일·실제 검사·미확인 항목과 ②가 재사용할 경로를 최종 답변에 남기고 진행 기록은 메인이 STATE에 쓴다.

## 역할과 범위

메인이 [MASTER_SPEC.md](../../MASTER_SPEC.md)의 모바일 흐름에 맞춰 ① 공유 작업, ② 영역 편집, ③ 기존 합성 기능을 연결합니다. 공통 화면·데이터 계약·설정·의존성·DB 전환과 최종 검증을 담당합니다. 진행 상황과 검증 결과는 [STATE.md](../../STATE.md)에만 기록합니다.

## 핵심 구현

- `src/features/mobile-flow/`, `src/components/mobile-shell.tsx`, 앱 페이지와 스타일: Figma 기반 단계별 화면, 저장된 데이터에 따른 복귀, 화면별 명시적 저장·재시도.
- 참여자 표시·보정본 이름과 순서는 `photo-session/edited-photo-display`를 화면들이 공유하며, 선택 파일의 새로고침 복원을 포함합니다. 제품 기준은 MASTER_SPEC을 따릅니다.
- 원본 검출 캐시·원본 선택·보정본 제출 API 연결. 대표자만 병합하고 한 명 이상 제출하면 부분 병합하는 조건은 서버 규칙을 사용합니다.
- 현황 화면에서만 조회하며 편집 중인 초안을 초기화하지 않습니다. 개인·겹침 수정의 미저장 이동을 안내합니다.
- Vercel의 가벼운 API와 Mac pull 워커의 배포·로그인 자동 실행 구성을 관리합니다. 업로드 후 원본 분석·중복 작업 공유·상태 조회와 중단 복구는 MASTER_SPEC의 규칙을 따릅니다.

## 확인 기준

- PC 402px와 휴대폰 전체 폭, 선택·업로드·제출·결과 화면의 버튼 이동과 하단 안전 영역.
- 공유 ID와 다중 ID, 윤곽선 수정, 보정본의 동일 좌표, 저장 후 재접속·복구.
- 한 명 이상 제출 후 대표자만 병합하고 미제출 영역은 원본으로 유지하며 모두 원본 해상도 PNG 다운로드.
- 참여자의 직접 병합 요청 거절, 저장 충돌, 크기 불일치·검출·업로드 실패 후 재시도, 만료 안내.
- 선택 밖 원본 유지, 선택 안의 보정본 출처, 기존 겹침 수정과 다시 합성.
- 실제 휴대폰·사용자 보정 사진의 경계 품질·공개 서버는 별도 확인하며 로컬 화면이나 컨테이너 검사로 완료 처리하지 않습니다.

- 원본 업로드 응답 선행, 탭 종료 뒤 분석 완료, 동시 요청의 단일 실행, 워커 재시작 후 DB 대기열 재개와 편집 초안 보존을 검증합니다.

## 승인된 로컬 보정기

코 5항목은 `effects/nose.ts`의 보호 가중치·콧대/콧등 연결 계산과 기존 `operations.ts`·`engine/field.ts`에 한정한다. 해당 항목 설명은 `state/model.ts`에 맞추고 `nose.test.ts`·`tests/e2e/retouch-nose.spec.ts`에서 좌우 변형·콧구멍 가장자리의 움직임·연결·눈/입술 보존·PNG를 확인한다. 제품 동작과 결과는 MASTER_SPEC·STATE를 따른다.

입술 상하 위치는 기존 `effects/lips.ts`에 입 전체의 균일 이동·코밑 고정·주변 연결 계산을 추가하고 `operations.ts`·`engine/field.ts`에만 연결한다. `lip-position.test.ts`와 `tests/e2e/retouch-lip-position.spec.ts`에서 입 모양·코 픽셀·보간·중립 복귀·PNG를 검사하며 제품 동작과 결과는 MASTER_SPEC·STATE를 따른다.

눈 높이·앞트임·충혈·밑트임은 `effects/eyes.ts`의 눈 윤곽·보호 가중치를 기존 `operations.ts`·`field.ts`·`sclera.ts`·`renderer.ts`에 연결한다. `eyes.test.ts`와 `tests/e2e/retouch-eyes.spec.ts`에서 메이크업 이동·눈동자 보호·밝기 증가·PNG를 검사하며 제품 규칙과 결과는 MASTER_SPEC·STATE를 따른다.

얼굴형 보완은 `effects/face-shape.ts`의 윤곽 연결·하안부 역좌표 계산과 `operations.ts`의 해당 세 항목에 한정한다. `engine/field.ts`는 이 계산을 기존 원본 샘플링·소유 영역 보호·안전 제한에 연결한다. 기능 옆 `face-shape.test.ts`와 `tests/e2e/retouch-face-shape.spec.ts`에서 윤곽 연속성·눈 보호·입 형태와 비율·이웃 얼굴 보호·PNG 저장을 확인한다. 제품 기준·진행 결과는 MASTER_SPEC·STATE를 따른다.

메인은 `/retouch`, `src/features/face-retouch/`, 관련 자산 준비·검사·실행 설정을 담당한다. 효과와 조작 계약은 [MASTER_SPEC의 로컬 얼굴 보정](../../MASTER_SPEC.md#로컬-얼굴-보정--승인된-추가-범위)을 따른다. 기존 ②의 영역 편집과 구분하며 운영 DB·기존 방 흐름을 유지한다. 승인된 기존 사이트 `/retouch` 배포와 실기기 확인 범위는 MASTER_SPEC을 따르며 검사 기록과 품질 한계는 STATE에서 관리한다.

## 보존된 협업 보정방

기본 방 페이지는 `SessionFlow`를 사용한다. 별도 `/sessions/{inviteToken}/collaboration`의 `SessionEntry`가 협업 여부를 확인하고 `CollaborativeRoom`이 방 단계·선택·개인 보정·전체 사진 편집·최종 저장을 연결한다. `RetouchEditor`는 서버 마스크가 있는 개인 모드와 최신 저장본을 기준으로 하는 전체 사진 모드를 공유한다. 제품 기준은 [MASTER_SPEC](../../MASTER_SPEC.md#진입-경로와-기능-분리--2026-11-03), 확인 결과와 남은 일은 [STATE](../../STATE.md)에서 관리한다.

터치 보정은 `touch/gesture.ts`의 획 관리와 `ui/TouchFeedback.tsx`의 위치 안내·확대경을 분리한다. 기존 좌표 엔진·방 마스크·저장 계약을 유지하며, 조작 취소·부분 복원·화면과 확대경의 동기화는 기능 옆 검사와 브라우저 검사로 확인한다.

## 보정기 검증 재실행

### 공동 보정 연결 작업의 임시 분담 — 2026-11-05

- 제품 범위는 [MASTER_SPEC의 두 기능 분리](../../MASTER_SPEC.md#두-기능-분리와-공동-보정-진입--2026-11-05)를 따른다. 아래 두 스레드에 명시 경로만 위임하며 단계별 검증을 함께 진행한다. 이전 독립 보정기 분담과 동시에 같은 파일을 수정하지 않는다.
- ① 방 생성·권한·서버 연결: `src/app/retouch/`, 새 `src/app/api/retouch/`, 새 `src/features/retouch-room-entry/`, `src/features/photo-session/collaboration.ts`, `collaboration-request.ts`, `collaboration.test.ts`, 새 `src/features/photo-session/retouch-room*.ts`, 새 `tests/integration/retouch-room*.test.ts`, 새 `tests/e2e/retouch-room-entry.spec.ts`. 새 SQL 초안은 `src/integrations/storage/retouch-rooms.sql` 한 파일에만 작성하고 실제 적용·마이그레이션은 메인에 전달한다.
- ② 개인·전체 사진 보정 화면 연결: `src/features/mobile-flow/SessionEntry.tsx`, `CollaborativeRoom.tsx`, `ParticipantStatus.tsx`, 새 `src/features/retouch-room-flow/`, `tests/e2e/retouch-room.spec.ts`. 기존 협업 동작을 재사용해 개인 완료부터 최종 결과까지 연결·검증한다. 이 스레드는 방 진입 뒤 대기·개인 단계도 맡아 같은 컴포넌트의 동시 수정을 피한다.
- 연결 계약: 새 방 주소는 `/retouch/rooms/{inviteToken}`이며 페이지는 기존 `SessionEntry({inviteToken})`를 재사용한다. `CollaborationAction`·`CollaborationView`와 기존 협업 API를 유지하며 계약 변경은 메인에 먼저 보고한다. ①은 화면 쪽 수정 요청을, ②는 서버 쪽 수정 요청을 메인에 전달한다.
- 기존 `/sessions` 화면·일반 병합 API·SessionFlow·공통 클라이언트·SQL·계약·보정 엔진·공통 스타일은 읽기만 한다. 꼭 필요한 공통 변경·운영 설정·DB·Git은 메인이 맡는다. 스레드는 설치·커밋·push·배포·공유 DB 변경·추가 스레드 생성을 하지 않는다.
- 검증은 생성/참여/인식, 개인 저장/전원 완료, 전체 편집권/최종 확정 단계마다 붙인다. 기존 병합 방이 자동으로 협업방이 되지 않는 회귀 검사도 유지한다. 실제 두 참여자·휴대폰 확인과 응답 대체 검사를 구분한다. 변경 파일·검사·남은 확인은 채팅에 보고하고 STATE는 메인만 갱신한다.

### 이번 독립 보정기 작업의 임시 분담 — 2026-11-05

- 범위는 연결된 Notion 통합본2의 독립 `/retouch` 보정 동작 확인·수정이다. 제품 규칙은 MASTER_SPEC을 참조하고 불일치는 메인에 보고한다. 협업방 연결·새 기능·구조 개편·의존성 변경은 포함하지 않는다.
- 품질·속도 스레드: `src/features/face-retouch/effects/`, `engine/`, `touch/coordinates.ts`, `touch/coordinates.test.ts`, `scripts/retouch-benchmark.mjs`, `scripts/retouch-photo-audit.mjs`만 수정한다. 재현한 품질 문제를 먼저 수정하고 측정된 지연을 개선한다.
- 모바일 조작·저장 스레드: `src/features/face-retouch/ui/`, `touch/gesture.ts`, `touch/gesture.test.ts`, `image-io/headers.ts`, `image-io/headers.test.ts`, `image-io/images.ts`, `tests/e2e/retouch.spec.ts`만 수정한다. 실제 기기 확인과 브라우저 대체 검사를 구분한다.
- 위 목록은 이번 작업에 한해 메인 소유 코드의 수정을 위임한다. 나머지 경로·공통 상태·설정·Git은 메인 담당이다. 다른 스레드 소유 파일이 필요하면 직접 수정하지 않고 보고한다. 각 스레드는 수정 내용·검사·남은 확인을 채팅으로 보고하고 메인이 STATE에 반영한다.
- 동일 main checkout을 사용한다. 스레드는 설치·커밋·배포·DB 변경·추가 스레드 생성을 하지 않는다. 공유 빌드나 실행 중인 서버를 임의로 교체하지 않는다. 성능 측정은 다른 브라우저 검사와 겹치지 않게 조율한다.

- `npm run test:retouch`: 얼굴별 설정·좌표 보간·원본 참조·안전 제한 회귀 검사.
- 프로덕션 빌드 서버를 실행한 뒤 `RETOUCH_BASE_URL=http://127.0.0.1:3114 npm run test:retouch:e2e`를 사용한다. `RETOUCH_BROWSER=webkit`으로 엔진을 바꿀 수 있으며, 이는 실제 iPhone 검사가 아니다.
- `node --import tsx scripts/retouch-benchmark.mjs`: 단일·복합 효과와 누적 터치의 입력→Worker 결과→WebGL 제출, PNG 다운로드 시간을 기록한다. `RETOUCH_BASE_URL`, `RETOUCH_FIXTURE`, `RETOUCH_BROWSER`, `RETOUCH_SAMPLES`로 조건을 지정한다. 순차 입력 지연이며 연속 입력 처리량이나 물리 화면 표시 시간은 아니다.
- `node scripts/retouch-photo-audit.mjs private/cases.json`: `[{id,condition,origin,path}]` 형식의 로컬 사진 목록을 검사한다. 익명 ID와 실제/생성/변형 출처를 기록하고 사진·비교 결과는 `private/retouch-e2e/`에만 보관한다. 자동 검사는 자연스러움·가림 소유권을 합격 처리하지 않는다. 결과·측정값·미검증 항목은 STATE에서 관리한다.
