// TODO: Change this to use @darkforest_eth/network
import { CORE_CONTRACT_ADDRESS as DF_CORE_CONTRACT_ADDRESS } from "@darkforest_eth/contracts";
import dfCoreAbi from "@darkforest_eth/contracts/abis/DarkForestCore.json";
import {
  decodeArtifactPointValues,
  decodeUpgradeBranches,
} from "@darkforest_eth/serde";
import { ContractConstants } from "df-client";
import { log } from "df-helm-common";

import * as ethers from "ethers";

const POKT_NETWORK_RPC_URL =
  "https://poa-xdai.gateway.pokt.network/v1/lb/60b13899d3279c22da2a444d";

const provider = new ethers.providers.JsonRpcProvider(
  process.env.JSON_RPC_URL || POKT_NETWORK_RPC_URL
);

const dfContract = new ethers.Contract(
  process.env.DF_CORE_CONTRACT_ADDRESS || DF_CORE_CONTRACT_ADDRESS,
  dfCoreAbi,
  provider
);

async function fetchGameConstants(): Promise<any> {
  log.verbose("Loading game constants...");
  const gameConstants = await dfContract.gameConstants();
  log.verbose("Loaded game constants");
  return gameConstants;
}

async function fetchSnarkConstants(): Promise<any> {
  log.verbose("Loading snark constants...");
  const snarkConstants = await dfContract.snarkConstants();
  log.verbose("Loaded snark constants");
  return snarkConstants;
}

async function fetchDefaultStatus(): Promise<any> {
  log.verbose("Loading default stats...");
  const defaultStats = await dfContract.getDefaultStats();
  log.verbose("Loaded default stats");
  return defaultStats;
}

async function fetchPlanetLevelThresholds(): Promise<any> {
  log.verbose("Loading planet level thresholds...");
  const planetLevelThresholds = await dfContract.getPlanetLevelThresholds();
  log.verbose("Loaded planet level thresholds");
  return planetLevelThresholds;
}

async function fetchCumulativeRarities(): Promise<any> {
  log.verbose("Loading planet cumulative rarities...");
  const planetCumulativeRarities = await dfContract.getCumulativeRarities();
  log.verbose("Loaded planet cumulative rarities");
  return planetCumulativeRarities;
}

async function fetchUpgradeBranches(): Promise<any> {
  log.verbose("Loading upgrade branches...");
  const upgradeBranches = await dfContract.getUpgrades();
  log.verbose("Loaded upgrade branches");
  return upgradeBranches;
}

export async function fetchContractConstants(): Promise<ContractConstants> {
  const [
    gameConstants,
    snarkConstants,
    defaultStats,
    planetLevelThresholds,
    planetCumulativeRarities,
    upgradeBranches,
  ] = await Promise.all([
    fetchGameConstants(),
    fetchSnarkConstants(),
    fetchDefaultStatus(),
    fetchPlanetLevelThresholds(),
    fetchCumulativeRarities(),
    fetchUpgradeBranches(),
  ]);
  return {
    DISABLE_ZK_CHECKS: snarkConstants.DISABLE_ZK_CHECKS,

    PLANETHASH_KEY: snarkConstants.PLANETHASH_KEY.toNumber(),
    SPACETYPE_KEY: snarkConstants.SPACETYPE_KEY.toNumber(),
    BIOMEBASE_KEY: snarkConstants.BIOMEBASE_KEY.toNumber(),
    PERLIN_LENGTH_SCALE: snarkConstants.PERLIN_LENGTH_SCALE.toNumber(),
    PERLIN_MIRROR_X: snarkConstants.PERLIN_MIRROR_X,
    PERLIN_MIRROR_Y: snarkConstants.PERLIN_MIRROR_Y,

    TOKEN_MINT_END_SECONDS: 0, // Don't know what this is

    MAX_NATURAL_PLANET_LEVEL: gameConstants.MAX_NATURAL_PLANET_LEVEL.toNumber(),
    TIME_FACTOR_HUNDREDTHS: gameConstants.TIME_FACTOR_HUNDREDTHS.toNumber(),

    PERLIN_THRESHOLD_1: gameConstants.PERLIN_THRESHOLD_1.toNumber(),
    PERLIN_THRESHOLD_2: gameConstants.PERLIN_THRESHOLD_2.toNumber(),
    PERLIN_THRESHOLD_3: gameConstants.PERLIN_THRESHOLD_3.toNumber(),
    INIT_PERLIN_MIN: gameConstants.INIT_PERLIN_MIN.toNumber(),
    INIT_PERLIN_MAX: gameConstants.INIT_PERLIN_MAX.toNumber(),
    SPAWN_RIM_AREA: gameConstants.SPAWN_RIM_AREA.toNumber(),
    BIOME_THRESHOLD_1: gameConstants.BIOME_THRESHOLD_1.toNumber(),
    BIOME_THRESHOLD_2: gameConstants.BIOME_THRESHOLD_2.toNumber(),
    PLANET_RARITY: gameConstants.PLANET_RARITY.toNumber(),
    PLANET_TYPE_WEIGHTS: gameConstants.PLANET_TYPE_WEIGHTS,
    ARTIFACT_POINT_VALUES: decodeArtifactPointValues(
      gameConstants.ARTIFACT_POINT_VALUES
    ),

    PHOTOID_ACTIVATION_DELAY: gameConstants.PHOTOID_ACTIVATION_DELAY.toNumber(),
    LOCATION_REVEAL_COOLDOWN: gameConstants.LOCATION_REVEAL_COOLDOWN.toNumber(),

    defaultPopulationCap: defaultStats.map((stats: any) =>
      stats.populationCap.toNumber()
    ),
    defaultPopulationGrowth: defaultStats.map((stats: any) =>
      stats.populationGrowth.toNumber()
    ),

    defaultSilverCap: defaultStats.map((stats: any) =>
      stats.silverCap.toNumber()
    ),
    defaultSilverGrowth: defaultStats.map((stats: any) =>
      stats.silverGrowth.toNumber()
    ),

    defaultRange: defaultStats.map((stats: any) => stats.range.toNumber()),
    defaultSpeed: defaultStats.map((stats: any) => stats.speed.toNumber()),
    defaultDefense: defaultStats.map((stats: any) => stats.defense.toNumber()),
    defaultBarbarianPercentage: defaultStats.map((stats: any) =>
      stats.barbarianPercentage.toNumber()
    ),

    planetLevelThresholds: planetLevelThresholds.map((x: ethers.BigNumber) =>
      x.toNumber()
    ),
    planetCumulativeRarities: planetCumulativeRarities.map(
      (x: ethers.BigNumber) => x.toNumber()
    ),

    upgrades: decodeUpgradeBranches(upgradeBranches),
  };
}

export async function fetchCurrentWorldRadius(): Promise<number> {
  const currentWorldRadius = await dfContract.worldRadius();
  log.verbose("Current world radius: " + currentWorldRadius);
  return currentWorldRadius;
}
