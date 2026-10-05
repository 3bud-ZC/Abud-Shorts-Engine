import { afterAll } from "vitest";
import nock from "nock";

// Nock patches http.ClientRequest process-wide and Vitest reuses workers
// across test files, so a file that arms interceptors without restoring them
// leaks nock state into whatever file the worker runs next. A later file's
// real outbound call (e.g. the Pexels health probe in arabicVoicePolicy)
// then hits a stale interceptor and stalls past the 5s test timeout.
// Reset nock to a clean-but-armed state after every file so one file's mocks
// can never change another file's behavior.
afterAll(() => {
  nock.cleanAll();
  nock.restore();
  nock.activate();
});
