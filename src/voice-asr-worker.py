#!/opt/homebrew/bin/python3.12
import json
import os
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def find_local_whisper_model():
    explicit = os.environ.get("VOICE_WHISPER_MODEL_DIR", "").strip()
    if explicit and Path(explicit).is_dir():
        return explicit

    hub_dir = Path.home() / ".cache" / "huggingface" / "hub"
    candidates = [
        "models--mlx-community--whisper-large-v3-turbo",
        "models--mlx-community--whisper-small-mlx",
        "models--mlx-community--whisper-medium-mlx",
        "models--mlx-community--whisper-tiny",
    ]
    for repo_dir_name in candidates:
        snapshots = hub_dir / repo_dir_name / "snapshots"
        if not snapshots.is_dir():
            continue
        for snap in sorted(snapshots.iterdir(), reverse=True):
            if snap.is_dir() and any(snap.iterdir()):
                return str(snap)
    return ""


def load_pcm16_float32(audio_path):
    import numpy as np

    path = Path(audio_path)
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wf:
                channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                rate = wf.getframerate()
                frames = wf.getnframes()
                if sampwidth == 2 and rate == 16000 and frames > 0:
                    raw = wf.readframes(frames)
                    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                    if channels > 1:
                        pcm = pcm.reshape(-1, channels).mean(axis=1)
                    return pcm
        except Exception:
            pass

    ffmpeg_bin = os.environ.get("FFMPEG_BIN", "/opt/homebrew/bin/ffmpeg")
    if not Path(ffmpeg_bin).exists():
        ffmpeg_bin = "ffmpeg"
    proc = subprocess.run(
        [ffmpeg_bin, "-v", "error", "-i", str(path), "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"],
        capture_output=True,
        check=False,
        timeout=15,
    )
    if proc.returncode != 0 or not proc.stdout:
        err = proc.stderr.decode("utf-8", errors="ignore").strip() or "ffmpeg decode failed"
        raise RuntimeError(err)
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def assess_audio_activity(audio_arr):
    import numpy as np

    if audio_arr.size < 1920:
        return False, 0.0, 0.0, 0.0

    peak = float(np.max(np.abs(audio_arr)))
    rms = float(np.sqrt(np.mean(audio_arr * audio_arr)))
    frame_len = 320  # 20ms at 16kHz
    usable = (audio_arr.size // frame_len) * frame_len
    if usable >= frame_len:
        frames = audio_arr[:usable].reshape(-1, frame_len)
        frame_rms = np.sqrt(np.mean(frames * frames, axis=1))
        max_frame_rms = float(np.max(frame_rms))
    else:
        frame_rms = None
        max_frame_rms = rms

    if peak < 0.007 or rms < 0.0020 or max_frame_rms < 0.006:
        return False, peak, rms, max_frame_rms

    if frame_rms is not None and audio_arr.size >= 4800:
        p25 = float(np.percentile(frame_rms, 25))
        voice_thr = max(0.006, min(0.016, p25 * 2.0))
        max_run = 0
        cur_run = 0
        for v in frame_rms:
            if float(v) >= voice_thr:
                cur_run += 1
                if cur_run > max_run:
                    max_run = cur_run
            else:
                cur_run = 0
        if max_run < 5:
            return False, peak, rms, max_frame_rms

    return True, peak, rms, max_frame_rms


HALLUCINATION_RE = re.compile(
    r"(请不吝点赞|点赞[\s，,、]*订阅|订阅[\s，,、]*转发|打赏支持|明镜与点点|优优独播剧场|字幕组|感谢收看|谢谢收看|amara\.org|subtitles\s+by)",
    re.IGNORECASE,
)
REPEAT_TOKEN_RE = re.compile(r"([\u4e00-\u9fffA-Za-z]{1,8})(?:[\s，,、]+\1){2,}")


def is_whisper_hallucination(text):
    clean = str(text or "").strip()
    if not clean:
        return False
    return bool(HALLUCINATION_RE.search(clean) or REPEAT_TOKEN_RE.search(clean))


def extract_valid_whisper_text(res, overlap_sec=0.0):
    if not isinstance(res, dict):
        return "", "", ""
    segments = res.get("segments")
    if isinstance(segments, list) and segments:
        kept = []
        during_kept = []
        after_kept = []
        has_overlap = float(overlap_sec or 0.0) > 0.05
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            seg_text = str(seg.get("text") or "").strip()
            if not seg_text:
                continue
            no_speech_prob = seg.get("no_speech_prob")
            avg_logprob = seg.get("avg_logprob")
            compression_ratio = seg.get("compression_ratio")
            if no_speech_prob is not None and float(no_speech_prob) >= 0.68:
                continue
            if no_speech_prob is not None and float(no_speech_prob) >= 0.50 and avg_logprob is not None and float(avg_logprob) < -0.85:
                continue
            if avg_logprob is not None and float(avg_logprob) < -1.35 and len(seg_text) <= 10:
                continue
            if compression_ratio is not None and float(compression_ratio) >= 2.3:
                continue
            if is_whisper_hallucination(seg_text):
                continue
            kept.append(seg_text)
            if has_overlap:
                seg_start = float(seg.get("start") or 0.0)
                seg_end = float(seg.get("end") or seg_start)
                seg_mid = (seg_start + seg_end) * 0.5
                if seg_mid <= float(overlap_sec):
                    during_kept.append(seg_text)
                else:
                    after_kept.append(seg_text)
        full_text = "".join(kept).strip()
        if is_whisper_hallucination(full_text):
            return "", "", ""
        during_text = "".join(during_kept).strip() if has_overlap else ""
        after_text = "".join(after_kept).strip() if has_overlap else full_text
        return full_text, during_text, after_text
    raw_text = str(res.get("text") or "").strip()
    if is_whisper_hallucination(raw_text):
        return "", "", ""
    if float(overlap_sec or 0.0) > 0.05:
        return raw_text, raw_text, ""
    return raw_text, "", raw_text


def filter_speech_with_silero(audio_arr, vad_model, get_speech_timestamps, overlap_samples=0):
    overlap_samples = max(0, min(int(overlap_samples or 0), int(audio_arr.size)))
    if vad_model is None or get_speech_timestamps is None:
        return True, audio_arr, round(overlap_samples / 16000.0, 3)
    import numpy as np
    import torch

    if audio_arr.size < 1600:
        return False, audio_arr[:0], 0.0

    try:
        tensor = torch.from_numpy(np.ascontiguousarray(audio_arr, dtype=np.float32))
        segments = get_speech_timestamps(
            tensor,
            vad_model,
            sampling_rate=16000,
            threshold=0.45,
            min_speech_duration_ms=160,
            min_silence_duration_ms=220,
            speech_pad_ms=160,
        )
    finally:
        try:
            vad_model.reset_states()
        except Exception:
            pass

    if not segments:
        return False, audio_arr[:0], 0.0

    chunks = []
    mapped_overlap_samples = 0
    for seg in segments:
        s = int(seg["start"])
        e = int(seg["end"])
        if e <= s:
            continue
        chunks.append(audio_arr[s:e])
        if overlap_samples > s:
            mapped_overlap_samples += min(e, overlap_samples) - s
    if not chunks:
        return False, audio_arr[:0], 0.0
    return True, np.concatenate(chunks), round(mapped_overlap_samples / 16000.0, 3)


def main():
    model_dir = find_local_whisper_model()
    if not model_dir:
        sys.stdout.write(json.dumps({"ready": False, "error": "no offline whisper snapshot found"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return

    try:
        import mlx.core as mx
        import mlx_whisper
        from mlx_whisper.tokenizer import get_tokenizer
        from mlx_whisper.transcribe import ModelHolder

        model_obj = ModelHolder.get_model(model_dir, mx.float16)
        get_tokenizer(
            model_obj.is_multilingual,
            num_languages=model_obj.num_languages,
            language="zh",
            task="transcribe",
        )
    except Exception as exc:
        sys.stdout.write(json.dumps({"ready": False, "error": f"mlx_whisper preload failed: {exc}"}, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return

    vad_model = None
    vad_get_timestamps = None
    try:
        from silero_vad import get_speech_timestamps, load_silero_vad

        vad_model = load_silero_vad()
        vad_get_timestamps = get_speech_timestamps
    except Exception:
        vad_model = None
        vad_get_timestamps = None

    sys.stdout.write(json.dumps({"ready": True, "modelDir": model_dir, "sileroVad": vad_model is not None}, ensure_ascii=False) + "\n")
    sys.stdout.flush()

    default_prompt = "普通话语音对话。"
    while True:
        raw_line = sys.stdin.readline()
        if not raw_line:
            break
        line = raw_line.strip()
        if not line:
            continue
        req_id = ""
        try:
            req = json.loads(line)
            req_id = str(req.get("id") or "")
            audio_path = str(req.get("audioPath") or "")
            language = str(req.get("language") or "zh").strip() or None
            prompt = str(req.get("prompt") or "").strip() or default_prompt
            overlap_ms = max(0, int(req.get("overlapMs") or 0))
            if not audio_path or not Path(audio_path).is_file():
                raise ValueError("audio file missing")

            t0 = time.monotonic()
            audio_arr = load_pcm16_float32(audio_path)
            has_speech, peak, rms, max_frame_rms = assess_audio_activity(audio_arr)
            silence_reason = ""
            during_text = ""
            after_text = ""
            if not has_speech:
                text = ""
                no_speech = True
                silence_reason = "acoustic_gate"
            else:
                has_voice, speech_arr, mapped_overlap_sec = filter_speech_with_silero(
                    audio_arr,
                    vad_model,
                    vad_get_timestamps,
                    overlap_samples=int(round(overlap_ms * 16.0)),
                )
                if not has_voice or speech_arr.size < 1600:
                    text = ""
                    no_speech = True
                    silence_reason = "silero_no_speech"
                else:
                    try:
                        res = mlx_whisper.transcribe(
                            speech_arr,
                            path_or_hf_repo=model_dir,
                            language=language,
                            temperature=(0.0, 0.2),
                            condition_on_previous_text=False,
                            initial_prompt=prompt,
                            no_speech_threshold=0.6,
                            compression_ratio_threshold=2.3,
                            logprob_threshold=-1.0,
                        )
                    except TypeError:
                        res = mlx_whisper.transcribe(
                            speech_arr,
                            path_or_hf_repo=model_dir,
                            language=language,
                            temperature=(0.0, 0.2),
                            condition_on_previous_text=False,
                            initial_prompt=prompt,
                        )
                    text, during_text, after_text = extract_valid_whisper_text(res, overlap_sec=mapped_overlap_sec)
                    no_speech = not bool(text)
                    if no_speech:
                        silence_reason = "whisper_filtered"
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            payload = {
                "id": req_id,
                "ok": True,
                "text": text,
                "duringPlaybackText": during_text,
                "afterPlaybackText": after_text,
                "noSpeech": no_speech,
                "peak": round(peak, 5),
                "rms": round(rms, 5),
                "maxFrameRms": round(max_frame_rms, 5),
                "engine": "mlx-whisper",
                "sileroVad": vad_model is not None,
                "durationMs": elapsed_ms,
            }
            if silence_reason:
                payload["silenceReason"] = silence_reason
            sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            sys.stdout.write(json.dumps({
                "id": req_id,
                "ok": False,
                "error": str(exc),
            }, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
