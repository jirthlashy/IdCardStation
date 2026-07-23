# PC/SC Native Addon Troubleshooting

Use this when a Node.js smart-card project fails on Windows with a `pcsclite` native addon error such as:

```txt
Error: ...\node_modules\pcsclite\build\Release\pcsclite.node is not a valid Win32 application.
ERR_DLOPEN_FAILED
```

## Quick Diagnosis

From the project folder:

```powershell
node -p "process.platform + ' ' + process.arch + ' node ' + process.version + ' abi ' + process.versions.modules"
```

Expected shape:

```txt
win32 x64 node vXX.x.x abi NNN
```

The exact Node version is less important than consistency: the Node runtime that starts `reader-agent` must match the ABI used when `pcsclite` was built.

Then test whether `pcsclite` can load from the same project/bundle folder:

```powershell
node -e "require('pcsclite'); console.log('pcsclite loaded')"
```

If it fails with `not a valid Win32 application`, rebuild the native addon.

## Easy Fix

Install a current `node-gyp` into the project:

```powershell
npm install --save-dev node-gyp@latest
```

Add this file to the project as `.npmrc`:

```ini
node_gyp=./node_modules/node-gyp/bin/node-gyp.js
```

Open or call the Visual Studio x64 build environment, then rebuild:

```powershell
cmd.exe /d /s /c "call ""C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"" && set npm_config_node_gyp=%CD%\node_modules\node-gyp\bin\node-gyp.js&& npm rebuild pcsclite"
```

Verify with the same Node runtime that will run the reader-agent:

```powershell
node -e "require('pcsclite'); console.log('pcsclite loaded')"
npm run dev:reader
```

## Why This Happens

`pcsclite` includes a native `.node` binary. If it was installed for the wrong Node version, CPU architecture, or build environment, Node cannot load it.

On this machine, one rebuild failed because npm's bundled `node-gyp@10.1.0` did not recognize the installed Visual Studio toolchain. Installing a newer project-local `node-gyp` and pointing npm at it fixed that part of the rebuild.

## Requirements

- One chosen Windows x64 Node.js runtime for the reader-agent.
- Visual Studio Build Tools or Visual Studio Community with `Desktop development with C++`.
- Windows Smart Card service running.

Check the Smart Card service:

```powershell
Get-Service SCardSvr
```

Start it if needed:

```powershell
Start-Service SCardSvr
```

## If Rebuild Still Fails

Check that the C++ compiler exists:

```powershell
Get-ChildItem 'C:\Program Files\Microsoft Visual Studio' -Recurse -Filter cl.exe -ErrorAction SilentlyContinue | Select-Object -First 10 FullName
```

If no `cl.exe` is found, install Visual Studio Build Tools with the `Desktop development with C++` workload.

If `node-gyp@latest` warns about your Node version, use a supported Node release for the reader-agent and rebuild with that same runtime:

```powershell
npm install
npm rebuild pcsclite
```

## Deployment Rule

For transfer bundles, prefer including a portable Node runtime at:

```text
reader-agent/runtime/node/node.exe
```

If no bundled Node is included, the reader PC's system Node must have the same ABI that `node_modules/pcsclite` was built for.
