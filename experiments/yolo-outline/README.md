# 사람별 컬러 윤곽선 데모

기능 범위: [MASTER_SPEC.md의 로컬 데모](../../MASTER_SPEC.md#local-yolo-outline-demo). 진행 및 검증 결과: [STATE.md](../../STATE.md).

## 실행

이 폴더에서 Python 3.12로 실행합니다.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

브라우저에서 http://127.0.0.1:7860 을 열고 JPG/PNG 업로드 → **분석**을 누릅니다. 색과 선이 덧씌워지지 않은 원본 사진을 사용하세요.

첫 분석 때 YOLO 모델을 내려받습니다. 이후 사진 분석은 로컬에서 수행합니다. 가상환경, 모델, 업로드 임시 파일은 이 폴더의 Git 제외 경로에 저장됩니다. Gradio 임시 파일은 실행 중 한 시간 주기로 오래된 파일을 정리합니다. 앱은 외부 공유 링크를 만들지 않습니다.

화면의 시간은 모델 로딩을 제외한 분석·그리기 시간이며, 첫 분석에는 GPU 준비 시간이 포함될 수 있습니다. 실행 환경의 패키지 버전은 `requirements.txt`를 기준으로 합니다.

## 확인

```sh
.venv/bin/python -m unittest discover -s . -p 'test_*.py' -v
```

Ultralytics 라이선스: https://www.ultralytics.com/license
