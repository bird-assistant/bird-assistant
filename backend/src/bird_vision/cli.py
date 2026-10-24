from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Bird Assistant vision inference service")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="must remain 1 for a single GPU/session tracker",
    )
    args = parser.parse_args()
    if args.workers != 1:
        parser.error(
            "this service keeps per-session tracking state; "
            "use one process per GPU and route sessions stickily"
        )
    import uvicorn

    uvicorn.run("bird_vision.app:app", host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()
