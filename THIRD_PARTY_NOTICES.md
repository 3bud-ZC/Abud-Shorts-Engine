# ABUD Shorts Engine Third-Party Notices

This file records third-party notices for the ABUD Shorts Engine V2.1.0
General Availability package.

## Application Runtime Dependencies

| Component | Version | Source | License / Notice |
| :--- | :--- | :--- | :--- |
| ABUD Shorts Engine package | 2.1.0 | Local repository package metadata | MIT declared by package metadata |
| Express | ^4.18.2 | npm `express` | MIT |
| React | ^19.1.0 | npm `react`, `react-dom` | MIT |
| Material UI | ^5.15.x | npm `@mui/*` | MIT |
| Remotion | ^4.0.286 | npm `remotion`, `@remotion/*` | See Remotion package license notices |
| FFmpeg installer package | ^1.1.0 | npm `@ffmpeg-installer/ffmpeg` | Package and bundled FFmpeg binary notices apply |
| fluent-ffmpeg | ^2.1.3 | npm `fluent-ffmpeg` | MIT |
| kokoro-js | ^1.2.0 | npm `kokoro-js` | See package/model notices; used for English local TTS in this product |
| google-auth-library | ^11.0.2 | npm `google-auth-library` | Apache-2.0; used only for optional server-side Google Cloud Text-to-Speech authentication |
| piper-tts runtime | 1.7.0 | PyPI `piper-tts` | GPL-3.0-or-later runtime license |
| Piper Arabic voice model | ar_JO-kareem-medium | `rhasspy/piper-voices` model tree | MIT model metadata recorded in V2.1 status |
| whisper.cpp model | ggml-small.bin | whisper.cpp/Remotion installer path | Model/runtime notices apply; multilingual caption timing model |

## Local Arabic Voice Notice

The local Arabic path separates runtime and model-weight terms:

- Runtime: `piper-tts` version `1.7.0`, GPL-3.0-or-later.
- Model: `ar_JO-kareem-medium`, source
  `https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium`,
  model metadata license recorded as MIT.
- Attribution: Piper voice `ar_JO/kareem` from `rhasspy/piper-voices`.
- Checksums and redistribution/commercial status are recorded in
  `ABUD_SHORTS_ENGINE_STATUS.md` under V2.1 Arabic Local Voice.

## Distribution Strategy

Installer/runtime provisioning must not claim all dependencies are MIT. Local
Arabic TTS includes a GPL-licensed runtime and separately licensed model files.
Model downloads are checksum-pinned by the application installer/runtime path
and are not silently rehosted from random mirrors.

## Optional Google Cloud TTS Notice

Google Cloud Text-to-Speech is an optional cloud provider. Credentials remain
server-side through Application Default Credentials, `GOOGLE_APPLICATION_CREDENTIALS`,
or equivalent deployment secret configuration. Google Cloud TTS is labeled
`Cloud / Free Tier Available`; billing may be required and usage above Google's
free monthly allowance may incur charges.
