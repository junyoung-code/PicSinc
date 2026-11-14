// Phones save a photo to the gallery through the share sheet ("사진에 저장" / "이미지 저장").
// A plain download lands in Files on Chrome (11/13 phone test), so prefer sharing on touch
// devices that can share files, and fall back to the download everywhere else.
export type SaveResult = "shared" | "downloaded" | "cancelled";

export async function savePhoto(blob: Blob, name: string): Promise<SaveResult> {
  const file = new File([blob], name, { type: blob.type || "image/png" });
  const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (phone && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return "shared"; }
    catch (error) {
      if ((error as DOMException)?.name === "AbortError") return "cancelled";
      // NotAllowedError (gesture expired) or an unsupported target: download instead.
    }
  }
  const url = URL.createObjectURL(file), link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}
