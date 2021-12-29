// Module to automatically capture nearby planets nearby

import { ApolloClient } from "@apollo/client/core";
import { EMPTY_ADDRESS } from "@darkforest_eth/constants";
import { PlanetType, WorldCoords } from "@darkforest_eth/types";
import { toExploredChunk } from "df-client";
import { keyBy, omitBy } from "lodash";

import { ALL_CHUNKS_LIST_KEY, log } from "df-helm-common";

import { RedisClient } from "../types";
import { PLANETS_BY_ID_QUERY, PLAYER_PLANETS_QUERY } from "./queries";

const PLAYER_ADDRESS = process.env.PLAYER_ADDRESS;
const PLAYER_SECRET_KEY = process.env.PLAYER_SECRET_KEY;

const MAX_PLAYER_PLANETS_SUPPORTED = 1000;

type PositionByPlanetId = { [planetId: string]: WorldCoords };

type PlanetWithPosition = {
  planetId: string;
  planetData: any;
  position: WorldCoords | undefined;
};

type PlanetWithPositionMap = { [playerPlanetId: string]: PlanetWithPosition };

type MoveToExecute = {
  fromPlanetId: string;
  toPlanetId: string;
  energy: number;
};

export async function greedyCapture(
  apolloClient: ApolloClient<any>,
  redisClient: RedisClient
) {
  const positionsByPlanetId = await getAllPlanetPositions(redisClient);
  const playerPlanets = await queryPlayerPlanets(
    apolloClient,
    positionsByPlanetId
  );
  const moveablePlayerPlanets = filterPlayerPlanetsToMoveable(playerPlanets);
  const planetIdsOfInterest = await fetchNearbyPlanetIdsToPlayerPlanets(
    positionsByPlanetId,
    moveablePlayerPlanets
  );
  const planetsOfInterest = await queryPlanetsOfInterest(
    apolloClient,
    planetIdsOfInterest
  );
  const movesToExecute = rankMoves(moveablePlayerPlanets, planetsOfInterest);
  await executeMoves(movesToExecute);
}

async function getAllPlanetPositions(redisClient: RedisClient) {
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
  const results: PositionByPlanetId = {};
  for (const chunk of allExploredChunks) {
    for (const planetLocation of chunk.planetLocations) {
      results[planetLocation.hash] = planetLocation.coords;
    }
  }
  log.verbose("Known positions for planets: " + Object.keys(results).length);
  return results;
}

async function queryPlayerPlanets(
  apolloClient: ApolloClient<any>,
  positionsByPlanetId: PositionByPlanetId
): Promise<PlanetWithPositionMap> {
  const { data, error } = await apolloClient.query({
    fetchPolicy: "network-only",
    query: PLAYER_PLANETS_QUERY,
    variables: {
      owner: PLAYER_ADDRESS,
      maxPlanets: MAX_PLAYER_PLANETS_SUPPORTED,
    },
  });
  if (error || !data) {
    throw new Error("Error querying planets for player");
  }
  const results: PlanetWithPositionMap = {};
  for (const result of data.planets) {
    results[result.id as string] = {
      planetId: result.id,
      planetData: result,
      position: positionsByPlanetId[result.id],
    };
  }
  log.verbose("Player planet count: " + Object.keys(results).length);
  return results;
}

function filterPlayerPlanetsToMoveable(
  playerPlanets: PlanetWithPositionMap
): PlanetWithPositionMap {
  return omitBy(playerPlanets, (planetWithPosition, planetId) => {
    const currentEnergy = getEnergyAtTime(
      planetWithPosition.planetData,
      new Date().getTime()
    );
    // Only planets with > 75% energy are allowed to make a move
    return (
      currentEnergy >
      (planetWithPosition.planetData.milliEnergyCap / 1000) * 0.75
    );
  });
}

// Logic from client/ArrivalUtils.ts
function getEnergyAtTime(planetData: any, atTimeMillis: number): number {
  if (planetData.milliEnergyLazy === 0) {
    return 0;
  }
  if (planetData.owner === EMPTY_ADDRESS) {
    return planetData.milliEnergyLazy;
  }

  if (planetData.planetType === PlanetType.SILVER_BANK) {
    if (planetData.milliEnergyLazy > planetData.milliEnergyCap) {
      return planetData.milliEnergyCap;
    }
  }

  const timeElapsed = atTimeMillis / 1000 - planetData.lastUpdated;
  const energyGrowth = planetData.milliEnergyGrowth / 1000;
  const energyCap = planetData.milliEnergyCap / 1000;
  const energy = planetData.milliEnergyLazy / 1000;
  const denominator =
    Math.exp((-4 * energyGrowth * timeElapsed) / energyCap) *
      (energyCap / energy - 1) +
    1;
  return energyCap / denominator;
}

