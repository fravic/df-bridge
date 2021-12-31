// Module to automatically capture nearby planets nearby

import { ApolloClient } from "@apollo/client/core";
import { EMPTY_ADDRESS } from "@darkforest_eth/constants";
import {
  Planet as DFPlanet,
  PlanetType,
  WorldLocation,
  WorldCoords,
} from "@darkforest_eth/types";
import {
  ContractConstants,
  defaultPlanetFromLocation,
  toExploredChunk,
} from "df-client";
import { pickBy, groupBy } from "lodash";

import { ALL_CHUNKS_LIST_KEY, log } from "df-helm-common";

import { RedisClient } from "../types";
import { PLANETS_BY_ID_QUERY, PLAYER_PLANETS_QUERY } from "./queries";
import { ContractAPI } from "../contract";
import { getMoveArgs } from "./snark";
import { PendingTransaction } from "@darkforest_eth/network";

const PLAYER_ADDRESS = process.env.PLAYER_ADDRESS;

const MAX_PLANETS_TO_QUERY = 1000;

// We don't want too many lower-level planets, so set some limits by level
const PLANET_LEVELS_TO_CAPTURE_LIMITS = [5, 7, 10];

// Each planet should only attack other planets within a certain range of relative levels
const ATTACK_PLANETS_WITHIN_RELATIVE_LEVELS_BELOW = 1;
const ATTACK_PLANETS_WITHIN_RELATIVE_LEVELS_ABOVE = 2;

type LocationsById = { [locationId: string]: WorldLocation };

type PlanetData = {
  defense: number;
  energyCap: number;
  energyGrowth: number;
  energyLazy: number;
  lastUpdated: number;
  owner: string;
  planetLevel: number;
  planetType: PlanetType;
  range: number;
};

type PlanetWithLocation = {
  planetId: string;
  planetData: PlanetData;
  location: WorldLocation | undefined;
};

type PlanetWithLocationsById = { [playerPlanetId: string]: PlanetWithLocation };

type MoveToExecute = {
  fromPlanetId: string;
  toPlanetId: string;
  energy: number;
};

const pendingTransactionsByPlanetId: {
  [planetId: string]: PendingTransaction;
} = {};

export async function greedyCapture(
  apolloClient: ApolloClient<any>,
  redisClient: RedisClient,
  contractApi: ContractAPI
) {
  const locationsById = await getAllKnownLocations(redisClient);
  const playerPlanets = await queryPlayerPlanets(apolloClient, locationsById);
  const currentWorldRadius = await contractApi.fetchCurrentWorldRadius();
  const moveablePlayerPlanets = filterPlayerPlanetsToMoveable(
    playerPlanets,
    currentWorldRadius
  );
  log.verbose(
    "Player moveable planets: " + Object.keys(moveablePlayerPlanets).length
  );
  const planetIdsOfInterest = await fetchNearbyPlanetIdsToPlayerPlanets(
    locationsById,
    moveablePlayerPlanets,
    currentWorldRadius
  );
  const contractConstants = await contractApi.fetchContractConstants();
  const planetsOfInterest = await queryPlanetsOfInterest(
    apolloClient,
    planetIdsOfInterest,
    locationsById,
    playerPlanets,
    contractConstants
  );
  const movesToExecute = rankMoves(moveablePlayerPlanets, planetsOfInterest);
  await executeMoves(
    movesToExecute,
    locationsById,
    contractApi,
    currentWorldRadius
  );
}

async function getAllKnownLocations(redisClient: RedisClient) {
  const allPersistedChunksJson = await redisClient.lRange(
    ALL_CHUNKS_LIST_KEY,
    0,
    -1
  );
  const allPersistedChunks = allPersistedChunksJson.map((jsonChunk) =>
    JSON.parse(jsonChunk)
  );
  const allExploredChunks = allPersistedChunks.map((persistedChunk) =>
    toExploredChunk(persistedChunk)
  );
  const results: LocationsById = {};
  for (const chunk of allExploredChunks) {
    for (const planetLocation of chunk.planetLocations) {
      results[planetLocation.hash] = planetLocation;
    }
  }
  log.verbose("Known positions for planets: " + Object.keys(results).length);
  return results;
}

