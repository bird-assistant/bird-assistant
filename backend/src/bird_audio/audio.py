"""Upload validation and decoding for the audio service.

Only ffmpeg touches compressed audio. It writes 48 kHz mono float32 PCM to a
pipe, so the service never has to ship a codec stack for MP3/AAC/M4A, and the
project's pre-research LiteRT runtime only ever sees raw samples.

Every upload is staged in a private temporary file first: ffmpeg needs a seekable
input for reliable container detection, and the file is removed on both the
success and the failure path.
"""

from __future__ import annotations

import array
import logging
import math
import shutil
import subprocess
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from bird_audio.config import AudioSettings
from bird_common.errors import ServiceError

F32_BYTES = 4

# Declared Content-Type -> container family. `application/octet-stream` and an
# absent header fall back to container sniffing, which is what WeChat uploads
# need on some platforms. Real clients send many aliases for the same audio
# (iOS `audio/x-m4a`, Android `audio/aacp`, browsers `audio/x-hx-aac-adts`), so
# the alias list is broad on purpose; the bytes still decide what we decode.
CONTENT_TYPE_FAMILIES: dict[str, str] = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/x-mp3": "mp3",
    "audio/mpeg3": "mp3",
    "audio/x-mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/vnd.wave": "wav",
    "audio/x-pn-wav": "wav",
    "audio/aac": "aac",
    "audio/x-aac": "aac",
    "audio/aacp": "aac",
    "audio/x-aacp": "aac",
    "audio/adts": "aac",
    "audio/x-hx-aac-adts": "aac",
    "audio/vnd.dlna.adts": "aac",
    "audio/mp4a-latm": "aac",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/m4b": "m4a",
    "video/mp4": "m4a",
    "video/x-m4v": "m4a",
    "audio/3gpp": "m4a",
    "video/3gpp": "m4a",
}
# AAC ships either as a raw ADTS stream or inside an MP4/M4A container. Clients
# routinely declare one while sending the other (iOS records AAC into `.m4a`
# but reports `audio/aac`), and both decode identically, so they are one family.
COMPATIBLE_CONTAINERS: dict[str, frozenset[str]] = {
    "mp3": frozenset({"mp3"}),
    "wav": frozenset({"wav"}),
    "aac": frozenset({"aac", "m4a"}),
    "m4a": frozenset({"aac", "m4a"}),
}
PASS_THROUGH_CONTENT_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
# The first release targets the formats the mini program recorder can produce.
SUPPORTED_FORMATS = ("mp3", "wav", "aac", "m4a")
# Containers we can name but deliberately do not serve in this release.
UNSUPPORTED_CONTAINERS = frozenset({"flac", "ogg", "opus", "aiff", "amr", "wma", "mp4-video"})
# Enough bytes to see past a typical ID3v2 tag before falling back to ffmpeg.
SNIFF_BYTES = 8 * 1024


@dataclass(frozen=True, slots=True)
class StagedAudio:
    path: Path
    size_bytes: int
    head: bytes
    filename: str | None
    content_type: str | None


@dataclass(frozen=True, slots=True)
class DecodedAudio:
    samples: array.array
    sample_rate: int
    duration_seconds: float
    container: str
    source_codec: str | None
    source_sample_rate: int | None
    source_channels: int | None
    decode_ms: float


class FfmpegRunner(Protocol):
    def __call__(self, args: Sequence[str], timeout: float) -> tuple[int, bytes, bytes]: ...


def _id3_payload_offset(head: bytes) -> int | None:
    """Byte offset of the payload after an ID3v2 tag, or None if it is not fully buffered."""
    if len(head) < 10 or head[:3] != b"ID3":
        return None
    size_bytes = head[6:10]
    if any(byte & 0x80 for byte in size_bytes):
        return None
    size = (size_bytes[0] << 21) | (size_bytes[1] << 14) | (size_bytes[2] << 7) | size_bytes[3]
    footer = 10 if (head[5] & 0x10) else 0
    offset = 10 + size + footer
    return offset if offset < len(head) else None


