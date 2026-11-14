export class EditParamsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EditParamsError";
    this.code = code;
  }
}

// Product names and ranges are vendor-neutral. Values are stored verbatim in
// EditRevision.params so a future Meitu mapping remains isolated at the port.
const NUMBER_PARAMS = {
  skinSmoothing: [0, 100],
  skinTone: [-100, 100],
  faceSlimming: [-100, 100],
  hairEnhancement: [0, 100],
};
const MAKEUP_STYLES = new Set(["none", "natural", "glam"]);

export function normalizeEditParams(controls) {
  if (!controls || typeof controls !== "object" || Array.isArray(controls)) {
    throw new EditParamsError("INVALID_PARAMS", "Edit controls must be an object");
  }
  const params = {};
  for (const [name, range] of Object.entries(NUMBER_PARAMS)) {
    if (!(name in controls)) continue;
    if (!Number.isFinite(controls[name]) || controls[name] < range[0] || controls[name] > range[1]) {
      throw new EditParamsError("INVALID_PARAMS", `${name} must be between ${range[0]} and ${range[1]}`);
    }
    params[name] = controls[name];
  }
  if ("makeupStyle" in controls) {
    if (!MAKEUP_STYLES.has(controls.makeupStyle)) {
      throw new EditParamsError("INVALID_PARAMS", "makeupStyle is unsupported");
    }
    params.makeupStyle = controls.makeupStyle;
  }
  const unknown = Object.keys(controls).filter((name) => !(name in NUMBER_PARAMS) && name !== "makeupStyle");
  if (unknown.length > 0) throw new EditParamsError("UNSUPPORTED_CONTROL", `Unsupported controls: ${unknown.join(", ")}`);
  if (Object.keys(params).length === 0) throw new EditParamsError("INVALID_PARAMS", "At least one edit control is required");
  return Object.freeze(params);
}
