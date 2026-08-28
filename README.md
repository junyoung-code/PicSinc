# PicSinc

PicSinc is a collaborative group-photo editing MVP. Each participant selects and claims their own face in a shared photo, applies local portrait edits, and the service combines accepted edits over the untouched original.

## What we are building

- Face landmarks and person, skin, and hair segmentation
- Per-person skin, facial-shape, makeup, eye, and portrait-enhancement edits
- Versioned edit previews that only the claimed participant can accept
- Deterministic composition of approved patches while preserving every other pixel

## Privacy and safety

PicSinc does not infer a person's identity. Participants manually claim a detected face, and only the owner of that face can request edits. Original images remain immutable; API credentials and media are handled server-side only and are never committed to this repository.

## Status

The MVP is in active development. Meitu API access is being integrated behind server-side adapters for detection, segmentation, and portrait retouching.

See [MASTER_SPEC.md](MASTER_SPEC.md) for the current product contracts and technical boundaries.
