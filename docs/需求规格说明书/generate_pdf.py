#!/usr/bin/env python3
"""Render the versioned Markdown SRS into a submission-ready Chinese PDF."""

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    XPreformatted,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "羽迹观鸟助手_软件需求规格说明书_V1.1.md"
DEFAULT_OUTPUT = ROOT / "羽迹观鸟助手_软件需求规格说明书_V1.1.pdf"
FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
    Path("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"),
    Path("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"),
)

NAVY = colors.HexColor("#18324A")
TEAL = colors.HexColor("#2A8C82")
PALE_TEAL = colors.HexColor("#EAF5F3")
PALE_BLUE = colors.HexColor("#EDF3F8")
INK = colors.HexColor("#263238")
MUTED = colors.HexColor("#60727D")
GRID = colors.HexColor("#B8C7CF")
LIGHT_GRID = colors.HexColor("#D9E2E7")


def register_fonts() -> tuple[str, str]:
    font_path = next((path for path in FONT_CANDIDATES if path.exists()), None)
    if font_path is None:
        raise RuntimeError("未找到可嵌入的中文字体，请安装 Droid Sans Fallback 或 IPA Gothic")
    pdfmetrics.registerFont(TTFont("SRS-CJK", str(font_path)))
    pdfmetrics.registerFont(TTFont("SRS-CJK-Bold", str(font_path)))
    return "SRS-CJK", "SRS-CJK-Bold"


FONT, FONT_BOLD = register_fonts()


class HorizontalRule(Flowable):
    def __init__(self, width: float, color=TEAL, thickness: float = 1.5):
        super().__init__()
        self.width = width
        self.height = 3 * mm
        self.color = color
        self.thickness = thickness

    def draw(self) -> None:
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.height / 2, self.width, self.height / 2)


class SRSDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        self._bookmark_index = 0

    def beforeDocument(self):
        self._bookmark_index = 0

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        level = getattr(flowable, "_srs_heading_level", None)
        if level is None:
            return
        self._bookmark_index += 1
        key = f"heading-{self._bookmark_index}"
        text = flowable.getPlainText()
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    result: dict[str, ParagraphStyle] = {}
    result["body"] = ParagraphStyle(
        "SRSBody",
        parent=base["BodyText"],
        fontName=FONT,
        fontSize=9.4,
        leading=16,
        textColor=INK,
        alignment=TA_JUSTIFY,
        firstLineIndent=18.8,
        spaceAfter=3.2 * mm,
        wordWrap="CJK",
        splitLongWords=True,
    )
    result["bullet"] = ParagraphStyle(
        "SRSBullet",
        parent=result["body"],
        leftIndent=6 * mm,
        firstLineIndent=-4 * mm,
        spaceAfter=1.5 * mm,
    )
    result["number"] = ParagraphStyle(
        "SRSNumber",
        parent=result["body"],
        leftIndent=7 * mm,
        firstLineIndent=-6 * mm,
        spaceAfter=1.5 * mm,
    )
    result["quote"] = ParagraphStyle(
        "SRSQuote",
        parent=result["body"],
        leftIndent=7 * mm,
        rightIndent=4 * mm,
        firstLineIndent=0,
        borderPadding=(2 * mm, 3 * mm, 2 * mm, 4 * mm),
        backColor=PALE_TEAL,
        textColor=MUTED,
    )
    result["h1"] = ParagraphStyle(
        "SRSHeading1",
        parent=base["Heading1"],
        fontName=FONT_BOLD,
        fontSize=17,
        leading=23,
        textColor=NAVY,
        spaceBefore=6 * mm,
        spaceAfter=4 * mm,
        keepWithNext=True,
        wordWrap="CJK",
    )
    result["h2"] = ParagraphStyle(
        "SRSHeading2",
        parent=base["Heading2"],
        fontName=FONT_BOLD,
        fontSize=13,
        leading=19,
        textColor=TEAL,
        spaceBefore=4.5 * mm,
        spaceAfter=2.5 * mm,
        keepWithNext=True,
        wordWrap="CJK",
    )
    result["h3"] = ParagraphStyle(
        "SRSHeading3",
        parent=base["Heading3"],
        fontName=FONT_BOLD,
        fontSize=10.5,
        leading=16,
        textColor=NAVY,
        spaceBefore=3.5 * mm,
        spaceAfter=2 * mm,
        keepWithNext=True,
        wordWrap="CJK",
    )
    result["table"] = ParagraphStyle(
        "SRSTable",
        fontName=FONT,
        fontSize=7.5,
        leading=11.2,
        textColor=INK,
        alignment=TA_LEFT,
        wordWrap="CJK",
        splitLongWords=True,
    )
    result["table_header"] = ParagraphStyle(
        "SRSTableHeader",
        parent=result["table"],
        fontName=FONT_BOLD,
        textColor=colors.white,
        alignment=TA_CENTER,
    )
    result["code"] = ParagraphStyle(
        "SRSCode",
        fontName=FONT,
        fontSize=7.1,
        leading=10.2,
        leftIndent=3 * mm,
        rightIndent=3 * mm,
        borderColor=LIGHT_GRID,
        borderWidth=0.6,
        borderPadding=3 * mm,
        backColor=colors.HexColor("#F6F8FA"),
        textColor=colors.HexColor("#263A43"),
        spaceBefore=1.5 * mm,
        spaceAfter=3 * mm,
    )
    result["toc0"] = ParagraphStyle(
        "TOC0",
        fontName=FONT,
        fontSize=10,
        leading=16,
        textColor=NAVY,
        spaceBefore=1.3 * mm,
    )
    result["toc1"] = ParagraphStyle(
        "TOC1", parent=result["toc0"], fontSize=9, leftIndent=7 * mm, textColor=INK
    )
    result["toc2"] = ParagraphStyle(
        "TOC2", parent=result["toc0"], fontSize=8, leftIndent=14 * mm, textColor=MUTED
    )
    result["cover_title"] = ParagraphStyle(
        "CoverTitle",
        fontName=FONT_BOLD,
        fontSize=29,
        leading=40,
        alignment=TA_CENTER,
        textColor=NAVY,
        wordWrap="CJK",
    )
    result["cover_subtitle"] = ParagraphStyle(
        "CoverSubtitle",
        fontName=FONT,
        fontSize=14,
        leading=23,
        alignment=TA_CENTER,
        textColor=TEAL,
    )
    result["small"] = ParagraphStyle(
        "Small",
        parent=result["body"],
        fontSize=8,
        leading=12,
        firstLineIndent=0,
        textColor=MUTED,
        alignment=TA_CENTER,
    )
    return result


