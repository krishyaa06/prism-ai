#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REPOSITORY="ggml-org/SmolVLM-500M-Instruct-GGUF"
MODEL_FILE="SmolVLM-500M-Instruct-Q8_0.gguf"
MODEL_SHA256="9d4612de6a42214499e301494a3ecc2be0abdd9de44e663bda63f1152fad1bf4"
PROJECTOR_FILE="mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
PROJECTOR_SHA256="d1eb8b6b23979205fdf63703ed10f788131a3f812c7b1f72e0119d5d81295150"

if ! command -v sha256sum >/dev/null 2>&1; then
    echo "sha256sum is required to verify downloaded model files." >&2
    exit 1
fi

download_verified() {
    local file="$1"
    local checksum="$2"
    local url="https://huggingface.co/${REPOSITORY}/resolve/main/${file}?download=true"
    local partial="${file}.partial"

    if [[ -f "$file" ]]; then
        if echo "${checksum}  ${file}" | sha256sum --check --status; then
            echo "Already downloaded and verified: ${file}"
            return
        fi
        echo "Existing file failed SHA-256 verification; downloading a fresh copy." >&2
    fi

    rm -f -- "$partial"
    echo "Downloading ${file} (large file; this may take a while)..."
    if command -v curl >/dev/null 2>&1; then
        curl --fail --location --retry 3 --output "$partial" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget --show-progress --output-document="$partial" "$url"
    else
        echo "Install curl or wget to download the model." >&2
        exit 1
    fi

    if ! echo "${checksum}  ${partial}" | sha256sum --check --status; then
        rm -f -- "$partial"
        echo "SHA-256 verification failed for ${file}." >&2
        exit 1
    fi

    mv -- "$partial" "$file"
    echo "Verified: ${file}"
}

echo "Phone Agent AI local vision model setup"
echo "Model license: Apache-2.0 (review upstream terms before use)"
echo "Expected downloads: about 437 MB for the model and 109 MB for its projector."
download_verified "$MODEL_FILE" "$MODEL_SHA256"
download_verified "$PROJECTOR_FILE" "$PROJECTOR_SHA256"

echo
echo "Copy both GGUF files to your phone, then choose them in the app."
