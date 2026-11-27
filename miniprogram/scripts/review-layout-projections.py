"""Optional local layout review; requires Python Playwright and Chromium, not a WeChat emulator."""
import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


async def review(args):
    root = Path(args.directory).resolve()
    profiles = json.loads(Path(args.profiles).read_text())["profiles"]
    config = json.loads(Path(args.browser_config).read_text()) if args.browser_config else {}
    results = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=config.get("path"), headless=True,
            args=config.get("args", []) + ["--allow-file-access-from-files"],
        )
        for profile in profiles:
            width, height = profile["width"], profile["height"]
            page = await browser.new_page(
                viewport={"width": width, "height": height}, device_scale_factor=profile["dpr"],
                reduced_motion="reduce",
            )
            for path in sorted(root.glob(f"*-{width}x{height}.html")):
                kind = path.name.removesuffix(f"-{width}x{height}.html")
                await page.goto(path.as_uri())
                await page.evaluate("document.fonts.ready")
                result = await page.evaluate("""() => {
                  const box=e=>{const r=e.getBoundingClientRect();return {class:e.className,x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}};
                  const panels=[...document.querySelectorAll('.sheet-frame,.choice-panel,.calendar-panel')].map(box);
                  const card=document.querySelector('.deck-active .paper-armed');let blockedCard=null;
                  if(card){const r=card.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(x>0&&x<innerWidth&&y>0&&y<innerHeight)blockedCard=!document.elementFromPoint(x,y)?.closest('.deck-card');}
                  const anchors=[...document.querySelectorAll('.post-action,.record-action')].map(e=>{const i=e.querySelector('img'),r=e.getBoundingClientRect(),b=i?.getBoundingClientRect();return b?{offset:b.x-r.x,width:b.width}:null});
                  return {width:innerWidth,scroll:document.documentElement.scrollWidth,panels,blockedCard,anchors};
                }""")
                result.update(device=profile["name"], viewport=[width, height], dpr=profile["dpr"], kind=kind)
                results.append(result)
                if width in (320, 365, 940) and kind in (
                    "tripSetup", "trip", "journalArmed", "journalDelete", "journalUp", "journalShare",
                    "journalShareSquare", "journalShareLandscape", "forum", "pollSearch", "mapFilter",
                    "libraryCalendar", "libraryFilter",
                ):
                    await page.screenshot(path=str(root / f"{kind}-{width}.png"))
            await page.close()
        await browser.close()
    (root / "metrics.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    overflow = [(r["kind"], r["viewport"], r["scroll"]) for r in results if r["scroll"] > r["width"] + 2]
    panels = [(r["kind"], r["viewport"], p) for r in results for p in r["panels"] if p["y"] < -1 or p["bottom"] > r["viewport"][1] + 1]
    blocked = [(r["kind"], r["viewport"]) for r in results if r["blockedCard"]]
    print(json.dumps({"cases": len(results), "devices": len(profiles), "overflow": overflow, "offscreenPanels": panels, "blockedArmedCards": blocked}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--profiles", default="docs/testing/device-profiles.json")
    parser.add_argument("--browser-config")
    asyncio.run(review(parser.parse_args()))
