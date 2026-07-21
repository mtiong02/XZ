#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
model_root="$repo_root/local-models"
asr_dir="$model_root/sherpa-onnx-streaming-paraformer-bilingual-zh-en"
tts_dir="$model_root/kokoro-int8-multi-lang-v1_1"
kws_dir="$model_root/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01"

mkdir -p "$asr_dir" "$model_root"
mkdir -p "$kws_dir"

download() {
  url=$1
  output=$2
  if [ -s "$output" ]; then
    return
  fi
  curl --fail --location --retry 3 --retry-delay 2 --progress-bar "$url" --output "$output"
}

hf_root="https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en/resolve/main"
download "$hf_root/encoder.int8.onnx" "$asr_dir/encoder.int8.onnx"
download "$hf_root/decoder.int8.onnx" "$asr_dir/decoder.int8.onnx"
download "$hf_root/tokens.txt" "$asr_dir/tokens.txt"

if [ ! -s "$tts_dir/model.int8.onnx" ]; then
  tts_archive="$model_root/kokoro-int8-multi-lang-v1_1.tar.bz2"
  download "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2" "$tts_archive"
  tar -xjf "$tts_archive" -C "$model_root"
  rm "$tts_archive"
fi

kws_archive="$model_root/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2"
if [ ! -s "$kws_dir/encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx" ]; then
  download "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2" "$kws_archive"
  tar -xjf "$kws_archive" --strip-components=1 -C "$kws_dir"
  rm "$kws_archive"
fi
cat > "$kws_dir/keywords.txt" <<'EOF'
x iǎo zh ī x iǎo zh ī @小知小知
x iǎo zh í x iǎo zh í @小智小智
x iǎo z ī x iǎo @小资小
x iǎo zh ī x iǎo ch ǐ @小芝小尺
EOF

printf 'Local speech models are ready in %s\n' "$model_root"
