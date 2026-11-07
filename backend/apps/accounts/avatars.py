"""Turning an uploaded file into a safe picture.

Nothing a user sends is ever stored or served as it came. The file is decoded and redrawn as a new small
WebP, which drops anything hidden in it: metadata, GPS positions, or a script disguised as an image.
Only what's on the allow-list is opened, so SVG, which can carry scripts, never gets in."""
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

SIZE = 256
MAX_BYTES = 3_000_000
MAX_PIXELS = 40_000_000  # far beyond a real photo, and it stops a tiny file that expands to gigabytes
ALLOWED = ("PNG", "JPEG", "WEBP", "GIF")


class NotAnImage(Exception):
    pass


def reencode(stream):
    try:
        probe = Image.open(stream, formats=ALLOWED)
        width, height = probe.size  # read from the header, before any pixels are decoded
        if width * height > MAX_PIXELS:
            raise NotAnImage("too big")
        probe.verify()
        stream.seek(0)
        image = Image.open(stream, formats=ALLOWED)
        image = ImageOps.exif_transpose(image)  # keep it the right way up before the metadata goes
        image = image.convert("RGBA")
        image = ImageOps.fit(image, (SIZE, SIZE), Image.Resampling.LANCZOS)
        out = BytesIO()
        image.save(out, format="WEBP", quality=86, method=4)
        return out.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError, EOFError) as e:
        raise NotAnImage(str(e)) from e
