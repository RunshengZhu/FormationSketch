import http.server, sys
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8124
root = sys.argv[2] if len(sys.argv) > 2 else '.'
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=root, **kw)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
