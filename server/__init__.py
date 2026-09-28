"""VDN-H3 inference server (Phase 1).

Control plane (gateway) + GPU workers over a Redis-backed job queue. The
gateway never imports torch; the engine imports src.* lazily so this package
is importable and testable on any machine.
"""
__version__ = "0.1.0"
