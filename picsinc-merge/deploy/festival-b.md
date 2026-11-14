# 축제 B 부하·비용 리허설

제품 기준은 [MASTER_SPEC](../MASTER_SPEC.md), 진행 결과는 [STATE](../STATE.md)를 따른다. 이 문서는 생성 사진으로 분리 환경을 측정하는 절차다.
브라우저에서 한 가지씩 시험하고 Mac 요약 화면을 보는 방법은 [B 대기 시간 시험](../docs/festival-readiness-b-test.md)에 있다.

## 환경 분리

- Vercel 시험 프로젝트는 `junyoung-codes-projects/picsinc-festival-readiness`다. 앱의 `Node 22.x`와 Next.js 설정을 사용한다.
- Supabase 시험 DB와 비공개 `picsinc-merge` Storage 버킷을 준비한다. 운영 프로젝트 ID `zogtpmolcmpiipwbysck`를 시험용 환경변수에 넣지 않는다.
- 시험 배포에는 시험 DB URL·서버 비밀 키와 시험 전용 `UPLOAD_SIGNING_SECRET`, `WORKER_TOKEN`을 설정한다. 모두 서버 전용이다.
- Mac 워커는 수동으로 시험 배포 URL과 시험 전용 토큰을 가리켜 실행한다. 기존 자동 실행 워커의 운영 URL·토큰은 바꾸지 않는다. 시험을 마치면 수동 워커를 종료한다.
- 브랜치 DB를 사용할 경우 데이터와 버킷, 모든 테이블·함수·RLS가 준비됐는지 확인하고 그 브랜치의 키만 사용한다. 기존 통합 검사는 `PICSINC_TEST_DB_REF`로 시험 프로젝트 ID를 받는다.

## 측정

시험 서버와 워커가 켜진 상태에서 생성 사진만 사용한다. `festival-load.ts`는 운영 Vercel URL과 운영 Supabase ID를 거부한다. 테스트는 1·3·10팀, 팀당 3명, 원본 등록 직후 제출과 30초 후 집중 제출을 실행한다. 중복 업로드 완료·중복 병합, 5초 상태 조회, 세 참여자의 결과 다운로드도 포함한다. `PICSINC_BOUNDARY_TEST=1`이면 19~20MiB PNG 원본 등록 경계를 추가로 확인한다.

```sh
PICSINC_FESTIVAL_TEST=1 PICSINC_TEST_BASE_URL=https://<test-deployment> \
PICSINC_REPORT_PATH=private/festival-b-report.json \
node --env-file=.env.festival --import tsx scripts/festival-load.ts

node --import tsx scripts/festival-capacity.ts private/festival-b-report.json
```

시험 환경의 `.env.festival`에는 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`을 넣고 Git에 저장하지 않는다. 리포트에는 팀 수·API 경로별 요청 수와 지연, 작업 대기·완료 시간, 파일 바이트만 기록한다. 워커 로그의 `worker measurement`에는 작업 종류별 다운로드·YOLO/합성·업로드 시간과 바이트가 기록된다. 사진·토큰·파일 URL은 계측에 넣지 않는다.

## 판단과 비용

- 복구되지 않은 실패가 0이고 병합 완료 p95가 5분 이내인 최대 동시 팀 수를 운영 가능 규모로 기록한다. 측정치가 부족하면 `STATE.md`에 미확정으로 표시한다.
- 실제 행사 팀 수와 현재 사용량을 확인한 다음 아래 값을 넣어 전망을 계산한다. 숫자가 없으면 행사 규모별 비용·경고 기준을 확정하지 않는다.

```sh
FESTIVAL_EXPECTED_TEAMS=<teams> FESTIVAL_CURRENT_STORAGE_BYTES=<bytes> \
FESTIVAL_CURRENT_EGRESS_BYTES=<bytes> FESTIVAL_CURRENT_VERCEL_REQUESTS=<count> \
node --import tsx scripts/festival-capacity.ts private/festival-b-report.json
```

현재 계정은 Vercel Hobby·Supabase Free다. [Vercel Hobby 한도](https://vercel.com/docs/plans/hobby)와 [Supabase Free 한도](https://supabase.com/docs/guides/platform/billing-on-supabase)를 시험 당일 다시 확인하고, 각각의 Usage 화면에서 **현재 사용량**을 읽는다. 스크립트의 결과 다운로드 바이트는 egress의 하한이므로 워커 입력·화면 사진 전송을 Usage 수치와 대조한다. 저장량·전송량·요청량 중 하나라도 실제 한도의 80%에 다가가면 현장 운영자가 새 팀의 시작 간격을 조절하고 혼잡 안내를 확인한다. 자동 접수 제한은 만들지 않는다.

시험 전후 Vercel의 함수 호출·Active CPU·Fast Data Transfer와 Supabase의 Storage·egress도 기록한다. 용량 계산 스크립트는 호출·Storage·결과 다운로드의 하한만 계산하므로, CPU·전체 전송량의 여유가 더 적으면 그 한도를 우선한다. Free/Hobby에서 한도 초과는 서비스 제한으로 이어질 수 있으므로 달러 예상액이 0이어도 안전하다는 뜻은 아니다.

시험 후 리포트와 워커 계측을 검토하고, 생성 방·파일 정리 결과를 확인한다. 실패하거나 중단된 시험의 남은 생성 객체도 정리한 뒤 시험 브랜치를 종료한다. 공개 배포와 실제 워커 소량 검사는 분리 환경의 B 결과를 확인한 뒤 수행한다.