STYLES = make_styles()


def inline_markup(value: str) -> str:
    value = html.escape(value.strip(), quote=False)
    value = re.sub(r"`([^`]+)`", r"<font name='SRS-CJK' color='#245E73'>\1</font>", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"\[([^]]+)]\(([^)]+)\)", r"<link href='\2' color='#1E7180'>\1</link>", value)
    return value


def heading(text: str, level: int) -> Paragraph:
    style_name = {2: "h1", 3: "h2", 4: "h3"}.get(level, "h3")
    paragraph = Paragraph(inline_markup(text), STYLES[style_name])
    paragraph._srs_heading_level = min(max(level - 2, 0), 2)
    return paragraph


def table_column_widths(rows: list[list[str]], available: float) -> list[float]:
    count = max(len(row) for row in rows)
    maxima = []
    for index in range(count):
        values = [row[index] if index < len(row) else "" for row in rows]
        logical = max(
            4,
            min(38, max(sum(2 if ord(ch) > 127 else 1 for ch in value) for value in values)),
        )
        maxima.append(logical)
    floor = 16 * mm if count <= 6 else 12 * mm
    raw = [max(floor, available * logical / sum(maxima)) for logical in maxima]
    scale = available / sum(raw)
    return [width * scale for width in raw]


def build_table(rows: list[list[str]], available: float) -> Table:
    column_count = max(len(row) for row in rows)
    normalized = [row + [""] * (column_count - len(row)) for row in rows]
    widths = table_column_widths(normalized, available)
    if any(re.fullmatch(r"FR-[A-Z]+-\d{3}", row[0]) for row in normalized[1:]):
        # Keep requirement IDs on one line; broken IDs are hard to search in the PDF.
        minimum_id_width = 20 * mm
        if widths[0] < minimum_id_width:
            reclaimed = minimum_id_width - widths[0]
            other_total = sum(widths[1:])
            widths = [
                minimum_id_width,
                *(width - reclaimed * width / other_total for width in widths[1:]),
            ]
    rendered = []
    for row_index, row in enumerate(normalized):
        style = STYLES["table_header"] if row_index == 0 else STYLES["table"]
        rendered.append([Paragraph(inline_markup(cell), style) for cell in row])
    table = Table(
        rendered,
        colWidths=widths,
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=True,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, 0), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2.2 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2.2 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 1.7 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1.7 * mm),
                ("GRID", (0, 0), (-1, -1), 0.35, GRID),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE_BLUE]),
            ]
        )
    )
    return table


