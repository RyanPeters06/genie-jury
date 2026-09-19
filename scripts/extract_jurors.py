"""Extract exact juror sprites with foreground segmentation, not color-keying.

The supplied sheet has dark hair, clothing, outline work, and a dark backdrop.
Threshold removal cannot distinguish those parts. rembg segments the whole
person-and-cloud silhouette, preserving the original illustration unchanged.
"""

from pathlib import Path
import sys

from PIL import Image
from rembg import new_session, remove


SPRITES = {
    "ember-listening": (42, 148, 390, 552),
    "tide-listening": (415, 148, 766, 552),
    "gale-listening": (799, 148, 1166, 552),
    "volt-listening": (1158, 154, 1532, 552),
    "ember-speaking": (35, 586, 384, 976),
    "tide-speaking": (418, 586, 772, 976),
    "gale-speaking": (800, 586, 1164, 976),
    "volt-speaking": (1152, 586, 1524, 976),
}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python scripts/extract_jurors.py <sprite-sheet> <output-dir>")
    source = Image.open(sys.argv[1]).convert("RGBA")
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    session = new_session("isnet-general-use")
    for name, crop in SPRITES.items():
        transparent = remove(source.crop(crop), session=session, alpha_matting=True, alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10, alpha_matting_erode_size=5)
        transparent.save(output_dir / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
