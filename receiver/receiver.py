"""PocketPad receiver: encrypted, allowlisted arrow-key events only."""
import base64
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, urlparse

import qrcode
import websocket
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from dotenv import load_dotenv
from pynput.keyboard import Controller, Key

load_dotenv(Path(__file__).with_name('.env'))
URL = os.getenv('SUPABASE_URL', '').rstrip('/')
ANON = os.getenv('SUPABASE_ANON_KEY', '')
WEB = os.getenv('POCKETPAD_WEB_URL', '').rstrip('/')
if not (URL.startswith('https://') and ANON and WEB.startswith('https://')):
    raise SystemExit('Configure SUPABASE_URL, SUPABASE_ANON_KEY and POCKETPAD_WEB_URL in receiver/.env (see README).')
if urlparse(WEB).username or urlparse(WEB).password:
    raise SystemExit('Invalid frontend URL')

keyboard = Controller()
KEYS = {'up': Key.up, 'down': Key.down, 'left': Key.left, 'right': Key.right}
pressed = set()
lock = threading.RLock()
state = {'connected': False, 'last': 0.0, 'seq': -1, 'armed': False, 'status': 'Waiting for phone'}
secret = secrets.token_bytes(32)
session = secrets.token_hex(16)
aes = AESGCM(secret)
start = time.monotonic()

def release():
    with lock:
        for k in list(pressed):
            try: keyboard.release(KEYS[k])
            except Exception: pass
        pressed.clear()

def apply(keys):
    with lock:
        if not state['armed']:
            release()
            return
        target = set(keys) & KEYS.keys()
        for k in pressed - target:
            keyboard.release(KEYS[k])
        for k in target - pressed:
            keyboard.press(KEYS[k])
        pressed.clear()
        pressed.update(target)

def handle_encrypted(payload):
    try:
        nonce = base64.urlsafe_b64decode(payload['n'] + '===')
        ciphertext = base64.urlsafe_b64decode(payload['c'] + '===')
        if len(nonce) != 12 or len(ciphertext) > 2048: return
        plain = json.loads(aes.decrypt(nonce, ciphertext, session.encode()))
        seq = plain['seq']
        if type(seq) is not int or seq <= state['seq']: return
        if type(plain.get('keys')) is not list or len(plain['keys']) > 4: return
        if any(type(k) is not str or k not in KEYS for k in plain['keys']): return
        with lock:
            state['seq'] = seq
            state['last'] = time.monotonic()
            state['connected'] = True
            state['status'] = 'Phone connected'
        apply(plain['keys'])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        pass
    except Exception:
        pass

def relay_loop():
    host = urlparse(URL).netloc
    endpoint = f'wss://{host}/realtime/v1/websocket?apikey={quote(ANON, safe="")}&vsn=1.0.0'
    topic = 'realtime:pocketpad-' + session
    while True:
        try:
            ws = websocket.create_connection(endpoint, timeout=10, origin=WEB)
            ws.settimeout(2)
            ws.send(json.dumps({'topic':topic,'event':'phx_join','payload':{'config':{'broadcast':{'ack':False,'self':False},'presence':{'key':''},'private':False}},'ref':'1'}))
            last_ping = time.monotonic()
            state['status'] = 'Connected to encrypted relay; waiting for phone'
            while True:
                try:
                    raw = ws.recv()
                    if not raw: raise ConnectionError('relay closed')
                    msg = json.loads(raw)
                    if msg.get('event') == 'broadcast':
                        p = msg.get('payload', {})
                        if p.get('event') == 'control':
                            handle_encrypted(p.get('payload', {}))
                    if msg.get('event') == 'phx_error':
                        raise ConnectionError('Relay channel error')
                except websocket.WebSocketTimeoutException:
                    pass
                if time.monotonic() - last_ping > 20:
                    ws.send(json.dumps({'topic':'phoenix','event':'heartbeat','payload':{},'ref':str(int(time.time()))}))
                    last_ping = time.monotonic()
        except Exception as exc:
            state['status'] = 'Relay disconnected; retrying (' + type(exc).__name__ + ')'
            state['connected'] = False
            release()
            time.sleep(3)

def watchdog():
    while True:
        time.sleep(.1)
        if time.monotonic() - state['last'] > .85:
            if state['connected']:
                state['connected'] = False
                state['status'] = 'Phone signal lost; keys released'
            release()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(b'''<!doctype html><html><meta name="viewport" content="width=device-width"><title>PocketPad Receiver</title><style>body{font:16px system-ui;background:#101827;color:#f4f7ff;text-align:center;padding:30px}img{background:white;padding:14px;border-radius:18px;max-width:75vw}code{color:#7dd3fc}</style><h1>PocketPad | Windows receiver</h1><p>Scan with Android. The QR contains a private pairing key: don't share screenshots.</p><img src="/qr" alt="Pairing QR"><p>Keep this page open on your laptop. Return to the terminal to arm or disarm keyboard control.</p><p>All control messages are end-to-end encrypted; only arrow keys are accepted.</p></html>''')
        elif path == '/qr':
            link = f'{WEB}/#session={session}&key={base64.urlsafe_b64encode(secret).decode().rstrip("=")}'
            img = qrcode.make(link)
            out = BytesIO()
            img.save(out, format='PNG')
            self.send_response(200)
            self.send_header('Content-Type','image/png')
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(out.getvalue())
        else:
            self.send_error(404)
    def log_message(self, *_):
        pass

def commands():
    print('\nSECURITY: Keyboard output starts DISARMED. Type arm to enable, disarm to stop, status, or quit.')
    while True:
        try: cmd = input('PocketPad> ').strip().lower()
        except (EOFError, KeyboardInterrupt): cmd = 'quit'
        if cmd == 'arm':
            state['armed'] = True
            print('ARMED: only 4 arrow keys may be pressed. Focus the game window.')
        elif cmd == 'disarm':
            state['armed'] = False
            release()
            print('DISARMED')
        elif cmd == 'status':
            print(state['status'], '| armed:', state['armed'], '| age:', round(time.monotonic()-start), 's')
        elif cmd in ('quit','exit'):
            release()
            os._exit(0)
        else:
            print('Commands: arm, disarm, status, quit')

if __name__ == '__main__':
    threading.Thread(target=relay_loop, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()
    httpd = ThreadingHTTPServer(('127.0.0.1',8765), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print('Laptop pairing page: http://localhost:8765')
    print('Local pairing page is accessible ONLY on this laptop.')
    try: commands()
    finally: release()
