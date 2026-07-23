from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1] / "templates" / "propuestas-fmh-2026"


def label_font(size: int):
    candidates = (
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def render_and_validate(pdf_path: Path) -> Path:
    document = fitz.open(pdf_path)
    if document.page_count != 1:
        raise RuntimeError(f"{pdf_path.name} generó {document.page_count} páginas; se esperaba una.")
    page = document[0]
    text = page.get_text("text")
    expected_type = "PRESUPUESTO" if "presupuesto" in pdf_path.name else "REMITO"
    required = ("FMH", expected_type, "La Emancipación", "23/07/2026")
    missing = [token for token in required if token.casefold() not in text.casefold()]
    if missing:
        raise RuntimeError(f"{pdf_path.name} no contiene: {', '.join(missing)}")
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2.4, 2.4), alpha=False)
    preview_path = pdf_path.with_name(f"{pdf_path.stem}-preview.png")
    pixmap.save(preview_path)
    document.close()
    return preview_path


def build_contact_sheet(previews: list[Path]) -> Path:
    font = label_font(28)
    thumb_width = 760
    thumb_height = 1075
    margin = 40
    label_height = 54
    rows = 5
    columns = 2
    canvas = Image.new(
        "RGB",
        (
            margin * (columns + 1) + thumb_width * columns,
            margin * (rows + 1) + (thumb_height + label_height) * rows,
        ),
        "white",
    )
    draw = ImageDraw.Draw(canvas)
    ordered = sorted(
        previews,
        key=lambda path: (
            path.parent.name[:2],
            0 if "presupuesto" in path.name else 1,
        ),
    )
    for index, preview_path in enumerate(ordered):
        row, column = divmod(index, 2)
        image = Image.open(preview_path).convert("RGB")
        image.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        x = margin + column * (thumb_width + margin)
        y = margin + row * (thumb_height + label_height + margin)
        canvas.paste(image, (x + (thumb_width - image.width) // 2, y))
        kind = "PRESUPUESTO" if "presupuesto" in preview_path.name else "REMITO"
        title = f"{preview_path.parent.name[:2]} · {kind}"
        draw.text((x, y + thumb_height + 8), title, fill="#17212B", font=font)
    output = ROOT / "00-comparativa-visual.png"
    canvas.save(output, quality=95)
    return output


def main() -> None:
    pdfs = sorted(ROOT.glob("*/*.pdf"))
    if len(pdfs) != 10:
        raise RuntimeError(f"Se esperaban 10 PDF y se encontraron {len(pdfs)}.")
    previews = [render_and_validate(path) for path in pdfs]
    contact_sheet = build_contact_sheet(previews)
    print({"pdfs": len(pdfs), "previews": len(previews), "contact_sheet": str(contact_sheet)})


if __name__ == "__main__":
    main()
