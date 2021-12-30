import {
  Biome,
  LocatablePlanet,
  PlanetType,
  SpaceType,
  WorldLocation,
} from "@darkforest_eth/types";
import {
  EMPTY_ADDRESS,
  MIN_PLANET_LEVEL,
  MAX_PLANET_LEVEL,
} from "@darkforest_eth/constants";
import { PlanetLevel, LocationId } from "@darkforest_eth/types";
import { bonusFromHex, getBytesFromHex } from "@darkforest_eth/hexgen";
import bigInt from "big-integer";

import { ContractConstants } from "./ContractsAPITypes";

/**
 * returns the data for an unowned, untouched planet at location
 * most planets in the game are untouched and not stored in the contract,
 * so we need to generate their data optimistically in the client
 */
export function defaultPlanetFromLocation(
  location: WorldLocation,
  contractConstants: ContractConstants
): Partial<LocatablePlanet> {
  const { perlin } = location;
  const hex = location.hash;
  const planetLevel = planetLevelFromHexPerlin(hex, perlin, contractConstants);
  const planetType = planetTypeFromHexPerlin(hex, perlin, contractConstants);
  const spaceType = spaceTypeFromPerlin(perlin, contractConstants);

  const [energyCapBonus, energyGroBonus, rangeBonus, speedBonus, defBonus] =
    bonusFromHex(hex);

  let energyCap = contractConstants.defaultPopulationCap[planetLevel];
  let energyGro = contractConstants.defaultPopulationGrowth[planetLevel];
  let range = contractConstants.defaultRange[planetLevel];
  let speed = contractConstants.defaultSpeed[planetLevel];
  let defense = contractConstants.defaultDefense[planetLevel];
  let silCap = contractConstants.defaultSilverCap[planetLevel];

  let silGro = 0;
  if (planetType === PlanetType.SILVER_MINE) {
    silGro = contractConstants.defaultSilverGrowth[planetLevel];
  }

  energyCap *= energyCapBonus ? 2 : 1;
  energyGro *= energyGroBonus ? 2 : 1;
  range *= rangeBonus ? 2 : 1;
  speed *= speedBonus ? 2 : 1;
  defense *= defBonus ? 2 : 1;

  if (spaceType === SpaceType.DEAD_SPACE) {
    range *= 2;
    speed *= 2;
    energyCap *= 2;
    energyGro *= 2;
    silCap *= 2;
    silGro *= 2;

    defense = Math.floor((defense * 3) / 20);
  } else if (spaceType === SpaceType.DEEP_SPACE) {
    range *= 1.5;
    speed *= 1.5;
    energyCap *= 1.5;
    energyGro *= 1.5;
    silCap *= 1.5;
    silGro *= 1.5;

    defense *= 0.25;
  } else if (spaceType === SpaceType.SPACE) {
    range *= 1.25;
    speed *= 1.25;
    energyCap *= 1.25;
    energyGro *= 1.25;
    silCap *= 1.25;
    silGro *= 1.25;

    defense *= 0.5;
  }

  // apply stat modifiers for special planet types
  if (planetType === PlanetType.SILVER_MINE) {
    silCap *= 2;
    defense *= 0.5;
  } else if (planetType === PlanetType.SILVER_BANK) {
    speed /= 2;
    silCap *= 10;
    energyGro = 0;
    energyCap *= 5;
  } else if (planetType === PlanetType.TRADING_POST) {
    defense *= 0.5;
    silCap *= 2;
  }

  let pirates =
    (energyCap * contractConstants.defaultBarbarianPercentage[planetLevel]) /
    100;
  // increase pirates
  if (spaceType === SpaceType.DEAD_SPACE) pirates *= 20;
  else if (spaceType === SpaceType.DEEP_SPACE) pirates *= 10;
  else if (spaceType === SpaceType.SPACE) pirates *= 4;

  const silver = planetType === PlanetType.SILVER_MINE ? silCap / 2 : 0;

  speed *= contractConstants.TIME_FACTOR_HUNDREDTHS / 100;
  energyGro *= contractConstants.TIME_FACTOR_HUNDREDTHS / 100;
  silGro *= contractConstants.TIME_FACTOR_HUNDREDTHS / 100;

  const biome = getBiome(location, contractConstants);

  return {
    locationId: hex,
    perlin,
    spaceType,
    owner: EMPTY_ADDRESS,
    hatLevel: 0,
    bonus: bonusFromHex(hex),

    planetLevel,
    planetType,
    isHomePlanet: false,

    energyCap: energyCap,
    energyGrowth: energyGro,

    silverCap: silCap,
    silverGrowth: silGro,

    range,
    speed,
    defense,

    energy: pirates,
    silver,

    lastUpdated: Math.floor(Date.now() / 1000),

    upgradeState: [0, 0, 0],

    unconfirmedDepartures: [],
    unconfirmedUpgrades: [],
    unconfirmedBuyHats: [],
    unconfirmedPlanetTransfers: [],
    unconfirmedClearEmoji: false,
    unconfirmedAddEmoji: false,
    loadingServerState: false,
    silverSpent: 0,

    prospectedBlockNumber: undefined,
    heldArtifactIds: [],
    destroyed: false,
    syncedWithContract: false,
    needsServerRefresh: false,
    coordsRevealed: false,
    location,
    biome,
    hasTriedFindingArtifact: false,
    messages: undefined,
  };
}

