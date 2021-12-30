// From https://github.com/Bind/df-snarker/blob/master/src/main.ts
// With some minor modifications
import LRUMap from "mnemonist/lru-cache";
const snarkjs = require("snarkjs");

import {
  SnarkJSProofAndSignals,
  buildContractCallArgs,
  MoveSnarkInput,
  MoveSnarkContractCallArgs,
  moveSnarkWasmPath,
  moveSnarkZkeyPath,
} from "@darkforest_eth/snarks";

import { modPBigInt } from "@darkforest_eth/hashing";
import { ContractConstants } from "df-client";

const CACHE_SIZE: number = parseInt(process?.env?.CACHE_SIZE || "10000");
const InMemoryCache = new LRUMap(CACHE_SIZE);

export async function getMoveArgs(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  distMax: number,
  contractConstants: ContractConstants
): Promise<MoveSnarkContractCallArgs> {
  try {
    const cacheKey = `${x1}-${y1}-${x2}-${y2}-${r}-${distMax}`;
    const cachedResult = InMemoryCache.get(cacheKey);
    if (cachedResult) {
      return cachedResult as MoveSnarkContractCallArgs;
    }
    const input: MoveSnarkInput = {
      x1: modPBigInt(x1).toString(),
      y1: modPBigInt(y1).toString(),
      x2: modPBigInt(x2).toString(),
      y2: modPBigInt(y2).toString(),
      r: r.toString(),
      distMax: distMax.toString(),
      PLANETHASH_KEY: contractConstants.PLANETHASH_KEY.toString(),
      SPACETYPE_KEY: contractConstants.SPACETYPE_KEY.toString(),
      SCALE: contractConstants.PERLIN_LENGTH_SCALE.toString(),
      xMirror: contractConstants.PERLIN_MIRROR_X ? "1" : "0",
      yMirror: contractConstants.PERLIN_MIRROR_X ? "1" : "0",
    };

    const { proof, publicSignals }: SnarkJSProofAndSignals =
      await snarkjs.groth16.fullProve(
        input,
        moveSnarkWasmPath,
        moveSnarkZkeyPath
      );

    const proofArgs = buildContractCallArgs(
      proof,
      publicSignals
    ) as MoveSnarkContractCallArgs;
    InMemoryCache.set(cacheKey, proofArgs);
    return proofArgs;
  } catch (e) {
    throw e;
  }
}
