# Windows 상시 워커 준비·화질 검증

현재 단계는 GTX 1060 3GB Windows PC 한 대의 준비와 검증이다. Mac 설정과 두 대 동시 시험은 변경하지 않는다. 제품 규칙은 [MASTER_SPEC](../MASTER_SPEC.md)를 따른다. 시험 결과는 Mac의 로컬 `STATE.md`에 기록한다. **아래 화질·복구 시험을 통과하기 전에는 Windows 워커를 운영 서버에 상시 연결하지 않는다.**

## 1. 설치와 GPU 사전 확인

개인 파일에 접근하지 않는 전용 표준 Windows 계정에서 저장소를 준비한다. `picsinc-merge`와 `experiments/yolo-outline`의 상대 위치를 Mac과 같게 둔다. 같은 `yolo26n-seg.pt` 파일만 안전하게 복사하고 파일 해시를 Mac 원본과 비교한다. 사진·결과·토큰은 Git에 넣지 않는다.

PowerShell에서 아래를 전용 계정으로 실행한다. Python 3.12, Node 22, NVIDIA 드라이버를 먼저 설치한다. [PyTorch 2.14 지원표](https://github.com/pytorch/pytorch/blob/main/RELEASE.md#pytorch-cuda-support-matrix)의 Pascal 지원 CUDA 12.6 빌드를 사용한다.

```powershell
cd <저장소>\experiments\yolo-outline
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install torch==2.14.0 torchvision==0.29.0 --index-url https://download.pytorch.org/whl/cu126
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\..\picsinc-merge
npm ci --include=dev
```

`picsinc-merge/.env.worker`를 만들고 공개 서버 URL, 서버와 같은 `WORKER_TOKEN`, 아래 Windows 절대 경로를 입력한다. 파일은 전용 계정만 읽게 보관한다. Supabase 비밀 키는 Windows에 두지 않는다. 값이나 파일 원문을 시험 결과에 붙여 보내지 않는다.

```dotenv
WORKER_BASE_URL=https://<배포주소>
WORKER_TOKEN=<서버와 같은 32자 이상 비밀값>
YOLO_DEVICE=cuda:0
YOLO_RUNTIME_DIR=C:\<저장소>\experiments\yolo-outline
YOLO_PYTHON=C:\<저장소>\experiments\yolo-outline\.venv\Scripts\python.exe
```

```powershell
powershell -NoProfile -File .\scripts\check-windows-worker.ps1
```

출력에서 GTX 1060, 약 3GB VRAM, `cuda=True`, CUDA 지원 아키텍처, 모델 SHA-256을 확인한다. `torch.cuda.is_available()`만으로 충분하지 않으므로 아래 실제 YOLO 시험도 통과해야 한다. 모델, `imgsz=1024`, `retina_masks=True`, 중복 제거·겹침 보정은 변경하지 않는다. 3GB에서 실패하면 해상도를 낮추거나 CPU로 돌리지 않고 Windows 상시 운영을 보류한다.

## 2. 비공개 사진 화질 비교

Mac 기준 결과를 만든 기존 비공개 밀집 사진 4장(8·8·9·29명)을 사용한다. 2명 사진이 남아 있다면 추가한다. 입력 파일과 모델 SHA-256을 두 PC에서 비교한다. Mac 기준 결과와 동일 입력 사진만 Windows 전용 계정으로 안전하게 옮긴다. 시험 사진·JSON·PNG는 각 PC의 Git 제외 `picsinc-merge/private/quality/`에 두고 Windows 시험 후 삭제한다.

각 사진에 대해 현재 Mac과 Windows에서 동일한 `export_regions.py`를 실행한다. 예시의 출력 경로는 서로 다른 파일로 지정한다.

```sh
# Mac: experiments/yolo-outline에서 실행
.venv/bin/python export_regions.py <원본사진> <Mac결과.json>
```

```powershell
# Windows: experiments\yolo-outline에서 실행
$env:YOLO_DEVICE = 'cuda:0'
.\.venv\Scripts\python.exe export_regions.py <원본사진> <Windows결과.json>
```

Mac·Windows JSON을 같은 PC에 모아 `compare-worker-quality.py detection <Mac결과.json> <Windows결과.json>`을 실행한다. 사람 수·ID가 같고 각 마스크 IoU가 **0.98 이상**이어야 한다. `compare-worker-quality.py preview <결과.json> <미리보기.png>`로 각 결과의 미리보기를 꺼내 나란히 본다. 새로운 사람 누락·경계 깨짐이 있으면 수치와 관계없이 실패다.

합성에는 같은 원본 PNG, 보정본 PNG, 흑백 선택 마스크 PNG를 두 PC에 복사한다. 각 PC에서 `node --import tsx scripts/quality-compose.ts <원본> <보정본> <마스크> <결과.png> <미리보기.png>`를 실행하고, 두 PNG 쌍에 `compare-worker-quality.py composition <Mac.png> <Windows.png>`를 실행한다. 원본·결과·마스크가 모두 같은 표시 크기인 PNG인 경우 `--original <원본.png> --mask <마스크.png>`도 붙여 선택 밖 원본 픽셀을 확인한다. PNG 크기·형식·디코딩 픽셀이 달라지면 원인 확인 전에는 통과시키지 않는다.

## 3. 상시 실행과 대기열

화질 검증 후 `scripts/start-windows-worker.cmd`를 수동 실행해 생성 사진 1건의 실제 CUDA 처리와 결과를 확인한다. Windows 작업 스케줄러에 **컴퓨터 시작 시** 실행, 전용 계정, **로그온 여부와 관계없이 실행**, 동시 인스턴스 금지, 실패 시 1분 간격 재시도 3회로 등록한다. 실행 프로그램은 이 `.cmd` 파일이다. 장시간 실행 자동 중지·절전 조건을 해제하고 Windows 절전도 끈다. 재부팅 후 로그인 없이 작업이 처리되고 CUDA가 사용되는지 시험한다.

로그는 `picsinc-merge/worker-logs/`에 기록된다. `node --env-file=.env.worker scripts/worker-status.mjs --watch`는 서버에서 대기·진행·최근 실패 수만 읽으며 사진이나 Supabase 키를 가져오지 않는다. 대기 3건 이상 또는 최장 대기 60초 초과가 2분 지속되면 Mac 수동 추가를 검토한다. CUDA 불가·GPU 메모리 오류가 나면 Windows 워커는 해당 작업을 다시 대기시키고 새 작업 접수를 멈춘다. 원인 해결 뒤 작업 스케줄러에서 워커를 재시작한다. 급하면 기존 Mac 워커를 수동으로 켠다.

## 4. 운영 시험 기록

화질 통과 후 분리 시험 환경에서 생성 사진으로 Windows 단독 5·10팀, 작업 중 강제 종료·재시작, 회선 단절·복귀, 재부팅 후 자동 실행, 4시간 연속 운전을 시험한다. 작업 성공·실패·재시도, 총 대기 시간, YOLO/합성·다운로드·업로드 시간, VRAM·온도·디스크 여유를 기록한다. **운영 서버에서는 부하 시험을 하지 않는다.** 복구되지 않은 실패나 화질 저하가 있으면 주력 워커 전환을 보류하고 Mac의 로컬 `STATE.md`에 결과를 남긴다.
