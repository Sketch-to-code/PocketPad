# PocketPad v6 — Secure Vercel Edition

Android → Vercel HTTPS frontend → Supabase Realtime (encrypted messages) → Windows Python receiver → arrow keys.

**Privacy model:** Control payloads are AES-256-GCM encrypted in the browser using a fresh 256-bit random key created by the Windows receiver. The key appears only in the laptop's local pairing QR and the phone's URL fragment (which is immediately removed from the address bar). It is not sent to Supabase. Supabase can still observe connection metadata, message timing, and encrypted message sizes. Vercel hosts the frontend and may receive ordinary web access metadata. There is no claim of absolute privacy. Do not share the pairing QR. No analytics, trackers, or third-party JS libraries are included.

**Requirements:** Android Chrome, Windows 10/11, Python 3.10+, Node.js only if building locally, free Vercel and Supabase accounts, internet on both devices. No `.bat`, self-signed certificates, inbound router ports, USB debugging, or browser warning bypasses.

## 1. Set up Supabase

1. Create a free project at https://supabase.com/dashboard.
2. Open Project Settings → API (or API Keys). Copy the **Project URL** and **publishable/anon key**. **NEVER use the secret/service_role key.**
3. Ensure Realtime is enabled. This project uses ephemeral Realtime **broadcast** channels; no SQL tables, database policies, or storage buckets are needed. Supabase public Realtime channels must be allowed. Free plan limits apply.

## 2. Deploy the frontend to Vercel

1. Upload the **entire PocketPad-v6 folder** to a private GitHub repository (recommended) or import the folder via Vercel CLI. Do not commit `receiver/.env`.
2. Create a Vercel project from the repository. Framework preset: **Other**; root directory: repository root.
3. In Vercel project environment variables set `SUPABASE_URL` to `https://YOUR_PROJECT.supabase.co` and `SUPABASE_ANON_KEY` to your **public** anon/publishable key.
4. Deploy. Vercel runs `npm run build`, which generates `web/config.js`. Your public app URL will resemble `https://your-project.vercel.app`.
5. Open that HTTPS URL on Android to confirm it loads. It will say “No valid pairing QR detected” until paired; this is expected.

**Important:** Supabase's anon/publishable key is a public client key, not a secret. Protect your Supabase account credentials and never paste a service-role key into the app. Supabase can change key types; verify your project's Realtime websocket supports your chosen public key.

## 3. Configure Windows receiver

Open PowerShell in `PocketPad-v6/receiver` and run:

```powershell
py -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

Fill in the **same** Supabase URL and public anon key as Vercel, and your deployed HTTPS site:

```ini
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
POCKETPAD_WEB_URL=https://YOUR_PROJECT.vercel.app
```

Then start the receiver:

```powershell
py receiver.py
```

Open `http://localhost:8765` **on the Windows laptop only**. The local dashboard shows a QR code. It is bound to `127.0.0.1`, so other devices cannot open the dashboard. The QR encodes a temporary session and an encryption key; **do not share screenshots of it**.

Scan the QR with your Android camera. The phone opens the HTTPS Vercel website and connects to the encrypted Realtime channel. In PowerShell type `status` to check relay connection, then type **`arm`** to allow arrow-key output. Focus your game window. Type **`disarm`** to stop all key output immediately, or `quit` to exit.

## 4. Controls

- **Arrows:** compact keyboard-style arrows on the right.
- **Circle joystick:** drag the inner circle, release to stop.
- **Gyroscope:** select Gyroscope → Enable sensors → Calibrate neutral. The page shows beta/gamma readings and event count. Android Chrome supports sensor access in secure HTTPS contexts on compatible devices. On some devices the forward/back mapping may feel different depending on how the phone is held; recalibrate after changing orientation.
- **Three-finger Touch Zone:** place exactly three fingers on the zone; their average starting point becomes the baseline. Slide up/down/left/right. Lifting one finger stops input.
- **Reset to original settings:** restores sensitivity 14, dead zone 4, invert steering off.

## Security details and limitations

- **No inbound ports**: both phone and Windows make outbound TLS websocket connections to Supabase.
- **End-to-end control encryption**: AES-256-GCM with authenticated session ID, random 96-bit nonce per message, and strictly increasing sequence numbers; receiver rejects invalid/replayed payloads.
- **Limited keyboard access**: receiver accepts only `up`, `down`, `left`, `right`. It never executes shell commands or accepts arbitrary key names. Starts DISARMED; `disarm` releases all keys.
- **Watchdog**: receiver releases held keys if no authenticated update arrives for 850 ms; releases on relay disconnect.
- **Pairing isolation**: fresh random 128-bit session ID and 256-bit key on every receiver restart; key never sent in websocket payloads or HTTP requests to Vercel. Session persists until the receiver exits. If the QR leaks, restart receiver immediately to rotate it.
- **No tracking scripts**: no external JS or analytics, no accounts in the controller, no microphone/camera access from the site.
- **Local QR page**: ordinary HTTP is okay *only because it is bound to Windows loopback*; Android uses Vercel HTTPS.
- **Trust**: browser code is delivered by Vercel, and a compromised frontend deployment could access the key after the phone loads it. Keep your GitHub/Vercel/Supabase accounts protected with MFA and review changes before deploying.
- **Provider metadata**: Vercel and Supabase can see some connection metadata, so this is not a zero-metadata or zero-risk system.
- **No hard security audit** has been performed. It is not appropriate for handling sensitive credentials, payments, or high-security systems.
- **Compatibility**: some games, anti-cheat systems, or elevated-privilege apps may ignore simulated keyboard input. Avoid running the receiver as Administrator.
- **Supabase costs**: free tier subject to usage limits; review your billing settings.

## Troubleshooting

- **Gyro has no readings:** confirm phone URL starts `https://`; press Enable sensors; check Chrome sensor permissions; test with phone held still then tilted. Some Android browsers and devices do not provide orientation events.
- **Connected but game doesn't move:** type `arm` in receiver terminal, focus game window, and test with Notepad or another non-privileged app first. Receiver `status` should say phone connected.
- **Phone says Reconnecting:** verify both Vercel and receiver use the same Supabase project URL and public key; check Supabase Realtime settings and free-tier status.
- **QR opens site but no connection:** check browser developer console, CSP, and project API key. If a public publishable key fails websocket authorization, try the project's legacy anon key (never service_role).
- **Kaspersky alerts:** do not bypass antivirus protection. Inspect the Python source and installed dependencies, and stop using the app if the warning cannot be resolved safely.
- **Reset everything:** close the receiver, restart it for a fresh QR/key, scan again.

## Development verification

Syntax checks and archive integrity can be performed offline. Live Vercel/Supabase deployment and physical Android/Windows integration must be tested by the user after configuring their accounts.
