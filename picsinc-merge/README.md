# PicSync

기존 방·사진 병합 앱은 [MASTER_SPEC.md](MASTER_SPEC.md), 현재 구현·검증 상태는 [STATE.md](STATE.md), 운영 실행은 [deploy/README.md](deploy/README.md)를 따릅니다.

## 이 Mac의 로컬 사진 병합 앱

이 Mac에는 Git 제외 `private/festival-local` DB·Storage와 `.env.development.local`이 준비되어 있다. 개발 서버는 이 설정을 우선 사용한다. 기본 주소는 사진 병합, `/retouch`는 독립 보정기다. 기존 실험 협업방은 방 주소 뒤에 `/collaboration`을 붙여 연다. 제품 기준은 MASTER_SPEC을 따른다. 기존 공개 DB의 방은 로컬에 없으므로 [새 방](http://127.0.0.1:3113/sessions/new)에서 사진을 다시 올린다.

앱 폴더에서 Docker와 로컬 DB를 켠 뒤 웹을 실행한다.

```sh
open -a Docker
npx --yes supabase@2.118.0 start --workdir private/festival-local --exclude realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npm run dev -- --hostname 127.0.0.1 --port 3113
```

다른 터미널에서 로컬 분석·합성 워커를 실행한다.

```sh
node --env-file=.env.development.local --import tsx src/features/composition/worker-main.ts
```

웹·워커·Docker를 함께 유지해야 한다. 이 설정은 개발 실행 전용이며, `.env.worker`를 사용하는 `npm run worker`는 기존 공개 서버 설정이다. 이 안내는 이미 준비된 이 Mac 기준이며 새 checkout의 DB 초기화 절차를 대신하지 않는다.

## 얼굴 보정 화면 실행

Node 22에서 기존 앱 폴더를 사용합니다. 별도 앱·DB 설정이 필요하지 않습니다.

```sh
npm ci
npm run retouch:setup
npm run dev -- --hostname 127.0.0.1 --port 3100
```

브라우저에서 [보정 화면](http://127.0.0.1:3100/retouch)을 엽니다. JPEG·PNG를 선택하면 얼굴 기준점을 찾습니다. 너무 작은 얼굴(윤곽 너비 약 113px·높이 150px 미만)은 편집에서 제외하지만, 검출되었다면 윤곽·터치·충혈 보정의 보호 영역에는 포함합니다. 얼굴을 선택하고 하단의 강도 → 세부 항목 → 부위 탭으로 조절합니다. 터치 보정·부분 복원은 별도 모드이며 두 손가락 확대, 사진 이동, 누르고 원본 비교, 선택 얼굴 초기화와 PNG 저장을 제공합니다. 저장은 원본 표시 해상도를 유지합니다. 슬라이더·터치는 움직이는 중에도 완료된 미리보기를 계속 표시하고, 최신 설정이 반영되면 저장 버튼이 활성화됩니다. 현재 탭을 닫으면 설정이 사라집니다.

사진·얼굴 기준점·설정은 브라우저에서만 처리합니다. 검출과 좌표 계산은 각각 Worker에서 실행하며, 계산 실패 시 원본을 표시하고 설정을 바꿔 재시도할 수 있습니다. 이 경로에서는 방 생성·Storage 업로드·방문 이벤트 전송을 하지 않습니다. WebGL2와 Worker·ImageBitmap을 지원하는 브라우저가 필요합니다. 파일은 20MB·1,600만 픽셀·한 변 8,192px 이하이며 실제 GPU 한도가 더 작으면 안내합니다. 원본을 자동 축소해 저장하지 않습니다. 인식하지 못한 얼굴이나 가림의 정확한 소유권은 보호할 수 없으며, 최대 20개 검출에 도달하면 편집을 제한합니다.

`retouch:setup`은 고정된 `@mediapipe/tasks-vision` 0.10.32와 Google Face Landmarker float16 v1 모델을 준비합니다. 최초 모델 다운로드에 인터넷이 필요하며 이후 자산은 같은 출처의 로컬 `public/retouch/vendor/`에서 읽습니다. 모델 SHA-256을 검사하고 생성 자산은 Git에서 제외합니다. `npm run build`는 빌드 전에 자산 준비를 실행합니다. `.vercelignore`는 준비 스크립트를 포함하고 생성 자산·개인 미디어를 제외하므로 배포 환경에서 모델을 다시 준비합니다. 라이브러리는 Apache-2.0이며 [MediaPipe 공식 안내](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)를 참고합니다.

```sh
npm run test:retouch
npm run typecheck
npm run build
# 위 개발 서버를 실행한 상태에서:
npm run test:retouch:e2e
# Mac WebKit 엔진 검사 (실제 iPhone 검사를 대체하지 않음):
# Playwright WebKit 런타임을 준비한 환경에서
RETOUCH_BROWSER=webkit npm run test:retouch:e2e -- retouch-readiness.spec.ts
```

브라우저 검사는 설치된 Chrome을 사용합니다. 다른 실행 환경에서는 `playwright.retouch.config.ts`의 launchOptions를 조정합니다. 기본 사진은 Git 제외 로컬 `test-images/four-women-20260915/01-original.png`이며 없는 경우 해당 사진 검사는 건너뜁니다. `RETOUCH_FIXTURE=/absolute/photo.png npm run test:retouch:e2e`로 바꿀 수 있습니다. 다중 얼굴·모바일 터치 검사는 기본 기준 사진의 얼굴 위치를 사용하므로 다른 사진에서는 테스트 위치도 조정합니다. 결과·스크린샷·대형 사진·추적 자료는 `private/retouch-e2e/`에만 저장합니다. 부위별 비교 시트는 검사 뒤 `node scripts/retouch-visuals.mjs`로 생성하며 다른 사진에는 `RETOUCH_REVIEW_CROP`을 지정합니다.

참고 화면 7개는 `picsync-e2e/references/`에 있으며 Git 제외를 유지합니다. 이 폴더는 참고 자료이고 별도 실행 프로젝트가 아닙니다. 기존 사이트의 보정 화면은 `https://picsinc-merge.vercel.app/retouch`에서 엽니다. 배포 범위와 제품 동작은 MASTER_SPEC, 검증 결과와 남은 확인은 STATE를 따릅니다.
