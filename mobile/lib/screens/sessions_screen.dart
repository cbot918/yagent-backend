import 'package:flutter/material.dart';
import '../store.dart';
import 'session_screen.dart';

/// Home screen: the list of sessions (sorted by recent activity), a live/offline
/// connection indicator, a settings entry to point at the backend, and a + to
/// start a new chat session.
class SessionsScreen extends StatelessWidget {
  final AgentStore store;
  const SessionsScreen({super.key, required this.store});

  void _open(BuildContext context, String sessionKey) {
    store.select(sessionKey);
    Navigator.push(context, MaterialPageRoute(builder: (_) => SessionScreen(store: store, sessionKey: sessionKey)));
  }

  Future<void> _newSession(BuildContext context) async {
    final controller = TextEditingController(text: 'mobile');
    final key = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New session'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Session key'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Open')),
        ],
      ),
    );
    if (key != null && key.isNotEmpty && context.mounted) _open(context, key);
  }

  Future<void> _editBackend(BuildContext context) async {
    final controller = TextEditingController(text: store.config.baseUrl);
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Backend URL'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'http://<host>:3001',
            helperText: "The dev machine's LAN IP, same Wi-Fi as the phone.",
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (url != null && url.isNotEmpty) {
      await store.config.save(url);
      store.reconnect();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('yagent'),
        actions: [
          ListenableBuilder(
            listenable: store,
            builder: (_, _) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Row(children: [
                Icon(Icons.circle, size: 11, color: store.connected ? Colors.greenAccent : Colors.redAccent),
                const SizedBox(width: 5),
                Text(store.connected ? 'live' : 'offline', style: const TextStyle(fontSize: 13)),
              ]),
            ),
          ),
          IconButton(icon: const Icon(Icons.settings), tooltip: 'Backend URL', onPressed: () => _editBackend(context)),
        ],
      ),
      body: ListenableBuilder(
        listenable: store,
        builder: (_, _) {
          final list = store.sessionList;
          if (list.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text(
                  'No sessions yet.\nTap + to start one, or send from any channel.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white54),
                ),
              ),
            );
          }
          return ListView.separated(
            itemCount: list.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
            itemBuilder: (_, i) {
              final s = list[i];
              final last = s.turns.isNotEmpty ? (s.turns.last.finalText ?? s.turns.last.userText) : '';
              return ListTile(
                title: Text(s.sessionKey),
                subtitle: last.isEmpty ? null : Text(last, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: Text(s.channel, style: const TextStyle(fontSize: 12, color: Colors.white38)),
                onTap: () => _open(context, s.sessionKey),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _newSession(context),
        child: const Icon(Icons.add),
      ),
    );
  }
}
