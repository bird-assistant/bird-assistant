"""Render six source-projection viewports into a labelled review sheet; never a device screenshot."""
import argparse
import asyncio
import base64
import json
from pathlib import Path

from playwright.async_api import async_playwright


async def main(args):
    directory = Path(args.directory).resolve()
    config = json.loads(Path(args.browser_config).read_text())
    states = [
        ("journalUp", "手帐入云 / Journal cloud"),
        ("noteEdit", "本机随手记 / Field memo"),
        ("groupSettings", "群资料抽屉 / Group drawer"),
        ("birdLibrary", "资料库 / Bird library"),
        ("externalGallery", "外部鸟讯 / Sightings"),
        ("forward", "转发确认 / Forward review"),
    ]
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=config["path"], headless=True,
            args=config.get("args", []) + ["--allow-file-access-from-files"],
        )
        figures = []
        for state, title in states:
            page = await browser.new_page(viewport={"width": 365, "height": 814}, reduced_motion="reduce")
            await page.goto((directory / f"{state}-365x814.html").as_uri())
            await page.evaluate("document.fonts.ready")
            data = await page.screenshot(scale="css")
            figures.append(f'<figure><figcaption>{title}</figcaption><img src="data:image/png;base64,{base64.b64encode(data).decode()}"></figure>')
            await page.close()
        html = """<!doctype html><meta charset="utf-8"><style>
        *{box-sizing:border-box}body{margin:0;padding:24px;background:#e8efdf;color:#34573f;font-family:system-ui,'Noto Sans CJK SC',sans-serif}
        h1{font-size:23px;margin:0 0 8px}p{font-size:12px;line-height:1.7;color:#7c9069;margin:0 0 21px}
        main{display:grid;grid-template-columns:repeat(3,365px);gap:20px 16px}figure{margin:0;background:#fafbf5;border-radius:13px;overflow:hidden;border:1px solid #cfddc0}
        figcaption{padding:11px 13px;font-size:13px;border-bottom:1px solid #dce5d0}img{width:365px;height:814px;display:block}
        </style><h1>羽迹 0.4.19 · Client review</h1><p>Native-source browser projections · 365×814 viewport excerpts · Original sample illustrations / demo identities only.<br>源码布局投影，非微信模拟器或真机截图；未表示线上社交验收。群改名／管理员／图片回复另见独立设计原型。</p><main>""" + "".join(figures) + "</main>"
        page = await browser.new_page(viewport={"width": 1175, "height": 1900})
        await page.set_content(html)
        await page.evaluate("document.fonts.ready")
        await page.screenshot(path=args.output, full_page=True, scale="css")
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("output")
    parser.add_argument("--browser-config", required=True)
    asyncio.run(main(parser.parse_args()))
