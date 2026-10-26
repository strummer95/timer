# Time Trial Timer

A camera stopwatch for sprint reps. Prop a phone at the line and either run past
it, or stand in front of it and leave. Live at https://13.duckandrabbit.co/timer/

## Modes

**Run past (gate).** Nobody is in the frame when it arms. The clock starts the
instant any part of you crosses the frame and stops on your next pass. You never
stop in frame, and it re-arms itself as soon as the frame is clear again.

**Stand and go.** You are in the frame when it arms. The clock starts when you
move (or when you clear the frame) and stops when you come back into it.

**Auto** picks between them: step into the frame within three seconds of the
countdown ending for stand and go, or stay clear and it arms as a gate. Once it
has armed as a gate it stays a gate until you recalibrate.

## How it detects you

The page grabs video frames, shrinks them to 128x96 greyscale, and stores an
average of the empty scene during the countdown. Every frame after that it counts
pixels differing from that background by more than 24 levels, both across the
whole frame and within each of eight vertical strips. A crossing fires on either
one, so an edge entry trips as fast as a centered one, and at least 120 pixels
have to change so a bird cannot start your clock.

Sampling runs on `requestVideoFrameCallback` where available, so it sees every
camera frame rather than every screen repaint, and the camera is asked for 60fps.
A crossing normally needs two consecutive frames, but one frame is enough if the
phone is running slow or the reading is unmistakably a body. The timestamp used
is always the first frame of the change, not the confirmed one, so the debounce
costs no accuracy. While you are away the background adapts at a fixed rate per
second so drifting sun does not trip the return.

## Testing

`node test.js` runs the detector headless against synthetic frames: gate and
stand reps, a four-frame pass, a three-frame pass at 20fps, a small object that
must not trip it, and twelve seconds of light drift that must not either. It
checks recorded times against the true interval.

## Deploy

The pull key lives in ONE server-only file that returns an array: `timer-secrets.php`
two folders above this one (preferred), or `config.php` here. Copy `config.example.php`
to make it. Both are gitignored, and the in-folder copy answers 404 if requested.

`install.php` is only for the hand-upload path: make a `timer` folder in the web root of
13.duckandrabbit.co, create the config file with a `pull_key`, upload `install.php` and
`deploy-gate.php`, visit `install.php`, type the key and click Install. With no config it
refuses to run. Once `.git` and the config are present it returns 410. Delete it when the
hand install finishes; pulls restore the file from git, and the restored copy stays off.

The other path is dealdash's `install-timer.php`, which checks this folder out on the
server. Use that instead of `install.php` when dealdash does the install.

After that: push to `main` here, then use the Update from GitHub button on the page, or
`curl -s -X POST -H "X-Deploy-Key: $PULL_KEY" https://13.duckandrabbit.co/timer/pull.php`.
The key is never accepted in the URL. Five bad keys from one IP in 15 minutes lock it out
for 15 minutes, and updates run at most every 20 seconds.

`.htaccess` is server-only too, so `git reset --hard` never overwrites it. The tracked
template is `htaccess.dist`; `pull.php` and `install.php` install it when `.htaccess` is
missing. `pull.php` refuses a commit that tracks `config.php`, `.htaccess` or a secrets
file, or that puts PHP in a data, upload or cache folder.