def parse_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    rows: list[list[str]] = []
    index = start
    while index < len(lines) and lines[index].strip().startswith("|"):
        cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        rows.append(cells)
        index += 1
    if len(rows) >= 2 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1]):
        rows.pop(1)
    return rows, index


def make_toc() -> TableOfContents:
    toc = TableOfContents()
    toc.levelStyles = [STYLES["toc0"], STYLES["toc1"], STYLES["toc2"]]
    toc.dotsMinLevel = 0
    return toc


def cover_story(available: float) -> list[Flowable]:
    meta = [
        ["文档版本", "V1.1"],
        ["文档状态", "最终提交版"],
        ["项目负责人", "刘景程"],
        ["项目团队", "刘景程、周厚霖、吕思涵、何盛安"],
        ["编制日期", "2026 年 10 月 24 日"],
    ]
    meta_table = Table(
        [[Paragraph(k, STYLES["table"]), Paragraph(v, STYLES["table"])] for k, v in meta],
        colWidths=[34 * mm, 86 * mm],
        hAlign="CENTER",
    )
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
                ("TEXTCOLOR", (0, 0), (0, -1), NAVY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("GRID", (0, 0), (-1, -1), 0.45, LIGHT_GRID),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ]
        )
    )
    return [
        Spacer(1, 42 * mm),
        Paragraph("羽迹（观鸟助手）", STYLES["cover_title"]),
        Spacer(1, 5 * mm),
        Paragraph("软件需求规格说明书", STYLES["cover_subtitle"]),
        Spacer(1, 11 * mm),
        HorizontalRule(available, TEAL, 2),
        Spacer(1, 18 * mm),
        meta_table,
        Spacer(1, 26 * mm),
        Paragraph("以真实观察证据为中心的探索、辨识、记录与成长助手", STYLES["small"]),
        PageBreak(),
    ]


def markdown_story(source: str, available: float) -> list[Flowable]:
    lines = source.splitlines()
    first_break = next((i for i, line in enumerate(lines) if line.strip() == "<pagebreak>"), None)
    if first_break is not None:
        lines = lines[first_break + 1 :]
    story: list[Flowable] = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        text = " ".join(part.strip() for part in paragraph_lines if part.strip())
        paragraph_lines.clear()
        if text:
            story.append(Paragraph(inline_markup(text), STYLES["body"]))

    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        if stripped == "<pagebreak>":
            flush_paragraph()
            if not story or not isinstance(story[-1], PageBreak):
                story.append(PageBreak())
            index += 1
            continue
        if stripped.startswith("```"):
            flush_paragraph()
            language = stripped[3:].strip()
            index += 1
            code_lines = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            if index < len(lines):
                index += 1
            label = f"[{language}]\n" if language else ""
            story.append(XPreformatted(label + "\n".join(code_lines), STYLES["code"]))
            continue
        match = re.match(r"^(#{2,4})\s+(.+)$", stripped)
        if match:
            flush_paragraph()
            level = len(match.group(1))
            text = match.group(2)
            heading_flowable = heading(text, level)
            if text == "目录":
                # The contents page is navigation, not a navigable chapter.
                heading_flowable._srs_heading_level = None
            story.append(heading_flowable)
            if text == "目录":
                story.append(make_toc())
                probe = index + 1
                while probe < len(lines) and not lines[probe].strip():
                    probe += 1
                if probe < len(lines) and "自动生成" in lines[probe]:
                    index = probe
            index += 1
            continue
        if stripped.startswith("|"):
            flush_paragraph()
            rows, index = parse_table(lines, index)
            story.append(build_table(rows, available))
            story.append(Spacer(1, 3 * mm))
            continue
        bullet_match = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet_match:
            flush_paragraph()
            story.append(Paragraph("• " + inline_markup(bullet_match.group(1)), STYLES["bullet"]))
            index += 1
            continue
        number_match = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if number_match:
            flush_paragraph()
            story.append(
                Paragraph(
                    f"{number_match.group(1)}. " + inline_markup(number_match.group(2)),
                    STYLES["number"],
                )
            )
            index += 1
            continue
        if stripped.startswith(">"):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped.lstrip("> ")), STYLES["quote"]))
            index += 1
            continue
        if stripped == "---":
            flush_paragraph()
            story.append(HorizontalRule(available, LIGHT_GRID, 0.8))
            index += 1
            continue
        paragraph_lines.append(stripped)
        index += 1
    flush_paragraph()
    return story


