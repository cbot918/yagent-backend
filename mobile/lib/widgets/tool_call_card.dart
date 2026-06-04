import 'dart:convert';
import 'package:flutter/material.dart';
import '../models.dart';

/// One tool step in the workflow timeline: name + args, with the result
/// revealed on tap. A spinner shows while the tool is still running.
class ToolCallCard extends StatelessWidget {
  final ToolStep step;
  const ToolCallCard({super.key, required this.step});

  @override
  Widget build(BuildContext context) {
    final running = step.result == null;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      color: const Color(0xFF111A2E),
      child: ExpansionTile(
        dense: true,
        leading: running
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
            : const Icon(Icons.build, size: 18, color: Color(0xFF38BDF8)),
        title: Text('🔧 ${step.name}', style: const TextStyle(fontFamily: 'monospace', fontSize: 13)),
        subtitle: step.args.isEmpty
            ? null
            : Text(_pretty(step.args), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: Colors.white54)),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        children: [
          if (step.args.isNotEmpty) _block('args', _pretty(step.args)),
          if (!running) _block('result', step.result!.isEmpty ? '(empty)' : step.result!),
        ],
      ),
    );
  }

  Widget _block(String label, String body) => Align(
        alignment: Alignment.centerLeft,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontSize: 11, color: Colors.white38)),
            const SizedBox(height: 2),
            Text(body, style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
            const SizedBox(height: 6),
          ],
        ),
      );

  static String _pretty(Map<String, dynamic> m) {
    try {
      return const JsonEncoder.withIndent('  ').convert(m);
    } catch (_) {
      return m.toString();
    }
  }
}