def sniff_container(head: bytes) -> str | None:
    """Identify the container from magic bytes instead of trusting the upload header.

    Both MP3 and AAC start with a ``0xFFF`` sync word, so the frame header decides:
    the layer bits are ``00`` for ADTS AAC and ``01`` for MPEG Layer III. The old
    allow-list of two ADTS bytes misread CRC-protected ADTS as MP3.
    """
    if len(head) >= 3 and head[:3] == b"ID3":
        payload = _id3_payload_offset(head)
        if payload is None:
            return None
        return sniff_container(head[payload:])
    if head[:9] == b"#!AMR-WB\n" or head[:6] == b"#!AMR\n":
        return "amr"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    for offset in range(0, min(len(head) - 8, 32), 4):
        if head[offset + 4 : offset + 8] == b"ftyp":
            return "m4a"
    if head[:4] == b"fLaC":
        return "flac"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:4] == b"FORM" and head[8:12] in {b"AIFF", b"AIFC"}:
        return "aiff"
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        layer = (head[1] >> 1) & 0x03
        if layer == 0:
            return "aac"
        if layer == 1:
            return "mp3"
    return None


def resolve_ffmpeg(settings: AudioSettings) -> str:
    """Locate the ffmpeg binary, preferring an explicit deployment setting."""
    if settings.ffmpeg_path.strip():
        explicit = Path(settings.ffmpeg_path.strip()).expanduser()
        if not explicit.is_file():
            raise ServiceError(
                "AUDIO_RUNTIME_UNAVAILABLE",
                "configured ffmpeg binary does not exist",
                503,
                {"ffmpeg_path": str(explicit)},
            )
        return str(explicit)
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    try:
        import imageio_ffmpeg
    except ImportError:
        imageio_ffmpeg = None
    if imageio_ffmpeg is not None:
        bundled = Path(imageio_ffmpeg.get_ffmpeg_exe())
        if bundled.is_file():
            return str(bundled)
    raise ServiceError(
        "AUDIO_RUNTIME_UNAVAILABLE",
        "ffmpeg is not installed and BIRD_AUDIO_FFMPEG_PATH is unset",
        503,
    )