async function queryPlayerPlanets(
  apolloClient: ApolloClient<any>,
  locationsById: LocationsById
): Promise<PlanetWithLocationsById> {
  const { data, error } = await apolloClient.query({
    fetchPolicy: "network-only",
    query: PLAYER_PLANETS_QUERY,
    variables: {
      owner: PLAYER_ADDRESS,
      maxPlanets: MAX_PLANETS_TO_QUERY,
    },
  });
  if (error || !data) {
    throw new Error("Error querying planets for player");
  }
  const results: PlanetWithLocationsById = {};
  for (const result of data.planets) {
    results[result.id as string] = {
      planetId: result.id,
      planetData: gqlPlanetToPlanetData(result),
      location: locationsById[result.id],
    };
  }
  log.verbose("Player planet count: " + Object.keys(results).length);
  return results;
}

function gqlPlanetToPlanetData(gqlPlanet: any): PlanetData {
  return {
    defense: gqlPlanet.defense,
    energyCap: gqlPlanet.milliEnergyCap / 1000,
    energyGrowth: gqlPlanet.milliEnergyGrowth / 1000,
    energyLazy: gqlPlanet.milliEnergyLazy / 1000,
    lastUpdated: gqlPlanet.lastUpdated,
    owner: gqlPlanet.owner.id,
    planetLevel: gqlPlanet.planetLevel,
    planetType: gqlPlanet.planetType,
    range: gqlPlanet.range,
  };
}

function defaultPlanetToPlanetData(defaultPlanet: DFPlanet): PlanetData {
  return {
    defense: defaultPlanet.defense,
    energyCap: defaultPlanet.energyCap,
    energyGrowth: defaultPlanet.energyGrowth,
    energyLazy: defaultPlanet.energy,
    lastUpdated: defaultPlanet.lastUpdated,
    owner: EMPTY_ADDRESS,
    planetLevel: defaultPlanet.planetLevel,
    planetType: defaultPlanet.planetType,
    range: defaultPlanet.range,
  };
}

function filterPlayerPlanetsToMoveable(
  playerPlanets: PlanetWithLocationsById,
  currentWorldRadius: number
): PlanetWithLocationsById {
  return pickBy(playerPlanets, (planetWithPosition, planetId) => {
    const currentEnergy = getEnergyAtTime(
      planetWithPosition.planetData,
      new Date().getTime()
    );
    // Only planets within the current world radius are allowed to move
    if (!planetWithPosition.location) {
      return false;
    }
    const dist = distBetweenCoords(planetWithPosition.location!.coords, {
      x: 0,
      y: 0,
    });
    if (dist > currentWorldRadius) {
      return false;
    }
    // Only planets with > 75% energy are allowed to make a move
    return currentEnergy > planetWithPosition.planetData.energyCap * 0.75;
  });
}

// Logic from client/ArrivalUtils.ts
function getEnergyAtTime(planetData: PlanetData, atTimeMillis: number): number {
  const { energyLazy, energyGrowth, energyCap, owner } = planetData;
  if (energyLazy === 0) {
    return 0;
  }
  if (owner === EMPTY_ADDRESS) {
    return energyLazy;
  }

  if (planetData.planetType === PlanetType.SILVER_BANK) {
    if (energyLazy > energyCap) {
      return energyCap;
    }
  }

  const timeElapsed = atTimeMillis / 1000 - planetData.lastUpdated;
  const denominator =
    Math.exp((-4 * energyGrowth * timeElapsed) / energyCap) *
      (energyCap / energyLazy - 1) +
    1;
  return energyCap / denominator;
}

async function fetchNearbyPlanetIdsToPlayerPlanets(
  locationsById: LocationsById,
  playerPlanets: PlanetWithLocationsById,
  currentWorldRadius: number
): Promise<{ [playerPlanetId: string]: Array<string> }> {
  // TODO: O(N planets * M chunks), fix this later
  const results: { [playerPlanetId: string]: Array<string> } = {};
  for (const [targetLocationId, targetLocation] of Object.entries(
    locationsById
  )) {
    const r = distBetweenCoords(targetLocation.coords, { x: 0, y: 0 });
    if (r > currentWorldRadius) {
      continue;
    }
    for (const [playerPlanetId, playerPlanet] of Object.entries(
      playerPlanets
    )) {
      if (
        !playerPlanets[targetLocation.hash] &&
        planetIsInRangeOfCoordinate(playerPlanet, targetLocation.coords)
      ) {
        if (results[playerPlanetId]) {
          results[playerPlanetId].push(targetLocationId);
        } else {
          results[playerPlanetId] = [targetLocationId];
        }
      }
    }
  }
  return results;
}

