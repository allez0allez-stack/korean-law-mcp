"""Local attachment evidence inspection. No network or legal-effect determination."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

MAX_BYTES = 32 * 1024 * 1024
MAX_TEXT = 2_000_000
OLE = bytes.fromhex('d0cf11e0a1b11ae1')


def inspect_file(path):
    path = Path(path)
    result = {'filename': path.name, 'source_verified': False,
              'layout_verified': False, 'legal_effect_verified': False,
              'status': 'UNVERIFIED'}
    def fail(reason):
        return {**result, 'reason': reason}
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        return fail('missing file or byte limit exceeded')
    raw = path.read_bytes()
    if len(raw) > MAX_BYTES:
        return fail('byte limit exceeded')
    result.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    suffix = path.suffix.lower()
    if suffix == '.pdf' and raw.startswith(b'%PDF-'):
        command = ['pdftotext', '-layout', '-enc', 'UTF-8']
        result['format'] = 'PDF'
    elif suffix == '.hwp' and raw.startswith(OLE):
        # OLE is not sufficient to establish HWP identity. Let the HWP5 parser decide.
        command = ['hwp5txt']
        result['format'] = 'OLE_HWP_CANDIDATE'
    else:
        return fail('unsupported format or signature mismatch')
    if not shutil.which(command[0]):
        return fail('extractor unavailable: ' + command[0])
    try:
        with tempfile.TemporaryDirectory() as d:
            copy = Path(d) / ('input' + suffix)
            copy.write_bytes(raw)
            output = Path(d) / 'text.txt'
            args = command + [str(copy)] + (['-'] if suffix == '.pdf' else [])
            with output.open('wb') as stream:
                run = subprocess.run(args, stdout=stream, stderr=subprocess.DEVNULL,
                                     timeout=30, check=False)
            if run.returncode != 0 or output.stat().st_size > MAX_TEXT * 4:
                return fail('extractor error or output byte limit')
            content = output.read_text(encoding='utf-8', errors='strict')
    except (OSError, UnicodeError, subprocess.TimeoutExpired):
        return fail('extractor failed, invalid encoding or timeout')
    if not content.strip() or len(content) > MAX_TEXT:
        return fail('empty text or text limit; scanned pages need separate review')
    result.update(status='TEXT_EXTRACTED_LOCAL', text_chars=len(content),
                  text_sha256=hashlib.sha256(content.encode('utf-8')).hexdigest(),
                  text=content, extractor=command[0],
                  warning='Local extraction only; publisher/version, page completeness, tables and visual layout require separate review.')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    args = parser.parse_args()
    result = inspect_file(args.path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['status'] == 'TEXT_EXTRACTED_LOCAL' else 1)
