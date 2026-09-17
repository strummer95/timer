<?php
// pull.php — Pull Latest for the timer folder. Key-protected.
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');

$cfgPath = __DIR__ . '/config.php';
if (!is_file($cfgPath)) { http_response_code(500); exit("config.php missing — re-run install.php\n"); }
$config = include $cfgPath;

$key = $_GET['key'] ?? ($_POST['key'] ?? '');
if (!is_string($key) || !hash_equals((string)($config['pull_key'] ?? ''), $key)) {
  http_response_code(401);
  exit("unauthorized\n");
}

if (!is_dir(__DIR__ . '/.git')) { http_response_code(500); exit("not a git repo — run install.php first\n"); }

$cwd = escapeshellarg(__DIR__);
$out = (string) shell_exec("cd $cwd && git fetch origin main 2>&1 && git reset --hard origin/main 2>&1");
$sha = trim((string) shell_exec("cd $cwd && git rev-parse --short HEAD 2>&1"));
$msg = trim((string) shell_exec("cd $cwd && git log -1 --pretty=%s 2>&1"));

echo $out . "\n\nnow at " . $sha . "  " . $msg . "\n";
