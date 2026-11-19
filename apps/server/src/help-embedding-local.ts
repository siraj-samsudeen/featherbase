// The embedding model that runs inside the server (help-embedding.ts): an open
// model from Hugging Face, run by Transformers.js on this machine's processor.
// Nothing is sent anywhere to be embedded and nothing is paid per use.
//
// The model's files are kept in a folder: EMBEDDING_CACHE, or
// storage/embedding-models beside the server. A file that is not there yet is
// downloaded from huggingface.co by this module, once; after that the model
// loads from the folder alone, so a server with no way out can be given the
// files by hand (<folder>/<model>/config.json, tokenizer.json,
// tokenizer_config.json and onnx/model_quantized.onnx). The library's own
// downloading is switched off: in this server it fetched the files and then
// could not find them again.
//
// Kept apart from help-embedding.ts because it cannot be tested without that
// download: the tests give help-embedding.ts a stand-in for what this loads.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline as piped } from 'node:stream/promises'
import { readVariable } from './env'

/** Embeds texts: the first token's vector of each, scaled to length 1. */
export type Extractor = (texts: string[], options: { pooling: 'cls'; normalize: true }) => Promise<{ tolist(): unknown }>

interface Transformers {
  pipeline(task: 'feature-extraction', model: string, options: { dtype: string }): Promise<unknown>
  env: { localModelPath: string; allowLocalModels: boolean; allowRemoteModels: boolean }
}

// What a text-embedding model needs: its settings, its tokenizer, and its 8-bit
// weights (a quarter of the full size, and faster on a processor).
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
const HOST = 'https://huggingface.co'

/** The folder the model's files are kept in. */
export function modelFolder(): string {
  return readVariable('EMBEDDING_CACHE')?.trim() || resolve(import.meta.dirname, '../storage/embedding-models')
}

// Downloads one file of the model unless it is already in the folder. It is
// written beside its place and moved there when whole, so a download that was
// cut off is never taken for the file.
async function fetchFile(name: string, file: string, folder: string): Promise<void> {
  const path = join(folder, ...name.split('/'), ...file.split('/'))
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  const url = `${HOST}/${name}/resolve/main/${file}`
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${url} answered HTTP ${response.status}`)
  const megabytes = Math.round(Number(response.headers.get('content-length') ?? 0) / 1e6)
  console.warn(`[help] downloading ${name}/${file}${megabytes ? ` (${megabytes} MB)` : ''} to ${folder}`)
  const part = `${path}.part`
  try {
    await piped(Readable.fromWeb(response.body as never), createWriteStream(part))
    renameSync(part, path)
  } catch (error) {
    rmSync(part, { force: true })
    throw error
  }
}

/** Loads the model from its folder, downloading the files that are not there yet. */
export async function loadLocalExtractor(name: string): Promise<Extractor> {
  const folder = modelFolder()
  try {
    for (const file of FILES) await fetchFile(name, file, folder)
    // Lazy import: the library and its runtime are large, and only help needs them.
    const transformers = await import('@huggingface/transformers') as unknown as Transformers
    transformers.env.localModelPath = folder
    transformers.env.allowLocalModels = true
    transformers.env.allowRemoteModels = false
    return await transformers.pipeline('feature-extraction', name, { dtype: 'q8' }) as Extractor
  } catch (error) {
    throw new Error(why(error))
  }
}

// An error with what caused it, on one line: a failed download says why only in its cause.
function why(error: unknown): string {
  const parts: string[] = []
  for (let at = error as { message?: string; cause?: unknown } | undefined; at && parts.length < 4; at = at.cause as typeof at)
    parts.push(String(at.message ?? at).split('\n')[0])
  return parts.join(' <- ')
}
