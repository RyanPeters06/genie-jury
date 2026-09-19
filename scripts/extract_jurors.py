"""Extract exact juror sprites while preserving their illustrated cloud seats.

Source sheets with a dedicated chroma-green background use a deterministic
chroma extraction. Other supplied sheets fall back to foreground segmentation.
This prevents pale clouds from being mistaken for background while retaining a
safe workflow for the original checkerboard-backed source art.
"""

from pathlib import Path
import sys

from PIL import Image
from rembg import new_session, remove


SPRITES = {
    "ember-listening": (45, 100, 520, 690),
    "tide-listening": (570, 100, 990, 690),
    "gale-listening": (1070, 100, 1500, 690),
    "volt-listening": (1550, 110, 2000, 690),
    "ember-speaking": (45, 665, 530, 1270),
    "tide-speaking": (560, 665, 1020, 1270),
    "gale-speaking": (1050, 665, 1530, 1270),
    "volt-speaking": (1530, 665, 2010, 1270),
}


def has_chroma_green(source: Image.Image) -> bool:
    preview = source.convert("RGB").resize((64, 64))
    green_pixels = sum(
        green > 150 and green > red * 1.5 and green > blue * 1.5
    for red, green, blue in preview.get_flattened_data()
    )
    return green_pixels / (64 * 64) > 0.2


def remove_chroma_green(source: Image.Image) -> Image.Image:
    """Remove the generated flat green key without changing the painted art."""
    rgba = source.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            dominance = green - max(red, blue)
            if green > 100 and dominance > 70:
                edge_alpha = int(max(0, min(255, (125 - dominance) / 55 * 255)))
                pixels[x, y] = (red, green, blue, min(alpha, edge_alpha))
    return rgba


def remove_isolated_specks(source: Image.Image, minimum_pixels: int = 100) -> Image.Image:
    """Discard tiny disconnected generator artifacts while retaining real cues."""
    rgba = source.convert("RGBA")
    alpha = rgba.getchannel("A")
    width, height = rgba.size
    visited = bytearray(width * height)
    alpha_pixels = alpha.load()
    rgba_pixels = rgba.load()

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or alpha_pixels[x, y] < 8:
                continue
            visited[index] = 1
            component = [(x, y)]
            cursor = 0
            while cursor < len(component):
                current_x, current_y = component[cursor]
                cursor += 1
                for offset_x in (-1, 0, 1):
                    for offset_y in (-1, 0, 1):
                        next_x, next_y = current_x + offset_x, current_y + offset_y
                        if not (0 <= next_x < width and 0 <= next_y < height):
                            continue
                        next_index = next_y * width + next_x
                        if visited[next_index] or alpha_pixels[next_x, next_y] < 8:
                            continue
                        visited[next_index] = 1
                        component.append((next_x, next_y))
            if len(component) < minimum_pixels:
                for component_x, component_y in component:
                    red, green, blue, _ = rgba_pixels[component_x, component_y]
                    rgba_pixels[component_x, component_y] = (red, green, blue, 0)
    return rgba


def trim_transparent_padding(source: Image.Image, padding: int = 12) -> Image.Image:
    """Keep a small breathing room while removing unused keyed background."""
    bounds = source.getchannel("A").getbbox()
    if bounds is None:
        return source
    left, top, right, bottom = bounds
    return source.crop((
        max(0, left - padding),
        max(0, top - padding),
        min(source.width, right + padding),
        min(source.height, bottom + padding),
    ))


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python scripts/extract_jurors.py <sprite-sheet> <output-dir>")
    source = Image.open(sys.argv[1]).convert("RGBA")
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)
    use_chroma_key = has_chroma_green(source)
    session = None if use_chroma_key else new_session("isnet-general-use")
    for name, crop in SPRITES.items():
        sprite = source.crop(crop)
        transparent = (
            remove_isolated_specks(remove_chroma_green(sprite))
            if use_chroma_key
            else remove(sprite, session=session, alpha_matting=True, alpha_matting_foreground_threshold=240, alpha_matting_background_threshold=10, alpha_matting_erode_size=5)
        )
        trim_transparent_padding(transparent).save(output_dir / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
