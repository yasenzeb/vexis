import os
from PIL import Image

logo_path = 'logo.jpeg'
if os.path.exists(logo_path):
    img = Image.open(logo_path).convert('RGBA')
    img.save('favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    img.resize((96, 96)).save('favicon-96x96.png', 'PNG')
    img.resize((180, 180)).save('apple-touch-icon.png', 'PNG')
    img.resize((192, 192)).save('web-app-manifest-192x192.png', 'PNG')
    img.resize((512, 512)).save('web-app-manifest-512x512.png', 'PNG')

    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="black" rx="20"/>
  <text x="50" y="60" font-family="Cairo, sans-serif" font-weight="900" font-size="40" fill="white" text-anchor="middle">VX</text>
</svg>"""

    with open('favicon.svg', 'w', encoding='utf-8') as f:
        f.write(svg_content)

    print('Favicons generated.')
