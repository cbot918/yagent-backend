import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../models.dart';
import '../store.dart';
import '../widgets/tool_call_card.dart';

/// A single session: the live workflow timeline (turns → iterations → tool
/// calls/results) plus a chat composer that sends over the WebSocket.
class SessionScreen extends StatefulWidget {
  final AgentStore store;
  final String sessionKey;
  const SessionScreen({super.key, required this.store, required this.sessionKey});

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_onStoreChanged);
  }

  void _onStoreChanged() {
    // Keep the newest activity in view as events stream in.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(_scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      }
    });
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    widget.store.send(widget.sessionKey, text);
    _input.clear();
  }

  @override
  void dispose() {
    widget.store.removeListener(_onStoreChanged);
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.sessionKey)),
      body: Column(
        children: [
          Expanded(
            child: ListenableBuilder(
              listenable: widget.store,
              builder: (_, _) {
                final session = widget.store.sessions[widget.sessionKey];
                final turns = session?.turns ?? const <Turn>[];
                if (turns.isEmpty) {
                  return const Center(child: Text('Say something to start.'));
                }
                return ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(12),
                  itemCount: turns.length,
                  itemBuilder: (_, i) => _TurnView(turn: turns[i]),
                );
              },
            ),
          ),
          SafeArea(top: false, child: _composer()),
        ],
      ),
    );
  }

  Widget _composer() => Container(
        decoration: const BoxDecoration(
          color: Color(0xFF0E1626),
          border: Border(top: BorderSide(color: Colors.white12)),
        ),
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _input,
                minLines: 1,
                maxLines: 4,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: const InputDecoration(
                  hintText: 'Message…',
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
              ),
            ),
            IconButton(icon: const Icon(Icons.send), color: const Color(0xFF38BDF8), onPressed: _send),
          ],
        ),
      );
}

class _TurnView extends StatelessWidget {
  final Turn turn;
  const _TurnView({required this.turn});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // User message bubble (right-aligned).
        Align(
          alignment: Alignment.centerRight,
          child: Container(
            margin: const EdgeInsets.only(top: 10, bottom: 4, left: 48),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFF1D4ED8),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(turn.userText),
          ),
        ),
        // Each loop iteration: assistant text + tool steps.
        for (final it in turn.iterations) ...[
          if (it.content != null && it.content!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: MarkdownBody(data: it.content!),
            ),
          for (final step in it.tools) ToolCallCard(step: step),
        ],
        // Final reply.
        if (turn.finalText != null && turn.finalText!.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 4, bottom: 10, right: 48),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFF111A2E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: MarkdownBody(data: turn.finalText!),
          ),
        if (turn.running)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Row(children: [
              SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
              SizedBox(width: 8),
              Text('thinking…', style: TextStyle(color: Colors.white54)),
            ]),
          ),
      ],
    );
  }
}
