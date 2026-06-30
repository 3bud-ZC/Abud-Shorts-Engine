# n8n + YouTube Automation

This integration lets you automate short-form video generation with the Abud Shorts Engine from an n8n workflow. YouTube upload is **optional** and **disabled by default**.

## What this integration does

- Generates a short-form video script with a structured AI prompt (title, description, tags, and 4 scenes).
- Picks a matching background music tag from the engine's available tags.
- Calls the Abud Shorts Engine REST API to render the video.
- Waits for the render and checks status until the video is ready.
- Downloads the final MP4.
- Optionally uploads the video to YouTube if `AUTO_UPLOAD_TO_YOUTUBE` is enabled.

## What it does not do

- It does not deploy the engine to a VPS or configure a domain.
- It does not configure Nginx.
- It does not expose your API keys or YouTube credentials.
- It does not run forever: the workflow uses a wait/check loop, but it does not include a hard max-attempts counter in the raw JSON. If the engine is stuck, the loop may continue until you manually stop it.
- It does not support Arabic or other non-English scripts yet, because Kokoro TTS works best with English.

## Requirements

- Abud Shorts Engine running locally.
- n8n (local native, Docker, or cloud). For local engine access, local or Docker Desktop n8n is recommended.
- A Gemini/LLM credential in n8n if you use the AI generation nodes.
- A YouTube OAuth2 credential in n8n if you enable the optional upload.
- A Pexels API key in the engine's `.env` file.

## Optional local n8n Docker setup

If you do not already have n8n running, you can start it with the included optional compose file:

```text
integrations/n8n/docker-compose.n8n.yml
```

```powershell
cd "C:\Users\Abud\Desktop\GitHub\Abud Shorts Engine\source\integrations\n8n"
docker compose -f docker-compose.n8n.yml up -d
```

This starts n8n on port `5678` and stores data in `integrations/n8n/n8n-data/` (already gitignored). Do not commit this folder.

Environment variables in the compose file:

- `N8N_HOST=localhost`
- `N8N_PORT=5678`
- `N8N_PROTOCOL=http`
- `N8N_SECURE_COOKIE=false`
- `GENERIC_TIMEZONE=Africa/Cairo`

If port `5678` is already in use by another n8n container, either stop that container or use a different port.

## Importing the workflow

1. Open n8n.
2. Create a new workflow.
3. Open the workflow menu and select **Import from file**.
4. Choose:

```text
integrations/n8n/abud-shorts-youtube-workflow.json
```

5. n8n will warn about missing credentials. That is expected.

You can also import the workflow from the n8n CLI:

```powershell
docker cp integrations/n8n/abud-shorts-youtube-workflow.json <n8n-container>:/tmp/workflow.json
docker exec <n8n-container> n8n import:workflow --input=/tmp/workflow.json
```

## Manual dry-run checklist

Before running the workflow for the first time:

1. Confirm the engine is running: `Invoke-RestMethod http://localhost:3124/health` should return `ok`.
2. In the **Configure** node, set `SERVER_URL` to the correct value for your n8n setup:
   - n8n in Docker Desktop: `http://host.docker.internal:3124`
   - n8n local (not Docker): `http://localhost:3124`
3. Keep `AUTO_UPLOAD_TO_YOUTUBE` as `false`.
4. Keep `YOUTUBE_PRIVACY_STATUS` as `private`.
5. Open the **Google Gemini Chat Model** node and connect your own Gemini credential.
6. Do not connect the **YouTube upload** node yet.
7. Click **Execute Workflow**.

Expected dry-run flow:

- **Generate Content** produces a title, description, tags, and 4 scenes.
- **Pick music tag** selects a music tag from the engine.
- **Start render** sends the request to the engine.
- **Wait** and **Check status** poll until the render is ready.
- **Download final video** downloads the MP4 as a binary.
- **IF auto upload enabled** is false, so the workflow skips YouTube and reaches **Final success**.


## Setting SERVER_URL

Open the **Configure** node and set `SERVER_URL` to the address where the engine is reachable from n8n:

| n8n setup | Recommended SERVER_URL |
| --- | --- |
| n8n running locally (not Docker) | `http://localhost:3124` |
| n8n running in Docker Desktop | `http://host.docker.internal:3124` |
| n8n cloud / remote | Local engine is not reachable unless you deploy or tunnel it |

The workflow file defaults to `http://host.docker.internal:3124` because n8n is often run inside Docker.

## How the workflow works step by step

1. **Manual Trigger** (or optional **Schedule Trigger**) starts the workflow.
2. **Configure** sets the server URL, upload flag, privacy status, channel name, category, and region.
3. **Get music tags** fetches the list of available music tags from the engine.
4. **Group music tags** aggregates the tag list so it can be used in the prompt.
5. **Generate Content** (with Google Gemini) writes a title, description, tags, and 4 scenes in English.
6. **Pick music tag** (with Google Gemini) selects the best tag from the engine's list.
7. **Start render** sends the scenes and music tag to `POST /api/short-video`.
8. **Wait** pauses for 25 seconds.
9. **Check status** calls `GET /api/short-video/{videoId}/status`.
10. **IF ready**:
    - `true` → download the video.
    - `false` → check if failed.
