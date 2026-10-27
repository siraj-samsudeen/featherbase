// A file upload from a component test. The fetch bridge (pg-test.ts) hands a
// request to the in-process server as a Node Request, and jsdom's FormData and
// File are not Node's: the multipart body would not survive the hand-over, and
// the server's `instanceof File` would not hold. So, for the test that calls
// this, the page and the server both use Node's own — the upload then reaches
// the server as a browser's would. Undone by `vi.unstubAllGlobals()`.
import { File as NodeFile } from 'node:buffer'
import { vi } from 'vitest'

export async function useNodeMultipart(): Promise<void> {
  const form = await new Response('a=1', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).formData()
  vi.stubGlobal('FormData', form.constructor)
  vi.stubGlobal('File', NodeFile)
}

/** A file as the person would pick it. Call after useNodeMultipart(). */
export function pickedFile(name: string, content = 'bytes', type = 'text/plain'): File {
  return new NodeFile([content], name, { type }) as unknown as File
}
