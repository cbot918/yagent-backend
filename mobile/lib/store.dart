import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'config.dart';
import 'models.dart';

/// Client-side mirror of web/src/stores/agent.ts: owns the WebSocket to the
/// backend, feeds incoming AgentEvents through apply(), seeds the session list
/// over REST, and sends chat messages. Auto-reconnects, like useAgentSocket.ts.
class AgentStore extends ChangeNotifier {
  final AppConfig config;
  AgentStore(this.config);

  final Map<String, SessionState> sessions = {};
  String? selected;
  bool connected = false;

  WebSocketChannel? _ws;
  Timer? _reconnect;
  bool _disposed = false;

  List<SessionState> get sessionList {
    final list = sessions.values.toList();
    list.sort((a, b) => b.lastActivity.compareTo(a.lastActivity));
    return list;
  }

  SessionState? get current => selected == null ? null : sessions[selected];

  void start() {
    seed();
    _connect();
  }

  /// Seed pre-existing sessions from REST so they show up before any event.
  Future<void> seed() async {
    try {
      final res = await http.get(Uri.parse('${config.httpBase}/api/sessions'));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      for (final key in (data['sessions'] as List).cast<String>()) {
        sessions.putIfAbsent(key, () => SessionState(key, 'unknown', 0));
      }
      notifyListeners();
    } catch (_) {
      /* backend not up yet — events will populate sessions anyway */
    }
  }

  void _connect() {
    if (_disposed) return;
    try {
      final ws = WebSocketChannel.connect(Uri.parse(config.wsUrl));
      _ws = ws;
      ws.ready.then((_) {
        connected = true;
        notifyListeners();
      }).catchError((_) {/* onError below handles reconnect */});
      ws.stream.listen(
        (raw) {
          try {
            apply(jsonDecode(raw as String) as Map<String, dynamic>);
          } catch (_) {/* ignore malformed frames */}
        },
        onDone: _onClose,
        onError: (_) => _onClose(),
        cancelOnError: true,
      );
    } catch (_) {
      _onClose();
    }
  }

  void _onClose() {
    connected = false;
    _ws = null;
    notifyListeners();
    if (!_disposed) {
      _reconnect?.cancel();
      _reconnect = Timer(const Duration(milliseconds: 1500), _connect);
    }
  }

  /// Drop the current connection and reconnect (after the backend URL changes).
  void reconnect() {
    _reconnect?.cancel();
    _ws?.sink.close();
    _ws = null;
    connected = false;
    notifyListeners();
    seed();
    _connect();
  }

  void send(String sessionKey, String text) {
    final ws = _ws;
    if (ws != null && connected) {
      ws.sink.add(jsonEncode({'type': 'send', 'sessionKey': sessionKey, 'text': text}));
    }
  }

  void select(String sessionKey) {
    selected = sessionKey;
    sessions.putIfAbsent(sessionKey, () => SessionState(sessionKey, 'unknown', DateTime.now().millisecondsSinceEpoch));
    notifyListeners();
  }

  Iteration _ensureIteration(Turn turn, int iteration) {
    for (final it in turn.iterations) {
      if (it.iteration == iteration) return it;
    }
    final it = Iteration(iteration);
    turn.iterations.add(it);
    return it;
  }

  /// Reduce one live event into the per-session view model (ports apply()).
  void apply(Map<String, dynamic> ev) {
    final sessionKey = ev['sessionKey'] as String;
    final channel = ev['channel'] as String? ?? 'unknown';
    final s = sessions.putIfAbsent(sessionKey, () => SessionState(sessionKey, channel, 0));
    s.channel = channel;
    s.lastActivity = (ev['ts'] as num?)?.toInt() ?? s.lastActivity;

    switch (ev['type']) {
      case 'turn:start':
        s.turns.add(Turn(userText: ev['text'] as String? ?? '', startedAt: s.lastActivity));
        break;
      case 'llm:response':
        {
          if (s.turns.isEmpty) break;
          final it = _ensureIteration(s.turns.last, (ev['iteration'] as num).toInt());
          if (ev['content'] != null) it.content = ev['content'] as String;
          for (final tc in (ev['toolCalls'] as List? ?? const [])) {
            final m = tc as Map<String, dynamic>;
            final name = m['name'] as String;
            if (!it.tools.any((t) => t.name == name && t.result == null)) {
              it.tools.add(ToolStep(name: name, args: _asMap(m['args'])));
            }
          }
          break;
        }
      case 'tool:call':
        {
          if (s.turns.isEmpty) break;
          final it = _ensureIteration(s.turns.last, (ev['iteration'] as num).toInt());
          final name = ev['name'] as String;
          if (!it.tools.any((t) => t.name == name && t.result == null)) {
            it.tools.add(ToolStep(name: name, args: _asMap(ev['args'])));
          }
          break;
        }
      case 'tool:result':
        {
          if (s.turns.isEmpty) break;
          final it = _ensureIteration(s.turns.last, (ev['iteration'] as num).toInt());
          final name = ev['name'] as String;
          final result = ev['result'] as String? ?? '';
          ToolStep? pending;
          for (final t in it.tools.reversed) {
            if (t.name == name && t.result == null) {
              pending = t;
              break;
            }
          }
          if (pending != null) {
            pending.result = result;
          } else {
            it.tools.add(ToolStep(name: name, args: {}, result: result));
          }
          break;
        }
      case 'turn:end':
        if (s.turns.isNotEmpty) {
          s.turns.last
            ..finalText = ev['finalText'] as String?
            ..running = false;
        }
        break;
    }

    selected ??= sessionKey;
    notifyListeners();
  }

  static Map<String, dynamic> _asMap(dynamic v) =>
      v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};

  @override
  void dispose() {
    _disposed = true;
    _reconnect?.cancel();
    _ws?.sink.close();
    super.dispose();
  }
}