def draw_page(canvas, doc) -> None:
    page = canvas.getPageNumber()
    width, height = A4
    canvas.saveState()
    if page == 1:
        canvas.setFillColor(NAVY)
        canvas.rect(0, height - 14 * mm, width, 14 * mm, fill=1, stroke=0)
        canvas.setFillColor(TEAL)
        canvas.rect(0, 0, width, 7 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#DCEFED"))
        canvas.circle(width - 24 * mm, height - 34 * mm, 16 * mm, fill=1, stroke=0)
        canvas.setFillColor(TEAL)
        canvas.circle(width - 24 * mm, height - 34 * mm, 8 * mm, fill=1, stroke=0)
    else:
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin, height - 14 * mm, "羽迹（观鸟助手）软件需求规格说明书 · V1.1")
        canvas.drawRightString(width - doc.rightMargin, height - 14 * mm, "最终提交版")
        canvas.setStrokeColor(LIGHT_GRID)
        canvas.setLineWidth(0.5)
        canvas.line(doc.leftMargin, height - 16 * mm, width - doc.rightMargin, height - 16 * mm)
        canvas.line(doc.leftMargin, 15 * mm, width - doc.rightMargin, 15 * mm)
        canvas.setFont(FONT, 8)
        canvas.drawCentredString(width / 2, 10 * mm, f"第 {page - 1} 页")
    canvas.restoreState()


def validate_source(text: str) -> None:
    required = (
        "## 1. 简介",
        "## 2. 综合描述",
        "## 3. 需求调研、用户故事与交互原型",
        "## 4. 系统功能需求",
        "## 5. 数据需求与业务规则",
        "## 6. 总体架构、技术选型与外部接口",
        "## 7. 非功能需求",
        "## 8. 验收与需求追踪",
        "## 9. 风险、限制与发布策略",
        "## 10. 开发迭代计划与分工",
        "### 3.7 用户故事地图",
        "### 3.8 用户故事卡",
        "### 3.9 交互原型设计与逐故事追踪",
        "### C.1 作业要求覆盖对照",
        "77.42%",
        "LIVE-01",
        "captured_at",
        "latitude",
        "longitude",
    )
    missing = [item for item in required if item not in text]
    if missing:
        raise ValueError(f"需求源文件缺少关键内容：{', '.join(missing)}")
    if len(set(re.findall(r"\bFR-[A-Z]+-\d{3}\b", text))) < 60:
        raise ValueError("功能需求编号少于 60 条，文档可能不完整")


def generate(source_path: Path, output_path: Path) -> None:
    source = source_path.read_text(encoding="utf-8")
    validate_source(source)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    left, right, top, bottom = 19 * mm, 19 * mm, 22 * mm, 20 * mm
    available = A4[0] - left - right
    doc = SRSDocTemplate(
        str(output_path),
        pagesize=A4,
        leftMargin=left,
        rightMargin=right,
        topMargin=top,
        bottomMargin=bottom,
        title="羽迹（观鸟助手）软件需求规格说明书 V1.1",
        author="羽迹观鸟助手项目组",
        subject="软件需求规格说明书",
        creator="bird-assistant/docs/需求规格说明书/generate_pdf.py",
    )
    frame = Frame(left, bottom, available, A4[1] - top - bottom, id="normal")
    doc.addPageTemplates(PageTemplate(id="srs", frames=[frame], onPage=draw_page))
    story = cover_story(available) + markdown_story(source, available)
    doc.multiBuild(story)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成羽迹软件需求规格说明书 PDF")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    generate(args.source.resolve(), args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
