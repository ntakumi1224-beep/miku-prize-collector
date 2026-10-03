"""Package only public frontend assets from the current checkout for GitHub Pages."""
import argparse, json, re, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
files = ['index.html', 'styles.css', 'app.js', 'identify.js', 'config.js', 'products.json',
         'manifest.webmanifest', 'service-worker.js']
files += [str(p.relative_to(ROOT)) for p in sorted((ROOT / 'icons').glob('*.png'))]
manifest = json.loads((ROOT / 'manifest.webmanifest').read_text())
assert all(manifest[key] == './' for key in ['id', 'scope', 'start_url'])
for icon in manifest['icons']:
    assert icon['src'].removeprefix('./') in files
html = (ROOT / 'index.html').read_text()
for ref in re.findall(r'(?:src|href)="(\./[^"?#]+)"', html):
    assert ref.removeprefix('./') in files, ref
core = (ROOT / 'service-worker.js').read_text().split('const CORE = [', 1)[1].split('];', 1)[0]
for ref in re.findall(r"'(\./[^']*)'", core):
    assert ref == './' or ref.removeprefix('./') in files, ref
config = (ROOT / 'config.js').read_text()
assert "https://miku-prize-collector-identify.n-takumi1224.workers.dev/api/identify" in config
assert re.search(r"turnstileSiteKey: '[^']+'", config)
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for file in files:
        z.write(ROOT / file, file)
    z.writestr('.nojekyll', '')
print(f'Packaged {len(files)} public frontend files + .nojekyll: {args.output}')
