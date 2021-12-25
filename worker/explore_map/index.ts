// Module to call into remote explorer and store result planet locations in redis
import * as ethers from "ethers";
import fetch from "isomorphic-fetch";

import MinerManager from "../df_client/MinerManager";
import { SpiralPattern } from "../df_client/MiningPatterns";
import { ChunkStore } from "../df_client/ChunkStoreTypes";
import { HashConfig, Rectangle } from "../df_client/GlobalTypes";
import { spaceTypePerlin, biomebasePerlin } from "../df_client/GameManager";

import {
  CORE_CONTRACT_ADDRESS as DF_CORE_CONTRACT_ADDRESS,
  GETTERS_CONTRACT_ADDRESS as DF_GETTERS_CONTRACT_ADDRESS,
} from "@darkforest_eth/contracts";
import dfCoreAbi from "@darkforest_eth/contracts/abis/DarkForestCore.json";
import dfGettersAbi from "@darkforest_eth/contracts/abis/DarkForestGetters.json";
import { locationIdFromDecStr } from "@darkforest_eth/serde";

import * as log from "../../common/log";

const POKT_NETWORK_RPC_URL =
  "https://poa-xdai.gateway.pokt.network/v1/lb/60b13899d3279c22da2a444d";

const DEFAULT_REMOTE_EXPLORER_URL = "http://localhost:8000/mine";

const provider = new ethers.providers.JsonRpcProvider(
  process.env.JSON_RPC_URL || POKT_NETWORK_RPC_URL
);
const dfContract = new ethers.Contract(
  DF_CORE_CONTRACT_ADDRESS,
  dfCoreAbi,
  provider
);
const dfGettersContract = new ethers.Contract(
  DF_GETTERS_CONTRACT_ADDRESS,
  dfGettersAbi,
  provider
);

class RedisChunkStore implements ChunkStore {
  hasMinedChunk = (chunkFootprint: Rectangle): boolean => {
    // TODO
    return false;
  };
}

class RemoteWorker implements Worker {
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

export async function exploreMap() {
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

  const center = { x: -40, y: 19 }; // TODO: Get the center to start from as input
  const chunkSize = 256;
  const pattern = new SpiralPattern(center, chunkSize);
  const chunkStore = new RedisChunkStore();
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
  miner.startExplore();
}
