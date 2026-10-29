from __future__ import annotations

import array
import subprocess
from pathlib import Path

import pytest

from bird_audio.audio import (
    AudioDecoder,
    AudioStager,
    StagedAudio,
    frame_energy,
    resolve_ffmpeg,
    sniff_container,
)
from bird_common.errors import ServiceError

SAMPLE_RATE = 48_000
# Minimal realistic payloads: an ID3v2 header (zero-length tag) followed by a
# real frame header. The frame header is what identifies MP3 vs ADTS AAC.
MP3_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" + bytes(512)
ADTS_BYTES = b"\xff\xf1\x50\x80" + bytes(512)
ADTS_CRC_BYTES = b"\xff\xf0\x50\x80" + bytes(512)
M4A_BYTES = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00" + bytes(512)


class FakeRunner:
    def __init__(
        self,
        *,
        stdout: bytes = b"",
        returncode: int = 0,
        stderr: bytes = b"",
        error: BaseException | None = None,
    ) -> None:
        self.stdout = stdout
        self.returncode = returncode
        self.stderr = stderr
        self.error = error
        self.calls: list[tuple[list[str], float]] = []

    def __call__(self, args, timeout):  # noqa: ANN001 - test double
        self.calls.append((list(args), timeout))
        if self.error is not None:
            raise self.error
        return self.returncode, self.stdout, self.stderr


class FakeUpload:
    def __init__(self, data: bytes, *, filename: str = "clip.mp3", content_type: str = "audio/mpeg"):
        self._data = data
        self.filename = filename
        self.content_type = content_type

    async def read(self, size: int = -1) -> bytes:
        if not self._data:
            return b""
        if size is None or size < 0:
            chunk, self._data = self._data, b""
            return chunk
        chunk, self._data = self._data[:size], self._data[size:]
        return chunk


def samples_bytes(count: int, *, value: float = 0.1) -> bytes:
    return array.array("f", [value] * count).tobytes()


def stage_bytes(tmp_path: Path, data: bytes, *, content_type: str = "audio/mpeg") -> StagedAudio:
    path = tmp_path / "clip.mp3"
    path.write_bytes(data)
    return StagedAudio(
        path=path,
        size_bytes=len(data),
        head=data[:64],
        filename="clip.mp3",
        content_type=content_type,
    )


def make_decoder(settings, runner: FakeRunner) -> AudioDecoder:
    return AudioDecoder(settings, runner=runner, ffmpeg="ffmpeg")


@pytest.mark.parametrize(
    ("head", "expected"),
    [
        # MP3: layer bits 01 (MPEG-1, MPEG-2, MPEG-2.5, with and without CRC).
        (MP3_BYTES, "mp3"),
        (b"\xff\xfb\x90\x00" + bytes(12), "mp3"),
        (b"\xff\xfa\x90\x00" + bytes(12), "mp3"),
        (b"\xff\xf3\x90\x00" + bytes(12), "mp3"),
        (b"\xff\xf2\x90\x00" + bytes(12), "mp3"),
        (b"\xff\xe3\x90\x00" + bytes(12), "mp3"),
        # ADTS AAC: layer bits 00. 0xF0/0xF8 (CRC present) were previously
        # misread as MP3, which made declared `audio/aac` uploads fail.
        (b"\xff\xf1\x50\x80" + bytes(12), "aac"),
        (b"\xff\xf9\x50\x80" + bytes(12), "aac"),
        (b"\xff\xf0\x50\x80" + bytes(12), "aac"),
        (b"\xff\xf8\x50\x80" + bytes(12), "aac"),
        # An ID3v2 tag must be skipped before looking at the frame header.
        (b"ID3\x04\x00\x00\x00\x00\x00\x04" + bytes(4) + b"\xff\xf1\x50\x80" + bytes(8), "aac"),
        # Layer I/II are neither supported container.
        (b"\xff\xfd\x90\x00" + bytes(12), None),
        (b"RIFF\x00\x00\x00\x00WAVEfmt ", "wav"),
        (b"\x00\x00\x00\x20ftypM4A " + bytes(8), "m4a"),
        (b"\x00\x00\x00\x08free\x00\x00\x00\x20ftypisom" + bytes(8), "m4a"),
        (M4A_BYTES, "m4a"),
        (b"#!AMR\n\x3c\x00\x00", "amr"),
        (b"#!AMR-WB\n\x3c\x00", "amr"),
        (b"fLaC\x00\x00\x00\x22", "flac"),
        (b"OggS\x00\x02\x00\x00", "ogg"),
        (b"FORM\x00\x00\x00\x00AIFF", "aiff"),
        (b"not audio at all", None),
    ],
)
def test_sniff_container(head: bytes, expected: str | None) -> None:
    assert sniff_container(head) == expected


