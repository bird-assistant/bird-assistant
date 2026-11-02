from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Bird Assistant audio recognition service")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="must remain 1: the model and admission counters live in this process",
    )
    args = parser.parse_args()
    if args.workers != 1:
        parser.error(
            "the audio model and admission state are process-local; "
            "scale out with more replicas behind the gateway instead of workers"
        )
    import uvicorn

    uvicorn.run("bird_audio.app:app", host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()