async function fetchNearbyPlanetIdsToPlayerPlanets(
  positionsByPlanetId: PositionByPlanetId,
  playerPlanets: PlanetWithPositionMap
): Promise<{ [playerPlanetId: string]: Array<string> }> {
  // TODO: O(N planets * M chunks), fix this later
  const results: { [playerPlanetId: string]: Array<string> } = {};
  for (const [targetPlanetId, targetPlanetPosition] of Object.entries(
    positionsByPlanetId
  )) {
    for (const [playerPlanetId, playerPlanet] of Object.entries(
      playerPlanets
    )) {
      if (planetIsInRangeOfCoordinate(playerPlanet, targetPlanetPosition)) {
        if (results[playerPlanetId]) {
          results[playerPlanetId].push(targetPlanetId);
        } else {
          results[playerPlanetId] = [targetPlanetId];
        }
      }
    }
  }
  return results;
}

function planetIsInRangeOfCoordinate(
  planet: PlanetWithPosition,
  coords: WorldCoords
) {
  if (!planet.position) {
    // Player planet position is not known
    return false;
  }
  const dist = Math.sqrt(
    (planet.position.x - coords.x) ** 2 + (planet.position.y - coords.y) ** 2
  );
  return dist < getRange(planet.planetData.range, 50);
}

// Logic from client/ArrivalUtils.ts
function getRange(planetRange: number, percentEnergySending = 100): number {
  if (percentEnergySending === 0) {
    return 0;
  }
  return Math.max(Math.log2(percentEnergySending / 5), 0) * planetRange;
}

// Breaking issue: Unowned planets are not actually available in the subgraph
async function queryPlanetsOfInterest(
  apolloClient: ApolloClient<any>,
  planetIdsOfInterest: { [playerPlanetId: string]: Array<string> }
): Promise<{ [playerPlanetId: string]: Array<PlanetWithPosition> }> {
  const allPlanetIdsOfInterest = [];
  for (const [_, planetIds] of Object.entries(planetIdsOfInterest)) {
    allPlanetIdsOfInterest.push(...planetIds);
  }
  const { data, error } = await apolloClient.query({
    fetchPolicy: "network-only",
    query: PLANETS_BY_ID_QUERY,
    variables: {
      planetIds: allPlanetIdsOfInterest,
    },
  });
  if (error || !data) {
    throw new Error("Error querying planets of interest");
  }
  const planetsByPlanetId = keyBy(data.planets, (planet) => planet.id);
  const results: { [playerPlanetId: string]: Array<PlanetWithPosition> } = {};
  for (const [playerPlanetId, planetIds] of Object.entries(
    planetIdsOfInterest
  )) {
    results[playerPlanetId] = planetIds
      .map((planetId) => planetsByPlanetId[planetId])
      .filter((planet) => !!planet);
  }
  log.verbose("Queried planets of interest count: " + data.planets.length);
  return results;
}

function rankMoves(
  playerPlanets: { [playerPlanetId: string]: PlanetWithPosition },
  planetsOfInterest: { [playerPlanetId: string]: Array<PlanetWithPosition> }
): Array<MoveToExecute> {
  const results: Array<MoveToExecute> = [];
  // TODO: Just returns the first pair with a 50% energy send for now
  for (const [playerPlanetId, targetPlanets] of Object.entries(
    planetsOfInterest
  )) {
    const playerPlanetData = playerPlanets[playerPlanetId].planetData;
    const currentEnergy = getEnergyAtTime(
      playerPlanetData,
      new Date().getTime()
    );
    results.push({
      fromPlanetId: playerPlanetId,
      toPlanetId: targetPlanets[0].planetId,
      energy: currentEnergy * 0.5,
    });
  }
  return results;
}

async function executeMoves(movesToExecute: Array<MoveToExecute>) {
  for (const moveToExecute in movesToExecute) {
    log.log("Executing move: " + JSON.stringify(moveToExecute));
  }
}
