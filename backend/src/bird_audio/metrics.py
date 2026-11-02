from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest


class AudioMetrics:
    def __init__(self) -> None:
        self.registry = CollectorRegistry()
        self.http_requests = Counter(
            "bird_audio_http_requests_total",
            "HTTP requests by method, path template and status",
            ["method", "path", "status"],
            registry=self.registry,
        )
        self.http_latency = Histogram(
            "bird_audio_http_request_duration_seconds",
            "HTTP request latency",
            ["method", "path"],
            registry=self.registry,
        )
        self.analyses = Counter(
            "bird_audio_analyses_total",
            "Finished analyses by state and rejection reason",
            ["state", "reason"],
            registry=self.registry,
        )
        self.rejections = Counter(
            "bird_audio_rejections_total",
            "Requests rejected before or during inference",
            ["code"],
            registry=self.registry,
        )
        self.analysis_latency = Histogram(
            "bird_audio_analysis_duration_seconds",
            "End-to-end analysis latency",
            registry=self.registry,
        )
        self.decode_latency = Histogram(
            "bird_audio_decode_duration_seconds",
            "Upload validation and ffmpeg decode latency",
            registry=self.registry,
        )
        self.inference_latency = Histogram(
            "bird_audio_window_inference_duration_seconds",
            "Single-window model inference latency",
            registry=self.registry,
        )
        self.windows = Counter(
            "bird_audio_windows_total",
            "Windows sent to the model",
            registry=self.registry,
        )
        self.in_flight = Gauge(
            "bird_audio_analyses_in_flight",
            "Admitted analyses that have not finished",
            registry=self.registry,
        )
        self.engine_ready = Gauge(
            "bird_audio_engine_ready",
            "1 when the audio model is loaded and serving",
            registry=self.registry,
        )

    def render(self) -> bytes:
        return generate_latest(self.registry)