def test_probe_rejects_empty_upload(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, b"")
    staged = StagedAudio(staged.path, 0, b"", "clip.mp3", "audio/mpeg")
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "EMPTY_AUDIO"
    assert excinfo.value.status_code == 422


def test_probe_rejects_oversized_file(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = StagedAudio(
        path=tmp_path / "big.mp3",
        size_bytes=audio_settings.max_audio_bytes + 1,
        head=b"ID3",
        filename="big.mp3",
        content_type="audio/mpeg",
    )
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "AUDIO_TOO_LARGE"
    assert excinfo.value.details == {
        "max_bytes": audio_settings.max_audio_bytes,
        "actual_bytes": audio_settings.max_audio_bytes + 1,
    }


def test_probe_rejects_unsupported_declared_type(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, MP3_BYTES, content_type="audio/amr")
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "UNSUPPORTED_AUDIO_TYPE"
    assert excinfo.value.status_code == 415
    assert "audio/aacp" in excinfo.value.details["accepted_content_types"]


@pytest.mark.parametrize(
    "content_type",
    ["audio/aacp", "audio/x-hx-aac-adts", "audio/vnd.dlna.adts", "audio/mp4a-latm", "audio/adts"],
)
def test_probe_accepts_aac_content_type_aliases(audio_settings, tmp_path, content_type: str) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, ADTS_BYTES, content_type=content_type)
    assert decoder.probe(staged) == "aac"


def test_probe_accepts_video_mp4_alias(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, M4A_BYTES, content_type="video/mp4")
    assert decoder.probe(staged) == "m4a"


def test_probe_accepts_m4a_declared_as_aac(audio_settings, tmp_path) -> None:
    """iOS records AAC into an MP4 container but reports ``audio/aac``."""
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, M4A_BYTES, content_type="audio/aac")
    assert decoder.probe(staged) == "m4a"


def test_probe_accepts_adts_declared_as_mp4(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, ADTS_BYTES, content_type="audio/mp4")
    assert decoder.probe(staged) == "aac"


def test_probe_accepts_crc_protected_adts(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, ADTS_CRC_BYTES, content_type="audio/aac")
    assert decoder.probe(staged) == "aac"


def test_probe_returns_unknown_for_inconclusive_magic(audio_settings, tmp_path) -> None:
    """Unknown magic is no longer rejected here; ffmpeg decides during decode."""
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, b"definitely not audio")
    assert decoder.probe(staged) == "unknown"


def test_decode_rejects_undecodable_unknown_container(audio_settings, tmp_path) -> None:
    runner = FakeRunner(
        returncode=1,
        stderr=b"clip.mp3: Invalid data found when processing input\n",
    )
    decoder = make_decoder(audio_settings, runner)
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, b"definitely not audio"))
    assert excinfo.value.code == "UNSUPPORTED_AUDIO_FORMAT"
    assert excinfo.value.status_code == 415
    assert excinfo.value.details["head_hex"] == b"definitely not audio"[:8].hex()


def test_decode_accepts_unknown_container_when_ffmpeg_identifies_audio(audio_settings, tmp_path) -> None:
    stderr = (
        b"Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.bin':\n  Stream #0:0: Audio: aac, 44100 Hz, mono\n"
    )
    runner = FakeRunner(stdout=samples_bytes(2 * SAMPLE_RATE), stderr=stderr)
    decoder = make_decoder(audio_settings, runner)
    decoded = decoder.decode(stage_bytes(tmp_path, b"\x00\x01\x02\x03weird-wrapper" + bytes(64)))
    assert decoded.container == "m4a"
    assert decoded.duration_seconds == pytest.approx(2.0)


def test_probe_rejects_container_outside_release_scope(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, b"fLaC" + bytes(60), content_type="application/octet-stream")
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "UNSUPPORTED_AUDIO_FORMAT"
    assert excinfo.value.details["detected_format"] == "flac"


