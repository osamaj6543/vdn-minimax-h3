"""Minimal Prometheus text exposition — no client dependency.

Thread-safe counters, gauges and a simple summary. The gateway serves them at
/metrics; the worker shares the same registry (per-process, as Prometheus
wants when scraping one process).
"""
import threading
from typing import Dict


class Registry:
    def __init__(self):
        self._lock = threading.Lock()
        self._counters: Dict[str, float] = {}
        self._gauges: Dict[str, float] = {}
        self._help: Dict[str, str] = {}

    def _note(self, name: str, help_text: str):
        if name not in self._help:
            self._help[name] = help_text

    def inc(self, name: str, value: float = 1.0, help_text: str = ""):
        with self._lock:
            self._counters[name] = self._counters.get(name, 0.0) + value
            if help_text:
                self._note(name, help_text)

    def gauge(self, name: str, value: float, help_text: str = ""):
        with self._lock:
            self._gauges[name] = value
            if help_text:
                self._note(name, help_text)

    def observe(self, name: str, value: float, help_text: str = ""):
        """Cheap summary: _count/_sum buckets (no histogram machinery)."""
        self.inc(f"{name}_count", 1.0, help_text)
        self.inc(f"{name}_sum", value)

    def render(self) -> str:
        lines = []
        with self._lock:
            for name in sorted(set(self._counters) | set(self._gauges)):
                if name in self._help:
                    lines.append(f"# HELP {name} {self._help[name]}")
                    lines.append(f"# TYPE {name} {'gauge' if name in self._gauges else 'counter'}")
                value = self._gauges.get(name, self._counters.get(name, 0.0))
                lines.append(f"{name} {value}")
        return "\n".join(lines) + "\n"


REGISTRY = Registry()      # process-wide; the gateway serves it at /metrics
