from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest


class Metrics:
    def __init__(self) -> None:
        self.registry = CollectorRegistry()
        self.http_requests = Counter(
            "bird_vision_http_requests_total",
            "HTTP requests by method, path template and status",
            ["method", "path", "status"],
            registry=self.registry,
        )
        self.http_latency = Histogram(
            "bird_vision_http_request_duration_seconds",
            "HTTP request latency",
            ["method", "path"],
            registry=self.registry,
        )
        self.frames = Counter(
            "bird_vision_frames_total",
            "Frame lifecycle events",
            ["outcome"],
            registry=self.registry,
        )
        self.species_results = Counter(
            "bird_vision_species_results_total",
            "Per-track species result states",
            ["state"],
            registry=self.registry,
        )
        self.inference_latency = Histogram(
            "bird_vision_inference_duration_seconds",
            "End-to-end inference latency after dequeue",
            registry=self.registry,
        )
        self.decode_latency = Histogram(
            "bird_vision_image_decode_duration_seconds",
            "Image validation and decode latency",
            registry=self.registry,
        )
        self.active_sessions = Gauge(
            "bird_vision_active_sessions",
            "Current active realtime sessions",
            registry=self.registry,
        )
        self.buffered_image_bytes = Gauge(
            "bird_vision_buffered_image_bytes",
            "Reserved upload/decode bytes plus Pillow image bytes queued or being processed",
            registry=self.registry,
        )
        self.websocket_subscribers = Gauge(
            "bird_vision_websocket_subscribers",
            "Current WebSocket event subscribers",
            registry=self.registry,
        )
        self.saved_crop_bytes = Gauge(
            "bird_vision_saved_crop_bytes",
            "Bytes reserved by per-track best-crop buffers",
            registry=self.registry,
        )

    def render(self) -> bytes:
        return generate_latest(self.registry)