function planetIsInRangeOfCoordinate(
  planet: PlanetWithLocation,
  coords: WorldCoords
) {
  if (!planet.location) {
    // Player planet position is not known
    return false;
  }
  const dist = distBetweenCoords(planet.location.coords, coords);
  return dist < getRange(planet.planetData.range, 50);
}

function distBetweenCoords(a: WorldCoords, b: WorldCoords) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Logic from client/ArrivalUtils.ts
function getRange(planetRange: number, percentEnergySending = 100): number {
  if (percentEnergySending === 0) {
    return 0;
  }
  return Math.max(Math.log2(percentEnergySending / 5), 0) * planetRange;
}

async function queryPlanetsOfInterest(
  apolloClient: ApolloClient<any>,
  planetIdsOfInterest: { [playerPlanetId: string]: Array<string> },
  locationsById: LocationsById,
  playerPlanets: PlanetWithLocationsById,
  contractConstants: ContractConstants
): Promise<{ [playerPlanetId: string]: Array<PlanetWithLocation> }> {
  const allPlanetIdsOfInterest = new Set<string>();
  for (const [_, planetIds] of Object.entries(planetIdsOfInterest)) {
    for (const planetId of planetIds) {
      allPlanetIdsOfInterest.add(planetId);
    }
  }
  if (!allPlanetIdsOfInterest.size) {
    return {};
  }
  log.verbose(
    "Querying " + allPlanetIdsOfInterest.size + " planets of interest"
  );

  const playerPlanetsByLevel = groupBy(
    Object.values(playerPlanets),
    (planet: PlanetWithLocation) => planet.planetData.planetLevel
  );

  // First, get planet default states (they won't be in the contract if they've never been captured)
  const planetsByPlanetId: { [planetId: string]: PlanetWithLocation } = {};
  allPlanetIdsOfInterest.forEach((planetId) => {
    const location = locationsById[planetId];
    planetsByPlanetId[planetId] = {
      planetId: planetId,
      planetData: defaultPlanetToPlanetData(
        defaultPlanetFromLocation(location, contractConstants) as DFPlanet
      ),
      location,
    };
  });

  // Filter out some planets now that we have their default states
  const targetPlanetsToExclude = new Set();
  allPlanetIdsOfInterest.forEach((planetId) => {
    // Filter out planets with unwanted levels
    const planet = planetsByPlanetId[planetId];
    const planetLevelLimit =
      PLANET_LEVELS_TO_CAPTURE_LIMITS[planet.planetData.planetLevel];
    if (
      planetLevelLimit &&
      playerPlanetsByLevel[planet.planetData.planetLevel]?.length >=
        planetLevelLimit
    ) {
      allPlanetIdsOfInterest.delete(planetId);
      targetPlanetsToExclude.add(planetId);
    }
    if (
      planetsByPlanetId[planetId]?.planetData.planetType ===
      PlanetType.SILVER_BANK
    ) {
      // Filter out quasars because they are useless
      allPlanetIdsOfInterest.delete(planetId);
      targetPlanetsToExclude.add(planetId);
    }
  });

  // Then, overwrite with contract data if present
  // TODO: We'll quickly hit the 1000 planet limit here, need to paginate
  const { data, error } = await apolloClient.query({
    fetchPolicy: "network-only",
    query: PLANETS_BY_ID_QUERY,
    variables: {
      planetIds: Array.from(allPlanetIdsOfInterest),
      maxPlanets: MAX_PLANETS_TO_QUERY,
    },
  });
  if (error || !data) {
    throw new Error("Error querying planets of interest");
  }
  for (const planet of data.planets) {
    planetsByPlanetId[planet.id] = {
      planetId: planet.id,
      planetData: gqlPlanetToPlanetData(planet),
      location: locationsById[planet.id],
    };
  }

  // Merge the results into an object keyed by player planet id
  const results: { [playerPlanetId: string]: Array<PlanetWithLocation> } = {};
  for (const [playerPlanetId, planetIds] of Object.entries(
    planetIdsOfInterest
  )) {
    results[playerPlanetId] = planetIds
      .map((planetId) => planetsByPlanetId[planetId])
      .filter(
        (planet) => !!planet && !targetPlanetsToExclude.has(planet.planetId)
      );
  }
  log.verbose("Queried planets of interest count: " + data.planets.length);

  return results;
}

