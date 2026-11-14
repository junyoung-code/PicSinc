/**
 * The preview canvas deliberately uses decoded image pixels as its coordinate
 * system.  This keeps any future detection result (which is also expressed in
 * source-image pixels) free from CSS/display-size conversions.
 */
export function getPhotoDimensions(image) {
  const width = Number(image?.width ?? image?.naturalWidth);
  const height = Number(image?.height ?? image?.naturalHeight);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new TypeError("사진 크기는 1 이상의 정수여야 합니다.");
  }
  return { width, height };
}

export function scaleBoxToPhoto(box, referenceImage, photoImage) {
  const reference = getPhotoDimensions(referenceImage);
  const photo = getPhotoDimensions(photoImage);
  for (const value of [box?.x, box?.y, box?.width, box?.height]) {
    if (!Number.isFinite(value)) throw new TypeError("얼굴 좌표는 유한한 숫자여야 합니다.");
  }
  return {
    x: box.x * photo.width / reference.width,
    y: box.y * photo.height / reference.height,
    width: box.width * photo.width / reference.width,
    height: box.height * photo.height / reference.height,
  };
}
