# Windows Reader Launcher Source

This folder is the git-tracked source for the Windows reader GUI launcher.

Deploy output uses this shape:

```text
deploy-transfer/reader-agent/
  Thai ID Reader.bat
  .reader-support/
    THAI_ID_READER_LAUNCHER.ps1
    RUN_READER_AGENT_BACKGROUND.ps1
    STOP_READER_AGENT.ps1
```

Keep `reader.env.example` as the documented default template only. Do not commit real reader machine config, logs, PID files, or card-read data.

Runtime behavior:

- `Thai ID Reader.bat` runs an optional bundle-owned `INSTALL_READER.ps1`
  before opening the CMD window and GUI. The full offline bundle omits that
  hook; the lite bundle uses it for first-run runtime installation.
- The GUI validates config, writes `reader.env`, then closes.
- The CMD window starts the reader-agent and shows the live terminal output.
- Closing the CMD window stops the reader-agent.

To refresh the deploy-transfer launcher files from this source:

```powershell
npm run sync:reader-launcher
```
