<?php
// install.php — one-time installer for the Time Trial Timer.
//
// 1. In IONOS File Manager, make a folder called "timer" in the web root of
//    13.duckandrabbit.co
// 2. Upload this file into it
// 3. Visit https://13.duckandrabbit.co/timer/install.php and click Install
// 4. Delete install.php when it says it is done
//
// The repo is public, so no GitHub token is needed here.

declare(strict_types=1);

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
            $fail = 'The clone finished but index.html is missing. Check the log below.';
        }
    }

    // Deploy key for pull.php, kept out of git.
    if ($fail === null && !is_file($dir . '/config.php')) {
        $key = bin2hex(random_bytes(12));
        $php = "<?php\nreturn ['pull_key' => '" . $key . "'];\n";
        if (file_put_contents($dir . '/config.php', $php) === false) {
            $fail = 'Could not write config.php. Check folder permissions.';
        }
    }

    if ($fail === null) {
        $done = true;
    }
}

$key = '';
if (is_file($dir . '/config.php')) {
    $cfg = include $dir . '/config.php';
    $key = $cfg['pull_key'] ?? '';
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
  <p>Bookmark this to pull future updates:<br>
     <code><?= htmlspecialchars($base) ?>/pull.php?key=<?= htmlspecialchars($key) ?></code></p>
  <p>Now delete <code>install.php</code> from this folder.</p>
<?php elseif ($fail !== null): ?>
  <p class="bad"><?= htmlspecialchars($fail) ?></p>
<?php else: ?>
  <p>This downloads the timer into this folder and sets up a one-click update link.</p>
  <form method="post"><input type="hidden" name="go" value="1"><button type="submit">Install</button></form>
<?php endif; ?>

<?php if ($log): ?>
  <pre><?= htmlspecialchars(implode("\n\n", $log)) ?></pre>
<?php endif; ?>
</body>
</html>
