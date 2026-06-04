# yagent mobile — dev log

A Flutter **Android client** for yagent. The agent itself (Node + LLM keys + tool
loop) runs on a host; this app is a thin client that speaks the **same WS/REST
protocol as the Vue web UI** — no backend changes. Verified running on a physical
Pixel 6 against the backend on the dev Mac's LAN.

## What it does

- Connects to the backend WebSocket `/ws`, receives the `AgentEvent` stream, and
  rebuilds the per-session view model (turns → iterations → tool calls/results).
- Seeds the session list from `GET /api/sessions`.
- Sends chat messages as `{type:'send', sessionKey, text}` over the WS.
- Auto-reconnects (1.5s) like `web/src/composables/useAgentSocket.ts`.
- Backend URL is editable in-app (⚙️) and persisted; defaults to the dev Mac IP.

This mirrors `web/src/stores/agent.ts` — the `apply()` reducer is ported verbatim
into `lib/store.dart`.

## Project layout (`mobile/lib/`)

- `config.dart` — backend base URL (persisted via `shared_preferences`); derives
  the `ws(s)://…/ws` URL from the http base.
- `models.dart` — view model: `ToolStep` / `Iteration` / `Turn` / `SessionState`
  (mirror of `web/src/types.ts`).
- `store.dart` — `AgentStore extends ChangeNotifier`: owns the `web_socket_channel`
  connection + reconnect, REST seed, `send()`, and the `apply()` reducer.
- `screens/sessions_screen.dart` — session list, live/offline indicator, backend
  URL editor, **+** to start a session.
- `screens/session_screen.dart` — workflow timeline + chat composer.
- `widgets/tool_call_card.dart` — one tool step (name/args, result on tap, spinner
  while running).
- `main.dart` — app entry + dark theme.

Dependencies: `web_socket_channel`, `http`, `shared_preferences`, `flutter_markdown`.

## Toolchain setup (macOS / Apple Silicon, Homebrew)

Installed from scratch — nothing Android-related was present beforehand.

```bash
brew install --cask flutter            # Flutter 3.44.1 (bundles Dart)
brew install openjdk@17                # JDK 17 — see gotcha below
brew install --cask android-commandlinetools

export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export ANDROID_HOME=$ANDROID_SDK_ROOT

yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"

flutter config --android-sdk "$ANDROID_SDK_ROOT"
flutter config --jdk-dir "$JAVA_HOME"
yes | flutter doctor --android-licenses
flutter doctor          # expect Flutter ✓ and Android toolchain ✓
```

### Gotchas hit (and fixes)

- **JDK via `--cask temurin@17` failed**: it's a `.pkg` installer that needs
  interactive `sudo`, which a non-interactive shell can't supply. Use the
  **`openjdk@17` formula** instead (installs into the Homebrew prefix, no sudo).
- **Flutter wanted SDK 36, not 34**: `flutter doctor` flagged `Android SDK 34`;
  Flutter 3.44 requires platform **36**. Installed `platforms;android-36` +
  `build-tools;36.0.0`.
- **Xcode / CocoaPods `doctor` warnings are irrelevant** — Android-only build.
- **First `flutter build apk` is slow (~18 min cold)**: it bootstraps Gradle, the
  Android Gradle Plugin, and CMake 3.22.1 on first run. Subsequent builds are fast.

## Android networking (physical phone over LAN)

`android/app/src/main/AndroidManifest.xml`:
- `<uses-permission android:name="android.permission.INTERNET"/>` — required for
  **release** builds (Flutter only injects it for debug/profile).
- `android:usesCleartextTraffic="true"` on `<application>` — Android 9+ blocks
  plain `http://`/`ws://` without it, and the LAN backend is plain HTTP.

The phone reaches the Mac at `http://<Mac-LAN-IP>:3001` when both are on the same
Wi-Fi (Node's `server.listen(port)` already binds all interfaces). Default in
`config.dart` is `http://10.142.56.163:3001` — **update this to your Mac's IP**
(`ipconfig getifaddr en0`) or edit it in-app via ⚙️. Watch for Wi-Fi "AP/client
isolation"; a phone hotspot the Mac joins is a reliable fallback.

## Run on device

1. Phone: enable **Developer options** (tap Build number ×7) → **USB debugging**.
2. Plug in via USB, accept the **"Allow USB debugging"** RSA prompt. Switching the
   USB mode to **File transfer** reliably exposes the ADB interface (charging-only
   shows the device under `system_profiler` but not under `adb devices`).
3. Verify: `adb devices` → should list the serial as `device` (not `unauthorized`).
4. Start the backend with the web channel on: `ENABLE_WEB=true npm run dev`.
5. `flutter run -d <serial>` (hot reload) or `flutter build apk --release` to
   sideload a standalone APK.

### Gotcha: `flutter run` install race
The first `flutter run` failed with `ADB exited with exit code 1` /
`Error launching application on Pixel 6`, but a direct
`adb install -r build/app/outputs/flutter-apk/app-debug.apk` succeeded, and
launching with `adb shell monkey -p dev.yagent.yagent_mobile -c
android.intent.category.LAUNCHER 1` brought the app up. Transient — retry
`flutter run`, or install+launch manually.

App package id: `dev.yagent.yagent_mobile`.

## Status / next steps

- ✅ Builds clean (`flutter analyze` clean, debug APK built), runs on Pixel 6,
  connects live to the backend and streams the workflow.
- Not committed to git yet (pending).
- Non-goals so far: iOS (needs Xcode + signing), on-device agent, voice input on
  mobile (Web Speech is browser-only; a Flutter mic could reuse the server
  `/api/transcribe` path later). LAN cleartext is dev-only — a public deployment
  needs TLS (`wss`/`https`).
