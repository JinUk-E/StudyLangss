"""Private loopback TTS worker. MLX imports occur only on its single model thread."""
import argparse
import concurrent.futures
import hmac
import io
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import threading
import time
import unicodedata
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

MANIFEST = json.loads(Path(__file__).with_name("manifest.json").read_text(encoding="utf-8"))
SPEAKERS = {"ko": "Sohee", "ja": "Ono_Anna"}
INSTRUCTIONS = {
    "ko": "차분하고 부드러운 목소리로, 배려심 있고 지적인 안내자처럼 말하세요. 발음은 명료하게, 속도는 여유롭게, 감정과 억양은 과장하지 마세요.",
    "ja": "落ち着いた優しい声で、知的で思いやりのある案内役として話してください。明瞭に、少しゆったりと、感情や抑揚は大げさにしないでください。",
}
MAX_TEXT, MAX_CHUNK, MAX_CHUNKS, MAX_TOKENS = 2000, 200, 24, 600
MAX_AUDIO_BYTES, MAX_SAMPLES = 16 * 1024 * 1024, 24000 * 180


class ServiceError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


def load_config(filename):
    path = Path(filename)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
        raise ValueError("Invalid service configuration")
    if os.name == "posix" and path.stat().st_mode & 0o077:
        raise ValueError("Service configuration must be mode 600")
    value = json.loads(path.read_text(encoding="utf-8"))
    expected = {k: v for k, v in MANIFEST.items() if k != "mlxAudioVersion"}
    if value.get("version") != 1 or value.get("port") != 8877 or any(value.get(k) != v for k, v in expected.items()):
        raise ValueError("Service configuration version mismatch")
    if not re.fullmatch(r"[a-f0-9]{64}", value.get("token", "")) or not Path(value.get("modelPath", "")).is_absolute():
        raise ValueError("Invalid service credentials/model path")
    return value


def segments(text, language):
    if language not in ("auto", "ko", "ja") or not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ServiceError("invalid_text")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in text) or "<|" in text or "|>" in text:
        raise ServiceError("invalid_text")
    text = unicodedata.normalize("NFC", text.strip())
    # Auto is a script heuristic. Han-only and Latin-only text default to Japanese;
    # the web UI also supplies an explicit override for ambiguous sentences.
    chunks, current, active = [], "", language if language != "auto" else None
    first = next(("ko" if "\uac00" <= c <= "\ud7af" or "\u1100" <= c <= "\u11ff" or "\u3130" <= c <= "\u318f" else "ja" for c in text if "\uac00" <= c <= "\ud7af" or "\u1100" <= c <= "\u11ff" or "\u3130" <= c <= "\u318f" or "\u3040" <= c <= "\u30ff"), "ja")
    active = active or first
    def flush():
        nonlocal current
        if current.strip():
            chunks.append((active, current.strip()))
        current = ""
    for char in text:
        detected = None
        if language == "auto":
            if "\uac00" <= char <= "\ud7af" or "\u1100" <= char <= "\u11ff" or "\u3130" <= char <= "\u318f":
                detected = "ko"
            elif "\u3040" <= char <= "\u30ff" or "\u4e00" <= char <= "\u9fff":
                detected = "ja"
        if detected and detected != active:
            flush()
            active = detected
        current += char
        if len(current) >= MAX_CHUNK or char in "。！？!?\n":
            flush()
    flush()
    if not chunks or len(chunks) > MAX_CHUNKS:
        raise ServiceError("too_many_segments")
    return chunks


class MlxEngine:
    def __init__(self, config):
        import importlib.metadata
        if importlib.metadata.version("mlx-audio") != MANIFEST["mlxAudioVersion"]:
            raise ValueError("mlx-audio version mismatch")
        # Both weights and tokenizer are local. A service restart never downloads code/models.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        from mlx_audio.tts.utils import load_model
        self.model = load_model(Path(config["modelPath"]))
        if self.model.sample_rate != 24000 or self.model.tokenizer is None or self.model.speech_tokenizer is None:
            raise ValueError("Model/tokenizer is incomplete")
        if not set(s.lower() for s in SPEAKERS.values()).issubset(set(s.lower() for s in self.model.get_supported_speakers())):
            raise ValueError("Model speakers mismatch")

    def generate(self, text, language):
        import mlx.core as mx
        import numpy as np
        # API verified against mlx-audio v0.6.0 qwen3_tts.py. One segment, no streaming.
        with mx.stream(mx.default_stream(mx.default_device())):
            results = self.model.generate(text=text, voice=SPEAKERS[language], lang_code={"ko": "Korean", "ja": "Japanese"}[language], instruct=INSTRUCTIONS[language], max_tokens=MAX_TOKENS, temperature=0.7, stream=False, verbose=False)
            result = next(results, None)
            if result is None or result.sample_rate != 24000 or result.token_count >= MAX_TOKENS:
                raise ServiceError("generation_limit", 422)
            # Do not accept an unexpected second result (would omit spoken content).
            if next(results, None) is not None:
                raise ServiceError("unexpected_segments", 502)
            mx.eval(result.audio)
            audio = np.asarray(result.audio)
            if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all() or audio.size > MAX_SAMPLES:
                raise ServiceError("invalid_audio", 502)
            return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


