"""Explicit opt-in download; no model weights are redistributed with the app."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

CHECKPOINT = "rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626"
URL = f"https://huggingface.co/Soykaf/RTMW3D-x/resolve/main/onnx/{CHECKPOINT}.onnx"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--acknowledge-unresolved-weight-rights", action="store_true")
    args = parser.parse_args()
    if not args.acknowledge_unresolved_weight_rights:
        parser.error("Read docs/RTMW3D_MODEL.md; explicitly acknowledge unresolved original weight/data rights")
    directory = Path(".movement-models")
    directory.mkdir(exist_ok=True)
    target = directory / f"{CHECKPOINT}.onnx"
    if not target.exists():
        partial = target.with_suffix(".download")
        urllib.request.urlretrieve(URL, partial)
        partial.replace(target)
    with target.open("rb") as weights:
        digest = hashlib.file_digest(weights, "sha256").hexdigest()
    provenance = dict(checkpoint=CHECKPOINT, url=URL, sha256=digest,
                      conversion="Soykaf ONNX; referenced by RTMLib", cardLicense="apache-2.0",
                      originalWeightRights="unresolved", acknowledgement=True)
    target.with_suffix(".provenance.json").write_text(json.dumps(provenance, indent=2))
    print(json.dumps(provenance))


if __name__ == "__main__":
    main()
