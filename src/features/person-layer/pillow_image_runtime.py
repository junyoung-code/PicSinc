import base64
import io
import json
import sys

from PIL import Image


def image_from_base64(value):
    return Image.open(io.BytesIO(base64.b64decode(value, validate=True)))


def main():
    request = json.load(sys.stdin)
    operation = request["operation"]
    if operation == "crop":
        image = image_from_base64(request["base64"])
        image.load()
        expected = request["image"]
        if image.width != expected["width"] or image.height != expected["height"]:
            raise ValueError("source dimensions differ from original metadata")
        roi = request["roi"]
        crop = image.crop((roi["x"], roi["y"], roi["x"] + roi["width"], roi["y"] + roi["height"])).convert("RGB")
        output = io.BytesIO()
        crop.save(output, format="JPEG", quality=95, subsampling=0)
        print(json.dumps({
            "base64": base64.b64encode(output.getvalue()).decode("ascii"),
            "dataType": "jpg",
            "image": {"width": crop.width, "height": crop.height},
        }))
        return
    if operation == "decode-mask":
        mask = image_from_base64(request["base64"]).convert("L")
        print(json.dumps({
            "width": mask.width,
            "height": mask.height,
            "alphaBase64": base64.b64encode(mask.tobytes()).decode("ascii"),
        }))
        return
    if operation == "encode-mask":
        width = request["width"]
        height = request["height"]
        alpha = base64.b64decode(request["alphaBase64"], validate=True)
        if len(alpha) != width * height:
            raise ValueError("alpha length differs from dimensions")
        mask = Image.frombytes("L", (width, height), alpha)
        output = io.BytesIO()
        mask.save(output, format="PNG")
        print(json.dumps({"base64": base64.b64encode(output.getvalue()).decode("ascii"), "dataType": "png"}))
        return
    raise ValueError("unsupported operation")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
