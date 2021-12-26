// Module to call into remote explorer and store result planet locations in redis
import * as ethers from "ethers";
import fetch from "isomorphic-fetch";

import { log } from "df-helm-common";
import {
  biomebasePerlin,
  Chunk,
  ChunkId,
  ChunkStore,
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

import { CORE_CONTRACT_ADDRESS as DF_CORE_CONTRACT_ADDRESS } from "@darkforest_eth/contracts";
import dfCoreAbi from "@darkforest_eth/contracts/abis/DarkForestCore.json";
import { locationIdFromDecStr } from "@darkforest_eth/serde";

import { RedisClient } from "../types";
import { ALL_CHUNKS_LIST_KEY } from "../../df-helm-common/constants";

const POKT_NETWORK_RPC_URL =
  "https://poa-xdai.gateway.pokt.network/v1/lb/60b13899d3279c22da2a444d";

const DEFAULT_REMOTE_EXPLORER_URL = "http://localhost:8000/mine";

const provider = new ethers.providers.JsonRpcProvider(
  process.env.JSON_RPC_URL || POKT_NETWORK_RPC_URL
);
const dfContract = new ethers.Contract(
  process.env.DF_CORE_CONTRACT_ADDRESS || DF_CORE_CONTRACT_ADDRESS,
  dfCoreAbi,
  provider
);
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
    log.verbose("Sending message to remote worker", msgJson);

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

    const exploredChunk = await resp.json();
    log.verbose("Received explored chunk: " + JSON.stringify(exploredChunk));

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

export async function exploreMap(redisClient: RedisClient) {
  const currentWorldRadius = await dfContract.worldRadius();
  log.verbose("Current world radius: " + currentWorldRadius);
  const gameConstants = await dfContract.gameConstants();
  log.verbose("Loaded game constants");
  const snarkConstants = await dfContract.snarkConstants();
  log.verbose("Loaded snark constants");
  const hashConfig: HashConfig = {
    planetHashKey: snarkConstants.PLANETHASH_KEY.toNumber(),
    spaceTypeKey: snarkConstants.SPACETYPE_KEY.toNumber(),
    biomebaseKey: snarkConstants.BIOMEBASE_KEY.toNumber(),
    perlinLengthScale: snarkConstants.PERLIN_LENGTH_SCALE.toNumber(),
    perlinMirrorX: snarkConstants.PERLIN_MIRROR_X,
    perlinMirrorY: snarkConstants.PERLIN_MIRROR_Y,
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
    gameConstants.PLANET_RARITY.toNumber(),
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
