# Time Trial Timer

A camera stopwatch for sprint reps. Prop a phone at the start line, walk out of
frame and back in to calibrate, then run. The clock starts the moment you clear
the frame and stops the moment you are back in it.

Live at https://13.duckandrabbit.co/timer/

## How it detects you

The page grabs video frames, shrinks them to 96x72 greyscale, and stores an
average of the empty scene during the countdown. Every frame after that it
counts the pixels differing from that background by more than 26 levels. If more
than the sensitivity threshold of the frame differs, you are "present".
Transitions need three consecutive frames to count, and the timestamp used is
the first frame of the change, not the confirmed one, so the debounce costs no
accuracy. While you are away the background slowly adapts so drifting sun does
not trip the return.

## Deploy

One time: make a `timer` folder in the web root of 13.duckandrabbit.co, upload
`install.php`, visit it, click Install, then delete `install.php`.

After that: push to `main` here, then hit `pull.php?key=...` (the installer
prints the full URL).

`config.php` holds the pull key and is gitignored — it only exists on the server.
