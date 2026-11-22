#!/usr/bin/env python3
"""
Lightweight HTTP server for the Neon MIDI Studio Web Application.
Serves static files and assigns proper MIME types for .mid / .midi files.
"""
import http.server
import socketserver
import os
import sys

PORT = 8080

class MidiHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and disable aggressive caching for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.mid') or path.endswith('.midi'):
            return 'audio/midi'
        return super().guess_type(path)

def main():
    port = PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", port), MidiHTTPRequestHandler) as httpd:
            print(f"Server started at http://localhost:{port}")
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()
    except OSError as e:
        # If port 8080 is in use, try 8081 or 8000
        alt_port = 8000 if port != 8000 else 8081
        print(f"Port {port} busy, trying {alt_port}...")
        with socketserver.TCPServer(("", alt_port), MidiHTTPRequestHandler) as httpd:
            print(f"Server started at http://localhost:{alt_port}")
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()

if __name__ == "__main__":
    main()
