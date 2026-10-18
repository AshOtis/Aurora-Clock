"""Build the Obsidian plugin into dist/ (main.js, manifest.json). No dependencies: python3 build.py"""
import pathlib, shutil
R = pathlib.Path(__file__).resolve().parent; out = R / 'dist'; out.mkdir(exist_ok=True)
shutil.copy(R / 'src' / 'main.js', out / 'main.js')
shutil.copy(R / 'manifest.json', out / 'manifest.json')
print('dist/ ready: main.js, manifest.json')
