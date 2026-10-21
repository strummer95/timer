<?php
declare(strict_types=1);
// deploy-gate.php: shared helpers for pull.php and install.php. Not a page.
//
// - Secrets come from ONE server-only file that returns an array. The first one
//   found is used: ../../timer-secrets.php (outside the web root, preferred),
//   then config.php in this folder. Copy config.example.php to make either.
// - Keys arrive in the X-Deploy-Key header or a POST field "key", never the URL.
// - hash_equals, and an empty configured key always refuses.
// - Five failures from one IP in 15 minutes answer 429 for 15 minutes.
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');

function timer_config_path(): string {
    foreach ([dirname(__DIR__, 2) . '/timer-secrets.php', __DIR__ . '/config.php'] as $p) {
        if (@is_file($p) && @is_readable($p)) return $p;
    }
    return '';
}

function timer_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $p = timer_config_path();
    $c = $p !== '' ? include $p : [];
    $cfg = is_array($c) ? $c : [];
    $env = getenv('TIMER_PULL_KEY');
    if (empty($cfg['pull_key']) && is_string($env) && $env !== '') $cfg['pull_key'] = $env;
    return $cfg;
}

function timer_state_dir(): string {
    $d = rtrim(sys_get_temp_dir(), '/\\') . '/timer-gate-' . substr(hash('sha256', __DIR__), 0, 12);
    if (!is_dir($d)) @mkdir($d, 0700, true);
    return $d;
}

function timer_fail_file(string $scope): string {
    return timer_state_dir() . '/fail-' . $scope . '-' . hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown')) . '.json';
}

function timer_failures(string $scope): array {
    $raw = @file_get_contents(timer_fail_file($scope));
    $list = is_string($raw) ? json_decode($raw, true) : [];
    if (!is_array($list)) $list = [];
    $cut = time() - 900;
    return array_values(array_filter($list, function ($t) use ($cut) { return is_int($t) && $t > $cut; }));
}

function timer_stop(int $code, string $msg): void {
    http_response_code($code);
    if ($code === 429) header('Retry-After: 900');
    exit($msg . "\n");
}

// Exits 403/405/429 unless the request carries the pull key.
function timer_require_key(string $scope): void {
    header('Cache-Control: no-store');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') timer_stop(405, 'POST only.');
    if (count(timer_failures($scope)) >= 5) timer_stop(429, 'Too many attempts. Try again later.');
    $want = (string)(timer_config()['pull_key'] ?? '');
    $got = $_SERVER['HTTP_X_DEPLOY_KEY'] ?? ($_POST['key'] ?? '');
    if (!is_string($got)) $got = '';
    if ($want === '') {
        error_log("timer $scope: no pull_key configured; refusing");
        timer_stop(403, 'Not allowed.');
    }
    if ($got === '' || !hash_equals($want, $got)) {
        $list = timer_failures($scope);
        $list[] = time();
        @file_put_contents(timer_fail_file($scope), json_encode($list), LOCK_EX);
        error_log("timer $scope: bad key from " . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        timer_stop(403, 'Not allowed.');
    }
    @unlink(timer_fail_file($scope));
}

// At most one successful run every 20 seconds.
function timer_throttle(): void {
    $f = timer_state_dir() . '/last-deploy';
    $prev = (int)@file_get_contents($f);
    if ($prev > time() - 20) timer_stop(429, 'An update just ran. Wait a few seconds and try again.');
    @file_put_contents($f, (string)time(), LOCK_EX);
}

// Before a reset: refuse a commit that tracks server-only files (a reset would
// overwrite them) or PHP inside data/upload/cache style folders.
function timer_tree_problem(string $dir, string $ref): string {
    $cwd = escapeshellarg($dir);
    $list = shell_exec("cd $cwd && git ls-tree -r --name-only " . escapeshellarg($ref) . " 2>/dev/null");
    if (!is_string($list) || trim($list) === '') return 'could not list ' . $ref;
    foreach (explode("\n", trim($list)) as $path) {
        $base = strtolower(basename($path));
        if ($base === 'config.php' || $base === '.htaccess' || preg_match('/-secrets?\.php$|^\.env/', $base)) {
            return "commit tracks server-only file $path";
        }
        if (preg_match('/\.(php\d?|phtml|phar)$/i', $path)) {
            foreach (explode('/', strtolower(dirname($path))) as $seg) {
                if (in_array($seg, ['data', 'upload', 'uploads', 'cache', 'tmp', 'temp', 'backup', 'backups', 'images', 'sounds'], true)) {
                    return "commit has PHP in a data folder: $path";
                }
            }
        }
    }
    return '';
}

// .htaccess is server-only now (gitignored), so a reset never overwrites it.
// The tracked template htaccess.dist is installed when none exists.
function timer_ensure_htaccess(string $dir, ?string $saved = null): string {
    $ht = $dir . '/.htaccess';
    if (is_file($ht)) return '';
    if ($saved !== null && $saved !== '') {
        @file_put_contents($ht, $saved);
        return 'restored .htaccess';
    }
    if (is_file($dir . '/htaccess.dist') && @copy($dir . '/htaccess.dist', $ht)) return 'installed .htaccess from htaccess.dist';
    return '';
}
