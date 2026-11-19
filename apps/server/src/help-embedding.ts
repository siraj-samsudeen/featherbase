// The embedding model that places help passages and questions in one space of
// meaning (help.ts), so a question finds the passages nearest to it. Two
// providers, chosen by EMBEDDING_PROVIDER:
//
//   local   (the default) an open model run inside the server, Snowflake's
//           Arctic Embed M v2.0 unless EMBEDDING_MODEL names another: no key,
//           no cost per use, and no text leaves the server;
//   voyage  Voyage AI's API: VOYAGE_API_KEY is its key, EMBEDDING_API_BASE
//           points it elsewhere (a local stand-in in tests). The key is sent
//           only to that address and never logged or returned.
import { AppError } from './errors'
import { isSet, readVariable } from './env'
import { loadLocalExtractor, type Extractor } from './help-embedding-local'

export interface EmbeddingModel {
  /** The model's name, kept with each passage: passages embedded by another model are embedded again. */
  name: string
  /** One vector per text, in order, each of length 1. A passage is a `document`; a question is a `query`. */
  embed(texts: readonly string[], kind: 'document' | 'query'): Promise<number[][]>
}

export const DEFAULT_LOCAL_MODEL = 'Snowflake/snowflake-arctic-embed-m-v2.0'
export const DEFAULT_VOYAGE_MODEL = 'voyage-4'
const DEFAULT_API_BASE = 'https://api.voyageai.com'
const TIMEOUT_MS = 30_000
/** Texts per request to Voyage, well inside its limits. */
export const EMBEDDING_BATCH = 64
/**
 * Texts the local model embeds at once. One: the memory a batch needs grows with the square of
 * its longest text, and eight long passages at once ran a developer's machine out of memory. On
 * a processor a batch is hardly faster than one text after another.
 */
export const LOCAL_BATCH = 1

let standIn: EmbeddingModel | undefined
/** Tests embed with a stand-in instead of a real model; undefined restores the real one. */
export function useEmbeddingModel(model: EmbeddingModel | undefined): void {
  standIn = model
}

/** The instance's embedding model: the local one unless EMBEDDING_PROVIDER says voyage, which is refused as "not set up" without its key. */
export function embeddingModel(): EmbeddingModel {
  if (standIn) return standIn
  const provider = readVariable('EMBEDDING_PROVIDER')?.trim().toLowerCase() || 'local'
  const named = readVariable('EMBEDDING_MODEL')?.trim()
  if (provider === 'local') return localModel(named || DEFAULT_LOCAL_MODEL)
  if (provider !== 'voyage') throw new AppError('NotSetUpError', 'Help is not set up on this instance: EMBEDDING_PROVIDER must be local or voyage')
  if (!isSet('VOYAGE_API_KEY'))
    throw new AppError('NotSetUpError', 'Help is not set up on this instance: VOYAGE_API_KEY is not set')
  return voyageModel(readVariable('VOYAGE_API_KEY')!.trim(), named || DEFAULT_VOYAGE_MODEL,
    (readVariable('EMBEDDING_API_BASE')?.trim() || DEFAULT_API_BASE).replace(/\/+$/, ''))
}

const unavailable = () => new AppError('ServiceUnavailableError', 'Help did not answer. Try again in a minute.')

function voyageModel(key: string, name: string, base: string): EmbeddingModel {
  return {
    name,
    async embed(texts, kind) {
      const vectors: number[][] = []
      for (let at = 0; at < texts.length; at += EMBEDDING_BATCH) {
        let response: Response
        try {
          response = await fetch(`${base}/v1/embeddings`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: name, input: texts.slice(at, at + EMBEDDING_BATCH), input_type: kind }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        } catch (error) {
          console.warn(`[help] could not reach ${base}: ${(error as Error).message}`)
          throw unavailable()
        }
        // The provider's error text may echo the request, so the asker is never
        // shown it; the server log gets the status, which says what to fix.
        if (!response.ok) {
          console.warn(`[help] the embedding model refused: HTTP ${response.status}`)
          throw unavailable()
        }
        const body = await response.json().catch(() => null) as { data?: { embedding?: unknown; index?: unknown }[] } | null
        const batch = [...(body?.data ?? [])].sort((a, b) => Number(a.index) - Number(b.index)).map(item => item.embedding)
        const want = Math.min(EMBEDDING_BATCH, texts.length - at)
        if (batch.length !== want || !batch.every(vector => Array.isArray(vector) && vector.length > 0 && vector.every(value => typeof value === 'number')))
          throw unavailable()
        vectors.push(...batch as number[][])
      }
      return vectors
    },
  }
}

// A loaded model is kept for the life of the process: loading it takes seconds and much memory.
const loaded = new Map<string, Promise<Extractor>>()

/**
 * A model run inside the server. A question is marked "query: " as the Arctic
 * Embed models expect; a passage is embedded as it is. `load` is what loads
 * the model (tests give a stand-in).
 */
export function localModel(name: string, load: (name: string) => Promise<Extractor> = loadLocalExtractor): EmbeddingModel {
  return {
    name,
    async embed(texts, kind) {
      const vectors: number[][] = []
      try {
        if (!loaded.has(name)) loaded.set(name, load(name))
        const extract = await loaded.get(name)!
        for (let at = 0; at < texts.length; at += LOCAL_BATCH) {
          const batch = texts.slice(at, at + LOCAL_BATCH).map(text => kind === 'query' ? `query: ${text}` : text)
          const found = (await extract(batch, { pooling: 'cls', normalize: true })).tolist()
          if (!Array.isArray(found) || found.length !== batch.length
            || !found.every(vector => Array.isArray(vector) && vector.length > 0 && vector.every(value => typeof value === 'number')))
            throw new Error('it returned something other than one vector for each text')
          vectors.push(...found as number[][])
        }
      } catch (error) {
        // A model that failed to load is tried again on the next question.
        loaded.delete(name)
        console.warn(`[help] the local embedding model ${name} failed: ${(error as Error).message.split('\n')[0]}`)
        throw unavailable()
      }
      return vectors
    },
  }
}