function planetLevelFromHexPerlin(
  hex: LocationId,
  perlin: number,
  contractConstants: ContractConstants
): PlanetLevel {
  const spaceType = spaceTypeFromPerlin(perlin, contractConstants);

  const levelBigInt = getBytesFromHex(hex, 4, 7);

  let ret = MIN_PLANET_LEVEL;

  for (let type = MAX_PLANET_LEVEL; type >= MIN_PLANET_LEVEL; type--) {
    if (levelBigInt < bigInt(contractConstants.planetLevelThresholds[type])) {
      ret = type;
      break;
    }
  }

  if (spaceType === SpaceType.NEBULA && ret > PlanetLevel.FOUR) {
    ret = PlanetLevel.FOUR;
  }
  if (spaceType === SpaceType.SPACE && ret > PlanetLevel.FIVE) {
    ret = PlanetLevel.FIVE;
  }
  if (ret > contractConstants.MAX_NATURAL_PLANET_LEVEL) {
    ret = contractConstants.MAX_NATURAL_PLANET_LEVEL as PlanetLevel;
  }

  return ret;
}

function planetTypeFromHexPerlin(
  hex: LocationId,
  perlin: number,
  contractConstants: ContractConstants
): PlanetType {
  // level must be sufficient - too low level planets have 0 silver growth
  const planetLevel = planetLevelFromHexPerlin(hex, perlin, contractConstants);

  const spaceType = spaceTypeFromPerlin(perlin, contractConstants);
  const weights = contractConstants.PLANET_TYPE_WEIGHTS[spaceType][planetLevel];
  const weightSum = weights.reduce((x, y) => x + y);
  let thresholds = [weightSum - weights[0]];
  for (let i = 1; i < weights.length; i++) {
    thresholds.push(thresholds[i - 1] - weights[i]);
  }
  thresholds = thresholds.map((x) => Math.floor((x * 256) / weightSum));
  const typeByte = Number(getBytesFromHex(hex, 8, 9));
  for (let i = 0; i < thresholds.length; i++) {
    if (typeByte >= thresholds[i]) {
      return i as PlanetType;
    }
  }
  // this should never happen
  return PlanetType.PLANET;
}

function spaceTypeFromPerlin(
  perlin: number,
  contractConstants: ContractConstants
): SpaceType {
  if (perlin < contractConstants.PERLIN_THRESHOLD_1) {
    return SpaceType.NEBULA;
  } else if (perlin < contractConstants.PERLIN_THRESHOLD_2) {
    return SpaceType.SPACE;
  } else if (perlin < contractConstants.PERLIN_THRESHOLD_3) {
    return SpaceType.DEEP_SPACE;
  } else {
    return SpaceType.DEAD_SPACE;
  }
}

function getBiome(
  loc: WorldLocation,
  contractConstants: ContractConstants
): Biome {
  const { perlin, biomebase } = loc;
  const spaceType = spaceTypeFromPerlin(perlin, contractConstants);

  if (spaceType === SpaceType.DEAD_SPACE) return Biome.CORRUPTED;

  let biome = 3 * spaceType;
  if (biomebase < contractConstants.BIOME_THRESHOLD_1) biome += 1;
  else if (biomebase < contractConstants.BIOME_THRESHOLD_2) biome += 2;
  else biome += 3;

  return biome as Biome;
}
