<?php
// install.php: one-time installer for the Time Trial Timer (hand-upload path).
//
// 1. In IONOS File Manager, make a folder called "timer" in the web root of
//    13.duckandrabbit.co
// 2. Copy config.example.php from the repo to config.php in that folder (or to
//    timer-secrets.php two folders up) and set pull_key to a long random string
// 3. Upload this file and deploy-gate.php into the folder
// 4. Visit https://13.duckandrabbit.co/timer/install.php, type the pull key, click Install
// 5. Delete install.php when it says it is done
//
// It fails closed: with no config there is no key, so it refuses to run at all.
// The repo is public, so no GitHub token is needed here.

declare(strict_types=1);

$gate = __DIR__ . '/deploy-gate.php';
if (!is_file($gate)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Not allowed. Upload deploy-gate.php beside install.php first.");
}
require $gate;

// Pulls restore this tracked file, so it has to go inert on its own.
if (is_dir(__DIR__.'/.git') && timer_config_path() !== '') {
    http_response_code(410);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Already installed. Delete install.php.");
}
if ((string)(timer_config()['pull_key'] ?? '') === '') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Not allowed. Create config.php (copy config.example.php) with a pull_key first.");
}

const REPO_URL = 'https://github.com/strummer95/timer.git';

$dir  = __DIR__;
$log  = [];
$done = false;
$fail = null;

function run(string $cmd, array &$log): string {
    $out = (string) shell_exec($cmd . ' 2>&1');
    $log[] = "$ " . $cmd . "\n" . trim($out);
    return $out;
}

if (($_POST['go'] ?? '') === '1') {
    timer_require_key('install');
    $cwd = escapeshellarg($dir);

    if (!function_exists('shell_exec')) {
        $fail = 'shell_exec is disabled on this host, so git cannot run.';
    } else {
        $git = trim((string) shell_exec('which git 2>&1'));
        if ($git === '' || str_contains($git, 'no git')) {
            $fail = 'git was not found on this server.';
        }
    }

    if ($fail === null) {
        if (!is_dir($dir . '/.git')) {
            run("cd $cwd && git init -q", $log);
            run("cd $cwd && git remote add origin " . escapeshellarg(REPO_URL), $log);
        }
        run("cd $cwd && git fetch --depth 1 origin main", $log);
        run("cd $cwd && git checkout -f -B main origin/main", $log);
        run("cd $cwd && git branch --set-upstream-to=origin/main main", $log);

        if (!is_file($dir . '/index.html')) {
            error_log("timer install: checkout failed:\n" . implode("\n", $log));
            $fail = 'Install failed, see server log.';
        }
    }

    if ($fail === null) {
        timer_ensure_htaccess($dir);
    }

    if ($fail === null) {
        $done = true;
    }
}

$base = 'https://' . ($_SERVER['HTTP_HOST'] ?? '13.duckandrabbit.co')
      . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/timer/install.php'), '/');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Time Trial Timer</title>
<style>
body{background:#0e1116;color:#eef2f8;font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:28px 18px;line-height:1.5}
h1{font-size:1.3rem;margin:0 0 6px}
p{color:#9aa7b8}
a{color:#57a9ff}
button{background:#f2b544;color:#191307;border:0;border-radius:10px;padding:14px 20px;font-size:1.05rem;font-weight:600;cursor:pointer}
pre{background:#171c25;border:1px solid #2c3543;border-radius:10px;padding:12px;overflow:auto;font-size:.8rem;color:#c7d2e0;white-space:pre-wrap}
.ok{color:#39d98a}.bad{color:#ff6b5e}
code{background:#171c25;padding:2px 6px;border-radius:5px}
</style>
</head>
<body>
<h1>Time Trial Timer installer</h1>

<?php if ($done): ?>
  <p class="ok">Installed.</p>
  <p>The timer is live at <a href="<?= htmlspecialchars($base) ?>/"><?= htmlspecialchars($base) ?>/</a></p>
  <p>Updates: the Update from GitHub button on the timer page, with the pull key from
     your config file.</p>
  <p>Now delete <code>install.php</code> from this folder.</p>
<?php elseif ($fail !== null): ?>
  <p class="bad"><?= htmlspecialchars($fail) ?></p>
<?php else: ?>
  <p>This downloads the timer into this folder and sets up a one-click update link.</p>
  <form method="post"><input type="hidden" name="go" value="1">
    <p><label>Pull key <input type="password" name="key" autocomplete="off"></label></p>
    <button type="submit">Install</button></form>
<?php endif; ?>

</body>
</html>
