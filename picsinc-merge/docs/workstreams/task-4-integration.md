# ④ 전체 연결과 검증

## 내 얼굴 선택·확대 보정 분담 — 2026-11-08

- 구현 세션 1개(Sol High): `src/features/face-retouch/ui/`, `tests/e2e/retouch-face-selection.spec.ts`. 메인: `CollaborativeRoom.tsx`의 뒤로 가기 연결, 기존 회귀 검사·공통 문서·최종 검증과 Git. 같은 main checkout에서 담당 경로를 분리한다.
- 제품 동작은 [협업 보정방 규칙](../../MASTER_SPEC.md#협업-보정방--별도-경로에-보존)을 따른다. `RoomEditorProps.onBackHandlerChange`로 상세→전체 보기 처리 여부를 부모에 연결하며 API·DB·검출·보정 엔진은 변경하지 않는다.

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

입술 상하 위치는 기존 `effects/lips.ts`에 입 전체의 균일 이동·코밑 고정·주변 연결 계산을 추가하고 `operations.ts`·`engine/field.ts`에만 연결한다. `lip-position.test.ts`와 `tests/e2e/retouch-lip-position.spec.ts`에서 입 모양·코 픽셀·보간·중립 복귀·PNG를 검사하며 제품 동작과 결과는 MASTER_SPEC·STATE를 따른다.

눈 높이·앞트임·충혈·밑트임은 `effects/eyes.ts`의 눈 윤곽·보호 가중치를 기존 `operations.ts`·`field.ts`·`sclera.ts`·`renderer.ts`에 연결한다. `eyes.test.ts`와 `tests/e2e/retouch-eyes.spec.ts`에서 메이크업 이동·눈동자 보호·밝기 증가·PNG를 검사하며 제품 규칙과 결과는 MASTER_SPEC·STATE를 따른다.

얼굴형 보완은 `effects/face-shape.ts`의 윤곽 연결·하안부 역좌표 계산과 `operations.ts`의 해당 세 항목에 한정한다. `engine/field.ts`는 이 계산을 기존 원본 샘플링·소유 영역 보호·안전 제한에 연결한다. 기능 옆 `face-shape.test.ts`와 `tests/e2e/retouch-face-shape.spec.ts`에서 윤곽 연속성·눈 보호·입 형태와 비율·이웃 얼굴 보호·PNG 저장을 확인한다. 제품 기준·진행 결과는 MASTER_SPEC·STATE를 따른다.

메인은 `/retouch`, `src/features/face-retouch/`, 관련 자산 준비·검사·실행 설정을 담당한다. 효과와 조작 계약은 [MASTER_SPEC의 로컬 얼굴 보정](../../MASTER_SPEC.md#로컬-얼굴-보정--승인된-추가-범위)을 따른다. 기존 ②의 영역 편집과 구분하며 운영 DB·기존 방 흐름을 유지한다. 승인된 기존 사이트 `/retouch` 배포와 실기기 확인 범위는 MASTER_SPEC을 따르며 검사 기록과 품질 한계는 STATE에서 관리한다.

## 보존된 협업 보정방

기본 방 페이지는 `SessionFlow`를 사용한다. 별도 `/sessions/{inviteToken}/collaboration`의 `SessionEntry`가 협업 여부를 확인하고 `CollaborativeRoom`이 방 단계·선택·개인 보정·전체 사진 편집·최종 저장을 연결한다. `RetouchEditor`는 서버 마스크가 있는 개인 모드와 최신 저장본을 기준으로 하는 전체 사진 모드를 공유한다. 제품 기준은 [MASTER_SPEC](../../MASTER_SPEC.md#진입-경로와-기능-분리--2026-11-03), 확인 결과와 남은 일은 [STATE](../../STATE.md)에서 관리한다.

터치 보정은 `touch/gesture.ts`의 획 관리와 `ui/TouchFeedback.tsx`의 위치 안내·확대경을 분리한다. 기존 좌표 엔진·방 마스크·저장 계약을 유지하며, 조작 취소·부분 복원·화면과 확대경의 동기화는 기능 옆 검사와 브라우저 검사로 확인한다.

## 보정기 검증 재실행

- `npm run test:retouch`: 얼굴별 설정·좌표 보간·원본 참조·안전 제한 회귀 검사.
- 프로덕션 빌드 서버를 실행한 뒤 `RETOUCH_BASE_URL=http://127.0.0.1:3114 npm run test:retouch:e2e`를 사용한다. `RETOUCH_BROWSER=webkit`으로 엔진을 바꿀 수 있으며, 이는 실제 iPhone 검사가 아니다.
- `node --import tsx scripts/retouch-benchmark.mjs`: 단일·복합 효과와 누적 터치의 입력→Worker 결과→WebGL 제출, PNG 다운로드 시간을 기록한다. `RETOUCH_BASE_URL`, `RETOUCH_FIXTURE`, `RETOUCH_BROWSER`, `RETOUCH_SAMPLES`로 조건을 지정한다. 순차 입력 지연이며 연속 입력 처리량이나 물리 화면 표시 시간은 아니다.
- `node scripts/retouch-photo-audit.mjs private/cases.json`: `[{id,condition,origin,path}]` 형식의 로컬 사진 목록을 검사한다. 익명 ID와 실제/생성/변형 출처를 기록하고 사진·비교 결과는 `private/retouch-e2e/`에만 보관한다. 자동 검사는 자연스러움·가림 소유권을 합격 처리하지 않는다. 결과·측정값·미검증 항목은 STATE에서 관리한다.
