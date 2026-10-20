"""CPU-only contract tests: python -m unittest discover -s tests -p qwen_service_test.py."""
import concurrent.futures
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave
import sys
import types
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("qwen_service", Path(__file__).resolve().parents[1] / "tts/qwen_service.py")
qwen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qwen)
CONFIG = {"version": 1, "port": 8877, "token": "a" * 64, **{k: v for k, v in qwen.MANIFEST.items() if k != "mlxAudioVersion"}}


class FakeEngine:
    def __init__(self, config):
        self.calls = []

    def generate(self, text, language):
        self.calls.append((text, language))
        return b"\x00\x01" * 240


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.runtime = qwen.Runtime(CONFIG, engine_factory=FakeEngine)
        self.runtime.load_future.result(timeout=2)
        self.server = qwen.BoundedServer(("127.0.0.1", 0), self.runtime)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.runtime.close()
        self.thread.join()

    def request(self, path, value=None, token=CONFIG["token"]):
        headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
        req = urllib.request.Request(self.url + path, data=None if value is None else json.dumps(value).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def test_health_auth_and_no_secrets(self):
        status, _, _ = self.request("/health", token="wrong")
        self.assertEqual(status, 401)
        status, _, body = self.request("/health")
        value = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(value["state"], "ready")
        self.assertEqual(value["speakers"], qwen.SPEAKERS)
        self.assertNotIn("token", value)
        self.assertNotIn("modelPath", value)

    def test_synthesis_wav_and_override(self):
        status, headers, body = self.request("/synthesize", {"text": "한국어 日本語", "language": "ko"})
        self.assertEqual(status, 200)
        self.assertIn("no-store", headers["Cache-Control"])
        with wave.open(io.BytesIO(body), "rb") as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 24000))
        self.assertEqual(self.runtime.engine.calls, [("한국어 日本語", "ko")])

    def test_invalid_input_and_unauthorized_large_body(self):
        for value in [{"text": "안녕", "language": "ko", "instruct": "bad"}, {"text": "a" * 2001, "language": "ko"}, {"text": "안녕", "language": "en"}, {"text": "<|im_start|>", "language": "ko"}]:
            self.assertEqual(self.request("/synthesize", value)[0], 400)
        self.assertEqual(self.request("/synthesize", {"text": "a" * 20000, "language": "ko"}, token="bad")[0], 401)
        self.assertEqual(self.request("/synthesize", {"text": "a" * 20000, "language": "ko"})[0], 413)
        self.assertEqual(self.runtime.engine.calls, [])

    def test_timeout_holds_busy_lock_until_gpu_returns(self):
        gate = threading.Event()
        original = self.runtime.engine.generate
        def slow(text, language):
            gate.wait(2)
            return original(text, language)
        self.runtime.engine.generate = slow
        self.runtime.generation_timeout = 0.02
        try:
            self.assertEqual(self.request("/synthesize", {"text": "안녕", "language": "ko"})[0], 504)
            self.assertEqual(self.request("/synthesize", {"text": "안녕", "language": "ko"})[0], 429)
            self.assertTrue(self.runtime.lock.locked())
        finally:
            gate.set()

    def test_segmentation_is_bounded_and_auto_splits_scripts(self):
        self.assertEqual(qwen.segments("안녕하세요。こんにちは。", "auto"), [("ko", "안녕하세요。"), ("ja", "こんにちは。")])
        self.assertEqual(qwen.segments("漢字", "auto"), [("ja", "漢字")])
        chunks = qwen.segments("가" * 1000, "ko")
        self.assertEqual(len(chunks), 5)
        self.assertTrue(all(len(text) <= 200 for _, text in chunks))
        with self.assertRaises(qwen.ServiceError):
            qwen.segments("가あ" * 13, "auto")

    def test_audio_limit_has_no_partial_success(self):
        self.runtime.engine.generate = lambda *_: b"\0\0" * (qwen.MAX_SAMPLES + 1)
        self.assertEqual(self.request("/synthesize", {"text": "안녕", "language": "ko"})[0], 422)


class EngineContractTests(unittest.TestCase):
    def test_token_cap_is_rejected_before_audio_conversion(self):
        # Fake only the imported packages; run the real MlxEngine result guard.
        mlx = types.ModuleType("mlx")
        core = types.ModuleType("mlx.core")
        core.default_device = lambda: None
        core.default_stream = lambda _: None
        core.stream = lambda _: contextlib.nullcontext()
        mlx.core = core
        numpy = types.ModuleType("numpy")
        engine = qwen.MlxEngine.__new__(qwen.MlxEngine)
        seen = {}
        def generate(**kwargs):
            seen.update(kwargs)
            yield types.SimpleNamespace(sample_rate=24000, token_count=600)
        engine.model = types.SimpleNamespace(generate=generate)
        with patch.dict(sys.modules, {"mlx": mlx, "mlx.core": core, "numpy": numpy}):
            with self.assertRaises(qwen.ServiceError) as failure:
                engine.generate("안녕하세요", "ko")
        self.assertEqual(failure.exception.code, "generation_limit")
        self.assertEqual(seen["voice"], "Sohee")
        self.assertEqual(seen["lang_code"], "Korean")
        self.assertEqual(seen["max_tokens"], 600)
        self.assertEqual(seen["instruct"], qwen.INSTRUCTIONS["ko"])


if __name__ == "__main__":
    unittest.main()
