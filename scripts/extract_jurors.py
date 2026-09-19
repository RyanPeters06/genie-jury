"""Extract the supplied Genie Jury sprite sheet into transparent web assets.

The source sheet has a very dark, continuous backdrop.  We flood-fill only the
dark pixels connected to each crop's edge, which preserves the dark linework,
hair, clothes, and cloud shading enclosed by the character silhouette.
"""

from collections import deque
from pathlib import Path
import sys

from PIL import Image


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


def is_backdrop(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, _ = pixel
    # The artwork background is near-black/navy; the character outlines are
    # protected by the connectivity rule below and are never edge-connected.
    return max(red, green, blue) < 70 and abs(red - blue) < 34


def remove_connected_backdrop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    queue: deque[tuple[int, int]] = deque()
    seen: set[tuple[int, int]] = set()

    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not is_backdrop(pixels[x, y]):
            continue
        seen.add((x, y))
        pixels[x, y] = (*pixels[x, y][:3], 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen:
                queue.append((nx, ny))
    return rgba


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python scripts/extract_jurors.py <sprite-sheet> <output-dir>")
    source = Image.open(sys.argv[1]).convert("RGBA")
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, crop in SPRITES.items():
        transparent = remove_connected_backdrop(source.crop(crop))
        transparent.save(output_dir / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
