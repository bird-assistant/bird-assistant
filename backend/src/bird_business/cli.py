from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Bird Assistant business API")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8200)
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="must remain 1 with the bundled SQLite store",
    )
    args = parser.parse_args()
    if args.workers != 1:
        parser.error("the bundled SQLite store requires a single process; use an external database to scale")
    import uvicorn

    uvicorn.run("bird_business.app:app", host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()
