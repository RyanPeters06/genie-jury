"""Create a visual alpha review sheet for every extracted juror sprite."""

from pathlib import Path
import sys

from PIL import Image, ImageDraw


NAMES = ("ember", "tide", "gale", "volt")
STATES = ("listening", "speaking")
BACKDROPS = ("#aee3fb", "#ffffff", "#18202e")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python scripts/review_jurors.py <asset-dir> <output.png>")
    source = Path(sys.argv[1])
    tile_width, tile_height = 300, 300
    canvas = Image.new("RGB", (tile_width * 4, tile_height * 6), "#f7f7f7")
    draw = ImageDraw.Draw(canvas)
    for backdrop_index, backdrop in enumerate(BACKDROPS):
        for state_index, state in enumerate(STATES):
            row = backdrop_index * 2 + state_index
            for column, name in enumerate(NAMES):
                tile = Image.new("RGB", (tile_width, tile_height), backdrop)
                asset = Image.open(source / f"{name}-{state}.png").convert("RGBA")
                asset.thumbnail((270, 250))
                tile.paste(asset, ((tile_width - asset.width) // 2, 30), asset)
                draw_tile = ImageDraw.Draw(tile)
                draw_tile.text((10, 8), f"{name} · {state}", fill="#102033")
                canvas.paste(tile, (column * tile_width, row * tile_height))
    canvas.save(sys.argv[2])


if __name__ == "__main__":
    main()
