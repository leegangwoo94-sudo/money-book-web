// 로컬 확인용 초간단 정적 서버 (flutter에 포함된 dart로 실행)
// 사용: dart tools/serve.dart  →  http://127.0.0.1:8787
import 'dart:io';

const types = {
  'html': 'text/html; charset=utf-8',
  'js': 'text/javascript; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'png': 'image/png',
  'svg': 'image/svg+xml',
};

Future<void> main(List<String> args) async {
  final root = args.isNotEmpty ? args[0] : '.';
  final server = await HttpServer.bind('127.0.0.1', 8787);
  print('serving $root on http://127.0.0.1:8787');
  await for (final req in server) {
    final path = req.uri.path == '/' ? '/index.html' : req.uri.path;
    final file = File('$root$path');
    if (file.existsSync() && !path.contains('..')) {
      final ext = path.split('.').last;
      req.response.headers.set('content-type', types[ext] ?? 'application/octet-stream');
      await req.response.addStream(file.openRead());
    } else {
      req.response.statusCode = 404;
    }
    await req.response.close();
  }
}