function rankMoves(
  playerPlanets: { [playerPlanetId: string]: PlanetWithLocation },
  planetsOfInterest: { [playerPlanetId: string]: Array<PlanetWithLocation> }
): Array<MoveToExecute> {
  const results: Array<MoveToExecute> = [];
  for (const [playerPlanetId, targetPlanets] of Object.entries(
    planetsOfInterest
  )) {
    let bestMove: MoveToExecute | null = null;
    let bestMoveDist = Number.MAX_VALUE;
    const playerPlanetData = playerPlanets[playerPlanetId].planetData;
    const currentEnergy = getEnergyAtTime(
      playerPlanetData,
      new Date().getTime()
    );
    targetPlanets.forEach((targetPlanet) => {
      const playerPlanet = playerPlanets[playerPlanetId];
      const playerPlanetLocation = playerPlanet.location;
      const targetPlanetLocation = targetPlanet.location;
      if (
        !playerPlanetLocation ||
        !targetPlanetLocation ||
        // Don't attack other players
        targetPlanet.planetData.owner !== EMPTY_ADDRESS
      ) {
        return;
      }
      // Filter out planets with relative levels outside the desired range
      if (
        targetPlanet.planetData.planetLevel <
          playerPlanet.planetData.planetLevel -
            ATTACK_PLANETS_WITHIN_RELATIVE_LEVELS_BELOW ||
        targetPlanet.planetData.planetLevel >
          playerPlanet.planetData.planetLevel +
            ATTACK_PLANETS_WITHIN_RELATIVE_LEVELS_ABOVE
      ) {
        return;
      }
      // Return the closest planet
      const dist = distBetweenCoords(
        playerPlanetLocation.coords,
        targetPlanetLocation.coords
      );
      if (dist < bestMoveDist) {
        bestMove = {
          fromPlanetId: playerPlanetId,
          toPlanetId: targetPlanet.planetId,
          // Always send 50% energy for now
          energy: currentEnergy * 0.5,
        };
        bestMoveDist = dist;
      }
    });
    if (bestMove) {
      results.push(bestMove);
    }
  }
  return results;
}

async function executeMoves(
  movesToExecute: Array<MoveToExecute>,
  locationsById: LocationsById,
  contractApi: ContractAPI,
  currentWorldRadius: number
) {
  const contractConstants = await contractApi.fetchContractConstants();
  const txs = [];
  log.log("Executing " + movesToExecute.length + " moves...");
  for (const moveToExecute of movesToExecute) {
    if (pendingTransactionsByPlanetId[moveToExecute.fromPlanetId]) {
      log.log(
        "Planet " +
          moveToExecute.fromPlanetId +
          " already has a tx, cannot move"
      );
      continue;
    }

    log.log("Executing move: " + JSON.stringify(moveToExecute));
    const c1 = locationsById[moveToExecute.fromPlanetId].coords;
    const c2 = locationsById[moveToExecute.toPlanetId].coords;
    const xDiff = c2.x - c1.x;
    const yDiff = c2.y - c1.y;
    const distMax = Math.ceil(Math.sqrt(xDiff ** 2 + yDiff ** 2));
    const moveArgs = await getMoveArgs(
      c1.x,
      c1.y,
      c2.x,
      c2.y,
      currentWorldRadius,
      distMax,
      contractConstants
    );
    const tx = await contractApi.move(moveArgs, moveToExecute.energy);
    txs.push(tx);
    pendingTransactionsByPlanetId[moveToExecute.fromPlanetId] = tx;
    tx.submitted.catch((e) => {
      log.error(
        "Error submitting move: " + JSON.stringify(moveToExecute) + " -- " + e
      );
      delete pendingTransactionsByPlanetId[moveToExecute.fromPlanetId];
    });
    tx.confirmed
      .then(() => {
        log.log(
          "Successfully confirmed move: " + JSON.stringify(moveToExecute)
        );
        delete pendingTransactionsByPlanetId[moveToExecute.fromPlanetId];
      })
      .catch((e) => {
        log.error(
          "Error confirming move: " + JSON.stringify(moveToExecute) + " -- " + e
        );
        delete pendingTransactionsByPlanetId[moveToExecute.fromPlanetId];
      });
    log.log(
      "Successfully SNARKed and queued move: " + JSON.stringify(moveToExecute)
    );
  }
  // Wait for all txs to be submitted
  log.verbose("Waiting on " + txs.length + " move submissions...");
  await Promise.all(txs.map((tx) => tx.submitted));
  log.verbose("All moves submitted");
}
