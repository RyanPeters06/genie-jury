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
    "ember-listening": (25, 96, 260, 370),
    "tide-listening": (270, 95, 510, 370),
    "gale-listening": (520, 93, 755, 370),
    "volt-listening": (758, 102, 997, 370),
    "ember-speaking": (28, 394, 258, 648),
    "tide-speaking": (270, 394, 508, 648),
    "gale-speaking": (522, 394, 756, 648),
    "volt-speaking": (758, 394, 997, 648),
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
