import 'package:flutter/material.dart';
import 'config.dart';
import 'store.dart';
import 'screens/sessions_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final config = await AppConfig.load();
  final store = AgentStore(config)..start();
  runApp(YagentApp(store: store));
}

class YagentApp extends StatelessWidget {
  final AgentStore store;
  const YagentApp({super.key, required this.store});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'yagent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0B1120),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF38BDF8),
          brightness: Brightness.dark,
        ),
      ),
      home: SessionsScreen(store: store),
    );
  }
}