def _subprocess_runner(args: Sequence[str], timeout: float) -> tuple[int, bytes, bytes]:
    completed = subprocess.run(  # noqa: S603 - fixed argv built from validated paths
        list(args),
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    return completed.returncode, completed.stdout, completed.stderr


_FFMPEG_INVALID_MARKERS = (
    "invalid data found",
    "could not find codec parameters",
    "moov atom not found",
    "error opening input",
    "does not contain any stream",
)


def _ffmpeg_cannot_parse(stderr: bytes) -> bool:
    """True when ffmpeg could not identify any stream in the input at all."""
    text = stderr.decode("utf-8", errors="replace").lower()
    return any(marker in text for marker in _FFMPEG_INVALID_MARKERS)


def _container_from_stderr(stderr: bytes) -> str | None:
    """Map ffmpeg's ``Input #0, <format>`` banner back to our container names."""
    text = stderr.decode("utf-8", errors="replace")
    for line in text.splitlines():
        marker = "Input #0, "
        if marker not in line:
            continue
        for token in line.split(marker, 1)[1].split(","):
            token = token.strip().lower()
            if token in {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}:
                return "m4a"
            if token in {"mp3", "wav", "aac"}:
                return token
    return None


def _parse_stream_info(stderr: bytes) -> tuple[str | None, int | None, int | None]:
    text = stderr.decode("utf-8", errors="replace")
    for line in text.splitlines():
        if "Audio:" not in line or "Hz" not in line:
            continue
        segment = line.split("Audio:", 1)[1]
        parts = [part.strip() for part in segment.split(",")]
        codec = parts[0].split()[0] if parts and parts[0] else None
        sample_rate = None
        channels = None
        for part in parts[1:]:
            if part.endswith("Hz") and sample_rate is None:
                digits = part.split(" Hz", 1)[0].strip()
                if digits.isdigit():
                    sample_rate = int(digits)
            elif channels is None and part.split()[0] in {"mono", "stereo"}:
                channels = 1 if part.startswith("mono") else 2
        if sample_rate is None:
            continue
        return codec, sample_rate, channels
    return None, None, None


class AudioDecoder:
    """Validate an upload and turn it into 48 kHz mono float32 samples."""

    def __init__(
        self,
        settings: AudioSettings,
        *,
        runner: FfmpegRunner | None = None,
        ffmpeg: str | None = None,
    ):
        self.settings = settings
        self._runner = runner or _subprocess_runner
        self._ffmpeg = ffmpeg

    @property
    def ffmpeg(self) -> str:
        if self._ffmpeg is None:
            self._ffmpeg = resolve_ffmpeg(self.settings)
        return self._ffmpeg

    def probe(self, staged: StagedAudio) -> str:
        """Return the container after byte-size, declaration and magic checks.

        ``"unknown"`` means the magic bytes are inconclusive (for example an
        unusual wrapper); `decode` then asks ffmpeg to identify the stream rather
        than rejecting a file the recorder can actually produce.
        """
        if staged.size_bytes == 0:
            raise ServiceError("EMPTY_AUDIO", "uploaded audio is empty", 422)
        if staged.size_bytes > self.settings.max_audio_bytes:
            raise ServiceError(
                "AUDIO_TOO_LARGE",
                "uploaded audio exceeds the byte limit",
                413,
                {"max_bytes": self.settings.max_audio_bytes, "actual_bytes": staged.size_bytes},
            )
        declared = (staged.content_type or "").split(";", 1)[0].strip().lower()
        if declared not in PASS_THROUGH_CONTENT_TYPES and declared not in CONTENT_TYPE_FAMILIES:
            raise ServiceError(
                "UNSUPPORTED_AUDIO_TYPE",
                "only MP3, WAV, AAC and M4A recordings are accepted",
                415,
                {
                    "content_type": declared,
                    "accepted_content_types": sorted(CONTENT_TYPE_FAMILIES),
                    "accepted_formats": list(SUPPORTED_FORMATS),
                },
            )
        container = sniff_container(staged.head)
        if container in UNSUPPORTED_CONTAINERS:
            raise ServiceError(
                "UNSUPPORTED_AUDIO_FORMAT",
                "this container is not supported in this release",
                415,
                {
                    "detected_format": container,
                    "supported_formats": list(SUPPORTED_FORMATS),
                    "head_hex": staged.head[:8].hex(),
                },
            )
        family = CONTENT_TYPE_FAMILIES.get(declared)
        if (
            container is not None
            and container in SUPPORTED_FORMATS
            and family is not None
            and container not in COMPATIBLE_CONTAINERS[family]
        ):
            raise ServiceError(
                "AUDIO_FORMAT_MISMATCH",
                "declared content type does not match the file content",
                415,
                {
                    "content_type": declared,
                    "detected_format": container,
                    "accepted_formats": sorted(COMPATIBLE_CONTAINERS[family]),
                },
            )
        return container or "unknown"

    def decode(self, staged: StagedAudio) -> DecodedAudio:
        container = self.probe(staged)
        started = time.perf_counter()
        # Ask for one second more than the limit so over-long clips are rejected
        # instead of silently truncated.
        cap_seconds = self.settings.max_duration_seconds + 1.0
        args = [
            self.ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "info",
            "-threads",
            str(self.settings.ffmpeg_threads),
            "-i",
            str(staged.path),
            "-vn",
            "-map_metadata",
            "-1",
            "-ac",
            "1",
            "-ar",
            str(self.settings.sample_rate),
            "-t",
            f"{cap_seconds:.3f}",
            "-f",
            "f32le",
            "pipe:1",
        ]
        try:
            returncode, stdout, stderr = self._runner(args, self.settings.ffmpeg_timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            raise ServiceError(
                "AUDIO_DECODE_TIMEOUT",
                "audio decoding exceeded the configured timeout",
                408,
                {"timeout_seconds": self.settings.ffmpeg_timeout_seconds},
            ) from exc
        except FileNotFoundError as exc:
            raise ServiceError("AUDIO_RUNTIME_UNAVAILABLE", "ffmpeg executable is unavailable", 503) from exc
        if returncode != 0:
            message = stderr.decode("utf-8", errors="replace").strip().splitlines()
            hint = message[-1][:200] if message else "ffmpeg failed"
            if container == "unknown" and _ffmpeg_cannot_parse(stderr):
                # Magic bytes were inconclusive and ffmpeg cannot identify any
                # stream: this is an unsupported upload, not a corrupt recording.
                raise ServiceError(
                    "UNSUPPORTED_AUDIO_FORMAT",
                    "file is not a recognisable audio recording",
                    415,
                    {"ffmpeg": hint, "head_hex": staged.head[:8].hex()},
                )
            raise ServiceError(
                "AUDIO_DECODE_FAILED",
                "audio cannot be decoded",
                422,
                {"ffmpeg": hint},
            )
        if container == "unknown":
            container = _container_from_stderr(stderr) or "unknown"
        usable = len(stdout) - (len(stdout) % F32_BYTES)
        if usable <= 0:
            raise ServiceError("AUDIO_DECODE_FAILED", "audio has no decodable samples", 422)
        samples = array.array("f")
        samples.frombytes(stdout[:usable])
        if samples.itemsize != F32_BYTES:  # pragma: no cover - defensive, all CPython builds agree
            raise ServiceError("INTERNAL_ERROR", "unexpected float sample width", 500)
        if len(samples) > self.settings.max_samples:
            raise ServiceError(
                "AUDIO_TOO_LONG",
                "audio exceeds the configured duration limit",
                413,
                {
                    "max_duration_seconds": self.settings.max_duration_seconds,
                    "detected_min_seconds": round(len(samples) / self.settings.sample_rate, 3),
                },
            )
        duration = len(samples) / self.settings.sample_rate
        if duration + 1e-6 < self.settings.min_duration_seconds:
            raise ServiceError(
                "AUDIO_TOO_SHORT",
                "audio is shorter than the minimum analyzable duration",
                422,
                {
                    "min_duration_seconds": self.settings.min_duration_seconds,
                    "detected_seconds": round(duration, 3),
                },
            )
        codec, source_rate, source_channels = _parse_stream_info(stderr)
        return DecodedAudio(
            samples=samples,
            sample_rate=self.settings.sample_rate,
            duration_seconds=duration,
            container=container,
            source_codec=codec,
            source_sample_rate=source_rate,
            source_channels=source_channels,
            decode_ms=(time.perf_counter() - started) * 1000.0,
        )


class AudioStager:
    """Stream an ``UploadFile`` into a private temporary file and clean it up."""

    def __init__(self, settings: AudioSettings, *, chunk_bytes: int = 256 * 1024):
        self.settings = settings
        self.chunk_bytes = chunk_bytes

    def _temp_dir(self) -> Path:
        if self.settings.temp_dir is not None:
            path = self.settings.temp_dir.expanduser()
            path.mkdir(parents=True, exist_ok=True)
            return path
        return Path(tempfile.gettempdir())

    async def stage(self, upload: UploadFileLike) -> StagedAudio:
        suffix = Path(upload.filename or "clip").suffix or ".bin"
        handle = tempfile.NamedTemporaryFile(  # noqa: SIM115 - closed explicitly below
            dir=self._temp_dir(),
            prefix="bird-audio-",
            suffix=suffix,
            delete=False,
        )
        path = Path(handle.name)
        size = 0
        head = b""
        try:
            while True:
                chunk = await upload.read(self.chunk_bytes)
                if not chunk:
                    break
                size += len(chunk)
                if size > self.settings.max_audio_bytes:
                    raise ServiceError(
                        "AUDIO_TOO_LARGE",
                        "uploaded audio exceeds the byte limit",
                        413,
                        {"max_bytes": self.settings.max_audio_bytes},
                    )
                if len(head) < SNIFF_BYTES:
                    head += chunk[: SNIFF_BYTES - len(head)]
                handle.write(chunk)
            handle.flush()
            handle.close()
        except BaseException:
            handle.close()
            path.unlink(missing_ok=True)
            raise
        return StagedAudio(
            path=path,
            size_bytes=size,
            head=head,
            filename=upload.filename,
            content_type=upload.content_type,
        )

    @staticmethod
    def discard(staged: StagedAudio | None) -> None:
        if staged is None:
            return
        try:
            staged.path.unlink(missing_ok=True)
        except OSError:
            # A decoder that is still holding the file (for example after a
            # processing timeout) must not turn a client error into a 500.
            logging.getLogger(__name__).warning(
                "temporary audio file could not be removed", extra={"detail": str(staged.path)}
            )


class UploadFileLike(Protocol):
    filename: str | None
    content_type: str | None

    async def read(self, size: int = -1) -> bytes: ...


def frame_energy(samples: Sequence[float]) -> float:
    """Root-mean-square amplitude; used by the mock engine and diagnostics."""
    if not samples:
        return 0.0
    total = math.fsum(value * value for value in samples)
    return math.sqrt(total / len(samples))
