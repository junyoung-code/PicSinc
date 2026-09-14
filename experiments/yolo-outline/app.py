"""Run with .venv/bin/python app.py, then open http://127.0.0.1:7860."""

import os
import logging
from time import perf_counter

from outline import CACHE, get_segmenter, read_photo, render_people

os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")
os.environ.setdefault("GRADIO_TEMP_DIR", str(CACHE / "gradio"))

import gradio as gr


def analyze(path):
    try:
        photo = read_photo(path)
    except ValueError as error:
        return None, str(error)
    try:
        segmenter = get_segmenter()
        started = perf_counter()
        masks = segmenter.predict(photo)
        output, ids = render_people(photo, masks)
        seconds = perf_counter() - started
    except Exception:
        logging.exception("YOLO analysis failed")
        return None, "분석하지 못했습니다. 실행 터미널의 오류를 확인해 주세요. 첫 실행에는 모델 다운로드를 위한 인터넷 연결이 필요합니다."
    device = "Mac GPU" if segmenter.device == "mps" else "CPU · GPU를 사용할 수 없어 CPU로 실행했습니다."
    summary = f"감지 인원: {len(ids)}명 · {device} · {seconds:.2f}초"
    if not ids:
        summary += "\n사람을 찾지 못했습니다."
    return output, summary


def build_demo():
    with gr.Blocks(title="사람별 컬러 윤곽선", analytics_enabled=False,
                   delete_cache=(3600, 3600)) as demo:
        gr.Markdown("# 사람별 컬러 윤곽선\n사진을 올리고 분석하면 사람마다 다른 색의 윤곽선과 ID를 표시합니다.")
        upload = gr.File(label="사진 업로드 · JPG / PNG", file_types=[".jpg", ".jpeg", ".png"], type="filepath")
        button = gr.Button("분석", variant="primary")
        status = gr.Textbox(label="감지 인원 수", value="사진을 올려 주세요. 첫 분석 때 모델을 한 번 내려받습니다.", interactive=False)
        result = gr.Image(label="결과 이미지", type="pil", format="png", interactive=False, buttons=[])
        button.click(analyze, inputs=upload, outputs=[result, status], concurrency_limit=1, api_name=False)
        upload.change(lambda: (None, "분석 버튼을 눌러 주세요."), outputs=[result, status], api_name=False)
    return demo


if __name__ == "__main__":
    build_demo().launch(server_name="127.0.0.1", server_port=7860, share=False,
                        footer_links=[],
                        css=".gradio-container { max-width: 960px !important; margin: auto; }")