class Runtime:
    def __init__(self, config, engine_factory=MlxEngine, generation_timeout=120):
        self.config, self.engine_factory = config, engine_factory
        self.state, self.engine = "loading", None
        self.lock = threading.Lock()
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="stella-model")
        self.generation_timeout = generation_timeout
        self.load_future = self.executor.submit(self._load)

    def _load(self):
        try:
            self.engine = self.engine_factory(self.config)
            self.state = "ready"
        except Exception:
            self.state = "error"
            # Do not log paths, tokens, or source text from dependency exceptions.
            print("Qwen model initialization failed; inspect installation and run setup --refresh.", flush=True)

    def health(self):
        return {**{k: v for k, v in MANIFEST.items() if k != "mlxAudioVersion"}, "ready": self.state == "ready", "state": self.state, "languages": ["ko", "ja"], "speakers": SPEAKERS}

    def synthesize(self, value):
        if not isinstance(value, dict) or set(value) != {"text", "language"}:
            raise ServiceError("invalid_request")
        chunks = segments(value["text"], value["language"])
        if self.state != "ready":
            raise ServiceError("model_" + self.state, 503)
        if not self.lock.acquire(blocking=False):
            raise ServiceError("busy", 429)
        try:
            future = self.executor.submit(self._generate, chunks)
        except Exception:
            self.lock.release()
            raise
        future.add_done_callback(lambda _: self.lock.release())
        try:
            return future.result(timeout=self.generation_timeout)
        except concurrent.futures.TimeoutError:
            # MLX GPU calls cannot safely be force-killed in a thread. The lock stays
            # held until work returns; subsequent clients see busy, never overlap.
            raise ServiceError("generation_timeout", 504)

    def _generate(self, chunks):
        started, pieces, length = time.monotonic(), [], 0
        for language, text in chunks:
            if time.monotonic() - started >= self.generation_timeout:
                raise ServiceError("generation_timeout", 504)
            pcm = self.engine.generate(text, language)
            if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2:
                raise ServiceError("invalid_audio", 502)
            length += len(pcm)
            if length > MAX_AUDIO_BYTES - 44 or length // 2 > MAX_SAMPLES:
                raise ServiceError("audio_limit", 422)
            pieces.append(pcm)
        if time.monotonic() - started >= self.generation_timeout:
            raise ServiceError("generation_timeout", 504)
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b"".join(pieces))
        return output.getvalue()

    def close(self):
        self.executor.shutdown(wait=True, cancel_futures=True)


class BoundedServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 8

    def __init__(self, address, runtime):
        if address[0] != "127.0.0.1":
            raise ValueError("Loopback binding required")
        self.runtime, self.slots = runtime, threading.BoundedSemaphore(8)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "StellaTTS/1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)
        def expire():
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.read_deadline = threading.Timer(10, expire)
        self.read_deadline.daemon = True
        self.read_deadline.start()

    def finish(self):
        self.read_deadline.cancel()
        super().finish()

    def log_message(self, *_):
        pass  # Base logging includes arbitrary request paths and can leak source material.

    def _send(self, status, value, content_type="application/json"):
        self.read_deadline.cancel()
        self.close_connection = True
        payload = value if isinstance(value, bytes) else json.dumps(value).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("Connection", "close")
            if status == 429:
                self.send_header("Retry-After", "5")
            self.end_headers()
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass

    def _authorized(self):
        headers = self.headers.get_all("Authorization", [])
        return len(headers) == 1 and hmac.compare_digest(headers[0].encode("utf-8"), ("Bearer " + self.server.runtime.config["token"]).encode("ascii"))

    def do_GET(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if self.path != "/health":
            return self._send(404, {"error": "not_found"})
        self._send(200, self.server.runtime.health())

    def do_POST(self):
        if not self._authorized():
            return self._send(401, {"error": "unauthorized"})
        if self.path != "/synthesize":
            return self._send(404, {"error": "not_found"})
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit() or not 0 < int(lengths[0]) <= 16384:
            return self._send(413, {"error": "body_limit"})
        if self.headers.get_content_type() != "application/json":
            return self._send(415, {"error": "json_required"})
        try:
            raw = self.rfile.read(int(lengths[0]))
            self.read_deadline.cancel()
            if len(raw) != int(lengths[0]):
                raise ServiceError("incomplete_body")
            value = json.loads(raw)
            result = self.server.runtime.synthesize(value)
            self._send(200, result, "audio/wav")
        except ServiceError as error:
            self._send(error.status, {"error": error.code})
        except (ValueError, UnicodeError, socket.timeout):
            self._send(400, {"error": "invalid_json"})
        except Exception:
            self._send(502, {"error": "generation_failed"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    runtime = Runtime(load_config(args.config))
    try:
        with BoundedServer(("127.0.0.1", 8877), runtime) as server:
            server.serve_forever()
    finally:
        runtime.close()


if __name__ == "__main__":
    main()
