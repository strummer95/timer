<?php
// config.example.php: the ONE server-only file for the timer's secrets.
// Copy it to ONE of these (the first one found is used):
//   ../../timer-secrets.php  two folders above this one (preferred)
//   config.php               in this folder (gitignored, denied by .htaccess)
// Never commit the filled-in copy. TIMER_PULL_KEY in the environment also works.

// Answer 404 if this file is ever requested directly. Keep this line.
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }

return [
    // Gates pull.php and install.php. Long random string, for example
    // php -r "echo bin2hex(random_bytes(24));"
    'pull_key' => 'YOUR_PULL_KEY_HERE',
];
