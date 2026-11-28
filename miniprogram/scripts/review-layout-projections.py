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
                  const deck=document.querySelector('.deck-active .deck-card'),hint=document.querySelector('.paper-share-hint');
                  const draftActions=document.querySelector('.draft-deck .draft-card-actions');
                  const closeShapes=[...document.querySelectorAll('.calendar-close,.choice-close,.social-sheet-title button')].map(box);
                  const notePanes=[...document.querySelectorAll('.notes-list-pane,.note-detail-pane')].map(box);
                  return {width:innerWidth,scroll:document.documentElement.scrollWidth,panels,blockedCard,anchors,deck:deck?box(deck):null,hint:hint?box(hint):null,closeShapes,draftActions:draftActions?box(draftActions):null,notePanes};
                }""")
                result.update(device=profile["name"], viewport=[width, height], dpr=profile["dpr"], kind=kind)
                results.append(result)
                if width in (320, 365, 940) and kind in (
                    "tripSetup", "trip", "journalDeck", "journalArmed", "journalDelete", "journalUp", "journalShare",
                    "journalShareSquare", "journalShareLandscape", "forum", "pollSearch", "mapFilter",
                    "libraryCalendar", "libraryFilter", "calendarDay", "journalUpEarly", "tripHistory", "drafts", "friends",
                    "birdLibrary", "birdSaved", "externalGallery", "externalTimeline", "noteList", "noteEdit", "noteTrash", "groupSettings", "forward", "threadedPost", "growth",
                ):
                    await page.screenshot(path=str(root / f"{kind}-{width}.png"), scale="css")
            await page.close()
        await browser.close()
    (root / "metrics.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    overflow = [(r["kind"], r["viewport"], r["scroll"]) for r in results if r["scroll"] > r["width"] + 2]
    panels = [(r["kind"], r["viewport"], p) for r in results for p in r["panels"] if p["y"] < -1 or p["bottom"] > r["viewport"][1] + 1]
    blocked = [(r["kind"], r["viewport"]) for r in results if r["blockedCard"]]
    deck_bounds = [(r["kind"], r["viewport"], r["deck"]) for r in results if r["kind"] == "journalDeck" and r["deck"] and r["deck"]["bottom"] > r["viewport"][1]-65+1]
    close_shapes = [(r["kind"], r["viewport"], b) for r in results for b in r["closeShapes"] if abs(b["w"]-b["h"])>1]
    hint_overlap = [(r["kind"], r["viewport"]) for r in results if r["kind"] in ("journalArmed","journalUpEarly","journalUp") and r["deck"] and r["hint"] and r["hint"]["y"] < r["deck"]["bottom"]-1]
    draft_bounds=[(r["kind"],r["viewport"],r["draftActions"]) for r in results if r.get("draftActions") and r["draftActions"]["bottom"]>r["viewport"][1]+1]
    note_bounds=[(r["kind"],r["viewport"],b) for r in results for b in r.get("notePanes",[]) if b["bottom"]>r["viewport"][1]+1 or b["y"]<0 or b["h"]<=0 or b["x"]+b["w"]>r["viewport"][0]+1]
    print(json.dumps({"cases": len(results), "devices": len(profiles), "overflow": overflow, "offscreenPanels": panels, "blockedArmedCards": blocked,"deckBelowTabs":deck_bounds,"squashedCloseButtons":close_shapes,"overlappingShareHints":hint_overlap,"draftActionsOffscreen":draft_bounds,"notePanesOffscreen":note_bounds}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    parser.add_argument("--profiles", default="docs/testing/device-profiles.json")
    parser.add_argument("--browser-config")
    asyncio.run(review(parser.parse_args()))
