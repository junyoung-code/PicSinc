# ③ 사진 합성

## 역할

원본 위에 사용자가 선택한 보정 영역을 붙여 결과 사진을 만듭니다.

## 핵심 구현

- 원본·보정본·개인 선택 영역·공동 겹침 수정 내용을 입력으로 받습니다.
- 서버의 Sharp로 각 영역에 지정된 보정본을 적용합니다.
- 선택 영역 내부는 유지하고 경계만 부드럽게 연결합니다.
- 화면용 미리보기와 원본 해상도의 색상 수를 줄이지 않는 PNG를 생성합니다.
- 매번 보관된 원본·보정본에서 다시 합성합니다.

## 연결 범위

합성·화질 기준은 [요구사항](../../MASTER_SPEC.md)을 따릅니다. 파일 저장은 [①](task-1-session.md), 영역 지정은 [②](task-2-editor.md), 다운로드 화면 연결은 [④](task-4-integration.md)가 담당합니다. 자동 얼굴 감지와 AI 생성은 만들지 않습니다.

연결 진입점은 [composePhoto(input, readAsset)](../../src/features/composition/compose.ts)입니다. 서버 전용 파일 읽기 콜백을 받아 원본 크기 PNG·미리보기 PNG, 각 크기와 미지정 겹침 픽셀 수를 반환합니다. 호출하는 서버가 파일 접근 권한을 확인합니다.

로컬 작업 실행 진입점은 `src/features/composition/worker-main.ts`입니다. `WORKER_BASE_URL`·`WORKER_TOKEN`으로 작업을 가져오고, `worker-runtime.ts`가 배정 갱신·중단·완료 재시도를 담당합니다. `worker-task.ts`는 별도 프로세스에서 기존 검출·합성 함수를 호출하고 서명 URL로만 파일을 전송합니다. 공통 입력·출력은 `src/core/processing.ts`를 따릅니다. 시작 설정·DB·API는 ④에서 연결합니다.

검증 명령: `node --import tsx --test src/features/composition/worker.test.ts`. 실제 로컬 HTTP·자식 프로세스로 PNG 전송을 확인하고, 배정 상실·종료·불확실한 완료 응답·비밀 정보 없는 오류 보고를 검사합니다. 해당 HTTP 테스트는 loopback 포트를 열 수 있는 실행 권한이 필요합니다.

## 완료 기준

- 선택한 부분은 지정한 보정본에서 가져오고, 선택하지 않은 부분은 원본을 유지합니다.
- 겹침 지정이 결과에 반영되고, 반복 합성해도 원본·보정본은 변경되지 않습니다.
- 결과 PNG의 가로·세로 크기가 원본과 같고, 미리보기에서도 같은 영역 배치를 확인할 수 있습니다.

진행 상황은 [STATE.md](../../STATE.md)에서만 관리합니다.
