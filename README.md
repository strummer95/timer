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

One time: make a `timer` folder in the web root of 13.duckandrabbit.co, upload
`install.php`, visit it, click Install, then delete `install.php`.

After that: push to `main` here, then hit `pull.php?key=...` (the installer
prints the full URL), or use the Update from GitHub button on the page.

`config.php` holds the pull key and is gitignored — it only exists on the server.