11. **IF failed**:
    - `true` → go to **Final failed**.
    - `false` → go back to **Wait** and check again.
12. **Download final video** fetches the MP4 from `GET /api/videos/{videoId}/download` as a binary file.
13. **IF auto upload enabled**:
    - `true` → upload to YouTube.
    - `false` → go directly to **Final success**.
14. **Final success** or **Final failed** reports the result.

## How optional YouTube upload works

YouTube upload is controlled by the `AUTO_UPLOAD_TO_YOUTUBE` field in the **Configure** node.

- Default: `false`
- When `false`, the workflow only renders and downloads the video.
- When `true`, the workflow also uploads the downloaded MP4 to the connected YouTube channel.

## How to keep YouTube upload disabled

Leave `AUTO_UPLOAD_TO_YOUTUBE` as `false` in the **Configure** node. You can also delete or disconnect the **YouTube upload** node if you never intend to use it.

## How to enable YouTube upload safely

1. Set `AUTO_UPLOAD_TO_YOUTUBE` to `true` in the **Configure** node.
2. Set `YOUTUBE_PRIVACY_STATUS` to `private` or `unlisted` (recommended).
3. Add a YouTube OAuth2 credential in n8n.
4. In the **YouTube upload** node, reconnect the credential. The workflow file contains a placeholder credential reference only.
5. Review the generated video before switching to `public`.

## Recommended privacy

Default: `private`

Recommended for automation: `private` or `unlisted`. Never set the default to `public` until you have manually reviewed the output.

## Where videos are stored locally

Rendered videos are saved in the engine's data directory:

- Inside the container: `/app/data/videos`
- On Windows (default mount): `C:/abud-shorts-engine/data-dev/videos`

Each render usually produces:

```text
<videoId>.mp4
<videoId>.metadata.json
```

You can also download the MP4 directly through the workflow's **Download final video** node.

## Troubleshooting

### Cannot connect to server

- Verify the engine is running: `curl http://localhost:3124/health`
- Check that `SERVER_URL` matches where n8n can reach the engine (see the table above).
- If n8n is in Docker, `http://host.docker.internal:3124` usually works on Docker Desktop. On Linux, you may need to add `--add-host=host.docker.internal:host-gateway` or use the host IP.
- If n8n is cloud-hosted, the local engine is not reachable unless you deploy or tunnel it.

### Pexels key missing

- The engine needs a real `PEXELS_API_KEY` in `.env` for real renders.
- Without it, Pexels searches will fail and the render may fail or use a placeholder.

### Render stuck

- Check the engine logs: `docker logs --tail=200 abud-shorts-engine-dev`
- The workflow waits 25 seconds between checks. If the render is stuck, the loop may continue indefinitely. Stop the execution in n8n and investigate the engine.
- Consider adding a manual max-attempts counter in n8n if you need a hard limit.

### YouTube credential not connected

- The workflow file uses a placeholder credential ID.
- Open the **YouTube upload** node and connect your own YouTube OAuth2 credential.
- Do not commit the credential file.

### Binary upload issue

- Make sure the **Download final video** HTTP Request node has **Response > Binary** enabled.
- The **YouTube upload** node consumes the binary output from the download node.
- If n8n reports a missing binary, check that the engine returned the MP4 successfully.

### Docker networking issue

- n8n in Docker may not resolve `host.docker.internal` on all Linux setups.
- Try using the host IP address instead, or run n8n in `host` network mode for testing.
- If both n8n and the engine are in the same Docker Compose network, use the engine container name as the hostname.

## Runtime-tested notes

The workflow was imported and dry-run tested against a local Docker setup:

- n8n Docker URL: `http://localhost:5678`
- Engine URL from n8n Docker: `http://host.docker.internal:3124`
- The dry run works with YouTube upload disabled (`AUTO_UPLOAD_TO_YOUTUBE=false`).
- YouTube upload is skipped when `AUTO_UPLOAD_TO_YOUTUBE=false`. This is expected and safe.
- The workflow reaches the render and download path when the engine is healthy and the Gemini credential is connected.

To test YouTube upload later:

1. Connect your YouTube OAuth2 credential manually in the **YouTube upload** node.
2. Set `AUTO_UPLOAD_TO_YOUTUBE=true` in the **Configure** node.
3. Keep `YOUTUBE_PRIVACY_STATUS=private`.
4. Run one test only.
5. Review the video before changing the privacy status to `public`.

## Security notes

- Never commit `.env` or any file containing real API keys.
- Never commit n8n credential exports or `n8n-data` directories.
- Never commit generated videos or `.metadata.json` sidecars.
- Keep YouTube uploads `private` or `unlisted` until you manually review the video.
- If you accidentally commit a secret, rotate it immediately and remove it from the repository history.

## Language note

All generated text is in English because Kokoro TTS performs best with English. Arabic and other non-English scripts are future work and require engine updates for non-English TTS support.
