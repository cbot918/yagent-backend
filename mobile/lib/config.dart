import 'package:shared_preferences/shared_preferences.dart';

/// Where the yagent backend lives. The agent runs on a host (Node + LLM keys);
/// this app is only a client, so it needs that host's address. On a physical
/// phone that's the dev machine's LAN IP (both on the same Wi-Fi), e.g.
/// http://10.142.56.163:3001. Editable in-app and persisted across launches.
class AppConfig {
  static const _key = 'backendBaseUrl';
  static const defaultBaseUrl = 'http://10.142.56.163:3001';

  String baseUrl;
  AppConfig(this.baseUrl);

  static Future<AppConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    return AppConfig(prefs.getString(_key) ?? defaultBaseUrl);
  }

  Future<void> save(String url) async {
    baseUrl = url.trim().replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, baseUrl);
  }

  String get httpBase => baseUrl.replaceAll(RegExp(r'/+$'), '');

  /// Derive the WebSocket URL from the HTTP base (mirrors useAgentSocket.ts).
  String get wsUrl {
    final b = httpBase;
    final ws = b.startsWith('https') ? b.replaceFirst('https', 'wss') : b.replaceFirst('http', 'ws');
    return '$ws/ws';
  }
}
