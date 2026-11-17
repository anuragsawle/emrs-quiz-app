#!/usr/bin/env python3
"""
EMRS Quiz Competition - One-Click Launcher
Starts the LAN server, detects IP address, and launches the Admin Console in browser.
"""

import sys
import os
import webbrowser
import threading
import time

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from server import start_server, get_local_ip

def open_browser():
    time.sleep(1.2)
    lan_ip = get_local_ip()
    admin_url = f"http://localhost:8888/admin"
    print(f"\n[Launcher] Opening Host Admin Console in browser: {admin_url}")
    try:
        webbrowser.open(admin_url)
    except Exception:
        pass

if __name__ == "__main__":
    port = 8888
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    # Launch browser in a background thread
    threading.Thread(target=open_browser, daemon=True).start()

    # Start the Tornado server
    start_server(port)
