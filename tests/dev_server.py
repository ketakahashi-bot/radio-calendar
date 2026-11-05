"""開発用のサーバー。ブラウザに古いファイルを使い回させないよう、キャッシュを無効にする。

使い方: python tests/dev_server.py [ポート]（radio-calendar フォルダで実行）
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
