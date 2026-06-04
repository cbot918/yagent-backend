// View model mirroring web/src/types.ts. The backend streams an `AgentEvent`
// union (turn:start / llm:response / tool:call / tool:result / turn:end) over
// /ws; AgentStore.apply() reduces those events into this per-session shape —
// the same derivation the Vue store does. Events themselves are handled as
// decoded JSON maps in the store (faithful to the switch in src/agent.ts).

class ToolStep {
  final String name;
  final Map<String, dynamic> args;
  String? result; // null while the tool is still running
  ToolStep({required this.name, required this.args, this.result});
}

class Iteration {
  final int iteration;
  String? content; // assistant text emitted this loop iteration
  final List<ToolStep> tools = [];
  Iteration(this.iteration);
}

class Turn {
  final String userText;
  final List<Iteration> iterations = [];
  String? finalText;
  bool running;
  final int startedAt;
  Turn({required this.userText, required this.startedAt, this.running = true});
}

class SessionState {
  final String sessionKey;
  String channel;
  final List<Turn> turns = [];
  int lastActivity;
  SessionState(this.sessionKey, this.channel, this.lastActivity);
}
