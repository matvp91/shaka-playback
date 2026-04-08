# TODO

Merge media_controller and buffer_controller

Create a struct to keep sourceBuffer listeners instead of storing it in listeners_ in buffer_controller.

Preference API for track selection — expose a preference-based API (e.g., prefer 1080p, prefer ABR) rather than exposing tracks directly. Immediate switch on preference change. Stream controller resets to IDLE with new track. Design the public API on Player.

Seek to end restarts playback — when seeking to the end, the player immediately restarts instead of staying at the end. Seeking is broken after this occurs.

- Seek to 640.895917 at start, you'll enter a stall.
- Seek to 372.948534