# Phase 5: what was not tested, and how to test it later

Everything below was skipped on purpose or could not be done in the Phase 5 runs. Each entry says why, and how to check it when there is time. The decisions behind them are in [decisions.md](decisions.md).

| # | Gap | Why it was skipped | How to test it |
|---|---|---|---|
| 1 | A relative link through a junction or symlink that points at a share | The guard refuses the resolved path, but `canonicalize` itself has to follow the junction, which contacts the host before the refusal. Only the refusal is tested, with a fake file system. | Make a junction in a document's folder to `\\127.0.0.1\c$`, link to a file through it, and watch port 445 while following the link. |
| 2 | The opener on macOS and Linux | CI only compiles them; no run on either OS. | Follow a web link and a PDF link on each OS. |
| 3 | Internationalized host names | The guard percent-encodes non-ASCII, host included, and no browser was given one. | Follow `https://bücher.example/` and see whether the browser opens it. |
| 4 | Hard links and NTFS alternate names other than the extension | A link may resolve to a name the guard reads as harmless while the file is something else (a hard link named `notes.txt` to a program still opens as text, so it is not run). Only symlinks were modelled, with a fake file system. | Make a hard link `a.pdf` to `calc.exe`, link to it, confirm, and see what opens. |