def test_probe_rejects_amr_container(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(
        tmp_path, b"#!AMR\n\x3c\x00\x00" + bytes(60), content_type="application/octet-stream"
    )
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "UNSUPPORTED_AUDIO_FORMAT"
    assert excinfo.value.details["detected_format"] == "amr"


def test_probe_rejects_amr_content_type(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, b"#!AMR\n\x3c\x00\x00" + bytes(60), content_type="audio/amr")
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "UNSUPPORTED_AUDIO_TYPE"


def test_probe_rejects_content_type_mismatch(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, MP3_BYTES, content_type="audio/wav")
    with pytest.raises(ServiceError) as excinfo:
        decoder.probe(staged)
    assert excinfo.value.code == "AUDIO_FORMAT_MISMATCH"
    assert excinfo.value.details == {
        "content_type": "audio/wav",
        "detected_format": "mp3",
        "accepted_formats": ["wav"],
    }


def test_probe_accepts_octet_stream_and_sniffs(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner())
    staged = stage_bytes(tmp_path, MP3_BYTES, content_type="application/octet-stream")
    assert decoder.probe(staged) == "mp3"


def test_decode_returns_48k_mono_samples(audio_settings, tmp_path) -> None:
    stderr = b"  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s\n"
    runner = FakeRunner(stdout=samples_bytes(3 * SAMPLE_RATE, value=0.25), stderr=stderr)
    decoder = make_decoder(audio_settings, runner)
    decoded = decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert decoded.sample_rate == SAMPLE_RATE
    assert decoded.duration_seconds == pytest.approx(3.0)
    assert decoded.container == "mp3"
    assert decoded.source_codec == "mp3"
    assert decoded.source_sample_rate == 44_100
    assert decoded.source_channels == 2
    assert decoded.decode_ms >= 0.0
    args = runner.calls[0][0]
    assert "-ar" in args and args[args.index("-ar") + 1] == "48000"
    assert "-ac" in args and args[args.index("-ac") + 1] == "1"
    assert "pipe:1" in args


def test_decode_rejects_too_long_audio(audio_settings, tmp_path) -> None:
    over = audio_settings.max_samples + SAMPLE_RATE
    decoder = make_decoder(audio_settings, FakeRunner(stdout=samples_bytes(over)))
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert excinfo.value.code == "AUDIO_TOO_LONG"
    assert excinfo.value.status_code == 413
    assert excinfo.value.details["max_duration_seconds"] == audio_settings.max_duration_seconds


def test_decode_rejects_too_short_audio(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner(stdout=samples_bytes(SAMPLE_RATE // 2)))
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert excinfo.value.code == "AUDIO_TOO_SHORT"


def test_decode_fails_when_no_samples_are_produced(audio_settings, tmp_path) -> None:
    decoder = make_decoder(audio_settings, FakeRunner(stdout=b""))
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert excinfo.value.code == "AUDIO_DECODE_FAILED"


def test_decode_reports_ffmpeg_failure(audio_settings, tmp_path) -> None:
    runner = FakeRunner(returncode=1, stderr=b"clip.mp3: Invalid data found when processing input\n")
    decoder = make_decoder(audio_settings, runner)
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert excinfo.value.code == "AUDIO_DECODE_FAILED"
    assert excinfo.value.details["ffmpeg"].startswith("clip.mp3: Invalid data")


def test_decode_maps_ffmpeg_timeout(audio_settings, tmp_path) -> None:
    runner = FakeRunner(error=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1))
    decoder = make_decoder(audio_settings, runner)
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert excinfo.value.code == "AUDIO_DECODE_TIMEOUT"
    assert excinfo.value.status_code == 408


def test_decode_reports_missing_ffmpeg_binary(audio_settings, tmp_path) -> None:
    runner = FakeRunner(error=FileNotFoundError("ffmpeg"))
    decoder = make_decoder(audio_settings, runner)
    with pytest.raises(ServiceError) as excinfo:
        decoder.decode(stage_bytes(tmp_path, MP3_BYTES))
    assert excinfo.value.code == "AUDIO_RUNTIME_UNAVAILABLE"
    assert excinfo.value.status_code == 503


def test_resolve_ffmpeg_prefers_configured_path(audio_settings, tmp_path, monkeypatch) -> None:
    binary = tmp_path / "ffmpeg"
    binary.write_bytes(b"#!/bin/sh\n")
    configured = audio_settings.model_copy(update={"ffmpeg_path": str(binary)})
    assert resolve_ffmpeg(configured) == str(binary)


def test_resolve_ffmpeg_rejects_missing_configured_path(audio_settings) -> None:
    configured = audio_settings.model_copy(update={"ffmpeg_path": "C:/nope/ffmpeg"})
    with pytest.raises(ServiceError) as excinfo:
        resolve_ffmpeg(configured)
    assert excinfo.value.code == "AUDIO_RUNTIME_UNAVAILABLE"


def test_resolve_ffmpeg_uses_path_lookup(audio_settings, monkeypatch) -> None:
    monkeypatch.setattr("bird_audio.audio.shutil.which", lambda name: "/usr/bin/ffmpeg")
    assert resolve_ffmpeg(audio_settings) == "/usr/bin/ffmpeg"


def test_resolve_ffmpeg_falls_back_to_imageio(audio_settings, monkeypatch, tmp_path) -> None:
    bundled = tmp_path / "ffmpeg-win.exe"
    bundled.write_bytes(b"binary")

    class FakeImageio:
        @staticmethod
        def get_ffmpeg_exe() -> str:
            return str(bundled)

    monkeypatch.setattr("bird_audio.audio.shutil.which", lambda name: None)
    monkeypatch.setitem(__import__("sys").modules, "imageio_ffmpeg", FakeImageio)
    assert resolve_ffmpeg(audio_settings) == str(bundled)


def test_resolve_ffmpeg_reports_unavailable_runtime(audio_settings, monkeypatch) -> None:
    monkeypatch.setattr("bird_audio.audio.shutil.which", lambda name: None)
    monkeypatch.setitem(__import__("sys").modules, "imageio_ffmpeg", None)
    with pytest.raises(ServiceError) as excinfo:
        resolve_ffmpeg(audio_settings)
    assert excinfo.value.code == "AUDIO_RUNTIME_UNAVAILABLE"


async def test_stager_streams_to_private_temp_file(audio_settings, tmp_path) -> None:
    stager = AudioStager(audio_settings, chunk_bytes=8)
    upload = FakeUpload(b"ID3\x04abcdefghijklmnop", filename="voice.mp3", content_type="audio/mpeg")
    staged = await stager.stage(upload)
    try:
        assert staged.path.exists()
        assert staged.path.parent == (tmp_path / "tmp-audio")
        assert staged.size_bytes == len(b"ID3\x04abcdefghijklmnop")
        assert staged.head.startswith(b"ID3")
        assert staged.content_type == "audio/mpeg"
    finally:
        stager.discard(staged)
    assert not staged.path.exists()


async def test_stager_rejects_oversized_upload_and_cleans_up(audio_settings) -> None:
    settings = audio_settings.model_copy(update={"max_audio_bytes": 16})
    stager = AudioStager(settings, chunk_bytes=8)
    upload = FakeUpload(b"x" * 64)
    with pytest.raises(ServiceError) as excinfo:
        await stager.stage(upload)
    assert excinfo.value.code == "AUDIO_TOO_LARGE"
    leftovers = list((settings.temp_dir or Path("/")).iterdir()) if settings.temp_dir else []
    assert all("bird-audio-" not in path.name for path in leftovers)


async def test_stager_accepts_upload_without_filename(audio_settings) -> None:
    stager = AudioStager(audio_settings)
    upload = FakeUpload(b"ID3\x04", filename=None, content_type=None)
    staged = await stager.stage(upload)
    try:
        assert staged.path.suffix == ".bin"
        assert staged.filename is None
        assert staged.content_type is None
    finally:
        stager.discard(staged)


def test_discard_accepts_none() -> None:
    AudioStager.discard(None)


def test_frame_energy() -> None:
    assert frame_energy([]) == 0.0
    assert frame_energy([0.5, -0.5]) == pytest.approx(0.5)
    assert frame_energy([0.0, 0.0]) == 0.0


def test_real_ffmpeg_decodes_generated_wav(audio_settings, wav_bytes, tmp_path) -> None:
    try:
        ffmpeg = resolve_ffmpeg(audio_settings)
    except ServiceError:  # pragma: no cover - only without any ffmpeg binary
        pytest.skip("ffmpeg is not available")
    decoder = AudioDecoder(audio_settings, ffmpeg=ffmpeg)
    path = tmp_path / "clip.wav"
    path.write_bytes(wav_bytes)
    staged = StagedAudio(
        path=path,
        size_bytes=len(wav_bytes),
        head=wav_bytes[:64],
        filename="clip.wav",
        content_type="audio/wav",
    )
    decoded = decoder.decode(staged)
    assert decoded.container == "wav"
    assert decoded.sample_rate == SAMPLE_RATE
    assert decoded.duration_seconds == pytest.approx(2.0, abs=0.05)
    assert decoded.source_sample_rate == 44_100
