# 공개 배포와 Mac 워커

동작·권한·보관 규칙은 [MASTER_SPEC](../MASTER_SPEC.md), 현재 확인 결과는 [STATE](../STATE.md)를 따릅니다.

공개 앱: https://picsinc-merge.vercel.app
Vercel 프로젝트: `junyoung-codes-projects/picsinc-merge`
Supabase 프로젝트: `picsinc-merge` (`zogtpmolcmpiipwbysck`)

## Vercel

서버 환경변수: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`, `UPLOAD_SIGNING_SECRET`, `WORKER_TOKEN`.
마지막 두 값은 각각 별도의 32자 이상 난수입니다. `NEXT_PUBLIC_`로 등록하지 않습니다. `UPLOAD_SIGNING_SECRET` 변경은 진행 중 업로드의 재완료에 영향을 줍니다. 워커 토큰을 바꾸면 Mac도 함께 갱신합니다.

현재 로컬 앱 디렉터리에서 CLI로 배포합니다. 상위 저장소의 과거 앱이 잘못 배포되지 않도록 Git 자동 배포는 연결하지 않았습니다.

```sh
cd picsinc-merge
npm ci
npm test
npm run typecheck
npm run build
npx vercel deploy --prod
```

`.vercelignore`가 로컬 비밀정보·개인 미디어·모델·테스트를 제외합니다. 사진은 서명 URL로 비공개 Storage에 직접 업로드하므로 Vercel의 4.5MB 요청 제한을 넘는 파일도 지원합니다. 완료 API는 실제 파일을 검증하므로 저장 전 별도의 YOLO 결과를 기다리지 않습니다.

## Mac

기존 `../experiments/yolo-outline`의 Python 가상환경과 모델을 사용합니다. `.env.worker.example`을 `.env.worker`로 복사해 공개 URL과 Vercel과 같은 `WORKER_TOKEN`을 넣습니다. Supabase 비밀 키는 필요 없습니다.

```sh
npm run worker
# 수동 실행 종료 후 로그인 자동 실행 설치
node scripts/install-worker.mjs
launchctl print gui/$(id -u)/com.picsinc.photo-worker
```

로그: `~/Library/Logs/PicSinc/worker.log`, `worker-error.log`.
자동 실행 파일은 `~/Library/Application Support/PicSinc/worker`에 복사합니다. 바탕화면 폴더 권한에 의존하지 않으며, 사진과 Supabase 비밀 키는 복사하지 않습니다. 코드·인증값·모델을 바꾸면 설치 스크립트를 다시 실행해 복사본을 갱신합니다. 자동 실행은 Mac 로그인 세션에서 동작합니다. Mac의 전원·네트워크가 켜져 있고 잠자기 상태가 아니어야 처리합니다. 잠자기·종료 중에는 업로드가 대기하며 재연결 후 이어집니다. 공유기 포트·공개 IP·터널은 필요 없습니다. 프로젝트나 Node 경로를 옮기면 설치 스크립트를 다시 실행합니다.

```sh
# 정지 / 다시 시작
launchctl bootout gui/$(id -u)/com.picsinc.photo-worker
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.picsinc.photo-worker.plist
```

## DB 변경·검증

`supabase/migrations/`의 순서대로 **전용 프로젝트에만** 적용합니다. 초기 schema.sql을 다시 실행하지 않습니다. 기존 Base64 검출 캐시 전환은 `node --env-file=.env.local scripts/migrate-detection-cache.mjs`로 수행하며 원본 결과의 바이트·ID를 검증하고 저장합니다.

자동 워커를 정지한 상태에서 생성 이미지로 외부 통합 검사를 실행합니다. 다른 사용자 대기 작업이 있으면 검사는 중단됩니다.

```sh
PICSINC_REMOTE_HTTP_TEST=1 PICSINC_TEST_BASE_URL=https://picsinc-merge.vercel.app \
  node --env-file=.env.local --import tsx --test tests/integration/remote-processing.test.ts
```

이 검사는 제어된 검출 프로세스와 실제 Sharp를 사용하며 생성 파일만 정리합니다. 실제 YOLO 추론·실기기 사진 앨범 저장 검사는 별도로 구분합니다. 자동 실행 워커의 실제 YOLO 검사는 다음 명령으로 확인합니다.

```sh
PICSINC_TEST_EXTERNAL_WORKER=1 PICSINC_TEST_BASE_URL=https://picsinc-merge.vercel.app \
  node --env-file=.env.local --import tsx scripts/smoke-real-worker.ts
```

기존 Docker·Caddy 파일은 이전 단일 서버 배포 참고용이며 현재 공개 배포에서 사용하지 않습니다.
