"""Build The Particle Simulation as a claude.ai artifact.

An artifact page is published without its own <html>, <head> and <body>: the
viewer wraps it in its own. So the page is the body of index.html, with the
title, the theme script and the stylesheets moved to the top, and every file
it uses is published next to it. Font Awesome's font is embedded in its
stylesheet, and AngularJS runs in its CSP mode because artifacts do not allow
eval.

Usage: python3 tools/build_artifact.py [out_dir]       (default: dist/artifact)
Publish out_dir/index.html with root=out_dir and the files in out_dir/files.json.
out_dir/preview.html is the page as the viewer would show it, with a strict
content security policy, for testing locally.
"""
import base64, json, os, re, shutil, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SCRIPTS = re.compile(r'<script src="([^"]+)"></script>')
STYLESHEETS = re.compile(r'<link rel="stylesheet" href="([^"]+)">')

# The policy of the artifact viewer, as far as the page is concerned.
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com "
       "https://cdn.jsdelivr.net https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'")


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def page():
    html = read('index.html')
    head = html[html.index('<head>'):html.index('</head>')]
    body = html[html.index('<body>') + len('<body>'):html.index('</body>')]
    title = re.search(r'<title>.*?</title>', head).group(0)
    theme = re.search(r'<script>\s*// Apply the theme.*?</script>', head, re.S).group(0)
    links = '\n'.join('<link rel="stylesheet" href="%s">' % href for href in STYLESHEETS.findall(head))
    # Under the artifact's content security policy AngularJS must not try eval.
    body = body.replace('<nav class="navbar', '<nav ng-csp class="navbar', 1)
    return '\n'.join([title, theme, links, body.strip(), '']), STYLESHEETS.findall(head), SCRIPTS.findall(body)


def font_awesome():
    """Font Awesome's stylesheet with its font embedded as a data URI."""
    css = read('css/font-awesome.min.css')
    woff = base64.b64encode(open(os.path.join(ROOT, 'fonts/fontawesome-webfont.woff'), 'rb').read()).decode()
    face = ("@font-face{font-family:'FontAwesome';src:url(data:font/woff;base64,%s) format('woff');"
            "font-weight:normal;font-style:normal}" % woff)
    css, n = re.subn(r"@font-face\{font-family:'FontAwesome';[^}]*\}", lambda m: face, css)
    assert n == 1, 'Font Awesome @font-face not found'
    return css


def files_used(stylesheets, scripts):
    paths = list(stylesheets) + list(scripts)
    for folder in ('json', 'html'):
        paths += [folder + '/' + f for f in sorted(os.listdir(os.path.join(ROOT, folder)))]
    for folder in ('assets/icons/png', 'assets/info'):
        paths += [folder + '/' + f for f in sorted(os.listdir(os.path.join(ROOT, folder))) if f.endswith('.png')]
    paths += ['assets/pc32.png', 'assets/pc32@2x.png', 'assets/pc32sw.png', 'assets/pc32sw@2x.png']
    return paths


def main(out):
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    fragment, stylesheets, scripts = page()
    published = files_used(stylesheets, scripts)
    for path in published:
        os.makedirs(os.path.dirname(os.path.join(out, path)), exist_ok=True)
        shutil.copyfile(os.path.join(ROOT, path), os.path.join(out, path))
    with open(os.path.join(out, 'css/font-awesome.min.css'), 'w', encoding='utf-8') as f:
        f.write(font_awesome())
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(fragment)
    with open(os.path.join(out, 'files.json'), 'w') as f:
        json.dump(published, f, indent=1)
    # The page the way the viewer wraps it, for local testing.
    preview = ('<!doctype html>\n<html><head><meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
               '<meta http-equiv="Content-Security-Policy" content="%s">\n'
               '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}'
               'body{margin:0;font:14px system-ui,sans-serif;background:#fafaf9}img{max-width:100%%}'
               '[hidden]{display:none!important}</style>\n</head><body>\n%s</body></html>\n') % (CSP, fragment)
    with open(os.path.join(out, 'preview.html'), 'w', encoding='utf-8') as f:
        f.write(preview)
    size = sum(os.path.getsize(os.path.join(out, p)) for p in published + ['index.html'])
    print('%s: index.html and %d files, %.1f MB' % (out, len(published), size / 1e6))


if __name__ == '__main__':
    main(os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist/artifact')))
