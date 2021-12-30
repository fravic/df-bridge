// Module to call into remote explorer and store result planet locations in redis
import fetch from "isomorphic-fetch";

import { log } from "df-helm-common";
import {
  biomebasePerlin,
  Chunk,
  ChunkId,
  ChunkStore,
  ContractConstants,
  getChunkKey,
  getChunkOfSideLengthContainingPoint,
  HashConfig,
  MinerManager,
  MinerManagerEvent,
  Rectangle,
  spaceTypePerlin,
  SpiralPattern,
  toExploredChunk,
  toPersistedChunk,
} from "df-client/dist";

import { locationIdFromDecStr } from "@darkforest_eth/serde";

import { RedisClient } from "../types";
import { ALL_CHUNKS_LIST_KEY } from "../../df-helm-common/constants";

const DEFAULT_REMOTE_EXPLORER_URL = "http://localhost:8000/mine";

const MAX_CHUNK_SIZE = 2 ** 14;
class RedisChunkStore implements ChunkStore {
  // Chunks are persisted to redis for durability
  redisClient: RedisClient;

  // Local sync cache that is read from during normal execution
  chunkCache: Map<string, Chunk> = new Map();

  constructor(redisClient: RedisClient) {
    this.redisClient = redisClient;
  }

  public addNewChunk(chunk: Chunk) {
    if (this.hasMinedChunk(chunk.chunkFootprint)) {
      return;
    }

    // TODO: If there are any existing chunks contained within this chunk, we should also delete them
    // See PersistentChunkStore.ts:addChunk

    const chunkId = getChunkKey(chunk.chunkFootprint);
    this.chunkCache.set(chunkId, chunk);

    // Note: this operation is async, but not awaited
    this.redisClient.lPush(
      ALL_CHUNKS_LIST_KEY,
      JSON.stringify(toPersistedChunk(chunk))
    );
  }

  public async loadChunksFromRedis() {
    const allPersistedChunksJson = await this.redisClient.lRange(
      ALL_CHUNKS_LIST_KEY,
      0,
      -1
    );
    const allPersistedChunks = allPersistedChunksJson.map((jsonChunk) =>
      JSON.parse(jsonChunk)
    );
    for (const persistedChunk of allPersistedChunks) {
      const chunk = toExploredChunk(persistedChunk);
      const chunkId = getChunkKey(chunk.chunkFootprint);
      this.chunkCache.set(chunkId, chunk);
    }
    log.log("Loaded " + allPersistedChunks.length + " chunks from redis");
  }

  public async exportToJson(): Promise<string> {
    // TODO: Export to JSON string for download
    return JSON.stringify({});
  }

  public getChunkByFootprint(chunkLoc: Rectangle): Chunk | undefined {
    let sideLength = chunkLoc.sideLength;

    while (sideLength <= MAX_CHUNK_SIZE) {
      const testChunkLoc = getChunkOfSideLengthContainingPoint(
        chunkLoc.bottomLeft,
        sideLength
      );
      const chunk = this.getChunkById(getChunkKey(testChunkLoc));
      if (chunk) {
        return chunk;
      }
      sideLength *= 2;
    }

    return undefined;
  }

  public hasMinedChunk(chunkLoc: Rectangle): boolean {
    return !!this.getChunkByFootprint(chunkLoc);
  }

  private getChunkById(chunkId: ChunkId): Chunk | undefined {
    return this.chunkCache.get(chunkId);
  }
}

class RemoteWorker {
  url: string;
  hashConfig: HashConfig;

  constructor(url: string, hashConfig: HashConfig) {
    this.url = url;
    this.hashConfig = hashConfig;
  }

  async postMessage(msg: string) {
    const msgJson = JSON.parse(msg);
    let exploredChunk;
    try {
      const resp = await fetch(this.url, {
        method: "POST",
        body: JSON.stringify({
          chunkFootprint: msgJson.chunkFootprint,
          planetRarity: msgJson.planetRarity,
          planetHashKey: msgJson.planetHashKey,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      exploredChunk = await resp.json();
    } catch (error) {
      log.error("Error messaging remote worker: " + error);
      return;
    }

    for (const planetLoc of exploredChunk.planetLocations) {
      const locationId = locationIdFromDecStr(planetLoc.hash);
      log.verbose(
        "Found location " +
          locationId +
          " at " +
          JSON.stringify(planetLoc.coords)
      );
    }

    const chunkCenter = {
      x:
        exploredChunk.chunkFootprint.bottomLeft.x +
        exploredChunk.chunkFootprint.sideLength / 2,
      y:
        exploredChunk.chunkFootprint.bottomLeft.y +
        exploredChunk.chunkFootprint.sideLength / 2,
    };
    exploredChunk.perlin = spaceTypePerlin(chunkCenter, false, this.hashConfig);
    for (const planetLoc of exploredChunk.planetLocations) {
      planetLoc.hash = locationIdFromDecStr(planetLoc.hash);
      planetLoc.perlin = spaceTypePerlin(
        { x: planetLoc.coords.x, y: planetLoc.coords.y },
        true,
        this.hashConfig
      );
      planetLoc.biomebase = biomebasePerlin(
        { x: planetLoc.coords.x, y: planetLoc.coords.y },
        true,
        this.hashConfig
      );
    }

    this.onmessage({ data: JSON.stringify([exploredChunk, msgJson.jobId]) });
  }

  // These get overridden by MinerManager
  onmessage(data: { data: string }) {
    log.error("Unimplemented: onmessage");
  }
  terminate() {
    log.error("Unimplemented: terminate");
  }
  onmessageerror() {
    log.error("Unimplemented: onmessageerror");
  }
  addEventListener() {
    log.error("Unimplemented: addEventListener");
  }
  removeEventListener() {
    log.error("Unimplemented: removeEventListener");
  }
  dispatchEvent() {
    return false;
  }
  onerror() {
    log.error("Unimplemented: onerror");
  }
}

export async function exploreMap(
  redisClient: RedisClient,
  contractConstants: ContractConstants,
  currentWorldRadius: number
) {
  const hashConfig: HashConfig = {
    planetHashKey: contractConstants.PLANETHASH_KEY,
    spaceTypeKey: contractConstants.SPACETYPE_KEY,
    biomebaseKey: contractConstants.BIOMEBASE_KEY,
    perlinLengthScale: contractConstants.PERLIN_LENGTH_SCALE,
    perlinMirrorX: contractConstants.PERLIN_MIRROR_X,
    perlinMirrorY: contractConstants.PERLIN_MIRROR_Y,
  };
  log.verbose("Created hash config: " + JSON.stringify(hashConfig));

  const center = {
    x: Number(process.env.HOME_PLANET_X) || 0,
    y: Number(process.env.HOME_PLANET_Y) || 0,
  };
  log.log("Starting exploration around: " + JSON.stringify(center));
  const chunkSize = 256;
  const pattern = new SpiralPattern(center, chunkSize);
  const chunkStore = new RedisChunkStore(redisClient);
  await chunkStore.loadChunksFromRedis();
  const miner = MinerManager.create(
    chunkStore,
    pattern,
    currentWorldRadius,
    contractConstants.PLANET_RARITY,
    hashConfig,
    false, // useMockHash
    () =>
      new RemoteWorker(
        process.env.REMOTE_EXPLORER_URL || DEFAULT_REMOTE_EXPLORER_URL,
        hashConfig
      )
  );
  miner.on(
    MinerManagerEvent.DiscoveredNewChunk,
    (chunk: Chunk, miningTimeMillis: number) => {
      chunkStore.addNewChunk(chunk);
    }
  );
  miner.startExplore();
}
