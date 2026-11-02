from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest


class BusinessMetrics:
    def __init__(self) -> None:
        self.registry = CollectorRegistry()
        self.http_requests = Counter(
            "bird_business_http_requests_total",
            "HTTP requests by method, path template and status",
            ["method", "path", "status"],
            registry=self.registry,
        )
        self.http_latency = Histogram(
            "bird_business_http_request_duration_seconds",
            "HTTP request latency",
            ["method", "path"],
            registry=self.registry,
        )
        self.observations = Counter(
            "bird_business_observations_total",
            "Observation writes by outcome",
            ["outcome"],
            registry=self.registry,
        )
        self.stored = Gauge(
            "bird_business_observations_stored",
            "Observation rows currently stored",
            registry=self.registry,
        )

    def render(self) -> bytes:
        return generate_latest(self.registry)
