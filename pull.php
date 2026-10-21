<?php
// pull.php: Pull Latest for the timer folder (a real git checkout).
// POST only, with the pull key in the X-Deploy-Key header or a POST field "key".
// The key is never accepted in the URL. See deploy-gate.php for where it is read.
declare(strict_types=1);
require __DIR__ . '/deploy-gate.php';
header('Content-Type: text/plain; charset=utf-8');

timer_require_key('pull');

$dir = __DIR__;
if (!is_dir($dir . '/.git') || !function_exists('shell_exec')) {
    error_log('timer pull: not a git checkout, or shell_exec is disabled');
    timer_stop(500, 'Update failed, see server log.');
}
timer_throttle();

$cwd = escapeshellarg($dir);
$fetch = (string)shell_exec("cd $cwd && git fetch origin main 2>&1; echo \"rc=\$?\"");
if (!preg_match('/rc=0\s*$/', $fetch)) {
    error_log("timer pull: fetch failed: $fetch");
    timer_stop(500, 'Update failed, see server log.');
}
$problem = timer_tree_problem($dir, 'origin/main');
if ($problem !== '') {
    error_log("timer pull: refused: $problem");
    timer_stop(500, 'Update refused, see server log.');
}

$savedHt = is_file($dir . '/.htaccess') ? (string)@file_get_contents($dir . '/.htaccess') : null;
$reset = (string)shell_exec("cd $cwd && git reset --hard origin/main 2>&1; echo \"rc=\$?\"");
$note = timer_ensure_htaccess($dir, $savedHt);
if (!preg_match('/rc=0\s*$/', $reset)) {
    error_log("timer pull: reset failed: $reset");
    timer_stop(500, 'Update failed, see server log.');
}

$sha = trim((string)shell_exec("cd $cwd && git rev-parse --short HEAD 2>/dev/null"));
$msg = trim((string)shell_exec("cd $cwd && git log -1 --pretty=%s 2>/dev/null"));
if ($note !== '') echo "NOTE: $note\n";
echo "Updated. Now at " . $sha . "  " . $msg . "\n";
