import pytest

from server.schemas import Task
from server.settings import Settings
from server.sglang_engine import SglangEngine


def make_engine(post_log=None, statuses=("queued", "in_progress", "completed")):
    settings = Settings(sglang_url="http://sgl:30010/", sglang_api_key="sk-x",
                        sglang_poll_seconds=0.0)
    engine = SglangEngine(settings)
    state = {"polls": 0}

    def fake_post(fields, files):
        if post_log is not None:
            post_log.append(("post", fields, dict(files)))
        return {"id": "vid-1", "status": "queued"}

    def fake_get_json(path):
        if path == "/models":
            return {"task_type": "T2V"}
        status = statuses[min(state["polls"], len(statuses) - 1)]
        state["polls"] += 1
        return {"id": "vid-1", "status": status, "total_time": 6.9}

    def fake_get_bytes(path):
        if post_log is not None:
            post_log.append(("get", path, None))
        return b"MP4BYTES"

    engine._post = fake_post
    engine._get_json = fake_get_json
    engine._get_bytes = fake_get_bytes
    return engine


def test_warmup_contacts_models_endpoint():
    assert make_engine().warmup() is None


def test_render_submit_poll_download(tmp_path):
    log = []
    engine = make_engine(post_log=log)
    result = engine.render(Task.t2v, "a cat", [], 345, 8, 42, 12.0, 3.0,
                           str(tmp_path / "out.mp4"))
    out = tmp_path / "out.mp4"
    assert out.read_bytes() == b"MP4BYTES"
    assert result.artifact_path == str(out)
    kinds = [entry[0] for entry in log]
    assert kinds == ["post", "get"]


def test_render_sends_prompt_and_image_files(tmp_path):
    log = []
    engine = make_engine(post_log=log)
    image = tmp_path / "in.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\nFAKE")
    engine.render(Task.i2v, "from this frame", [str(image)], 345, 8, 42,
                  12.0, 3.0, str(tmp_path / "o.mp4"))
    kind, fields, files = log[0]
    assert fields["prompt"] == "from this frame"
    assert fields["num_frames"] == "345"
    assert fields["num_inference_steps"] == "8"
    assert fields["seed"] == "42"
    assert list(files) == ["input_reference_0"]
    assert files["input_reference_0"][1] == b"\x89PNG\r\n\x1a\nFAKE"


def test_render_ref2v_refused(tmp_path):
    engine = make_engine()
    with pytest.raises(ValueError, match="ref2v"):
        engine.render(Task.ref2v, "p", ["a.png"], 345, 8, 42, 12.0, 3.0,
                      str(tmp_path / "o.mp4"))


def test_render_failed_status_raises(tmp_path):
    engine = make_engine(statuses=("queued", "failed"))
    with pytest.raises(RuntimeError, match="failed"):
        engine.render(Task.t2v, "p", [], 345, 8, 42, 12.0, 3.0,
                      str(tmp_path / "o.mp4"))
