# OCRID_T01 Handoff

## Latest Decision Summary

This repo should remain the Thai ID OCR fallback/research project. The real implementation should start in a new codebase, preferably a Node/TypeScript monorepo, because the production direction is now a SmartCard reader + backend + iPad webapp workflow.

Current production direction:

- Use direct PC/SC SmartCard reading with `goomgumx/thai-id-card-reader`.
- Do not use FAST ID software or the FAST ID file-watcher bridge.
- Do not broadcast full card-read data to all nurse iPads.
- Use a secure scan-request transaction:
  - nurse taps `Scan ID Card` on iPad
  - backend creates a request and short turn code, e.g. `A7K2Q`
  - station PC display shows only the active code/status
  - nurse compares iPad code with station PC code
  - card is inserted and read
  - full scan payload is delivered only to that nurse/device session
- Normal-operation target:
  - station PC: 0 clicks
  - nurse iPad: 1 tap

## Recommended Next Codebase

Start a new monorepo for implementation:

```text
thai-id-intake/
  apps/
    reader-agent/
    backend/
    nurse-webapp/
  packages/
    shared-types/
```

Suggested responsibilities:

- `apps/reader-agent/`: Node.js station PC service using `goomgumx/thai-id-card-reader`.
- `apps/backend/`: scan request transactions, active turn-code state, private result delivery, audit, expiry, wrong-patient rejection.
- `apps/nurse-webapp/`: iPad webapp where nurses request scans and receive only their own scan results.
- `packages/shared-types/`: shared normalized card payload and scan-request types.

Keep `OCRID_T01` separate as OCR fallback/research. Later, OCR can become another adapter that sends the same normalized card payload into the new backend.

## Secure Scan Flow

```text
Nurse iPad
  -> tap Scan ID Card
  -> backend creates scan request + turn code
  -> iPad subscribes to private result topic/session

Station PC display
  -> shows active turn code/status only
  -> no citizen ID, full name, address, or photo

Nurse/staff
  -> confirms iPad code matches station PC code (visual confirmation)
  -> inserts card into SmartCard reader

Reader agent
  -> reads card using goomgumx/thai-id-card-reader
  -> attaches active requestId
  -> sends normalized payload to backend

Backend
  -> publishes full scan result only to requesting nurse/device session
  -> records audit event
```

If the wrong patient card is scanned:

- The result appears only on the requesting nurse's iPad.
- Nurse taps `Wrong Patient / Not Mine`.
- Backend marks the scan as `misrouted` or rejected.
- Full data is not broadcast to other iPads.
- Correct nurse must request/use their own turn code and rescan the card.

## Security Rules

- Never publish full card data to a station-wide topic.
- Station-wide status may include only safe metadata:
  - active turn code
  - reader status
  - queue/waiting state
  - errors without PII
- Full scan payload goes only to a private nurse/device-session destination.
- Scan requests expire quickly, around `60-120 seconds`.
- Avoid logging full citizen ID, full address, photo base64, laser/back number, or raw SmartCard output.
- Store ID-card photo only temporarily for confirmation unless hospital policy requires retention.
- Audit request creation, code activation, card scan, result delivery, rejection, expiry, and errors.

## SmartCard Reader Agent Notes

Chosen reader library:

- Package/repo: `goomgumx/thai-id-card-reader`
- Runtime direction: Node.js local service on the station PC
- Native dependency caution: `pcsclite` may require Windows build tooling

Reader agent responsibilities:

- Initialize `ThaiIdCardReader`.
- Listen for successful reads with `onReadComplete`.
- Listen for read failures with `onReadError`.
- Add metadata:
  - `stationId`, e.g. `A01`
  - `readerId`, e.g. `A01-PC-01`
  - `source`, e.g. `PCSC_THAI_ID`
  - `readAt`
  - active `requestId`
- Normalize library-specific fields into the project contract.
- Send payload to backend.
- Debounce duplicate reads from the same inserted card.
- Log only non-sensitive status.

Suggested local config:

```env
STATION_ID=A01
READER_ID=A01-PC-01
CARD_READ_API_URL=http://localhost:3001/api/card-reads
INSERT_CARD_DELAY_MS=500
READ_TIMEOUT_MS=5000
```

Suggested normalized payload shape:

```json
{
  "requestId": "...",
  "stationId": "A01",
  "readerId": "A01-PC-01",
  "source": "PCSC_THAI_ID",
  "readAt": "2026-06-08T00:00:00.000Z",
  "card": {
    "citizenId": "...",
    "titleTh": "...",
    "titleEn": "...",
    "fullNameTh": "...",
    "fullNameEn": "...",
    "firstNameTh": "...",
    "firstNameEn": "...",
    "lastNameTh": "...",
    "lastNameEn": "...",
    "dateOfBirth": "...",
    "gender": "...",
    "cardIssuer": "...",
    "issueDate": "...",
    "expireDate": "...",
    "address": "...",
    "photoAsBase64Uri": "..."
  }
}
```

## OCRID_T01 Current State

This repo is a Python Thai National ID OCR/prototyping project. It started with `openthaigpt/thai-trocr`, then moved to PaddleOCR because TroCR performed poorly on Thai ID cards.

Useful files:

- `ocr_thai_id.py`: OCR an image file.
- `camera_ocr.py`: laptop-camera capture, card detection/flattening, then OCR.
- `scan-testing-image.ps1`: interactive image testing script for `testingPng/`.
- `semantic_recognizer.py`: Mode 4 semantic recognition from full-card OCR lines.
- `card_detect.py`: detects and warps card to CR80/Thai ID ratio.
- `paddle_id_ocr.py`: PaddleOCR setup, output formatting, finalizers, and boxed preview drawing.
- `regions.example.json`: crop/region example for region-based OCR modes.

Run image testing:

```powershell
.\scan-testing-image.ps1
```

Run camera OCR:

```powershell
python .\camera_ocr.py --mode 4
```

Compile check:

```powershell
.\.venv\Scripts\python.exe -m py_compile .\camera_ocr.py .\ocr_thai_id.py .\semantic_recognizer.py .\paddle_id_ocr.py .\card_detect.py
```

Generated OCR data is sensitive:

- `output/output*.json`
- `output/boxoutputpic/`
- `output/crops/`
- `testingPng/`

Do not commit real ID-card images, OCR output, SmartCard read output, local reader-agent logs, pending-read payloads, or card photos.

## Reference Files In `mdfiles/`

- `userflow_Goom_plan.mmd`: best starting reference for the next implementation codebase. It captures the latest secure 5-character turn-code flow, private delivery, wrong-patient recovery, and click targets.
- `tools.md`: useful companion for the new reader-agent repo. It documents Windows `pcsclite` / `node-gyp` troubleshooting.
- `project_understanding_goomgumx_plan.mmd`: useful historical architecture diagram, but it still contains older pending-queue/broadcast ideas and should be updated before using as implementation truth.
- `PLANFastID watcherbridge.md`: obsolete for the current direction. Keep only as historical context; do not use as the starting plan.

## Next Steps

1. Create the new `thai-id-intake/` monorepo.
2. Use `mdfiles/userflow_Goom_plan.mmd` as the primary workflow reference.
3. Use `mdfiles/tools.md` when setting up the Windows SmartCard reader agent.
4. Build the reader-agent proof of concept on the real A01 Windows PC with the actual USB SmartCard reader.
5. Build backend scan-request transactions and private result delivery before building broad nurse UI features.
6. Keep OCR Mode 4 available as a fallback/manual recovery path only.
